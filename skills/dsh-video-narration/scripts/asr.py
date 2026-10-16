#!/usr/bin/env python3
"""语音转写（阿里百炼 qwen-audio-3.0-asr-flash，key 从 .secrets/dashscope.key 读）。

⚠️ **不要用它做判据**（2026-10-15 用户明确指出，实测也自证）：
   它对短句、文言、人名会**整段幻觉**——同一条清晰慢速的 TTS，它听成日语，甚至阿姆哈拉语；
   "守将羊侃"被猜成"首相李克强"；S9 的两音节"荷，荷"直接报 no words。
   所以：**它能证明的只有"它自己听不懂"，不能证明"念错了"。**
   判"念得对不对"只能靠人耳。本工具留着只做粗筛（比如长段语音里有没有人声）。

它还能干的事：
  1. 长段台词里定位"大概在说话"（配合 tools/vad.py 交叉验证）
  2. 生成带时间戳的粗稿，方便人工核对时快速跳到可疑位置

接口形状（踩过坑）：只有**原生** multimodal 端点的 `input.messages` 数组能吃本地音频的
base64 —— `input.audio` 会 500（"resample audio from 0 to 16000 failed"），
OpenAI 兼容端点会 400（"format is empty"）。

用法：
  python3 asr.py out/talk/talk_S7_00001_.mp4
  python3 asr.py --expect "我倾宗报主" out/talk/talk_S7_00001_.mp4
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
def read_key() -> str:
    """密钥来源（按优先级）：DASHSCOPE_API_KEY 环境变量 →
    DASHSCOPE_KEY_FILE 指定的文件 → ~/.dsh/secrets/dashscope.key。"""
    env = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if env:
        return env
    path = Path(os.environ.get("DASHSCOPE_KEY_FILE",
                               Path.home() / ".dsh" / "secrets" / "dashscope.key"))
    return path.read_text().strip()
URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
MODEL = "qwen-audio-3.0-asr-flash"


def to_wav(path: Path) -> bytes:
    """任何输入 → 16k 单声道 wav（ASR 只吃 16k）。"""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = Path(f.name)
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(path),
                        "-ac", "1", "-ar", "16000", "-f", "wav", str(tmp)],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-400:])
    data = tmp.read_bytes()
    tmp.unlink(missing_ok=True)
    return data


def transcribe(path: Path):
    key = read_key()
    b64 = base64.b64encode(to_wav(path)).decode()
    payload = {
        "model": MODEL,
        "input": {"messages": [{"role": "user", "content": [
            {"audio": f"data:audio/wav;base64,{b64}"}]}]},
        "parameters": {"format": "wav"},
    }
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    if d.get("code"):
        raise RuntimeError(f"{d['code']}: {d.get('message')}")
    out = d.get("output") or {}
    # 兼容两种包法
    if "output" in out and isinstance(out["output"], dict):
        out = out["output"]
    sents = out.get("sentence") or []
    if isinstance(sents, dict):
        sents = [sents]
    return "".join(s.get("text", "") for s in sents), sents


def main():
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="*")
    p.add_argument("--expect", default="")
    a = p.parse_args()
    if not a.files:
        print(__doc__)
        return 1
    rc = 0
    for f in a.files:
        try:
            text, sents = transcribe(Path(f))
        except Exception as e:
            print(f"{Path(f).name}: ✗ {str(e)[:160]}")
            rc = 1
            continue
        print(f"\n{Path(f).name}")
        print(f"  转写：{text or '（无语音）'}")
        for s in sents:
            b, e = s.get("begin_time", 0) / 1000, s.get("end_time", 0) / 1000
            print(f"    {b:>6.2f}–{e:>6.2f}s  {s.get('text','')}")
        if a.expect:
            exp = "".join(c for c in a.expect if "\u4e00" <= c <= "\u9fff")
            got = "".join(c for c in text if "\u4e00" <= c <= "\u9fff")
            same = exp and exp in got
            print(f"  期望：{a.expect}")
            print(f"  汉字比对：{'✓ 命中' if same else '✗ 不一致'}"
                  f"（期望 {len(exp)} 字 / 转写 {len(got)} 字）")
            if not same:
                rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())