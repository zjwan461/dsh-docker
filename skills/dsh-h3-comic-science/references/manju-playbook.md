# 漫剧 Playbook（漫画介质的短剧）

**漫剧就是 AI 短剧，只是人物不是真人写实，而是漫画/动画风格。** 因此它和电视剧、电影是**同一套制片套路**：剧本 → 分镜 → 表演 → 对白 → 剪辑 → 声音 → 交付。声音以**口播/对白为主**，旁白只做少量补充；**不是**"静态图 + 旁白解说"的动态漫画。

剧集语法（四幕、付费墙、单集四拍、断章、对白密度）与写实短剧完全共用，见 `short-drama.md`。本文只讲**漫画介质**带来的差异：画风锁定、漫画强调语法、口型与表演、以及静帧的合法用途。

---

## 1. 制片套路（和电视剧/电影同款）

| 环节 | 电视剧/电影 | 漫剧对应 | 工具 |
|---|---|---|---|
| 剧本 | 场景/动作/台词/情绪 | 同左，另加"画风基底"一栏 | `scaffold.py` 出 `剧本.md` |
| 分镜 | 景别/机位/轴线/调度 | 同左 + 漫画强调（集中线/冲击帧） | `分镜.json` + `check.py` |
| 表演 | 演员情绪/微表情/走位 | H3 原生表演 或 首帧表情 + i2v | `native-dialogue.md` |
| 对白 | 现场收音/配音 | **口播为主**：原生口播 / 克隆+对口型 | `talking-head.md` |
| 剪辑 | 剪切理由/节奏/断章 | 同左 | `finish.py` + `episode-3min.md` |
| 声音 | 对白主/旁白补/音床/BGM | 同左 | `bgm.md` / `subtitles.md` |
| 交付 | 响度/字幕/封面/合规 | 同左 + 画风一致性 | `qa.py` / `delivery-and-qa.md` |

**核心不是"让画面动起来"，是"让观众 3 秒内知道谁想要什么、什么挡着他"，并且听见他怎么说。**

---

## 2. 一集的结构

沿用短剧四拍（`short-drama.md` §3）：抓人立事 → 正面交锋 → 亮牌翻转 → 余波钩子。漫剧单集可压到 60–90 秒，但**拍数与断章逻辑不变**。

| 时间 | 任务 |
|---|---|
| 0–3s | 钩子：一句反常台词 / 一个反常画面，不交代背景 |
| 3–15s | 立人物与欲望：他想要什么、谁挡着、代价 |
| 中段 | 升级 → 反转 → 代价兑现（每 15–30s 筹码/证据/站位变一次） |
| 最后 3–5s | 断章：停在未完动作/来电/物证露一角，不总结 |

---

## 3. 分镜表（机器可读）

`分镜.json` 一集一个数组，每镜：

```json
{
  "id": "S01",
  "scene": "雨夜巷口",
  "shot": "中景",
  "start": "low angle, camera on the left side of the axis",
  "action": "他抬头看天，雨水打在脸上",
  "end": "视线停在巷子深处",
  "mode": "i2v",
  "audio": "dialogue",
  "duration": 4,
  "aspect": "9:16 (Portrait Widescreen)",
  "refs": ["S01_start.png", "chen_face.png"],
  "line": "这雨……不对劲。",
  "speaker": "S1",
  "sfx": "雨声、远处车流、一记低频",
  "prompt": "……"
}
```

规则：

- `start`/`action`/`end` 三件套必须能接上下一镜（位置、目光、双手、持物）。
- 一镜**只有一个主要变化**。
- `line` 为空 = 无声镜；有台词必须有 `speaker`。
- **`audio` 决定做法**：
  - `dialogue`（主体）→ 动态口播镜：H3 i2v 带台词（8 步），或 克隆+对口型（U11）。
  - `narration`（少量）→ 画外旁白，画面可以是动态或静帧缓推。
  - `silent` → 插入镜/空镜/过渡，才允许 `mode: static` + Ken Burns。
- `mode`：`i2v` / `r2v` / `t2v` / `static`。**对白镜默认动态，static 只给 silent 镜。**

---

## 4. 镜头词表与漫画强调

### 4.1 景别与构图（和实拍同一套）

| 词 | 用途 |
|---|---|
| 大特写（眼睛/手/物件） | 情绪或信息落点 |
| 近景 | 台词、表情 |
| 中景 | 对话、关系 |
| 全景 | 交代空间、孤立感 |
| 俯视/仰视 | 权力差 |
| 前景遮挡 | 窥视、压迫 |

### 4.2 漫剧特有的"强调"（介质差异）

- **集中线**：四周向主体收束的放射线。
- **速度线**：平行短线表示移动方向。
- **冲击帧**：高反差、去背景、只有主体和一种颜色。
- **留白**：大面积单色，人物缩到一角。
- **色板切换**：同构图换主色表示时间/心理变化。

这些可写进提示词，但**文字/拟声字必须后期叠**。

### 4.3 画风基底（选一个，全片不换）

| 风格 | 关键词 |
|---|---|
| 日系赛璐璐 | `2D hand-drawn anime, cel shading, clean line art, flat color blocks` |
| 国风条漫 | `Chinese manhua, ink line weight variation, layered washes, generous negative space` |
| 厚涂漫画 | `painterly comic, visible brush strokes, chiaroscuro volumes` |
| 复古港漫 | `90s Hong Kong manhua, dense hatching, high-contrast color blocks, print grain` |
| 水彩叙事 | `watercolor storybook, paper texture, translucent washes, soft edges` |
| 极简线稿 | `minimal line-art comic, sparse lines, two-tone palette` |

每个 `[Shot N]` 开头重申同一基底。**一集不换画风**。

---

## 5. 声音：口播为主，旁白仅补

### 5.1 三条路线（按优先级）

| 路线 | 用在 | 说明 |
|---|---|---|
| **原生口播**（主） | 情绪对白、吵架、哭戏、发狠 | H3 **i2v 或 r2v** 带 `<d>` 台词，8 步；情绪由模型表演 |
| **克隆 + 对口型**（主） | 跨集同音色、给定配音、长对白 | FishAudio 克隆 → **r2v + ref_audios**（U11）对口型；口型随音频 |
| **旁白 TTS**（补） | 画外补充、数字/术语、过渡、时间省略 | 只占少量时长；不替代对白 |

> 不要把整集做成"旁白念稿 + 画面配图"。那是解说视频，不是漫剧。**对白承担叙事，旁白只补对白说不清的信息。**
> **口播不绑定 i2v**：r2v 同样支持 `<d>` 台词，且能挂多参考图锁身份、挂 ref_audios 锁音色/对口型。见 §5.5。

### 5.2 字数预算

| 镜长 | 中文上限 | 说明 |
|---|---|---|
| 3s | 12 字 | 一句短句 |
| 4s | 16 字 | 正常对话 |
| 5s | 20 字 | 上限，再多就赶 |
| 6s | 24 字 | 只用于独白 |

按 4.1–4.5 字/秒算，留 15% 余量；连续 15 秒 ≤95 字（同短剧）。

### 5.3 口播执行要点

- 一镜一句、说话人独占画面；同框写闭嘴锁（`Only S1 moves his lips; S2's lips remain closed`）。
- 有台词用 **8 步**（4 步中文会糊）；无台词才 4 步。
- 首帧模式开口延迟 1.3–2.4s，剪辑剪掉前置静止段。
- 生成后**逐条听**：吞字、变声、说成外语、口型错人。
- 同性别多角色拉开音区+年龄+质感，否则改克隆（见 `dialogue-blocking.md`）。

### 5.4 音床与 BGM

全片一条房间底噪保声音连续；对白在单条内说完；BGM 外挂、比对口低 12–18dB、sidechain 闪避（`bgm.md`）。

### 5.5 口播走 i2v 还是 r2v？

**两条都通，按"要不要钉首帧 / 要不要挂参考"选：**

| | i2v | r2v |
|---|---|---|
| 开场构图 | **钉死**首帧（构图/姿态/光位） | 模型自组开场，参考只引导 |
| 身份锁定 | 单图（首帧兼身份） | **多参考**：脸板+造型板+场景，跨镜更稳 |
| 参考音频 | ❌（只有 first_frame） | ✅ `ref_audios`：锁音色 / **给定音频对口型** |
| 参考视频 | ❌ | ✅（运动迁移/换脸 guide） |
| 台词 `<d>`+`(S1)`+闭嘴锁 | ✅ | ✅ |
| 适合 | 已有设计好的起始帧、Hub 锚点续接、动作接动作 | 跨镜锁脸锁音色、克隆+对口型、不需精确开场 |

- **克隆+对口型必须 r2v**（i2v 接不了参考音频）；U11 就是 r2v。
- **原生情绪口播**两者皆可；要跨镜保脸/保音色就用 r2v 加脸板/音色 clip。
- 步数：有台词 8 步。i2v 用 `fl2v_turbo_8step`；r2v 用 `ref2v_turbo_8step_768p`（lightx2v 有）。
- **坑**：r2v 的 `ref_audios` 携带**完整音频 latent（含内容）**，可能泄漏参考录音自己的词（`native-dialogue.md` §5）。对口型时这正是想要的；只锁音色时用短而干净的音色 clip，情绪仍靠表演短语。
- **坑**：`h3_generate` 插件不暴露 ref_audios/ref_video；**直连 API（comfy.py + r2v 工作流）才有**。文档里"本插件不支持参考音频"仅指插件。

---

## 6. 动态镜：i2v / r2v 的正确写法

### 6.1 i2v（钉首帧）

首帧是硬约束，提示词**只写运动与表演**，不重述画面：

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action. Keep the face, hair, outfit and background of <Picture 1> unchanged. The camera pushes in with small amplitude at slow speed as his eyes narrow and his jaw tightens; he says in a low, tense young male voice: <d>[Chinese] 这雨……不对劲。</d> Rain streaks past the frame. Only he moves his lips.

overall_soundscape: Rain on concrete, a low distant thunder, fabric shifting.

non_diegetic_music: N/A
```

三条铁律：

1. **不要写两个大动作**（既转头又抬手）——模型只挑一个。
2. **不要写"保持连续"**——写具体终点状态。
3. **不要写负面词**——写"他在做什么"。

### 6.2 r2v（多参考锁人 + 台词 / 对口型）

不钉首帧，用脸板+造型板锁身份；台词同样 `<d>`。要对口型就把给定音频挂 `ref_audios.ref_audio_0` 并在提示词用 `<Audio 1>` 绑定（U11 路线）。

```text
subject_definitions: <Subject 1> is the young man in <Picture 1> (face board) and <Picture 2> (full-body board): short buzz cut, black square-framed glasses, grey hoodie. <Picture 3> is the rainy alley at night.

summary: [reference generation] In the rainy alley, the man looks up and says the rain is wrong; identity locked to the face and body boards.

retention_analysis: <Subject 1> (appears in [Shot 1]): fully_preserved - face, glasses and hoodie identical to <Picture 1>/<Picture 2>; expression follows this shot. <Picture 3> ([Shot 1] scene): partially_preserved - alley layout and night light kept.

detailed_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action. A medium shot of <Subject 1> in <Picture 3>, rain on his face; he looks up and says in a low, tense young male voice: <d>[Chinese] 这雨……不对劲。</d> Only he moves his lips. The camera holds on a tripod and does not move.

overall_soundscape: Rain on concrete, a low distant thunder, fabric shifting.

non_diegetic_music: N/A
```

- 对口型变体：把克隆/TTS 音频挂 `ref_audios.ref_audio_0`，`detailed_description` 里写 `his lips sync to <Audio 1>`，台词文本与音频逐字一致；此时**不要**再让模型自由演情绪台词（音频已定内容）。
- 参考顺序/职责见 §8；native 节点 `ref_images`/`ref_audios` 用**列表**（`[["16",0]]`），T8 节点用点状键（`t8-pipelines.md`）。

---

## 7. 静帧的合法用途（补充，不是主体）

静帧 + Ken Burns **只用于**：插入镜（手机/合同/物件）、空镜、过渡、听者反应、字卡。它省钱、零漂移，但**不承担对白叙事**。

| 镜头类型 | 运动 |
|---|---|
| 插入/揭示 | 局部平移到全图，3s |
| 空镜/过渡 | 100%→104%，3–4s 线性 |
| 冲击 | 定格 0.3s + 闪白 + 音效 |
| 时间流逝 | 同构图叠化，两张色板 |

工具：`finish.py --aspect` / `ffmpeg zoompan`。**对白镜不要用它**——观众要看见嘴在动、情绪在脸上。

必须动态的镜：打斗命中、变身/觉醒、穿越转场、任何带台词的镜、必须看清的连续动作（拔刀/回头/落泪）。

---

## 8. r2v：跨镜锁人

参考图顺序固定、每张唯一职责：

| 顺序 | 图 | 职责 |
|---|---|---|
| 1 | 本镜起始帧 | 构图、姿态、光位 |
| 2 | 面部识别板 | 五官、发型、痣位 |
| 3 | 全身/造型板 | 身高比例、服装 |
| 4 | 场景图 | 空间关系、陈设 |
| 5 | 道具图 | 关键物件状态 |

`retention_analysis` 分工：首帧 `fully_preserved`（构图/姿态/光），身份 `fully_preserved`（脸/发/衣），表情跟随本镜。

---

## 9. 常见崩坏与对策

| 现象 | 原因 | 对策 |
|---|---|---|
| 角色每镜长得不一样 | 只靠文字 | 三视图+面部板+r2v，参考顺序固定 |
| 画面滑向真人 | 文生默认实拍 | 每镜重申 `2D … not live-action`，或 i2v |
| 字幕/水印自现 | 负面词诱发+近景 | 改中景、正向描述、后期遮 |
| 台词被截 | 字数超/开口延迟 | 减字、加长镜、剪前置等待 |
| 口型错人 | 双人同框 | 正反打一人一镜 + 闭嘴锁 |
| 口型糊/念错 | 4 步跑台词 | 改 8 步；或克隆+对口型 |
| 整集像解说 PPT | 旁白为主+静帧为主 | **改口播驱动**：对白镜动态，旁白只补 |
| 切点飘 | 每镜各自漂移 | 锁机位+Hub/Chain+eq 对齐（`longform-continuity.md`） |
| 动作做不完 | 一镜两变化 | 拆镜 |
| 街景乱码招牌 | 动漫街景训练分布 | 招牌写抽象色块/光斑，或后期遮 |
| 打样几乎不动 | 0.4MP+small amplitude | 打样用 large amplitude at fast speed |

---

## 10. 交付清单

- [ ] 前 3 秒钩子、结尾断章（不总结）
- [ ] **对白镜占主体**，旁白时长占比低；每镜抽 5 帧确认动作/口型发生
- [ ] 口播逐条听：吞字/变声/外语/错人
- [ ] 同一角色并排比对：脸/发/衣/标志物；全片画风一致
- [ ] 无意外文字/水印/气泡；字幕逐字对口播
- [ ] 竖屏安全区：底部 300–400px 不放关键信息
- [ ] 响度 −16 LUFS、真峰值 ≤ −1.5 dBFS
- [ ] 封面 3 比例；标 AI 生成；素材/音乐版权清楚
