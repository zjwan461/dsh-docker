---
name: dsh-video-narration
description: 给已经剪好的片子做旁白/配音。**TTS 默认走非流式 HTTP**（`POST /api/v1/services/audio/tts/SpeechSynthesizer`，一次请求回音频 URL），逐句合成→实测时长→逐句 atempo 卡镜长→逐镜响度对齐→闪避混音→两遍 loudnorm 质检。含实测踩坑：**`[cosyvoice:] Engine error [411]` 是音色 ID 与 model 不配对，不是接口写错**（3.0-tts-plus 只有 longanlufeng/longanlingxin，不带版本后缀）、workspace 前缀不同会 401、WebSocket 走代理要 `proxy_type="http"`、**amix 默认 normalize=1 会把旁白压掉 23dB**、atempo 只能 1.0–1.30 且不要慢放、旁白与画内口播必须错开并写成校验脚本、语速只能实测不能按字数估、环境底音轨必须与画面等长、短音频 loudnorm 失效、volume 是线性倍数、alimiter 语义、ASR 不能当判据。需要给视频配旁白、混音轨、修响度或判断"要不要配字幕"时加载。
whenToUse: 需要给视频加旁白/解说/配音时；成片响度忽大忽小时；旁白与画面台词打架时；需要把 TTS 生成的语音卡到剪辑点上时；要判断某条合成语音"念得对不对"时。
metadata:
  version: 1
  requires: [ffmpeg, python3]
---

# 旁白与配音制作

一套已经跑通、并且**踩过坑**的流程。核心结论先给：

> **时长可以量，响度可以算，但"念得对不对、好不好听"只能靠人耳。**
> 任何声称能自动判断语音正确性的步骤（尤其 ASR）都不可信——见 §6。

## 1. 先量三件事，别急着生成

| 要量的 | 怎么量 | 为什么 |
|---|---|---|
| 每句旁白的**可用窗口** | 从剪辑点算：入点、下一句台词起点、切点 | 旁白撞上画面台词是本流程最常见的返工 |
| TTS 的**真实时长** | 每条都 `ffprobe` 量 | 同一句话两次生成可差 40%（实测 2.10s / 5.60s 同文本） |
| 成片**逐镜响度** | 见 §4 | 落差常有 20dB 以上，旁白会一边贴脸一边真空 |

## 2. TTS 选路：默认走非流式 HTTP

三条路都验证过，**先别折腾协议，直接走第一条**：

| 路 | 什么时候用 | 代价 |
|---|---|---|
| **非流式 HTTP**（默认） | 99% 的情况：整片几十句旁白，离线合成 | 一次 POST 一句，无并发压力 |
| 流式 WebSocket | 要边生成边播、要打断 | 走代理要改 websocket-client |
| qwen3-tts-flash 原生 | 手上有百炼 key、想用老音色 | 要显式 `language_type` |

**一句一条**，不要整段一次合成：后面要按镜头长度逐句变速、逐句对齐响度、
逐句算字幕时长，整段音频这些全做不了。

## 2.1 首选：非流式 HTTP（本轮跑通的那条）

```
POST https://<workspace>.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
Authorization: Bearer <key>

{"model": "qwen-audio-3.0-tts-plus",
 "input": {"text": "大唐开国，名将如云。",
           "voice": "longanlufeng",
           "format": "wav",
           "sample_rate": 24000}}
```

返回 `output.audio.url`（带签名的 OSS 链接），**再 GET 一次**才是音频字节。
实测 24k / 单声道 / 5 秒中文 ≈ 250KB，延迟 2~4 秒。

### 音色必须和 model 成对

| model | 可用系统音色 |
|---|---|
| `qwen-audio-3.0-tts-plus` | `longanlufeng`（男）、`longanlingxin`（女）—— **不带版本后缀** |
| `qwen-audio-3.1-tts-flash` | `longanhuan_v3.1`、`anmingyuan_v3.1`、`huozhuoshi_v3.1` …（带 `_v3.1`） |

跨用必错。真实案例：拿 `longanhuan_v3.1` 喂给 3.0-plus，返回 411；
把 `longanlufeng` 喂给 3.1-flash，同样 411。

> **`[cosyvoice:]Engine error [411]: TTS speak operation failed` = 音色 ID 不对，不是接口写错。**
> 官方音色列表原话：*"An unsupported voice returns an `InvalidParameter` error, such as
> `[cosyvoice:] Engine error [411]: TTS speak operation failed`."*
> 这条把人误导了很久——四种请求形状、三种协议、十几种音色名全试一遍，报错一模一样。
> 查错顺序：**先查音色表，再查代码。**

### 错误码对照（照着这一列查，别猜）

| 报错 | 真正的原因 |
|---|---|
| `Model not exist` | model 名不在这个工作区。**注意：路由是对的**，只是没这个模型 |
| `url error, please check url` | 路径/端点不匹配，或这个网关没接这个服务 |
| `Request voice is invalid!` | voice 传了空串 |
| `[cosyvoice:] Engine error [411]` | **音色 ID 与 model 不配对**（最常见） |
| `InvalidApiKey` | key 和主机不属于同一个工作区（A 的 key 打 B 的主机必然 401） |

### `<workspace>` 前缀是坑

控制台给的常常是 `token-plan.cn-beijing.maas.aliyuncs.com`，
而官方示例里写的是 `llm-<id>.cn-beijing.maas.aliyuncs.com`——**这是两个不同的工作区**，
拿 A 的 key 打 B 的主机是 401，跟你 key 对不对无关。

## 2.2 流式 WebSocket（要边生成边播时才用）

`wss://<host>/api-ws/v1/inference` + `dashscope.audio.tts_v2.SpeechSynthesizer(model, voice)`。
公司代理下**两处都要改**，少一处就是 5 秒超时：

```python
_orig = websocket.WebSocketApp.run_forever
def rf(self, *a, **kw):                     # websocket-client 不读 env 里的 http(s)_proxy
    kw.setdefault("http_proxy_host", HOST)
    kw.setdefault("http_proxy_port", PORT)
    kw.setdefault("http_proxy_timeout", 30)
    kw.setdefault("proxy_type", "http")     # 不加这句报 "Only http, socks4, socks5 …"
    return _orig(self, *a, **kw)
websocket.WebSocketApp.run_forever = rf
```

失败时真实信息在 `synth.last_response['header']['error_message']`，**不在异常里**——
异常只会给你 `RequestFailure()` 或一个 5 秒超时。

## 2.3 qwen3-tts-flash（有百炼 key 时）

```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
{"model":"qwen3-tts-flash","input":{"text":"…","voice":"Ethan"},
 "parameters":{"format":"wav","language_type":"Chinese"}}
```

- **`language_type: "Chinese"` 必须显式给。** 不给时冷僻句/文言会被判成外语：
  实测"守将羊侃的儿子被押到城下。"整句念成外语，补上后正常。
- 兼容端点别用：`compatible-mode/v1/chat/completions` 对 `voice` 摆放挑剔，
  `compatible-mode/v1/audio/speech` 直接 404。
- 音色：`Ethan`（男，稳）、`Cherry`（女）、`Rocky`（最慢最沉，最像纪录片）。
  有些名字是同一音色（`Ethan` 与 `Marcus` 输出同长同内容）。

## 2.4 脚本

`scripts/tts.py` 把上面三条都包了，默认走非流式 HTTP：

```bash
export TTS_BASE=https://<workspace>.cn-beijing.maas.aliyuncs.com
export TTS_API_KEY=sk-…

python3 tts.py --probe                       # 先确认哪个音色能出声
python3 tts.py --text "…" --out vo/S01.wav
python3 tts.py --batch shots.json --outdir vo   # 批 + 输出 durations.json（含建议 tempo）
```

`--probe` 这一步别省：**音色不通就换音色，不要改代码。**

## 2.5 语速只能实测，不能按字数估

同一个 TTS 端点，实测语速在 **2.4–5.2 字/秒**之间浮动（句长、标点、生僻字都影响）。
按"字数 ÷ 常数"排时间线，几镜之后就会累积出半秒以上的漂移。

做法：**生成 → 用 `ffprobe` 量每条 wav → 按实测值排**。估算值只能用来选镜长下限。

## 2.6 旁白文本不要用正则改多行字符串

镜头表里的旁白常写成相邻字符串字面量拼接：

```python
vo="第一句。"
   "第二句。",
```

用正则只替换第一个引号段，会把**第二句整段丢掉**（本轮两次踩到：B1 的"皇帝萧衍，八十四岁……"
丢失导致下文的"他信佛"没有指代；F1 的旁白被改成两句重复）。

**改这类字段就整条重写**，改完再**逐镜打印全文**核对一遍。

## 2.7 逐句变速卡进镜头（比改文案便宜）

镜头长度是固定的（H3 的帧数网格），旁白长度是浮动的，两者必然对不上。
**不要为了凑时长去改文案**，先算每一句需要多少变速：

    slot   = frames / 24
    target = slot - 0.30                      # 留 0.2~0.3s 气息
    tempo  = vo_dur / target                  # clamp 到 [1.0, 1.30]

- **上限 1.30**：超过就说明这句文案对不上这个镜长，改文案或换更长的镜（H3 帧数 124→141→158）。
- **下限 1.0，不要慢放**：tempo < 1 会把语音拉得发黏。宁可让它自然念完、后面留静默——
  黑屏/静场镜头尤其需要那点静默。
- `atempo` 保音高；实测本项目 16 句落在 1.02–1.23，人耳无感。

> 顺带：中文 TTS 实测 **4.2–5.4 字/秒**，同一句两次生成能差 40%。
> 所以"多少字 = 多少秒"这个换算只可用于估镜长下限，排时间线必须用 ffprobe 实测值。

## 2.8 `amix` 默认会把旁白压掉 23dB

拼旁白轨（多路 adelay + amix）时，**`amix` 默认 `normalize=1`，按输入路数做除法**：
14 路 → −22.9dB。症状是旁白轨测出来 −43 LUFS，而每一句单独测都是 −16。

    [a0][a1]…amix=inputs=14:duration=longest:dropout_transition=0:normalize=0[out]

同理，旁白与底音的最终混音也要 `normalize=0`，否则人声再被砍一半。
对齐后的期望值：旁白 −16 LUFS、整条轨 RMS 约 −20dB；如果测出来 −40 左右，先查这一条。

## 3. 逐句卡点

- 窗口算不出来就**跨剪辑点**：旁白从上一镜的尾巴起、压过切点、在画面台词开口前收。
  这是纪录片常规手法，本轮用它救过一句被 TTS 念慢的旁白。
- `atempo` 建议 ≤1.3；超过就说明该改文案、挪窗口或加长镜头。
- 用 **信号** 核对放置（不用 ASR）：量旁白轨在预期区间的电平，以及"台词段应当安静"处是否为静音。

## 3.5 旁白与画内口播：必须错开，而且要写成脚本校验

这是本类片子**用户最先听出来的问题**："上一个场景的旁白还没念完，下一个镜头的口播已经开始了。"
根因是两把尺子：口播的时间戳是**估**的（按字数÷语速），旁白是**实测**的，必然对不上。
实测一轮里 **14 处重叠、最大 2.9 秒**。

**规则：每个镜里，旁白先说，口播后进。** 不要指望"混音时压低口播"——那会让画内人物张嘴没声，
等于白扔了口型同步。

落地两步：

1. **排时间**：把口播的入场时间推到"旁白实测时长 + 余量"之后；镜长不够就**加长镜头**，
   而不是压旁白或挤口播。加长后记得重排整条时间线。
2. **写校验**（不要靠肉眼听）：读旁白 wav 的实测时长 + 口播的时间戳，逐句算交集，
   有交集且 >0.05s 就报错退出。这个脚本要进 CI 式的交付流程，每轮都跑。

```
旁白占 [LEAD, LEAD+实测时长]       # LEAD 通常 0.25s 起拍
口播占 [at_i, at_i + 字数/3.6]     # 语速取保守值
交集 > 0.05s → 冲突
```

⚠️ **不要用 `At` 时间戳去排字幕**：H3 对 `At` 的响应偏差实测 0.6–1.5 秒。
生成完必须**实测**口播落在哪，再对齐字幕与旁白的进出点。

## 4. 逐镜响度对齐（旁白前的必做项）

先量再算，**别拍脑袋**：量 `bed`（未做全片响度的合片）每一镜的 `ebur128` 集成响度，
再按目标算增益。本轮实测某片每镜落差 **27dB**（最轻的镜头 −45 LUFS），
旁白压上去必然一边贴脸一边真空；对齐后底落差 6dB、成片 3.3dB。

两个必踩的 ffmpeg 语义坑：

- **`volume=` 是线性倍数，不是 dB。** 写 `volume=11.2` 等于 +21dB。要 dB 就写 `volume=11.2dB`。
  时间窗版：`volume=volume=6.5dB:enable='between(t,28.459,38.584)'`。
- **`alimiter` 的 `limit` 也是线性值**（−1.5dBFS → `0.84`），而且 **默认 `level=true` 会把整体电平顶上去**
  （实测集成响度被推到 −14.6、真峰值 0.1dBFS）。正确写法：
  `alimiter=limit=0.76:level=disabled:attack=5:release=50`。

## 5. 混音与响度

- **逐条旁白对齐**：不要对 2–3 秒的短句用 `loudnorm` 单遍——实测把一条从 −25.2 反而压到 −32.8
  （压小 7.6dB，在片子里明显偏轻）。**先 `ebur128` 量、再加固定 `volume` 增益**，
  这样 9 条能全部落在 −16.0～−16.1 LUFS。
- **全片响度用两遍 `loudnorm` + `linear=true`**：单遍是动态处理，会把刚对齐好的逐镜关系重新揉回去。
  流程：预混 → `print_format=json` 量 → 带 `measured_*` 线性施加。
- **闪避用 `sidechaincompress`**（旁白作 sidechain），不要硬切环境声。
  经验值：环境底比人声低约 4dB，闪避再压 6dB。
- **AAC 解码会过冲**：限幅留 1dB 余量，别用正好 −1.5 的 limit，否则量出来真峰值是 −1.1。
  交付目标：集成响度 −16 LUFS、真峰值 ≤ −1.5dBFS。

## 5.5 混音前先确认"底"的长度和画面对得上

环境底（各镜生成的原始音轨拼起来）长度**必须精确等于** Σ(帧数/24)。

本项目栽过一次：两张黑场卡的音频比画面短（`anullsrc` 配 `-frames:v`，视频一到帧数上限
整个输出就终止，音频被截短），拼出来的底只有 361.5s 而画面 365.9s。
后果不是"少一段声音"，而是**整条音轨从那里开始整体前移**，口播全部跑到画面前面，
而旁白（另加的轨）不受影响——所以从成品上听像是"混音把口播弄错了"。

诊断顺序（别跳）：

1. 量底音轨总时长 vs 视频总时长，差 >0.05s 就先修这个；
2. 再逐段量各镜音频时长 vs 帧数/24，找出短的那几段；
3. 最后才怀疑混音参数。

## 6. 什么不能自动化（最重要的一条）

- **ASR 不能作为"念得对不对"的判据。** 实测它把清晰、慢速的合成音听成日语，另一条听成阿姆哈拉语，
  把"守将羊侃"猜成"首相李克强"。它唯一可靠的用途是"这段像不像中文"这类**粗筛**。
- 反过来：**用户说"听不懂"时，先信用户**，并且要往"模型判错语种""TTS 选到坏样本""播放入点错了"三个方向查，
  而不是怀疑自己的文本。
- 音色、语速、清晰度**必须由人耳定稿**；工具负责给出候选与量化数据（时长、电平、是否越界）。

## 7. 字幕取舍

旁白一旦有人声，**可读版里那层"旁白字幕"应当去掉**（保留章节卡、引文、数字卡）。
引文（角色台词）字幕建议保留——尤其当画面里的台词是模型生成的、发音可能与字幕用字不同音时。

## 8. 附带脚本（参考实现）

`scripts/` 下是本流程的可运行实现，按需取用或移植：

| 脚本 | 作用 |
|---|---|
| `tts.py` | 逐句 TTS。**默认非流式 HTTP**（`--route http`），也支持 `--route dashscope`（qwen3-tts-flash）。`--probe` 逐个试音色，`--batch` 批量出 wav + `durations.json`（含建议 `tempo`）。 |
| `vad.py` | 纯 Python 定位"哪一秒在说话"（给旁白找空隙） |
| `asr.py` | 粗筛用转写（**不可作判据**，文件头已标注） |
| `mix_vo.py` | 逐镜响度对齐 + 闪避 + 两遍 loudnorm 的完整混音（含踩坑注释） |

> `mix_vo.py` 是按某个具体项目的时间线写的（读 `finish.py` 的镜头表）。
> 移植时保留其中的三个关键做法即可：实测增益、`volume=…dB`、两遍 linear loudnorm + 限幅。
