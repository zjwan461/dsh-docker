# 工作流目录（按用途分类）

这一份是"有什么、解决什么、什么时候用"的索引；具体做法见同目录的 `image-pipelines.md`、`talking-head.md`、`alt-video-models.md`。

**用到的 JSON 都已随 skill 打包**（相对路径，换机器可用）：

| 目录 | 内容 |
|---|---|
| `workflows/h3/` | 官方三套 API（t2v/i2v/r2v）+ U00/U06V9/U11/U17/U22/U24/U30/U32 |
| `workflows/image/` | A01/A08/B13/C19/T4 |
| `workflows/video/` | G02/P02/H41/Y08/J13/N2 |

> 命名规律：A/B/C/D/T=生图与编辑，G/P=Wan 系视频与动作迁移，H/J/Y=LTX 系视频，U=H3 系视频，N=声音克隆。
> 下表给的是**代码**，对应文件在 `workflows/<类别>/<代码>-<名字>.json`。

---

## 1. 生图 / 编辑（做静帧、角色设定、分镜）

| 文件 | 解决什么 | 关键模型/节点 |
|---|---|---|
| A01 文生图 Qwen2512 高清放大 | 高质量静帧 + 放大 | `qwen_image_2512_fp8` + Lightning 4step + 两个写实 LoRA + `SeedVR2VideoUpscaler` |
| A08 洗图 二次元→真人 | **动漫脸转写实**（漫剧转实拍、AI 感清洗） | `AnythingtoRealCharacters2511_20` LoRA；两条 3 段式采样 |
| B13 角色一键多角度 | **一次出多个角度**（三视图/多机位） | `qwen_image_edit_2509` + `TextEncodeQwenImageEditPlus` ×8 并行 + `CFGNorm` |
| B18 Qwen-Image 2.1 | 新一代底模文生图 | `qwen_image_2.1_int8` + `qwen3vl_8b` + `TextEncodeQwenImage21` |
| B20 Qwen-Image 2.1 Turbo 编辑 | 快速编辑 | `ManualSigmas` + `SamplerCustom`（自定义 sigma 表） |
| C16 短剧文生图（场景/角色） | 短剧静帧，场景与角色分开描述 | Z-Image + `Z-Image-Fun-Lora-Distill-8-Steps` |
| C18 白玉 AIO 三采超高清写真 | 写真级三遍采样 | `Z-Image-Base-8steps-White_Marble-AIO` + Flux2 Klein 混用 + rgthree Any Switch |
| C19 人物设定三视图（zimage 双采） | **三视图 + 本地 LLM 扩写提示词** | `z_image_turbo` + `llama_cpp`（`llama_cpp_instruct_adv`）+ 双采 |
| D14 分镜 Flux Klein 9B 多角度 | 分镜/多角度叙事 | `Flux2-Klein-9B-True` + `Qwen3 8B` 文本编码 |
| D18 Klein9b 真人剧制造机 多图编辑 | 多图参考的真人剧静帧 | Flux2 Klein + 多图编辑 |
| D20 RAW 画质重建 Adonis | RAW 质感/降 AI 感 | Adonis 系 LoRA 栈 |
| T4/T10 Krea2 三视图/4视图 | 角色设定图 | Krea2 + `Krea2EditGroundedEncode` |

## 2. Wan 系视频（运动、首尾帧、动作迁移）

| 文件 | 解决什么 | 关键点 |
|---|---|---|
| G01 Wan2.2 图生视频基础 | i2v 基线 | `WanVideoModelLoader` + 高/低噪双模型 + `WanVideoSampler` |
| G02 Wan2.2 首尾帧 | **首尾帧约束**（我们 Hub/衔接的替代方案） | `WanVideoImageToVideoEncode` + `CreateCFGScheduleFloatList` + 两张 LoadImage |
| G03/G10 SmoothMix / V2 | 平滑运动 | SmoothMix + block swap |
| G07 LightX2V WorkFisher | **4 步加速** | LightX2V LoRA |
| P02/P07 Wan2.2 Animate 角色迁移 | **动作迁移/角色替换**（真人视频驱动） | `WanVideoAnimateEmbeds` + `WanVideoClipVisionEncode` + 姿态/遮罩 |
| P17 动作迁移 4090-48G V8 | 高显存版本 | 同上，参数更重 |

## 3. LTX 2.3（音视频一体、多参考、四宫格）

| 文件 | 解决什么 | 关键点 |
|---|---|---|
| H17 LTX2.3 全面优化 | 文/图生视频基线 | LTX 2.3 22B + `LTXVConditioning` |
| H28 高动态 i2v | **高动态**镜头 | 高动态参数 + distilled LoRA |
| H31 声音→图像生成视频 | 音频驱动 | AV latent 分离/合并 |
| H41 MSR 多参考图 | **多主体参考**（2–5 张） | `LiconMSR` + `LTXAddVideoICLoRAGuide` + `LTX-2.3-Licon-MSR-V2` |
| J11 电商数字人 | 数字人口播 | LTX 2.3 + 音频 |
| J13 小珠光 90 秒 InfiniteTalk | **90 秒长口播（单人）** | `WanInfiniteTalkToVideo` ×20 段 + `ImageFromBatch`/`ImageBatch` 链式续接 |
| Y08 四宫格 i2v | 四格分镜一次出 | `ImageFromBatch+` + LTX + 双 VAE（视频/音频） |

## 4. H3 系（U 系列，与我们产线直接相关）

| 文件 | 解决什么 | 关键点 |
|---|---|---|
| U00 提示词 Qwen3.8 群主版 | **本地 LLM 把 9 张图写成 H3 提示词** | `ZealmanLLM_Generate` + 9×LoadImage |
| U01/U02/U03 | H3 基础 t2v/i2v/light2v 加速 | `MiniMaxH3ImageToVideo` + turbo LoRA |
| U06/U06V9/U09 | 9 图（+3 音）满参考 | `ref_images` 列表 / T8 audiocond |
| U17 9图1视频3音频 | **加参考视频**（运动参考） | 2 遍 LoRA + `TrimAudioDuration` |
| U22 9图3音 | 多角色+多音色 | native `MiniMaxH3ReferenceToVideo` |
| U24 文武双修 T8 | 对白+打戏+两遍高清 | 混合底模 + LoRA 栈 + `LearnedLatentUpscale` |
| U11 图片+音频对口型 | **给定音频驱动口型**（配音/口播） | `DenoMiniMaxH3ReferenceToVideo` + `DenoAudioTranscript` + `TextGenerate` + turbo 4step |
| U30 | 三段采样 + AV latent 分离 + 3D latent 放大 | `SplitSigmas` + `LTXVSeparateAVLatent` + `MinimaxH3LatentUpscaler3D` |
| U32 | Sigma 精修 + 动作修复 | `H3SigmaRefiner` + `Motion_Repair` + `MiniMaxH3AVDecodeT8` |

## 5. 声音

| 文件 | 解决什么 | 关键点 |
|---|---|---|
| N2 单人声音克隆 FishAudio S2 pro | **克隆音色做 TTS**（跨集同声） | `Apply Whisper`（转写参考音频）+ `FishS2VoiceCloneTTS` |

---

## 6. 怎么选（对我们三类产线）

| 需求 | 首选 | 备选 |
|---|---|---|
| 角色三视图/多角度 | **B13（Qwen Edit 多角度）**、T4/T10（Krea2） | C19（Z-Image + LLM 扩写） |
| 动漫→写实洗图 | **A08（AnythingtoReal）** | D20（RAW 重建） |
| 静帧高清放大 | A01（SeedVR2） | C18 三采 |
| 对白/口播口型 | **U11（H3 图+音对口型）** | J13（InfiniteTalk 长片） |
| 跨集同音色 | **N2（FishAudio 克隆）** | 参考音频（H3 r2v） |
| 动作迁移/真人驱动 | P02/P07（Wan Animate） | H41（LTX MSR 多参考） |
| 音视频一体/高动态 | H17/H28（LTX 2.3） | 我们的 U24 |
| 长片连续 | Hub/Chain（我们用 H3） | G02（Wan 首尾帧） |

---

## 7. 这些工作流教给我们的通用规律

1. **两遍/三遍采样是标配**：先低分辨率定构图，再放大精修（C18 三采、U24 两遍、U30 三段）。对应我们"0.4MP 打样→定稿"。
2. **LoRA 是分遍、分强度叠的**，不是一次全开（U24 每遍给不同 strength）。同风格 LoRA 叠两个会互相抵消。
3. **加速靠蒸馏 LoRA + 少步数**（Lightning 4step、LightX2V、turbo），但**定稿别用**。
4. **文本编码器也在换代**：Qwen2.5-VL → Qwen3-VL 8B/32B，`type=minimax` 这类参数必须与底模匹配。
5. **显存管理是工作流的一部分**：`VRAMCleanup`/`RAMCleanup`/`BlockSwap`/`SageAttention` 不是可选项。
6. **长片靠"分段 + 取帧续接"**：J13 用 `ImageFromBatch` 抽末帧接下一段，和我们"末帧接力"同一思路。
7. **本地 LLM 参与写提示词**（U00、C19）：看图→写结构化提示词，比手写更稳。
8. **多参考正在统一到"token 级视觉记忆"**（LTX MSR 把多图编码成伪视频序列），比单 embedding 更保身份。
