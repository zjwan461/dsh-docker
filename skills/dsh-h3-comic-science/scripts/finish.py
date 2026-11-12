#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地成片装配：合片 → 统一画幅 → 响度 → 字幕 → 封面 → 缩略图。

不依赖 ComfyUI，纯粹用 ffmpeg。用来替代坏掉的 h3_post，或当作离线复检。

用法:
    # 三段直接拼成竖屏成片，统一响度，出封面和分镜图
    python finish.py --out final.mp4 --clips a.mp4 b.mp4 c.mp4 --aspect 9:16 --poster --sheet

    # 从分镜.json 自动生成字幕（按 17k+5 吸附后的真实时长排）并烧进画面
    python finish.py --out final.mp4 --clips clips/*.mp4 --subs-from EP01/分镜.json --aspect 9:16

    # 已有 ASS 就只烧字幕
    python finish.py --out final.mp4 --clips clips/*.mp4 --ass subs.ass

注意:
    - 中间文件落在 --workdir（默认 ./.finish），不用 %TEMP%（本机 D:\\temp 不可写）
    - 响度默认两遍 loudnorm，目标 -16 LUFS / -1.5 dBTP
    - 没有音轨的片段会自动补静音，不会让合片失败
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

LOUD = re.compile(r"\{[^{}]*\"input_i\"[^{}]*\}", re.S)


def run(cmd, quiet=True):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0 and not quiet:
        print(p.stdout[-2000:])
    return p.returncode, p.stdout or ""


def has_audio(path):
    rc, out = run(["ffprobe", "-v", "error", "-select_streams", "a",
                   "-show_entries", "stream=index", "-of", "csv=p=0", path])
    return rc == 0 and out.strip() != ""


def duration(path):
    rc, out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                   "-of", "csv=p=0", path])
    try:
        return float(out.strip())
    except ValueError:
        return 0.0


def snap_frames(seconds):
    """H3 的帧数是 17k+5；给秒数返回吸附后的实际秒数。"""
    n = max(5, int(round(seconds * 24)))
    k = max(0, (n - 5 + 16) // 17)
    return (17 * k + 5) / 24.0


def parse_size(aspect, height):
    w, h = [int(x) for x in aspect.split(":")]
    return int(round(height * w / h / 2) * 2), height


def add_music(src, music, dst, volume=0.25, duck=True, fade=1.5, loop=True):
    """把 BGM 铺到成片上，默认用原音轨做 sidechain 闪避。

    H3 原生音轨里音乐/环境/对白是混在一起的，拿不出来；所以做法是
    「保留原生轨 + 外挂一条音乐」，而不是替换。
    """
    dur = duration(src)
    chain = []
    # 音乐：循环铺满 → 音量 → 片尾淡出
    music_in = "[1:a]"
    if loop:
        chain.append("%saloop=loop=-1:size=2e9,atrim=0:%.3f,asetpts=N/SR/TB[m0]" % (music_in, dur))
    else:
        chain.append("%satrim=0:%.3f,asetpts=N/SR/TB[m0]" % (music_in, dur))
    chain.append("[m0]volume=%.3f[m1]" % volume)
    if fade > 0:
        chain.append("[m1]afade=t=out:st=%.3f:d=%.3f[m]" % (max(0.0, dur - fade), fade))
    else:
        chain.append("[m1]anull[m]")

    if duck:
        # 用原音轨做 sidechain：对白一响，音乐自动退下去
        chain.append("[0:a]asplit=2[dial][sc]")
        chain.append("[m][sc]sidechaincompress=threshold=0.02:ratio=12:attack=5:release=450"
                     ":knee=6:makeup=1[duck]")
        chain.append("[dial][duck]amix=inputs=2:duration=first:normalize=0[a]")
    else:
        chain.append("[0:a][m]amix=inputs=2:duration=first:normalize=0[a]")

    fc = ";".join(chain)
    rc, out = run(["ffmpeg", "-v", "error", "-y", "-i", src, "-stream_loop", "-1",
                   "-i", music, "-filter_complex", fc,
                   "-map", "0:v:0", "-map", "[a]",
                   "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2",
                   "-shortest", dst], quiet=False)
    return rc == 0 and os.path.exists(dst)


def build_ass(shots, out_path, size, font_size):
    W, H = size
    margin_v = int(H * 0.21)          # 竖屏底盘线约在 79% 高度
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: %d" % W,
        "PlayResY: %d" % H,
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Source Han Sans SC,%d,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "0,0,0,0,100,100,0,0,1,3,1,2,80,80,%d,1" % (font_size, margin_v),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    def ts(t):
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = t % 60
        return "%d:%02d:%05.2f" % (h, m, s)

    t = 0.0
    for s in shots:
        line = (s.get("line") or "").strip()
        dur = snap_frames(float(s.get("duration") or 5))
        if line:
            start = t + 0.30
            end = t + dur - 0.25
            if end > start:
                lines.append("Dialogue: 0,%s,%s,Default,,0,0,0,,%s" % (ts(start), ts(end), line))
        t += dur
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return t


def normalize_clips(clips, size, fps, workdir):
    """把每条片段统一成同尺寸同帧率（缺音的补静音），返回中间文件列表。"""
    W, H = size
    outs = []
    for i, c in enumerate(clips):
        dst = os.path.join(workdir, "n%03d.mp4" % i)
        vf = ("scale=%d:%d:force_original_aspect_ratio=decrease,"
              "pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=%d" % (W, H, W, H, fps))
        if has_audio(c):
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", c,
                   "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", dst]
            run(cmd)
        else:
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", c,
                   "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                   "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", dst]
            run(cmd)
        outs.append(dst)
    return outs


def concat(parts, workdir):
    lst = os.path.join(workdir, "list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for p in parts:
            f.write("file '%s'\n" % os.path.abspath(p).replace("\\", "/"))
    dst = os.path.join(workdir, "joined.mp4")
    rc, out = run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                   "-i", lst, "-c", "copy", dst])
    if rc != 0 or not os.path.exists(dst):
        # copy 失败就重编码一次
        run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
             "-i", lst, "-c:v", "libx264", "-crf", "18", "-c:a", "aac", dst], quiet=False)
    return dst


def loudnorm(src, dst, target_i=-16.0, target_tp=-1.5):
    rc, out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", src,
                   "-af", "loudnorm=I=%g:TP=%g:LRA=11:print_format=json" % (target_i, target_tp),
                   "-f", "null", "-"])
    m = LOUD.search(out)
    if m:
        try:
            d = json.loads(m.group(0))
            af = ("loudnorm=I=%g:TP=%g:LRA=11:measured_I=%s:measured_TP=%s:"
                  "measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true:print_format=summary"
                  % (target_i, target_tp, d["input_i"], d["input_tp"], d["input_lra"],
                     d["input_thresh"], d["target_offset"]))
        except Exception:
            af = "loudnorm=I=%g:TP=%g" % (target_i, target_tp)
    else:
        af = "loudnorm=I=%g:TP=%g" % (target_i, target_tp)
    rc, out = run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", af,
                   "-ar", "48000", "-ac", "2", dst], quiet=False)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--clips", nargs="+", required=True)
    ap.add_argument("--aspect", default="", help="如 9:16 / 16:9；给了就直接把画幅改成它")
    ap.add_argument("--height", type=int, default=1920, help="配合 --aspect 的高度")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--lufs", type=float, default=-16.0)
    ap.add_argument("--tp", type=float, default=-1.5)
    ap.add_argument("--ass", default="", help="已有 ASS 字幕文件")
    ap.add_argument("--subs-from", default="", help="从 分镜.json 生成 ASS 并烧字幕")
    ap.add_argument("--font-size", type=int, default=0, help="0 = 按高度自动")
    ap.add_argument("--poster", action="store_true")
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--music", default="", help="BGM 文件；会循环铺满并做闪避")
    ap.add_argument("--music-volume", type=float, default=0.25)
    ap.add_argument("--music-fade", type=float, default=1.5)
    ap.add_argument("--no-duck", dest="duck", action="store_false",
                    help="关闭 sidechain 闪避（纯音乐片才用）")
    ap.add_argument("--no-loop", action="store_true", help="音乐不循环，短了就静音")
    ap.add_argument("--workdir", default=".finish")
    ap.add_argument("--keep-work", action="store_true")
    args = ap.parse_args()

    clips = []
    for c in args.clips:
        clips.extend(sorted(glob.glob(c)) if ("*" in c or "?" in c) else [c])
    if not clips:
        print("没有可用片段")
        return 2
    missing = [c for c in clips if not os.path.exists(c)]
    if missing:
        print("找不到: %s" % ", ".join(missing))
        return 2

    os.makedirs(args.workdir, exist_ok=True)
    outdir = os.path.dirname(os.path.abspath(args.out)) or "."
    os.makedirs(outdir, exist_ok=True)

    # 目标尺寸
    if args.aspect:
        size = parse_size(args.aspect, args.height)
    else:
        rc, out = run(["ffprobe", "-v", "error", "-select_streams", "v",
                       "-show_entries", "stream=width,height", "-of", "csv=p=0", clips[0]])
        try:
            w, h = [int(x) for x in out.strip().split(",")[:2]]
            size = (w, h)
        except Exception:
            size = (1080, 1920)
    print("目标尺寸 %dx%d @ %dfps" % (size[0], size[1], args.fps))

    print("[1/5] 统一尺寸帧率 …")
    parts = normalize_clips(clips, size, args.fps, args.workdir)

    print("[2/5] 合片 …")
    joined = concat(parts, args.workdir)

    print("[3/5] 响度标准化（两遍）…")
    normed = loudnorm(joined, os.path.join(args.workdir, "normed.mp4"), args.lufs, args.tp)

    # 字幕
    ass_path = args.ass
    if args.subs_from:
        with open(args.subs_from, "r", encoding="utf-8") as f:
            data = json.load(f)
        shots = data.get("shots", data if isinstance(data, list) else [])
        ass_path = os.path.join(args.workdir, "auto.ass")
        font = args.font_size or max(28, int(size[1] * 0.042))
        total = build_ass(shots, ass_path, size, font)
        print("      自动字幕 %d 条，按分镜排到 %.2fs" % (len(shots), total))

    final_src = normed
    if ass_path:
        print("[4/6] 烧字幕 …")
        print("      ⚠ 先确认源素材底部没有已烧的字：python qa.py <clip> --textcheck")
        print("        两层字幕叠在一起是最常见的翻车方式（H3 会自己加字幕）。")
        burned = os.path.join(args.workdir, "burned.mp4")
        esc = ass_path.replace("\\", "/").replace(":", "\\:")
        rc, out = run(["ffmpeg", "-v", "error", "-y", "-i", normed,
                       "-vf", "ass='%s'" % esc, "-c:v", "libx264", "-preset", "medium",
                       "-crf", "18", "-c:a", "copy", burned], quiet=False)
        if rc == 0 and os.path.exists(burned):
            final_src = burned
        else:
            print("      字幕烧录失败，输出不带字幕的版本")
    else:
        print("[4/6] 无字幕，跳过")

    if args.music:
        print("[5/6] 铺 BGM（音量 %.2f，闪避 %s）…" % (args.music_volume,
                                                 "开" if args.duck else "关"))
        if not args.duck:
            print("      ⚠ 关掉闪避后音乐会在对白上顶着走，只有纯音乐片才该关。")
        scored = os.path.join(args.workdir, "scored.mp4")
        if add_music(final_src, args.music, scored, args.music_volume,
                     args.duck, args.music_fade, not args.no_loop):
            final_src = scored
        else:
            print("      BGM 混音失败，输出不带音乐版本")
    else:
        print("[5/6] 无 BGM，跳过")

    run(["ffmpeg", "-v", "error", "-y", "-i", final_src, "-c", "copy", "-movflags",
         "+faststart", args.out])
    print("[6/6] 完成 → %s" % args.out)

    if args.poster:
        p = os.path.splitext(args.out)[0] + "_poster.png"
        run(["ffmpeg", "-v", "error", "-y", "-ss", "0.5", "-i", args.out,
             "-frames:v", "1", p])
        print("      封面 → %s" % p)
    if args.sheet:
        s = os.path.splitext(args.out)[0] + "_sheet.png"
        run(["ffmpeg", "-v", "error", "-y", "-i", args.out, "-vf",
             "select='not(mod(n,24))',scale=320:-1,tile=5x3", "-fps_mode", "passthrough",
             "-frames:v", "1", s])
        print("      分镜图 → %s" % s)

    d = duration(args.out)
    print("时长 %.3fs（%d 帧 @ %dfps）" % (d, round(d * args.fps), args.fps))
    if not args.keep_work:
        for f in glob.glob(os.path.join(args.workdir, "*.mp4")):
            try:
                os.remove(f)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())