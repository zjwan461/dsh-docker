# 口播（原生对白）情绪与节奏

**结论：情绪戏用 H3 原生口播，不要 TTS 后期配音。** 用户实测 TTS 后期“无法和剧情情绪保持节奏”。原生口播是**音画同一次生成**，情绪、口型、呼吸、停顿一体；TTS 是独立音轨，贴上去必然和表演脱节。TTS 只留给：旁白、数字/术语播报、跨集音色一致性要求极高且情绪平的段落。

来源：[T8 原生情绪实验](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/main/docs/NATIVE_VOICE_EMOTION_EXP.md)、[微表情提示词指南](https://www.seedance.tv/blog/minimax-h3-microexpression-prompts)、[nextsycl H3 指南](https://github.com/maxfridbe/nextsycl/blob/af9ec4ad02a4c273c2b0ecf3dd9a64ed39525a73/model-cards/guides/minimax-h3.md)、官方 base guide。

---

## 1. 情绪要写成“直接、强烈的表演短语”，放在 `<d>` 外

- **克制/温柔/“不要喊叫”这类词 → 声音平。** 要怒就写直接的强情绪：`unrestrained FURY` / `explosively furious shouted voice`，不要写 restrained / gentle / no shouting。
- 实测：同首帧/参考/seed，只把表演短语从平静改成“直接狂怒”，开头声能 RMS 升到 **1.64 倍**。表情有怒意但声音听不出区别时，**改表演短语，不是改画面**。
- **弱情绪（轻喜悦等）区分不明显** → 用更直接的情绪词或放大强度，否则听不出。
- 声音要 **power / projection**，不要写 depth（pitch 后期改不了）。
- 身份/音色/语速/情绪都写在 `<d>` **外**；`<d>` 内只放 `[Chinese] 逐字台词`。

```text
<Subject 1> (S1), on-screen, in an explosively furious shouted voice, jaw clenched, says: <d>[Chinese] 你终于回来了。</d>
```

## 2. 情绪 = 可观察的时间节拍（微表情四段），不是形容词

写“她感到紧张”没用；写**看得见的变化序列**：

1. **Baseline**：composed face, steady gaze, relaxed shoulders.
2. **Trigger**：hears the offscreen answer after a short pause.
3. **Response**：inner eyebrows lift slightly, lips press together <1s, shallow breath.
4. **Settle**：exhales, returns to deliberate calm, concern still in gaze.

- **一个主导变化**，呼吸/姿态/视线辅助；不要给每个五官单独下命令（互相矛盾）。
- 空白脸 = 只写 mood 不写 change → 加 trigger + 2 个可见 cues。
- 机器人脸 = 固定凝视 + 机械眨眼 → 加自然呼吸、小幅视线、不对称。
- 过戏 = 重复 intensifier（extremely terrified, shocked and devastated）→ 换成一个克制过渡 + 边界（no grimace, no wide eyes）。

## 2.5 三层分工：音色 / Business（身体）/ Delivery（这一句怎么演）

**"演技僵硬"多半不是情绪词不够，而是把演技全塞进了台词行。** 三层各管一段：

| 层 | 管什么 | 写在哪 |
|---|---|---|
| ① **音色 desc** | 这个人**平时**怎么说话 | 音色描述（克隆/口播音色设定） |
| ② **Business 行** | 说这句时**身体在做什么** | `<d>` 外，分 `before the line` / `after the line` |
| ③ **Delivery 行** | **这一句**怎么演（气口/音量/音高/瑕疵） | `<d>` 外 |

```text
音色 desc：女声 26 岁。音区中、声音清；咬字干脆、字字落地；说话慢而稳，句尾不飘。
Business before the line: her thumb finds the ring and turns it a quarter turn, once, slowly.
Business after the line: her hand lowers half an inch and stops; she keeps looking at him.
Delivery: she does not raise her voice. Each word placed separately, the last word landing flat
  like a full stop. Jaw tight, eyes on his face without blinking, breath already gone quiet.
<Subject 1> says (voice reference <Audio 1>): <d>[Chinese] 这婚不结了。</d>
```

**Delivery 只写可观测的物理量**，不写形容词：

- 音量走向：`keeps it low on purpose` / `pulls the volume down mid-sentence`
- 停顿气口：`starts on an exhale` / `waits half a beat`
- 音高走向：`the last three words go down in pitch instead of up — not triumphant, tired`
- 破音瑕疵：`her voice cracks upward at the top of the second word`
- 眼神身体：`does not look at her hand, looks at her face` / `chin juts forward`

> ⛔ **别写"她很生气/很伤心"**——模型不会演形容词，只会演**动作与气息**。
> 实测对比（同台词同镜头）：旧版"眼睛垂下、嘴闭着、手自然垂着"→ 像拍照片；
> 新版"盯着对方、嘴正在说、戒指手推向镜头、下巴抬起脖颈绷着"→ 像在吵。

**为什么不能把表演写进台词行**：`<d>` 里只能有 `[Chinese] 逐字台词`（多一个中文字都会被念出来，见 `h3-tuning.md` §1.3.1）。所以表演信息要**搬到 `<d>` 外面**，不是删掉。

## 3. 台词时间窗：短句 + 短窗 + 明确无声尾动作（防“尾部乱说”）

- **短台词配过长时间窗、说完没有后续动作 → 模型继续即兴加话**（尾部乱说/额外英文）。这是实测反复出现的根因。
- 修法：台词只占短窗（如 0–2s），**剩余时间给明确的闭口无声动作**（眨眼、无声呼吸、点头、挥手、放手转头微笑）。
- **台词只写一次**（Local/对应镜头），**不要放 Global**（会重复朗读）。
- 字数定语速：模型约 **57% 的片长在说话**；中文 ~4.1 字/秒。短台词别给长窗。

```text
[Shot 1] 0–2s: (S1) says once: <d>[Chinese] 你终于回来了。</d>
2–4s: lips closed, blinks once, silent breath, a small nod. No further speech.
```

## 4. 对白与反应按播放顺序写

- 听者在**对方台词期间**反应（over-the-shoulder close-up），关键词后眨一次眼，半拍后再短回复；保口型。
- 不要“说话+冲突运镜”同时；情绪峰值时相机够近（close-up / medium close-up），远景读不到面部情绪。

## 5. 参考音频 = 完整 audio-latent 参考，不只是声纹

- `ref_audios` 把参考录音的**完整音频 latent** 当条件，**会携带内容**——可能泄漏参考录音自己的词（实测尾部出现参考里的英文）。
- 锁音色用 `ref_audio_0` + `<Audio 1>` 绑定，但**情绪仍靠表演短语**，参考不保证情绪/逐字。
- 连接参考视频声音后 Audio 编号会变，按 media_map 重写，别硬写 Audio1。

## 6. 验收：人耳/人眼，ASR 不算

- 正常速度**带声**看情绪、**静音**看时序、**纯听**看声音情绪；三者都过才算。
- ASR 只能粗筛“像不像中文”，**不能**判情绪/音色/口型/接缝。
- 多镜记录**情绪 handoff**（“call 前 guarded / 名字后 relief / 结束 calm but uncertain”），连同参考/prompt/seed/验收note 存档，返修只重跑失败段。

## 7. 分工表

| 内容 | 用 |
|---|---|
| 情绪对白、吵架、哭戏、爆发 | **原生口播**（强表演短语+短窗+无声尾动作） |
| 旁白、画外解说 | 原生 voiceover 或 TTS |
| 数字/术语/出处播报 | TTS（准确）或原生慢速 |
| 跨集音色严格一致、情绪平 | TTS / 参考音频 / FishAudio 克隆 |
| 旁白/可控音色、**不出视频** | H3 T8 Speech Studio（U33，独立 speech FLAC；`audio-assets.md`） |

## 8. 模板（表演短语 + 台词）

```text
愤怒: in an unrestrained, explosively furious shouted voice, brows slammed down, teeth clenched
克制怒: in a low, tightly controlled voice, jaw locked, each word measured
喜悦: in a bright, openly delighted voice, eyes crinkling, a real laugh breaking through
悲伤: in a quiet, cracking voice, moist eyes, lips pressing between words
倾听: (listener) holds eye contact, blinks once after the key word, one mouth corner lifts while eyes stay sad
```

---

## 9. 有台词的镜头必须 8 步（4 步 turbo 会听不清）

同一首帧、同一 seed、只换步数（`fl2va` + turbo LoRA，768×1344 / 107 帧）：

| 配置 | 耗时 | whisper small 转写 |
|---|---|---|
| 4 步 `minimax_h3_fl2v_turbo_4step_v1.2_768p` | 125 s | `妈呀 我上去啦`（原句「妈，我升职了」） |
| 8 步 `minimax_h3_fl2v_turbo_8step_v1.0_768p` | 210 s | `妈 我升职了` |

- 4 步像"含着一口水说话"：字头糊、韵母拖，短视频里观众会当成配音事故。
- 规则：**说话镜 8 步，不说话镜（环境声/画外音/纯动作）4 步**。5 镜短片按此分档 ≈ 210 + 4×125 s。
- 验收别靠耳朵：`whisper` 转写该镜音轨，字错就加步数。

> **但 8 步不是终点**：8 步仍是 turbo 档，turbo 会劣化音频（伤气声/长音、拉平口音、硬切糊成叠化）。**对白成片要么 20 步无 turbo，要么 turbo 打样后同一 seed 无 turbo 重跑**。8 步解决的是"字头糊"，解决不了"音色/气息变薄"。详见 `h3-tuning.md` §4。
