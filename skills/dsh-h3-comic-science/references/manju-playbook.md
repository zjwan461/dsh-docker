# 漫剧 Playbook

面向 9:16 竖屏、2–5 分钟、漫画/动画质感的 AI 漫剧。核心不是"让画面动起来"，是**让观众在 3 秒内知道谁想要什么、什么挡着他**。

---

## 1. 一集的结构

| 时间 | 任务 | 写法 |
|---|---|---|
| 0–3s | 钩子 | 一句反常的话 / 一个反常的画面，不要交代背景 |
| 3–15s | 立人物与欲望 | 他想要什么，谁挡着，代价是什么 |
| 15–60s | 第一次升级 | 尝试 → 失败 → 发现新信息 |
| 60–120s | 反转 | 之前的信息换一个意思 |
| 120–150s | 代价兑现 | 让观众看到"早该想到" |
| 最后 3–5s | 钩子 | 一句台词 + 黑场卡 |

漫剧不是"短剧的动画版"，是**条漫的节奏 + 剧集的信息密度**：每一格都要有信息，每一页都要翻。

---

## 2. 分镜表（机器可读）

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

- `start` / `action` / `end` 三件套必须能接上下一镜（位置、目光、双手、持物）。
- 一镜**只有一个主要变化**。
- `line` 为空 = 无声镜；有台词就必须有 `speaker`。
- `mode`：`static`（关键帧+剪辑运镜）/ `i2v` / `r2v` / `t2v`。

---

## 3. 镜头词表（漫剧专用）

### 3.1 景别与构图

| 词 | 用途 |
|---|---|
| 大特写（眼睛/手/物件） | 情绪或信息落点 |
| 近景 | 台词、表情 |
| 中景 | 对话、关系 |
| 全景 | 交代空间、孤立感 |
| 俯视/仰视 | 权力差 |
| 斜切/分屏 | 对峙、平行 |
| 前景遮挡 | 窥视、压迫 |

### 3.2 漫剧特有的"强调"

- **集中线**：从画面四周向主体收束的放射线。
- **速度线**：平行短线，表示移动方向。
- **冲击帧**：高反差、去背景、只有主体和一种颜色。
- **留白**：大面积单色，人物缩到一角。
- **色板切换**：同一构图，换成另一种主色表示时间/心理变化。

这些**写进提示词**可以，但**文字/拟声字必须后期叠**。

### 3.3 画风基底（选一个，全片不换）

| 风格 | 关键词 |
|---|---|
| 日系赛璐璐 | `2D hand-drawn anime, cel shading, clean line art, flat color blocks` |
| 国风条漫 | `Chinese manhua, ink line weight variation, layered washes, generous negative space` |
| 厚涂漫画 | `painterly comic, visible brush strokes, chiaroscuro volumes` |
| 复古港漫 | `90s Hong Kong manhua, dense hatching, high-contrast color blocks, print grain` |
| 水彩叙事 | `watercolor storybook, paper texture, translucent washes, soft edges` |
| 极简线稿 | `minimal line-art comic, sparse lines, two-tone palette` |

每个 `[Shot N]` 开头都重申同一个基底。**不要在一集里换画风**，换一次观众就出戏。

---

## 4. 静态漫：默认路线

### 4.1 为什么

- 零漂移：每镜就是一张图，不存在"脸在动"。
- 零等待：出图 10 秒，改图 10 秒。
- 更像漫画：观众对"定格 + 推拉"的容忍度远高于"廉价动画"。

### 4.2 剪辑做法

| 镜头类型 | 运动 |
|---|---|
| 对话 | 100% → 104%，3–4s，线性 |
| 情绪 | 100% → 110%，4–5s，先快后慢 |
| 揭示 | 从局部平移到全图，3s |
| 冲击 | 定格 0.3s + 闪白 + 音效 |
| 时间流逝 | 同构图叠化，两张色板 |

工具：`scripts/finish.py --aspect` 做画布，或 `ffmpeg zoompan`、剪辑软件里做 Ken Burns。生成侧不需要 H3。

### 4.3 什么时候必须动态

- 打斗的"命中瞬间"
- 变身/觉醒
- 穿越/转场（穿门、穿镜、穿屏幕）
- 一个必须让观众看清的连续动作（拔刀、回头、落泪）

一集 5–8 个动态镜足够，其余静态。

---

## 5. 动态镜：i2v 的正确写法

首帧是硬约束，提示词**只写运动**，不要重述画面：

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action. Keep the face, hair, outfit and background of <Picture 1> unchanged. The camera pushes in with small amplitude at slow speed as his eyes narrow and his jaw tightens. Rain streaks past the frame. He does not speak.

overall_soundscape: Rain on concrete, a low distant thunder, fabric shifting.

non_diegetic_music: N/A
```

三条铁律：

1. **不要写两个大动作**（既转头又抬手）——模型只会挑一个。
2. **不要写"保持连续"**——要写具体的终点状态。
3. **不要写负面词**——写"他在做什么"，不写"不要做什么"。

---

## 6. r2v：跨镜锁人

参考图顺序固定，且每张有唯一职责：

| 顺序 | 图 | 职责 |
|---|---|---|
| 1 | 本镜起始帧 | 构图、姿态、光位 |
| 2 | 面部识别板 | 五官、发型、痣位 |
| 3 | 全身/造型板 | 身高比例、服装 |
| 4 | 场景图 | 空间关系、陈设 |
| 5 | 道具图 | 关键物件状态 |

`subject_definitions` 里一张图可以同时承担"首帧"和"身份"两个角色：

```text
<Picture 1> is the opening composition of [Shot 1].
<Subject 1> is the young man in <Picture 1>, with ...
```

`retention_analysis` 要**分工**：

```text
<Picture 1> ([Shot 1] first frame): fully_preserved - framing, pose and light direction open the shot exactly as supplied.
<Subject 1> (appears in [Shot 1]): fully_preserved - face shape, hair silhouette and outfit stay identical; expression follows this shot.
```

---

## 7. 台词与配音

### 7.1 字数预算

| 镜长 | 中文上限 | 说明 |
|---|---|---|
| 3s | 12 字 | 一句短句 |
| 4s | 16 字 | 正常对话 |
| 5s | 20 字 | 上限，再多就赶 |
| 6s | 24 字 | 只用于独白 |

按 4.1 字/秒算，再留 15% 余量。

### 7.2 TTS 路线（推荐）

1. 一句一条，`dsh-video-narration/scripts/tts.py`。
2. `ffprobe` 实测时长，按实测排镜长（不要按字数估）。
3. 同一角色全片用同一音色；外星人可加 `lowpass` + 轻微 `chorus` 做非人感。
4. 逐镜响度对齐，再混音，`amix normalize=0`。

### 7.3 H3 原生路线

- 一镜一句，≤14 字，中景，说话人独占画面。
- 首帧模式会延迟 1.3–2.4 秒开口，剪辑时把前面静止段剪掉。
- 生成后逐条听：有没有吞字、变声、说成外语。

---

## 8. 常见崩坏与对策

| 现象 | 原因 | 对策 |
|---|---|---|
| 角色每镜长得不一样 | 只靠文字描述 | 三视图 + 面部板 + r2v，参考图顺序固定 |
| 画面滑向真人 | 文生模式默认实拍 | 每镜重申 `2D ... not live-action`，或直接 i2v |
| 字幕/水印自己出现 | 负面词诱发 + 近景 | 改中景、正向描述、后期遮盖 |
| 台词被截断 | 字数超预算 / 开口延迟 | 减字、加长镜、剪掉前置等待 |
| 口型错人 | 双人同框 | 正反打，一人一镜 |
| 切点飘 | 每镜各自漂移 | 静态漫 + 固定构图；动态镜锁死机位 |
| 动作做不完 | 一镜两个变化 | 拆镜，或只保留一个 |
| 画面"很满"但没信息 | 堆形容词 | 一镜一个信息点，先写"谁想要什么" |
| 街景自动长出乱码招牌 | 动漫街景训练分布自带文字 | 把招牌写成抽象色块/光斑，或后期用色块遮；别指望"不要文字"能压住 |
| 打样时几乎不动 | 0.4MP + `small amplitude` 等于没动 | 打样档用 `large amplitude at fast speed`，定稿再收小 |

> **V1b 复测（2026-11-12）**：同一条二维漫剧提示词，把 `small amplitude at slow speed` 改成
> `large amplitude at fast speed`，五帧从全身远景明显推到面部特写，运动可见；赛璐璐画风守住，
> 雨丝、泪痕都出来了。**证实"打样档要放大幅度"**。乱码招牌依旧（见上一条），与运镜无关。

---

## 9. 交付清单

- [ ] 前 3 秒有钩子，最后 3 秒有钩子
- [ ] 每镜抽 5 帧看过：动作真的发生了
- [ ] 同一角色并排比对：脸/发/衣/标志物
- [ ] 没有意外文字、水印、气泡
- [ ] 字幕逐字对配音，数字和人名重点核
- [ ] 竖屏安全区：底部 300–400px 不放关键信息
- [ ] 响度 −16 LUFS，真峰值 ≤ −1.5 dBFS
- [ ] 封面 3 种比例（9:16 / 16:9 / 3:4）
- [ ] 标注 AI 生成；素材与音乐版权清楚
