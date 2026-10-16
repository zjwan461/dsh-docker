#!/usr/bin/env python3
"""全片统一调色（本地 ffmpeg，免费、不占 GPU）。

为什么需要：t2v/i2v 逐条生成，色调会有漂移。实测 S7（羊侃射子）明显偏暖橙，
S2/S3/S11 三条薄雾水面观感过近。统一调色解决两件事——**把全片拉回冷青灰**，**把相近的镜头分开**。

设计目标（对应设计案 §3.2）：冷青灰为主，**只保留一处暖色**；胶片感，不要 HDR 糖水。

分两层：
  GLOBAL  对所有镜头施加，保证质感同源
  EXTRA   只对个别镜头施加，修正离群与"撞脸"

用法：
  python3 tools/grade.py                 # 全部
  python3 tools/grade.py S7 S11          # 指定镜头
"""
import subprocess
import sys
import glob
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "out" / "sample"
TALK = ROOT / "out" / "talk"
DST = ROOT / "out" / "graded"

# 有对白的 6 个镜头：优先取 out/talk/ 里的对白重做版（官方三字段格式 + <d> 标签）
TALK_SHOTS = {"S5", "S7", "S8a", "S8b", "S9", "S10b"}

# ── 全局：轻微去饱和 + 胶片 S 曲线 + 阴影偏冷、高光微暖 ──────────────
GLOBAL = (
    "curves=all='0/0 0.25/0.23 0.5/0.5 0.75/0.77 1/1',"
    "eq=saturation=0.93,"
    "colorbalance=rs=-0.02:bs=0.025:rm=-0.01:bm=0.012:rh=0.008:bh=-0.012"
)

# ── 个别修正 ────────────────────────────────────────────────────
EXTRA = {
    # 羊侃射子：原始偏暖橙（火光+暖天光），重压暖色，只留远处一点火
    "S7": "eq=saturation=0.80,colorbalance=rs=-0.05:bs=0.06:rm=-0.07:bm=0.07:rh=-0.05:bh=0.04",
    # 收尾空江：本来是明亮晨雾，压暗压冷，与 S2/S3 拉开距离
    "S11": "eq=brightness=-0.035:contrast=1.07:saturation=0.82,colorbalance=rs=-0.02:bs=0.05:bm=0.045",
    # 采石矶：提对比，让石矶读得出来
    "S3": "eq=contrast=1.07:saturation=0.93",
}

ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8a", "S8b", "S9",
         "S10a", "S10b", "S11"]


def find(sid):
    # 对白镜头优先用 out/talk/ 的重做版；其余用 out/sample/
    # 同名镜头有多个版本（如 S2 / S2v3、S7 / S7v2）时，取**修改时间最新**的那个，
    # 这样重做一镜（新文件名带 v3）不必再手改这里。
    dirs = [TALK, SRC] if sid in TALK_SHOTS else [SRC]
    hits = []
    for d in dirs:
        if not d.is_dir():
            continue
        for pat in (f"*_{sid}v*_*.mp4", f"*_{sid}_*.mp4"):
            hits += list(d.glob(pat))
    if not hits:
        return None
    return max(hits, key=lambda p: p.stat().st_mtime)


def grade_one(sid, src):
    dst = DST / f"{sid}.mp4"
    chain = GLOBAL + ("," + EXTRA[sid] if sid in EXTRA else "")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
           "-vf", chain, "-c:v", "libx264", "-crf", "16", "-preset", "medium",
           "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None, r.stderr[-600:]
    return dst, ""


def main():
    want = sys.argv[1:] or ORDER
    DST.mkdir(parents=True, exist_ok=True)
    done = 0
    for sid in want:
        if sid not in ORDER:
            print("未知镜头", sid)
            continue
        src = find(sid)
        if not src:
            print(f"[{sid}] 源缺失，跳过")
            continue
        d, err = grade_one(sid, src)
        if d:
            size = d.stat().st_size / 1e6
            extra = " (+个别修正)" if sid in EXTRA else ""
            print(f"[{sid}] ✓ {d.name} {size:.2f} MB{extra}")
            done += 1
        else:
            print(f"[{sid}] ✗ {err}")
    print(f"\n完成 {done}/{len(want)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())