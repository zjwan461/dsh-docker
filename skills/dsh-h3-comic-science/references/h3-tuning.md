# H3 调参与语法补遗（官方指南 + 社区实测）

这一份补三件事：**官方指南里我们漏掉的格式规则**、**步数/采样器/加速器的实际取舍**、**LoRA 叠加的真实代价**。

> 来源：[ComfyUI 官方 H3 提示词指南](https://github.com/comfy-org/docs/blob/main/tutorials/video/minimax/minimax-h3-prompt-guide.mdx)、[MiniMax H3 ref 模式官方指南](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)、[awesome-minimax-H3 性能报告](https://github.com/wildminder/awesome-minimax-H3/blob/main/guides/minimax-h3-performance.md)（含 17 份社区实测）。数字是实测量级，换卡会变。

---

## 1. 官方格式规则（补 `h3-prompt-spec.md`）

### 1.1 各模式的开头不一样

| 模式 | 开头 |
|---|---|
| **T2VA** | 直接从 `integrated_multimodal_description:` 开始 |
| **I2VA** | **先写一句固定的图像对齐句 → 空行 → 再接正文三段** |
| **FL2VA / L2VA** | 用各自的 alignment 句（首帧/尾帧对齐） |

我们 i2v 模板里已经写了 `at 0.00 seconds into the target video, <Picture 1> ... is fully referenced`，这就是那个对齐句——**不能省，也不能塞进三段里面**。

### 1.2 画面文字的写法（和台词不同）

- **台词**：`<d>[Chinese] 台词</d>`，不用引号
- **画面里可见的文字**（招牌/UI/标语）：**英文双引号，逐字保留原语言**
  ```text
  A red neon sign reading "营业中" hangs above the door.
  ```
- 两者不要混：把台词写进引号、或把招牌写进 `<d>` 都会出错。

### 1.3 台词标点：省略号会伤清晰度

官方明确：`<d>` 里只保留 `, . ? !` 这类基本标点；**去掉重复波浪号、emoji、装饰性标点**；语句结束要有 `.` `?` `!`；听不清的写 `[unclear]`，不要猜。

> **省略号常常损害可懂度**（官方原话：ellipses often hurt intelligibility）。中文里习惯写"这雨……不对劲"，但 `<d>` 里应改成 `这雨，不对劲。`

### 1.4 两个音频字段的边界

| 字段 | 写什么 | 长度 |
|---|---|---|
| `overall_soundscape` | 环境声 / 音效 / 非语言人声 | 1–4 句 |
| `non_diegetic_music` | **只有观众听得见的配乐** | 1–3 句 |

- **对白、唱歌、与画面同步的音效留在 `[Shot N]` 里**，不要搬到这两个字段。
- `N/A` 只在真的全程无声/无配乐时用。
- **出现不想要的说话声时，两个字段都要显式填**（留空会让模型自己补）。

### 1.5 切点写法

- 单个时间戳：`[Shot 2] At 00:03.500, the camera cuts to ...`
- **不要写区间** `[5s-8s]`；不要用 `[Shot 2] 0:03-0:05`。
- 主体/空间/状态/视点/时间**任一变化**才换镜；**轻微重新构图属于同一镜**，用镜头运动表达。

### 1.6 画外音与跨切点

- 画外音：`says in an off-screen voiceover`，并在 `</d>` 后说明嘴唇不动。
- 对白跨切点：两侧都加 `<scenetrans>`，音频延续。
- 被打断：`<cutoff>`。

---

## 2. R2V 六段式：音频保留标记（重要缺口）

我们之前只写了**画面**的四个保留标记，**音频是另一套**（官方 ref 指南）：

| 标记 | 含义 |
|---|---|
| `fully_copy` | 整段源音频 1:1 作为成片的完整音轨 |
| `partially_copy` | 只复制部分时间线/某些层，或复制后又增删替换 |
| `reference` | 不复制信号，只参考**音色/节奏/曲风/台词内容/声音质感** |
| `weak_reference` | 只保留类别或氛围上的大致相似 |

**这是"克隆音色"和"复用原声"的分界线**：只想借音色就写 `reference`，否则会被当成复制整段。

其余规则：

- `<Audio N>` 绑定到某个说话人时，复用**同一个** `(Sx)`：`<Audio 1> is the voice-timbre reference for <Subject 1> (S1).`
- `(Sx)` 按**成片里实际发声事件的顺序**分配，一旦分配就全程复用；**不要写进 `retention_analysis`**。
- 只有 BGM/完整音轨里带的词，用 `<Audio N>` 当声源，**不要凭空造一个 `(Sx)`**。
- 若只参考音色，**不要把参考音频里的原话搬进成片**。
- `summary` 开头要写任务类型标签，可组合：`[reference generation + audio reference]`、`[video editing + audio reuse]`、`[video continuation + keyframe completion]`。
- `detailed_description`：生成任务通常 **350–500 英文词**；对白密集时优先把整条说话时间线写满，不要机械凑字数。
- 风格句写在 `[Shot 1]` **之前**（一到两句英文），不是塞在第一个 shot 里。
- 一张参考图可以含多个分格：给这张图单独的 `<Picture N>`，描述分格，并让 shot 指向某一格（如 `the full front view of <Picture 2>`）。

---

## 3. 步数与采样器：20 步不是质量上限

| 配置 | 步数 | 说明 |
|---|---|---|
| ComfyUI 默认 | 20 | **速度妥协**，不是官方推荐 |
| MiniMax 官方 | **30–50** | 质量上限 |
| Ref2VA（含音频） | **≥20**，25 是常见下限 | 低于 20 音频明显变差 |
| 32 步 | — | 音频/运动更好，只比 20 步多 **15–20%** 时间 |
| 无 LoRA 12 步 | — | 部分场景观感更好（社区偏好，非官方） |

**采样器**：`res_multistep` + `simple`（评测网格）或 `euler` + `simple`；**cfg 恒 1.0**；sigma shift **video 12 / audio 3**。
`audio 6` 只是让混音更响，**在气声/耳语上会高出约 9 dB**，别当默认。

---

## 4. Turbo LoRA：省时间，但**伤音频**

这条最重要，直接改我们的"有台词 8 步"建议：

| 事实 | 后果 |
|---|---|
| 蒸馏（Turbo/4-step）**一致地劣化音频**（多人报告） | 对白戏的成片不能用 turbo |
| 蒸馏伤害**最安静/持续的声区**（长音、耳语） | 气声、哭腔、低声台词最先坏 |
| 蒸馏把口音/中英混说**拉回通用腔** | 方言、外语台词会走味 |
| 蒸馏下**硬切容易糊成叠化** | 多镜快切会丢切点 |
| strength 1.0 = 最快；**0.75 = 更稳的嗓音/口音** | 要保嗓音就用 0.75 |
| 4-step LightX2V 实测 **3.44×** 加速，显存几乎不变 | 打样首选 |

**正确用法（两段式）**：

```text
打样：0.2–0.4MP + 8–13 步 + Turbo（或 EasyCache，二选一，不能同时）
定稿：关掉加速 + 20–32 步 + 标准 VAE Decode
对白镜：要么直接 20 步无 Turbo，要么 Turbo 打样后**用同一 seed 无 Turbo 重跑**取干净音频
```

> 我们之前写"有台词必须 8 步"，准确说法是：**8 步 turbo 是打样档，对白成片要 20 步以上或同 seed 重跑**。两种说法在"8 步"上重合，但目的不同。

---

## 5. 加速器取舍（别全开）

| 工具 | 结论 |
|---|---|
| **sol-attn** | **无损**（实测 bit-identical），首选 |
| SageAttention | 省算力但**吃显存**；≤12GB 会因 offload 反而更慢；40/50 系可试 `--use-ck-attention` |
| Spectrum | **有损**，10 步几乎无效，要 30–50 步才见效；伤音频；部分实现 R2V 不生效 |
| EasyCache | 打样神器，参数 `(0.3, 0.2, 0.9)` + `res_multistep/simple` + `BlehTAEVideoDecode`；**不能与 Turbo 同用**（步被跳过） |

---

## 6. 环境与显存

- **音频 VAE 必须 fp32**（fp16 会音画不同步）。
- **ComfyUI ≥ 0.30.0**：Kijai 的音频采样器修复（2026-08-06）之前，音频会坏/不同步。
- **VAE decode 卡 0%** → 换 Kijai int8 video VAE；VAE Decode 前加一个清显存节点。
- **短片段系统卡死**（大显存也会）→ `--disable-pinned-memory`、`--vram-headroom`、关掉多余显示器。
- **反直觉但反复被报告**：更长的片段有时**占用更少**显存（模型被 offload 出去了）。
- **Ref2VA 比 T2V 吃显存得多**；低显存优先减参考图数量。
- 分辨率：**0.2MP 是速度地板，0.8MP 是消费卡实用上限**。
- 帧数：`17k+5`（22 / 73 / 90 / 124 都合法）。

### 量化档位（按显存选）

| 显存 | 方案 |
|---|---|
| 24GB | pruned INT8 + NVFP4，或 Q5_K_M GGUF；20 步 / Turbo 4 步 |
| 16GB | Q4_K_M GGUF（或 pruned INT8）+ Turbo；CUDA 13 差别很大 |
| 12GB | pruned INT8 ConvRot + NVFP4 + Turbo 8 步 + sol-attn；**64GB 内存是根治 offload 的关键** |
| 8GB | NF4 / INT4 ConvRot；≥32GB 内存；73 帧、0.4MP 以内 |

---

## 7. 提示词 embedding（风格捷径）

ComfyUI 支持 `embedding:名称`（文件放 `models/embeddings/`）。官方仓库有 10 个社区风格 embedding，触发词 = 文件名：

`art_is_explosion` / `blooming_flowers` / `bullet_time` / `dark_magic` / `fire_breath` / `four_seasons` / `kiss_camera` / `spiral_ascent` / `storm_magic` / `truman_show`

**非官方**，效果按名字理解；写进提示词任意位置即可。做特效镜（子弹时间、四季流转）比自己描述省事。

---

## 8. 和现有文档的关系

- 语法细节：本文 §1–§2 是 `h3-prompt-spec.md` 的补丁，冲突时以官方指南为准。
- 步数/LoRA：本文 §3–§5 覆盖 `lora-catalog.md` 的"加速类"部分。
- 导演风格：`director-styles.md` 的形式约束不受影响，但**锁机位/步印这类"时间轴"描述在 turbo 下会失真**。
