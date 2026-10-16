#!/usr/bin/env python3
"""最终合成（本地 ffmpeg，免费、不占 GPU）。

产出三样：
  out/film_bare.mp4      无字幕纯画面版（用来判断画面本身）
  out/film_subbed.mp4    烧上章节卡 + 引文 + 数字卡（无配音时的可读版）
  out/film_vertical.mp4  9:16 竖屏版（抖音）

时序说明：本片暂无配音。所以「可读版」把**旁白也烧成小字幕**，
让样片在没有声音的情况下也能看懂；等配音录出来，把旁白字幕去掉即可。

字幕一律自己烧（Noto Serif CJK），不依赖插件后期。
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRADED = ROOT / "out" / "graded"
OUT = ROOT / "out"

ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8a", "S8b", "S9",
         "S10a", "S10b", "S11"]

FONT_R = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
FONT_B = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"

# 画幅 1280x736 → 各层 y 坐标
Y_CARD = 324
Y_QUOTE = 548
Y_NARR = 606
Y_NUMS = [250, 330, 410, 490]

# (镜, 起始偏移, 结束偏移, 文本, 样式)
CAPTIONS = [
    ("S1",   0.6,  4.2, "548年 · 冬", "card"),
    ("S2",   0.6,  7.3, "公元548年冬天。一个人带着八千兵渡过了长江。", "narr"),
    ("S3",   0.6,  7.3, "史书上有另一个数字：一千。无论哪个，都少得不像话。", "narr"),
    ("S4",   0.6,  7.3, "他叫侯景。北方边镇出身。右脚短，骑马射箭都不是他的长处。", "narr"),
    ("S5",   0.6,  3.7, "他向皇帝求娶王、谢家的女儿。", "narr"),
    ("S5",   3.9,  6.7, "「王谢门高非偶，可于朱、张以下访之。」", "quote"),
    ("S5",   6.9,  9.9, "「会将吴儿女以配奴。」", "quote"),
    ("S6",   0.6,  4.0, "549年 · 台城被围一百三十天", "card"),
    ("S7",   0.6,  8.6, "守将羊侃的儿子被押到城下。他说：我倾宗报主还嫌不够，岂复计此一子。", "narr"),
    ("S8a",  0.6,  2.6, "「卿在戎日久，无乃为劳。」", "quote"),
    ("S8a",  2.8,  4.8, "「卿何州人，而敢至此？」", "quote"),
    ("S8a",  5.0,  7.4, "「初度江有几人。」", "quote"),
    ("S8b",  0.6,  1.8, "「千人。」", "quote"),
    ("S8b",  1.8,  3.2, "「围台城有几人。」", "quote"),
    ("S8b",  3.2,  4.4, "「十万。」", "quote"),
    ("S8b",  4.4,  5.8, "「今有几人。」", "quote"),
    ("S8b",  5.8,  8.0, "「率土之内，莫非己有。」", "quote"),
    ("S9",   0.6,  6.8, "他被关了起来，还照常斋戒、洗手、漱口。病久了，嘴里发苦，要蜂蜜，要不到。", "narr"),
    ("S9",   7.8,  9.3, "「荷，荷。」", "quote"),
    ("S10a", 0.6,  6.4, "三年后，侯景兵败。船上陪着他的，是羊侃的第三个儿子。", "narr"),
    ("S10b", 1.0,  5.0, "「我等为王百战百胜……今就王乞头以取富贵。」", "quote"),
    # 结尾四行数字：不放旁白字幕，只留数字，更有力
    ("S11",  1.4,  2.8, "八千人　　渡过长江", "num0"),
    ("S11",  2.8,  4.2, "一百二十天　　当了皇帝", "num1"),
    ("S11",  4.2,  5.6, "十多万人　　困在台城", "num2"),
    ("S11",  5.6,  8.0, "两三千人　　活到城破", "num3"),
]


def probe_duration(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(p)], capture_output=True, text=True)
    return float(r.stdout.strip())


def offsets():
    off, acc = {}, 0.0
    for sid in ORDER:
        off[sid] = acc
        acc += probe_duration(GRADED / f"{sid}.mp4")
    return off, acc


def esc(t: str) -> str:
    # drawtext 里 : , ; ' \ [ ] 需要转义；中文标点无需处理
    out = []
    for ch in t:
        if ch in "\\':,;[]":
            out.append("\\" + ch)
        elif ch == "%":
            out.append("\\%")
        else:
            out.append(ch)
    return "".join(out)


def caption_filters(off):
    fs = []
    for sid, a, b, text, style in CAPTIONS:
        st = off[sid] + a
        en = off[sid] + b
        t = esc(text)
        if style == "card":
            # 加柔和底色框：章节卡会压在水墨地图上，纯靠阴影对比度不够（S6 实测）
            fs.append(
                f"drawtext=fontfile='{FONT_B}':text='{t}':"
                f"x=(w-text_w)/2:y={Y_CARD}:fontsize=54:fontcolor=0xF2ECE1:"
                f"box=1:boxcolor=black@0.38:boxborderw=22:"
                f"shadowcolor=black@0.6:shadowx=2:shadowy=2:"
                f"alpha='if(lt(t,{st}+0.6),(t-{st})/0.6,if(gt(t,{en}-0.6),({en}-t)/0.6,1))':"
                f"enable='between(t,{st},{en})'")
        elif style == "quote":
            fs.append(
                f"drawtext=fontfile='{FONT_B}':text='{t}':"
                f"x=(w-text_w)/2:y={Y_QUOTE}:fontsize=38:fontcolor=white:"
                f"box=1:boxcolor=black@0.42:boxborderw=14:"
                f"alpha='if(lt(t,{st}+0.35),(t-{st})/0.35,if(gt(t,{en}-0.35),({en}-t)/0.35,1))':"
                f"enable='between(t,{st},{en})'")
        elif style == "narr":
            fs.append(
                f"drawtext=fontfile='{FONT_R}':text='{t}':"
                f"x=(w-text_w)/2:y={Y_NARR}:fontsize=31:fontcolor=0xE8E4DC:"
                f"shadowcolor=black@0.85:shadowx=2:shadowy=2:"
                f"alpha='if(lt(t,{st}+0.5),(t-{st})/0.5,if(gt(t,{en}-0.5),({en}-t)/0.5,1))':"
                f"enable='between(t,{st},{en})'")
        elif style.startswith("num"):
            i = int(style[3])
            fs.append(
                f"drawtext=fontfile='{FONT_B}':text='{t}':"
                f"x=(w-text_w)/2:y={Y_NUMS[i]}:fontsize=46:fontcolor=0xEDE7DC:"
                f"shadowcolor=black@0.8:shadowx=3:shadowy=3:"
                f"alpha='if(lt(t,{st}+0.5),(t-{st})/0.5,1)':"
                f"enable='between(t,{st},{en})'")
    return fs


def run(cmd, label):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"✗ {label}\n{r.stderr[-1500:]}")
        return False
    print(f"✓ {label}")
    return True


def concat(off, total):
    lst = OUT / "concat.txt"
    lst.write_text("".join(f"file '{(GRADED / f'{s}.mp4').as_posix()}'\n" for s in ORDER))
    return run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                "-i", str(lst), "-c", "copy", "-movflags", "+faststart",
                str(OUT / "film_raw.mp4")], f"合片（无损 copy）→ film_raw.mp4  总长 {total:.3f}s")


def main():
    off, total = offsets()
    print("时间线：")
    for s in ORDER:
        print(f"  {s:5s} {off[s]:>7.3f}s  ({probe_duration(GRADED / f'{s}.mp4'):.3f}s)")
    print(f"  合计 {total:.3f}s = {int(total//60)}:{total%60:05.2f}\n")

    if not concat(off, total):
        return 1

    # 无字幕版：只做响度标准化
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(OUT / "film_raw.mp4"),
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "copy",
         "-movflags", "+faststart", str(OUT / "film_bare.mp4")],
        "响度标准化 → film_bare.mp4")

    # 可读版：烧字 + 响度
    script = OUT / "caps.filter"
    script.write_text(",".join(caption_filters(off)))
    ok = run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(OUT / "film_raw.mp4"),
              "-filter_complex_script", str(script),
              "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
              "-c:v", "libx264", "-crf", "17", "-preset", "medium",
              "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
              "-movflags", "+faststart", str(OUT / "film_subbed.mp4")],
             "烧字 + 响度 → film_subbed.mp4")

    # 竖屏 9:16（抖音）：从可读版裁，保留中间安全区
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(OUT / "film_subbed.mp4"),
         "-vf", "crop=414:736:433:0,scale=1080:1920:flags=lanczos",
         "-c:v", "libx264", "-crf", "18", "-preset", "medium",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(OUT / "film_vertical.mp4")],
        "竖屏版 → film_vertical.mp4")

    for n in ("film_bare.mp4", "film_subbed.mp4", "film_vertical.mp4"):
        p = OUT / n
        if p.exists():
            print(f"   {n}: {p.stat().st_size/1e6:.2f} MB")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())