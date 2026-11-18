# 替代视频模型（Wan / LTX）

H3 不是唯一选择。这批工作流里有 Wan2.2 和 LTX 2.3 两条成熟线，各有 H3 现在做不到的能力。**用它们补 H3 的短板，不是替换 H3。**

---

## 1. 什么时候换模型

| 需求 | 换 | 原因 |
|---|---|---|
| 首尾帧硬约束（承接上一镜） | **Wan2.2 首尾帧（G02）** | H3 本插件没有尾帧槽 |
| 真人视频驱动动作/换人 | **Wan2.2 Animate（P02/P07）** | H3 的 r2v 只接参考图 |
| 多主体参考（2–5 张，token 级记忆） | **LTX 2.3 MSR（H41）** | H3 最多 9 图但机制不同 |
| 音视频一体、强动态 | **LTX 2.3（H17/H28）** | H3 音频与画质取舍更保守 |
| 超长口播 | InfiniteTalk（见 `talking-head.md`） | H3 单次 ≤15s |
| 极简/快速出片 | Wan2.2 + LightX2V 4step | 比 H3 满步快 |

---

## 2. Wan2.2 线

### 2.1 基本结构

```text
WanVideoModelLoader(高噪) ─┐
WanVideoModelLoader(低噪) ─┼→ WanVideoSampler（两段去噪）
WanVideoVAELoader          │
LoadWanVideoT5TextEncoder ─┘
WanVideoImageToVideoEncode（首帧/尾帧）
WanVideoDecode → 合成
```

- **高噪/低噪双模型**：先粗后细，比单模型稳。
- **LightX2V 4step LoRA**：把步数压到 4，适合打样。
- `WanVideoSetBlockSwap`：显存不够时把 block 换到内存。
- `CreateCFGScheduleFloatList`：按时间改 cfg，控制"前面稳、后面放"。

### 2.2 首尾帧（G02）

两张 `LoadImage` 分别进 `WanVideoImageToVideoEncode` 的 start/end。这是 H3 本插件缺失的能力——**要"必须落到某个构图"就用它**。

### 2.3 动作迁移（P02/P07）

`WanVideoAnimateEmbeds` + `WanVideoClipVisionEncode`：给一段真人视频 + 一张角色图，把动作迁移到角色上。

要点：
- 需要**姿态/遮罩**预处理（SDPose/YOLO 系）。
- 角色图要全身、干净背景。
- 手部、快速转身是崩坏高发区。

---

## 3. LTX 2.3 线

### 3.1 基本结构

```text
DualCLIPLoader / CLIPLoader
LTX 2.3 22B（dev 或 distilled）
LTXVConditioning
SamplerCustomAdvanced（KSamplerSelect + CFGGuider + RandomNoise + sigmas）
LTXVSeparateAVLatent / LTXVConcatAVLatent（音视频 latent 分开处理）
VAEDecode(video) + VAEDecodeAudio
```

- **视频 VAE 与音频 VAE 是两套**（`LTX23_video_vae_bf16` / `LTX23_audio_vae_bf16`），必须都接。
- `distilled` 版步数少，`dev` 版质量高。
- 高动态片（H28）会调 shift/sigma，让运动更放。

### 3.2 MSR 多主体参考（H41）

`LiconMSR` + `LTX-2.3-Licon-MSR-V2` LoRA + `LTXAddVideoICLoRAGuide`。

机制（官方说明）：**把多张参考图编码成"伪视频序列"，与目标视频共享同一表示空间**，目标 token 通过原生 self-attention 直接读参考 token——不是额外 encoder，也不是单个 embedding。

- 支持 **2–5 张**参考，可分别承担：身份 / 道具 / 场景 / 局部纹理 / 多视角。
- 提示词要**简洁准确**地写每张参考的角色，过多或过少都会掉一致性。
- 高动态场景建议 **50fps**。

### 3.3 四宫格（Y08）

`ImageFromBatch+` 把四格拆开分别处理，再拼回；适合一次出四个分镜。

---

## 4. 三个共性技术（跨模型都适用）

| 技术 | 作用 | 我们的对应 |
|---|---|---|
| **两段/三段采样** | 先构图后细节 | 0.4MP 打样 → 定稿 |
| **蒸馏 LoRA（LightX2V / Lightning / turbo）** | 4–8 步出片 | turbo 开关 |
| **BlockSwap / SageAttention / VRAMCleanup** | 显存换速度 | 无（我们靠 0.4MP） |

---

## 5. 选型速查

| 我要 | 用 |
|---|---|
| 承接上一镜、必须落到某构图 | Wan2.2 首尾帧 |
| 真人动作搬到角色 | Wan Animate |
| 2–5 个主体同时保身份 | LTX MSR |
| 音视频一体、强动态 | LTX 2.3 |
| 与漫剧/科普产线无缝 | **H3（本 skill 主线）** |

---

## 6. 边界

- 换模型 = 换一套权重与节点，**画风会变**；同一集不要混用两个视频模型（除非刻意做风格段）。
- Wan/LTX 的工作流节点多、显存重；能否跑要先 `comfy.py validate` + 小样。
- 这些工作流来自社区，**参数是作者环境下的最优**，换卡要重调。
