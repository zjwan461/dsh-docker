# H3 提示词规格速查

来源：MiniMax 官方 `VIDEO_PROMPT_WRITING_GUIDE_base_en.md` / `_ref_en.md`（2026-09 版），ComfyUI 官方 prompt guide，以及社区实测。
本文件只记"写提示词时必须遵守的语法"，创作方法见 `manju-playbook.md` / `science-playbook.md`。

---

## 1. 三种任务形态

| 形态 | 触发条件 | 首行 |
|---|---|---|
| T2VA | 无参考图 | 直接三段 |
| I2VA | 1 张首帧 | `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.` |
| FL2VA | 首帧 + 尾帧 | `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.` |
| R2V（全参考） | 任意"身份/场景/道具/画风"参考图 | 六段式（见 §4） |

首行指令后**空一行**，再进正文字段。

---

## 2. 三段式正文字段

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

### 2.1 `integrated_multimodal_description`

- 按时间线写：画风、构图、主体外观与位置、场景与道具、动作与反应、切镜、说话人、台词、同步音效。
- `[Shot 1]` 开头**不写时间戳**；后续 `[Shot 2] At 00:03.500, the camera cuts to ...`。
- 切点必须严格递增，且 < 总时长。
- 切镜动词：`the camera cuts to` / `the shot cuts to` / `the shot transitions to` / `the shot changes to` / `the shot switches to`；需要时可用 dissolve / fade / wipe。
- 只有景别或轻微角度变化 → 用运镜，不要切。

### 2.2 运镜三要素

`类型 + 幅度 + 速度`，写成自然句：

- 类型：`Zoom In/Out`、`Push In/Pull Out`、`Pan Left/Right`、`Truck Left/Right`、`Tilt Up/Down`、`Pedestal Up/Down`、`Arc Shot`、`Tracking Shot`、`Static Shot`、`Shake Slightly/Strongly`、`POV`、`Roll Clockwise/Counterclockwise`
- 幅度：`with small amplitude` / `with large amplitude`
- 速度：`at slow speed` / `at fast speed`

```text
The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.
The camera holds a static shot as the runner exits the frame.
```

### 2.3 说话人与台词

- 说话人 ID：`(S1)`、`(S2)`；多人齐说 `(S1,S2)`；**不发声的角色不给 ID**。
- 身份/年龄/性别/画内画外/音高/音色/语速/口音写在 `<d>` 外。
- `<d>` 内只放语言标签 + 逐字台词：

```text
The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
```

- 标点：保留 `, . ? !`；去掉装饰性重复、emoji、省略号（省略号常损害可懂度）；听不清用 `[unclear]`。
- 画外音：固定句式 `says in an off-screen voiceover`，并在 `</d>` 后写"嘴唇完全闭合"。
- 跨切台词：两端加 `<scenetrans>`，并明说声音延续。
- 被结尾截断：`<cutoff>`。

### 2.4 画面可见文字

用英文双引号原样引用原文，不翻译：

```text
A red neon sign reading "营业中" glows above the doorway.
```

### 2.5 `overall_soundscape`

1–4 句，写环境声、动作声、非语言人声（风、雨、脚步、衣料、撞击、呼吸、笑、喘）。
**不要复述台词、唱歌、剧内音乐**。真正全静音才写 `N/A`。

### 2.6 `non_diegetic_music`

1–3 句，写配器、速度、节奏、动态变化；**不要写抽象情绪词**，不要解释"这段音乐想表达什么"。
没有就 `N/A`（省略会被模型自行补乐）。

---

## 3. 时间与镜头

- 一个 `[Shot N]` = 一个连续时空。主体、空间、状态、视角、时间任一改变 → 新镜头。
- 一条 5 秒的片子可以装 3–4 个镜头；15 秒装 4–6 个是上限，再多每个镜头就只剩 2 秒，动作做不完。
- 切点时间要按**实际帧数**算：124f=5.17s、158f=6.58s、243f=10.13s、362f=15.08s。
- 写 5 秒就按 5.17 秒排切点，否则最后一个镜头会被截。

---

## 4. 六段式（R2V）

```text
subject_definitions: ...
summary: ...
retention_analysis: ...
detailed_description: ...
overall_soundscape: ...
non_diegetic_music: ...
```

### 4.1 参考标签

| 标签 | 含义 |
|---|---|
| `<Subject N>` | 可复用的可见内容：人、动物、物体、场景、服装、道具、风格、动作、表情、姿势 |
| `<Picture N>` | 作为具体帧/构图锚点的参考图 |
| `<Video N>` | 参考视频（剪辑源、续接起点、时间结构） |
| `<Audio N>` | 参考音频（复制或参照音色/节奏/风格） |

同一标签在六段里含义必须一致。

### 4.2 `subject_definitions`

一行一个，写清：标签 → 是什么 → 来自哪张图 → 要跟随的特征。

```text
<Subject 1> is the young woman in <Picture 1>, with long dark hair, a blue cardigan, and a thin silver necklace.
<Subject 1> is the woman whose appearance comes from <Picture 1> and whose walking motion comes from <Video 1>.
```

只用图片定义角色/场景/服装/风格时，**不要**单独开 `<Picture N>` 条目，在 `<Subject N>` 里引用即可。
图片作为首帧/关键帧/尾帧/构图锚点时，才单独写：

```text
<Picture 2> is the first frame of [Shot 1], showing a woman seated beside a café window.
```

### 4.3 `summary`

一段英文，方括号任务类型开头，可用 ` + ` 组合：

`keyframe completion` / `reference generation` / `video editing` / `video continuation` / `audio reuse` / `audio reference`

```text
[reference generation + audio reference] The target video shows ...
```

### 4.4 `retention_analysis`

一行一个标签，写出现镜次 + 保留强度 + 保留了什么。视觉四档：

| 标记 | 含义 |
|---|---|
| `fully_preserved` | 定义的角色/特征完整保留 |
| `partially_preserved` | 用了，但部分特征改变或只保留一部分 |
| `attribute_transfer` | 特征迁移到另一个主体 |
| `weak_reference` | 只保留风格/类别/构图/氛围的宽泛相似 |

音频四档：`fully_copy` / `partially_copy` / `reference` / `weak_reference`。

### 4.5 `detailed_description`

- 开头 1–2 句定整体风格，再 `[Shot 1]`。
- 生成任务一般 350–500 英文词；对白密集时**优先保证台词时间线完整**，不要机械凑字数。
- 首次出现重要 `<Subject N>` 时描述其特征、画面位置、当前动作；后续直接用标签，不重复定义。
- 具体帧锚点用自然句：`the shot begins from <Picture 1>` / `the shot ends on <Picture 3>`。

### 4.6 多镜容器（每切一张关键帧）

```text
<Picture 1> aligns with the 0.00-second mark as the opening frame of [Shot 1]; <Picture 2> aligns with the 3.00-second mark as the frame of [Shot 2]; ...
```

后续 `[Shot 2] At 00:03.000, ...` 必须与对齐句一致。

---

## 5. 负面词：不要写

- `BasicGuider` 跑 `cfg=1`，没有负面分支。
- 禁用词表会把被禁概念带进画面（"no subtitles" → 满屏字幕）。
- 正确做法：正向描述画面内容；后期清画面；改景别。

> **社区争议**：Krea 等教程建议"句尾加 no text/no logos"，也有人报告"感觉有效"。
> 但官方结构里没有 negative 字段，而我们的实测是：V1 写了 `The frame is clean and unmarked`，
> 二维街景照样长出一片乱码招牌——**提示词压不住文字**。结论：别把否定句当开关，
> 用"画面里有什么"来占位（干净的墙、纯色背景、虚化光斑），文字一律后期叠。

---

## 6. 音频三条轨

| 层 | 字段 | 内容 |
|---|---|---|
| 台词/歌声/剧内音乐 | `integrated_multimodal_description` 的镜头行 | `<d>` 台词、喇叭里的歌 |
| 环境/动作/非语言人声 | `overall_soundscape` | 雨、脚步、呼吸、笑 |
| 观众独享配乐 | `non_diegetic_music` | 配器、速度、动态 |

三层都要显式写。任何一层空着，模型会用默认值填。

---

## 7. 已知行为（实测/社区）

| 行为 | 说明 |
|---|---|
| 中文语速 | 约 4.1 个可发声字/秒 |
| 首帧模式开口延迟 | 约 1.3–2.4 秒 |
| 双人同框 | 口型易落到更显眼的正脸；声线可能合并 |
| 近景 + 台词 | 容易把台词烧成字幕/衣服印花 |
| 文生模式 | 默认偏真人实拍；二维/三维要逐镜重申介质 |
| 否定句 | 会诱发被否定内容 |
| 2K vs 768P | 2K 只走 API；开源权重 768p 短边 |
| 上限 | 单次 1 首帧 + 1 尾帧 + 9 参考图；4–15 秒 |

---

## 8. 风格工具：embedding 与 LoRA

### 8.1 风格 embedding（ComfyUI）

ComfyUI 支持在 H3 提示词里写 `embedding:name`，文件放 `ComfyUI/models/embeddings/`。
触发词 = 文件名去掉扩展名。官方仓库附了 10 个社区风格 embedding：

| 名称 | 效果 |
|---|---|
| `minimaxh3_art_is_explosion` | 爆炸式构图 |
| `minimaxh3_blooming_flowers` | 花开 |
| `minimaxh3_bullet_time` | 子弹时间 |
| `minimaxh3_dark_magic` | 暗黑魔法氛围 |
| `minimaxh3_fire_breath` | 吐火 |
| `minimaxh3_four_seasons` | 四季转场 |
| `minimaxh3_kiss_camera` | 吻戏机位 |
| `minimaxh3_spiral_ascent` | 螺旋上升 |
| `minimaxh3_storm_magic` | 风暴魔法 |
| `minimaxh3_truman_show` | 楚门秀风格 |

用法：`... in the style of embedding:minimaxh3_dark_magic ...`。一个镜头最多一个，多了会打架。

### 8.2 风格 LoRA

- **风格 LoRA 会和参考图抢权重**。参考图必须保住时，LoRA 强度压到 **0.4–0.6**，或干脆不用。
- 打斗类 LoRA（如服务器的 `H3_Combat_V2`）会改动作分布，**先小强度试**，别一上来 1.0。
- 写实质感 LoRA（如 `MinimaxH3真实电影质感V0.1`）适合科普线，不适合二维漫剧——会把画风拉回实拍。
- 换 LoRA 等于换了一条生成轨迹，**seed 也要重抽**，不要拿旧 seed 比对。

### 8.3 选择顺序

1. 先靠提示词（介质 + 光源 + 材质）；
2. 不够再加 embedding（只加一个）；
3. 还不够才上 LoRA（0.4–0.6），并接受"参考图保真度下降"。

---

## 9. 提示词手艺：实测有效的细节

下面每一条都来自跑过成片后的对比，不是推断。

### 9.1 字数决定语速，不是片段长度

模型在**任意片段里只说话约占 57% 的时间**，剩下的留给动作和停顿。

- 于是：`片段秒数 = 字数 / 语速 / 0.57`
- 英文实测：22 词清晰（3.3 词/秒）、28 词是上限、34 词太快（4.7 词/秒）
- 中文按 4.1 字/秒换算，和本 skill 的字数表一致（5s → 约 12 字）

**写多了不会"说快一点"，会变成说了 57% 就没了**。想说完就加片长，别压字数。

### 9.2 显式要求"电影语法"

| 要什么 | 写什么 | 为什么 |
|---|---|---|
| 眨眼 | `she blinks`（两个人用 `both blink`） | 不写就是一双死眼 |
| 视线 | `her eyes stay on him`（全片说约 3 次） | 说一次会被稀释掉 |
| 光线稳定 | `the light level and colour hold from the first frame to the last` | 否则每镜重新打光 |
| 空房间 | `the room is empty` | 不写，背景会自己长人 |
| 只两个人 | `only two people are in the frame` | 同上 |

### 9.3 动作写"谁在动、动多少"

- **数从句：哪边多哪边赢。** 你写三句镜头运动、一句人物动作，出来的就是"镜头在动、人不动"。
- **幅度用距离界定**：`raises the cup a hand's width` 比 `raises the cup slightly` 准。
- **必须说清谁在动**：`the camera follows her` 不是 `it follows`。

### 9.4 手：说数量反而招来更多

- `held in two hands … the hands lift the lid` → 出来三只手。
- `rests in one open palm and the thumb of her other hand lifts it — only two hands` → 出来两只。
- **手部极端特写，无论怎么写都会糊手指**。做法：手在远景/中景里出现（小），切到物件特写。

### 9.5 别写粒子

`dust motes drift in the light` → 出来的是**忽明忽暗的高光点**（帧间变化 1.1–3.7，静止房间本该 0.3）。

尘埃、飞絮、光斑一律别写；要氛围用光位和景深。

### 9.6 参考图的朝向决定运动方向

一张"车头朝镜头"的参考图，你写 `pulls away` 也没用——**车还是会朝你开来**。

要"离开"，就给一张**背面视角**的参考图，并写 `seen from behind, getting smaller`。

### 9.7 道具图只定"种类"，不定"装饰"

一个盒盖上镶五角星的音乐盒，出来是六角、七角、八角——**木头、黄铜、颜色都保住了，唯独点数漂**。

要么选"形状大而简单"的道具，要么接受计数漂移。

### 9.8 默认的"暖金光"会打架

`warm golden light` 是安全默认值，但任何需要**变光**或**冷光**的场景都会被它拽回去。**每个场景单独指定光**，不要留给默认。
