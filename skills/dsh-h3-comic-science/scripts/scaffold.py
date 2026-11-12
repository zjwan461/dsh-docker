#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""建一个漫剧 / 科普短剧项目骨架。

用法:
    python scaffold.py <project_dir> --format manju --ep EP01 --shots 16
    python scaffold.py <project_dir> --format science --ep EP01 --shots 24

产物:
    <project>/项目.json
    <project>/<EP>/剧本.md
    <project>/<EP>/分镜.json
    <project>/<EP>/提示词.md
    <project>/<EP>/{refs,clips,vo,out}/
"""
import argparse
import json
import os
from datetime import date

MANJU_STYLE = ("2D hand-drawn anime, cel shading, clean bold line art, flat color blocks, "
               "not live-action, not photographed")
SCIENCE_STYLE = ("Live-action, cinematic, 35mm, shallow depth of field, natural light, "
                 "realistic skin texture")

MANJU_SCRIPT = """# {ep} 剧本

- 集长目标：{minutes} 分钟
- 钩子（前 3 秒）：
- 集尾钩子：
- 本集一句话：谁想要什么，什么挡着他。

## 场次

### 场 1 · 地点 · 时间
（动作、台词、音效。台词逐字写，数字写阿拉伯数字。）

### 场 2 · 地点 · 时间

## 连续性锁（每镜照抄）

- LOCK-主角：<发型 / 服装 / 标志物，一条能原样贴进提示词的短语>
- LOCK-场景：<材质 / 光源 / 关键陈设>
"""

SCIENCE_SCRIPT = """# {ep} 剧本（外星人 + 地球人）

- 话题：
- 赌约：地球人赌……；外星人赌……
- 时长目标：{minutes} 分钟（约 {segments} 段 × 15 秒）

## 伏笔

- ① 开头剧透的代价 → 第 N 段揭晓
- ② 第 N 天的异常 → 第 M 段回扣

## 段落

### 第 1 段（0–15s）：钩子 + 赌约
1. `0–4s`｜地点｜画面｜地球人：「」
2. `4–8s`｜地点｜画面｜外星人：「」
3. `8–11s`｜地点｜画面（穿越入口）
4. `11–15s`｜比喻空间｜画面｜外星人（画外）：「」

## 出处表（每个数字都要有）

| 台词里的数字/结论 | 出处（作者/期刊/年份） | 样本量 | 注意 |
|---|---|---|---|
|  |  |  |  |
"""

BIBLE = """# {name} · 剧集圣经

这四块定下来之后，每集只改剧情，**不改这里**。改锁短语等于换演员。

## 角色

- CHAR-01｜<姓名>｜<年龄性别>，<身材>，<发型>，<服装>，<标志物>
  连续性锁：`<一条能原样贴进提示词的英文短语>`
  声音：<年龄感 + 音色 + 语速>（S1）
  参考图：refs/<文件>

- CHAR-02｜<姓名>｜…
  连续性锁：`…`
  声音：…（S2）
  参考图：refs/<文件>

## 场景

- LOC-01｜<地点名>｜<关键陈设三件>｜<光源>
  轴线：门在画<左/右>，窗在画<左/右>；<角色A>常驻画<左>，<角色B>常驻画<右>
  参考图：refs/<文件>

## 状态机（会随剧情变的东西）

- PROP-01 <道具>：第 <N> 集 <状态> → 第 <M> 集 <状态>
- INJURY-01 <伤>：第 <N> 集出现 → 第 <M> 集变化 → 之后不再提
- WEAR-01 <服装变体>：第 <N>–<M> 集使用

## 声音

- 同场次用同一句环境底，跨镜声明 `continues unchanged`
- 全片 LUFS 目标 −16，真峰值 ≤ −1.5 dBTP，片尾淡出 1.5s
- 只写画面里真有东西发出的声音（天气/交通铺底会渲染成嘶声）

## 接法约定

- 场次内：Hub（每段起止都钉在同一张锚点帧）
- 场次间：硬切（不加淡化），必要时加 2–4 秒桥接镜
- 续接：末帧从最后 0.5 秒里挑最干净的一帧存 PNG
"""

SHOT_STUB = {
    "id": "S01",
    "scene": "",
    "shot": "中景",
    "start": "",
    "action": "",
    "end": "",
    "mode": "static",
    "duration": 4,
    "aspect": "9:16 (Portrait Widescreen)",
    "refs": [],
    "line": "",
    "speaker": "",
    "sfx": "",
    "prompt": "",
}


def build_shots(n, fmt):
    shots = []
    for i in range(1, n + 1):
        s = dict(SHOT_STUB)
        s["id"] = "S%02d" % i
        s["mode"] = "r2v" if i <= 2 else "static"
        s["aspect"] = "9:16 (Portrait Widescreen)" if fmt == "manju" else "16:9 (Widescreen)"
        shots.append(s)
    return shots


def prompt_header(fmt, ep):
    if fmt == "manju":
        return ("# %s 提示词\n\n"
                "每镜一段，整段复制进 h3_generate 的 prompt。三段式；不要写负面词。\n\n"
                "统一画风：%s。\n\n" % (ep, MANJU_STYLE))
    return ("# %s 提示词\n\n"
            "每段 14–15 秒，3–4 镜；六段式 r2v。数字念全，台词逐字。\n\n"
            "统一画风：%s。\n\n" % (ep, SCIENCE_STYLE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--format", choices=["manju", "science"], default="manju")
    ap.add_argument("--ep", default="EP01")
    ap.add_argument("--shots", type=int, default=16)
    ap.add_argument("--minutes", type=float, default=3)
    args = ap.parse_args()

    root = os.path.abspath(args.project)
    epdir = os.path.join(root, args.ep)
    for d in [root, epdir] + [os.path.join(epdir, x) for x in ("refs", "clips", "vo", "out")]:
        os.makedirs(d, exist_ok=True)

    project = {
        "name": os.path.basename(root),
        "format": args.format,
        "created": date.today().isoformat(),
        "aspect": "9:16" if args.format == "manju" else "16:9",
        "style": MANJU_STYLE if args.format == "manju" else SCIENCE_STYLE,
        "audio": "tts" if args.format == "manju" else "h3_or_tts",
        "characters": {},
        "note": "角色锁写进 characters；每镜提示词照抄，不要换形容词。",
    }
    with open(os.path.join(root, "项目.json"), "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=2)

    shots = build_shots(args.shots, args.format)
    with open(os.path.join(epdir, "分镜.json"), "w", encoding="utf-8") as f:
        json.dump({"episode": args.ep, "format": args.format, "shots": shots},
                  f, ensure_ascii=False, indent=2)

    segments = max(1, round(args.minutes * 60 / 15))
    script_tpl = MANJU_SCRIPT if args.format == "manju" else SCIENCE_SCRIPT
    with open(os.path.join(epdir, "剧本.md"), "w", encoding="utf-8") as f:
        f.write(script_tpl.format(ep=args.ep, minutes=args.minutes, segments=segments))

    with open(os.path.join(epdir, "提示词.md"), "w", encoding="utf-8") as f:
        f.write(prompt_header(args.format, args.ep))
        for s in shots:
            f.write("## %s · %s\n\n```text\n%s\n```\n\n" % (s["id"], s["scene"] or "待填", s["prompt"] or "待填"))

    bible_path = os.path.join(root, "bible.md")
    if not os.path.exists(bible_path):
        with open(bible_path, "w", encoding="utf-8") as f:
            f.write(BIBLE.format(name=os.path.basename(root)))

    print("created: %s" % root)
    print("  bible.md  %s/剧本.md  分镜.json  提示词.md  refs/ clips/ vo/ out/" % args.ep)
    print("next: 先填 bible.md（角色/场景/轴线/声音），再填剧本与分镜")
    print("check: python check.py %s" % os.path.join(epdir, "分镜.json"))


if __name__ == "__main__":
    main()
