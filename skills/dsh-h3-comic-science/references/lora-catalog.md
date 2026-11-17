# LoRA 目录与用法

H3 的 LoRA 分四类：**加速**、**风格**、**功能**、**动作/修复**。用错类别是"越跑越差"的主因。

---

## 1. 速查表

| 用途 | 文件 | 建议强度 | 步数 | 注意 |
|---|---|---|---|---|
| **t2v/i2v 加速** | `minimax/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16` | 1.0 | 8 | 通用加速，最稳 |
| t2v 768p 加速 | `minimax/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16` | 1.0 | 4 | 更快，细节掉 |
| **r2v 加速** | `minimax/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16` | 1.0 | 4 | r2v 专用，别混用；**无台词**才用 |
| **r2v 口播加速** | `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16`（lightx2v/Minimax-h3-Turbo） | 1.0 | 8 | **r2v 带台词**用这个；4 步中文会糊 |
| **写实质感（文）** | `minimax/MinimaxH3真实电影质感V0.1` | 0.5（打样 0.2） | — | 科普线用；二维漫剧**别用**（会拉回实拍） |
| **打斗（武）** | `minimax/H3_Combat_V2` | 0.5–0.7 | — | 改动作分布，先小强度试 |
| 动作稳定 | `minimax/Motion_Repair` | 0.2–0.7 | — | 治"打斗软/漂"，双遍可分强度 |
| 风格化 | `minimax/MysticXXX_MMH3-V1` | 0.4–0.6 | — | 与参考图抢权重 |
| 风格化 | `minimax/minimax_h3_dmad_full_dareties_v4_step600` | 0.4–0.6 | — | 强风格，慎用 |
| **换脸** | `minimax_h3_character_swap_v1.1_ref2va_fro` | **1.0** | 20 | 需 AddGuide + body_swap；**非蒸馏** |
| 只换头（保口型） | `minimax_h3_head_swap_v1.0_r32` | 1.0 | 20 | 可和 character_swap 叠 |
| 选择性换脸 | `minimax_h3_character_swap_v1.0_preprocessor_map_fro099` | 1.0 | 20 | 需 normal map/DWPose |
| 混合加速（实验） | `minimax_h3_turbo_4step_10ErosMax_*` / `minimax_h3_turbo_v4_step600_ema_*` | 0.5–0.9 | 4 | U24 里分遍叠，不稳定 |
| 打斗连贯（社区） | `minimax/H3_Fight_Flow_V1` | 0.35 | — | 与 Combat 叠，专治"套招断" |
| 动作修复 V2 | `minimax/Motion_Repair_V2` | 0.35 | — | 旧版 `Motion_Repair` 的加强版 |
| 动作幅度 | `minimax/H3_speed_slider_1.1` | 3.0 | — | 只打在 `token_refiner` 上（3 个张量），3.0 是"常规"档 |

> 模型名以你服务器 `object_info` 为准；上面是仓库里的实际文件名。

**turbo 的实测效果（U06V9，512×288/1s）**：不挂 turbo 8 步 371s；挂 turbo 8 步 390s（**没有更快**）；挂 turbo 砍到 4 步 **260s（-33%）**，画面结构一致、只是略软。所以 turbo 的价值是**允许少步数**，不是它自己加速。

**判断 LoRA 有没有生效别看 `patches attached`**：它在只挂 turbo 和同时挂 turbo+Combat+Fight_Flow 时**都是 208**——那数字是被打补丁的权重个数，不是 LoRA 个数。要看画面，或看日志里有没有 `lora ... shape is invalid` / `lora key not loaded`。

**武打链的接法（API 格式没有 bypass，只能删节点或串起来）**：`UNETLoader → turbo(1.0) → H3_Combat_V2(0.65) → H3_Fight_Flow_V1(0.35) → 采样器`，4 步；实测 280s 出片，画面里机位更宽、多了环境建筑，确实吃到了 LoRA。

---

## 2. 四条规则

### 2.1 加速类只影响速度，定稿关掉

蒸馏 LoRA（turbo / 4step / LightX2V）是"少步数近似"。**打样开、定稿关**。
开 turbo 后 seed 轨迹变了，不能拿 turbo 的结果当"同一版的低质版"。

### 2.2 风格类会与参考图抢权重

参考图要保人时，风格 LoRA 压到 **0.4–0.6**；压不住就干脆不用。
**强风格 + 强参考 = 脸不像**。

### 2.3 功能类（换脸）不是蒸馏，别配 4 步

`character_swap` / `head_swap` 训练时是常规步数，配 4 步会糊。用 **20 步、cfg 1.0**。
要快就另叠一个 DMD turbo，但那是另一个变量，先跑通再加。

### 2.4 一次只加一个变量

新 LoRA = 新轨迹。加第二个之前先固定 seed 跑一版基线，否则改坏了不知道是谁的锅。

---

## 3. 分遍叠（U24 的做法）

U24 把 LoRA 按"遍"分组，每遍给不同强度：

| 遍 | 意图 | 典型组合 |
|---|---|---|
| 一采 | 定构图与运动 | turbo 0.9–1.0 + Motion_Repair 0.7 + Combat 0.7 |
| 二采 | 提质感与细节 | turbo 0.5 + 真实质感 0.5 + Combat 0.49 + Motion_Repair 0.2 |

**同一 LoRA 在两遍用不同强度**是刻意的：一采要它"动起来"，二采要它"别乱动"。

---

## 4. 与采样器的搭配

| 采样器/调度 | 配什么 |
|---|---|
| `res_multistep` + `beta` | 默认，稳（我们的官方 API 工作流用它） |
| `dual_clock_euler` + `native_flow` | T8 双时钟（U24） |
| `ManualSigmas` | 自定义 sigma 表（B20） |
| `SplitSigmas` | 分段去噪（U30） |

cfg 恒为 **1.0**（H3 是 BasicGuider，无负面分支）。改 cfg 不会"更听话"，只会炸。

---

## 5. 常见错误

| 现象 | 原因 | 修 |
|---|---|---|
| 加了风格 LoRA 脸变了 | 与参考图抢权重 | 降到 0.4 或去掉 |
| 打斗还是软 | 只加了 Combat，没加 Motion_Repair | 补 Motion_Repair 0.2–0.7 |
| 换脸糊成一团 | 用了 4 步 turbo | 改 20 步 |
| 越跑越慢 | turbo 没生效（名字不匹配） | 查 `object_info` 里的实际文件名 |
| 二维漫剧变实拍 | 叠了写实质感 LoRA | 去掉，或换 2D 风格 embedding |
