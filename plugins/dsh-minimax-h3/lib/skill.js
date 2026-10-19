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
    description: 'Minimax H3 视频生产：t2v/i2v/r2v 的选择与提示词写法、分镜与跨镜头一致性、时长与合法帧数、Turbo LoRA 取舍、模型清单检查，以及用 h3_post（FFmpeg）做剪辑/合片/字幕/响度/分镜缩略图的配方。含 8GB 显存档位与 OOM 排查、用末帧续写下一镜（CONTINUE）与首尾帧、参考图导致的换脸边缘闪烁，以及实测踩坑：**说话人必须写 (S1)/(S2) 不能写人名**、画外音要明写 Off-screen、没给台词模型会自己编、说了 no cuts 仍会切镜、At 时间戳偏差 0.6–1.5s、ComfyUI LoadImage 缓存导致新静帧不生效，以及生成后必须做的四项验收，加上这次新沉淀的：**i2v 不是动作生成器（人群/冲击/撞击一律走 t2v）**、动水与千军万马这类内容画不出来时改拍「事件的一角」、no cuts 压不住主体漂移、抬手会导致手臂消失、t2v 的服化道会漂到罗马/拜占庭（要正面点名甲式盾型 + 负面排除）、以及每镜抽 5 帧肉眼扫一遍。需要生成或后期 MiniMax H3 视频时加载。',
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

### 参考图怎么选（换脸边缘闪烁的头号原因）

r2v / i2v 的接缝质量，七成取决于参考图本身：

- **正面、光照均匀、背景简洁**。侧脸、逆光、杂乱背景是边缘闪烁和融合不自然的主因。
- 提示词里明写一句：\`consistent character, natural edge blending, no distortion\`。
- 源视频/提示词避开快速运镜和复杂遮挡；侧脸、大动作、遮挡本来就比正脸难。
- 还是闪 → 步数提到 30，或对结果帧序列做一次轻度时域平滑。

### ⚠️ i2v 不是动作生成器（本项目返工最多的一个判断）

i2v 的机制是**按首帧把整段重绘一遍**，所以它擅长"让一张好画面轻微地动起来"，
不擅长"从一张静帧出发完成一段复杂动作"。硬闯的后果不是模糊，是**画面原地飘**：

> 真实案例：一镜"五万唐军被打崩"，静帧是"骑兵冲向阵列"。i2v 出来后七帧里
> **阵型根本没有接触**——一群士兵的背影在原地慢慢挪，两个骑手悬在人群上方不下来。
> 旁白说"被打崩"，画面是静止对峙。这是**叙事错误**，不是画质问题。

按"这镜到底要什么"选模式：

| 这镜要什么 | 用什么 | 为什么 |
|---|---|---|
| 一张好画面轻微移动（推镜、风、火、烟、眼神、缓慢倒下） | **i2v** | 静帧是硬约束，一致性最好 |
| 人群、阵列、冲锋、撞击、溃散、大水、爆炸 | **t2v** | 动作是主体，i2v 会把它钉死 |
| 固定角色 + 大动作 | **别硬来** | 要么拆镜（人物镜 i2v、动作镜 t2v 交替剪），要么接受角色不一致 |

判断口诀：**这镜的"信息"是脸，还是动作？** 是脸走 i2v，是动作走 t2v。
群戏里主角不露脸时，果断丢掉 i2v——省下的不是一次试错，是一次返工。

H3 的换人是**条件化重绘**（按参考图把整段重画一遍），不是逐帧换脸：对侧脸和大动作的鲁棒性比传统
face swap 好，但仍然抽卡，别指望一次成。

### 续写下一镜（CONTINUE）：用上一段的末帧当首帧

H3 单段有上限（社区整合包 15 秒；8GB 卡上 3–5 秒更稳），长片必须分段。分段不跳的办法，是把
**上一段真正的末帧**当下一段的首帧：

1. 抽末帧：\`h3_post op: "poster"\`，\`options: { time: <时长 - 0.1> }\`（参数名以 \`h3_post action: "list"\` 为准）。
   产物在插件数据目录的 \`renders/\` 下；\`h3_post action: "renders"\` 只列文件名，要拿绝对路径去传。
2. 上传：\`h3_assets action: "upload"\` 传那张 PNG 的绝对路径，**文件名带内容哈希**（\`S03_end_9f2c1a.png\`）——
   LoadImage 按输入参数缓存，同名换图不生效。
3. 生成：\`h3_generate mode: "i2v"\`，\`refs: [<那张图>]\`，提示词只写这一段要发生的事，不复述上一段。
4. 首尾都给：i2v 还可以传 \`last_frame\`（首尾帧插值，补中间过渡）。**只有服务器节点声明了尾帧输入才可用**，
   否则会明确报错——这是节点能力，不是提示词能解决的。
5. 合片前统一转码成同分辨率/帧率，接缝处抽帧核对，必要时剪掉 1–2 帧。

⚠️ 别拿"上一段的第 0 帧"续写——那是重放开场，不是接续。

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

> 网上不少教程把帧数写成“81–121 帧（3–5 秒）”——那是按秒数估的，不是 H3 的合法帧数。
> 以 ≡ 5 (mod 17) 为准：3 秒是 73 帧（≈3.04 s），5 秒是 124 帧。

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

### 说话人：\`(S1)/(S2)\` 是"谁在说"，不是备注

- **编号决定让画面里的哪个人动嘴。写人名（\`(皇帝)\`、\`(侯景)\`）会被当成普通文字忽略**，
  于是模型一律让**画面里那个人**发声。典型症状：A 问 B 答，画面上却是 B 自问自答；
  或画外的人说话时画内的人嘴在动。这是本项目返工最多的一类问题。
- 正确做法三件事一起做：
  1. 编号：\`(S1)\` 给画面里的主人物，\`(S2)\` 给次要/画外的人；
  2. 每句台词前加**自然语言提示**点名谁在说（\`the seated emperor answers him, quietly\`）；
  3. 画外音**明写**：\`Off-screen, an unseen voice answers him: (S2) <d>[中文] …</d>\`。
     只写 \`(S2)\` 不写"画外/未见其人"，模型仍会让画内的人开口。
- **两人同框时，先在 \`[Shot 1]\` 里钉死谁是谁**，并明确写出**谁不说话**——
  这比只说"谁说话"有效得多：

    [Shot 1] … The seated emperor is (S1). The kneeling general in the near foreground is
    (S2), and he does not speak at all.
    [Shot 2] At 00:06.40 the seated emperor answers him, quietly: (S1) <d>[中文] …</d>

### 服化道会自己漂到"西方古装"

t2v 没有首帧约束时，默认往**罗马 / 拜占庭 / 中世纪**跑：圆盾、红色马尾盔、石砌城堡。

> 真实案例：一镜中国骑兵冲击唐军盾墙，出来是圆盾＋羽饰盔的罗马军团。

两件事一起做：

- **正面点名**形制：\`Tang dynasty lamellar armour, conical iron helmets, tall rectangular wooden tower shields, black rectangular battle banners\`
- **负面点名排除**错的那个：\`roman armour, greek, byzantine, round shield, horsehair crest, red plume helmet, medieval european knight, samurai, mongolian\`

只写"古代中国"不够。必须把**盾型、盔型、旗型**这些最容易露馅的部件写死。

### 别让模型即兴说话

动作描述里只要出现 "he speaks …"，而**同一条提示词没有对应 \`<d>\` 台词**，
H3 就会自己编一句含混的话（实测：一句听不懂的嘟囔，还混进了成片，被误当成"口播有问题"）。

- 需要有人说话 → **一定给 \`<d>\` 台词**；
- 不需要 → 明确写 \`He does NOT speak at all — his mouth stays closed.\`

### 说"不切"往往不够

H3 很喜欢按台词自动切镜。\`Camera: locked off, no cuts.\` **压不住**——
实测它会自己切 4 次到主角特写，于是别人问话时画面还是主角的脸。要压住得把话说满：

    ONE single unbroken locked-off take — the camera never moves, never pushes in and there is
    ABSOLUTELY NO CUT anywhere in this shot, no close-up and no cutaway of any kind. The framing
    is fixed from the first frame to the last and BOTH men stay fully inside it the whole time.

### \`At MM:SS.mmm\` 只是"希望"，不是"保证"

时间戳能让模型把台词放在大致位置，但**实测偏差 0.6–1.5 秒**（同一镜里 5 句逐句不同）。
所以：

- **不要用 \`At\` 的时间去排字幕/旁白**。生成后必须**实测**台词落在哪
  （能量 + 过零率找语音簇），再按实测值对齐字幕与旁白的进出点。
- 想让旁白和口播不打架，靠的不是 \`At\`，而是**镜长 + 实测 + 校验脚本**（见 dsh-video-narration）。

## 机位与姿态：两个反复咬人的地方

### "no cuts" 压不住主体漂移

写了 \`Camera: locked off, no cuts\` 仍然会慢慢推镜，推到把主体挤出画面：

> 真实案例：一镜"登基受贺"，运动词只写了"very slow push in"。
> 前两秒正常，**最后两帧画面只剩房梁和红幡**，主角没了。

要压住，把话说到位：

    Camera: completely LOCKED OFF and static, the tripod does not move at all,
    no push in, no tilt, no pan, no zoom, no cut. The framing stays exactly the same
    from the first frame to the last and the seated man stays in the centre of frame
    the whole time.

**单人 + 静态场景**（登基、跪缚、独白）优先完全锁机位；推镜留给有景深余量的镜头。

### 抬手 = 手臂消失

首帧里手臂抬在身体轮廓之外，一动就容易**凭空消失、或拉成一根面条**：

> 真实案例：一位少年将军"抬手护胸"的姿势，第 60 帧手没了，第 80 帧胳膊拉成一条。

规则：**i2v 的首帧，手尽量在体侧或贴着身体**，别让肢体成为独立剪影。改姿势比加步数便宜。

## 什么内容 H3 画不出来（实测黑名单）

不是"画得差"，是**结构上做不到**。遇到这些，改拍法比加步数有效一百倍。

### 水：动水几乎必崩

一镜"决开河堤、大水灌营"，四条路全废：

| 版本 | 出来的东西 |
|---|---|
| i2v（静帧是洪水灌营） | 骑手**站在浪头上**，物理不可能 |
| t2v 一版 | "河堤"画成带垛口的**石墙**（欧洲城堡），不是土堤 |
| t2v 二版（负面排除石墙） | 水变成**晶状白沫地形**，帐篷和营火还完好地立在水里 |
| t2v 三版（水退到背景、前景放溃兵） | 读成"士兵在沙滩上跑"，背景是渔船和篝火 |

**解法：拍事件的一角，不拍事件本身。** 改成"洪水之后的清晨"——
平静泥水、塌掉的帐篷、漂浮的盾与矛、水里的尸体、两个泡在水里的幸存者——
一次就成，而且叙事上更狠：观众自己补完"昨晚发生了什么"。

### 通用原则：把做不到的部分移到画外

| 想要的 | 改成 |
|---|---|
| 洪水灌营 | 洪水之后的灾后现场 |
| 千军万马的正面冲锋 | 撞击点附近的一小群人与飞散的盾 |
| 整座城的陷落 | 城门里面的一段血战，或事后的空城 |
| 一长段打斗 | 三个短促瞬间（起手 / 命中 / 倒地） |

判据：**画面里同时需要"大量对象 + 复杂物理"的，一律降级。** 人或物少一半，成功率翻倍。

### 整齐的方阵与"背影海"天然显假

一排排一模一样的后背，动起来只会一起飘。真要人多，用**深度**（前景虚、中景实、远景只剩剪影）
和**不对称**（倒下的人、歪掉的旗、缺口）来破。

## 生成后的验收（每条都要过）

生成成功 ≠ 可以进剪辑。这四件事每轮都查，否则问题会在成片里才暴露：

1. **台词有没有真的念出来**：算音频 RMS 与过零率（语音约 0.05–0.25）。全零 = 没念。
2. **念的人对不对**：把画面切左右两半比较帧间活动量；对白响起时动的那一半才是说话人。
   或者直接抽帧看嘴。
3. **有没有偷偷切镜**：逐帧算帧间差，突然的尖峰 = 硬切。\`locked off\` 不等于没切。
4. **静帧有没有真的喂进去**：取视频第 0 帧与意图静帧比差。
   ⚠️ ComfyUI 的 \`LoadImage\` **按输入参数缓存**：文件名不变就复用上一张图，**磁盘换了也不生效**。
   上传时把文件名带上内容哈希（\`C4_1_47f47cdf.png\`），参数一变缓存键就变。
5.5 **每镜抽 5 帧拼一条横条，用眼睛扫一遍**（自动化查不出"看着假"）。
   首帧差、切镜检测、音量都过关的镜头，照样可能"阵型没接触""主角飘出画面""水是固体"。
   一次生成 14 镜 ≈ 一条 \`tile=5x1\` 的 ffmpeg，五秒钟看完，比逐条回放有效得多。
5. **黑场/静音片段的音轨要和画面等长**：用 \`anullsrc\` + \`-frames:v\` 生成时，
   视频一到帧数上限整个输出就终止，**音频会被截短**（实测 10.125s 的片子音频只有 7.70s）。
   画面与静音**分开生成再封装**。

## Turbo（Lightning LoRA）取舍

\`turbo: true\` 把步数从 20 降到 8（r2v 降到 4），**快 2~3 倍**，代价是细节和稳定性略降。

- 打样/试构图/试提示词 → **开 turbo**，一次能多跑几条。
- 定稿 → 关掉，跑满步数。
- \`seed\` 固定时，开 turbo 和关 turbo 是**两条不同的轨迹**，不能指望结果只是"更糊的同一版"。

## 显存档位：8GB 能跑，但只跑 480P 短片

Int8 量化把门槛压到 8GB，但 **8GB 是"能跑"，不是"好用"**。社区实测（480P、开 SageAttention）：

| 显卡 | 设置 | 耗时 |
|---|---|---|
| RTX 3060 12GB | 864×480 / 5 s / 25 步 | 7–9 分钟 |
| RTX 5060Ti 16GB | 864×480 / 5 s | ≈5 分钟 |
| GTX 1070 8GB | 640×360 / 3 s | 15–20 分钟 |

同机同参下 r2v 比 t2v 再慢 15–25%（多了参考图编码和运动条件注入）。**排期按这个量级，不要按"几十秒"许愿。**

8GB 上的硬规则，按优先级：

1. **只用 Int8 权重**。FP16 加载就 OOM（FP16 至少要 16GB）。
2. **分辨率 ≤ 864×480**（0.4 MP），3–5 秒；8GB 上 1080P 会 OOM，2K 要 16GB 以上。
3. **VAE 解码分块**：\`vae_tile: 512\`（走 VAEDecodeTiled）。8GB 上一次性解 124 帧的视频 latent 是 OOM
   高发点，常常比采样更早炸。
4. **ComfyUI 启动参数带 \`--lowvram\`**（整合包/启动器里通常是勾选项）。插件改不了启动参数，只能提醒用户确认。
5. **队列串行**：一次只跑一个任务，别并发排队——两个任务的显存峰值会叠加。
6. 关掉预览窗口的实时高分辨率渲染，先出低分辨率草稿再放大。

**显存 ≥12GB 时不要开 \`vae_tile\`**：一次性解码更快，也没有分块接缝风险。

## 打不开或跑不动，先查这四行

- **页面空白 / 一直转圈**：终端还在加载模型（首次 1–3 分钟）；端口被占用时看终端实际输出的端口，不是 8188。
- **CUDA out of memory**：① 确认 Int8 权重 ② 分辨率降到 640×360 ③ 时长降到 3 秒 ④ \`vae_tile: 512\`
  ⑤ 关掉别的占显存程序 ⑥ 确认 \`--lowvram\`。
- **生成成功但没人声**：台词没包 \`<d>…</d>\`（见"对白"）。
- **动作变形 / 边缘闪**：参考素材动作太碎或参考图不合格（见"参考图怎么选"），换素材比加步数有效。

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