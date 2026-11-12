---
name: dsh-h3-comic-science
description: 用 MiniMax H3 做两类竖屏/横屏叙事片：**AI 漫剧**（2–5 分钟、漫画/动画质感、角色跨镜不变、配音+字幕）与 **AI 科普短剧**（外星人+地球人双人对话、每句台词配一个可进入的比喻场景、数字必须有出处）。含 H3 官方提示词骨架（三段式 `integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`，六段式 r2v，`(S1)` 说话人，`<d>[Chinese] 台词</d>`，`[Shot 2] At 00:03.500` 切点）、**逐字台词四件套与多人站位（正反打/三人三角/四人分组/群戏分层/闭嘴锁）**、**运镜与转场（因果式运镜、动作接动作、30 度/声音桥、硬切/甩镜/穿入/尾帧接力）**、**长片连续性与剧集化（Hub/Chain 取舍、17k+5 帧规划、亮度漂移累积、剧集圣经、离线接缝检测）**、**交付质检（响度/真峰值/冻结/字幕安全区）**、**武打六拍与高动态（连续对轰、ULTRA_SPEED、招式配额、力场、冲击帧、震屏）**、**H3 没有负面词分支（cfg=1）——写 "no subtitles" 反而会把字幕招来**、**文生模式默认滑向真人实拍，二维漫剧必须每个镜头重申介质**、**中文对白约 4.1 字/秒且首帧模式会延迟 1.3–2.4 秒开口**、**同框两个正脸时口型会落到更显眼的那张脸上**、**本机 ComfyUI 默认模型名缺 `minimax/` 前缀会 400**、以及静态漫（关键帧+Ken Burns）比硬做动态漫更省更稳的取舍。要写漫剧/科普剧本、拆分镜、拼 H3 提示词、定镜长与配音方案时加载。
whenToUse: 用户要做 AI 漫剧、动态漫、漫画短剧、竖屏故事片；要做"外星人给地球人讲知识"这类双人对话科普；要写多人同框的站位与台词；要设计运镜、切镜、转场（镜头切换突兀、像 PPT 翻页、接缝明显、不知道该怎么转场）；要写武打、追逐、变身、爆炸等高动态镜头；要把剧本拆成 H3 分镜与提示词；要决定用 H3 原生对白还是 TTS 配音；要排查 H3 生成的画风漂移、口型错人、台词被截断、字幕自己冒出来、打斗"软"或像摆拍；要在共用 ComfyUI 上批量出镜头时。
metadata:
  version: 1
  requires: [ffmpeg, python3]
---

# H3 漫剧与科普短剧

两条产线，一套底层。先把 H3 的"脾气"弄清楚，再谈剧本——**它不是一个听话的摄像机，是一个会自己补戏的联合导演**。

配套：`dsh-minimax-h3-video`（工具与参数）、`dsh-video-still-first`（静帧一致性）、`dsh-video-narration`（TTS/混音）、`dsh-video-ffmpeg-post`（后期）、`dsh-video-structure`（片头片尾）。

---

## 0. 两条产线先选清楚

| | AI 漫剧 | AI 科普短剧（外星人+地球人） |
|---|---|---|
| 时长 | 60s–5min，一集一个钩子 | 2–5min，一集一个赌约 |
| 画风 | 2D 漫画/赛璐璐/国风条漫，**非实拍** | 写实电影感，外星人"实拍化" |
| 核心难点 | 角色跨镜不变 + 节奏 | 知识点可视化 + 数字准确 |
| 推荐声音 | **TTS 配音为主**，H3 只出环境声/音效 | 短句可 H3 原生；数字多、术语多则 TTS |
| 镜头量 | 25–60 镜（2–5s/镜） | 30–50 镜（3–6s/镜） |
| 一致性工具 | 三视图 + r2v | 双人设定图 + 场景图 + r2v |

**先做的判断：这片子要不要"动"？**

- 对话密集、信息密集 → **静态漫路线**：关键帧 + 缓推/平移（Ken Burns）+ 配音 + 字幕。成本约等于动态漫的 1/5，观感在竖屏上几乎不输。
- 有打斗、变身、穿越、情绪爆点 → 只把这些镜头做 i2v/r2v，其余静态。
- 全片都要"真动" → 预算按每镜 3–8 分钟 GPU 时间算，一集 40 镜就是 2–5 小时。

> 真实教训：漫剧最常见的失败不是"不够动"，是**每镜都在轻微漂移、切点全在飘**。静态漫的稳，反而是完成度。

---

## 1. H3 的硬规矩（写错就白跑）

### 1.1 三段式（t2v / i2v）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, ... The camera pushes in ... (S1) says: <d>[Chinese] 这雨不对劲。</d>
[Shot 2] At 00:03.500, the camera cuts to ...

overall_soundscape: Rain on concrete, distant traffic, one low synth note.

non_diegetic_music: N/A
```

- 第一条镜头**不写时间戳**；后续每条以 `At 00:03.500,` 开头，时间严格递增且落在总时长内。
- 切镜只写 `the camera cuts to` / `the shot transitions to`；只有景别变化就别切，用运镜。
- `overall_soundscape` 1–4 句，写环境声、动作声、非语言人声；**不要复述台词**。
- `non_diegetic_music` 写配器/速度；没有就显式 `N/A`（省略会被模型自己补一段配乐）。
- 对白：说话人 `(S1)`/`(S2)`，身份、年龄、音色、语速写在 `<d>` **外面**；`<d>` 里只放 `[Chinese]` + 逐字台词。
- 画外音：`says in an off-screen voiceover`，紧跟一句"嘴唇完全闭合"。
- 画面里真出现的文字用英文双引号原样引用：`a neon sign reading "营业中"`。

### 1.2 六段式（r2v，带任何参考图时）

```text
subject_definitions: <Subject 1> is the young man in <Picture 1>, ...
summary: [reference generation] ...
retention_analysis: <Subject 1> (appears in [Shot 1]): fully_preserved - ...
detailed_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: N/A
```

- 六段是**一条提示词**，必须整段一次提交，拆开就失去指代。
- `<Picture N>` 按 `refs` 数组顺序编号；`<Subject N>` 是可复用主体（人/景/道具/画风）。
- 保留强度四档：`fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`。
- **一个参考图可以有多个用途**：先写 `<Picture 1> is the opening composition`，再写 `<Subject 1> is the man in <Picture 1>`。

### 1.3 不要写负面词（这条最反直觉）

H3 的 `BasicGuider` 跑在 `cfg=1`，**没有负面分支**。你写 `no subtitles, no text, no watermark`，等于在 prompt 里增加了 `subtitles`、`text`、`watermark` 这几个概念。社区反复验证：否定句会**诱发**它否定的东西。

做法：
- 只写"画面里有什么"：`a clean frame, the character's face fills the frame`。
- 真要压字幕：在后期用干净的画面裁掉/遮盖，或把镜头改成中景（近景最容易烧字）。
- 非要写，也只写一句正向约束：`The frame is clean and unmarked.`

### 1.4 画风：文生模式默认滑向真人

H3 的训练分布偏实拍。二维漫剧只写一次 `anime style` 不够，**每个 `[Shot N]` 都要重申介质**，并明确排除实拍：

```text
[Shot 1] 2D hand-drawn anime, cel shading, clean bold line art, not live-action, not photographed, no real actors.
```

三维 CG 同理，而且更顽固——最好挂一张已定的三维起始帧走 i2v，而不是硬拼 t2v。

### 1.5 时长与分辨率

- 4–15 秒，24fps，帧数按 **17k+5** 吸附：5s→124f(5.17s)、6s→158f(6.58s)、10s→243f(10.13s)、15s→362f(15.08s)。
- 原生 1344×768（16:9），边长 32 的倍数。0.4MP 打样，0.7–1.0MP 定稿；**竖屏 9:16 生成后统一放大到 1080×1920**。
- 中文对白 **约 4.1 个可发声字/秒**；首帧模式常在 **1.3–2.4 秒**才开口。排镜长必须把这段等待算进去，否则台词必被截。

### 1.6 说话人绑定（对白戏的头号事故）

同框两张正脸时，口型经常落到**更显眼的那张脸**上，而不是 `(S1)` 那位。

- 一个镜头**只让一个人说话**，说话人的脸给到镜头；听者背身/过肩/出画。
- 必须同框时，明写不说话的人闭嘴：`The messenger does not speak; his lips remain completely closed.`
- 说话人第一次出现就给足辨识信息（谁、多大、什么音色、多快），台词紧贴他的动作句。
- 生成后**必须听**：声线是否合并、口型是否错人。自动检查抓不到。

### 1.7 共用 ComfyUI 的礼仪

服务器可能是别人也在用的。批量前：

1. `h3_runs action: "queue"` 看有没有别人的任务在跑；
2. 先跑 1 条验证提示词，再排队；
3. 一次只挂 1–2 条，不要一次提交 20 条；
4. **不要 cancel 不是自己提交的 prompt**。

---

## 2. 工程骨架

```
<project>/
  项目.json            # 画幅、风格、角色锁、声音方案
  EP01/
    剧本.md
    分镜.json          # 机器可读：每镜 mode/duration/line/speaker/refs/prompt
    提示词.md          # 人可读：逐镜可复制提示词
    refs/              # 角色三视图、场景图、起始帧
    clips/             # 生成结果
    vo/                # TTS
    out/               # 成片、字幕、封面
```

用 `scripts/scaffold.py` 一次建好，用 `scripts/check.py` 在生成前卡住四类错：时长放不下台词、说话人编号乱、r2v 没挂图、提示词缺三段字段。

`h3_project` 可以把分镜登记成镜头板（`save` / `add_shots`），生成时带 `project_id`/`shot_id`，跨会话不丢。

---

## 3. 漫剧产线

### 3.1 规格与节奏

| 项 | 建议 |
|---|---|
| 画幅 | 9:16，1080×1920 交付 |
| 集长 | 90–180 秒（抖音）/ 3–5 分钟（B站） |
| 镜长 | 2–5 秒；对话镜 3–4 秒 |
| 镜数 | 每分钟 12–20 镜 |
| 前 3 秒 | 必须给冲突/异常，不要交代背景 |
| 每 15 秒 | 一个小反转或信息增量 |
| 集尾 | 一句钩子 + 黑场卡，不要总结 |

### 3.2 角色锁定：三视图不是万能，但没它万万不能

1. 出**角色设定图**：全身三视图 + 正脸特写 + 3–4 个表情 + 2 个标志动作，纯浅灰背景。
2. 再出**面部识别板**：正面、均匀光、干净背景的大头特写。近景/特写镜必须挂它——只挂全身板，脸会漂。
3. 参考图排序固定：`1 起始帧 → 2 身份/脸 → 3 场景 → 4 道具`。顺序变了，`<Picture N>` 全部要改。
4. 连续性写成一条**能原样贴进提示词的短语**（连续性锁），例如 `pine-green lapel service jacket, silver rectangular glasses`，每镜照抄，不要每镜换形容词。

> 实测（2026-11-12，本机 t2v 4s）：一张双人设定图的**构图、身高差、服装层级、人物关系**都很稳，
> 但**眼睛颜色、额头印记**这类"小面积高辨识度特征"会漂——写了 amber eyes + diamond mark，出来是黑眼、
> 无印记。结论：**标志物必须在近景里单独挂一张参考图**，不能只靠一句形容词。
>
> 同日 r2v 复测（2 张参考图、4s、turbo 4 步）：**身份、服装、身高比、左右站位全部保住**，
> 连"外星人左前景 / 地球人右背景"这种构图指令也照做了。但两处没做到：
> ① 参考图里本来是黑眼、无额头印记，成片也照搬——**参考图没有的特征，r2v 不会替你补**；
> ② 写了 `eyes on each other`，两人仍然**看向镜头**，视线方向是弱指令。
> 结论：**站位靠文字能锁，视线靠构图/首帧锁**；要"对视"，就把对视画进起始帧。

### 3.3 静态漫 vs 动态漫

**静态漫（推荐作为默认）**

- 每镜一张关键帧，剪辑时做 100%→106% 的缓推、或左右 2–3% 的平移，2.5–4 秒。
- 对话镜切得干脆；情绪爆点用"定格 + 冲击线 + 音效"。
- 优点：零漂移、零等待、改一帧只改一张图。

**动态漫（只给关键镜）**

- i2v：首帧就是关键帧，提示词**只写运动**，不要重述画面（重述会打架，开场即跳）。
- r2v：跨镜锁人时用，同一组 refs 换 prompt。
- 每镜只允许**一个主要变化**：一次推近、一次转头、一次抬手。两个动作同时要，模型只会随机挑一个。

### 3.4 漫剧镜头语法（和实拍不一样）

| 目的 | 写法 |
|---|---|
| 强调 | 速度线、集中线、冲击帧、高反差闪白 |
| 心理 | 背景抽空成色块、人物缩小、留白 |
| 关系 | 分屏/斜切构图、前景遮挡 |
| 时间流逝 | 同一构图叠化、季节色板切换 |
| 信息 | 字卡/拟声字（**后期叠**，不要让 H3 画） |

**所有文字都后期叠**：气泡、拟声字、章节卡、字幕。H3 画中文必糊，而且会顺手把字幕烧进衣服。

### 3.5 声音方案（关键取舍）

| 方案 | 适用 | 做法 |
|---|---|---|
| **TTS 为主（推荐）** | 对话多、角色多、要跨集同声音 | H3 只出环境声/动作声，提示词写 `overall_soundscape`，`<d>` 全部删掉；TTS 逐句生成，按实测时长排镜 |
| H3 原生 | 短句、单人对白、想要"现场感" | 一镜一句、≤14 字、中景、说话人独占画面 |
| 混合 | 打斗/反应用原生，叙述用 TTS | 原生镜头不要有长台词 |

TTS 走 `dsh-video-narration`：逐句合成 → ffprobe 实测 → 按镜长 atempo（1.0–1.3）→ 逐镜响度对齐 → 混音 `normalize=0`。

### 3.6 漫剧提示词模板（i2v 动态镜）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean bold line art, not live-action. The composition, character design and lighting follow <Picture 1> exactly; keep the face, hairstyle, outfit and background unchanged. The camera pushes in with small amplitude at slow speed as his eyes narrow and his right hand tightens on the hilt. Wind lifts the loose strands of hair. He does not speak.

overall_soundscape: Wind through the alley, a faint metallic ring as the grip tightens, distant city hum.

non_diegetic_music: A single low taiko hit at a slow tempo, no melody.
```

> 注意：i2v 走三段式时，把 `<Picture 1>` 当"首帧"引用即可，不需要六段。

### 3.7 漫剧交付检查

- [ ] 每镜抽 5 帧拼横条看"动作有没有真的发生"
- [ ] 同一角色跨镜并排比对（脸、发型、衣服、标志物）
- [ ] 没有意外烧进画面的文字/水印/气泡
- [ ] 字幕不压脸、不越安全区（竖屏底部留 300–400px）
- [ ] 每集前 3 秒有钩子，集尾有钩子
- [ ] 配音与字幕逐字一致（数字、人名尤其）

### 3.8 台词与多人站位（两条产线通用）

**一句台词必须有四件套**，缺一个就出问题：

```text
<身份与音色> (S1)，<画内/画外>，<动作句>，says: <d>[Chinese] 逐字台词。</d>
```

- **双人默认正反打**：一人一镜，左右 + 朝向 + 距离写死（`LEFT foreground, body angled toward frame right, eyes on <Subject 2>`）。
- **同框必须锁嘴**：`Only <Subject 1> moves his lips; <Subject 2>'s lips remain completely closed.` 否则口型会落到更显眼的那张正脸上。
- **三人用三角形**：左前景背影、中景说话人、右背景听众；前景不要给正脸。
- **四人分两组**：左组/右组各占一半，镜头从桌子一端看进去。
- **群戏分三层**：前景虚肩、中景实人、远景剪影；人数写死（`exactly four people`）。
- **字数**：4s≈8–10 字、5s≈12–14、6s≈16–18、8s≈24–26、15s≈50–55（4.1 字/秒，扣 1.6 秒开口延迟）。超了就拆镜，不要加速。

完整模板（15 秒双人三镜、三人议事、四人对峙、群戏画外音）见 `references/dialogue-blocking.md`。

### 3.9 武打与高动态

**先选节奏，只能选一种**：

| 模式 | 8 秒镜数 | 适用 |
|---|---|---|
| 六拍 | 4–5 | 对决、单次重击 |
| 连续对轰 | 9–10 | 近身缠斗、压着打 |
| ULTRA_SPEED | 10–14 | 高速跟拍、不间停 |

- **每镜五小节**：Camera / Motion / Performance / Light / Sound。Motion 必须写"哪只脚承重、重心怎么移"——这是最便宜的打擊感。
- **六拍**：蓄 35% → 触 5% → 停 15% → 洩 25% → 退 15% → 收 5%。蓄 ≥ 触的 5 倍。
- **速度是密度不是形容词**：写 `high-speed` 会更慢；1–2 秒一镜 × 每镜 3 个具名动作才快。
- **冲击帧的真相**：写 `for two frames` 会给 21–23 帧；要精确 2 帧就走后期，或给足 1.2 秒写"8 张卡"。
- **最大的一击，相机要锁死**；震屏必须写衰减。
- **特效要当光源**：不照亮脸和地面，就会像贴上去的图层。

完整方法（六拍表、招式配额、力场四通道、8 秒/15 秒/二维漫剧模板）见 `references/action-dynamics.md`。

### 3.10 运镜、切镜与转场

三件事分开想：**运镜**是镜头内部怎么动，**切镜**是两个镜头怎么接，**转场**是两个时空怎么换。

**运镜**
- 官方只有三个维度：`类型 + 幅度 + 速度`，写成自然句，不要堆标签。
- **一镜一个主运镜**；`Static Shot` 和 `Tracking Shot` 不能同时写。
- 写"因果"不写"方向"：`He drives her back and the camera gives ground with them` ＞ `The camera pulls back`。
- 速度至少三档（爆速/快/慢/静），全片 `fast` 等于没节奏。
- **最大的一击，相机反而锁死**——冲击感来自特效推开背景。

**切镜**
- 只切"带来新信息"的：新主体、新空间、新状态、新视角、新时间、关键反应。只是更近一点 → 用推镜。
- **相邻镜头景别至少跳一级**；连续两个中景 = 剪辑死亡。
- **动作接动作**：上一镜终点 = 下一镜起点（位置/目光/双手/持物）。
- **30 度规则 + 锁轴线**：A 永远画左、B 永远画右；换边要整镜换。
- **声音桥**最隐形：画面切了，环境声/台词不断（`<scenetrans>`）。

**转场**
- 90% 用**硬切**，不要加淡化；硬切什么都不继承，加了反而像失误。
- 甩镜（写跟随对象+落幅）、遮挡擦除（柱子/门/衣摆）、图形匹配、白场/黑场、溶解（只用于时间流逝）。
- **穿入**是科普片的核心转场：镜头推进瞳孔/屏幕/冰箱灯/门缝，入口填满画面，穿出即新空间；中间不切黑。
- 分开生成时：硬切直接拼（头尾 6ms 防爆音）；要连续用**尾帧接力**（从最后 0.5 秒挑干净帧）；要变形用 FL2VA。

完整写法（八种转场、尾帧接力三个坑、突兀诊断表、可复制模板）见 `references/camera-and-transitions.md`。

### 3.11 长片连续性（超过 15 秒就绕不开）

H3 一次只有 4–15 秒，长片就是**一串接缝**。三条实测结论先记住：

1. **单张关键帧只钉姿态，钉不住速度。** 切点那帧能对上 35.6 dB，1/4/8/12 帧后掉到 32 / 28 / 24 / 23 dB——**截图像、播放跳**。
2. **漂移会累积。** 每个解码编码来回暗约 1 luma，18 段链实测末段暗 **19%**。
3. **景别会自己爬。** 写 "pushes in slightly"，连挂六段变大特写。

**本机已验证（2026-11-12，同锚点四段 i2v 4s/0.4MP/8步，提示词完全相同）：**

| | 链式（A→B→C） | Hub（锚点→D） |
|---|---|---|
| 亮度相对锚点 | −2.3 / −4.4 / **−7.2**（3 跳 −8.6%） | **−2.5（永远 1 跳）** |
| 每个接缝 PSNR | 33.8 / 34.2 dB（都好） | 33.3 dB |
| 第 3 跳 vs 锚点 | **13.1 dB（已不是同一画面）** | — |

**漂移不在接缝上，在接缝之间**：每个切点单独看都"接上了"，三跳后整体偏掉。Hub 每次从锚点重出发，误差不叠加。另发现**段内亮度自己回弹 ±4**，比每跳损失还大——所以"全片链完再统一拉亮"不可靠，必须逐段对齐或用 Hub。详见 `references/longform-continuity.md` §1.5。

#### Hub 还是 Chain（最重要的决策）

| | 链式 Chain | 轮毂式 Hub |
|---|---|---|
| 结构 | A→B→C→D 逐段接 | 每段都从同一锚点出发 |
| 误差 | **累积** | **不累积**（起止同点可到 33.8 dB） |
| 适合 | 追逐、打斗、一镜到底 | 对话、对峙、议事、群戏 |
| 代价 | 第 4 段开始明显 | 每段必须回到开场姿态构图 |

**本插件适合"场次内 Hub + 场次间硬切"**，不适合长链一镜到底。

#### 帧规划按帧不按秒

帧数是 **17k+5**：5s→124f(5.167s)、8s→192f、10s→243f(10.125s)、15s→362f(15.083s)。
**排时间线用实际秒**，三段 5 秒接起来是 15.50 秒不是 15 秒。

#### 四种接法

续接（末帧 PNG 当首帧，**连 PNG 不要连 latent**）/ 硬切（什么都不继承，**别加交叉淡化**，头尾 6ms 防爆音）/ 新场（只继承画风）/ 桥接（2–4 秒过渡镜，A/B 都不用重渲）。

#### 必做的两件事

- **亮度漂移**：以第 1 段末帧的 YAVG 为基准，用 ffmpeg `eq` 拉回，增益控制在 0.75–1.35；超出说明光影本来不同，别硬拉。
- **环境声**：同场次写同一句并声明 `continues unchanged`，否则每个切点"呼"一声。**只写画面里真有东西发出的声音**——天气/交通铺底会渲染成嘶声。

#### 工具

- `scripts/seam.py`：**离线**量接缝。PSNR ≥33 续接 / 25–33 可接受 / <25 硬切；能检出"B 在复读 A 的结尾"（该裁重叠）和亮度跳变（>8 会闪）。
- `scripts/qa.py`：响度/真峰值/冻结/黑场。
- `scripts/scaffold.py` 现在会生成 `bible.md`（角色/场景/状态机/声音/接法约定）。

#### 能力边界（诚实说明）

本插件**没有**尾帧槽、参考视频/音频、移动引导帧、音频锚点、亮度对齐。所以：**Hub 的"收于同一点"只能靠提示词**，跨段声线锁不住，接缝抖动比官方方案大。要做长链，用 `ComfyUI-H3-Continuity-Studio`（喂前段五帧 latent 记忆）或官方 API。

完整方法（量化数据、Hub/Chain 决策、帧规划公式、漂移修正、剧集圣经模板、诊断表）见 `references/longform-continuity.md`。

完整方法（剧集圣经模板、四种接法细节、漂移诊断表、3 分钟拼法）见 `references/longform-continuity.md`。

---

## 4. 科普产线（外星人 + 地球人）

### 4.1 叙事骨架（照抄，别自创）

一条被验证过的结构（来自开源项目 `ai-science-series`，270 秒 9 段）：

```
钩子（地球人说一句反常识的话）
  → 外星人下注（"我赌你 N 天后求我"）
    → 第 N 天时间线（第1天 / 第3天 / 第7天 / 第21天…）
      → 每个知识点 = 一次"钻进身体/系统"的比喻场景
        → 地球人求饶 → 赌约兑现
          → 揭晓代价（2–3 条，最后一条最扎心）
            → 下期新赌约 + 关注
```

四个必须：

1. **两个人设反差**：地球人冲动、立 flag；外星人只信数据、说话慢、带点损。
2. **一个赌约贯穿全片**，每个时间点兑现一次预告。
3. **一句台词一个画面**：数字不能只靠嘴说，要变成能看见的东西。
4. **每个数字有出处**（作者/期刊/样本量），查不到就不写。

### 4.2 知识点可视化：把数字变成一个"能进去的房间"

这是这类片子唯一的核心手艺。公式：

```
现实物件（冰箱灯 / 杠铃片孔 / 体重秤屏幕 / 瞳孔 / 喷嚏飞沫）
  → 镜头推进/穿过它
    → 穿出后是一个荒诞但自洽的空间（控制室 / 仓库 / 银行 / 工地）
      → 空间里有一个可读的仪表/货架/账单/墙
        → 数字变化 = 指针/灯光/箱子被搬走
```

镜头语言固定为**连续镜头**：`镜头推进 X → 画面亮/暗一下 → 穿出已在 Y 空间，中间不切黑`。这条接缝做得好，片子就"高级"；做不好就是 PPT 翻页。

常用空间词典：

| 知识点 | 空间 | 可视化的数字 |
|---|---|---|
| 激素/饥饿 | 发电站控制室，红绿两块圆表 | 指针甩到头/掉到底 |
| 精力/睾酮 | 电池仓库，货架上一排发光电池 | 十节里灭一两节 |
| 睡眠债 | 老式银行大厅，账单越拉越长 | 账单长度 |
| 肌肉合成 | 身体里的工地，红墙=肌纤维 | 拆墙/砌墙 |
| 免疫 | 酒店走廊，一扇扇门后有人在咳 | 开门的比例 |
| 死亡风险 | 望不到头的跑道，人群身上的光罩 | 光罩覆盖率 |

### 4.3 时长与台词预算（H3 版）

旧的 30 秒一段是给 Seedance 的；H3 一次最多 15 秒，所以：

| 单元 | 时长 | 镜头 | 中文台词上限 |
|---|---|---|---|
| 一个"段落" | 14–15s | 3–4 镜 | 55–60 字（含标点停顿） |
| 一个对话镜 | 3–5s | 1 镜 | 12–18 字 |
| 一个空镜/转场 | 2–3s | 1 镜 | 0–8 字（画外音可跨镜） |

> 4.1 字/秒是常速。写到 60 字/15 秒就是满负荷，没有留白、没有音效呼吸，听感会赶。
> **宁可多切一镜，不要把 80 字塞进 15 秒**——H3 会加速、吞字，或者直接截断。

### 4.4 双人调度

- 对话**不要**让两人同框抢话：正反打，一人一镜。
- 外星人说话时，地球人背身/过肩；地球人说话时反过来。
- 外星人的"非人感"靠**光**：额头印记亮起、扫描光、全息屏。这些写进 `overall_soundscape` 配电子音。
- 两人同框的定场镜每段开头给一次就够，别每镜都双人。

### 4.5 科普提示词模板（双人对话，r2v）

```text
subject_definitions: <Subject 1> is the young Chinese man in <Picture 1>, 25 years old, slim, short buzz cut, black square-framed glasses, grey hoodie. <Subject 2> is the humanoid female alien in <Picture 2>, tall and slender, pearl-grey skin, bald head, huge amber eyes, a glowing diamond mark on her forehead, deep navy coat with light-blue trim. <Subject 3> is the rented room in <Picture 3>, with a single bed, a computer desk by the window, and a handwritten plan on the wall.

summary: [reference generation] In the rented room, the man challenges the alien to a 100-day bet; she scans him and names the price he does not know yet.

retention_analysis: <Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - face, glasses and grey hoodie stay identical. <Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - skin texture, forehead mark and coat trim stay identical. <Subject 3> (appears in [Shot 1], [Shot 2]): partially_preserved - bed, desk and lamp positions are kept; small props may follow the action.

detailed_description: [Shot 1] Live-action, cinematic, 35mm, shallow depth of field. A medium shot frames <Subject 1> sitting on the bed in <Subject 3>, lit only by the phone in his hand. He frowns at the screen and says in a fast, young male voice: <d>[Chinese] 睡觉比健身重要一万倍？</d> He lowers the phone. [Shot 2] At 00:04.000, the camera cuts to a medium close-up of <Subject 2> standing beside the bed, her forehead mark brightening. She says in a calm, slow adult female voice: <d>[Chinese] 一万倍是夸张了。但少睡去健身，代价没人提。</d> Her lips close. <Subject 1> stays out of frame.

overall_soundscape: A quiet room at night, the soft tap of a finger on a phone screen, a faint electronic hum when the forehead mark lights up.

non_diegetic_music: N/A
```

### 4.6 事实与合规

- 每个数字进**出处表**：台词、出处（作者/期刊/年份）、样本量、注意事项。查不到的不写。
- 健康类内容不给治疗建议；用"研究发现/相关性"而不是"一定会"。
- 只做原创角色，不照搬他人账号的人设与台词。
- 发布标注 AI 生成；H3 权重是社区许可（排除美/欧/英/韩），商用前看清条款。

---

## 5. 后期装配（h3_post）

```text
生成 → concat（同源 copy / 不齐 normalize）→ 字幕（硬）→ 混音 → loudnorm −16 → ratio 9:16 → poster 封面
```

- **合片**：`op: "concat"`，第一段 `source`，其余 `extras`。同尺寸同帧率用 `copy`，否则 `normalize`。
- **字幕**：`op: "subtitle"`，`extras: ["upload:subs.srt"]`；漫剧坚持硬字幕，软字幕在抖音会被吞。
- **响度**：`op: "loudnorm"`, `{ i: -16 }`。成片忽大忽小九成是漏了这步。
- **竖屏**：`op: "ratio"`, `{ aspect: "9:16", mode: "crop" }`（`pad` 保留全画面）。
- **质检**：`op: "contact_sheet"` 一眼看完整片镜头分配；`op: "poster"` 抽封面。
- **字卡/章节卡**：用 ASS 一层写完全部叠加（标题、第 N 天、拟声字、CTA）。**不要在一个 filtergraph 里串两个 `subtitles=`**。

字幕规范：`PlayResX/PlayResY` 必写；竖屏 `MarginV` 300–400；一句话不超过 16 字，超过就拆行；数字用阿拉伯数字，和配音逐字对照。

### 5.0 字幕：原生渲染 vs 后期烧录（**不要无脑烧**）

H3 **能**把字幕画进画面（官方描述：renders text, subtitles, brand assets, UI），但那是**像素，不是字幕轨**——改一个字要重渲，换语言要重渲。而且 H3 **会自己加字幕**（社区常见抱怨；韩语对白几乎必带，因为训练数据里韩语视频自带字幕）。官方结构里**没有 subtitle 开关**。

所以先选路线：

| 路线 | 可编辑 | 可翻译 | 用在哪 |
|---|---|---|---|
| 原生渲染（双引号写死） | ❌ | ❌ | 字卡、歌词排版、UI、招牌——**文字本身是设计** |
| **后期烧录（默认）** | ✅ | ✅ | 对白字幕、多平台分发 |
| 软字幕轨 | ✅ | ✅ | 要开关、B站/YouTube |

**三条硬规则：**

1. **烧之前先查底部有没有已烧的字**：`python qa.py <clip> --textcheck` 出一张底部横条图，3 秒看完。已有字还叠一层 = 双行字幕，最常见的翻车方式。
2. **品牌名、产品名、数字、外文，一律后期叠**。H3 渲长句和精确名词会崩（乱码、错字、逐帧闪动），烧错的名字比没有更糟且事后修不掉。
3. 抑制字幕可以试一句 `Screen: no subtitles, no on-screen text, no watermark.`，但**社区结果有分歧、不能指望**；兜底仍是改中景、裁切、重生成。

完整调研（三条路线对比、官方的 MV 字幕设计层规则、双字幕三种形态、兜底手段）见 `references/subtitles.md`。

### 5.0.1 BGM：音乐没有分轨，这一条决定架构

**H3 输出的是一条混好的音轨**（对白+环境+音效+音乐），**平台不提供 stems**。所以"保留对白、只换音乐"做不到——要改只能重生成，画面跟着变。

更麻烦：**H3 会自己加音乐**（省略 `non_diegetic_music` 就自己补；环境声写太满会渲染成嘶声甚至变音乐）。

**决策：**

| | 用原生音乐 | 外挂独立音乐轨 |
|---|---|---|
| 单镜、≤15s、不动 | ✅ | — |
| **多镜拼接、>15s** | ❌ | ✅ **默认走这条** |

原因一句话：**5–15 秒出不来音乐的弧线**——三段拼接就是三首曲子的接缝，不是一首 30 秒的曲子。

**要 H3 不出音乐，就显式写 `non_diegetic_music: N/A`**（留空=自己补）。写原生音乐时只写乐器/速度/节奏/动态，**不写情绪词**。

**后期三条铁律：**
1. 先标准化对白到 −16 LUFS，**再**铺音乐，最后限幅——H3 原生音轨本就接近 0dB，顺序反了必爆。
2. 音乐比对白低 **12–18 dB**，并用 **sidechain 闪避**（不是把 BGM 整体调小）。
3. 音乐要**循环铺满 + 片尾 1.5s 淡出**；逐段生成的音乐会在每个切点"重启"，像每 5 秒换张 CD。

完整实践（混音电平表、闪避参数、跨切点连续性对策、实测记录、版权）见 `references/bgm.md`。

**导出前跑一次 `scripts/qa.py`**：一次报出分辨率/帧率/音轨/响度/真峰值/冻结段/黑场/场景切换数。
实测三条 0.4MP 样片：V2 的集成响度 **−10.2 LUFS、真峰值 +1.2 dBTP**（已削波），必须限幅；V1/V3 峰值也接近 0dB。**H3 原生音轨默认偏爆，别直接发。**

完整交付规范（安全区、字幕、封面尺寸、合规）见 `references/delivery-and-qa.md`。

### 5.1 命令行替代（`h3_post` 不可用时）

本机 `h3_post` 因为 `%TEMP%` 不可写，所有操作返回 `FFmpeg exited with code -13`。用 `scripts/finish.py` 替代，**一条命令跑完整个后期**：

```bash
python finish.py --out final.mp4 --clips clips/*.mp4 \
    --aspect 9:16 --subs-from EP01/分镜.json --music bgm.mp3 --poster --sheet
```

它做的事：统一尺寸帧率（缺音自动补静音）→ 合片 → 两遍 loudnorm → 从分镜 JSON 生成 ASS 并烧字幕 → **铺 BGM（sidechain 闪避 + 片尾淡出）** → faststart → 封面 + 分镜缩略图。
中间文件落在 `--workdir`（默认 `./.finish`），**不碰 TEMP**。

实测（三段 0.4MP 素材）：输出 1920×1080 / 24fps / 25.458s，响度 **−16.0 LUFS、峰值 −2.0 dBTP**，字幕按 `17k+5` 吸附后的真实时长排，`qa.py` 全绿。

---

## 6. 成本与吞吐

| 动作 | 量级 |
|---|---|
| H3 单镜（0.4MP，turbo，5s） | 1–3 分钟（看卡） |
| H3 单镜（1.0MP，满步，10s） | 6–15 分钟 |
| 一集 40 镜漫剧（全动态） | 2–5 小时 GPU |
| 一集 40 镜漫剧（静态为主） | 0（只出图）+ 剪辑 |
| TTS 一集 60 句 | 3–6 分钟 |

**先静态、后动态**：把整集用关键帧+配音剪出一版，确认节奏和台词，再挑 5–8 个镜头做动态替换。返工成本最低。

---

## 7. 本机环境已知坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `h3_post` 所有操作 `FFmpeg exited with code 4294967283`（=−13） | ffmpeg 往 `%TEMP%` 写文件被拒 | **直接用 `scripts/finish.py`**（写入 `./.finish`），不依赖 h3_post |
| `value_not_in_list: unet_name 'minimax_h3_...'` | 插件默认名缺子目录前缀 | `models: {"unet": "minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors"}`（本机已实测可用） |
| 同上，`lora_name 'minimax_h3_fl2v_turbo...'` | 同上 | `models: {"lora": "minimax/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"}`（本机已实测可用） |
| r2v 开 turbo 报缺 LoRA | 该服务器没装 `ref2v_turbo_4step` | r2v 关 turbo，或先用 t2v/i2v |
| 生成排队很久 | 共用服务器 | 先 `queue` 看，再逐条提交 |
| `invalid output: value is not lossless JSON` | 同步模式偶发 | 改用 `mode_run: "async"` + `job_output` |
| `h3_post` 所有操作失败，`FFmpeg exited with code 4294967283`（= −13） | ffmpeg 往 `%TEMP%` 写文件被拒（本机 `D:\temp` 不可写，但 workspace 可写） | 改用 `scripts/finish.py`；或把 `TEMP`/`TMP` 指到可写目录并重启 DSH |
| `h3_generate` 报 `invalid output: value is not lossless JSON` 或 `session ... has no live agent` | 工具返回层坏了，但**任务往往已经提交** | **先 `h3_runs action: "list"` 看有没有新 run**；有就取结果并取消重复任务，不要连续重试（本机实测重试会建出重复任务，白占队列） |

---

## 8. 一页流程（照着做）

**漫剧**

1. 定题材/钩子/集尾 → `剧本.md`（场景、动作、台词、音效）
2. `scaffold.py` 建项目 → 出三视图 + 场景图 → 上传
3. 拆 25–40 镜，每镜写：景别、起点、唯一动作、终点、台词、音效
4. 默认静态：每镜一张关键帧；挑 5–8 镜做 i2v
5. TTS 配音 → 实测时长 → 定镜长 → 拼片
6. 字幕/字卡/拟声字 → loudnorm → 封面

**科普**

1. 选题 → 查 5–8 条有出处的数字 → 出处表
2. 按骨架写 14–15 秒段落 × 12–18 段
3. 每个知识点配一个"穿进去"的空间 + 一个可读的仪表
4. 双人设定图 + 3–5 个空间图 → r2v 逐段生成
5. 每段先 0.4MP 打样，确认台词与转场，再定稿
6. 拼片 → 字幕（数字逐条核）→ 响度 → 封面

---

## 9. 附带文件

| 文件 | 用途 |
|---|---|
| `references/h3-prompt-spec.md` | 官方格式全文速查：三段/六段、标签、时间码、保留强度、音频三层 |
| `references/dialogue-blocking.md` | 台词与站位：双人正反打、三人三角、四人分组、群戏分层、闭嘴锁、字数表 |
| `references/camera-and-transitions.md` | 运镜（因果式/三档速度）、切镜（动作接动作/30度/声音桥）、八种转场、尾帧接力 |
| `references/longform-continuity.md` | 长片连续性：Hub/Chain、17k+5 帧规划、亮度漂移、接法、剧集圣经、能力边界 |
| `references/delivery-and-qa.md` | 交付规范：安全区、字幕、响度、封面尺寸、合规、qa.py 用法 |
| `references/subtitles.md` | 字幕路线决策：原生渲染 vs 后期烧录、H3 自动加字幕、文字可靠性边界 |
| `references/bgm.md` | BGM：没有分轨、原生 vs 外挂、闪避与电平、跨切点连续性、实测记录 |
| `references/action-dynamics.md` | 武打与高动态：六拍、连续对轰、ULTRA_SPEED、招式配额、力场、冲击帧、震屏 |
| `references/manju-playbook.md` | 漫剧：分镜表模板、镜头词表、静态漫做法、节奏与钩子、常见崩坏 |
| `references/science-playbook.md` | 科普：完整骨架、空间词典、示例段落、出处表模板、双人调度 |
| `references/templates.md` | 可直接复制的提示词模板（漫剧 i2v/r2v、科普 r2v、穿越转场、空镜、字卡） |
| `scripts/scaffold.py` | 建项目目录 + `分镜.json` + 提示词骨架 |
| `scripts/check.py` | 生成前校验：时长/台词容量/说话人/r2v 挂图/字段完整性 |
| `scripts/qa.py` | 交付前质检：分辨率/帧率/响度/真峰值/冻结/黑场/场景切换数 |
| `scripts/seam.py` | 离线接缝检测：PSNR 判续接/硬切、复读检测、亮度跳变 |
| `scripts/finish.py` | 命令行成片装配：统一画幅→合片→响度→自动字幕→封面（`h3_post` 的替代） |

---

## 10. 验证记录（2026-11-12，本机）

| 项 | 结果 |
|---|---|
| `scaffold.py` | 通过，能建 manju / science 两种项目 |
| `check.py` | 通过正反用例：合法镜头放行；"5 秒 35 字"、缺六段字段、切点越界都能拦住 |
| 模型覆盖 | `unet` / `lora` 加 `minimax/` 前缀后生成成功（此前 400） |
| 4s 实际帧数 | 107f = 4.46s，符合 17k+5（旧插件文档里的 "4n+1" 说法不准确） |
| t2v 双人设定图 | 构图/服装/关系稳；眼睛颜色、额头印记漂（见 §3.2） |
| `h3_post` | 本机全部操作 −13，原因是 TEMP 不可写（见 §7），改用命令行 ffmpeg |
| 中文口型 / 双人串声 | **部分验证**：r2v 4s 单句中文台词生成成功，音轨存在；未做人耳听辨与声线分析 |
| r2v 跨镜一致性 | **已验证**（2026-11-12）：2 张参考图 + 4 步 turbo，身份/服装/左右站位保住；见 §3.2 |
| r2v 的视线/对视 | **弱指令**：写 `eyes on each other` 仍看向镜头；要对视得画进起始帧 |
| `h3_generate` 返回异常 | 任务实际已提交；重试会产生重复任务，已在 §7 记录 |

### 10.0.2 后期链路离线实测（三段素材跑通）

用本机已有三段 0.4MP 素材跑 `finish.py`，产出可播成片：

| 项 | 结果 |
|---|---|
| 输入 | V1 9:16 480×864 + V2/V3 16:9 864×480（画幅不齐） |
| 统一后 | 1920×1080 @ 24fps，竖向素材自动补边 |
| 时长 | 25.458s（611 帧）= 5.167 + 12.25 + 8.0 |
| 响度 | **−16.0 LUFS / −2.0 dBTP**（两遍 loudnorm 命中目标） |
| 字幕 | 从 `分镜.json` 自动生成 3 条 ASS，按 17k+5 吸附的真实时长排，烧录位置正确 |
| 产物 | 成片 + `_poster.png` + `_sheet.png` |
| `qa.py` | 全绿 |

**结论：服务器不可用时，后期链路完全不依赖 ComfyUI，可以先剪出结构版。**

### 10.0 0.4MP 三条验证的实测结果（2026-11-12）

| 条 | 参数 | 结果 |
|---|---|---|
| **V1 二维漫剧** | t2v / 9:16 / 5s（124f）/ 0.4MP / 8 步 | **画风守住**：赛璐璐、粗线条、平涂，没有滑向实拍；竖屏正确。**但**：① 运动量极低，五帧几乎一样（小幅度推镜在 0.4MP 下约等于不动）；② 街景自动长出**乱码招牌**，即使没要求文字；③ 音轨存在、峰值 −0.3dB（偏爆），中文台词是否念对**未做人耳确认** |
| **V2 三人站位** | r2v / 16:9 / 12s（294f）/ 0.4MP / 4 步 | **三角站位成立**：女左前景背影、外星人中景、男右后景落座；第二镜切单人特写正确；第三个人物（文字描述、无参考图）也能稳住。三人同框时另外两人闭嘴，没有明显串嘴 |
| **V3 六拍打斗** | t2v / 16:9 / 8s（192f）/ 0.4MP / 8 步 | **有打击感**：低角度起手、腾空、环轨、银发男特写、落地扬尘都在；特效当光源做到了。**但**：① 采样帧里没抓到白闪冲击帧（可能只有 1–2 帧，被 0.4MP 采样跳过）；② **对手在最后两镜消失**，收尾没有"两人对峙"，只剩女主；③ 末镜仍未真正定格 |

三条共同结论：

- **0.4MP 只能验证结构，不能验证质感**；动作幅度要按"打样档"放大，否则小推镜几乎看不出来。
- **H3 的原生音轨一定存在且偏响**（峰值接近 0dB），后期必须 `loudnorm` + 限幅。
- **插件状态会滞后**：三条都显示 `queued`，但 `h3_assets list` 里成品已经在 output。**以 output 文件为准**，不要等状态。

### 10.0.1 `qa.py` 实测（同三条）

| 文件 | 响度 | 真峰值 | 场景切换 | 结论 |
|---|---|---|---|---|
| V1 | −14.5 LUFS | −0.3 dBTP | 0 | 单镜没问题，峰值仍偏高 |
| V2 | **−10.2 LUFS** | **+1.2 dBTP** | 2 | 已削波；3 镜=2 切，检测对得上 |
| V3 | −15.1 LUFS | −1.2 dBTP | 4 | 5 镜=4 切，检测对得上 |

- `qa.py` 的 `cuts` 数和分镜镜数（镜数 − 1）一致，可以当"切点有没有被吞"的快速核对。
- **V2 是典型事故**：原生对白 + 环境声直接叠加，峰值冲破 0dB。批量生产时必须逐条过 `qa.py`，不要等成片才发现。

### 10.0.3 Hub vs Chain 实测（服务器恢复后，2026-11-12）

同锚点四段 i2v 4s/0.4MP/8步、提示词完全相同。链 A→B→C，Hub 锚点→D。

| 指标 | 链式 | Hub |
|---|---|---|
| 亮度相对锚点 | −2.3 / −4.4 / −7.2（3 跳 −8.6%） | −2.5（1 跳） |
| 每接缝 PSNR | 33.8 / 34.2 dB | 33.3 dB |
| 第 3 跳 vs 锚点 | 13.1 dB | — |

**结论：漂移在接缝之间，不在接缝上；Hub 不累积。** 段内亮度还会自己回弹 ±4，比每跳损失大，故"链完统一拉亮"不可靠。详见 `references/longform-continuity.md` §1.5。

### 10.0.4 二维漫剧大幅度运镜复测（V1b）

V1 用 `small amplitude` 五帧几乎不动；V1b 改 `large amplitude at fast speed` 复跑，验证"打样档要放大幅度"。结果见 `references/manju-playbook.md`。

**打斗收尾已修（2026-11-12）**：V3 末两镜对手消失 → 单独生成一镜"两人对峙"（`v3_end`，5s，静态双人镜头，五帧两人都在），
把 V3 裁到 6.2s 再接上，得 `fixed_fight.mp4`（11.48s，48kHz，−17 LUFS，QA 全绿）。**收尾不要指望模型自己留住两个人，单独补一镜最稳。**

下次只剩：中文口型人耳听辨 + 声线分析（音轨已导出给用户）。

### 10.1 低质量验证协议（0.4MP，一次跑完三条）

任何新提示词套路，先用这套最小验证，不要直接上定稿：

| 条 | 内容 | 参数 | 看什么 |
|---|---|---|---|
| V1 | 竖屏二维漫剧，单镜中文台词 | t2v / 9:16 / 5s / 0.4MP / turbo | 画风是否滑向实拍、台词有没有出、口型跟不跟 |
| V2 | 三人三角站位，三镜对白 | r2v / 16:9 / 12s / 0.4MP / turbo | 左右前后景对不对、只有一人动嘴、声线串不串 |
| V3 | 8 秒六拍打斗 | t2v / 16:9 / 8s / 0.4MP / turbo | 有没有"打中"、重心、冲击帧、末尾是否定格 |

跑完统一做三件事：

1. 每镜抽第 0/25%/50%/75%/100% 五帧拼横条，看"说的那件事有没有发生"；
2. 量音轨：有没有声、语音段占比、响度（**不要用 ASR 判对错**）；
3. 把结论写回对应章节，**只写看见/听见的，不写推测**。

0.4MP 只验证结构，不验证画质；结构对了再上 0.7–1.0MP。
