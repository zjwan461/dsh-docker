# AI 换脸 / 人物替换（Recast / Character Swap）

**一句话：H3 能做“保留原片表演、只换主体身份”的换脸，但它是“重渲染”，不是像素级贴脸；长片要切镜、原声要独立复用、真人换脸有合规红线。**

---

## 0. 先认清那类爆款

- “MJ 演唱会换脸”= B站 **“世界巡演”** 趋势：把 1992 布加勒斯特演唱会（*Live in Bucharest: The Dangerous Tour*）开场的主角换成别人，观众席也换脸，配乐换成 AI 唱的新词歌。
- 最火的**黄仁勋版**作者是 B站「王与也行」，用的工具是 **updream**（B站自家 AI 视频工具），**不是 H3**。同类还有雷军、Lisa Su、孙悟空、门捷列夫等 200+ 条。
- 它的技术本质 = **identity transfer onto existing motion**：场景/运镜/动作/表演来自原片，脸/身份/服装来自参考图。
- 所以“H3 能不能做”= 问 H3 能不能做运动迁移+身份替换。**能**，见下。

> 来源：[Opusly 解析](https://www.opusly.ai/blog/jensen-huang-michael-jackson-ai-video)、[民视](https://www.ftvnews.com.tw/news/detail/2026A07W0303)。

---

## 1. 五条路线

| 路线 | 机制 | likeness | 动作复刻 | 额外权重 | 适合 |
|---|---|---|---|---|---|
| **A 原生 r2v 运动迁移** | `ref_video`(运动) + `ref_image`(身份)，`attribute_transfer` | 中 | 中 | 无 | 快速试、无 LoRA |
| **B Character Swap LoRA** | guide-latent 条件 + 参考图，`body_swap` 模板 | **高** | **高** | 80MB LoRA | 要严格跟原片 |
| **C Head Swap LoRA** | 只换头、保口型 | 高(头) | 高 | LoRA | 要对口型 |
| **D 选择性换脸** | normal map / DWPose 标记只换某主体 | 高 | 高 | LoRA+preprocessor | 多人只换其一 |
| **E 首帧重建法** | 图像编辑做"新人+原布景"首帧 → 图生视频演一遍 | 高 | **低（重演）** | 无 | 托管 API / 没有 guide 能力时 |

B/C 可组合（实验性，口型可能更好，不保证）。**E 是平台爆款（rapper swap / 世界巡演）的主流做法**，见 §12。

---

## 1.5 路线怎么选

```
有原片、要严格复刻动作？
├─ 有 → 自建 ComfyUI：B（+C 保口型）
└─ 没有 / 只有托管 API → E（首帧重建 + 表演提示词）
只要某一主体换 → D
只要头、要口型 → C
```

---

## 2. 路线 B：Character Swap LoRA（推荐）

来源：[Alissonerdx/Minimax-H3-ComfyUI · character-swap.md](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/character-swap.md)。另有 [akatz-ai/MiniMax-H3-Character-Swap-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)。

### 2.1 接线

1. LoRA `minimax_h3_character_swap_v1.1_ref2va_fro.safetensors`（80MB，strength **1.0**）放 `models/loras/`。v1.1 主打 **likeness**（脸/发/身/衣更贴参考图）。
2. **原片送 `MiniMaxH3AddGuide`，`frame_idx = 0`**。LoRA 是按 guide-latent 条件训练的，这是推荐视频输入。
3. **角色图走原生 image-reference，作 `<Picture 1>`**。
4. 用下面的 `body_swap` 模板（**一行**），只替换 `{details}`。
5. 输出画幅/帧数对齐 guide（**17n+5**）。先跑短测试再处理长段。
6. 8 步 DMD turbo；可选二遍 LMS LoRA + latent upscaler（1280×704）。
7. **多人同框要指明换哪个 guide 主体**，否则模型选最显眼的那个。

### 2.2 `body_swap` 模板（原样用，只换 `{details}`）

```text
body_swap: subject_definitions: <Subject 1> is the {details} shown in <Picture 1>, whose identity, face, head, hair or fur, skin, body shape, proportions and clothing define the character in the target video. The guide video provides the scene and the performance: its background, environment, lighting, camera, framing, body pose, hand and arm movement, head rotation, gaze direction, lip movement and facial expression, frame by frame; only the main subject of the guide video is replaced: its face, hair, body and clothing become <Subject 1>.  summary: [video generation + reference] Replace the guide subject with <Subject 1>, keeping the scene, camera and the complete motion and performance of the guide video.  detailed_description: [Shot 1] <Subject 1> takes the exact place of the guide subject and moves with the same timing, body pose, gestures, head motion, gaze, speech and facial expressions, while keeping the complete identity from <Picture 1>: facial structure, hair or fur, skin, body shape and clothing stay stable in every frame. The background, lighting, colors and camera of the guide video are preserved. Prevent identity drift, clothing changes, texture crawling and flicker.
```

### 2.3 `{details}` 填法

从头到脚、逗号分隔、**以性别开头、无冠词、无句号**，使句子读作 “`<Subject 1> is the … shown in <Picture 1>`”。顺序：性别/身高/体型/肩腰比例 → 脸型/肤色/眼色/特征 → 发色/发型/胡须 → 上衣(颜色/版型/面料/领/袖/扣/拉链/口袋/logo/图案/层次) → 下装 → 鞋 → 配饰(帽/镜/耳饰/项链/表/带/包) → 纹身/疤/皱/妆。**只写看得见的，不发明。**

例：`Male, average height, slender build, narrow shoulders, oval face, deep wrinkles, sun-weathered skin, blue eyes, long white beard, gray cap, dark jacket`

可用 VLM（Qwen3-VL 等）看参考图自动写 `{details}`（native workflow 的 `Generate Text`，`max_length≈768` 防截断）。

---

## 3. 路线 A：原生 r2v（无 LoRA）

- `ref_video` 供运动/结构，`ref_image` 供身份；retention 用 `attribute_transfer`。
- **必须写明谁供运动、谁供身份**，否则原片的人会出现。实测（scenes.md S9）：裸写 “moves as in `<Video 1>`” 出来的是原片的人；要写：

```text
Using the movement of the figure in <Video 1> only, the [new person] from <Picture 1> performs it. Every person on screen is that [new person].
```

- 保真不如 LoRA，但不用额外权重，适合快速验证。

---

## 4. 口型与原声（最容易漏）

- **H3 重新生成音轨，不保留原声。** 成片必须把**原片音轨独立复用**，不要用模型音轨当最终原声（JayceHuang 产线明确）。
- 要口型跟原唱/原台词：
  - **Head Swap LoRA**（保口型），或与 Character Swap 组合；
  - 或 Context-Loop 的 **lip-sync to source audio**（vocal stem 驱动）；
  - 或后期专用 lip-sync 工具。
- 演唱会换脸通常**直接换 AI 唱的新歌**（如 Beat It 改词），口型要求低，最省事。

---

## 5. 长片产线（>15s 必切镜）

来源：[JayceHuang/jayce-recast-video-dgx](https://github.com/JayceHuang/jayce-recast-video-dgx)（《流星雨》四人替换实战）。

1. **先看原片真实动作再切镜**，不要按固定秒数切；多人同框/近景/完整手势/遮挡要单独处理。源帧从 0 起，区间 `[start,end)`。
2. **逐镜参考三问**：换成谁 / 穿什么 / 这一刻在做什么。**身份卡的服装不能覆盖镜头服装**。
3. 构建 **24fps RGB guide**，保持原时长（尾部只为模型长度补帧）。
4. **两阶段 H3 都保存**，用来定位问题出在哪一步；第二阶段更清楚≠通过（眼神/嘴形相位差仍要查）。
5. **帧映射回源时间线**：精确有理数时间 + 最近邻（round 半值取偶），**不加速动作**；`native-source-start` 必须是原生真正覆盖的首个源帧，不能总填 0。
6. **原声独立复用**。
7. **QA = 技术检查 + 人眼连续播放验收**；`qa` 不自动写 `visual_acceptance:true`。
8. 多机：独立分段 / 两机合算 / 三机补位；每个物理 GPU 始终只承担一项。

---

## 6. 限制（实验性，不保证）

- 小脸、遮挡、快动作、难角度、光变、长片 → **身份漂移**。
- 单次 ≤15s → 长片切镜拼接。
- 可能从**局部参考图发明**看不见的细节。
- 主要面向人/类人；动物少测。
- 静态相似 ≠ 嘴形/眼睛/动作时序对应；必须连续播放对照源片判断。

---

## 7. 合规红线（必读）

- **换真实可识别的人**（明星/企业家/政客）涉及**肖像权、深度伪造、平台规则**；需本人授权。不用于冒充/欺诈/骚扰/违法。
- **源片有版权**（演唱会 DVD、电影片段），二创需许可；“换脸”不消除原片版权。
- **标注 AI 生成**。
- Character Swap LoRA 自有 **BFS Character Swap License**：商用可、年营收 >$1M 需署名、**禁止托管 API/SaaS**。与 H3 本体许可证叠加，都要看。
- **建议**：演示/教学用**原创或已授权角色**做替换，避免直接换真人；要做真人二创先拿授权并标注。

---

## 8. 本插件（`h3_generate`）能力边界

- 当前 r2v **只接参考图，不接 guide video / `MiniMaxH3AddGuide`** → **不能直接对已有视频换脸**。
- 要做路线 B/C/D：用 **ComfyUI 画布**（AddGuide + Character Swap LoRA）或**官方 API**；或扩展插件接 `ref_video`/guide。
- **不依赖插件的跑法**：`python scripts/comfy.py --base <真实地址> submit --workflow references/character-swap-api.json` → `wait --id <PID>` → `download`，即用 API 直接跑真换脸（本文 §11 已验证）。
- 服务器需含 `MiniMaxH3AddGuide` 节点（本机已确认存在）。
- **像素级精确换脸 / 长片 / 实时** → 用专用 face-swap 工具（FaceFusion / DeepFaceLab / InsightFace 系），与 H3“重渲染”路线不同：前者贴脸保原片像素，后者重画整帧。

---

## 9. 选型速查

| 需求 | 选 |
|---|---|
| likeness + 保留表演 | **B Character Swap LoRA** |
| 只换头、保口型 | C Head Swap |
| 多人只换其一 | D preprocessor map |
| 无额外权重、快速试 | A 原生 r2v |
| 像素级/长片/实时 | 专用 face-swap 工具（非 H3） |
| 对口型演唱会 | 换 AI 新歌（口型要求低）或 C/lip-sync |

---

## 10. 实测（2026-11-13）

- 三个 LoRA（`character_swap_v1.1` / `head_swap_v1.0` / `preprocessor_map`）下载后**无需重启即被 ComfyUI 识别**（`LoraLoaderModelOnly` 列表可见，共 23 个）。inventory 的 alternatives 只是截断子集，别据此判断“没装上”。
- **3s / 0.4MP / r2v / `character_swap_v1.1`（strength 1.0，turbo=false 20 步）** sanity 测试：参考图身份（寸头/黑方框镜/灰卫衣）四帧稳定、无漂移/闪烁 → **LoRA 加载与身份生成正常**。
- 注意：这是**身份生成**，不是“对原片换脸”。`h3_generate` r2v 不接 guide video/AddGuide，真正换脸需画布工作流（AddGuide frame 0 + `body_swap`）。
- character_swap **不是蒸馏 LoRA**，别用 4 步 turbo 跑它；测试用 20 步。要快需另叠 DMD turbo（工作流注释里有链接）。
- 服务器重启会清空 input 参考图 → 跑前**重新上传**参考图，否则 `Invalid image file`。

---

## 11. ComfyUI API 直接跑 character-swap（已验证，绕开 h3_generate 限制）

`h3_generate` 不接 guide 视频，但 **ComfyUI `/prompt` API 接受完整 API 格式工作流**，可以跑真换脸。已验证工作流存于 [`character-swap-api.json`](character-swap-api.json)（POST `{base}/prompt`，body=`{"prompt": …}`）。

**节点链**：UNETLoader(ref2va) → LoraLoaderModelOnly(character_swap v1.1, 1.0) → KSampler；CLIPLoader(type=`minimax`) → ReferenceToVideo；原片 → VHS_LoadVideo → AddGuide(frame_idx 0)；ReferenceToVideo(参考图) → AddGuide → KSampler(cfg 1) → VAEDecode(video) → CreateVideo(fps 24) → SaveVideo。

**实测踩过的坑（务必照抄）**：
- 参考图用 **`ref_images: [[img,0]]`（基础名+列表）**，**不是** `ref_image_0`（那是 UI autogrow 展开键，execute() 不收，报 unexpected keyword）。
- 视频加载用 **`VHS_LoadVideo`**（输入键 `video`，输出 IMAGE[0]）；原生 `LoadVideo` 输入键是 `file` 且需配 `GetVideoComponents`，易错。
- `MiniMaxH3AddGuide` 只输出 CONDITIONING；guide 信息进 conditioning，latent 用 `EmptyMiniMaxH3LatentAV`。
- character_swap **非蒸馏** → KSampler 用 **20 步、cfg 1.0、res_multistep + beta**；别用 4 步 turbo。
- 输出默认**无声**（CreateVideo 不接音频）；要原声后期用 ffmpeg 把原片音轨混回。
- `SaveVideo.format="auto"`；`CreateVideo.fps=24`。
- 长宽为 32 倍数（864×480≈0.4MP），length 用 17k+5（3s=73）。

**验证结果（2026-11-13）**：原片男人 → 外星人，场景/机位/呼吸动作保留，身份稳定。证明 API 路线可行。

**合规**：演示用虚构/已授权角色；真人换脸需授权并标 AI。

---

## 12. 路线 E：首帧重建法（平台爆款的主流做法）

**思路**：不碰原片视频，只借它的**布景**。用图像编辑生成一张"新人站在原布景"的静帧，再图生视频让模型**重演**一遍。

### 12.1 三步

1. **取布景**：从原片截一帧（选构图最完整、人物最少的）。
2. **重建首帧**：图像编辑，输入 = 人像 A + 人像 B + 布景帧；提示词逐条点名。
3. **动画**：首帧 → 图生视频（H3 `i2v` / U02），提示词写表演。

### 12.2 首帧提示词的写法（照这个结构）

```text
Recreate the studio set from the third image exactly: <布景：背景色、道具、光源、景别>.
Replace the two performers with the two men from the first and second images, keeping their faces
highly recognizable and photorealistic.
On the left, the man from the first image: <服装逐项>.
On the right, the man from the second image: <服装逐项>.
They stand side by side facing the microphone mid-performance. Photorealistic 4K video still,
no text, no captions, no logos.
```

要点：**左右分别点名 + 服装逐项 + 布景照抄**。图像编辑模型有负面词分支，所以 `no text` 在这里是有效的（和 H3 相反）。

### 12.3 动画提示词的四条习惯

| 习惯 | 写法 | 为什么 |
|---|---|---|
| 点名谁先动 | `the man on the left in the black turtleneck raps first` | 不点名，两人会合体/换衣服 |
| 要声音就明写 | `audible rap vocals and a punchy beat` | H3 总会出声，不指定就随机 |
| 禁字幕 | `no subtitles, no captions, no on-screen text` | 这类画面最容易长歌词条（可试，但别指望） |
| 机位别浪 | `steady camera with a slow push-in` | 大运镜是身份漂移主因 |

### 12.4 画幅陷阱

图生视频**跟随首帧比例**。图像编辑常出 3:2，直接动画会得到信箱边——**先把静帧裁成目标画幅**（如 16:9 的 1536×864）再提交。

### 12.5 与路线 B 的区别

| | E 首帧重建 | B Character Swap |
|---|---|---|
| 动作 | 模型现编（重演） | 严格跟原片 |
| 依赖 | 只要图生视频 | 要 guide + LoRA + 自建 |
| 适用 | 舞台/演唱会/固定布景 | 影视片段/精确复刻 |

### 12.6 平台政策（重要）

- **H3 接受真人肖像当首帧**（托管 API 实测可通过），但**不代表可以随便用**——肖像权仍需授权。
- **Seedance 2.x 明确拒绝含真人的参考图/参考视频**（`may contain real person`），所以"真人换脸"在那边走不通。
- **首帧与参考图不能混用**：一次请求只能是 `image`（或+`last_frame`），不能同时带 `reference_images`。
- 每次提交都是新渲染，重提会重复计费。

### 12.7 实测（2026-11-13，端到端跑通）

两步都成功，全程低清：

1. **编辑**（`image/E1-首帧重建-Qwen编辑.json`，Qwen-Image-Edit-2509 fp8，20 步）：把外星人放进原布景，灰背景/发光外套保留，~80 秒。
2. **i2v**（`h3/h3_i2v_api.json`，73f/3.04s/864×480）：呼吸、缓慢转头、额头印记发光，身份与布景稳定，~4 分钟。

**两个必踩的坑**：

| 坑 | 正确 |
|---|---|
| 音频解码用 `VAEDecode` | 必须 `VAEDecodeAudio`（`VAEDecode` 出 IMAGE，接 `CreateVideo.audio` 会报类型不匹配）。官方三套模板已修 |
| 上传后文件名带序号 | 上传 `firstframe.png` 实际存成 `firstframe_00001_.png`，`LoadImage` 要写**带序号的全名** |

**模型不完整会直接在 UNETLoader 报错**（"Tensor extends past the end of the file"）——下载没完就提交会浪费一次排队；先 `ls -l` 对字节数再跑。
