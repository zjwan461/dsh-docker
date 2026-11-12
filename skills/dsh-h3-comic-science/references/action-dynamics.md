# 武打与高动态

打斗不是"动作快"，是**力的传递看得见**：谁蓄力、打在哪、重心怎么走、环境怎么反应、镜头什么时候该静。
这套方法来自 H3 打斗提示词的实战总结（`h3-combat-impact`）与 550 条真实成片的写法，适用于实拍科普与二维漫剧。

---

## 1. 先选节奏模式（三选一，不可混用）

| 模式 | 节奏单位 | 适用 | 8 秒镜数 | 中位镜长 |
|---|---|---|---|---|
| **六拍** | 一次交手 | 对决、单次重击、有蓄力收势 | 4–5 | 1.2–2.0s |
| **连续对轰** | 一次交换（0.8–1.5s） | 近身缠斗、压着打 | 9–10 | 0.6–0.9s |
| **ULTRA_SPEED** | 一个镜头（0.4–0.8s） | 高速跟拍、不间停 | 10–14 | 0.4–0.8s |

- 要"停一下、有重量"→ 六拍。
- 要"喘不过气"→ 连续对轰。
- 要"镜头一直在换、周围一直在坏"→ ULTRA_SPEED。

**混用会两边都不成立**：六拍需要停顿，对轰需要不停。

---

## 2. 每镜五小节（打斗必须写满）

```text
[Shot N] At MM:SS.mmm, the shot cuts to a <景别> (<焦距>, <机位>) of <主体>, as the camera <运镜>.
Camera: …  Motion: …  Performance: …  Light: …  Sound: …
```

| 小节 | 必须写 | 例子 |
|---|---|---|
| **Camera** | 焦距、物距、机位高度、起幅/落幅 | `85mm from three metres at knee height, circling a third of the way around at medium speed` |
| **Motion** | 起始 → 施力点 → **支撑与重心** → 惯性 → 结束 | `her weight sinks into the rear leg, she drives off that heel, the front foot takes the whole body` |
| **Performance** | 眉/眼睑/咀嚼肌/唇/喉/呼吸，写"部位+动作" | `her jaw locks, her brows slam down, her lips peel back off clenched teeth` |
| **Light** | 光源方向+色温；**特效本身是光源** | `the column becomes the only key, washing her coat white and throwing her shadow back` |
| **Sound** | 镜内音效的秒数、环境音、台词起口 | `stone cracks at 0.4s, a pressure thump at 0.6s, then a sustained roar` |

**最便宜的打擊感 = 重心**。写清"哪只脚承重、重心从哪移到哪"，比加十个特效有用。

---

## 3. 六拍结构（一次交手）

| 拍 | 占比 | 画面 | 关键词 |
|---|---|---|---|
| 1 蓄 | 35% | 反向预备、重心下沉、布料绷紧、镜头微停 | `draws back`, `weight sinks into the rear leg`, `the camera holds a static shot` |
| 2 触 | 5% | 冲击帧：1–2 帧爆白/单色/放射线 | `for two frames the frame blows out to pure white` |
| 3 停 | 15% | 近乎冻结，尘埃火花悬停 | `decelerates to a near-freeze` |
| 4 洩 | 25% | 冲击波、碎片、尘环、光影联动 | `a ring of shockwave dust bursts outward` |
| 5 退 | 15% | 受击者飞出/滑退、衣物延迟、震屏衰减 | `is hurled backward`, `the shake decays within a third of a second` |
| 6 收 | 5% | 回 ready pose、粒子飘落、镜头回稳 | `settles into a low guard`, `embers drift down` |

三条比例：**蓄 ≥ 触的 5 倍**；**停是重量的唯一来源**；**一击只给一个视觉高潮**。

---

## 4. 招式：具名 + 配额

### 4.1 抽象动词 = 平均化动作

`he slashes at her` 只会得到最通用的挥砍。要写四层：

| 层 | 内容 | 例 |
|---|---|---|
| 1 位移 | 从哪到哪 | `steps in from her left` |
| 2 身体机制 | 哪个部位发力 | `hips rotate ahead of the shoulders` |
| 3 物理结果 | 尘、气、裂、火花 | `the edge draws a crescent of sparks off the rail` |
| 4 战术目的 | 破站势/破防/绕后 | `to take her base` |

### 4.2 15 秒（约 20 镜）配额

| 类别 | 配额 |
|---|---|
| 刀路/斩击 | **上限 8 次** |
| 踢击（腿/膝） | ≥3 |
| 拳肘（拳/肘/掌） | ≥2 |
| 摔投/擒拿（真的摔） | ≥2 |
| 下盘/绊 | ≥1 |
| 格挡/卸力 | ≥3 |
| 位移/身法 | ≥3 |

"刀路上限"是关键：没有上限，其他类别永远长不出来。

**"真的摔"的判据**：有一个人离开地面，或被迫移动超过一步。

---

## 5. 力场：特效为什么不像贴图

```
场源 → 传播（形状+速度+方向）
        ├─ ① 光    亮度、色温、阴影、反射
        ├─ ② 空气  折射、热浪、压缩、撕裂
        ├─ ③ 物质  布料、发丝、玻璃、尘土、碎石
        └─ ④ 粒子  火星、烟尘、热雾
```

一次最多开三个通道，优先级：**空气 > 物质 > 光 > 粒子**。
最便宜有效的证明：**主角的衣襬或头发被推**。一句 `wind pressure flattens the silk against her body` 胜过十句 `epic explosion`。

### 三层次能量（一镜最多三层）

1. 内层：主体能量（`teal flame licking along the blade`）
2. 中层：接触能量（`a white-hot spark bloom at the point of contact`）
3. 外层：环境反应（`lanterns swing`, `roof tiles rattle loose`, `rain pushed into a radial sheet`）

**环境层最常被漏，却最能救打擊感。**

---

## 6. 冲击帧：三种路线

| 路线 | 做法 | 精度 | 适用 |
|---|---|---|---|
| A 多卡闪切 | 独立时间段，写几张、每张停几帧、底色 | 3–4 帧 | 动画/漫画风 |
| B 变身六层 | 白闪→线稿→2D→色调分离→白闪→同姿势落定 | 卡级 | 变身/开大 |
| C 后期合成 | 主片与冲击帧分开生成，抽帧叠回 | 逐帧 | 要精确 2 帧 |

**真相**：写 `for two frames`，H3 实测会给 **21–23 帧（约 0.9 秒）**，而且角色可能消失。它把"闪白"当成一个风格镜头。

所以：
- 想要 2 帧 → **走后期**（生成 1.2 秒多卡，剪辑只留 2 帧）。
- 走提示词 → 给足 1.2 秒，写"8 张卡、每张 3–4 帧、每张铺满画面"。
- 0.3 秒会被挤成一屏。

---

## 7. 震屏与停顿

```text
the camera shakes strongly at the moment of impact, the shake decays rapidly and settles back to steady within a third of a second
```

- **必须写衰减**。恒定震动 = 相机坏了。
- **最大的那一击，相机反而应该锁死**。冲击感来自"特效把背景推开"，不是相机在抖。
- Hit stop 0.05–0.15 秒，写 `the action decelerates to a near-freeze`。

---

## 8. 高动态：速度是密度，不是形容词

| 写法 | 结果 |
|---|---|
| `high-speed fighting` / `急速打斗` | ❌ 被当风格标签，动作反而更慢 |
| 0.2 秒一个动作 | ❌ 超过时序分辨率，糊成一团 |
| **1–2 秒一镜 × 每镜 3 个具名动作** | ✅ 唯一能出极限速度的写法 |

8 秒的动作预算：**10 镜 × 每镜 2 个具名动作 = 18–24 个动作**。
提速手段的性价比：镜头运动 > 动态模糊/拖影 > **写次数**（"连闪七次" 比 "极速" 快）。

高动态三件套：

1. **拖影**：`a smear of afterimage trails her blade`
2. **运动模糊**：`motion blur only on the fastest limb`
3. **环境连动**：`dust panes shake loose`, `puddles jump`

---

## 9. 漫剧二维打斗（和实拍不一样）

- **速度线**：`radial speed lines converge on the point of impact`
- **冲击格**：`for two frames the frame drops to pure black and white with 360-degree radial lines`
- **单色环境 + 异色主体**：全画面去饱和，只有刀光/眼睛保留颜色
- **分镜切**：0.4–0.8 秒一镜，每镜一个定格姿势 + 一个方向
- **拟声字**：后期叠，不要让 H3 画

二维打斗的"重量"更多来自**定格**和**构图**，不是物理模拟。一个 0.3 秒的定格 + 冲击线，比 3 秒的连续挥砍更有力。

---

## 10. 负面约束 → 正向写法

| 想避免 | 写 |
|---|---|
| 脸变形 | `her face stays sharp and anatomically correct throughout the motion` |
| 武器弯 | `the blade stays perfectly straight and rigid` |
| 穿模 | `the two bodies never intersect; contact happens only at the blade` |
| 镜头乱跳 | `the camera moves in one continuous take with no jump cuts` |
| 特效闪 | `the flame burns continuously without flicker` |
| 动作糊 | `each pose is clearly readable, with distinct silhouettes` |
| 主角变小点 | `she remains the dominant subject, occupying 65–80% of the frame height` |

---

## 11. 可复制模板

### 11.1 实拍/三维 8 秒 5 镜（六拍）

```text
integrated_multimodal_description: [Shot 1] 3D CG, cinematic, wuxia. A low-angle wide shot frames a female swordswoman in a black high-collared sleeveless top and white layered skirt, crouched at the centre of a rain-soaked temple courtyard. Firelight from the left rim-lights her silhouette. The camera pushes in with small amplitude at fast speed through drifting embers as she drives off her rear leg and springs upward, her ponytail trailing a beat behind. [Shot 2] At 00:01.800, the camera cuts to a wide shot from below. She hangs at the apex as eight teal orbs orbit her in a slow ring; the camera arcs around her with small amplitude at slow speed. [Shot 3] At 00:03.600, the camera cuts to a close-up of a silver-haired swordsman in a dark navy robe, a thin line of blood at his mouth. He drags a bronze blade along the flagstones, throwing sparks; the camera tilts up with small amplitude at slow speed from the blade to his eyes. His jaw locks and his brows slam down. [Shot 4] At 00:05.000, he swings upward. For two frames the frame blows out to white as radial speed lines tear outward from the point of contact; the camera punches in with small amplitude at fast speed and shakes strongly, the shake decaying within a third of a second. A ring of grey dust bursts along the ground, roof tiles rattle loose, the teal orbs scatter outward, and her ponytail whips a beat late as she is driven back, boots gouging two lines in the wet stone. [Shot 5] At 00:06.400, the action decelerates to a near-freeze; only sparks and embers drift. The camera holds a static shot on the two silhouettes, then steadies.

overall_soundscape: Fine rain ticks on the flagstones under low wind. Steel grinds on stone, then a deep bass impact with a sharp metallic crack and a long reverberant tail as tiles clatter down. Wet boots skid and stop.

non_diegetic_music: Low sustained strings and a single bowed erhu at a slow tempo, cut to silence on the impact, then a low drum pulse returns at half volume.
```

### 11.2 连续对轰 15 秒（9–10 镜，一人一句）

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, 16:9. A narrow concrete corridor, flickering overhead tube light, wet floor. <Subject 1> (S1) and <Subject 2> are already inside striking distance; first contact occurs within the opening half-second. She snaps a low kick at his front knee to take his base; he turns his shin into it and answers with an elbow that she slips. The camera trucks right with small amplitude at fast speed, staying on the same side of the axis. [Shot 2] At 00:01.400, the camera cuts to a tight two-shot; he hooks her wrist and whips her past him into the wall. Plaster bursts; her shoulder takes it. [Shot 3] At 00:02.900, she reverses the grip, drives her forehead at his nose, and he reels, blood at his lip. He says, short of breath: <d>[Chinese] 够了。</d> [Shot 4] At 00:04.200, the camera cuts to her answer: a knee to his ribs, then an elbow to the back of his neck. She says: <d>[Chinese] 不够。</d> [Shot 5] At 00:05.600, he catches her next kick, dumps her over his hip; she lands on the wet floor and rolls. [Shot 6] At 00:07.000, she comes up with a pipe from the floor and swings; he blocks with his forearm, the pipe rings. [Shot 7] At 00:08.400, the camera cuts wide: both breathing hard, circling, the corridor behind them wrecked. [Shot 8] At 00:10.000, she feints low and goes high; he reads it late, takes the hit on the shoulder. [Shot 9] At 00:11.800, he grabs her collar and slams her into the wall once; her head snaps back. [Shot 10] At 00:13.200, they stop, foreheads almost touching, both gasping. She says: <d>[Chinese] 还打吗？</d> He does not answer; his lips stay closed.

overall_soundscape: Tube light buzzing, wet footsteps, short solid impacts, plaster falling, the pipe ringing, both of them breathing hard through the whole corridor.

non_diegetic_music: A single low percussion pulse at a fast tempo, no melody, cutting out at the last line.
```

### 11.3 二维漫剧 6 秒 3 镜（定格 + 冲击格）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean bold line art, not live-action. A low-angle medium shot of the swordsman mid-step, coat flaring, the blade still sheathed. Radial speed lines converge behind him; the camera holds a static shot. [Shot 2] At 00:02.000, the camera cuts to an extreme close-up of his eyes as his hand moves to the hilt. His brows slam down; the pupils contract. [Shot 3] At 00:04.000, the camera cuts to a wide shot: he draws in one motion and the frame drops to pure black and white for two frames, 360-degree radial lines bursting from the draw; the opponent is already past him, one sleeve cut. Bloodless. The camera holds a static shot as the lines fade and colour returns.

overall_soundscape: Wind, the click of the tsuba, one sharp metallic ring, then near silence.

non_diegetic_music: A single taiko hit on the draw, then silence.
```

---

## 12. 自检

- [ ] 节奏模式只选了一种
- [ ] 每镜五小节齐全，Motion 有重心
- [ ] 招式有配额，不是全程刀路
- [ ] 一镜只有一个视觉高潮
- [ ] 特效有形状、范围、光源影响
- [ ] 震屏有衰减；最大一击相机锁死
- [ ] 冲击帧走后期或给足 1.2 秒
- [ ] 主体占画面 65–80%
- [ ] 台词按 4.1 字/秒核过
- [ ] 没有 `no/not/without` 负面词
- [ ] **收尾若要"两人对峙"，单独补一镜静态双人镜头再拼接**——实测模型会在打斗末镜把对手丢掉，只剩主角

> **收尾实测（2026-11-12）**：8s 六拍打斗的末两镜对手消失。补一镜 5s `lateral two-shot … both face each other … camera holds a static shot … neither attacks`，
> 五帧两人都在、机位稳住；把原片裁到 6.2s 接上，得到完整收尾。**"收"这一拍不要交给模型自由发挥，写死双人 + 静态 + 不攻击。**
