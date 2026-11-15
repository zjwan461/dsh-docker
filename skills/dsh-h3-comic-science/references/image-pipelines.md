# 生图管线（给漫剧/科普做静帧）

三条产线的前半段都是"先有静帧"：角色三视图、场景图、分镜关键帧、封面。这一份是生态工作流（见 `workflow-catalog.md`）里生图部分的提炼。

---

## 1. 四条主线，按用途选

| 用途 | 用什么 | 为什么 |
|---|---|---|
| 角色三视图/多角度 | **Qwen-Image-Edit 2509 + 多角度 LoRA** | 一次出前/侧/背，身份最稳 |
| 动漫→写实洗图 | **Qwen + AnythingtoRealCharacters LoRA** | 专治"AI 感/二次元脸"，漫剧转实拍 |
| 通用高质量静帧 | Qwen-Image-2512 / 2.1、Z-Image、Krea2 | 底模新、出图快 |
| 分镜/多机位叙事 | Flux2 Klein 9B 多角度 | 构图与镜头语言更强 |

---

## 2. 角色三视图：三种做法

### 2.1 Qwen-Image-Edit 多角度（推荐）

- 底模 `qwen_image_edit_2509`，编码用 `TextEncodeQwenImageEditPlus`。
- **并行 8 条分支**，每条一个角度提示词，各自 `KSampler` + `SaveImage`（B13 就是这么做的）。
- 社区版把 **Turbo(8step) + Multiple-Angles 两个 LoRA 烘进权重**（GGUF Q6_K，1024×1024、12 步、cfg 1.0、seed 42）。
- 提示词要点（官方样例的写法）：

```text
Show this exact <character> in one image as three separate full-body views in a row, evenly spaced:
front view facing the camera, left side view, and back view facing away from the camera.
In every view the head faces the same direction as the body — in the back view the head is also turned away
and the face is completely hidden. Keep the character design, clothing, lighting style and background
perfectly consistent across all three views.
```

**关键约束**：`head faces the same direction as the body`——不写这句，背视图经常给你一张转过来的脸。

### 2.2 Z-Image + 本地 LLM 扩写（C19）

- 底模 `z_image_turbo` / `Z-Image-Base-8steps-White_Marble-AIO`，8 步。
- 用 `llama_cpp`（`llama_cpp_model_loader` + `llama_cpp_instruct_adv`）先把你的短描述**扩写成结构化提示词**，再喂给 KSampler。
- 双采：第一遍定三视图排布，第二遍 `KSamplerAdvanced` 精修。
- 适合"我没想好怎么写提示词"的场景；LLM 扩写比手写稳定。

### 2.3 Krea2 三视图/四视图（T4/T10）

`Krea2EditGroundedEncode` 做 grounded 编辑，适合"给定一张定妆照，生成同一角色的多视图"。

### 2.4 三视图的通用铁律

1. **背景必须干净**（浅灰/纯白）——背景杂物会渗进角色。
2. **一次只改一个变量**：先定脸，再定服装，再定角度。
3. **背视图要显式要求"脸不可见"**。
4. 出图后**并排比对**，别单张看（单张看不出比例漂移）。

---

## 3. 动漫→写实（洗图）

`AnythingtoRealCharacters2511_20` LoRA（A08），两段式：

1. 第一段：低分辨率、较高 denoise，先"变成真人"；
2. 第二段：放大 + 低 denoise，补皮肤纹理与细节。

要点：

- **denoise 不要一步到位**（0.55–0.7 起步），太高会把角色特征洗掉。
- 洗图会**改变脸型**；洗完后重新做三视图，不要拿旧图当身份锚点。
- 洗图后的角色**不要和洗图前的镜头混剪**——观众会觉得换了演员。

**两条路选哪条**：

| | A08（Qwen-Edit + AnythingtoReal） | A08b（Krea2 + Anything2RealCharacters-V3） |
|---|---|---|
| 速度 | 约 160 秒（含 SeedVR2 放大） | **约 20 秒** |
| 保脸 | 编辑式，构图与五官保留得多 | img2img，denoise 0.75 会明显重画 |
| 质感 | 略"渲染感/BJD 娃娃" | 皮肤毛孔、碎发是实的，更像实拍 |
| 适合 | 要沿用原分镜构图、只清 AI 感 | 要"换成一个真人演员"、追求实拍感 |

A08b 的 denoise 是保脸/换人的旋钮：0.55–0.65 介于渲染与真人之间，0.75 明显换脸。触发词 `transform the image to realistic photograph`（作者 README 里给的）。

---

## 4. 高清放大与两遍采样

| 手段 | 说明 |
|---|---|
| `SeedVR2VideoUpscaler`（A01） | 视频/图像放大，保细节好 |
| `ImageScaleToTotalPixels` + 二次 KSampler | 经典 hires fix，denoise 0.3–0.45 |
| 三采（C18） | 构图→细化→放大，每遍换 LoRA 强度 |
| `LTX LatentUpscale` / H3 3D latent 放大（U30） | 视频侧，latent 域放大 |

**通用顺序**：`先构图（低分辨率）→ 再身份（中分辨率）→ 最后质感（放大+低 denoise）`。
反过来（先放大再改构图）最费时间且最容易崩。

---

## 5. 提示词：正向描述 + 结构化

这批工作流里的负面词几乎都是同一串：

```text
低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲
```

注意：**生图模型有负面词分支，H3 没有**。这串负面词只用于 SD/Qwen/Flux 这类 cfg>1 的模型，**不要搬进 H3 的 prompt**（H3 cfg=1，写了会反向诱发）。

正向写法（Qwen/Flux 系）：

```text
<主体与身份>，<动作>，<服装材质>，<场景与光源>，<镜头与景深>，<画质词：真实皮肤纹理 / 胶片颗粒 / 35mm>
```

---

## 6. 与 H3 的衔接

- 三视图/定妆照 → 上传 ComfyUI → 作为 H3 r2v 的 `ref_images`（脸+全身各一张）。
- 分镜关键帧 → H3 i2v 的 `first_frame`。
- **静帧质量就是视频上限**：参考图里没有的特征，H3 不会补（已实测）。

---

## 7. 清单

- [ ] 角色图：正面、均匀光、干净背景
- [ ] 三视图：背视图明确"脸不可见"
- [ ] 洗图后重做三视图，不与旧镜头混剪
- [ ] 放大顺序：构图 → 身份 → 质感
- [ ] 负面词只给 cfg>1 的生图模型，不进 H3

---

## 8. 近景别用 edit 重排，直接裁

- 用 Qwen-Image-Edit 要"大特写、手机不在画面里"，会输出**前景一张大脸 + 背景还有一个人**——两张输入里的"人"它都想保留。换措辞、换 seed 都不稳。
- 可靠做法：从已有中景帧**竖裁**（取脸 + 肩，`box` 后 resize 到目标尺寸），身份 100% 一致、0 秒成本。
- **"手挡脸"要明写手的位置**：写"手背抹眼角"十有八九糊在脸上；改成"左手自然放在膝盖上，手不挡脸，嘴巴微张正在说话"。
