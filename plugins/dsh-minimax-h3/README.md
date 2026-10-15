# dsh-minimax-h3

**MiniMax H3 视频工作室，给 DeepSeek Harness 用的插件。**
用 ComfyUI 上的 MiniMax H3 生成视频（文生 / 图生 / 参考生），再用 FFmpeg 把它做成能交付的片子。

它**只做视频**。不碰文生图、图生图、ControlNet、工作流提取那套通用能力——那些交给 `dsh-comfyui`。
这个插件把力气花在视频真正需要的地方：三个官方模板的忠实移植、参考素材进入 ComfyUI 的通道、
跨镜头不漂移的分镜板、以及一套像样的后期。

---

## 它给你什么

| 能力 | 说明 |
|---|---|
| **三种官方流程** | `t2v` 文生视频、`i2v` 图生视频、`r2v` 参考生视频，逐节点移植 ComfyUI 官方模板 |
| **参数化而非改图** | 提示词、画幅、像素预算、时长、帧数、种子、步数、Turbo LoRA、模型文件——都写进同一张图 |
| **分镜板** | 一个项目 = 一串镜头，每个镜头自己一套参数与参考图；风格基线可统一注入每个提示词 |
| **参考素材通道** | 本地图片一键推进 ComfyUI `input`，返回可直接填进 `refs` 的名字 |
| **模型清单自检** | 读 `/object_info` 告诉你缺哪个 unet/clip/vae/lora，而不是让采样器深处报一个看不懂的错 |
| **FFmpeg 后期（22 个操作）** | 转码、裁剪、拼接合片、配音配乐、响度标准化、字幕硬烧/软封装、改画幅、变速、淡入淡出、倒放、循环、水印、烧字、并排对比、抽封面、分镜缩略图、GIF、图片序列回视频 |
| **Web 面板** | 生成 / 分镜 / 结果 / 后期 / 设置五个页签，可拖动可缩放，几何位置本地保存 |
| **Agent 工具（5 个）** | `h3_generate`、`h3_runs`、`h3_assets`、`h3_project`、`h3_post` |
| **随附 skill** | 提示词写法、模式选择、时长陷阱、Turbo 取舍、后期配方——模型按需加载 |

---

## 安装

> **本仓库的这份代码尚未安装。** 下面是安装方法，需要你自己执行。

插件的加载器入口 id 是 `minimax-h3`，包名是 `dsh-minimax-h3`。

1. 把整个目录放到一个稳定的位置（不要放在会被清理的临时目录）。
2. 在本会话里让我用 `plugin_manager` 的 `install_bundle` 安装它，或者你自己在配置里加一行：

```yaml
# <profile>/cordis.patch.yml
- insert:
    - id: minimax-h3
      name: 'dsh-minimax-h3'
      config:
        baseUrl: http://127.0.0.1:8188
```

3. 安装后**刷新页面**，然后到 **设置 → MiniMax H3 视频** 填 ComfyUI 地址（面板的「设置」页签是同一个表单）；
   要用后期功能，还要填 FFmpeg 路径。也可以把值写进上面那行 `config` 里——它是基线，设置页的改动会覆盖它。

### 前置条件

| 需要 | 为什么 |
|---|---|
| ComfyUI **0.33+** | H3 的节点（`MiniMaxH3ImageToVideo`、`MiniMaxH3ReferenceToVideo`、`ResolutionSelector`、`CreateVideo`、`SaveVideo`、`ComfyMathExpression`）都在 comfy-core |
| H3 模型文件 | 见下表。用 `h3_runs action: "inventory"` 查缺 |
| FFmpeg | **只有后期需要**。没有它照样能生成，`h3_post` 会明确报缺 |
| Node ≥ 22.19 | 插件本身 |

### 需要的模型文件

用 `h3_runs action: "inventory"` 会逐个报"在 / 缺 / 未知"，并列出服务器上的同类替代文件。默认文件名（来自官方模板，**每一项都能在生成时覆盖**）：

| 槽位 | 默认文件 | 用在 |
|---|---|---|
| UNet | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | t2v / i2v |
| UNet | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | r2v |
| CLIP | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 全部 |
| VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | 画面 |
| VAE | `minimax_h3_audio_vae_fp32.safetensors` | 音轨 |
| LoRA | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | t2v / i2v 加速 |
| LoRA | `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` | r2v 加速 |

同名不同精度（fp8 / bf16 / 合并版）完全没问题：把 `models: {"unet": "你的文件.safetensors"}` 传给 `h3_generate`，或在面板的"高级"里填。

---

## 远程 / 云端 ComfyUI（租卡、局域网另一台机器）

插件的传输层就是 ComfyUI 原生 HTTP API（`/prompt`、`/history`、`/view`、`/upload/image`、`/object_info`），
所以**租卡或局域网另一台机器，只需要改 `baseUrl`**，`comfyuiDirs` 留空即可 —— 生成、结果、媒体预览、
后期全都照常。Comfy Cloud / Comfy API 那种 v2 接口（Assets + Jobs）是另一套协议，本插件不接。

### 局域网另一台机器

1. 那台机器的 ComfyUI 必须监听所有网卡 —— **默认只绑 `127.0.0.1`，外部连不上**：
   `python main.py --listen 0.0.0.0 --port 8188`
2. 放行防火墙端口（Windows 上最常见的漏项）。
3. 本插件 `baseUrl` 填 `http://192.168.x.x:8188`。

### AutoDL 租卡

- 实例里的 ComfyUI 同样要 `--listen 0.0.0.0 --port <端口>`，再用 AutoDL 的「自定义服务」把端口映射出来，
  `baseUrl` 填映射后的地址（形如 `https://uXXXX-xxxx.seetacloud.com:8443`）。
- **或者走 SSH 隧道，最省事也最稳**：
  `ssh -L 8188:127.0.0.1:8188 -p <实例SSH端口> root@<实例地址>`，
  然后 `baseUrl` 填 `http://127.0.0.1:8188`。隧道是明文 loopback，没有证书和限流问题。

### 认证

局域网一般不用填。反代后面要认证时：`apiKeyEnv` 填承载密钥的环境变量名（或 DSH 凭据名），
`authHeader` / `authScheme` 决定怎么发 —— 默认 `Authorization` + `Bearer`；要 `x-api-key: <key>` 这种
就把 `authHeader` 设为 `x-api-key`、`authScheme` **留空**（留空 = 直接发 key 本身），要彻底不发认证头就把
`authHeader` 也留空。

### 先跑连接诊断

设置页的「测试连接」会给一份报告：能不能连上、**它最终用了哪个路由前缀**（有些反代只转发 `/api/*`，
不诊断看不出来）、`/object_info` `/queue` `/history` 各自是否可用、**那台服务器上装没装 H3 的节点**、
以及本机有没有 FFmpeg。指向一台新机器时先跑一次，能省掉大半排查时间。

报告里 `h3` 那几个徽章变红 = 那台服务器上的 ComfyUI 可能低于 0.33，或者没装 MiniMax H3 支持。

### 素材列表从哪来

远程服务器没有本地目录可扫，所以「输入 / 已生成」列表改从**服务器自己的 `/history`** 推导
（每条 history 都带着它产出的文件，以及它用过的文件名），再叠加插件自己的上传记录。
配了 `comfyuiDirs` 的本地场景则是两者合并 —— 目录扫描能找到 history 已经丢弃的旧文件。
`/history` 答不上来时列表标记为**未知**，而不是显示成空。

### 三件要有心理预期的事

- **FFmpeg 在你自己的机器上跑，不在租的卡上。** 后期前插件会把片源下载到本地缓存再处理 ——
  这是必须的（FFmpeg 本来就是本地工具），代价是每段片子都要过一次网。5 秒 0.4MP 的片子只有几 MB，通常无感。
- **媒体一律经插件自己的同源代理** `/minimaxh3/media` 转发，API Key 不下发浏览器，也不存任何临时签名 URL。
- **自签名证书不支持。** `fetch` 会校验证书，而插件没有关闭校验的开关（那需要引入依赖，而这个包必须零依赖）。
  遇到自签名 HTTPS，请改走 SSH 隧道或明文 HTTP 地址。

---

### 最短路：文生视频

```
h3_runs   action: "inventory"                 # 先确认模型在
h3_generate  prompt: "…"  mode: "t2v"  duration: 5  turbo: true
```
异步返回 `jobId`，任务结束会通知本会话，用 `job_output` 收结果。

### 图生视频（一致性最好的路子）

```
h3_assets action: "upload"  path: "D:\\refs\\hero.png"   # → "hero.png"
h3_generate mode: "i2v"  refs: ["hero.png"]  prompt: "…"
```

### 参考生视频（跨镜头锁角色）

同一组参考图，每个镜头换提示词，提示词里用 `<Picture 1>`、`<Picture 2>` 指代：

```
h3_generate mode: "r2v" refs: ["hero.png","costume.png"] \
  prompt: "…<Picture 1> 是主角，<Picture 2> 是她的服装… CUT 1: … Audio: …"
```

### 合片

```
h3_post op: "concat" source: "run:<id1>:0" extras: ["run:<id2>:0","run:<id3>:0"]
h3_post op: "subtitle" source: "render:final_xxx.mp4" extras: ["upload:subs.srt"]
h3_post op: "loudnorm" source: "render:subtitled_xxx.mp4" options: { i: -16 }
```

`h3_post action: "list"` 列出全部操作和每个参数的默认值。

---

## 提示词怎么写（H3 吃这一套）

H3 是"导演式"提示词模型。结构化远胜形容词堆砌：

```
<风格/介质> Realistic live-action cinematic look, anamorphic lens, film grain…
<场景概述> 一句话说清谁在哪干什么
<分镜>     [0s-1.5s] Shot 1: high side angle: …
           [1.5s-3s]  Shot 2: …
<镜头语言> cuts clean and hard, no dissolves, slight frame jitter on impact
<声音>     Audio: wind, footsteps, low score underneath, accent hit on each leap
<排除项>   No text, subtitles, logos or watermarks of any kind, no cartoon rendering
```

- **5 秒里能装 3~4 个镜头**：写 `CUT 1: … CUT 2: …` 并明确 `cuts clean and hard`。
- **音轨是生成出来的**，`Audio:` 那段决定它出什么声，不写就是随机环境声。
- **结尾必写排除项**，否则容易自己加字幕条、台标和水印。

### 时长：会比你填的长一点

H3 只接受 **4n+1** 帧。插件按官方规则把秒数向上吸附：

| 填 | 帧数 | 实际 |
|---|---|---|
| 5 s | 124 | ≈5.17 s |
| 6 s | 158 | ≈6.58 s |
| 10 s | 243 | ≈10.13 s |
| 20 s | 481 | ≈20.04 s |

要精确卡点就传 `frames`。

### Turbo LoRA

`turbo: true` 把步数 20 → 8（r2v 为 4），快 2~3 倍，细节略降。**打样开，定稿关。**
注意：固定 `seed` 时开/关 turbo 是两条不同轨迹，不是"同一版的糊/清"。

---

## 面板

会话标题栏的 **MiniMax H3 视频** 按钮打开浮层，五个页签：

- **生成**——模式卡片、提示词、参考图（从素材挑或直接上传）、画幅/像素/时长/帧数/种子/Turbo、高级里的宽高与模型覆盖。
- **分镜**——建项目、加镜头、逐镜生成；风格基线自动拼进每个镜头的提示词。
- **结果**——历史记录、视频预览、"送去后期"、复制提示词、中断、删除。
- **后期**——选操作、按该操作的参数表单填值、选输入与附加输入、执行并看进度；下面是历史产物。
- **设置**——ComfyUI 地址、API Key 变量名、媒体地址、FFmpeg/FFprobe 路径、ComfyUI 安装目录、默认画幅/像素/时长/Turbo、界面语言，以及测试连接。**同一个表单也在 设置 → MiniMax H3 视频 里**（两处是同一个组件，不会走样）。

面板用宿主主题变量（`--dsw-alias-*`）着色，跟随明暗主题；几何位置存在 `localStorage`。

---

## Agent 工具速查

| 工具 | 动作 | 用途 |
|---|---|---|
| `h3_generate` | — | 生成一条视频。`mode_run` 默认 `async` |
| `h3_runs` | `list` / `get` / `queue` / `inventory` / `cancel` / `delete` | 历史、队列、模型清单、中断 |
| `h3_assets` | `list` / `upload` / `attach` / `ffmpeg` | 参考图进 ComfyUI、附加文件进插件、FFmpeg 检测 |
| `h3_project` | `list` / `get` / `save` / `add_shots` / `delete` | 分镜板 |
| `h3_post` | `list` / `run` / `renders` / `delete` | FFmpeg 后期 |

输入寻址统一用前缀：`run:<runId>:<index>`（生成结果）、`render:<文件名>`（后期产物）、`upload:<文件名>`（附加文件）。

---

## HTTP 接口（面板与外部程序共用）

全部挂在这个插件的同源前缀下，**ComfyUI 的 API Key 不会下发到浏览器**。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/minimaxh3/ping` | 页面自报地址（用于让媒体 URL 匹配你实际访问的 host） |
| GET | `/minimaxh3/meta` | 模式、画幅选项、后期操作目录、FFmpeg 状态、模型清单 |
| GET/POST | `/minimaxh3/config` | 读（脱敏）/ 写配置 |
| POST | `/minimaxh3/test` | 探测 ComfyUI |
| POST | `/minimaxh3/generate` | 排队一次生成，立即返回 |
| GET | `/minimaxh3/runs` | 历史（`?id=` 取单条） |
| POST | `/minimaxh3/runs/cancel` · `/runs/delete` | 中断 / 删除 |
| GET | `/minimaxh3/queue` | ComfyUI 运行中与排队 |
| GET | `/minimaxh3/media` | 代理 ComfyUI 的 `/view`，支持 Range（可拖动进度条） |
| GET | `/minimaxh3/render` · `/upload` | 本地后期产物 / 附加文件，支持 Range |
| POST | `/minimaxh3/upload/save` | 附加文件（原始字节，名字在 `?name=`） |
| POST | `/minimaxh3/ref/upload` | 参考图 → ComfyUI `input`（原始字节，`?name=`） |
| GET | `/minimaxh3/assets` | 素材总览 |
| GET/POST | `/minimaxh3/projects` | 分镜板读写 |
| POST | `/minimaxh3/post` | 启动后期（立即返回 post id） |
| GET | `/minimaxh3/post/status` | 后期进度 |
| GET | `/minimaxh3/renders` | 后期产物列表 |

---

## 配置项

所有可调项都在 `cordis.patch.yml` 里 `minimax-h3` 这一行的 `config` 下，**也可以在面板的「设置」页改**。
面板的改动写进插件数据目录的 `settings.json`，**立即生效、不用重启**，并覆盖配置文件里的同名项。
标 🔄 的字段面板可改且立即生效；`dataDir` 是唯一的重启字段（面板里只读显示）。

> **为什么没有导出 `Config`。** 从目录安装的 bundle 是以 portal（`link:`）方式链接进 profile 的，
> Node 会按包的**真实位置**解析它的 import——profile 的 `node_modules` 不在解析链上。也就是说这个包
> **不能声明任何运行时依赖**，否则入口会在导入阶段直接失败（这正是第一次安装失败的原因：`Config` 需要
> `@deepseek-ai/schemastery`）。所以插件不导出 `Config`、不依赖宿主 settings 服务，自己在 `lib/config.js`
> 里管配置。
>
> **设置页照样有。** `settings.section` 是**客户端**插槽，插件自己贡献表单渲染到 **设置 → MiniMax H3 视频**——
> 不需要 schema 也能有设置页。代价只是少了宿主自动生成的控件样式，换来的是**零依赖、装得上、哪台机器都一样**。

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` 🔄 | `http://127.0.0.1:8188` | ComfyUI 地址 |
| `apiKeyEnv` 🔄 | `COMFYUI_API_KEY` | 凭据名（先查 credentials，再查进程环境变量） |
| `authHeader` 🔄 | `Authorization` | 认证头名；留空 = 不发送任何认证头 |
| `authScheme` 🔄 | `Bearer` | 认证方案前缀；留空 = 直接发 key 本身（`x-api-key` 风格） |
| `connectTimeoutMs` 🔄 | `10000` | 单次 HTTP 超时 |
| `timeoutMs` 🔄 | `1800000` | 一次生成最多等多久（30 分钟） |
| `pollIntervalMs` 🔄 | `1000` | 轮询 history 的间隔 |
| `maxMediaItems` 🔄 | `12` | 单次生成最多收几个产物 |
| `maxMediaBytes` 🔄 | `536870912` | 媒体代理单文件上限 |
| `dataDir` | `$DSH_HOME/data/dsh-minimax-h3` | 插件数据目录（唯一的重启字段） |
| `comfyuiDirs` 🔄 | `[]` | ComfyUI 安装目录，用于定位便携版 FFmpeg、扫描 input/output |
| `mediaHost` 🔄 | 空 | 媒体绝对地址；留空自动用浏览器请求的地址 |
| `ffmpegPath` 🔄 | 空 | FFmpeg；留空自动探测 |
| `ffprobePath` 🔄 | 空 | FFprobe；留空取 FFmpeg 同目录 |
| `ffmpegTimeoutMs` 🔄 | `1800000` | 单次后期最长多久 |
| `defaultAspect` 🔄 | `16:9 (Widescreen)` | 默认画幅 |
| `defaultMegapixels` 🔄 | `0.4` | 默认像素预算 |
| `defaultDuration` 🔄 | `5` | 默认时长（秒） |
| `defaultMode` 🔄 | `t2v` | 默认模式 |
| `defaultTurbo` 🔄 | `false` | 默认是否开 Turbo |
| `maxRuns` | `400` | 保留多少条生成记录 |
| `maxRenders` | `400` | 保留多少条后期记录 |

### FFmpeg 自动探测顺序

`ffmpegPath` → `ffmpeg`（PATH） → `C:\ffmpeg\bin` → WinGet Links → Chocolatey → `D:\ffmpeg\bin` →
`~/scoop/shims` → `{comfyuiDir}` 下若干位置 → **ComfyUI 便携版里 `imageio_ffmpeg` 自带的 FFmpeg**。
`h3_assets action: "ffmpeg"` 会列出它试过的每一条路径和失败原因。

---

## 工作原理与设计取舍

- **三个模板是逐节点移植的**，不重新发明图。官方怎么做，这里就怎么做——包括 `r2v` 模板里
  `BasicScheduler` 读原始 UNet 而其它模式读 LoRA 开关这个差异，也照原样保留（`lib/workflows.js`
  里 `R2V_SCHEDULER_USES_RAW_UNET` 一个常量就能改）。
- **时长走图里的表达式节点**（`ComfyMathExpression`），不在宿主端算完塞个数字。这样你在 ComfyUI 里
  打开这张图，看到的规则和官方一样。要精确帧数时才会换成字面量。
- **一切依赖服务器的东西都先问服务器**：画幅选项、参考输入的组名（`ref_images.ref_image_N` 是节点
  自己的命名，不是我们猜的）、模型文件列表，都从 `/object_info` 读；读不到就用官方模板的值兜底。
- **后期操作是纯描述符**：`build(ctx)` 只返回 argv 和输出路径，不自己 spawn。于是一个操作能否执行
  可以离线测试（`scripts/smoke.mjs` 就是这么测的），面板也能预览命令。
- **argv 直连 `spawn`（`shell: false`）**，所以不存在把用户输入拼进命令行的注入面；剩下的只有
  FFmpeg 自己那层 filtergraph 转义，而烧字走临时 `textfile=`，根本不给任意文本进入 filtergraph 的机会。
- **生成和后期都是"先返回、后干活"**：请求处理阻塞十分钟就是会被代理掐死的处理。
- **数据文档原子写 + 串行变更**：写 `.tmp` 再 rename，每个文档一条 promise 队列，避免并发读改写丢记录。

---

## 开发

```bash
# 语法检查
node --check client/client.js
for f in lib/*.js; do node --check "$f"; done

# 离线自测：不需要 ComfyUI，也不需要装 FFmpeg
node scripts/smoke.mjs
```

`scripts/smoke.mjs` 覆盖 **71 项**，全部不需要 ComfyUI、不需要 FFmpeg、**也不需要任何依赖**
（远程路径用一个假 ComfyUI 打桩，所以 `fetch` 也不出网）：

- 官方 4n+1 规则的取值表（含 JS `%` 与 Python `%` 符号差异这个坑）
- 三种模式的图结构、引用完整性（每个 `[id, slot]` 都指向存在的节点）、turbo 开关、显式尺寸/帧数
- 参数校验（缺提示词、模式不存在、i2v 参考图数量、画幅拼写、宽高成对、越界钳制）
- 模型清单在"有/无 object_info"两种情况下都不误报
- **每一个** FFmpeg 操作的 argv（参数类型、无 `undefined`/`NaN`、输出在最后、Windows 路径转义）
- JSON 存储的并发写、容量上限、损坏文件恢复、分镜按 id 合并、设置覆盖层的落盘与损坏回退
- 设置层：覆盖项优先于 `cordis.patch.yml`、`undefined` 不遮蔽基线、未知键与坏值被丢弃并报告
- 远程形态：认证头/方案的各种组合（含"空 header 名 = 彻底不发"）、从 `/history` 推导输入与产物
  （且不会把结尾像 `.png` 的提示词当成文件名）、服务器答不上来时报告"未知"而非"空"、诊断报告的
  路由前缀 / 端点可用性 / H3 节点存在性
- `apply()` 在模拟宿主上真实跑一遍：注册 5 个工具、挂载全部路由、错误输入不触网
- 客户端 bundle 的 id 与包名一致、四个 slot 注册、不 require 未声明的模块
- `package.json` / `cordis.patch.yml` / locale 三者一致

> 这个包**没有任何依赖**，`node scripts/smoke.mjs` 直接就能跑。

---

## 已知边界

- **不支持的**：文生图、图生图、ControlNet、LoRA 训练、ComfyUI 画布→API 提取。这些是 `dsh-comfyui` 的活。
- **没验证过的**：本插件的生成链路**尚未在真实 ComfyUI 上跑通**（这份代码写完时 ComfyUI 没有运行）。
  图结构是按官方模板逐节点复刻并做了结构自检，但"官方模板正确"是**推理**，不是**观测**。
  第一次真机运行时请先用 `turbo: true` + 5 秒跑一条最便宜的验证。
- **r2v 的参考音频/视频**：官方模板只接了参考图，插件也只接参考图。节点是否声明了 `ref_audios`/`ref_videos`
  这类输入组取决于服务器上的节点定义；代码已经从 `/object_info` 读组名，但**没有验证过**多组并存的情况。
- **`ffprobe` 缺失时**：`fade` 的淡出、`concat normalize` 的音频补齐会退化（会明确说明，不会静默出错）。
- **面板与宿主其他浮层**：面板在 `shell.overlay`（id `minimaxh3.panel`），层级 25。

---

## 目录结构

```
dsh-minimax-h3/
├── package.json            清单：bundle patch、client 平台、图标、显示文案
├── cordis.patch.yml        插入 id: minimax-h3 这一行
├── icon.svg
├── locale/{zh,en}.json     插件管理卡片文案
├── lib/                    Host 端
│   ├── index.js            apply()：配置、工具、路由、skill 的注册与回收
│   ├── config.js           配置默认值 / 解析（默认 → 配置文件 → 面板覆盖）+ 写入校验
│   ├── comfy.js            ComfyUI HTTP 客户端（queue/history/upload/view 流）
│   ├── models.js           模式目录与默认模型文件名
│   ├── workflows.js        三个官方模板的图构造
│   ├── params.js           选项归一化、画幅/组名探测、模型清单
│   ├── ffmpeg.js           FFmpeg 探测、探测媒体、22 个后期操作
│   ├── studio.js           工具与路由共用的操作层
│   ├── store.js            JSON 持久化（原子写 + 串行变更）
│   ├── tools.js            5 个 Agent 工具
│   ├── routes.js           面板 HTTP 接口与媒体代理
│   ├── host-hint.js        浏览器实际访问的 origin
│   ├── http.js             极小的 HTTP 辅助
│   └── skill.js            随附 skill（提示词/模式/时长/后期）
├── client/client.js        Client 端：触发按钮、浮层面板、设置页分区、两个工具卡片
└── scripts/smoke.mjs       离线自测
```

---

## 许可

MIT。