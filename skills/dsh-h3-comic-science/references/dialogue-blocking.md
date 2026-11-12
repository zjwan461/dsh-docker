# 台词与站位（多人调度）

H3 的对白不是"写一句台词"就行：它要同时决定**谁在画面哪、看哪、谁动嘴、声音从哪来**。
这一份是可直接抄的站位与台词模板。语法依据官方 base/ref guide，句式来自 550 条真实 H3 成片提示词里反复出现的写法。

---

## 1. 一句台词的四个部件

```text
<说话人身份与音色> (S1)，<画内/画外>，<动作句>，says: <d>[Chinese] 逐字台词。</d>
```

| 部件 | 例子 | 缺了会怎样 |
|---|---|---|
| 身份 + 音色 | `the young man with a fast, slightly nasal voice (S1)` | 声线随机、跨镜换人 |
| 画内/画外 | `on-screen` / `says in an off-screen voiceover` | 口型乱给 |
| 动作句 | `leans forward and sets his jaw` | 表情死、嘴不动 |
| `<d>` | `<d>[Chinese] 你早就知道，对不对？</d>` | 台词被当描述念或吞掉 |

**铁律**：`<d>` 里只有语言标签和逐字台词；标点保留 `，。？！`，不要省略号、不要 emoji、不要加"（冷笑）"。

---

## 2. 双人正反打（最稳，默认用这个）

### 2.1 空间设定

```text
<Subject 1> stands in the LEFT foreground, body angled toward frame right, eyes on <Subject 2>.
<Subject 2> stands in the RIGHT background, body angled toward frame left, eyes on <Subject 1>.
They are about one and a half metres apart; the kitchen counter runs between them.
The camera stays on the same side of the axis for the whole scene: <Subject 1> always frame left, <Subject 2> always frame right.
```

三件事必须写死：**左右、朝向、距离**。只写"两人面对面"，模型会随机摆。

### 2.2 三条镜头（15 秒，可直接复制）

```text
subject_definitions: <Subject 1> is the young Chinese man in <Picture 1>, 25, slim, short buzz cut, black square-framed glasses, grey hoodie. <Subject 2> is the humanoid female alien in <Picture 2>, tall and slender, pearl-grey skin, bald head, huge amber eyes, glowing diamond mark on her forehead, deep navy coat with light-blue trim. <Subject 3> is the rented room in <Picture 3>: single bed on the left, computer desk by the window on the right, warm desk lamp.

summary: [reference generation] A fifteen-second two-hander in the rented room. The man confronts the alien about the bet; she admits she knew, and he realises she has been watching him lose for three months.

retention_analysis: <Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - face, glasses and hoodie stay identical. <Subject 2> (appears in [Shot 2]): fully_preserved - skin texture, forehead mark and coat trim stay identical. <Subject 3> (appears in all shots): partially_preserved - bed, desk and lamp positions are kept.

detailed_description: [Shot 1] Live-action, cinematic, 35mm, shallow depth of field. A medium close-up of <Subject 1> standing in the left foreground, body angled toward frame right, eyes on <Subject 2> off-frame right. He pulls his glasses off and says in a fast, tight young male voice: <d>[Chinese] 你早就知道，对不对？</d> His lips close; his jaw stays tight. [Shot 2] At 00:05.000, the camera cuts to a medium close-up of <Subject 2> in the right background, body angled toward frame left, eyes on <Subject 1> off-frame left. Her forehead mark brightens once. She says in a calm, slow adult female voice: <d>[Chinese] 知道。说出来，赌约就作废。</d> Her lips close. [Shot 3] At 00:10.000, the camera cuts back to <Subject 1>, now in the right foreground, angled toward frame left, eyes down. He says in an off-screen voiceover: <d>[Chinese] 所以你看着我，输了三个月。</d> while his lips remain completely closed. He sits down on the bed and does not look up.

overall_soundscape: A quiet room at night, the fridge humming in the next room, fabric shifting as he sits, one faint electronic tick when the forehead mark brightens.

non_diegetic_music: N/A
```

**注意第 3 镜**：机位换边了（他到了右前景），所以轴线也换了——同一场戏里**可以换边，但必须整镜换、写清楚**，不能在同一镜里左右横跳。

### 2.3 什么时候可以用同框

| 构图 | 适用 | 写法 |
|---|---|---|
| 过肩 | 权力差、审问 | 前景只留肩和耳，说话人在对面清晰 |
| 侧面双人 | 对峙、冷战 | 两人都露侧脸，**只让一人动嘴** |
| 背对双人 | 告别、并肩 | 只给背影，声音承担全部信息 |
| 双人特写 | 亲密、耳语 | 两张脸同焦，写 `both faces remain equally sharp` |

同框对白必须加一句：

```text
Only <Subject 1> moves his lips; <Subject 2>'s lips remain completely closed.
```

---

## 3. 三人站位（三角形最稳）

三人不要排排站。用**三角形 + 前后景**：

```text
<Subject 1> stands in the LEFT foreground, back three-quarters to camera, shoulder filling the left edge.
<Subject 2> stands CENTRE mid-ground, facing slightly frame right, the tallest silhouette in the frame.
<Subject 3> sits in the RIGHT background at the desk, facing frame left, partly occluded by <Subject 2>.
The camera is at chest height on the axis, so <Subject 1> frames the shot, <Subject 2> owns it, <Subject 3> observes it.
```

规则：

- **前景只留背影/肩**，不要给正脸——否则观众会以为他也要说话。
- **中景是说话人**，给他最完整的身体和最好的光。
- **背景是听众**，让他有事做（低头、写字、看窗外），不要木头人。
- 三人同框时，台词只给中景那位；另外两人各加一句闭嘴说明。

```text
Only <Subject 2> moves her lips. <Subject 1> and <Subject 3> keep their lips completely closed and stay silent.
```

---

## 4. 四人及以上 / 群戏

### 4.1 两两分组

四人不要四个方向。分成两组，各占画面一半：

```text
Two pairs face each other across a narrow table. <Subject 1> and <Subject 2> sit on the LEFT side, backs to the left wall; <Subject 3> and <Subject 4> sit on the RIGHT side, backs to the window. The camera looks down the table from the near end, so the left pair is nearer and the right pair is farther.
```

### 4.2 群戏三原则

1. **深度分层**：前景虚（肩/背）、中景实（说话人）、远景剪影（人群）。不要一排正脸。
2. **数量写死**：`exactly four people at the table`，不要写 "several"。
3. **不说话的人给动作**：倒酒、点烟、看手机、擦刀——有动作才不会像蜡像。

群戏台词用**画外音**最稳：

```text
A man's voice from off-screen right, low and amused (S3), says in an off-screen voiceover: <d>[Chinese] 都到齐了。</d> Nobody at the table moves their lips.
```

---

## 5. 轴线与屏幕方向

| 规则 | 写法 |
|---|---|
| 锁定轴线 | `The camera stays on the same side of the axis; no axis crossing.` |
| 锁定左右 | `<Subject 1> always frame left, <Subject 2> always frame right.` |
| 锁定视线 | `eyes on <Subject 2>` / `looking off-frame right` |
| 锁定运动方向 | `walks from frame left to frame right`（不要写 "walks across"） |
| 换边 | 必须整镜换，并在下一镜重写左右 |

观众靠**屏幕方向**判断谁在追谁。方向一乱，观众立刻出戏，而且说不出哪里不对。

---

## 6. 台词时长与字数（中文）

实测 H3 中文常速 **4.1 字/秒**，首帧/参考模式**开口前有 1.3–2.4 秒延迟**。

| 镜长 | 可用发声 | 安全字数 | 适合 |
|---|---|---|---|
| 4s | ~2.4s | **8–10 字** | 短反应、单词 |
| 5s | ~3.4s | **12–14 字** | 一句短对白 |
| 6s | ~4.4s | **16–18 字** | 正常对白 |
| 8s | ~6.4s | **24–26 字** | 独白、画外音 |
| 15s | ~13s | **50–55 字** | 一整段，3–4 镜分 |

**宁可拆成两镜，不要加速。** 超了 H3 会赶字、吞字，或者直接截断，而且不报错。

---

## 7. 跨镜台词与画外音

### 7.1 一句话跨切

```text
[Shot 1] ... he says: <d>[Chinese] 我告诉你，这件事</d> <scenetrans> ...
[Shot 2] At 00:03.000, ... <scenetrans> <d>[Chinese] 从一开始就不是意外。</d> The audio continues seamlessly across the cut.
```

### 7.2 画外音（最稳的叙事手段）

```text
<Subject 1> says in an off-screen voiceover: <d>[Chinese] 那天之后，他再没提过赌约。</d> while his lips remain completely closed.
```

画外音适合：交代时间跳跃、说数字、说观众需要但角色不该说出口的话。

### 7.3 多人同时说

```text
The two children (S1,S2) shout together: <d>[Chinese] 等一下！</d>
```

只用于口号、惊呼、合唱。**不要用它做正常对白**——声线会糊成一条。

---

## 8. 站位句式库（直接抄）

| 要写 | 句式 |
|---|---|
| 左前景 | `stands in the left foreground, back three-quarters to camera` |
| 右背景 | `sits in the right background, partly occluded by the desk` |
| 朝向 | `body angled toward frame right` |
| 视线 | `eyes on <Subject 2>` / `looking off-frame left` |
| 距离 | `about one and a half metres apart` |
| 中间有物 | `the counter runs between them` |
| 高度差 | `she stands; he stays seated, so her eyeline is above his` |
| 占画面比例 | `occupies roughly two thirds of the frame height` |
| 同焦 | `both faces remain equally sharp throughout` |
| 只说一人 | `Only <Subject 2> moves her lips; the others stay silent.` |
| 不说话者 | `His lips remain completely closed; he does not speak.` |

---

## 9. 常见错误（真实成片里反复出现）

| 写法 | 出来的东西 | 改法 |
|---|---|---|
| 只写"两人对话" | 随机站位、随机谁说话 | 左右 + 朝向 + 距离三件套 |
| 双人同框各说一句 | 声线合并、口型错人 | 正反打，一人一镜 |
| 三人并排 | 中间那位被挤扁 | 三角形 + 前后景 |
| 群戏写 "a crowd" | 人数随机、脸全一样 | 写死人数 + 深度分层 |
| 台词 20 字塞 4 秒 | 赶字、吞字 | 拆镜或加长到 6 秒 |
| 画外音没写闭嘴 | 画面里嘴在动 | 加 `lips remain completely closed` |
| 同一镜里左右互换 | 观众空间感崩 | 整镜换边，下一镜重写 |
| 说话人没给音色 | 跨镜变声 | 第一次出现写年龄/音色/语速 |

---

## 10. 交付前自检

- [ ] 每个说话人都有 `(S1)/(S2)`，且全片编号一致
- [ ] 每句台词都有身份、动作、`<d>` 三件套
- [ ] 同框对白写了"只有 X 动嘴"
- [ ] 每个镜头都能回答：谁在左、谁在右、看哪、距离多远
- [ ] 字数 ≤ 镜长预算（4.1 字/秒，扣 1.6 秒开口延迟）
- [ ] 画外音都写了闭嘴
- [ ] 跨镜台词有 `<scenetrans>` 且声明音频延续
- [ ] 没有"两人对视沉默"的开场（除非就是要在沉默里给信息）
