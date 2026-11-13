# T8 高级管线（U22 9图3音 / U24 文武双修）

**结论：对 AI 漫剧和我们聊过的 AI 视频场景很有帮助。** U22 解决“多角色身份 + 音色一致”，U24 解决“文(对白)+武(打戏)同管线高质量”。两者都是**画布/API 级**工作流，`h3_generate` 跑不了（缺 T8/guide/audio 节点），需 ComfyUI 画布或 `/prompt` 提交。

来源：用户提供的两个 API 工作流（存于 [`workflows/`](workflows/)）+ [T8 仓库 README](https://github.com/T8mars/comfyui-minimax-h3-audio-T8)。服务器已含 T8 节点与所需模型/LoRA（object_info/inventory 可见），故可 `/prompt` 复跑。

---

## 1. U22「9图3音」= native r2v 满参考（多角色+多音色）

- **9 张参考图 + 3 条参考音频**，正好是 H3 r2v 的上限。
- 漫剧用法：
  - 9 图 = 每角色「脸 + 全身」参考 + 场景参考（如 2 角色×2 + 场景×1，或 3 角色×2 + 场景×3）。
  - 3 音 = 每个说话人一条**音色参考**，直接治“跨镜变声 / 同性别声线分不开”。
- 这是把我们 `dialogue-blocking.md` 的“角色锁 + 说话人绑定”落到**像素+声纹**层面的标准接法。
- native 节点 `ref_images`/`ref_audios` 用**列表**（见 face-swap §11 的坑：`ref_image_0` 是 UI 键，API 要列表）。

## 2. U24「文武双修T8版」= 两遍混合管线（对白+打戏+高清）

- **混合底模** `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8`：把 **fl2va（首/尾帧连续）** 与 **ref2va（参考身份）** 合在一个模型 → 漫剧“长片连续 + 角色锁”可同时成立，对接我们 Hub/Chain 连续性方案。
- **LoRA 栈（分遍给不同强度）**，即“文武双修”：
  - `MinimaxH3真实电影质感V0.1`（文/对白电影感）0.5 / 0.2
  - `H3_Combat_V2`（武/打戏）0.7 / 0.49
  - `Motion_Repair`（稳动作，治“打斗软/漂”）0.7 / 0.2
  - turbo 4step（`fl2v_turbo_4step_v1.2`、`10ErosMax`、`DasiwaREF2VAHybrid`）提速，分遍 0.5–1.0
- **两遍采样**：`MiniMaxH3DualClockSamplerT8`（`dual_clock_euler`/`native_flow`/8 步）一采 → `LearnedLatentUpscale` + `TwoPassLatentReconcile` + `TwoPassDetailMixer` 二采 → 定稿高清。对应我们“0.4MP 打样→定稿”，但是**图内两遍**而非重跑。
- **`MiniMaxH3AudioConditioningT8`**：`task_type=Ref2VA`、`audio_mode=native`、`strict_prompt_tags=True`、`ref_image_size=match`、`reference_video_policy=official_2_to_15s`；接受**点状键** `ref_images.ref_image_N` / `ref_audios.ref_audio_N`（T8 节点与 native 不同）。3 音槽示例为占位空白音频，需换成角色音色。
- 分辨率 16:9 / 0.4MP（打样档）。

## 3. 对我们场景的映射

| 我们的痛点 | 用 | 机制 |
|---|---|---|
| 跨镜变脸 | U22 9图 | 每角色脸+全身参考 |
| 同性别声线分不开/跨镜变声 | U22 3音 / U24 audiocond | 每说话人音色参考 |
| 对白+打戏都要好 | U24 LoRA 栈 | 电影质感+Combat+Motion_Repair |
| 打斗软/漂 | U24 Motion_Repair | 动作稳定 LoRA |
| 长片连续+角色锁 | U24 混合底模 | fl2va+ref2va 一体 |
| 定稿画质 | U24 两遍 | learned upscale+detail mixer |
| 情绪口播 | U24 audiocond + native-dialogue.md | native 音频+强表演短语 |

## 4. 集成注意 / 边界

- **只能画布或 `/prompt`**，`h3_generate` 不支持 T8/guide/audio。用 `python scripts/comfy.py --base <真实地址> submit --workflow references/workflows/U22-9图3音.json` 即可脱离插件提交（先 `upload` 参考图/音，再 `wait`/`download`）。
- T8 README 明确：**不保证**精确声纹、逐字时序、无接缝；**双采有轻微接缝变色**；EXP 工作流不通用，换素材/显卡/长窗需重验。
- 混合底模与 LoRA 需版本配对，别把同名不同版权重互覆盖。
- 服务器忙时**不要提交验证**；先存工作流与配方，闲时再跑。

## 5. 资产

- [`workflows/U22-9图3音.json`](workflows/U22-9图3音.json)
- [`workflows/U24-文武双修T8版.json`](workflows/U24-文武双修T8版.json)
