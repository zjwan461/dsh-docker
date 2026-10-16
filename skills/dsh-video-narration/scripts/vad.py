#!/usr/bin/env python3
"""语音活动定位（纯 Python，无 numpy）——找出"这一镜里人到底在第几秒说话"。

为什么需要：旁白要和 H3 已经念出来的台词**错开**，否则两条人声会打架。
这台机器上没有耳朵，所以只能从信号上定位：在 0.25s 的窗口上算 RMS 与过零率，
以"本片的噪声底"为基准，把明显高于底噪、且高频含量偏高的窗口标成语音候选。

用法：
  python3 tools/vad.py out/graded/S7.mp4                    # 单条：给时间线
  python3 tools/vad.py out/talk/talk_S7_00001_.mp4 out/sample/sample_S7_00001_.mp4
                                                            # 两条：对有台词/无台词做差
输出每 0.25s 一格：`.` 静 `-` 底噪 `#` 语音候选，另附候选区间（秒）。
"""
import array
import math
import subprocess
import sys
from pathlib import Path

SR = 8000
WIN = 0.25          # 窗口长度（秒）
FLOOR_PCT = 0.25    # 噪声底取分位数
HI = 2.2            # 高于底噪多少倍算"有东西"
ZCR_HI = 1.15       # 过零率高于中位数多少倍算"偏高频（擦音/齿音）"


def pcm(path):
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR),
         "-f", "s16le", "-"], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-400:])
    a = array.array("h")
    a.frombytes(r.stdout)
    return a


def frames(samples):
    n = int(WIN * SR)
    out = []
    for i in range(0, len(samples) - n + 1, n):
        seg = samples[i:i + n]
        s = 0
        for v in seg:
            s += v * v
        rms = math.sqrt(s / n) / 32768.0
        c = 0
        prev = seg[0]
        for v in seg[1:]:
            if (v >= 0) != (prev >= 0):
                c += 1
            prev = v
        out.append((rms, c / n))
    return out


def quantile(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[min(len(s) - 1, max(0, int(p * len(s))))]


def label(fr):
    floors = quantile([r for r, _ in fr], FLOOR_PCT)
    zmed = quantile([z for _, z in fr], 0.5) or 1e-9
    marks, hot = [], []
    for r, z in fr:
        if r < floors * 1.35:
            marks.append(".")
        elif r > floors * HI and z > zmed * ZCR_HI:
            marks.append("#")
            hot.append(True)
        elif r > floors * HI:
            marks.append("+")
            hot.append(False)
        else:
            marks.append("-")
            hot.append(False)
    return "".join(marks), hot, floors, zmed


def spans(hot):
    out, start = [], None
    for i, h in enumerate(hot):
        if h and start is None:
            start = i
        elif not h and start is not None:
            out.append((start * WIN, i * WIN))
            start = None
    if start is not None:
        out.append((start * WIN, len(hot) * WIN))
    # 合并间隔小于 0.5s 的段
    merged = []
    for a, b in out:
        if merged and a - merged[-1][1] <= 0.5:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return [(round(a, 2), round(b, 2)) for a, b in merged if b - a >= 0.25]


def main():
    files = sys.argv[1:]
    if not files:
        print(__doc__)
        return 1
    rows = []
    for f in files:
        fr = frames(pcm(f))
        marks, hot, floors, zmed = label(fr)
        rows.append((f, fr, marks, hot, floors, zmed))
        print(f"\n{f}")
        print(f"  噪声底 {floors:.5f} · 过零中位 {zmed:.4f} · 时长 {len(fr)*WIN:.2f}s")
        print(f"  每格 {WIN}s： {marks}")
        sp = spans(hot)
        print(f"  语音候选（合并≥0.25s）： {sp if sp else '无'}")

    if len(rows) == 2:
        (fa, ra, _, _, _, _), (fb, rb, _, _, _, _) = (rows[0], rows[1])
        n = min(len(ra), len(rb))
        print(f"\n差值（{Path(fa).name} − {Path(fb).name}）：")
        marks = []
        for i in range(n):
            da = ra[i][0] - rb[i][0]
            db = ra[i][1] - rb[i][1]
            marks.append("#" if (da > 0.004 and db > 0.01) else
                         ("+" if da > 0.004 else "."))
        print(f"  每格 {WIN}s： {''.join(marks)}")
        hot = [m == "#" for m in marks]
        print(f"  差值语音候选： {spans(hot) if spans(hot) else '无'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())