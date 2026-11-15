# 单集流水线（静帧 → 镜头 → 合片）

**这一页是"从零到一条能发的竖屏短片"的最短路径**，附一条实测过的 22 秒 5 镜样片数据（2026-11，RTX 4080S 32G，模型与工作流版本见 `references/workflows/`）。执行脚本：`scripts/episode.py`；合片仍用 `scripts/finish.py`。

---

## 1. 五种镜头，五种做法

| 镜头类型 | 用什么 | 每条成本（实测） | 什么时候换别的 |
|---|---|---|---|
| 锚点/空镜/场景 | `still`：Qwen-Image 2512 + Lightning 4step，768×1344 | 12–16 s | 要画风统一就改锚点，别改模型 |
| 同人物换机位/景别 | `edit`：Qwen-Image-Edit-2509 + Lightning 4step | 10–18 s | **近景/特写别用 edit**，用 `crop`（会把两个人拼在一起） |
| 近景/特写 | `crop`：从已有帧竖裁再放大 | 0.1 s | 只有需要改姿态时才回 edit |
| 会动的镜（4 步） | `shot`：H3 fl2va + turbo4 | 125 s / 4.46 s | 有台词 → 8 步 |
| 会动的镜（8 步） | `shot --steps 8`：turbo8 | 210 s / 4.46 s | 没台词就别烧这个钱 |
| 远景/人小/灯多/易崩 | `pan`：静帧 + zoompan | 2–3 s | 硬生成 i2v 十有八九出漂浮颗粒、人物发光 |

**总价参考**：5 镜 ≈ 3×125 + 1×210 + 静帧 5×15 + 裁切/缓推 ≈ **12 分钟 GPU** 产出 22 秒成片。80 集按此排 ≈ 16 小时纯生成，再加返工。

---

## 2. 一条集怎么走

```bash
# 0) 一次性：确认服务在跑（HF/模型见 references/models.md）
python scripts/comfy.py --base http://127.0.0.1:8188 info --filter Qwen

# 1) 锚点帧（一次就中的那种，别急着改 prompt）
python scripts/episode.py still --prompt-file p_s1.txt --out ep01/s1.png

# 2) 同人物重排机位
python scripts/episode.py edit  --ref ep01/s1.png --prompt-file p_s2.txt --out ep01/s2.png

# 3) 特写：从 s2 竖裁（0 成本、身份 100% 一致）
python scripts/episode.py crop  --ref ep01/s2.png --box 180,230,640,1050 --out ep01/s3.png

# 4) 镜头：无台词 4 步、有台词 8 步
python scripts/episode.py shot --ref ep01/s1.png --prompt-file q_s1.txt --frames 107 --steps 4 --out ep01/s1.mp4
python scripts/episode.py shot --ref ep01/s2.png --prompt-file q_s2.txt --frames 107 --steps 8 --out ep01/s2.mp4

# 5) 远景收尾：静帧缓推
python scripts/episode.py pan  --ref ep01/s5.png --seconds 4.46 --out ep01/s5.mp4

# 6) 合片（concat / 音床 / 两遍 loudnorm / 烧 ASS）
python scripts/finish.py --clips ep01/s1.mp4,ep01/s2.mp4,ep01/s3.mp4 --ass subs.ass --out ep01/final.mp4
```

整集也可以写成清单一次跑：

```bash
python scripts/episode.py run --plan references/episode.example.json
python scripts/episode.py run --plan references/episode.example.json --only s3,s4
```

清单格式见 `references/episode.example.json`；`kind` 支持 `still / edit / crop / shot / pan`，后续镜头用 `ref` 指向前面镜头的 `id` 即可自动接上本地文件。

---

## 3. 分镜决策（写剧本时就把类型定死）

- **信息镜（手机消息、合同、字幕卡）不用生成**：静帧 + 字幕，观众只看文字。
- **情绪镜用 8 步**：笑着报喜、哭、发狠——字头必须清。
- **过渡/空镜用 4 步或 pan**：观众不会盯着看。
- **同一场景连续三镜以上**：第二镜起全用 `crop`/`pan`，别让 edit 反复重排（每次重排都是一次身份风险）。
- **收尾镜优先 pan**：拉远比推进稳，且不会把人物生成成发光剪影。

---

## 4. 三个必须过的闸

1. **台词闸**：每个有台词的镜，`ffmpeg -i clip.mp4 -vn ref.wav` 后过 whisper，字错了就 `--steps 8` 重跑（4 步会把中文念成"妈呀我上去啦"）。
2. **伪影闸**：抽 0.5/2.5/4.2 s 三帧看——镜头前有漂浮颗粒、人物边缘发光、手臂拉长，全部判废，换 `pan`。
3. **合片闸**：`finish.py` 之后量一次 `loudnorm`（目标 I=-16、TP≤-1.5），再看一遍 concat 有没有重复帧/黑场。

---

## 5. 踩过的坑（都在脚本里处理了）

- **`MiniMaxH3ImageToVideo` 返回两个 slot**：`[0]=CONDITIONING`、`[1]=LATENT`；`latent_image` 接 `[7,1]`，接 `[7,0]` 报 `return_type_mismatch`。
- **模型名在 Windows 上必须反斜杠**：`/object_info` 返回 `qwen\...`，combo 是字符串全等，正斜杠 validate 能过、submit 必挂 400。
- **`_comment` 顶层键会让 ComfyUI 500**：它对每个 value 调 `.get`，字符串直接 `AttributeError`。
- **pan 出来的片段必须带静音轨**：`-f lavfi -i anullsrc=r=48000:cl=mono`，否则 `finish.py` 的 concat 匹配不到 `[i:a]`。
- **concat 要求每路分辨率一致**：pan 是 1080×1920、H3 是 768×1344，`finish.py` 会先逐路 `scale=1080:1920,setsar=1`。
- **edit 会拼接两张输入里的人**：要"大特写、手机不在画面"，它会给你"前景一张脸 + 背景一个人"。
- **否定词反噬**：写 `nothing floats in front of the lens` → 颗粒变多；写 `a very slow push in` → 变成持续重构图。锁机位写状态句：`The camera is on a tripod and does not move.`

---

## 6. 交付物清单

- `ep01/*.png`（静帧，按镜号命名，便于回改）
- `ep01/*.mp4`（分镜，4.46 s / 107 帧 @24fps）
- `ep01/final.mp4`（1080×1920、24fps、字幕烧死、−16 LUFS）
- `subs.ass`（PlayRes 与成片一致，一个文件装完所有层）
- `notes.md`（每镜用的 seed / steps / prompt 文件，返工时只看这个）