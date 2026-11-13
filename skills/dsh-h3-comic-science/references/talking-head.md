# 对口型与声音克隆（口播的另一条路）

`native-dialogue.md` 的结论是"情绪戏用原生口播"。但有两种情况原生口播不够：**已有确定音频**（配音/歌曲/客户录音）和**要跨集同音色**。这两件事在这批工作流里有现成解法。

---

## 1. 三条路线

| 路线 | 工作流 | 适用 | 代价 |
|---|---|---|---|
| **A 图+音对口型（H3）** | U11 | 已有一张角色图 + 一段音频，生成说话视频 | 单段 4–15s |
| **B 长口播（InfiniteTalk）** | J13 | 90 秒级单人讲话 | 分段链式，重 |
| **C 声音克隆（FishAudio）** | N2 | 要固定音色做 TTS | 只是音频，不含口型 |

**推荐组合**：C（克隆音色出配音）→ A（图+音对口型）→ 剪进片子。比纯 TTS 贴脸稳，比纯原生口播可控。

---

## 2. A：H3 图 + 音对口型（U11）

节点链（API 格式）：

```text
LoadImage(角色图) ─┐
VHS_LoadAudioUpload(音频) ─→ DenoAudioTranscript / TextGenerate（把音频转成台词/描述）
                    └→ DenoMiniMaxH3ReferenceToVideo(prompt, width, height, length, ref_images, ref_audios)
                        → BasicGuider → SamplerCustomAdvanced → VAEDecode(video) → CreateVideo → SaveVideo
```

要点：

- 底模 `minimax_h3_ref2va_pruned_int8` + **turbo 4step 768p LoRA**（U11 用的就是加速档）。
- `length` 必须覆盖音频时长（17k+5 网格）；音频要先用 `TrimAudioDuration` 之类裁到与视频等长。
- **音色来自音频**，所以"同性别声线分不开"的问题在这条路上不存在——你给什么音色就是什么音色。
- 台词文本要与音频一致，否则口型对不上词。

适用：客户给了配音、歌曲、或你要用 TTS 生成好的音频。

---

## 3. B：90 秒长口播（J13 InfiniteTalk）

结构：**20 段 `WanInfiniteTalkToVideo` 串联**，每段用 `ImageFromBatch` 抽上一段末帧当下一段首帧，`ImageBatch` 合并，最后 `VHS_VideoCombine` 合成。

- 底模 `wan2.1_i2v_720p` + **lightx2v 4step** LoRA（快）。
- 文本编码 `umt5_xxl`，视觉 `clip_vision_h`。
- **每段都要重新喂台词文本**（40 个 CLIPTextEncode）。
- 这就是"无限长"的实现：分段 + 末帧续接 + 固定音色。

对我们的意义：**如果一集口播超过 15 秒又必须对嘴，这是唯一能一次跑完的路线**（否则要手工切很多段）。

代价：节点多、耗时长、段间仍可能轻微跳变；**必须逐段验收**。

---

## 4. C：声音克隆（N2 FishAudio S2 pro）

```text
LoadAudio(参考音) → Apply Whisper(转写) → FishS2VoiceCloneTTS(文本 + 参考音色) → SaveAudio
```

- 先 `Apply Whisper` 把参考音频转成文本（有的实现需要文本对齐）。
- `FishS2VoiceCloneTTS` 用参考音色 + 目标文本合成。
- 输出是**纯音频**，再走 A 或直接当旁白。

用途：跨集同音色、给外星人这种"非人声"做统一音色、旁白。

注意：**克隆的是音色，不是情绪**。情绪仍要在文本/提示里给（或换参考音频的情绪版本）。

---

## 5. 选型决策

```text
有确定的音频（配音/歌/客户录音）？
├─ 是 → A（H3 图+音对口型）；超过 15s → B（InfiniteTalk 分段）
└─ 否 → 要跨集同音色？
        ├─ 是 → C 克隆出音频 → A 对口型
        └─ 否 → 原生口播（native-dialogue.md），情绪最好
```

---

## 6. 验收

- [ ] 口型与音频**逐句**对齐（抽 3 个时间点看嘴型开合）
- [ ] 音色与参考一致（人耳）
- [ ] 段间续接处没有"倒回/跳帧"（用 `seam.py` 量 PSNR）
- [ ] 音频裁到与视频等长，没有尾部截断
- [ ] 长口播逐段验收，不要只看首尾

---

## 7. 与现有产线的接法

- 漫剧：**静帧 + 克隆配音 + A 对口型**，比全动态便宜，比纯 TTS 贴脸。
- 科普：外星人用 C 固定音色，地球人用另一个音色；关键情绪段仍用原生口播。
- 交付：`finish.py` 合片 + 响度；`qa.py` 查削波。
