---
name: dsh-video-ffmpeg-post
description: 用 FFmpeg 把多段生成结果做成能交付的片子：合片、统一调色、烧中日文字幕、两遍响度标准化、竖屏/画幅转换、分镜对照表与静帧总览图。含实测踩坑：volume 是线性倍数、loudnorm 单遍会重排逐镜关系、AAC 真峰值过冲、竖屏裁切会切掉横屏烧的字、输出路径相对 cwd。要把 AI 生成的片段剪成成片或做交付版式时加载。
whenToUse: 需要把多段视频合片时；要烧字幕/章节卡/数字卡时；成片响度不统一时；要做竖屏或改画幅时；要做分镜缩略图、静帧总览图、封面抽帧时；FFmpeg 滤镜参数行为与预期不符时。
metadata:
  version: 1
  requires: [ffmpeg]
---

# FFmpeg 后期：能交付的片子

## 1. 合片

```
ffmpeg -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart film_raw.mp4
```

- `list.txt` 每行 `file '/absolute/path/clip.mp4'`。同源同参数（同分辨率/帧率/编码）用 `-c copy`，秒级无损。
- **逐镜时长以 `ffprobe` 的实测值为准**排时间线；容器时长与内容时长会差几十毫秒，
  累到十几镜就是零点几秒的漂移（本轮 100.494 vs 100.461）。
- 字幕/字幕卡的入点全部**从实测偏移算**，不要手写时间码。

## 2. 统一调色

逐条生成的片段色调一定会漂。两层：

```
GLOBAL = curves=all='0/0 0.25/0.23 0.5/0.5 0.75/0.77 1/1',
         eq=saturation=0.93,
         colorbalance=rs=-0.02:bs=0.025:rm=-0.01:bm=0.012:rh=0.008:bh=-0.012
EXTRA  = 只给离群镜头（压暖、压暗、提对比）
```

`colorbalance` 的 `rs/gs/bs` 是阴影、`rm/gm/bm` 中间调、`rh/gh/bh` 高光。

## 3. 烧字幕（中文）

```
drawtext=fontfile='/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc':
  text='…':x=(w-text_w)/2:y=606:fontsize=31:fontcolor=0xE8E4DC:
  shadowcolor=black@0.85:shadowx=2:shadowy=2:
  alpha='if(lt(t,ST+0.5),(t-ST)/0.5,if(gt(t,EN-0.5),(EN-t)/0.5,1))':
  enable='between(t,ST,EN)'
```

- `drawtext` 的文本里 **`\ : , ; ' [ ]` 要转义**，`%` 要写成 `\%`；中文标点不用转义。
- 淡入淡出用 `alpha=` 表达式，比 `fade` 滤镜更好控（`fade` 会整体变黑）。
- 章节卡压在水墨/复杂画面上要加 `box=1:boxcolor=black@0.38`，纯阴影对比度不够。
- 滤镜多时把滤镜链写进文件，用 `-filter_complex_script`，避免命令行长度与转义地狱。

## 4. 响度与峰值

- **全片用两遍 `loudnorm` + `linear=true`**：单遍是动态处理，会把逐镜的音量关系重新揉回去
  （本轮实测：无旁白的镜头被莫名拉低 4.7dB）。流程：
  `-af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -` 量 → 带 `measured_*` 线性施加。
- **`volume=` 是线性倍数不是 dB**：`volume=11.2` 是 +21dB，要写 `volume=11.2dB`。
- **`alimiter` 的 `limit` 是线性值**（−1.5dBFS → `0.84`），且默认 `level=true` 会把电平顶上去；
  写成 `alimiter=limit=0.76:level=disabled`。
- **AAC 解码会过冲**：给 TP 留约 1dB 余量，否则量出来是 −1.1 而不是 −1.5。
- 质检：`ffmpeg -i out.mp4 -af ebur128=peak=true -f null -` 看集成响度与真峰值。

## 5. 画幅与竖屏

- 竖屏裁切：`crop=414:736:433:0,scale=1080:1920:flags=lanczos`（中心安全区）。
- ⚠️ **横屏烧好的字幕在竖屏裁切里会被切掉左右**（本轮实测："公元548年冬天"被切了头）。
  两种正解：先在竖屏画布上 `pad` 再加字；或者给竖屏做**独立分镜版**而不是裁一刀。
- 精确 16:9：H3 侧输出常是 1280×736（1.739:1），交付前 `crop=1280:720:0:8` 再 `scale`。

## 6. 对照表与总览图

- **分镜对照表**：每条取中点帧，`scale+pad` 统一到 640×360，`xstack` 拼网格，`drawtext` 烧镜头号。
- **静帧总览图**：同一套 xstack 逻辑，输入换成 PNG。
- ⚠️ `--out` 这类参数是**相对当前工作目录**的：在项目根目录跑却传了 `sheet.png`，图会落在根目录而不是 `out/`。
  要么传全路径，要么写完检查一遍。

## 7. 交付前必做的三项核对

1. **抽帧**：每条镜头取首/中/尾三帧，确认没有崩坏（AI 生成会在运动中崩）。
2. **响度**：集成响度 −16 LUFS、真峰值 ≤ −1.5dBFS。
3. **时长**：成片总长与设计稿一致；改过任一条片段就要重排时间线并复核字幕入点。

## 8. 附带脚本（参考实现）

| 脚本 | 作用 |
|---|---|
| `finish.py` | 合片 + 烧字幕 + 两遍响度 + 竖屏（本流程的完整实现） |
| `grade.py` | 逐镜统一调色 + 个别修正 |
| `sheet.py` | 分镜对照表（视频底） |
| `still_sheet.py` | 静帧总览图（图片底） |

这些脚本按某个具体项目的时间线写；移植时保留其中的滤镜链与"实测偏移"的做法即可。
