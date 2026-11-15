# 运镜、切镜与转场

三条线要分开想：**运镜**是镜头内部怎么动；**切镜**是两个镜头怎么接；**转场**是两场戏/两个时空怎么换。
混在一起写，H3 就会给你一个"一直在动但什么也没说清"的片子。

---

## 1. 运镜：官方只有三个维度

`类型 + 幅度 + 速度`，写成一句自然英文：

```text
The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.
The camera pans right with large amplitude at fast speed, following the runner.
The camera holds a static shot as the door closes.
```

| 维度 | 可用词 |
|---|---|
| 类型 | `Zoom In/Out`、`Push In/Pull Out`、`Pan Left/Right`、`Truck Left/Right`、`Tilt Up/Down`、`Pedestal Up/Down`、`Arc Shot`、`Tracking Shot`、`Static Shot`、`Shake Slightly/Strongly`、`POV`、`Roll Clockwise/Counterclockwise` |
| 幅度 | `with small amplitude` / `with large amplitude` |
| 速度 | `at slow speed` / `at fast speed` |

### 1.1 一镜一个主运镜

同一时间段只允许一个主运镜。`Static Shot` 和 `Tracking Shot` 写在一起、一秒内又推又摇又环绕，模型只会随机挑一个。

### 1.2 运镜要有"因果"，不要只写方向

| 描述式（弱） | 因果式（强） |
|---|---|
| `The camera pushes in with large amplitude.` | `He drives her back and the camera gives ground with them, pulling back.` |
| `The camera trucks left.` | `She breaks left and the camera whips after her, lagging half a beat.` |
| `The camera holds a static shot.` | `The camera holds dead still as the impact lands and the frame shudders once.` |

**"镜头不跟"也是一种运镜**：`the camera stays locked on her as he circles behind` 比 `arcs around them` 有戏。

### 1.3 速度要有三档，不能全片 `fast`

| 档 | 写法 | 占比 |
|---|---|---|
| 爆速 | `at extreme speed` | 20% |
| 快 | `at fast speed` | 45% |
| 慢 | `at slow speed` | 20% |
| 静 | `holds a static shot` | 15% |

**慢是为了让快明显。** 全片都快的，等于全片一样快。同一段至少一个慢镜 + 一个静镜。

### 1.4 幅度要跳级

`large → small → large → 静 → large`。连着三个 `large amplitude`，第三个改成 `small`。

### 1.5 甩镜必须写"跟着谁"

```text
❌ the camera pans right with large amplitude at fast speed
✅ the camera pans right with large amplitude at fast speed, following the fighter
```

不写跟随对象，看起来就是镜头自己在乱动。

### 1.6 主体动得快，镜头就稳

```text
❌ The camera spins around her as she spins and slashes.
✅ She spins once on her heel and slashes horizontally while the camera holds a static shot.
```

两个旋转叠加 = 画面全糊。

### 1.7 最大的那一击，相机反而锁死

冲击感来自"特效把背景推开"，不是相机在抖。前面铺陈镜要动，最高潮那一镜要静——对比才成立。

---

## 2. 切镜：什么时候该切

**切镜必须带来至少一种新信息**：新主体、新空间、新状态、新视角、新时间、关键反应。

只是景别近一点、角度偏一点 → **用运镜，不要切**。

| 情况 | 做法 |
|---|---|
| 同一空间、同一主体，只想更近 | `Push In` / `Zoom In` |
| 换人说话 | 切（正反打） |
| 换空间/时间 | 切 |
| 动作的"命中瞬间" | 切到冲击帧（独立镜头），不要在连续动作里冻结 |
| 情绪转折 | 切特写，或切空镜 |
| 想交代空间规模 | 切大广角，或 `Pedestal Up` |

### 2.1 连续两个同景别 = 剪辑死亡

每次切景别至少跳一级：广角 → 特写，或特写 → 广角。中景接中景，观众感觉像"卡了一下"。

### 2.2 15 秒的信息预算

| 镜数 | 适合 |
|---|---|
| 1 镜 | 产品动作、情绪表演、首尾帧过渡 |
| 2 镜 | "建立—结果"，最稳 |
| 3 镜 | "建立—行动—反应" |
| 4–6 镜 | 打斗、快节奏，但身份漂移风险上升 |
| 7+ 镜 | 只建议 8 秒以内的 ULTRA_SPEED，且每镜要有明确动作 |

---

## 3. 不突兀的五种剪法

### 3.1 动作接动作（match on action）

上一镜的**终点状态 = 下一镜的起点状态**，观众的眼睛会跟着动作走，接缝就"看不见"。

```text
[Shot 1] ... he pushes the door; the door swings open past the frame edge.
[Shot 2] At 00:03.000, the camera cuts to the other side of the door as it finishes swinging; he steps through.
```

写法：上一镜写 `End state:`，下一镜写 `Start state:`，逐项对齐**位置、目光、双手、持物**。

### 3.2 视线匹配（eyeline match）

A 看画右 → 下一镜 B 在画左、看向画左。观众自动认为两人在对视。

写死：`eyes on <Subject 2>, looking off-frame right`，下一镜 `looking off-frame left`。
**不要两边都写"看镜头"**——那就是两个人在看观众。

### 3.3 30 度规则 / 轴线

同一主体、同一场景，机位至少换 30 度，否则看起来像跳帧。
跨镜保持轴线：A 永远画左、B 永远画右；要换边，就整镜换，并在下一镜重写左右。

### 3.4 景别跳级 + 构图变化

只换运镜不换景别，观众感觉"同一个镜头在微调"。每镜换一个机位（低角/俯角/越肩/极特写）+ 一个运镜，才有"剪辑感"。

### 3.5 声音先行或延续（J-cut / L-cut）

- **J-cut**：下一镜的声音先入（观众先听到，再看到）。
- **L-cut**：上一镜的声音延续到下一镜（画面切了，话还没说完）。

H3 写法：跨切台词用 `<scenetrans>`，并声明 `the audio continues seamlessly across the cut`。

```text
[Shot 1] ... he says: <d>[Chinese] 我告诉你，这件事</d> <scenetrans>
[Shot 2] At 00:03.000, ... <scenetrans> <d>[Chinese] 从一开始就不是意外。</d> The audio continues seamlessly across the cut.
```

声音不断，画面切了也不突兀——这是最便宜的"隐形剪辑"。

---

## 4. 一次生成内切 vs 分开生成再拼

| | 一次生成（一个 prompt 内 `[Shot N]`） | 分开生成再拼 |
|---|---|---|
| 接缝 | 模型内部完成，最连续 | 自己做，风险高 |
| 控制 | 难改单镜 | 可逐镜重做 |
| 适合 | 5–15 秒、3–6 镜、同一场景 | 长片、跨场景、要反复调 |

### 4.1 一次生成内的切点

```text
[Shot 2] At 00:03.500, the camera cuts to ...
```

切点严格递增、落在时长内；**最后一段留 1–1.5 秒收束**，否则模型会在末尾"站住、粒子飘"。

### 4.2 分开生成：硬切就按硬切拼

实测结论（H3 场景边界测试）：**硬切什么都不继承**。两条片子直接拼，不要加交叉淡化——加了反而像失误。

- 硬切：直接 `concat`，音频各自按画面长度裁齐，头尾加 6ms 淡化防爆音。
- 要"连"：用**尾帧接力**（上一段真实末帧 → 下一段首帧），接缝相关系数可到 1.0。
- 要"变"：用 FL2VA 首尾帧（A 的末帧 + 目标图），模型会在段内完成变形/匹配切。

### 4.3 尾帧接力的三个坑

1. 末帧可能是运动模糊、闭眼、穿模——**从最后 0.5 秒里挑最干净的一帧**，不要死取最后一帧。
2. 末帧常带"收尾减速"的定格感——生成时多要 1.5 秒，剪辑切掉。
3. 下一段首帧继承了上一段的构图，**不要再写一遍"新构图"**，只写从这张图之后发生什么。

---

## 5. 八种转场（按"隐形程度"排）

### 5.1 硬切（默认，90% 的情况）

什么都不继承。直接切，干净利落。
写法：`the camera cuts to`。
适合：对话正反打、场景切换、时间跳跃。

### 5.2 动作匹配切（match cut）

用同一个动作/形状跨场景。

```text
[Shot 1] ... she raises the knife; the blade fills the frame.
[Shot 2] At 00:03.000, the camera cuts to a skyscraper edge rising through the same diagonal; the blade is gone.
```

写法：上一镜的**形状/运动方向/速度**，下一镜用同构图画出来。

### 5.3 图形匹配（graphic match）

圆接圆、线接线、色块接色块。最"高级"，也最吃构图。

```text
[Shot 1] ... the round lamp fills the left third, glowing warm.
[Shot 2] At 00:04.000, the camera cuts to the sun rising in the same position and size, same warm tone.
```

### 5.4 甩镜（whip pan）

镜头快速甩向一边，画面糊成横条，落幅已经是新场景。

```text
The camera pans right with large amplitude at extreme speed, the frame smearing into horizontal streaks, and settles on the man mid-stance in the next room.
```

要点：**写跟随对象**、**写落幅**、**写条纹**。糊的那 3–5 帧就是接缝。

### 5.5 遮挡擦除（object wipe）

前景物体扫过镜头，接缝藏在遮挡里。

```text
A pillar sweeps across the frame from left to right, filling the lens for a moment; when it clears, the corridor is gone and the courtyard is there.
```

可用遮挡物：柱子、门、衣摆、手、路人、车、雨伞。

### 5.6 光爆 / 白场 / 黑场（flash / dip）

```text
The frame blows out to pure white for three frames; when it clears, the room is empty and the lights are off.
```

- 白场：记忆、闪回、进入比喻空间。
- 黑场：时间跳跃、章节分隔（**真黑场，不是淡出**）。
- 注意：H3 对"2 帧"不敏感，写 `for three frames` 常给 20 帧；要精确就后期。

### 5.7 穿入（dive-through）——科普片的核心转场

镜头推进一个"入口"，穿过去就是新空间：

```text
The camera pushes in with large amplitude at slow speed into the refrigerator's interior light until the white fills the frame; the white dissolves into the ceiling lights of a stainless-steel control room, and the camera pulls out to reveal two round gauges on the far wall.
```

入口清单：瞳孔、屏幕、冰箱灯、门缝、锁孔、镜面、水面、酒杯、针孔、秤盘。
要点：**入口先填满画面，再穿出**；中间不要切黑；穿出后第一件事是"交代新空间的两个锚点"。

### 5.8 溶解（dissolve）

官方只在明确要求时才用。写 `cross-dissolve` / `the image dissolves into`。
适合：时间流逝、同构图换季节/换年代、情绪收束。
**不要用它做场景切换**——会显得拖沓。

### 5.9 声音桥（最隐形）

画面硬切，声音不断：上一场的雨声延续到下一场，或下一场的电话铃先响。

```text
The rain continues unchanged across the cut; the new room carries the same rain on its window.
```

---

## 6. 转场的选择表

| 你想表达 | 用 |
|---|---|
| 同一场对话换人 | 硬切（正反打） |
| 同一动作换空间 | 动作匹配切 |
| 时间过去很久 | 黑场 / 溶解 / 空镜 |
| 进入想象/微观世界 | 穿入 |
| 两个空间并列 | 甩镜 / 遮挡擦除 |
| 记忆、闪回、梦境 | 白场 / 光爆 |
| 情绪收束、章节结束 | 黑场 |
| 保持连续感 | 声音桥 + 尾帧接力 |

---

## 7. 转场时长与节奏

| 类型 | 时长 | 备注 |
|---|---|---|
| 硬切 | 0 帧 | 不要加淡化 |
| 甩镜 | 5–10 帧 | 糊的帧数 |
| 遮挡擦除 | 3–8 帧 | 遮挡物要够大 |
| 白场/黑场 | 3–12 帧 | 写 3 帧可能给 20 帧 |
| 溶解 | 12–24 帧 | 0.5–1 秒 |
| 穿入 | 0.8–1.5 秒 | 推进 + 穿出 |

**转场本身不占叙事时间**。一场 15 秒的戏，转场最多吃掉 1 秒。

---

## 8. 常见"突兀"诊断

| 症状 | 原因 | 修法 |
|---|---|---|
| 像跳帧 | 机位没换 30 度 / 景别没跳级 | 换机位、跳景别 |
| 像 PPT 翻页 | 每镜都是静态构图 + 硬切 | 加运镜、加动作接动作 |
| 空间感崩 | 越轴、左右互换 | 锁轴线，整镜换边 |
| 动作接不上 | 上一镜终点 ≠ 下一镜起点 | 写 End state / Start state |
| 切点"卡"一下 | 同景别连切 | 跳级或改用运镜 |
| 声音"呼"一下 | 每镜各自重启环境声 | 同场次写同一句环境声并声明延续 |
| 转场像故障 | 写了 2 帧却给了 20 帧 | 后期做，或给足时间写多卡 |
| 穿入很假 | 入口没填满画面就切 | 先让入口占满，再穿出 |
| 尾帧接力跳 | 末帧有运动模糊/闭眼 | 从最后 0.5 秒挑干净帧 |
| 全片一个节奏 | 全是 `fast` + `large` | 三档速度 + 幅度跳级 |

---

## 9. 可复制模板

### 9.1 硬切对话（3 镜 15 秒，动作接动作）

```text
[Shot 1] ... He stands, picks up the folder, and walks toward the door; his hand reaches the handle as the shot ends.
[Shot 2] At 00:05.000, the camera cuts to the corridor side of the same door as it swings open; his hand is still on the handle, the folder under his arm.
[Shot 3] At 00:10.000, the camera cuts to a wide shot down the corridor as he walks away from camera, the door easing shut behind him.
```

### 9.2 甩镜转场

```text
The camera pans right with large amplitude at extreme speed, the frame smearing into horizontal streaks, and settles on the woman standing at the window in the next room; the streaks clear within four frames.
```

### 9.3 穿入转场（科普）

```text
The camera pushes in with large amplitude at slow speed into the pupil until black fills the frame; the black lifts into the blue glow of a control room, and the camera pulls out to reveal a wall of gauges and two figures standing at the console.
```

### 9.4 尾帧接力（两段 8 秒）

```text
第 1 段：... he turns and walks toward the lit doorway; the shot ends with his silhouette in the doorway, motion settling.
第 2 段首行：For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
第 2 段正文：... he continues through the doorway into the bright corridor, the same silhouette, the same walking rhythm.
```

---

## 10. 自检

- [ ] 每镜只有一个主运镜，且写成了自然句
- [ ] 全片速度至少三档，有慢有静
- [ ] 每个切点都带来新信息
- [ ] 相邻镜头景别至少跳一级
- [ ] 上一镜终点 = 下一镜起点（位置/目光/双手/持物）
- [ ] 轴线没乱，左右没互换
- [ ] 同场次环境声延续，没有每镜重启
- [ ] 转场类型和"想表达的东西"对得上
- [ ] 穿入转场先填满画面再穿出
- [ ] 硬切没加多余淡化
- [ ] 15 秒内没有 7 个以上镜头（除非 ULTRA_SPEED）

---

## 锁机位：别写"不要动"

- **"a very slow push in" 会变成持续重构图**：4.5 秒里画面一直在缩、机位在找。锁死要写成状态句：`The camera is on a tripod and does not move.` 别再叠 push/pull/dolly 之外的过渡词。
- **否定词进 H3 会反噬**：加 `nothing floats in front of the lens` 之后，镜头前的漂浮光斑/颗粒反而**变多**（同 seed 删掉即干净）。原则：只描述"画面里有什么"，不描述"没有什么"。
- 但也不能一路删：把姿态和房间描述删空后人物会崩（发光剪影、手臂拉长）。**保留姿态 + 会动的物件，删掉一切关于空气、颗粒、特效的措辞。**
- 远景（人小、灯多、有浮尘）本质上是 i2v 的弱项。要一个稳的收尾镜头，宁可**静帧 + `zoompan` 缓推**，也别硬生成（见 `delivery-and-qa.md` §9）。
