# 可复制提示词模板

所有模板都遵守：英文正文 + 中文台词进 `<d>[Chinese] …</d>` + 三段/六段字段 + 不写负面词。
`{}` 是占位符，整段替换；`<>` 是 H3 的参考标签，保留。

---

## 1. 漫剧 · 单镜 i2v（首帧已定）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean bold line art, flat color blocks, not live-action, not photographed. The framing, character design, outfit and lighting follow <Picture 1> exactly; keep the face, hairstyle and background unchanged. {运镜：The camera pushes in with small amplitude at slow speed / holds a static shot / pans right with small amplitude}. {动作：他的眼神收紧，右手在袖中慢慢握成拳}. {环境动态：雨丝斜掠过画面，衣角被风掀起}. {他不出声。}

overall_soundscape: {雨打铁皮棚，远处一声闷雷，布料摩擦的轻响}.

non_diegetic_music: {N/A 或 一记低频太鼓，慢速，无旋律}.
```

---

## 2. 漫剧 · 单镜 i2v（带一句台词）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action. A medium close-up follows <Picture 1>: the young man with messy black hair and a dark high-collar jacket, rain on his face. The camera holds a static shot as he lifts his eyes to the sky. The young man (S1), on-screen, with a low, tired voice at a slow pace, says: <d>[Chinese] 这雨，不对劲。</d> His lips close; rain keeps falling.

overall_soundscape: Steady rain, water dripping from an awning, a distant car passing.

non_diegetic_music: N/A
```

> 台词 ≤14 字；说话人独占画面；不要写"他不大喊"这类否定。

---

## 3. 漫剧 · 一条生成 3 个镜头（t2v）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action, no real actors. A wide shot of a rain-soaked alley at night, neon reflections in puddles; a lone figure stands at the far end. The camera holds a static shot. [Shot 2] At 00:01.800, the camera cuts to a close-up of his boots stepping into a puddle, water splashing. [Shot 3] At 00:03.400, the camera cuts to a low-angle medium shot as he lifts his head; the neon sign behind him flickers once. He does not speak.

overall_soundscape: Rain on concrete, a boot splash, a neon buzz that cuts out for half a second.

non_diegetic_music: A single sustained low string, slow, fading out at the end.
```

> 5 秒 3 镜可以；15 秒最多 5–6 镜。切点按实际帧数写（5s = 5.17s）。

---

## 4. 漫剧 · r2v 跨镜锁人（六段）

```text
subject_definitions: <Subject 1> is the young man in <Picture 1> and <Picture 2>, 22 years old, slim, messy black hair, a thin scar under his left eyebrow, dark high-collar jacket with silver clasps. <Subject 2> is the alley in <Picture 3>, narrow, wet brick walls, a red neon sign on the left, steam rising from a vent on the right. <Picture 1> is the opening composition of [Shot 1].

summary: [reference generation] The young man walks through the alley, stops when the neon sign flickers, and looks up.

retention_analysis: <Picture 1> ([Shot 1] first frame): fully_preserved - framing, standing position and light direction open the shot as supplied. <Subject 1> (appears in [Shot 1]): fully_preserved - face shape, eyebrow scar, hair silhouette and jacket stay identical; expression and pose follow this shot. <Subject 2> (appears in [Shot 1]): partially_preserved - wall texture, neon position and vent steam are kept; small props may follow the action.

detailed_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action. The shot opens on <Picture 1>: <Subject 1> stands mid-frame in <Subject 2>, rain falling between him and the camera. The camera pushes in with small amplitude at slow speed as he takes two steps forward, stops, and lifts his eyes to the red neon sign. The sign flickers twice; its red light washes across his face, then dies. He exhales, and his breath fogs in the cold air. He does not speak.

overall_soundscape: Rain on brick, footsteps in shallow water, a neon transformer buzzing, then a soft click as the sign goes dark.

non_diegetic_music: N/A
```

---

## 5. 科普 · 双人对话 r2v（正反打，两镜）

```text
subject_definitions: <Subject 1> is the young Chinese man in <Picture 1>, 25, slim, short buzz cut, black square-framed glasses, grey hoodie. <Subject 2> is the humanoid female alien in <Picture 2>, tall and slender, pearl-grey skin, bald head, huge amber eyes, a glowing diamond mark on her forehead, deep navy coat with light-blue trim. <Subject 3> is the rented room in <Picture 3>: single bed, computer desk by the window, handwritten plan on the wall, warm desk lamp.

summary: [reference generation] In the rented room at night, the man bets he can trade sleep for training; the alien accepts and warns him about day three.

retention_analysis: <Subject 1> (appears in [Shot 1]): fully_preserved - face, glasses and hoodie stay identical. <Subject 2> (appears in [Shot 2]): fully_preserved - skin texture, forehead mark and coat trim stay identical. <Subject 3> (appears in [Shot 1], [Shot 2]): partially_preserved - bed, desk and lamp positions are kept.

detailed_description: [Shot 1] Live-action, cinematic, 35mm, shallow depth of field, realistic skin texture. A medium shot frames <Subject 1> sitting on the bed in <Subject 3>, lit only by the phone in his hand. He frowns at the screen, then says in a fast young male voice: <d>[Chinese] 从明天起，我只睡五小时，省下的全拿去练。</d> He lowers the phone and sets his jaw. [Shot 2] At 00:04.200, the camera cuts to a medium close-up of <Subject 2> standing beside the desk, her forehead mark brightening from dim to bright blue. She says in a calm, slow adult female voice: <d>[Chinese] 我赌你第三天，会饿到怀疑人生。</d> Her lips close. A thin blue scan line passes over the bed and disappears.

overall_soundscape: A quiet room at night, the soft tap of a finger on a phone screen, a faint electronic hum rising as the forehead mark lights up.

non_diegetic_music: N/A
```

> 两镜 8 秒左右；每条台词 ≤16 字；第二镜开口时间写 4.2 秒，留出第一镜说完的余量。

---

## 6. 科普 · 穿越转场（连续镜头，无台词）

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, 35mm, shallow depth of field. A close-up of the refrigerator's interior light in a dark kitchen; the camera pushes in with small amplitude at slow speed until the white light fills the frame. [Shot 2] At 00:03.200, the white light dissolves into the ceiling lights of a huge stainless-steel control room; the camera pulls out with small amplitude at slow speed to reveal two round gauges on the far wall, one red and one green, and a long console below them. Steam drifts across the floor. No people in this shot.

overall_soundscape: A refrigerator compressor humming, rising into a low electrical drone, then a soft room tone with dripping condensation.

non_diegetic_music: A slow pulsing synth note, one per second, no melody.
```

> 转场靠"光/孔/屏幕"填满画面再穿出；中间不要黑场，不要写"淡入淡出"除非真要。

---

## 7. 科普 · 空间内的数据镜（画外音）

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, macro lens, shallow depth of field. A close-up of the red gauge on the control-room wall; the needle snaps from the middle to the far right and starts trembling against the stop pin. Condensation runs down the glass. The alien (S2) says in an off-screen voiceover, calm and slow: <d>[Chinese] 让你饿的激素，涨了百分之二十八。</d> Her lips remain completely closed. The needle holds at the maximum.

overall_soundscape: A metallic ping as the needle hits the pin, a low electrical hum, a drop of water falling onto metal.

non_diegetic_music: N/A
```

> 数字念全（"百分之二十八"），不要写"28%"让模型猜。

---

## 8. 空镜 / 氛围镜（无人物）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean line art, not live-action. A wide static shot of an empty classroom at dusk: dust floating in a shaft of orange light, desks in neat rows, one chair turned over. The camera holds a static shot. Nothing moves except the dust and a curtain breathing at the window.

overall_soundscape: Distant traffic, a curtain flapping softly, a clock ticking somewhere off-screen.

non_diegetic_music: A single piano note, held, with long reverb.
```

---

## 9. 字卡背景（后期叠字用）

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, not live-action. A flat, almost empty composition: a dark indigo gradient sky with a thin band of warm orange at the horizon, and a single silhouette of a rooftop railing in the lower third. The camera holds a static shot. The frame stays clean and unmarked.

overall_soundscape: Low wind, a faint city hum.

non_diegetic_music: N/A
```

> 不要在提示词里要求写字；标题/第 N 天/CTA 全部后期用 ASS 叠。

---

## 10. 参数速查

| 场景 | mode | aspect | duration | turbo | megapixels |
|---|---|---|---|---|---|
| 漫剧打样 | t2v / i2v | 9:16 | 4–5 | true | 0.4 |
| 漫剧定稿 | i2v / r2v | 9:16 | 3–6 | false | 0.7–1.0 |
| 科普打样 | t2v | 16:9 | 4–5 | true | 0.4 |
| 科普定稿 | r2v | 16:9 | 8–15 | false（r2v 无 turbo） | 0.7–1.0 |
| 转场 | t2v | 同正片 | 3–4 | true | 0.4 |

`speed` 与 `seed`：定稿固定 seed；打样随机。改 prompt 就换 seed，否则会以为是 prompt 没用。

---

## 11. 负面词对照（别写 → 写）

| 别写 | 改写成 |
|---|---|
| `no subtitles, no text` | `The frame is clean and unmarked.` + 后期遮盖 |
| `not photorealistic` | `2D hand-drawn anime, cel shading, flat color blocks.` |
| `don't move the camera` | `The camera holds a static shot.` |
| `he is not angry` | `His jaw loosens and his shoulders drop.` |
| `no extra characters` | `Only the young man is in frame.` |
| `no modern objects` | `A bronze oil lamp, a clay cup, a wooden stool.`（只列该有的） |

---

## 12. 三人议事（r2v，15 秒 3 镜）

站位：**左前景背影 / 中景说话人 / 右背景听众**。

```text
subject_definitions: <Subject 1> is the middle-aged woman in <Picture 1>, short grey bob, black blazer, standing with her back three-quarters to camera. <Subject 2> is the humanoid female alien in <Picture 2>, tall, pearl-grey skin, bald, glowing diamond mark, deep navy coat. <Subject 3> is the young Chinese man in <Picture 3>, 25, buzz cut, black glasses, grey hoodie. <Subject 4> is the meeting room in <Picture 4>: long table, blinds half closed, cold overhead light.

summary: [reference generation] A fifteen-second three-hander in the meeting room. The woman in the foreground opens, the alien answers, the young man pushes back.

retention_analysis: <Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - hair, blazer and silhouette stay identical. <Subject 2> (appears in [Shot 2]): fully_preserved - skin, forehead mark and coat trim stay identical. <Subject 3> (appears in [Shot 2], [Shot 3]): fully_preserved - face, glasses and hoodie stay identical. <Subject 4> (appears in all shots): partially_preserved - table, blinds and light positions are kept.

detailed_description: [Shot 1] Live-action, cinematic, 35mm. <Subject 1> stands in the LEFT foreground, back three-quarters to camera, her shoulder filling the left edge; <Subject 2> stands CENTRE mid-ground facing her; <Subject 3> sits at the RIGHT background, facing frame left, partly behind the table. The camera holds a static shot. <Subject 1> says in a low, level female voice: <d>[Chinese] 他不是在赌，是在拖时间。</d> Her lips close. <Subject 2> and <Subject 3> keep their lips completely closed and stay silent. [Shot 2] At 00:05.000, the camera cuts to a medium shot of <Subject 2> in the centre, the other two out of frame. Her forehead mark brightens. She says in a calm, slow voice: <d>[Chinese] 拖时间，对他没有好处。</d> [Shot 3] At 00:10.000, the camera cuts to a two-shot: <Subject 3> at the right background, <Subject 2>'s shoulder in the left foreground. <Subject 3> leans forward and says in a fast young male voice: <d>[Chinese] 那你们怕什么？</d> <Subject 2> does not answer; her lips remain completely closed.

overall_soundscape: A quiet meeting room, the blinds ticking in the draught, a chair creaking once, distant traffic through the glass.

non_diegetic_music: N/A
```

> 三人同框那一镜，另外两人必须写"闭嘴且沉默"；下一镜再切单人，声线才不糊。

---

## 13. 四人对峙（t2v，10 秒 2 镜）

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, 16:9, anamorphic. A narrow warehouse office: one bare bulb, a steel table, four people split into two pairs. <Subject 1> and <Subject 2> stand on the LEFT, backs to the roller shutter; <Subject 3> and <Subject 4> stand on the RIGHT, backs to the frosted window. Exactly four people. The camera looks down the table from the near end, so the left pair is nearer and the right pair is farther. The camera holds a static shot. <Subject 3>, the tall man on the right, says in a low, flat voice: <d>[Chinese] 东西呢？</d> The other three keep their lips completely closed. [Shot 2] At 00:05.000, the camera cuts to a tight two-shot of the left pair. <Subject 1> lifts a canvas bag onto the table and says in a tight female voice: <d>[Chinese] 先放人。</d> <Subject 2> does not speak.

overall_soundscape: The bulb buzzing, canvas scraping on steel, boots shifting on concrete, rain on the shutter.

non_diegetic_music: A low drone at a slow tempo, no percussion.
```

---

## 14. 武打与高动态

完整方法（六拍、连续对轰、ULTRA_SPEED、招式配额、力场四通道、冲击帧、震屏、8 秒/15 秒模板）见 `action-dynamics.md`。

二维漫剧的 6 秒 3 镜速用版：

```text
integrated_multimodal_description: [Shot 1] 2D hand-drawn anime, cel shading, clean bold line art, not live-action. A low-angle medium shot of the swordsman mid-step, coat flaring, the blade still sheathed. Radial speed lines converge behind him. The camera holds a static shot. [Shot 2] At 00:02.000, the camera cuts to an extreme close-up of his eyes as his hand moves to the hilt; his brows slam down and his pupils contract. [Shot 3] At 00:04.000, the camera cuts wide: he draws in one motion and the frame drops to pure black and white for two frames, 360-degree radial lines bursting from the draw; the opponent is already past him, one sleeve cut. The camera holds a static shot as colour returns.

overall_soundscape: Wind, the click of the tsuba, one sharp metallic ring, then near silence.

non_diegetic_music: A single taiko hit on the draw, then silence.
```

---

## 15. 运镜与转场

完整方法（切镜时机、30 度、动作接动作、八种转场、尾帧接力）见 `camera-and-transitions.md`。

**穿入转场（科普，4 秒 2 镜）**

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, macro lens. The camera pushes in with large amplitude at slow speed into the refrigerator's interior light until the white fills the entire frame. [Shot 2] At 00:03.200, the white lifts into the cold blue glow of a stainless-steel control room; the camera pulls out with small amplitude at slow speed to reveal two round gauges on the far wall, one red and one green, and a long console below. Steam drifts across the floor. The room is empty.

overall_soundscape: A refrigerator compressor humming, rising into a low electrical drone, then a room tone with dripping condensation.

non_diegetic_music: A slow pulsing synth note, one per second, no melody.
```

**甩镜转场（0.4 秒完成）**

```text
The camera pans right with large amplitude at extreme speed, the frame smearing into horizontal streaks, and settles on the woman standing at the window in the next room; the streaks clear within four frames.
```

**硬切 + 动作接动作**

```text
[Shot 1] ... He pushes the door; his hand is still on the handle as the shot ends.
[Shot 2] At 00:03.000, the camera cuts to the corridor side of the same door as it finishes swinging; his hand is still on the handle, the folder under his arm.
```
