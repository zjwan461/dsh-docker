#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成前校验 分镜.json。只报事实，不改文件。

用法:
    python check.py EP01/分镜.json
    python check.py EP01/分镜.json --rate 4.1 --lead 1.6

退出码: 0 全过（可有 warning），1 有 error。
"""
import argparse
import json
import re
import sys

CJK = re.compile(r"[\u4e00-\u9fff]")
TOKEN = re.compile(r"[A-Za-z0-9]+")
CUT = re.compile(r"At\s+(\d{2}):(\d{2})\.(\d{3})")
SPEAKER = re.compile(r"^S\d+$")

BANNED = [
    (r"\bno subtitles?\b", "否定词 no subtitles 会诱发字幕"),
    (r"\bno (?:on-screen )?text\b", "否定词 no text 会诱发文字"),
    (r"\bno watermark\b", "否定词 no watermark 会诱发水印"),
    (r"\bnot photorealistic\b", "否定词可能反向诱发实拍感"),
    (r"\bdo not\b|\bdon't\b", "否定句在 cfg=1 下无效且可能反向"),
]


def speak_len(text):
    """可发声字数：汉字 1 个算 1，连续英文/数字串算 1。"""
    return len(CJK.findall(text)) + len(TOKEN.findall(CJK.sub(" ", text)))


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return data.get("shots", []), data.get("format", "")
    return data, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("storyboard")
    ap.add_argument("--rate", type=float, default=4.1, help="中文语速 字/秒")
    ap.add_argument("--lead", type=float, default=1.6, help="开口前等待秒数")
    args = ap.parse_args()

    shots, fmt = load(args.storyboard)
    errors, warns = [], []
    total = 0.0

    for idx, s in enumerate(shots, 1):
        prev_cut = 0.0  # 每条镜头的时间轴都从 0 开始
        sid = s.get("id") or "S%02d" % idx
        dur = s.get("duration")
        mode = s.get("mode", "static")
        line = (s.get("line") or "").strip()
        speaker = (s.get("speaker") or "").strip()
        prompt = (s.get("prompt") or "").strip()
        refs = s.get("refs") or []

        if not isinstance(dur, (int, float)) or not (4 <= dur <= 15):
            errors.append("%s: duration=%r 不在 4–15 秒" % (sid, dur))
            dur = 4
        total += dur

        # 台词容量
        if line:
            n = speak_len(line)
            avail = max(0.8, dur - args.lead)
            cap = avail * args.rate
            if n > cap * 1.2:
                errors.append("%s: 台词 %d 字，%ss 最多约 %.0f 字（会赶/被截）" % (sid, n, dur, cap))
            elif n > cap:
                warns.append("%s: 台词 %d 字，接近上限 %.0f 字" % (sid, n, cap))
            if not SPEAKER.match(speaker):
                errors.append("%s: 有台词但 speaker=%r（应为 S1/S2…）" % (sid, speaker))
        elif speaker:
            warns.append("%s: 无台词却写了 speaker" % sid)

        # 模式与参考图
        if mode not in ("static", "t2v", "i2v", "r2v"):
            errors.append("%s: mode=%r 未知" % (sid, mode))
        if mode == "r2v" and not refs:
            errors.append("%s: r2v 但没有 refs" % sid)
        if mode == "i2v" and len(refs) < 1:
            errors.append("%s: i2v 但没有首帧 refs" % sid)
        if len(refs) > 9:
            errors.append("%s: refs %d 张，上限 9" % (sid, len(refs)))

        # 提示词结构
        if mode != "static":
            if not prompt:
                errors.append("%s: 提示词为空" % sid)
            if mode == "r2v":
                for field in ("subject_definitions", "summary", "retention_analysis", "detailed_description"):
                    if field not in prompt:
                        errors.append("%s: r2v 缺 %s" % (sid, field))
            elif "integrated_multimodal_description" not in prompt:
                errors.append("%s: 缺 integrated_multimodal_description" % sid)
            if "overall_soundscape" not in prompt:
                warns.append("%s: 缺 overall_soundscape（会随机补声）" % sid)
            if "non_diegetic_music" not in prompt:
                warns.append("%s: 缺 non_diegetic_music（会自己补配乐）" % sid)

            for pat, why in BANNED:
                if re.search(pat, prompt, re.I):
                    warns.append("%s: %s" % (sid, why))

            if fmt == "manju" and not re.search(r"\b(2d|anime|manhua|comic|cel shading)\b", prompt, re.I):
                warns.append("%s: 漫剧但提示词没声明二维介质（会滑向实拍）" % sid)

            # 多人站位与说话人绑定
            dialects = len(re.findall(r"<d>", prompt))
            if dialects > 1:
                warns.append("%s: 一镜 %d 句台词，确认只有一人动嘴" % (sid, dialects))
            if line and not re.search(r"\b(lips?|mouth)\b", prompt, re.I):
                warns.append("%s: 台词镜没写嘴部状态（口型可能不跟着说）" % sid)
            if dialects >= 1 and len(set(re.findall(r"\(S\d+\)", prompt))) > 1 \
                    and not re.search(r"lips? (?:remain|stay)|does not speak|stays silent", prompt, re.I):
                warns.append("%s: 多个说话人但没写谁闭嘴，口型可能错人" % sid)
            people = re.findall(
                r"<Subject \d+>[^\n]*?\b(man|woman|girl|boy|alien|person|detective|swordsman|swordswoman|child|kid|officer|doctor|teacher|student)\b",
                prompt, re.I)
            if len(people) >= 2 and not re.search(
                    r"\b(left|right|centre|center|foreground|background|mid-ground)\b", prompt, re.I):
                warns.append("%s: 多人但没写站位（左右/前后景）" % sid)

            for m in CUT.finditer(prompt):
                t = int(m.group(1)) * 60 + int(m.group(2)) + int(m.group(3)) / 1000.0
                if t <= prev_cut:
                    errors.append("%s: 切点 %.3fs 未递增" % (sid, t))
                if t >= dur:
                    errors.append("%s: 切点 %.3fs 超过时长 %ss" % (sid, t, dur))
                prev_cut = t

    print("镜头 %d，总时长 %.2fs" % (len(shots), total))
    for e in errors:
        print("[ERROR] " + e)
    for w in warns:
        print("[WARN ] " + w)
    if not errors:
        print("[OK] 通过；warning %d 条" % len(warns))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
