#!/usr/bin/env python3
"""旁白/台词 TTS（阿里百炼 qwen3-tts-flash，key 从 .secrets/dashscope.key 读）。

为什么用**原生**接口而不是 OpenAI 兼容接口：兼容接口对 `voice` 的摆放位置挑剔
（放 `audio.voice` 报 "The voice property is required"，放顶层又报 "invalid text"），
实测只有原生 `multimodal-generation/generation` 一次就通：
    POST /api/v1/services/aigc/multimodal-generation/generation
    {"model":"qwen3-tts-flash","input":{"text":…,"voice":…},"parameters":{"format":"wav"}}
返回 `output.audio.url`（OSS 链接，带签名有效期）。

用法：
  python3 tts.py --text "…" --out out/vo/S2.wav [--voice Cherry] [--model …]
  python3 tts.py --probe-voices          # 试哪些音色可用
  python3 tts.py --narration             # 按登记表把 8 句旁白全试一遍并核时间
"""
import argparse
import json
import os
import subprocess
import sys
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
FPS = 24

# 旁白终稿（脚本 §3，已按 2026-10-15 的决定改两处）+ 它在成片里的可用时间窗
# (镜, 文本, 窗口起点, 窗口终点)  —— 窗口已扣掉镜头自身的进出淡入
#   S7  改短：原句自带角色原话，会与 H3 已念出的台词重复 → 只念前半句，原话交给角色
#   S11 改短：32 字念 7.28s，与本镜"最后两秒全静"冲突 → 只念前两行数字
NARRATION = [
    ("S2",   "公元548年冬天。一个人带着八千兵渡过了长江。", 0.6, 7.3),
    ("S3",   "史书上有另一个数字：一千。无论哪个，都少得不像话。", 0.6, 7.3),
    ("S4",   "他叫侯景。北方边镇出身。右脚短，骑马射箭都不是他的长处。", 0.4, 7.5),
    ("S5",   "他向皇帝求娶王、谢家的女儿。", 0.6, 3.4),
    ("S7",   "守将羊侃的儿子被押到城下。", 0.0, 2.6),   # 角色的第一个字实测 2.96s 才起
    ("S9",   "他被关了起来，还照常斋戒、洗手、漱口。病久了，嘴里发苦，要蜂蜜，要不到。", 0.4, 7.75),
    ("S10a", "三年后，侯景兵败。船上陪着他的，是羊侃的第三个儿子。", 0.6, 6.4),
    # S11 改回**四句全读**（用户 2026-10-15 追加）：改用与屏幕四行数字近乎逐字对应的紧句，
    # 32 字 ≈ 5.9s，能塞进 1.2–7.6s；原措辞 44 字要 8.1s，只能靠加长镜头（192f→226f）。
    ("S11",  "八千人渡过长江。一百二十天当了皇帝。十多万人困在台城。两三千人活到城破。", 1.2, 7.6),
]

# 后配补录：S9 镜尾那声「荷，荷」（ASR 证明 H3 那一镜没念出可辨认的语音）
# 用「贺」字强制读 hè hè（荷/贺 同音 hè）；**字幕仍写「荷，荷」**。
TAILS = {
    "S9": ("贺贺。", 8.0),
}

CANDIDATES = ["Cherry", "Ethan", "Serena", "Chelsie", "Dylan", "Ryan", "Peter",
              "Rocky", "Eric", "Li", "Marcus", "Roy", "Sunny", "Kiki", "Elias"]


def synth(text, out: Path, model="qwen3-tts-flash", voice="Cherry", fmt="wav", rate=None,
          language="Chinese"):
    """language_type 必须显式给中文。

    ⚠️ 踩过的坑（用户听出来的）：不写 `language_type` 时，模型会对某些句子**判错语种**——
    "守将羊侃的儿子被押到城下。" 整句被念成日语/含混外语（听起来完全不是中文，
    ASR 也转成假名）。加上 `language_type: "Chinese"` 后，同一句立刻正常
    （实测三条都转成"守将羊侃的儿子被押到城下"）。**所以这里默认强制中文。**
    """
    key = read_key()
    params = {"format": fmt, "language_type": language}
    if rate:
        params["speech_rate"] = rate
    body = json.dumps({
        "model": model,
        "input": {"text": text, "voice": voice},
        "parameters": params,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
    })
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    if d.get("code"):
        raise RuntimeError(f"{d.get('code')}: {d.get('message')}")
    audio = (d.get("output") or {}).get("audio") or {}
    url = audio.get("url")
    if not url:
        raise RuntimeError("响应里没有音频: " + json.dumps(d, ensure_ascii=False)[:300])
    out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r:
        out.write_bytes(r.read())
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(out)], capture_output=True, text=True)
    return out, float(dur.stdout.strip() or 0), d.get("usage", {})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--text")
    p.add_argument("--out")
    p.add_argument("--model", default="qwen3-tts-flash")
    p.add_argument("--voice", default="Cherry")
    p.add_argument("--rate", type=float, default=None,
                   help="speech_rate，>1 更快、<1 更慢（实测有效：0.8→3.85 汉字/秒）")
    p.add_argument("--probe-voices", action="store_true")
    p.add_argument("--narration", action="store_true")
    a = p.parse_args()

    if a.probe_voices:
        for v in CANDIDATES:
            try:
                f, dur, _ = synth("你好。", ROOT / "out" / "vo" / f"_probe_{v}.wav", a.model, v)
                print(f"  {v:<9} OK  {dur:.2f}s")
            except Exception as e:
                print(f"  {v:<9} ✗   {str(e)[:90]}")
        return 0

    if a.narration:
        d = ROOT / "out" / "vo"
        rows = []
        for sid, text, a0, b0 in NARRATION:
            try:
                f, dur, usage = synth(text, d / f"{sid}.wav", a.model, a.voice, rate=a.rate)
                rows.append((sid, text, a0, b0, dur, usage.get("characters")))
            except Exception as e:
                print(f"  {sid}: ✗ {str(e)[:120]}")
        for sid, (text, at) in TAILS.items():
            try:
                f, dur, _ = synth(text, d / f"{sid}_tail.wav", a.model, a.voice, rate=a.rate)
                print(f"  {sid} 镜尾补录「{text}」→ {f.name} {dur:.2f}s（放在镜内 {at}s）")
            except Exception as e:
                print(f"  {sid} 补录: ✗ {str(e)[:120]}")
        print(f"\n{'镜':5s} {'字':>3s} {'窗口':>6s} {'实测':>6s} {'语速':>7s} {'余量':>7s}  判定")
        tot_chars = tot_dur = 0
        for sid, text, a0, b0, dur, ch in rows:
            win = b0 - a0
            n = len(text)
            rate = n / dur if dur else 0
            slack = win - dur
            verdict = "✓" if slack > 0.3 else ("⚠️ 偏紧" if slack > 0 else "❌ 装不下")
            tot_chars += n
            tot_dur += dur
            print(f"{sid:5s} {n:>3d} {win:>6.2f} {dur:>6.2f} {rate:>6.2f}字/s {slack:>+7.2f}  {verdict}")
        if tot_dur:
            print(f"\n旁白合计 {tot_chars} 字 / 实测念完 {tot_dur:.2f}s → 平均 {tot_chars/tot_dur:.2f} 字/秒"
                  f"（脚本假设 3.1，pacing.py 假设 4.2）")
        return 0

    if not a.text or not a.out:
        print(__doc__)
        return 1
    f, dur, usage = synth(a.text, Path(a.out), model=a.model, voice=a.voice)
    chars = len(a.text)
    print(f"{f}  {dur:.2f}s  {chars} 字  {chars/dur:.2f} 字/秒  "
          f"(model={a.model} voice={a.voice} 计费 {usage.get('characters')} 字)")
    return 0


if __name__ == "__main__":
    sys.exit(main())