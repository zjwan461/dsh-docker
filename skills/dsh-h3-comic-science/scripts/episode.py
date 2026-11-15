# -*- coding: utf-8 -*-
"""单集流水线：静帧 → 镜头 → 合片。纯标准库 + ffmpeg(PIL 可选)。

一条竖屏短剧集的最小可复现路径（实测 22 秒 5 镜，见 references/episode-pipeline.md）：
  1. still  : Qwen-Image 2512(+Lightning 4step) 出锚点帧
  2. edit   : Qwen-Image-Edit-2509 以锚点为参考重排机位（近景别用 crop，别用 edit）
  3. crop   : 从已有帧竖裁出近景/特写（身份 100% 一致，0 成本）
  4. shot   : H3 i2v（fl2va + turbo LoRA），说话镜 steps=8，其余 steps=4
  5. pan    : 静帧 + zoompan 缓推（远景/易崩镜头用它，零伪影）
  6. 合片   : 交给 scripts/finish.py（它负责 concat/音床/loudnorm/烧字幕）

用法:
  python episode.py --base http://127.0.0.1:8188 still --prompt-file p.txt --out ep01/s1.png
  python episode.py ... edit  --ref ep01/s1.png --prompt-file p2.txt --out ep01/s2.png
  python episode.py ... crop  --ref ep01/s2.png --box 180,230,640,1050 --out ep01/s3.png
  python episode.py ... shot  --ref ep01/s2.png --prompt-file q.txt --frames 107 --steps 8 --out ep01/s2.mp4
  python episode.py ... pan   --ref ep01/s5.png --seconds 4.46 --out ep01/s5.mp4
  python episode.py ... run   --plan episode.json          # 按清单跑完整集
  python episode.py ... run   --plan episode.json --only s3,s4

约定：
  - 模型名用 Windows 反斜杠（ComfyUI 在 Windows 上按字符串全等校验 combo）。
  - 输出一律先落到本地文件，再进 finish.py；不要在服务器目录里就地剪。
  - --keep-inputs 会把参考图留在 ComfyUI 的 input 目录，默认也留（H3 需要它做 first_frame）。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

# 本机 ComfyUI 不走系统代理
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

DEFAULTS = {
    "i2i_unet": "qwen\\qwen_image_2512_fp8_e4m3fn.safetensors",
    "i2i_lora": "Qwen\\Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
    "edit_unet": "qwen\\qwen_image_edit_2509_fp8_e4m3fn.safetensors",
    "edit_lora": "Qwen\\Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
    "i2i_clip": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    "i2i_vae": "qwen_image_vae.safetensors",
    "h3_unet": "minimax\\minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "h3_clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "h3_vae_video": "minimax_h3_video_vae_fp16.safetensors",
    "h3_vae_audio": "minimax_h3_audio_vae_fp32.safetensors",
    "turbo4": "minimax\\minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors",
    "turbo8": "minimax\\minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
}


# ---------------------------------------------------------------- transport
def _req(base, path, data=None, headers=None, raw=False):
    req = urllib.request.Request(base + path, data=data, method="POST" if data is not None else "GET",
                                 headers=headers or {})
    try:
        with _OPENER.open(req, timeout=120) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s %s: %s" % (e.code, path, e.read().decode("utf-8", "replace")[:1200]))
    return body if raw else json.loads(body.decode("utf-8"))


def upload(base, path):
    """把本地图塞进 ComfyUI 的 input 目录，返回它在 LoadImage 里该用的名字。"""
    name = os.path.basename(path)
    with open(path, "rb") as f:
        content = f.read()
    boundary = "----ep%f" % time.time()
    head = ("--%s\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            "--%s\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n"
            "--%s\r\nContent-Disposition: form-data; name=\"image\"; filename=\"%s\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n" % (boundary, boundary, boundary, name)).encode()
    body = head + content + ("\r\n--%s--\r\n" % boundary).encode()
    _req(base, "/upload/image", data=body,
         headers={"Content-Type": "multipart/form-data; boundary=%s" % boundary})
    return name


def submit(base, graph):
    r = _req(base, "/prompt", data=json.dumps({"prompt": graph}).encode(),
             headers={"Content-Type": "application/json"})
    return r["prompt_id"], r.get("node_errors")


def wait(base, pid, timeout=3600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            h = _req(base, "/history/" + pid)
        except Exception as e:                      # 服务忙/重启时别自杀
            print("  poll error:", e, "(continuing)")
            time.sleep(5)
            continue
        if pid in h:
            item = h[pid]
            st = (item.get("status") or {}).get("status_str")
            if item.get("outputs") or st in ("success", "error"):
                return item, int(time.time() - t0)
        time.sleep(4)
    return None, int(time.time() - t0)


def fetch(base, item, out_path):
    """把 history 里第一个文件抓成本地文件。"""
    for _nid, out in (item.get("outputs") or {}).items():
        for key in ("images", "videos", "gifs"):
            for it in out.get(key, []) or []:
                if not it.get("filename"):
                    continue
                q = urllib.parse.urlencode({"filename": it["filename"],
                                            "subfolder": it.get("subfolder", ""),
                                            "type": it.get("type", "output")})
                data = _req(base, "/view?" + q, raw=True)
                os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
                with open(out_path, "wb") as f:
                    f.write(data)
                return out_path
    raise RuntimeError("history 里没有可下载的产物: %s" % json.dumps(item)[:400])


# ------------------------------------------------------------------ graphs
def graph_still(prompt, prefix, w, h, seed, steps, m):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": m["i2i_unet"], "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly",
              "inputs": {"model": ["1", 0], "lora_name": m["i2i_lora"], "strength_model": 1.0}},
        "3": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": m["i2i_clip"], "type": "qwen_image", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": m["i2i_vae"]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": prompt}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": ""}},
        "7": {"class_type": "EmptyLatentImage",
              "inputs": {"width": w, "height": h, "batch_size": 1}},
        "8": {"class_type": "KSampler",
              "inputs": {"model": ["2", 0], "positive": ["5", 0], "negative": ["6", 0],
                         "latent_image": ["7", 0], "seed": seed, "steps": steps, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["4", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": prefix}},
    }


def graph_edit(prompt, ref_name, prefix, w, h, seed, steps, m):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": m["edit_unet"], "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly",
              "inputs": {"model": ["1", 0], "lora_name": m["edit_lora"], "strength_model": 1.0}},
        "3": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": m["i2i_clip"], "type": "qwen_image", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": m["i2i_vae"]}},
        "5": {"class_type": "LoadImage", "inputs": {"image": ref_name}},
        "6": {"class_type": "TextEncodeQwenImageEditPlus",
              "inputs": {"clip": ["3", 0], "prompt": prompt, "vae": ["4", 0], "image1": ["5", 0]}},
        "7": {"class_type": "TextEncodeQwenImageEditPlus",
              "inputs": {"clip": ["3", 0], "prompt": "", "vae": ["4", 0], "image1": ["5", 0]}},
        "8": {"class_type": "EmptyLatentImage",
              "inputs": {"width": w, "height": h, "batch_size": 1}},
        "9": {"class_type": "KSampler",
              "inputs": {"model": ["2", 0], "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["8", 0], "seed": seed, "steps": steps, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["4", 0]}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": prefix}},
    }


def graph_shot(prompt, img_name, prefix, w, h, seed, frames, steps, m):
    lora = m["turbo8"] if steps >= 8 else m["turbo4"]
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": m["h3_unet"], "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly",
              "inputs": {"model": ["1", 0], "lora_name": lora, "strength_model": 1.0}},
        "3": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": m["h3_clip"], "type": "minimax", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": m["h3_vae_video"]}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": m["h3_vae_audio"]}},
        "6": {"class_type": "LoadImage", "inputs": {"image": img_name}},
        "7": {"class_type": "MiniMaxH3ImageToVideo",
              "inputs": {"clip": ["3", 0], "vae": ["4", 0], "prompt": prompt,
                         "width": w, "height": h, "length": frames, "first_frame": ["6", 0]}},
        # 注意：7 号节点返回两个 slot —— [0]=CONDITIONING, [1]=LATENT
        "8": {"class_type": "BasicGuider", "inputs": {"model": ["2", 0], "conditioning": ["7", 0]}},
        "9": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "10": {"class_type": "BasicScheduler",
               "inputs": {"model": ["2", 0], "scheduler": "beta", "steps": steps, "denoise": 1.0}},
        "11": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "12": {"class_type": "SamplerCustomAdvanced",
               "inputs": {"noise": ["11", 0], "guider": ["8", 0], "sampler": ["9", 0],
                          "sigmas": ["10", 0], "latent_image": ["7", 1]}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["4", 0]}},
        "14": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["12", 0], "vae": ["5", 0]}},
        "15": {"class_type": "CreateVideo",
               "inputs": {"images": ["13", 0], "fps": 24, "audio": ["14", 0]}},
        "16": {"class_type": "SaveVideo",
               "inputs": {"video": ["15", 0], "filename_prefix": prefix, "format": "auto"}},
    }


# ------------------------------------------------------------------- local ops
def _pil():
    try:
        from PIL import Image
        return Image
    except ImportError:
        sys.exit("crop 需要 Pillow：pip install pillow")


def do_crop(ref, box, out, size=None):
    Image = _pil()
    im = Image.open(ref).convert("RGB")
    x1, y1, x2, y2 = box
    im = im.crop((x1, y1, x2, y2))
    if size:
        im = im.resize((int(size[0]), int(size[1])), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    im.save(out)
    print("crop ->", out, im.size)


def do_pan(ref, out, seconds=4.46, fps=24, size=(1080, 1920), zoom=1.10):
    ff = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if not ff:
        sys.exit("找不到 ffmpeg")
    frames = int(round(seconds * fps))
    w, h = size
    vf = ("scale=%d:%d:flags=lanczos," % (w * 2, h * 2)
          + "zoompan=z='if(lte(on,1),%.3f,max(1.0,zoom-%.5f))'" % (zoom, (zoom - 1.0) / frames)
          + ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=%d:s=%dx%d:fps=%d," % (frames, w, h, fps)
          + "format=yuv420p")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    cmd = [ff, "-y", "-v", "error", "-loop", "1", "-i", ref,
           "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",   # 没有音轨 concat 会匹配不到 [i:a]
           "-vf", vf, "-frames:v", str(frames),
           "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "128k", "-shortest", out]
    subprocess.run(cmd, check=True)
    print("pan ->", out, "%dx%d %d frames" % (w, h, frames))


# ------------------------------------------------------------------- commands
def cmd_still(a, graphtype, m):
    prompt = open(a.prompt_file, encoding="utf-8").read().strip() if a.prompt_file else (a.prompt or "")
    if not prompt:
        sys.exit("still/edit 要给 --prompt 或 --prompt-file")
    ref_name = upload(a.base, a.ref) if graphtype == "edit" else None
    if graphtype == "edit":
        g = graph_edit(prompt, ref_name, a.prefix, a.width, a.height, a.seed, a.steps, m)
    else:
        g = graph_still(prompt, a.prefix, a.width, a.height, a.seed, a.steps, m)
    if a.dry_run:
        print(json.dumps(g, ensure_ascii=False, indent=2))
        return 0
    pid, errs = submit(a.base, g)
    print("queued", pid, "errors", errs)
    item, secs = wait(a.base, pid, a.timeout)
    if not item:
        print("TIMEOUT"); return 1
    path = fetch(a.base, item, a.out)
    print("still ->", path, secs, "s")
    return 0


def cmd_shot(a, m):
    prompt = open(a.prompt_file, encoding="utf-8").read().strip() if a.prompt_file else (a.prompt or "")
    if not prompt:
        sys.exit("shot 要给 --prompt 或 --prompt-file")
    if a.steps not in (4, 8):
        print("  ! steps=%d：只有 4 和 8 有对应 turbo LoRA，已按 %d 处理" % (a.steps, 8 if a.steps >= 8 else 4))
        a.steps = 8 if a.steps >= 8 else 4
    if a.steps == 4:
        print("  ! 4 步只适合无台词镜：同一 prompt 下 4 步会把中文台词念糊（见 native-dialogue.md §9）")
    img_name = os.path.basename(a.ref) if a.dry_run else upload(a.base, a.ref)
    g = graph_shot(prompt, img_name, a.prefix, a.width, a.height, a.seed, a.frames, a.steps, m)
    if a.dry_run:
        print(json.dumps(g, ensure_ascii=False, indent=2))
        return 0
    pid, errs = submit(a.base, g)
    print("queued", pid, "errors", errs)
    item, secs = wait(a.base, pid, a.timeout)
    if not item:
        print("TIMEOUT"); return 1
    path = fetch(a.base, item, a.out)
    print("shot ->", path, secs, "s")
    return 0


def load_plan(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cmd_run(a, m):
    plan = load_plan(a.plan)
    base = a.base or plan.get("base") or "http://127.0.0.1:8188"
    out_dir = a.out_dir or plan.get("out_dir") or "episode_out"
    w0 = plan.get("width", 768)
    h0 = plan.get("height", 1344)
    only = set(x.strip() for x in a.only.split(",")) if a.only else None
    made = {}

    def resolve(ref):
        if ref in made:
            return made[ref]
        return ref if os.path.isabs(ref) else os.path.join(out_dir, ref)

    for shot in plan.get("shots", []):
        sid = shot["id"]
        if only and sid not in only:
            continue
        kind = shot.get("kind", "still")
        out = os.path.join(out_dir, shot.get("out") or ("%s%s" % (sid, ".mp4" if kind in ("shot", "pan") else ".png")))
        print("[%s] %s -> %s" % (kind, sid, out))
        if kind in ("still", "edit"):
            ns = argparse.Namespace(
                base=base, prompt=shot.get("prompt"), prompt_file=shot.get("prompt_file"),
                ref=resolve(shot["ref"]) if shot.get("ref") else None,
                prefix=shot.get("prefix", "ep/%s" % sid),
                width=shot.get("width", w0), height=shot.get("height", h0),
                seed=shot.get("seed", 42), steps=shot.get("steps", 4),
                out=out, timeout=shot.get("timeout", 1800), dry_run=a.dry_run)
            if kind == "edit" and not ns.ref:
                sys.exit("[%s] edit 必须给 ref" % sid)
            cmd_still(ns, kind, m)
        elif kind == "crop":
            if a.dry_run:
                print("  (dry-run) crop", shot.get("ref"), "->", out)
            else:
                do_crop(resolve(shot["ref"]), shot["box"], out,
                        (shot.get("width", w0), shot.get("height", h0)))
        elif kind == "pan":
            if a.dry_run:
                print("  (dry-run) pan", shot.get("ref"), "->", out)
            else:
                do_pan(resolve(shot["ref"]), out, shot.get("seconds", 4.46),
                       shot.get("fps", 24), (shot.get("width", 1080), shot.get("height", 1920)))
        elif kind == "shot":
            ns = argparse.Namespace(
                base=base, prompt=shot.get("prompt"), prompt_file=shot.get("prompt_file"),
                ref=resolve(shot["ref"]), prefix=shot.get("prefix", "ep/%s" % sid),
                width=shot.get("width", w0), height=shot.get("height", h0),
                seed=shot.get("seed", 42), frames=shot.get("frames", 107),
                steps=shot.get("steps", 4), out=out,
                timeout=shot.get("timeout", 3600), dry_run=a.dry_run)
            cmd_shot(ns, m)
        else:
            sys.exit("未知 kind: %s" % kind)
        if not a.dry_run:
            made[sid] = out
            print("  done:", out)
    if not a.dry_run:
        print("all shots done ->", out_dir)
    return 0


# ---------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="单集流水线：静帧/改图/裁切/镜头/缓推/整集")
    ap.add_argument("--base", default=os.environ.get("COMFYUI_BASE", "http://127.0.0.1:8188"))
    ap.add_argument("--models", help="JSON 覆盖 DEFAULTS 里的模型名")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, default_out):
        p.add_argument("--out", required=True, help="本地输出文件（%s）" % default_out)
        p.add_argument("--dry-run", action="store_true", help="只打印 workflow，不提交")
    for name in ("still", "edit"):
        p = sub.add_parser(name)
        p.add_argument("--prompt")
        p.add_argument("--prompt-file")
        if name == "edit":
            p.add_argument("--ref", required=True, help="参考图（会传到 ComfyUI input）")
        p.add_argument("--prefix", default="ep/%s" % name)
        p.add_argument("--width", type=int, default=768)
        p.add_argument("--height", type=int, default=1344)
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--steps", type=int, default=4)
        p.add_argument("--timeout", type=int, default=1800)
        common(p, "ep01/s1.png")

    p = sub.add_parser("crop")
    p.add_argument("--ref", required=True)
    p.add_argument("--box", required=True, help="x1,y1,x2,y2")
    p.add_argument("--width", type=int, default=768)
    p.add_argument("--height", type=int, default=1344)
    common(p, "ep01/s3.png")

    p = sub.add_parser("pan")
    p.add_argument("--ref", required=True)
    p.add_argument("--seconds", type=float, default=4.46)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--width", type=int, default=1080)
    p.add_argument("--height", type=int, default=1920)
    common(p, "ep01/s5.mp4")

    p = sub.add_parser("shot")
    p.add_argument("--ref", required=True, help="首帧图")
    p.add_argument("--prompt")
    p.add_argument("--prompt-file")
    p.add_argument("--prefix", default="ep/shot")
    p.add_argument("--width", type=int, default=768)
    p.add_argument("--height", type=int, default=1344)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--frames", type=int, default=107)
    p.add_argument("--steps", type=int, default=4, choices=[4, 8], help="说话镜用 8")
    p.add_argument("--timeout", type=int, default=3600)
    common(p, "ep01/s1.mp4")

    p = sub.add_parser("run")
    p.add_argument("--plan", required=True, help="episode.json")
    p.add_argument("--out-dir")
    p.add_argument("--only", help="只跑这些 id，逗号分隔")
    p.add_argument("--dry-run", action="store_true")

    a = ap.parse_args()
    a.base = a.base.rstrip("/")
    m = dict(DEFAULTS)
    if getattr(a, "models", None):
        m.update(json.loads(open(a.models, encoding="utf-8").read()))

    if a.cmd == "still":
        return cmd_still(a, "still", m)
    if a.cmd == "edit":
        return cmd_still(a, "edit", m)
    if a.cmd == "shot":
        return cmd_shot(a, m)
    if a.cmd == "crop":
        do_crop(a.ref, [int(x) for x in a.box.split(",")], a.out, (a.width, a.height))
        return 0
    if a.cmd == "pan":
        do_pan(a.ref, a.out, a.seconds, a.fps, (a.width, a.height))
        return 0
    if a.cmd == "run":
        return cmd_run(a, m)
    return 0


if __name__ == "__main__":
    sys.exit(main())