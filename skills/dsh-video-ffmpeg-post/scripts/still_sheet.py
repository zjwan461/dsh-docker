#!/usr/bin/env python3
"""静帧资产总览图（本地 ffmpeg，不花调用）。

原 `refs/stills/sample_all.png` 是更早一版，S2 还是"空船"那版静帧。
**S2 重做后（E2v3）它就对不上了**，所以这里按"实际进片的那一张"重建一张，
旧图另存为 `sample_all_v1.png` 留档。

用法：python3 tools/still_sheet.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STILLS = ROOT / "refs" / "stills"
FONT = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
CELL_W, CELL_H = 640, 360
COLS = 4
OUT = STILLS / "sample_all.png"

# 实际进片的静帧（与 提示词登记表 §五之三 一致）
SHOTS = [
    ("S1", "E1_1.png"),
    ("S2", "E2v3_1.png"),      # ← 重做：加回船员
    ("S3", "E3_final.png"),
    ("S4", "A4_1.png"),
    ("S5", "T1_1.png"),
    ("S6", "E6_1.png"),
    ("S7", "A7v2_1.png"),
    ("S8a", "A8a_1.png"),
    ("S8b", "A8b_1.png"),
    ("S9", "E9v3_1.png"),
    ("S10a", "T2_1.png"),
    ("S10b", "A10bv2_1.png"),
    ("S11", "E11v2_1.png"),
]


def build(clips, out, cols=COLS, cell=(CELL_W, CELL_H)):
    w, h = cell
    inputs, fc = [], []
    for sid, path in clips:
        inputs += ["-i", str(path)]
    for i, (sid, path) in enumerate(clips):
        chain = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                 f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x101010,setsar=1,"
                 f"drawtext=fontfile='{FONT}':text='{sid}':"
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
    clips = []
    for sid, name in SHOTS:
        p = STILLS / name
        if not p.exists():
            print("  (缺)", name)
            continue
        clips.append((sid, p))
    # 旧图留档（只做一次）
    if OUT.exists() and not (STILLS / "sample_all_v1.png").exists():
        (STILLS / "sample_all_v1.png").write_bytes(OUT.read_bytes())
        print("旧总览已留档 → refs/stills/sample_all_v1.png")
    ok = build(clips, OUT)
    print("→", OUT.relative_to(ROOT), "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())