# 导演风格（auteur grammar）→ H3 提示词

把"拍得像某某导演"翻译成**可执行的视觉语法**，而不是在提示词里喊名字。方法参考社区 `cinematic-director-frame` / `Daniskills` 的"导演语法 + 技术套件"思路，并适配 H3 的三段/六段结构。

> 来源：[cinematic-director-frame](https://github.com/zhu930824/cinematic-director-frame)、[Daniskills](https://github.com/iwerry/Daniskills)。本文是适配版，不是转载。

---

## 0. 三条核心原则

1. **翻译，不模仿。** 导演名 → 一组可观察特征（构图/机位/镜头/光/色/材质/节奏/表演距离）。**不要把在世导演的名字写进 H3 提示词**——名字对模型是弱信号，还容易诱发对具体影片的记忆。用特征句。
2. **风格 ≠ 复制镜头。** 不重建任何可识别的剧照、演员脸、标志性服装/布景。要的是"形式家族"，不是"那一帧"。
3. **签名要落在载体上。** 色彩靠布景/服装/光源/道具承载，**不靠全局滤镜**（H3 没有后期调色，写"teal-orange grade"只会得到脏画面）。去掉调色和颗粒后，形式仍应独特。

---

## 1. 七轴 DNA → H3 字段映射

每位导演抽**七轴各一个主导选择**，作为不可妥协的视觉不变量：

| 轴 | 内容 | 写进 H3 哪里 |
|---|---|---|
| 1 构图/调度 | 对称/门框/多层/负空间/视线锚点 | `detailed_description` 的 blocking 句 |
| 2 机位/镜头/运动 | 高度、距离、**一个**全画幅等效焦距、锁/推/横移 | camera 句（`The camera is on a tripod…` / `push in with small amplitude`） |
| 3 动机光 | 光源方向/软硬/对比/实际灯具 | light 句（window-motivated / sodium-vapor / hard sun） |
| 4 色彩/捕获质感 | 主色族+辅色+点缀+中性底+曝光；颗粒/halation/快门 | medium/texture 句 + 色彩载体句 |
| 5 美术/材质/服装 | 建筑、表面finish、布料、主道具、年代/磨损 | `subject_definitions` / 场景句 |
| 6 时间/快门/节奏 | 静止长持/步印拖影/运动模糊/切点密度 | motion 句 + 剪辑节奏（见 §6） |
| 7 情感距离/表演 | 克制/死pan/微表情/爆发；台词delivery | performance + `<d>` 外的 delivery 描述 |

**强度档**（决定几轴"肉眼可见"，不只是写在提示词里）：

| 档 | 值 | 可见轴 | 用在 |
|---|---|---|---|
| 轻微 inspired | 40 | ≥3 | 只想带一点味道 |
| 默认 | 85 | ≥5 | 大多数镜头 |
| 强 unmistakable | 90 | 7 轴全见、4 轴主导 | 海报镜/片头 |
| 极致 | 100 | 7 轴 + **一个**受控夸张 | 慎用；只夸张一个杠杆 |

> "强"= 更清晰的形式决策，不是更多装饰。极简导演（Ozu/Akerman）的"强"是**更严格的减法**。

---

## 2. 导演卡模板（可复制）

```text
[导演语法卡]
签名锁: <一句话，含 镜头+构图+光+色+一个情绪载体>
镜头梯: 空间广角 __mm / 人物标准 __mm / 压缩细节 __mm   ← 每镜只选一个
焦点: deep / moderate / selective（写明焦点主体）
光: <动机光源+方向+软硬+对比>
色: 主__ / 辅__ / 点缀__ / 中性__ / 曝光__；载体=<布景/服装/灯/道具>
质感: <颗粒/halation/快门/干净数字>
节奏: <锁机长持 / 慢推 / 步印 / 切点密度>
表演距离: <克制/死pan/微表情/爆发>
避免: <该导演的反模式 + 不复制的IP>
```

---

## 3. 精选导演语法（适配我们四条产线）

每个给：签名锁 / 镜头 / 光 / 色 / 节奏 / 避免 / 适合。焦距为全画幅等效近似。

### 王家卫 Wong Kar-wai — 都市怅惘（短剧情感/换脸重演）
- 锁：28mm 近距广角 + 玻璃/反射/前景遮挡 + 青绿实际光对琥珀 + 推粒/halation/选择性拖影 + 同框却错位的两人。
- 镜头 28/35 贴近；50–85 压缩私瞥。光：霓虹/钨丝/荧光混合、欠曝边缘、潮湿夜。
- 色：红/绿/琥珀/青**选一主族**；推粒+halation+步印拖影。
- 节奏：手持微漂/横移；动作支持时步印。表演：近而不得。
- 避免：赛博朋克霓虹奇观、随机 Dutch 角、MV 抛光、复制已知走廊/服装。

### 韦斯·安德森 Wes Anderson — 对称冷面（科普/quirky 漫剧）
- 锁：32mm 正面对称 + 横向平面调度 + 中深焦 + 均匀设计光 + 严格限色 + 死pan 物件编排。
- 镜头 27/32/40。光：均匀童话日光/干净内景。色：受限调色板、色块、period 材质。
- 节奏：锁正面/精确横移/轴向。表演：死pan、仪式化。
- 避免：复制已知酒店/制服/字体系统；别每帧都可爱。

### 库布里克 Kubrick — 一点透视压迫（悬疑短剧/科幻）
- 锁：24mm 一点透视 + 中心人被建筑 dwarf + 深焦 + 不可阻挡的锁/轴向机位 + 机构光 + 仪式调度。
- 镜头 24/28；18–21 受控畸变。光：实际光源写实/硬机构光。色：纪律限色+偶发结构饱和色。
- 节奏：锁对称或慢而必然的 dolly。表演：仪式、 dread。
- 避免：复制标志性酒店走廊/太空服/布景。

### 芬奇 Fincher — 程序冷控（悬疑/犯罪短剧/科普）
- 锁：35mm 机械精确构图 + 受控负空间/前景层 + 低调动机光+可读阴影 + 冷绿灰 + 运动跟随信息。
- 镜头 35/40；27–32 环境；65–85 监视压缩。光：低调实际光、护高光、深而细的阴影。
- 色：冷绿灰/钠暖、低饱和、干净数字+微粒。节奏：机械平滑 dolly/pan 或不动；运动=信息。
- 避免：死黑不可读、手持混乱、闪 flare、通用 teal-orange。

### 维伦纽瓦 Villeneuve — 巨物敬畏（科普宇宙/科幻漫剧）
- 锁：28mm 纪念碑负空间 + 小孤立人影 + 深大气分离 + 穿雾方向光 + 矿物色 + 仪式静止。
- 镜头 28/35 尺度；50–75 压缩内省。光：方向自然光+雾+阴天扩散+剪影逻辑。
- 色：矿物中性/沙/炭/雾蓝+一个哑光材质点缀。节奏：静或慢控。表演：敬畏、孤立。
- 避免：复制沙漠服装/飞船/橙尘世界/ franchises 建筑。

### 是枝裕和 Kore-eda — 家庭观察（亲情向/现实短剧）
- 锁：50mm 平视家庭观察 + 门框分层调度 + 软窗光 + 克制自然色 + 情绪藏在未完成家务动作。
- 镜头 40/50；65–85 私密不 glam。光：软窗日光/阴天/家用暖。色：自然肤/木/洗衣白/哑绿棕+微粒。
- 节奏：耐心、基本静止。表演： withheld、日常手势。
- 避免：情节剧 posing、攻击性调色、英雄特写。

### 小津安二郎 Ozu — 低机位静观（家庭/年代）
- 锁：50mm 低坐机位锁死 + 门槛 domestic 几何 + 中深焦 + 均匀软内光 + 一个小结构红点缀 + withheld 反应。
- 镜头 40/50。光：均匀软内日光。色：安静 domestic + 小红点缀。节奏：**锁死，切代替运动**。
- 避免：浮动机位、浅焦 glam、夸张广角、煽情特效。

### 张艺谋 Zhang Yimou — 仪式色场（国风漫剧/大片感）
- 锁：28mm 仪式群体几何 + **一个**主导饱和色场 + 深图形调度 + 方向硬光/天气 + 个体对集体秩序。
- 镜头 24–35 群体；50 仪式亲密；85–135 压缩重复。光：硬日/雾/雪/火/色布反射+剪影。
- 色：**选一系统**——朱红/黑、靛/土、金/炭、雪白/红点缀。节奏：锁纪念碑/精确 crane/横向队列。
- 避免：混多套色系统；复制宫殿/武侠意象；无戏剧层级的装饰人群。

### 黑泽明 Kurosawa — 天气动作（武打/群戏）
- 锁：28mm 多平面动作 + 大胆对角调度 + 深焦 + 方向天气+硬调分离 + 决定性运动横穿画面。
- 镜头 24–35 空间动作；100–135 压缩雨/尘/ crowd/脸。光：硬日/高对比阴/雨/雪/风/烟+背光。
- 色：纪律土/黑/灰/白+一个纹章点缀。节奏：锁清晰/横移/有力轴向；动作有可读方向。
- 避免：复制武士服装/battle 调度/标志 pose；无戏剧功能的天气。

### 诺兰 Nolan — 物理紧迫（科幻/动作短剧）
- 锁：35mm 落地大尺度 + 人前景对实际建筑 + 中深空间清晰 + 硬自然/实际光 + 物理紧迫无 fantasy glow。
- 镜头 35/50；24–28 环境；65–85 压缩紧迫。光：自然硬日光/夜实际光、高动态无 glow。
- 色：中性/冷写实、密黑、大画幅化学清晰+粒。节奏：落地手持或精确大画幅运动；物理不失重。
- 避免：复制面具/载具/ dream-city / franchises 布景。

### 希区科克 Hitchcock — 悬念 clues（悬疑短剧）
- 锁：35mm 主观几何 + 一个精确埋的视觉 clue + 受控框中框 + 动机悬念光 + 视线/机位揭示危险知识。
- 镜头 24–35 空间悬念；50 客观；85–100 clue/监视压缩。焦点：深到能埋威胁，或精确 rack 从观察者到 clue。
- 光：动机实际光对比/剪影/影纹。色：受控 primaries/cream/炭/冷绿蓝+一个警告点缀。
- 避免：复制著名楼梯/淋浴/鸟/剪影/ twist 道具。

### 莱昂内 Leone — 对峙拉伸（武打/对峙收尾）
- 锁：极 24mm  landscape 对 180mm 脸部细节 + 决动前长静止 + 低地平线 + 硬日+尘 +  tactile 眼/手/皮/金属。
- 镜头 24–28 尺度；50 身体仪式；135–180 眼/手/压缩对峙。焦点：深 landscape 或 razor  tele 细节。
- 光：硬方向日/尘背光/密荫/钨丝夜。色：晒赭/烟草棕/褪蓝/铁黑+汗/尘/旧皮木。
- 节奏：纪念碑静止→慢推→精确横揭。避免：复制西部服装/枪带/标志 standoff；无因果张力的极特写。

### 奉俊昊 Bong Joon-ho — 阶层几何（现实/讽刺短剧）
- 锁：28mm 阶层编码建筑 + 多层调度 + 同框内精确调性转变 + 动机类型光 + 前景 clue 与背景后果都可读。
- 镜头 24–35 空间因果；50 群戏关系；85–100 监视/clue 压缩。焦点：深关系调度或阶层平面间 rack。
- 光：自然建筑/荧光机构/硬雨/受控夜实际光。色：混凝土灰/潮绿/家暖琥珀/黑+一个阶层编码饱和点缀。
- 避免：复制地下室/特定房子/生物/制服；把社会对比变成通用 thriller。

### 伯格曼 Bergman — 面部对峙（对白特写/心理）
- 锁：85mm 面部几何 + 精确视线对立 + 稀疏暗背景 + 雕塑侧光 + 情绪held在微表情与沉默。
- 镜头 50–58 人近；85–100 压缩面部对峙。焦点：精确眼/肤平面，无 glam 软。
- 光：硬窗边/软正面/深黑分离+护肤质。色：单色或克制肤/炭/骨/哑蓝灰+ tactile 粒。
- 避免：美颜、戏剧化哭、通用 noir、复制已知双脸构图。

> 其余（杨德昌/侯孝贤/朴赞郁/科波拉/塔可夫斯基/费里尼/瓦尔达/阿克曼/阿莫多瓦/马利克）见来源 repo 的 `director-grammars.md`；方法相同，按 §2 卡片自填。

---

## 4. 产线 → 导演 推荐

| 产线/场景 | 首选 | 备选 |
|---|---|---|
| 漫剧·国风/仪式 | 张艺谋 | 黑泽明 |
| 漫剧·quirky/科普包装 | 韦斯·安德森 | 阿莫多瓦 |
| 短剧·悬疑/犯罪 | 芬奇 / 希区科克 | 库布里克 / 奉俊昊 |
| 短剧·情感/都市 | 王家卫 | 是枝裕和 / 索菲亚·科波拉 |
| 短剧·家庭/年代 | 是枝裕和 / 小津 | 杨德昌 / 侯孝贤 |
| 短剧·科幻/动作 | 诺兰 / 维伦纽瓦 | 库布里克 |
| 科普·宇宙/巨物 | 维伦纽瓦 | 诺兰 / 塔可夫斯基 |
| 科普·冷峻数据 | 芬奇 | 库布里克 |
| 换脸·舞台/重演 | 王家卫 | 费里尼 / 莱昂内 |
| 武打/对峙 | 黑泽明 / 莱昂内 | 朴赞郁 |
| 对白特写/心理 | 伯格曼 | 侯孝贤 |

---

## 5. 混合规则

- **一个主语法**管构图/镜头/机位；**至多一个次语法**只管光/色/质感。
- **不要平均焦距**——从主语法选一个镜头。
- 显式解决冲突，例："是枝裕和的调度与 50mm 观察；仅借用王家卫的混合实际光色。"
- 不导入任何影片的签名布景/服装/演员/道具。

---

## 6. H3 视频特有的三个轴

静帧 skill 不管时间，H3 必须管：

1. **时间/快门**：H3 原生 24fps。要"步印拖影"（王家卫）写 `selective step-printed motion smear on the moving hand, faces stay sharp`；要"机械平滑"（芬奇）写 `mechanically smooth dolly, no handheld jitter`；要"长持静止"（小津/阿克曼）写 `The camera is on a tripod and does not move; the scene holds for the full shot`。**别写 "very slow push" 当锁机位**（会反噬成持续重构图）。
2. **色彩靠载体**：H3 无后期调色。把主色族写进布景/服装/灯/道具（`vermilion banners and lacquered black columns`），不写 `grade it teal-orange`。
3. **与连续性兼容**：导演语法是**每镜**的形式约束，不改变 Hub/Chain 决策（见 `longform-continuity.md`）。同一场用同一导演卡，锁短语逐字复用，避免跨镜"换导演"。

---

## 7. worked example：一条科普镜头的三种语法

同一条"外星人报数据"镜头，三种导演翻译（三段式，名字不进提示词）：

**维伦纽瓦（敬畏）**
```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic. A 28mm frame holds monumental negative space: the small humanoid alien silhouette stands low-center against a vast fog-blue mineral hall, deep atmospheric separation, directional light cutting through haze. The camera is locked at human eye level and does not move. She raises one hand; a muted sand-colored data glyph ignites above her palm. Mineral neutrals, charcoal and fog blue carried by the stone walls and her coat, one muted accent. She speaks in a calm, slow voice: <d>[Chinese] 一万倍是夸张了。</d>
overall_soundscape: A vast low room tone, a single soft hum as the glyph ignites.
non_diegetic_music: N/A
```

**芬奇（冷控）**
```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic. A mechanically exact 35mm frame, level horizon, controlled negative space, foreground console edge layering the shot. Low-key motivated practicals, cool green-gray restraint, deep readable shadows. The camera dollies with mechanical smoothness, movement following the information as the alien's hand crosses to the readout. She speaks in a level, precise voice: <d>[Chinese] 一万倍是夸张了。</d>
overall_soundscape: Quiet server-room hum, one soft key click.
non_diegetic_music: N/A
```

**王家卫（怅惘）**
```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic. A 28mm close-wide through a rain-streaked glass partition, foreground obstruction and reflections layering the alien and the man in the same frame yet emotionally displaced. Cyan-green practical light against restrained amber, pushed grain and halation, selective step-printed smear on her turning head. She speaks in a low, withheld voice: <d>[Chinese] 一万倍是夸张了。</d>
overall_soundscape: Humid night room tone, neon buzz, rain on glass.
non_diegetic_music: N/A
```

---

## 8. 验收（thumbnail 测试）

- [ ] 缩略图尺寸下，导演兼容的**配色/构图**仍可辨（不读提示词）。
- [ ] ≥5 轴肉眼可见（默认档），主导轴 unmistakable。
- [ ] **去掉调色和颗粒**后形式仍独特（不是"通用 cinematic"）。
- [ ] 只有一个committed焦距；透视压缩/畸变与焦距+机位距离一致。
- [ ] 色彩由布景/服装/光/道具承载，非全局 tint；肤色可信。
- [ ] 无 letterbox 黑边/字幕/logo/水印 baked-in；无复制的剧照/演员/服装。
- [ ] 提示词里**没有在世导演名字**。
- [ ] 锁机位用状态句；时间轴（快门/步印/静止）与导演节奏一致。
