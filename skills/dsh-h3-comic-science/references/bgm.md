# BGM：社区实践与决策

**一句话：H3 视频 baked 的音乐没有分轨，一旦混进画面就拿不出来。所以"要不要让 H3 出音乐"是开工前就要定的，不是后期补救。**
**但"分轨"可以靠独立生成得到**：speech 用 H3 T8 Speech Studio、BGM 用 MiniMax Music 3，两者是独立 FLAC，可"保留对白只换音乐"——见 `audio-assets.md`。本文的"无分轨"仅指**视频里那条混音**。

---

## 1. 硬事实：H3 输出的是一条混好的音轨

一次生成，你拿到的是**对白 + 环境声 + 音效 + 音乐（如果 prompt 提到）混在一起的一条轨**。

平台文档**没有提供 stems**（分轨导出）。这意味着：

- 想"保留对白、只把音乐换掉"——**做不到**
- 想"音乐小一点"——只能整体压，对白跟着小
- 唯一能改的办法是**重新生成**，而重生成会连画面一起变

> 社区常说的一句话：*"Without documented stems, clean isolation may not be possible. Regenerating could improve the audio, but it can also change an already approved image."*（[Sonilo 的对照评测](https://sonilo.com/blog/comparisons/h3-max-native-audio-vs-ai-music)）

例外：**Pika H3 Flex** 这一支支持音频分轨；要 stems 就得换模型，不能用原版 H3。

---

## 2. 更麻烦的是：H3 会自己加音乐

和字幕一样，音乐也经常"不请自来"：

| 你怎么写 | 会发生什么 |
|---|---|
| 省略 `non_diegetic_music` 字段 | 模型自己补一段 |
| 写了但只写情绪词 | 出来是"平均化的背景音乐" |
| 环境声写太满（天气、交通、电气底噪） | 渲染成**嘶声**，甚至**变成音乐** |

官方的提示词改写规范里有一条值得直接抄：

> `non_diegetic_music`: Use only explicitly specified or explicitly referenced music. **If none: `N/A`**
> Music: ONLY from user instructions or assigned Audio references. **Do not invent music.**

**所以：不想让 H3 出音乐，就显式写 `N/A`；不要留空，也不要在提示词任何地方提"背景音乐"这个词（哪怕是说不要）。**

---

## 3. 决策：原生音乐 vs 外挂音乐

| 判断项 | 用 H3 原生音乐 | 外挂一条独立音乐轨 |
|---|---|---|
| 片子长度 | 单镜、5–15 秒、自成一体 | **多镜拼接、>15 秒** |
| 音乐要不要跨切点 | 不跨 | **要跨** |
| 要不要有"音乐弧线"（起承转合） | 不需要 | **需要** |
| 对白密度 | 无对白或很少 | **对白多，音乐必须让路** |
| 后期改动频率 | 一次定稿 | **客户常改"这段再安静点"** |
| 多语言/多平台 | 不需要 | 需要换版本 |

**核心原因：5–15 秒出不来一段音乐的弧线。**

一个 30 秒的成片由三段生成拼成时，H3 给的是三段各自的 5–15 秒音乐，拼起来是**三首曲子的接缝**，不是一首曲子的 30 秒。社区结论很直接：*"That duration may suit a single social shot. It does not automatically create a musical arc for a 30-second sequence assembled from three generations."*

**默认策略：**

- **漫剧 / 科普片（多镜、>60 秒）→ 外挂音乐**
- **单条产品片 / 情绪短镜（≤15 秒）→ 可以原生**

---

## 4. 三条路线

### A. H3 原生（一次成型）

```text
non_diegetic_music: Sparse piano notes at a slow tempo, joined by sustained low strings that gradually increase in volume before fading out.
```

只在**单镜、短、不需要改**的时候用。

### B. H3 只出环境声 + 外挂音乐（推荐）

```text
overall_soundscape: A quiet room at night, the fridge humming in the next room, fabric shifting as he sits.
non_diegetic_music: N/A
```

后期用 `finish.py --music bgm.mp3` 铺一条独立音乐轨，带闪避。
**好处**：改音乐不用重渲画面；音乐能跨切点；多平台换版本只重混一次。

### C. 参考音轨驱动（有现成歌曲时）

用 vocal stem 驱动口型，整轨做最终音轨（Context-Loop 的 "Lip-sync to source audio" 模式）。
**前提**：模型侧要支持参考音频（本插件不支持，见 §8）。

---

## 5. 写原生音乐时的措辞

官方规定：**写乐器、速度、节奏、动态，不写情绪词**。

| ❌ 别写 | ✅ 写 |
|---|---|
| `epic emotional music` | `low sustained strings at a slow tempo, one bowed erhu line` |
| `sad background music` | `sparse piano notes, widely spaced, gradually decreasing in volume` |
| `音乐要很燃` | `taiko hits on every second beat, accelerating from 90 to 120 bpm` |
| 解释"这段音乐想表达什么" | 只写配器、速度、强弱变化、进出时机 |

这条和 `dsh-video-narration` 里音乐模型的经验一致：**音乐模型认识"dark ambient drone"，不认识"不要太欢快"。**

---

## 6. 后期混音（社区通行做法）

### 6.1 先定格音量关系

| 层 | 目标 |
|---|---|
| 对白 / 旁白 | −16 LUFS |
| 环境底 | 比对白低 4–6 dB |
| 音乐 | **比对白低 12–18 dB** |

音乐一旦和对白同电平，观众会本能地"听不清台词"，然后放弃。

### 6.2 闪避（ducking），不要硬压

对白一响，音乐自动退 6–10 dB，说完再回来。ffmpeg 用 `sidechaincompress`：

```text
[0:a]asplit=2[dial][sc];[m][sc]sidechaincompress=threshold=0.02:ratio=12:...
[dial][duck]amix=inputs=2:duration=first:normalize=0
```

**不要用"把 BGM 整体调小"来救对白**——那是把音乐废掉，而不是让它让路。

### 6.3 顺序不能反

1. 先把对白/环境**响度标准化**（−16 LUFS）
2. 再铺音乐（音乐按比例给）
3. 最后**限幅**，别让叠加后爆掉

H3 原生音轨本身就接近 0dB，先叠音乐再标准化必爆。

### 6.4 长度：音乐永远比画面"不够长"

生成模型给不了你要的精确长度。做法：**循环铺满 + 片尾 1.5 秒淡出**。
带节拍的音乐循环会"踩错拍"，所以要么找无节拍的铺底，要么按段落裁切对齐。

---

## 7. 跨切点的音乐连续性（最难的一条）

逐段生成音乐，每个切点都会"重启"——观众听到的是**每 5 秒换一张 CD**。

实测记录（nextsycl 的场景边界测试）：在提示词里写"同一段音乐盒旋律延续"，下一段**开头 −46 dB 近乎无声，然后突然蹿到 −17 dB**。写"延续"没用。

三条对策：

1. **一条独立音乐轨**（首选，一劳永逸）
2. 逐段生成时，把上一段的音轨作为下一段的音频参考（Context-Loop 的 `first_audio`），但**说话镜不能用**——尾音会被当成开头重放一遍
3. 或者干脆**不让 H3 出音乐**，只用它出环境声，音乐全靠后期

---

## 8. 本插件（`h3_generate`）的能力边界

| 能力 | 本插件 | 影响 |
|---|---|---|
| `non_diegetic_music` 字段 | ✅ 写进提示词 | 可以要，也可以显式 `N/A` |
| 参考音频（锁音色/带 music） | ❌ | 锁不住跨段音色，也不能带一段音乐进去 |
| 视频 baked 分轨导出 | ❌ | 混进去的拿不出来 |
| 独立 speech / BGM 生成 | ✅ | H3 Speech Studio（U33）/ Music 3（M1），见 `audio-assets.md` |
| 音频锚点 / 携带上一段音轨 | ❌ | 音乐不可能跨镜连续 |

**结论：本插件只适合"H3 出环境声 + 后期外挂音乐"。想让它出能跨镜的音乐，做不到。**

---

## 9. 用法

```bash
# H3 只出环境声，音乐后期铺（推荐）
python finish.py --out final.mp4 --clips clips/*.mp4 \
    --aspect 9:16 --music bgm.mp3 --music-volume 0.25

# 纯音乐片（没有对白要避让）才关闪避
python finish.py --out final.mp4 --clips clips/*.mp4 --music bgm.mp3 --no-duck

# 音乐比画面短会循环铺满；不想循环就加 --no-loop
python finish.py --out final.mp4 --clips clips/*.mp4 --music bgm.mp3 --no-loop
```

`finish.py` 的处理顺序：统一画幅 → 合片 → **响度标准化** → 字幕 → **铺音乐（闪避 + 淡出）** → 封装。

### 实测（2026-11-12，三段 0.4MP 素材 + 8 秒测试音）

| 项 | 结果 |
|---|---|
| 8 秒音乐 → 25.4 秒成片 | ✅ 循环铺满，片尾 1.5s 淡出 |
| 闪避生效 | ✅ 同样音量下，音乐频带能量比不闪避低 **1.3 dB**（整体均值；因为源音轨本身在该频带有能量，实测偏保守） |
| 响度 | 铺完音乐仍在前一步标准化的 −16 LUFS 附近，未爆 |

> **教训**：音乐音量 0.25 时，用频带能量根本测不出差别（源音轨自身能量盖过音乐）——**验证闪避要把音乐开满再 A/B**，否则会误判"没生效"。

---

## 10. 版权

- H3 生成的原生音轨可以用，但**不要用来路不明的 BGM**
- 商用前确认音乐授权；平台对"AI 生成 + 版权音乐"有各自规则
- 发布时标注 AI 生成