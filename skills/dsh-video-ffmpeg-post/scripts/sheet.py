#!/usr/bin/env python3
"""分镜对照表 / 一致性对照表（本地 ffmpeg，不花 GPU、不依赖插件）。

两个用途：
  1. 看节奏——一眼看完整条片子的镜头分配
  2. **看一致性**——把同一角色的每次出现排在一起，漂没漂一眼就能看出来

用 Noto Serif CJK 烧上镜头编号（本机有 143 个字体，含思源宋体）。

用法：
  python3 tools/sheet.py --clips out/sample --out sheet_sample.png
  python3 tools/sheet.py --clips out/sample --only S4,S5,S8b,S10a --out sheet_hou.png
"""
import argparse
import subprocess
import sys
from pathlib import Path

FONT = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
CELL_W, CELL_H = 640, 360
COLS = 4


def mid_time(clip: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(clip)], capture_output=True, text=True)
    try:
        return max(0.2, float(r.stdout.strip()) * 0.5)
    except ValueError:
        return 0.5


def build(clips, out, cols=COLS, cell=(CELL_W, CELL_H), at=None, label=True):
    w, h = cell
    inputs, fc = [], []
    for i, (sid, path) in enumerate(clips):
        t = at if at is not None else mid_time(path)
        inputs += ["-ss", f"{t:.3f}", "-i", str(path)]
    for i, (sid, path) in enumerate(clips):
        chain = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                 f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x101010,setsar=1")
        if label:
            txt = sid.replace("'", "")
            chain += (f",drawtext=fontfile='{FONT}':text='{txt}':"
                      f"x=14:y=12:fontsize=34:fontcolor=white:"
                      f"box=1:boxcolor=black@0.55:boxborderw=10")
        fc.append(f"[{i}:v]{chain}[v{i}]")
    n = len(clips)
    rows = (n + cols - 1) // cols
    for j in range(n, cols * rows):
        fc.append(f"color=c=0x101010:s={w}x{h}[v{j}]")
    layout = []
    for j in range(cols * rows):
        c, r = j % cols, j // cols
        x = "0" if c == 0 else "+".join(f"w{k}" for k in range(c))
        y = "0" if r == 0 else "+".join(f"h{k*cols}" for k in range(r))
        layout.append(f"{x}_{y}")
    fc.append("".join(f"[v{j}]" for j in range(cols * rows))
              + f"xstack=inputs={cols*rows}:layout=" + "|".join(layout) + "[out]")
    cmd = ["ffmpeg", "-y", "-loglevel", "error"] + inputs + \
          ["-filter_complex", ";".join(fc), "-map", "[out]", "-frames:v", "1", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        return False
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--clips", default="out/sample")
    p.add_argument("--only", default="")
    p.add_argument("--out", default="sheet.png")
    p.add_argument("--at", type=float, default=None, help="统一取第几秒的帧（默认各取中点）")
    p.add_argument("--cols", type=int, default=COLS)
    a = p.parse_args()

    d = Path(a.clips)
    order = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8a", "S8b", "S9",
             "S10a", "S10b", "S11"]
    want = [s for s in a.only.split(",") if s] or order
    found = []
    for sid in want:
        hits = sorted(d.glob(f"*{sid}_*.mp4")) or sorted(d.glob(f"{sid}*.mp4"))
        if hits:
            found.append((sid, hits[0]))
        else:
            print(f"  (缺 {sid})")
    if not found:
        print("没有可用片段")
        return 1
    print("纳入", len(found), "条:", ", ".join(s for s, _ in found))
    ok = build(found, a.out, cols=a.cols, at=a.at)
    if ok:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v",
                            "-show_entries", "stream=width,height", "-of", "csv=p=0",
                            str(a.out)], capture_output=True, text=True)
        print("→", a.out, r.stdout.strip())
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())