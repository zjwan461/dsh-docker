/**
 * The MiniMax H3 companion skill.
 *
 * Registered through `ctx.skills.register` as a runtime skill, so the model
 * loads it when a video task appears instead of carrying it in every prompt.
 * Its job is to encode the things that are expensive to rediscover: how H3
 * wants prompts written, how long a clip really is, which mode keeps a
 * character consistent, and where the pipeline usually breaks.
 */
export const H3_SKILL = {
    name: 'dsh-minimax-h3-video',
    source: 'runtime',
    description: 'Minimax H3 视频生产：文生视频（t2v）/图生视频（i2v）/参考生视频（r2v）的选择与提示词写法、分镜与跨镜头一致性、时长与合法帧数、Turbo LoRA 取舍、模型清单检查、以及用 h3_post（FFmpeg）做剪辑/合片/字幕/响度/分镜缩略图的配方。需要生成或后期 MiniMax H3 视频时加载。',
    whenToUse: '用户要求生成视频（文生视频、图生视频、参考生视频、AI 短片、分镜、镜头）时；需要检查 MiniMax H3 模型是否就位、解释为什么生成失败或很慢时；需要把多段生成结果剪成一条片子、加旁白/字幕/水印/封面、或做分镜缩略图时；或调用 h3_generate / h3_post / h3_project / h3_runs / h3_assets 之前。',
    content: `# MiniMax H3 视频生产

本插件只做一件事：用 ComfyUI 上的 MiniMax H3 生成视频，再用 FFmpeg 把它做成能交付的片子。工具分工：

| 工具 | 用途 |
|---|---|
| \`h3_generate\` | 生成视频（t2v / i2v / r2v），默认 \`mode_run: "async"\` |
| \`h3_runs\` | 历史记录、ComfyUI 队列、**模型清单**、中断 |
| \`h3_assets\` | 把本地图/音频/字幕推进 ComfyUI input 或插件 uploads；查 FFmpeg |
| \`h3_project\` | 分镜板：一个项目的镜头清单（prompt/参考图/时长…） |
| \`h3_post\` | FFmpeg 后期：剪辑、合片、配音、字幕、改画幅、缩略图 |

## 先做三件事（顺序别乱）

1. **确认服务器连通且装了 H3**：\`h3_assets action: "diagnose"\` 一次给出可达性、服务端最终用的路由前缀、
   各端点可用性、**那台服务器上有没有 H3 节点**，以及本机 FFmpeg。指向远程（租卡 / 局域网 / 隧道）时必跑。
2. **查模型清单**：\`h3_runs action: "inventory"\`。它会列出每种模式需要的 unet / clip / vae / lora 文件在服务器上是否存在，缺哪个会直接点名。**第一次在新机器上生成前必做**——不然会在采样器深处报一个难懂的错。
3. **确认画幅与时长**：默认 16:9、0.4 MP、5 秒。H3 的原生画质预算就在 0.4 MP 附近，拉到 1 MP 以上显存和时间都涨得很快。

### 远程 ComfyUI（租卡、局域网另一台机器）

传输层就是 ComfyUI 原生 HTTP API，所以**只改 baseUrl**，\`comfyuiDirs\` 留空。三点要注意：

- **ComfyUI 必须监听 0.0.0.0**（默认只绑 127.0.0.1，外部连不上）；租卡还要把端口映射出来，或走 SSH 隧道。
- **FFmpeg 跑在插件这台机器上，不在租的卡上**。后期前片源会下载到本地缓存——这是设计如此，不是 bug。
- **素材列表来自服务器自己的 \`/history\`**（远程没有本地目录可扫）。所以「服务器 input 里但从未被任何 prompt 用过的文件」不会出现在列表里；要用它就得先用一次，或者让用户用 \`h3_assets action: "upload"\` 上传一遍。
- 反代要认证时用 \`authHeader\` / \`authScheme\` 调（\`x-api-key\` 就把 scheme 留空）。自签名证书目前不支持，改走隧道或明文 HTTP。

## 三种模式怎么选

- **t2v（文生视频）**——只有提示词。适合风景、氛围、抽象转场、没有固定主角的镜头。**人物跨镜头一致性最差**。
- **i2v（图生视频）**——一张首帧图 + 提示词。**一致性最好**：先出一张满意的静帧（可以用任何文生图流程），再用它当首帧让画面动起来。人物、产品、场景都走这条。
- **r2v（参考生视频）**——1~9 张参考图 + 提示词，提示词里用 \`<Picture 1>\`、\`<Picture 2>\` 指代。这是**跨镜头锁角色/锁画风的正确工具**：同一组角色参考图，每个镜头换 prompt，出来的还是同一个人。

**做多镜头片子的推荐管线**：先用文生图定角色三视图/定妆图 → \`h3_assets action: "upload"\` 推进 ComfyUI input → 每个镜头用 r2v 带上同一组参考图 → \`h3_post op: "concat"\` 合片 → 字幕/响度/封面。

## 提示词写法（H3 吃这一套）

H3 是「导演式」提示词模型，结构化比形容词堆砌有效得多：

\`\`\`
<风格/介质一句话>：Realistic live-action cinematic look, anamorphic lens, film grain…
<场景概述>：一句话说清谁在哪干什么。
<分镜>：每条镜头一段，标时间和机位——
[0s-1.5s] Shot 1: high side angle: …
[1.5s-3s]  Shot 2: …
<镜头语言>：cuts clean and hard, no dissolves, slight frame jitter on impact…
<声音>：Audio: wind, footsteps, low score underneath, accent hit on each leap…
<排除项>：No text, subtitles, logos or watermarks of any kind, no cartoon rendering…
\`\`\`

要点：
- **一条 5 秒的片子也能装 3~4 个镜头**。想让一条生成里出现切换，就写 \`CUT 1: … CUT 2: …\`，并明确 \`cuts clean and hard\`。
- **音频必须写进提示词**：H3 同时生成音轨（视频 VAE + 音频 VAE），\`Audio: …\` 那一段决定它出什么声。不写就是随机环境声。
- **r2v 里用 \`<Picture N>\`**，编号顺序和 \`refs\` 数组一致。官方模板只接了参考图，插件的 \`refs\` 也只接图。
  节点若另外声明了参考音频/视频的输入组（\`ref_audios\` / \`ref_videos\` 之类，能在服务器的 \`/object_info\` 里看到），
  插件目前**不会**替你填 —— 那类参考需要在 ComfyUI 画布上自己补。
- **结尾一定写排除项**：H3 很容易自己加字幕条、台标、水印和 CG 塑料感。
- **中文提示词可用**，但风格/镜头术语用英文（anamorphic、dolly-in、rack focus）更稳。

## 时长与帧数（最容易踩的坑）

H3 只接受 **≡ 5 (mod 17)** 的帧数（5、22、39、56、…、124、158、243、362、481）。**不是 4n+1**——本文早先写错了；下表的数才是对的（每个都能被 17k+5 命中）。插件按官方规则把秒数**向上**吸附到最近的合法值，所以**实际时长总会比你填的略长**：

| 你填 | 帧数 | 实际时长 |
|---|---|---|
| 5 s | 124 | ≈5.17 s |
| 6 s | 158 | ≈6.58 s |
| 10 s | 243 | ≈10.13 s |
| 15 s | 362 | ≈15.08 s |
| 20 s | 481 | ≈20.04 s |

要用精确帧数（卡音乐点）就直接传 \`frames\`，它会吸附到最近的合法值。要卡时长就按上表的实际值排时间线。

## 对白与官方提示词格式（实测更正）

**H3 能念台词，但必须用保留 token 包起来。**

- 对白写成 <d>[原始语言] 台词原文</d>，例：<d>[中文] 率土之内，莫非己有。</d>。
  节点说明里 <d> / </d> 是 tokenizer 的**保留单 token**；官方 tooltip：
  *"Without that the model sings nothing and the mouth moves to silence."*
  不写标签的典型症状是**嘴在动、没有声音**（同静帧同 seed 实测：写了标签 RMS 0.0170 / 过零率 0.1333，不写 0.0033 / 0.0222）。
- **I2VA / T2VA / FL2VA 用官方三字段格式**（MMH3TaskSystemPrompt；只有 Ref2VA 用六段式）：

    integrated_multimodal_description: <风格一句话 + 镜头 + (S1) <d>[中文] 台词</d>>
    overall_soundscape: <场景里真实存在的声音；不要声称有配乐>
    non_diegetic_music: none

- 标签规则：镜头写 [Shot 1]（**不带时间戳**）；说话人写 (S1)(S2)，按实际发声顺序，同一人跨镜头复用编号；
  <Subject N> 可复用主体；<Picture N> 只在参考图当首帧/关键帧时才单列。
- **别指望模型自己判语种**：冷僻句/文言会被判成外语（TTS 侧实测：不指定语种时“守将羊坎的儿子被押到城下。”整句被念成外语；旁白制作见 dsh-video-narration）。

## Turbo（Lightning LoRA）取舍

\`turbo: true\` 把步数从 20 降到 8（r2v 降到 4），**快 2~3 倍**，代价是细节和稳定性略降。

- 打样/试构图/试提示词 → **开 turbo**，一次能多跑几条。
- 定稿 → 关掉，跑满步数。
- \`seed\` 固定时，开 turbo 和关 turbo 是**两条不同的轨迹**，不能指望结果只是"更糊的同一版"。

## 生成是异步的（默认）

视频要几分钟。\`h3_generate\` 默认 \`mode_run: "async"\`：立刻返回 \`jobId\` + \`runId\`，**不要阻塞等待**，继续安排别的镜头；任务结束时本会话会收到通知，再用 \`job_output\` 收结果。也可以先用 \`h3_runs action: "list"\` 看状态。

只有短测试或你确实要立刻拿到结果时才用 \`mode_run: "sync"\`。

## 拿到结果之后：\`h3_post\`

输入用 \`source\` 指定：\`"run:<runId>:0"\`（刚生成的）、\`"render:<文件名>"\`（上一轮后期产物）、\`"upload:<文件名>"\`（用 \`h3_assets action: "attach"\` 挂进来的本地文件）。

常用配方：

- **合片**：\`op: "concat"\`, \`source\` 给第一段，其余放 \`extras\`。同源同参数用默认 \`mode: "copy"\`（秒级、无损）；尺寸/帧率不齐改 \`mode: "normalize"\`。
- **加旁白/BGM**：先 \`h3_assets action: "attach"\` 把音频挂进来，再 \`op: "merge_audio"\`, \`extras: ["upload:vo.mp3"]\`，\`options: { mode: "mix", volume: 1, original_volume: 0.4 }\`。
- **字幕**：\`op: "subtitle"\`, \`extras: ["upload:subs.srt"]\`。硬字幕兼容性最好；要可开关用 \`options: { mode: "soft" }\`。
- **响度**：\`op: "loudnorm"\`, \`options: { i: -16 }\`——成片忽大忽小几乎都是漏了这一步。
- **竖屏交付**：\`op: "ratio"\`, \`options: { aspect: "9:16", mode: "crop" }\`（\`pad\` 则保留全画面加边）。
- **看分镜节奏**：\`op: "contact_sheet"\` 出一张网格缩略图，一眼看完整条片子的镜头分配。
- **封面**：\`op: "poster"\`；**预览/表情包**：\`op: "gif"\`。

\`h3_post action: "list"\` 会列出全部操作和每个参数的默认值，拿不准就先 list。

## 需要用户做的两件事

- **FFmpeg**：没装的话 \`h3_assets action: "ffmpeg"\` 会报"未找到"，并列出探测过的路径。装好后在插件设置里填「FFmpeg 路径」。**只能生成、不能后期**时先查这一条。
- **ComfyUI 地址**：默认 \`http://127.0.0.1:8188\`。连不上时 \`h3_runs\` 的错误里带探测地址，面板设置页可改。
`,
};