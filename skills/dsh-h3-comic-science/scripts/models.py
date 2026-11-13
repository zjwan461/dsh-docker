# -*- coding: utf-8 -*-
"""扫描工作流依赖的模型/LoRA，并生成可执行的下载脚本（curl）。

用法:
  python models.py scan                     # 列出工作流依赖的模型文件与目标目录
  python models.py plan --rate 20M          # 解析真实下载地址，生成 fetch-models.sh
  python models.py plan --offline           # 不联网：只用内置映射，其余标为待确认

设计:
  - 模型名 → 目标目录由节点类型决定（unet/clip/vae/lora/ckpt）。
  - 保留工作流里写的子目录前缀（如 minimax/xxx）——服务器就是这么放的。
  - 地址优先用 references/model-sources.json 的显式映射；
    没有的按 candidates 仓库列表去 HF 树里按文件名匹配（联网时）。
  - 所有 curl 带 -C -（续传）与 --limit-rate（默认 20M）。
"""
import argparse, json, os, re, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, "references", "workflows")
SOURCES = os.path.join(ROOT, "references", "model-sources.json")

# 节点输入键 → ComfyUI 目标目录
KEY_DIR = {
    "unet_name": "diffusion_models",
    "ckpt_name": "checkpoints",
    "clip_name": "text_encoders",
    "clip_name1": "text_encoders",
    "clip_name2": "text_encoders",
    "vae_name": "vae",
    "lora_name": "loras",
}
MODEL_EXT = (".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".bin")


def load_json(p, default=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return default


def iter_nodes(path):
    d = load_json(path, {})
    if not isinstance(d, dict):
        return
    wf = d.get("prompt", d)
    if "nodes" in d and isinstance(d["nodes"], list):  # UI 格式
        for n in d["nodes"]:
            if not isinstance(n, dict):
                continue
            ins = {}
            for i in (n.get("inputs") or []):
                if isinstance(i, dict) and i.get("name"):
                    ins[i["name"]] = "<link>"
            ins.update(n.get("widgets_values_named") or {})
            yield n.get("type") or "?", ins
        return
    for v in wf.values():
        if isinstance(v, dict) and "class_type" in v:
            yield v["class_type"], (v.get("inputs") or {})


def scan():
    deps = {}
    for fn in sorted(os.listdir(WF)) if os.path.isdir(WF) else []:
        pass
    for dirpath, _, files in os.walk(WF):
        for fn in sorted(files):
            if not fn.endswith(".json"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            for cls, ins in iter_nodes(p):
                for k, v in ins.items():
                    if k not in KEY_DIR or not isinstance(v, str):
                        continue
                    if not v.lower().endswith(MODEL_EXT):
                        continue
                    base = os.path.basename(v)
                    item = deps.setdefault(base, {"file": base, "orig": v, "dir": KEY_DIR[k], "used_by": set()})
                    item["used_by"].add(rel)
    return deps


_TREE_CACHE = {}


def hf_tree(repo):
    if repo in _TREE_CACHE:
        return _TREE_CACHE[repo]
    url = "https://huggingface.co/api/models/%s/tree/main?recursive=true" % repo
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
        files = [e["path"] for e in data if e.get("type") == "file"]
    except Exception:
        files = []
    _TREE_CACHE[repo] = files
    return files


def resolve(fname, src):
    """返回 (url, note)；解析不到返回 (None, 提示)。"""
    explicit = src.get("explicit", {}).get(fname)
    if explicit:
        if explicit.get("url"):
            return explicit["url"], "explicit-url"
        repo, path = explicit["repo"], explicit["path"]
        return "https://huggingface.co/%s/resolve/main/%s?download=true" % (repo, path), "explicit"

    for repo in src.get("candidates", []):
        tree = hf_tree(repo)
        if not tree:
            continue
        hit = [p for p in tree if os.path.basename(p) == fname]
        if hit:
            return "https://huggingface.co/%s/resolve/main/%s?download=true" % (repo, hit[0]), repo
    hint = src.get("hints", {}).get(fname)
    return None, hint or "未收录：用 HF/Civitai 搜文件名，确认后补进 model-sources.json"


def sh_quote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def plan(args):
    src = load_json(SOURCES, {}) or {}
    deps = scan()
    lines = ["#!/usr/bin/env bash",
             "# 自动生成：MiniMax H3 skill 的模型下载脚本",
             "# 用法: 在 ComfyUI 根目录执行 bash fetch-models.sh",
             "# 只下载缺失的文件；已存在会跳过（--skip-existing 由 curl -C - 与 test 实现）",
             "set -u",
             'COMFY="${COMFY_ROOT:-.}"',
             'RATE="${RATE:-%s}"' % args.rate,
             "mkdir -p \"$COMFY/models/diffusion_models\" \"$COMFY/models/text_encoders\" \"$COMFY/models/vae\" \"$COMFY/models/loras\" \"$COMFY/models/checkpoints\"",
             ""]
    unresolved, ok = [], 0
    for base, item in sorted(deps.items()):
        dest = "/".join(["models", item["dir"], item["orig"].replace("\\", "/")])
        url, note = (None, "offline") if args.offline else resolve(base, src)
        if not url:
            unresolved.append((base, item["dir"], note, sorted(item["used_by"])[:2]))
            continue
        ok += 1
        sha = (src.get("explicit", {}).get(base) or {}).get("sha256") or ""
        block = [
            'DEST="$COMFY/%s"' % dest.replace('"', '\\"'),
            'if [ -f "$DEST" ]; then echo "skip  $DEST"; else',
            '  echo "get   $DEST"',
            '  mkdir -p "$(dirname "$DEST")"',
            '  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" %s || echo "FAIL $DEST"' % sh_quote(url),
            'fi',
        ]
        if sha:
            block += [
                'if [ -f "$DEST" ]; then echo "%s  $DEST" | sha256sum -c - >/dev/null 2>&1 '
                '|| echo "HASH MISMATCH $DEST (再下一次或手工核对)"; fi' % sha,
            ]
        block.append("")
        lines += block
    out = args.out or os.path.join(ROOT, "references", "workflows", "fetch-models.sh")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print("resolved %d / %d" % (ok, len(deps)))
    print("wrote", out)
    if unresolved:
        print("\n未解析（需手工确认来源）:")
        for base, d, note, used in unresolved:
            print("  - %-58s → models/%s   (%s)  %s" % (base, d, note, used))
    return 0 if not unresolved else 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan")
    p = sub.add_parser("plan")
    p.add_argument("--rate", default="20M")
    p.add_argument("--out", default="")
    p.add_argument("--offline", action="store_true")
    a = ap.parse_args()

    if a.cmd == "scan":
        deps = scan()
        for base, it in sorted(deps.items()):
            print("%-62s → models/%-18s  %s" % (base, it["dir"], ", ".join(sorted(it["used_by"]))[:70]))
        print("\n%d unique files" % len(deps))
        return 0
    return plan(a)


if __name__ == "__main__":
    sys.exit(main())
