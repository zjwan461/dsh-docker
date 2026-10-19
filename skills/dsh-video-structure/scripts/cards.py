#!/usr/bin/env python3
"""片头/片尾卡：黑屏提问卡、定格尾卡、以及"一层 ASS 装完所有字幕层"的合成器。

为什么要有这个脚本：片头片尾的坑都很隐蔽——
  * 黑屏卡用 lavfi 一起造，音轨会被 -frames:v 截短（5.17s 画面配 2.24s 音频）；
  * 标题卡写死绝对秒，一加片头就落到黑屏上；
  * 总结字幕和 CTA 各自按 total-x 定位，会在同一块屏幕上叠住；
  * 串两个 subtitles= 滤镜直接报错。
这个脚本把四件事都固化成正确的写法。

用法：
  python3 cards.py black   --dur 5.1667 --size 768x1344 --out S00.mp4
  python3 cards.py endcard --from S15.mp4 --dur 2.5 --fade 0.75 --out S16.mp4
  python3 cards.py ass     --spec structure.json --total 86.17 --out overlay.ass
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

FONT_SANS = "Noto Sans CJK SC"
FONT_SERIF = "Noto Serif CJK SC"

STYLES = """
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Q,{sans},92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,6.0,0,1,5.0,2.5,5,70,70,0,1
Style: T1,{serif},128,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,6.0,0,1,5,3,8,60,60,170,1
Style: T2,{sans},54,&H00E8C87A,&H00E8C87A,&H00000000,&H80000000,1,0,0,0,100,100,4.0,0,1,4,2,8,60,60,340,1
Style: Sub,{sans},62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,1.0,0,1,4.0,2.0,2,60,60,400,1
Style: CTA,{sans},52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,1.0,0,1,4,2,2,60,60,430,1
""".format(sans=FONT_SANS, serif=FONT_SERIF)

EVENTS_HEAD = """
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("FAILED: " + " ".join(cmd) + "\n" + r.stderr[-2500:])
    return r.stdout


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0


def ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


# ---------------------------------------------------------------- 黑屏卡
def cmd_black(a):
    w, h = a.size.lower().split("x")
    frames = int(round(a.dur * a.fps))
    v = "/tmp/_card_v.mp4"; au = "/tmp/_card_a.m4a"
    # 画面与音频**分开生成**：一起生成时 -frames:v 一到上限整个输出就结束，音轨被截断
    run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color={a.color}:s={w}x{h}:r={a.fps}",
         "-frames:v", str(frames), "-c:v", "libx264", "-preset", "medium", "-crf", str(a.crf),
         "-pix_fmt", "yuv420p", v])
    run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
         "-t", f"{frames / a.fps:.4f}", "-c:a", "aac", "-b:a", "192k", au])
    run(["ffmpeg", "-v", "error", "-y", "-i", v, "-i", au, "-c", "copy", "-shortest", a.out])
    vd, ad = duration(a.out), None
    probe = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
                 "-of", "csv=p=0", a.out]).strip().splitlines()
    ad = float(probe[1].split(",")[1]) if len(probe) > 1 else vd
    print(f"{a.out}  video={vd:.3f}s audio={ad:.3f}s  delta={abs(vd-ad)*1000:.0f}ms")
    if abs(vd - ad) > 0.05:
        raise SystemExit("音画不等长——检查 lavfi 生成方式")


# ---------------------------------------------------------------- 定格尾卡
def cmd_endcard(a):
    src = a.src
    last = "/tmp/_last.png"
    run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.12", "-i", src, "-frames:v", "1", last])
    frames = int(round(a.dur * a.fps))
    fade_st = max(a.dur - a.fade, 0)
    v = "/tmp/_ec_v.mp4"; au = "/tmp/_ec_a.m4a"
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", last, "-t", f"{a.dur}", "-r", str(a.fps),
         "-vf", f"scale={a.size.replace('x', ':')},fade=t=out:st={fade_st:.2f}:d={a.fade}",
         "-frames:v", str(frames), "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf),
         "-pix_fmt", "yuv420p", v])
    run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
         "-t", f"{a.dur:.4f}", "-c:a", "aac", "-b:a", "192k", au])
    run(["ffmpeg", "-v", "error", "-y", "-i", v, "-i", au, "-c", "copy", "-shortest", a.out])
    print(f"{a.out}  {a.dur:.2f}s / {frames} frames (fade {fade_st:.2f}+{a.fade})")


# ---------------------------------------------------------------- ASS 合成
def build_ass(spec, total, out):
    W, H = spec.get("size", [1080, 1920])
    head = (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\n"
            f"WrapStyle: 2\nScaledBorderAndShadow: yes\n" + STYLES + EVENTS_HEAD)
    L = [head]
    segs = spec["segments"]

    # 标题卡锚到"第一个实拍镜头"的起点，而不是绝对秒——加片头后绝对秒会落到黑屏上
    first_clip = next((s for s in segs if s.get("kind", "clip") == "clip"), None)
    if first_clip is not None:
        t1 = float(first_clip["start"])
        ttl = spec.get("title") or {}
        if spec.get("auto_title", True) and ttl.get("main"):
            L.append(f"Dialogue: 0,{ts(t1+0.40)},{ts(t1+3.60)},T1,,0,0,0,,{{\\fad(350,450)}}{ttl['main']}\n")
            if ttl.get("sub"):
                L.append(f"Dialogue: 0,{ts(t1+0.75)},{ts(t1+3.60)},T2,,0,0,0,,{{\\fad(350,450)}}{ttl['sub']}\n")

    for seg in segs:
        kind = seg.get("kind", "clip")
        start = float(seg["start"]); dur = float(seg["dur"])
        if kind == "question":
            txt = "\\N".join(seg["lines"])
            pos = seg.get("pos", [W // 2, int(H * 0.46)])
            L.append(f"Dialogue: 0,{ts(start+0.15)},{ts(start+dur-0.05)},Q,,0,0,0,,"
                     f"{{\\pos({pos[0]},{pos[1]})\\fad(450,350)}}{txt}\n")
            continue
        if kind == "silent":
            continue
        cues = seg.get("cues") or []
        if not cues:
            continue
        span = float(seg.get("vo_dur") or dur)          # 字幕跟着实测人声走
        weights = [sum(len(x) for x in c) for c in cues]
        wsum = sum(weights) or 1
        t = start + (0.15 if seg.get("vo_dur") else 0.0)
        for c, w in zip(cues, weights):
            d = span * w / wsum
            txt = "\\N".join(c)          # 反斜杠不能出现在 f-string 的表达式里
            L.append(f"Dialogue: 0,{ts(t)},{ts(t+d)},Sub,,0,0,0,,{txt}\n")
            t += d

    # CTA 独占片尾最后几秒——不要和总结字幕抢同一块屏
    cta = spec.get("cta")
    if cta:
        last = float(cta.get("last", 2.45))
        L.append(f"Dialogue: 0,{ts(total-last)},{ts(total-0.25)},CTA,,0,0,0,,"
                 f"{{\\fad(450,350)}}{cta['text']}\n")

    Path(out).write_text("".join(L), encoding="utf-8")
    print(f"{out}  {len([x for x in L if x.startswith('Dialogue')])} 条事件")
    return out


def cmd_ass(a):
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    total = a.total if a.total else sum(float(s["dur"]) for s in spec["segments"])
    return build_ass(spec, total, a.out)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("black", help="造黑屏卡（音画等长）")
    b.add_argument("--dur", type=float, required=True)
    b.add_argument("--size", default="768x1344")
    b.add_argument("--fps", type=float, default=24)
    b.add_argument("--color", default="black")
    b.add_argument("--crf", type=int, default=18)
    b.add_argument("--out", required=True)
    b.set_defaults(func=cmd_black)

    e = sub.add_parser("endcard", help="从末帧造定格淡出卡")
    e.add_argument("--from", dest="src", required=True)
    e.add_argument("--dur", type=float, default=2.5)
    e.add_argument("--fade", type=float, default=0.75)
    e.add_argument("--size", default="768x1344")
    e.add_argument("--fps", type=float, default=24)
    e.add_argument("--crf", type=int, default=17)
    e.add_argument("--out", required=True)
    e.set_defaults(func=cmd_endcard)

    s = sub.add_parser("ass", help="从结构 JSON 生成整层 ASS")
    s.add_argument("--spec", required=True)
    s.add_argument("--total", type=float, default=None)
    s.add_argument("--out", required=True)
    s.set_defaults(func=cmd_ass)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
