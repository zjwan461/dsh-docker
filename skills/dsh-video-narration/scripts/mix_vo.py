#!/usr/bin/env python3
"""旁白试混：把 TTS 旁白按实测时间线混进成片（本地 ffmpeg，不占 GPU）。

只读不写原交付：产出 `out/film_vo_scratch.mp4`，`film_subbed/bare/vertical` 一个字不动。
画面**直接 copy** `film_subbed.mp4`（含字幕，方便你对照"听到的"和"读到的"），
只重做音轨。

做四件事：
  1. **逐句卡点**：TTS 时长波动极大（同一句实测 2.2–5.6s），所以先量时长，
     超出窗口就再取几条留最短（`--takes`），仍超就 atempo 压进窗口（上限 1.3，保音高）。
  2. **逐镜响度对齐**：成片内实测落差 17.8dB（S3 -31.0 / S10a -29.6 / S11 -27.4
     vs 中位 -14.8），不补的话旁白会飘在真空里。抬这三镜，但**仍比其余低 3–7dB**，保住"空"。
  3. **闪避**：旁白一起，环境用 sidechaincompress 压下去（不是硬切）。
  4. 全片过 loudnorm I=-16/TP=-1.5，与其它交付版一致。

用法：
  python3 tools/mix_vo.py                # 默认 Ethan
  python3 tools/mix_vo.py --voice Rocky  # 换音色重出一版
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from finish import ORDER                       # noqa: E402
import tts as T                                # noqa: E402

GRADED = ROOT / "out" / "graded"
RAW = ROOT / "out" / "film_raw.mp4"
SUBBED = ROOT / "out" / "film_subbed.mp4"
VO = ROOT / "out" / "vo"
TMP = ROOT / "out" / "_vo_tmp"
OUT = ROOT / "out" / "film_vo_scratch.mp4"

# 逐镜**环境底**的目标响度（LUFS）。旁白轨约 -16，所以底压在 -20 左右时，
# 人声比环境高约 4dB，再加闪避 ≈10dB，正好是纪录片旁白该有的距离感。
# 三个"空"镜故意低一档，但也没低到真空里（原片 raw 里 S3 是 -45，比中位低 27dB）。
TARGET_BED = {
    "S1": -20, "S2": -20, "S3": -24, "S4": -20, "S5": -20, "S6": -20, "S7": -20,
    "S8a": -20, "S8b": -20, "S9": -20, "S10a": -24, "S10b": -20, "S11": -26,
}
ATEMPO_CAP = 1.30

# 这些条目走"自然语速 + atempo"，不走 TTS 加速重取（重取容易变成急促音）
NO_RETAKE = {"S11"}

# 特殊放置：旁白跨剪辑点。现在**空着**——S7 那句原本因为 TTS 判错语种被念成外语，
# 只好用慢速版跨切点；显式指定 `language_type: "Chinese"` 后默认语速只要 2.40s，
# 塞回 S7 自己的窗口（0–2.6s）即可。机制留着备用。
OVERRIDE = {}

# 每条旁白的文本（重取时要用）
TEXT = {sid: text for sid, text, _, _ in T.NARRATION}


def run(cmd, label=None):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"✗ {label or cmd[0]}\n{r.stderr[-1200:]}")
        return False
    if label:
        print(f"✓ {label}")
    return True


def dur(p) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(p)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def offsets():
    off, acc = {}, 0.0
    for sid in ORDER:
        off[sid] = acc
        acc += dur(GRADED / f"{sid}.mp4")
    return off, acc


def fit(sid, wav: Path, window: float, voice: str, takes: int):
    """把一条旁白压进 window 秒：多取几条留最短，仍超窗口再 atempo（保音高）。

    ⚠️ **不做 ASR 验收**（2026-10-15 用户指出）：ASR 对这种短句/文言会整段幻觉——
       实测把清晰、慢速的合成音听成日语，甚至阿姆哈拉语，把"守将羊侃"猜成"首相李克强"。
       它能证明的只有"听不懂"，不能证明"念错了"。**音色与清晰度只能由人耳判断。**
       所以这里只量时长；听感问题靠听，必要时重取（用户点名 S7 那条就是听出来的）。
    """
    d = dur(wav)
    how = "原样"
    for i in range(takes):
        if d <= window:
            break
        alt = wav.with_name(wav.stem + f"_take{i}.wav")
        try:
            T.synth(TEXT[sid], alt, voice=voice, rate=1.2)
        except Exception:
            break
        if 0 < dur(alt) < d:
            alt.replace(wav)
            d, how = dur(wav), f"重取{i}"
    if d > window:
        tempo = min(ATEMPO_CAP, d / window)
        out = wav.with_name(wav.stem + "_fit.wav")
        if run(["ffmpeg", "-y", "-v", "error", "-i", str(wav),
                "-filter:a", f"atempo={tempo:.3f}", str(out)], None):
            how = f"{how} + atempo {tempo:.2f}"
            wav, d = out, dur(out)
    return wav, d, how


def measure_i(path) -> float:
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(path), "-af", "ebur128",
                        "-f", "null", "-"], capture_output=True, text=True)
    m = re.findall(r"I:\s+(-?\d+\.\d+)\s+LUFS", r.stderr)
    return float(m[-1]) if m else float("nan")


def prep_piece(src: Path, dst: Path, target=-16.0):
    """统一成 48k 立体声，并**用实测值加固定增益**对齐到 target。

    ⚠️ 不要在这里用 `loudnorm` 单遍：对 2–3 秒的短句它不可靠——实测把 S7 那条
    从 -25.2 反而压到 -32.8（压小了 7.6dB，在片子里就明显偏轻）。
    短音频的积分门限容易被首尾静音带偏，所以这里改成"先量、再加常数"。
    """
    i = measure_i(src)
    gain = 0.0 if i != i else max(-24.0, min(24.0, target - i))   # NaN 保护
    return run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
                "-af", f"volume={gain:.2f}dB,aformat=sample_rates=48000:channel_layouts=stereo",
                "-c:a", "pcm_s16le", str(dst)], None), gain


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="Ethan")
    ap.add_argument("--takes", type=int, default=4)
    a = ap.parse_args()
    TMP.mkdir(parents=True, exist_ok=True)
    off, total = offsets()
    print(f"时间线合计 {total:.3f}s\n")

    pieces = []      # (abs_start, path)
    print(f"{'镜':5s} {'窗口':>6s} {'时长':>6s} {'入点':>8s}  处理")
    for sid, text, a0, b0 in T.NARRATION:
        wav = VO / f"{sid}.wav"
        if not wav.exists():
            print(f"{sid:5s} 缺 {wav}，跳过")
            continue
        ov = OVERRIDE.get(sid)
        win = ov["window"] if ov else (b0 - a0)
        # OVERRIDE 的条目是人工选定的音（慢速清晰版），不许再"重取最短"，只许 atempo
        n_takes = 0 if (ov or sid in NO_RETAKE) else a.takes
        wav, d, how = fit(sid, wav, win, a.voice, n_takes)
        start = (off[ov["host"]] + ov["at"]) if ov else (off[sid] + a0)
        if ov:
            how += f"（跨切点：{ov['host']} +{ov['at']}s 起）"
        out = TMP / f"vo_{sid}.wav"
        okp, gain = prep_piece(wav, out)
        if okp:
            pieces.append((start, out))
        print(f"{sid:5s} {win:>6.2f} {d:>6.2f} {start:>8.2f}  {how}"
              + (f"  [对齐 {gain:+.1f}dB]" if okp else "  ✗"))

    for sid, (text, at) in T.TAILS.items():
        wav = VO / f"{sid}_tail.wav"
        if not wav.exists():
            continue
        # 镜尾补录的可用窗口＝从入点到该镜切点（留 0.08s 余量），超了就 atempo
        room = max(0.3, dur(GRADED / f"{sid}.mp4") - at - 0.08)
        wav, d, how = fit(sid, wav, room, a.voice, 0)
        print(f"{sid} 镜尾「{text}」{d:.2f}s（可用 {room:.2f}s）{how}")
        start = off[sid] + at
        out = TMP / f"vo_{sid}_tail.wav"
        if prep_piece(wav, out):
            pieces.append((start, out))

    # ── 旁白轨：各自 adelay 后相加 ──────────────────────────────
    ins, fc = [], []
    for i, (start, path) in enumerate(pieces):
        ins += ["-i", str(path)]
        ms = int(round(start * 1000))
        fc.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
    fc.append("".join(f"[a{i}]" for i in range(len(pieces)))
              + f"amix=inputs={len(pieces)}:normalize=0:dropout_transition=0[mixed]")
    fc.append(f"[mixed]apad,atrim=0:{total:.3f},aformat=sample_rates=48000:channel_layouts=stereo[vo]")
    vo_track = TMP / "vo_track.wav"
    ok = run(["ffmpeg", "-y", "-v", "error"] + ins +
             ["-filter_complex", ";".join(fc), "-map", "[vo]",
              "-c:a", "pcm_s16le", str(vo_track)], "旁白轨")
    if not ok:
        return 1

    # ── 混音：逐镜音量 → 闪避 → 相加 → loudnorm ────────────────
    # 增益**实测**得出：量 film_raw 每镜的 LUFS，再按 TARGET_BED 算要加多少 dB。
    # 这一步不能拍脑袋——raw 里每镜落差 27dB（S3 -45.0 / S6 -18.5），旁白压上去必然一边贴脸一边真空。
    print("\n逐镜环境底对齐（量 film_raw → 按目标算增益）：")
    gains, lufs_raw = {}, {}
    for sid in ORDER:
        s0 = off[sid]
        s1 = off[sid] + dur(GRADED / f"{sid}.mp4")
        r = subprocess.run(["ffmpeg", "-v", "info", "-ss", f"{s0:.3f}", "-t", f"{s1-s0:.3f}",
                            "-i", str(RAW), "-af", "ebur128", "-f", "null", "-"],
                           capture_output=True, text=True)
        m = re.findall(r"I:\s+(-?\d+\.\d+)\s+LUFS", r.stderr)
        raw = float(m[-1]) if m else float("nan")
        g = TARGET_BED[sid] - raw
        gains[sid], lufs_raw[sid] = g, raw
        flag = "  ← 封顶" if g > 21 else ""
        print(f"  {sid:5s} 实测 {raw:>7.1f} → 目标 {TARGET_BED[sid]:>4d}  增益 {g:>+6.1f} dB"
              + ("  ← 封顶 21dB" if g > 21 else flag))

    chain = ["aformat=sample_rates=48000:channel_layouts=stereo"]
    for sid in ORDER:
        g = min(gains[sid], 21.0)
        if abs(g) < 0.2:
            continue
        s0, s1 = off[sid], off[sid] + dur(GRADED / f"{sid}.mp4")
        chain.append(f"volume=volume={g:.2f}dB:enable='between(t,{s0:.3f},{s1:.3f})'")
    bed = ",".join(chain)
    graph = (
        f"[0:a]{bed}[bed];"
        f"[bed][1:a]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=500[duck];"
        f"[duck][1:a]amix=inputs=2:normalize=0:weights=1 1[premix];"
        f"[premix]atrim=0:{total:.3f}[premixout]"
    )
    premix = TMP / "premix.wav"
    ok = run(["ffmpeg", "-y", "-v", "error", "-i", str(RAW), "-i", str(vo_track),
              "-filter_complex", graph, "-map", "[premixout]",
              "-c:a", "pcm_s16le", str(premix)], "预混（逐镜音量 + 闪避）")
    if not ok:
        return 1

    # ── loudnorm 用**两遍线性**：单遍是动态的，会把上面刚对齐的逐镜关系又揉回去 ──
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(premix), "-af",
                        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    try:
        js = json.loads(r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1])
    except ValueError:
        print("✗ loudnorm 测量失败\n" + r.stderr[-800:])
        return 1
    af = ("loudnorm=I=-16:TP=-1.5:LRA=11:"
          f"measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:"
          f"offset={js['target_offset']}:linear=true")
    print(f"✓ loudnorm 测量：I={js['input_i']} TP={js['input_tp']} LRA={js['input_lra']}"
          f" → 线性施加（offset {js['target_offset']}）")
    # 线性 loudnorm 只加常数增益、**不做峰值限制**，实测会冲到 -0.9dBFS（规格要求 ≤-1.5），
    # 所以在后面挂一级限幅兜底。
    # ⚠️ alimiter 的 limit 是**线性值**（-1.5dBFS → 0.84），而且默认 level=true 会把整体
    # 电平自动顶上去（实测集成响度被推到 -14.6、峰值 0.1）。必须显式 level=disabled。
    af = af + ",alimiter=limit=0.76:level=disabled:attack=5:release=50"
    ok = run(["ffmpeg", "-y", "-v", "error", "-i", str(premix), "-i", str(SUBBED),
              "-af", af, "-map", "0:a", "-map", "1:v", "-c:v", "copy",
              "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
              str(OUT)], f"试混 → {OUT.name}")
    if not ok:
        return 1

    # ── QC：每镜响度 + 峰值 ───────────────────────────────────
    print("\nQC（成片内每镜响度）：")
    rows = []
    for sid in ORDER:
        s0, s1 = off[sid], off[sid] + dur(GRADED / f"{sid}.mp4")
        r = subprocess.run(["ffmpeg", "-v", "info", "-ss", f"{s0:.3f}", "-t", f"{s1-s0:.3f}",
                            "-i", str(OUT), "-af", "ebur128", "-f", "null", "-"],
                           capture_output=True, text=True)
        m = re.findall(r"I:\s+(-?\d+\.\d+)\s+LUFS", r.stderr)
        rows.append((sid, float(m[-1]) if m else float("nan")))
    for sid, v in rows:
        bedv = lufs_raw[sid] + min(gains[sid], 21.0)
        print(f"  {sid:5s} 混完 {v:>7.1f} LUFS   底 {bedv:>7.1f}（原 {lufs_raw[sid]:>6.1f}）")
    vals = [v for _, v in rows]
    beds = [lufs_raw[s] + min(gains[s], 21.0) for s in ORDER]
    print(f"  混完落差 {max(vals)-min(vals):.1f} dB · 环境底落差 "
          f"{max(beds)-min(beds):.1f} dB（原片底 27.0 dB）· 总长 {dur(OUT):.2f}s")
    print(f"  文件 {OUT.relative_to(ROOT)}  {OUT.stat().st_size/1e6:.1f} MB")
    (TMP / "plan.json").write_text(json.dumps(
        {"voice": a.voice, "shots": [{"sid": s, "lufs": v} for s, v in rows],
         "vo": [{"start": st, "file": p.name} for st, p in pieces]},
        ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())