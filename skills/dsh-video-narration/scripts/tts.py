#!/usr/bin/env python3
"""旁白 TTS：一句话一条 wav，并给出"卡进镜头"建议的变速值。

两条路，默认走第一条（2026-10 实测最省事的一条）：

  A. 非流式 HTTP（推荐）
     POST https://<workspace>.cn-beijing.maas.aliyuncs.com
          /api/v1/services/audio/tts/SpeechSynthesizer
     {"model":"qwen-audio-3.0-tts-plus",
      "input":{"text":"…","voice":"longanlufeng","format":"wav","sample_rate":24000}}
     → output.audio.url（再 GET 下载）

     优点：一次请求直接拿音频，不需要 websocket、不需要管代理、
           不需要在"流式边界"上拼音频。整片几十句也只是几十次 POST。

  B. 原生 qwen3-tts-flash（有百炼 key 时可用）
     POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
     — 必须显式给 parameters.language_type="Chinese"，否则冷僻句/文言会被判成外语。

⚠️ 最重要的一个坑：`[cosyvoice:]Engine error [411]: TTS speak operation failed`
   不是接口写错，是**音色 ID 和 model 不配对**。qwen-audio-3.0-tts-plus 只有两个系统音色：
     longanlufeng（男）  longanlingxin（女）      —— 都不带版本后缀
   带 `_v3.1` / `_v3.6` 的是 qwen-audio-3.1-tts-flash 那批，喂给 3.0-plus 一样 411。

用法：
  python3 tts.py --text "大唐开国，名将如云。" --out vo/S01.wav
  python3 tts.py --probe                        # 逐个试音色，看哪个能出声
  python3 tts.py --batch shots.json --outdir vo # 批量；输出 durations.json 含建议 tempo

keys（按优先级）：TTS_API_KEY → TTS_KEY_FILE → ~/.dsh/secrets/tts.key
base  ：TTS_BASE（默认取 TTS_BASE 环境变量，没有就报错，让你显式填一次）
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "qwen-audio-3.0-tts-plus"
DEFAULT_VOICE = "longanlufeng"

# 系统音色表（model → [(voice_id, 说明)]）。来自官方音色列表，换了 model 一定要重查。
VOICES = {
    "qwen-audio-3.0-tts-plus": [
        ("longanlufeng", "男声，明亮爽朗，适合解说/纪录片"),
        ("longanlingxin", "女声，温暖有共情"),
    ],
    "qwen-audio-3.1-tts-flash": [
        ("longanhuan_v3.1", "女声，多语种/方言"),
        ("longanlingxin_v3.1", "女声"),
        ("anmingyuan_v3.1", "男声，清晰自然，旁白/广告"),
        ("huozhuoshi_v3.1", "男声，清晰，旁白"),
        ("xunanchuan_v3.1", "男声"),
        ("longsanshu_v3.1", "男声，沉稳有质感，有声书"),
    ],
}

ERROR_HINTS = {
    "Model not exist": "model 名在这个工作区不存在 —— 换 model，或换到有它的主机",
    "url error": "路径/端点不对，或这个网关根本没接这个服务 —— 先确认前缀（token-plan / llm-xxxx）",
    "Request voice is invalid!": "voice 传了空串",
    "[cosyvoice:]Engine error [411]": "音色 ID 与 model 不配对（最常见）",
    "InvalidApiKey": "key 和主机不属于同一个工作区 —— A 的 key 打 B 的主机必然 401",
}


def read_key() -> str:
    env = os.environ.get("TTS_API_KEY", "").strip()
    if env:
        return env
    path = Path(os.environ.get("TTS_KEY_FILE", Path.home() / ".dsh" / "secrets" / "tts.key"))
    if path.exists():
        return path.read_text().strip()
    raise SystemExit("没有可用的 TTS key：设 TTS_API_KEY 或写 ~/.dsh/secrets/tts.key")


def read_base() -> str:
    base = os.environ.get("TTS_BASE", "").strip().rstrip("/")
    if not base:
        raise SystemExit(
            "没有 TTS_BASE。填控制台给你的工作区域名，例如\n"
            "  export TTS_BASE=https://<workspace>.cn-beijing.maas.aliyuncs.com"
        )
    return base


def _explain(body: str) -> str:
    for needle, hint in ERROR_HINTS.items():
        if needle in body:
            return hint
    return ""


def synth_http(text, out: Path, *, base, key, model=DEFAULT_MODEL, voice=DEFAULT_VOICE,
               fmt="wav", sample_rate=24000, timeout=120):
    """非流式 HTTP：一次 POST 拿到 output.audio.url，再 GET 下载。"""
    url = f"{base}/api/v1/services/audio/tts/SpeechSynthesizer"
    payload = {"model": model,
               "input": {"text": text, "voice": voice, "format": fmt, "sample_rate": sample_rate}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        return {"error": raw[:400], "hint": _explain(raw), "status": e.code}
    audio_url = (body.get("output") or {}).get("audio", {}).get("url")
    if not audio_url:
        return {"error": json.dumps(body, ensure_ascii=False)[:400], "hint": ""}
    with urllib.request.urlopen(audio_url, timeout=timeout) as r:
        data = r.read()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return {"file": str(out), "bytes": len(data), "dur": duration(out)}


def synth_dashscope(text, out: Path, *, key, model="qwen3-tts-flash", voice="Cherry",
                    fmt="wav", timeout=120):
    """原生百炼端点。language_type 必须显式给，否则冷僻句会被判成外语。"""
    url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    payload = {"model": model,
               "input": {"text": text, "voice": voice},
               "parameters": {"format": fmt, "language_type": "Chinese"}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        return {"error": raw[:400], "hint": _explain(raw), "status": e.code}
    audio_url = (body.get("output") or {}).get("audio", {}).get("url")
    if not audio_url:
        return {"error": json.dumps(body, ensure_ascii=False)[:400], "hint": ""}
    with urllib.request.urlopen(audio_url, timeout=timeout) as r:
        data = r.read()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return {"file": str(out), "bytes": len(data), "dur": duration(out)}


def synth(text, out, *, route="http", **kw):
    if route == "dashscope":
        return synth_dashscope(text, Path(out), **kw)
    return synth_http(text, Path(out), **kw)


def duration(path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip()
    return round(float(out), 3) if out else 0.0


def tempo_for(vo_dur: float, slot: float, pad: float = 0.30) -> float:
    """为了让这句念完正好收在镜头切点前，需要多少倍速。

    clamp 到 [1.0, 1.30]：
      - 超过 1.30 → 文案配不上这个镜长，改文案或换更长的帧数（124/141/158）。
      - 低于 1.0 → **不要慢放**，让语音自然念完、后面留静默。
    """
    target = max(slot - pad, 0.5)
    return round(min(max(vo_dur / target, 1.0), 1.30), 3)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--text")
    p.add_argument("--out")
    p.add_argument("--batch", help="JSON: {id: text} 或 [{id, narration, frames}]")
    p.add_argument("--outdir", default="vo")
    p.add_argument("--fps", type=float, default=24.0)
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--voice", default=DEFAULT_VOICE)
    p.add_argument("--route", choices=["http", "dashscope"], default="http")
    p.add_argument("--probe", action="store_true", help="逐个试 VOICES 里的音色")
    a = p.parse_args()

    key = read_key()
    if a.route == "http":
        base = read_base()

    if a.probe:
        voices = VOICES.get(a.model, [(a.voice, "")])
        for vid, note in voices:
            kw = {"key": key, "model": a.model, "voice": vid}
            if a.route == "http":
                kw["base"] = base
            r = synth("测试一二。", Path("/tmp/_probe.wav"), route=a.route, **kw)
            print(f"{vid:24s} {'OK ' + str(r.get('dur')) + 's' if 'dur' in r else 'ERR ' + r.get('hint', r.get('error', ''))[:60]}  {note}")
        return

    if a.batch:
        items = json.loads(Path(a.batch).read_text(encoding="utf-8"))
        if isinstance(items, dict):
            items = [{"id": k, "narration": v} for k, v in items.items()]
        rows = []
        for it in items:
            sid, text = it["id"], it.get("narration") or it.get("text", "")
            if not text:
                continue
            out = Path(a.outdir) / f"{sid}.wav"
            kw = {"key": key, "model": a.model, "voice": a.voice}
            if a.route == "http":
                kw["base"] = base
            r = synth(text, out, route=a.route, **kw)
            if "dur" not in r:
                print(f"{sid} ERR {r.get('hint') or r.get('error')}", flush=True)
                continue
            row = {"id": sid, "dur": r["dur"], "chars": len(text)}
            if it.get("frames"):
                row["slot"] = round(it["frames"] / a.fps, 3)
                row["tempo"] = tempo_for(r["dur"], row["slot"])
            rows.append(row)
            print(f"{sid} {r['dur']:5.2f}s {len(text):2d}字 {len(text)/r['dur']:4.2f}字/s"
                  + (f"  tempo={row['tempo']:.2f}" if "tempo" in row else ""), flush=True)
        out_json = Path(a.outdir) / "_durations.json"
        out_json.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        total = sum(x["dur"] for x in rows)
        print(f"\n合计 {total:.2f}s → {out_json}")
        over = [x for x in rows if x.get("tempo", 1) >= 1.30]
        if over:
            print("⚠️ 这些句子超出镜长、变速到上限仍不够，改文案或换更长的帧数：")
            for x in over:
                print(f"   {x['id']}  vo={x['dur']}s slot={x['slot']}s")
        return

    if not (a.text and a.out):
        p.error("要么 --text/--out，要么 --batch，要么 --probe")
    kw = {"key": key, "model": a.model, "voice": a.voice}
    if a.route == "http":
        kw["base"] = base
    r = synth(a.text, Path(a.out), route=a.route, **kw)
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
