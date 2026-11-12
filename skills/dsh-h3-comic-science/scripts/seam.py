#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线接缝检测：不连 ComfyUI 也能跑，用来判断两段素材该"直接拼"还是"要修"。

用法:
    python seam.py A.mp4 B.mp4
    python seam.py A.mp4 B.mp4 --frames 13 --workdir .seam
    python seam.py EP01/clips/*.mp4          # 批量，相邻两两检测

判读:
    PSNR >= 33 dB   续接（同一姿态，几乎逐帧对上）
    PSNR 25-33 dB   动作接动作，可接受，但要肉眼看
    PSNR <  25 dB   硬切。硬切不需要修，直接拼即可
    replay=True     B 的开头在复读 A 的结尾 → 没裁重叠，拼起来会"倒回一下"

退出码: 0 正常，1 有需要人工确认的接缝（--strict 时），2 参数/文件错误。
"""
import argparse
import glob
import os
import re
import subprocess
import sys

PSNR_AVG = re.compile(r"average:([\d.]+|inf)")
PSNR_FF = re.compile(r"average:([\d.]+|inf)")
LUMA = re.compile(r"YAVG[=:]([\d.]+)")


def run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, encoding="utf-8", errors="replace")
    return p.stdout or ""


def probe_duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "csv=p=0", path]).strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def extract_last(path, dst):
    run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.20", "-i", path,
         "-update", "1", "-frames:v", "1", dst])
    return os.path.exists(dst)


def extract_first_n(path, pattern, n):
    for f in glob.glob(pattern.replace("%03d", "*")):
        os.remove(f)
    run(["ffmpeg", "-v", "error", "-y", "-i", path, "-frames:v", str(n), pattern])
    return sorted(glob.glob(pattern.replace("%03d", "*")))


def psnr(a, b, w=320, h=320):
    """缩到同一尺寸再比：不同画幅的两条片子本来就不该求 PSNR。"""
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", a, "-i", b,
               "-lavfi",
               "[0:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1[x];"
               "[1:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1[y];"
               "[x][y]psnr" % (w, h, w, h, w, h, w, h),
               "-f", "null", "-"])
    m = PSNR_AVG.search(out)
    if not m:
        return None
    return 99.0 if m.group(1) == "inf" else float(m.group(1))


def luma(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
               "-vf", "signalstats,metadata=print", "-f", "null", "-"])
    m = LUMA.search(out)
    return float(m.group(1)) if m else None


def check(a, b, workdir, frames):
    os.makedirs(workdir, exist_ok=True)
    a_last = os.path.join(workdir, "a_last.png")
    pattern = os.path.join(workdir, "b_%03d.png")

    if not extract_last(a, a_last):
        return {"error": "从 A 抽末帧失败"}
    b_frames = extract_first_n(b, pattern, frames)
    if not b_frames:
        return {"error": "从 B 抽首帧失败"}

    seam = psnr(a_last, b_frames[0])
    # B 的第 k 帧和第 0 帧谁更像 A 的末帧：若 k>0 更像我，说明 B 开头在复读 A 的结尾
    curve = []
    for f in b_frames:
        v = psnr(a_last, f)
        curve.append(v if v is not None else 0.0)
    best_k = max(range(len(curve)), key=lambda i: curve[i])
    replay = best_k > 0 and curve[best_k] > (curve[0] or 0) + 3

    la, lb = luma(a_last), luma(b_frames[0])
    luma_jump = abs(la - lb) if (la is not None and lb is not None) else None

    return {
        "a": a, "b": b,
        "seam_psnr": seam,
        "curve": [round(x, 1) for x in curve],
        "best_offset": best_k,
        "replay": replay,
        "luma_a": round(la, 1) if la is not None else None,
        "luma_b": round(lb, 1) if lb is not None else None,
        "luma_jump": round(luma_jump, 1) if luma_jump is not None else None,
        "dur_a": round(probe_duration(a), 3),
        "dur_b": round(probe_duration(b), 3),
    }


def verdict(r, same_scene=False):
    if "error" in r:
        return "ERROR", [r["error"]]
    notes = []
    p = r["seam_psnr"]
    if p is None:
        kind = "未知"
    elif p >= 33:
        kind = "续接"
    elif p >= 25:
        kind = "动作接动作"
    else:
        kind = "硬切"
    if r["replay"]:
        kind = "复读（需裁重叠）"
        notes.append("B 的第 %d 帧才接上 A（复读约 %d 帧 = %.2fs），直接拼会倒回一下"
                     % (r["best_offset"], r["best_offset"], r["best_offset"] / 24.0))
    if r["luma_jump"] is not None and r["luma_jump"] > 8:
        notes.append("亮度跳变 %.1f（A %.1f → B %.1f），切点会闪一下，用 exposure 对齐或调色"
                     % (r["luma_jump"], r["luma_a"], r["luma_b"]))
    if same_scene and kind == "硬切":
        notes.append("同场次里出现硬切：确认是「该切」而不是「接不上」")
    return kind, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--frames", type=int, default=13, help="从 B 抽多少帧做复读检测")
    ap.add_argument("--workdir", default=".seam", help="中间帧落盘目录（默认当前目录下 .seam）")
    ap.add_argument("--strict", action="store_true", help="有需人工确认的接缝时返回 1")
    ap.add_argument("--same-scene", action="store_true",
                    help="这些镜头属于同一场次要连续：硬切会报警")
    args = ap.parse_args()

    files = args.files
    if len(files) == 1 and ("*" in files[0] or "?" in files[0]):
        files = sorted(glob.glob(files[0]))
    if len(files) < 2:
        print("至少需要两个文件")
        return 2

    pairs = list(zip(files, files[1:]))
    flagged = 0
    for a, b in pairs:
        if not (os.path.exists(a) and os.path.exists(b)):
            print("[ERROR] 找不到 %s 或 %s" % (a, b))
            return 2
        r = check(a, b, args.workdir, args.frames)
        kind, notes = verdict(r, args.same_scene)
        name = "%s → %s" % (os.path.basename(a), os.path.basename(b))
        if "error" in r:
            print("[ERROR] %s: %s" % (name, r["error"]))
            flagged += 1
            continue
        print("== %s" % name)
        print("   seam PSNR %.1f dB → %s   (A %.2fs → B %.2fs)"
              % (r["seam_psnr"] or 0.0, kind, r["dur_a"], r["dur_b"]))
        print("   B 前 %d 帧与 A 末帧的相似度: %s" % (len(r["curve"]), r["curve"]))
        if r["luma_a"] is not None:
            print("   亮度 A %.1f → B %.1f（差 %.1f）" % (r["luma_a"], r["luma_b"], r["luma_jump"]))
        if notes:
            flagged += 1
            for n in notes:
                print("   [WARN] " + n)
        else:
            print("   [OK] 这个接缝不需要额外处理")

    if args.strict and flagged:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())