#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""交付前自动质检：只报事实，不判断好不好看。

用法:
    python qa.py clip.mp4
    python qa.py clips/*.mp4 --json qa.json
    python qa.py clip.mp4 --target 1080x1920 --lufs -16

依赖: ffmpeg / ffprobe 在 PATH 上。
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

FREEZE = re.compile(r"freeze_start:\s*([\d.]+)")
FREEZE_DUR = re.compile(r"freeze_duration:\s*([\d.]+)")
BLACK = re.compile(r"black_start:\s*([\d.]+).*?black_end:\s*([\d.]+)")
PTS = re.compile(r"pts_time:\s*([\d.]+)")
LOUD_JSON = re.compile(r"\{[^{}]*\"input_i\"[^{}]*\}", re.S)
PSNR_AVG = re.compile(r"average:([\d.]+|inf)")


def run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, encoding="utf-8", errors="replace")
    return p.stdout or ""


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json",
               "-show_format", "-show_streams", path])
    try:
        data = json.loads(out)
    except Exception:
        return None
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        return None
    num, den = (v.get("avg_frame_rate") or "0/1").split("/")
    fps = round(float(num) / float(den), 3) if float(den) else 0.0
    info = {
        "duration": round(float(data.get("format", {}).get("duration", 0) or 0), 3),
        "width": v.get("width"),
        "height": v.get("height"),
        "fps": fps,
        "frames": int(v.get("nb_frames") or 0),
        "video_codec": v.get("codec_name"),
        "audio": None,
    }
    if a:
        info["audio"] = {
            "codec": a.get("codec_name"),
            "sample_rate": a.get("sample_rate"),
            "channels": a.get("channels"),
        }
    return info


def loudness(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
               "-af", "loudnorm=I=-16:TP=-1.5:print_format=json", "-f", "null", "-"])
    m = LOUD_JSON.search(out)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
        return {"i": float(d.get("input_i", 0)), "tp": float(d.get("input_tp", 0)),
                "lra": float(d.get("input_lra", 0))}
    except Exception:
        return None


def freezes(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
               "-vf", "freezedetect=n=-60dB:d=0.5", "-map", "0:v:0", "-f", "null", "-"])
    starts = [float(x) for x in FREEZE.findall(out)]
    durs = [float(x) for x in FREEZE_DUR.findall(out)]
    return list(zip(starts, durs))


def blacks(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
               "-vf", "blackdetect=d=0.1:pix_th=0.10", "-f", "null", "-"])
    return [(round(float(a), 2), round(float(b), 2)) for a, b in BLACK.findall(out)]


def cuts(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
               "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"])
    return [round(float(x), 2) for x in PTS.findall(out)]


def _psnr(pair, w, h):
    a, b = pair
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", a, "-i", b,
               "-lavfi",
               "[0:v]scale=%d:%d,setsar=1[x];[1:v]scale=%d:%d,setsar=1[y];[x][y]psnr"
               % (w, h, w, h), "-f", "null", "-"])
    m = PSNR_AVG.search(out)
    if not m:
        return None
    return 99.0 if m.group(1) == "inf" else float(m.group(1))


def bottom_strip(path, out_png, frames=6, band=0.30):
    """把整条片子底部 30% 抽 6 帧拼成 3×2，3 秒看完全片底部有没有字。

    这是**给人眼看的**，不是自动判断。烧录字幕 / 水印 / 平台标都在这一条里；
    自动判"有没有字"不可靠（文字逐句在变，像素差测不出来）。
    """
    cols = 3
    rows = max(1, (frames + cols - 1) // cols)
    out = run(["ffmpeg", "-v", "error", "-y", "-i", path,
               "-vf", ("select='not(mod(n,40))',"
                       "crop=iw:ih*%.2f:0:ih*%.2f,scale=560:-2,tile=%dx%d"
                       % (band, 1 - band, cols, rows)),
               "-fps_mode", "passthrough", "-frames:v", "1", out_png])
    return os.path.exists(out_png) and os.path.getsize(out_png) > 0


def workdir_for(path):
    return os.path.join(os.path.dirname(os.path.abspath(path)) or ".", ".qaframes")


def check(path, target=None, lufs=-16.0, textcheck=False):
    info = probe(path)
    if not info:
        return {"file": path, "error": "ffprobe 读不了这个文件"}

    info["file"] = path
    info["loudness"] = loudness(path)
    info["freezes"] = freezes(path)
    info["blacks"] = blacks(path)
    info["cuts"] = cuts(path)
    if textcheck:
        strip = os.path.splitext(os.path.abspath(path))[0] + "_bottom.png"
        info["bottom_strip"] = strip if bottom_strip(path, strip) else None

    w = []
    if not info["audio"]:
        w.append("没有音轨")
    if info["audio"] and info["audio"]["sample_rate"] not in ("48000", "44100"):
        w.append("采样率 %s，不是 48k/44.1k" % info["audio"]["sample_rate"])
    L = info["loudness"]
    if L:
        if L["tp"] > -1.0:
            w.append("真峰值 %.1f dBTP，过载风险（目标 ≤ -1.5）" % L["tp"])
        if abs(L["i"] - lufs) > 4:
            w.append("集成响度 %.1f LUFS，偏离目标 %.0f" % (L["i"], lufs))
    total_freeze = sum(d for _, d in info["freezes"])
    if total_freeze > 1.0:
        w.append("冻结总时长 %.2fs（>1s）" % total_freeze)
    if target:
        tw, th = [int(x) for x in target.lower().split("x")]
        if (info["width"], info["height"]) != (tw, th):
            w.append("分辨率 %dx%d，目标 %dx%d" % (info["width"], info["height"], tw, th))
    if info["fps"] and abs(info["fps"] - round(info["fps"])) > 0.01:
        w.append("帧率 %.3f 不是整数" % info["fps"])
    if not info["frames"]:
        w.append("nb_frames 读不到（可能是封装问题）")

    info["warnings"] = w
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json", default="")
    ap.add_argument("--target", default="", help="如 1080x1920")
    ap.add_argument("--lufs", type=float, default=-16.0)
    ap.add_argument("--textcheck", action="store_true",
                    help="额外导出一条底部横条图，人眼确认有没有已烧录的字幕")
    args = ap.parse_args()

    results = []
    bad = 0
    for f in args.files:
        r = check(f, args.target or None, args.lufs, args.textcheck)
        results.append(r)
        if "error" in r:
            print("[ERROR] %s: %s" % (f, r["error"]))
            bad += 1
            continue
        L = r.get("loudness") or {}
        print("== %s" % f)
        print("   %dx%d  %.3ffps  %s  %.3fs  %s frames" % (
            r["width"], r["height"], r["fps"], r["video_codec"], r["duration"], r["frames"]))
        if r["audio"]:
            print("   audio: %s %sHz %sch" % (r["audio"]["codec"], r["audio"]["sample_rate"],
                                              r["audio"]["channels"]))
        if L:
            print("   loudness: %.1f LUFS  peak %.1f dBTP  LRA %.1f" % (L["i"], L["tp"], L["lra"]))
        if r["freezes"]:
            print("   freezes: " + ", ".join("%.2fs+%.2fs" % (s, d) for s, d in r["freezes"]))
        if r["blacks"]:
            print("   blacks: " + ", ".join("%.2f-%.2f" % b for b in r["blacks"]))
        print("   cuts(scene>0.3): %d" % len(r["cuts"]))
        if r.get("bottom_strip"):
            print("   底部横条: %s  ← 打开看一眼有没有已经烧进去的字"
                  % r["bottom_strip"])
        for wmsg in r["warnings"]:
            print("   [WARN] " + wmsg)
        if not r["warnings"]:
            print("   [OK]")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(results, fh, ensure_ascii=False, indent=2)
        print("json: %s" % args.json)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
