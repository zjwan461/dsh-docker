---
name: dsh-h3-comic-science
description: 用 MiniMax H3 做三类平台爆款——**AI 漫剧**、**AI 换脸/重演**（rapper swap、世界巡演）、**外星人科普**，也能脱离插件直连 ComfyUI 跑任意工作流。含**决策入口**（静态还是动态、原生口播还是 TTS、用不用 H3）、**H3 官方语法**（三段/六段、`<d>` 台词、`(S1)` 说话人、17k+5 帧、cfg=1 无负面词）、**通用镜头工艺**（多人站位与闭嘴锁、因果式运镜、八种转场、武打六拍、Hub/Chain 长片连续性、换脸、T8 管线）、**三条产线**（漫剧 / 换脸重演 / 科普）、**声音**（原生口播情绪、TTS 分工、FishAudio 克隆、对口型、BGM 无分轨与闪避、字幕路线）、**后期质检**（finish/qa/seam）与 **LoRA 目录**。附 22 套随包 API 工作流、`fetch-models.sh` 权重下载脚本与纯标准库客户端 `comfy.py`。用户要做漫剧/科普/分镜/换脸/口播/长片，或在 ComfyUI 上跑 H3、Wan、LTX、Qwen 生图时加载。
whenToUse: 用户要做 AI 漫剧、动态漫、竖屏短剧；要做 AI 换脸/重演（演唱会换脸、rapper swap、影视片段换人）；要做"外星人给地球人讲知识"这类双人对话科普；要做口播数字人、亲情向、动作迁移、歌词 MV、四宫格分镜；要写分镜、台词、站位、运镜、转场、打戏；要决定静态漫还是动态漫、原生口播还是 TTS；要做换脸/人物替换；要跑 T8/U22/U24、Wan 首尾帧、LTX MSR 等高级工作流；要脱离插件直连 ComfyUI 提交任务、查状态、取成品；要排查画风漂移、口型错人、声线不分、台词被截、字幕自现、打斗发软、成片削波。
metadata:
  version: 2
  requires: [ffmpeg, python3]
---

# H3 视频生产：漫剧 / 换脸重演 / 科普

三条产线（漫剧 / 换脸重演 / 科普），一套底层。**H3 不是听话的摄像机，是会自己补戏的联合导演**——所以规则比创意更重要。

三条最贵的经验，先记住：

1. **它能画字幕，但不给你字幕轨**；会自己加字幕、加音乐，关不掉，只能绕。
2. **单张关键帧只钉姿态，钉不住速度**；接缝单独看都好，三跳之后整体偏掉（详见 §2.4）。
3. **情绪戏用原生口播**；TTS 后期贴不上表演的节奏。

---

## 0. 决策入口（先回答四个问题）

**本 skill 服务三类平台爆款**：**AI 漫剧**（§3）、**AI 换脸/重演**（§2.5）、**外星人科普**（§4）。
同类变体（口播数字人、亲情向、动作迁移、MV、四宫格、动物拟人）见 `references/genres.md` 的类型地图——**换类型就要换节奏，不是换模型**。
生态里还有 35 套工作流（生图/Wan/LTX/口播克隆）的编目与选型，见 `references/workflow-catalog.md`；权重怎么补见 `references/models.md`。

```
① 这段必须用 H3 吗？
   ├─ 要"承接上一镜、必须落到某构图" → Wan 首尾帧（references/workflows/video/G02-Wan首尾帧.json）
   ├─ 真人动作搬到角色            → Wan Animate（…/video/P02-WanAnimate动作迁移.json）
   ├─ 2–5 主体同时保身份          → LTX MSR（…/video/H41-LTX-MSR多参考.json）
   ├─ 只要像素级贴脸/超长          → 专用 face-swap 工具
   └─ 其余                        → H3（本 skill 主线）

② 要"真动"还是"静帧+运镜"？
   ├─ 对话/信息密集 → 静态漫：关键帧 + Ken Burns + 配音（成本 1/5）
   ├─ 打斗/变身/穿越 → 只把这些镜做 i2v，其余静态
   └─ 全动态 → 一集 40 镜 ≈ 2–5 小时 GPU

③ 声音走哪条？
   ├─ 有确定音频（配音/歌/客户录音） → 对口型（talking-head §2）
   ├─ 要跨集同音色                  → FishAudio 克隆 → 再对口型
   └─ 要情绪/现场感                  → 原生口播（native-dialogue）

④ 用插件还是直连？
   └─ 默认直连：scripts/comfy.py + references/workflows/（不依赖任何插件）
```

### 0.1 直连 ComfyUI（推荐，跨机器可用）

```bash
B=http://<真实地址>:<端口>          # 必须按当前任务核对后传入
S=references/workflows

python scripts/comfy.py --base $B queue                                     # 只读：忙不忙
python scripts/comfy.py --base $B validate --workflow $S/h3/h3_t2v_api.json  # 只读：能不能跑
python scripts/comfy.py --base $B upload --file ref.png --subfolder proj
python scripts/comfy.py --base $B submit --workflow $S/h3/h3_t2v_api.json
python scripts/comfy.py --base $B wait --id <PID> --timeout 900
python scripts/comfy.py --base $B download --id <PID> --out out/
```

随包工作流：`h3/`（官方 t2v/i2v/r2v + U00/U06V9/U11/U17/U22/U24/U30/U32）、`image/`、`video/`。清单见 `references/workflows/README.md`。

**先补权重**：`bash references/workflows/fetch-models.sh`（在 ComfyUI 根目录跑，`RATE=20M` 限速、断点续传、只下缺失）。覆盖 31/54，其余社区 LoRA 见 `references/models.md`。

### 0.2 工程骨架

```bash
python scripts/scaffold.py my-series --format manju --ep EP01 --shots 24
# → bible.md（角色/场景/状态机/声音）+ EP01/{剧本.md,分镜.json,提示词.md,refs,clips,vo,out}
python scripts/check.py EP01/分镜.json     # 生成前校验：时长/台词容量/说话人/挂图/字段/切点
```

`h3_project` 之类的插件工具可用可不用；**判断与验收不依赖它**。

---

## 0.3 开头 3 秒（所有类型通用）

**观众不是来看片子的，是划到了。** 前 3 秒不给他一个"我正在想的问题"，后面再好也没用。

- **一个视频只讲一件事**；第一句 ≤15 字，且必须是问题/冲突/数字。
- **第一句 = 第一帧**；字幕第一行就是钩子原句，不要另写。
- 十种钩子（反常识 / 痛点直呼 / 数字冲击 / 损失前置 / 赌约 / 身份揭秘 / 对比落差 / 悬念 / 场景还原 / 结果前置），按类型有首选：漫剧→赌约·损失；换脸→结果前置·悬念；科普→反常识·数字；口播→痛点·身份。
- 前 15 秒结构：**钩子(0–3) → 承诺(3–8) → 第一次兑现(8–15)**，之后每 15 秒一个反转。
- **写 3 个钩子做 A/B**，只看 3 秒完播率。

完整句式库、口播节奏、失败清单见 `references/hooks.md`。

---

## 1. H3 语法（写错就白跑）

### 1.1 两种结构

**三段式**（t2v / i2v）：

```text
integrated_multimodal_description: [Shot 1] ... [Shot 2] At 00:03.500, the camera cuts to ...
overall_soundscape: <环境声/动作声/非语言人声>
non_diegetic_music: N/A
```

**六段式**（带任何参考图，r2v）：`subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music`。

- 首镜不写时间码；后续 `At 00:03.500,` 严格递增。
- 台词：`(S1)` 说话人 + `<d>[Chinese] 逐字台词。</d>`；身份/音色/语速写在 `<d>` **外**。
- 保留强度：`fully_preserved / partially_preserved / attribute_transfer / weak_reference`。
- 提示词上限约 **7000 字符**。

完整语法（标签、运镜词表、音频三层、多镜容器）见 `references/h3-prompt-spec.md`。

### 1.2 时长与分辨率

帧数按 **17k+5** 吸附：3s→73f、4s→107f、5s→124f(5.17s)、8s→192f、10s→243f(10.13s)、15s→362f(15.08s)。
**排时间线用实际秒**，别用你填的整数秒。原生 1344×768，边长 32 倍数；0.4MP 打样、0.7–1.0MP 定稿。

### 1.3 不要写负面词

cfg=1，没有负面分支。`no subtitles / no text / not photorealistic` 会**诱发**它否定的东西（实测二维街景照样长出乱码招牌）。
**正向描述 + 后期处理**。唯一例外见字幕章节（可试一句否定，但不指望）。

### 1.4 画风：文生默认滑向真人

二维漫剧**每个 `[Shot N]` 都要重申介质**：`2D hand-drawn anime, cel shading, not live-action, not photographed`。
三维 CG 更顽固，最好挂一张已定的起始帧走 i2v。

### 1.5 说话人与音色

- 一镜一人说话；同框必须写 `Only <Subject 1> moves his lips; <Subject 2>'s lips remain completely closed.`
- **同性别多说话人必须拉开音色**：实测两个女声（`low, level` vs `calm, slow`）F0 只差 ~47Hz、听感分不开。要同时拉**音区 + 年龄 + 质感**（`low, husky, middle-aged` vs `high, clear, young, metallic`），否则改 TTS/克隆。

---

## 2. 通用镜头工艺（三类产线共用）

### 2.1 台词与站位

一句台词四件套：`<身份与音色> (S1)，<画内/画外>，<动作句>，says: <d>[Chinese] 台词。</d>`

- 双人默认正反打：左右 + 朝向 + 距离写死。
- 三人三角形：左前景背影、中景说话人、右背景听众。
- 字数：4s≈8–10 字、5s≈12–14、6s≈16–18、8s≈24–26、15s≈50–55（4.1 字/秒，扣 1.6s 开口延迟）。

详见 `references/dialogue-blocking.md`。

### 2.2 运镜、切镜、转场

- **一镜一个主运镜**，写因果不写方向（`He drives her back and the camera gives ground`）。
- 速度至少三档；全片 `fast` = 没节奏；**最大的一击相机反而锁死**。
- 只切"带来新信息"的；相邻镜景别至少跳一级；动作接动作（终点=起点）；锁轴线。
- 硬切不加淡化；要连续用尾帧接力；**穿入**是科普核心转场（入口填满画面再穿出）。

详见 `references/camera-and-transitions.md`。

### 2.3 武打与高动态

三种节奏只能选一种：六拍（4–5 镜/8s）、连续对轰（9–10 镜）、ULTRA_SPEED（10–14 镜）。
每镜五小节 Camera/Motion/Performance/Light/Sound；**Motion 写"哪只脚承重"**——最便宜的打擊感。
**速度是密度不是形容词**；冲击帧写 2 帧会给 21–23 帧，要精确走后期。

详见 `references/action-dynamics.md`。

### 2.4 长片连续性（>15s 绕不开）

**Hub 还是 Chain，是最重要的决策**：

| | Chain | Hub |
|---|---|---|
| 误差 | **累积**（实测 3 跳 −8.6% 亮度、vs 锚点 13.1dB） | **不累积**（−2.5，永远 1 跳） |
| 适合 | 追逐、打斗、一镜到底 | **对话、对峙、议事** |

- 四种接法：续接（连 PNG 不连 latent）/ 硬切（别加淡化）/ 新场 / 桥接。
- 亮度漂移逐段对齐，别"链完统一拉亮"（段内自己还会回弹 ±4）。
- 系列化先写 `bible.md`，锁短语逐字照抄。

详见 `references/longform-continuity.md`。

### 2.5 换脸 / 重演

五条路线，先按"有没有 guide 能力"分：

- **有自建 ComfyUI** → **Character Swap LoRA**（原片进 AddGuide frame 0 + 角色图 + `body_swap`，动作严格跟原片）。
- **只有托管 API / 没有 guide** → **首帧重建法**：图像编辑生成"新人+原布景"的静帧 → 图生视频**重演**。这是平台爆款（rapper swap、世界巡演）的主流做法，不需要原片视频。

爆款做法的五个细节：左右分别点名、`input_fidelity=high` 保脸、**先裁成目标画幅再动画**（不然出信箱边）、表演提示词点名谁先动、机位越稳越保脸。

**合规**：真人换脸需授权并标 AI；Seedance 明确拒绝含真人的参考素材，H3 接受首帧但不等于可以乱用。详见 `references/face-swap.md`（含 §12 首帧重建法）。

### 2.6 T8 高级管线

- **U22 9图3音**：满参考，治跨镜变脸/变声。
- **U24 文武双修**：混合底模（fl2va+ref2va）+ LoRA 栈（质感/Combat/Motion_Repair）+ 两遍采样。

详见 `references/t8-pipelines.md`。

---

## 3. 漫剧产线

| 项 | 建议 |
|---|---|
| 画幅 | 9:16，交付 1080×1920 |
| 集长 | 90–180s（抖音）/ 3–5min（B站） |
| 镜长/镜数 | 2–5s；每分钟 12–20 镜 |
| 前 3 秒 | 冲突/异常，不交代背景 |
| 每 15 秒 | 一个小反转或信息增量 |
| 集尾 | 一句钩子 + 黑场，不总结 |

**角色锁定**：三视图 + 面部识别板（近景必挂）+ 固定参考顺序（起始帧→脸→场景→道具）+ 连续性锁短语。
**实测**：参考图里没有的特征 H3 不会补；写 `eyes on each other` 仍会看镜头——**视线要画进起始帧**。

**静态 vs 动态**：静态漫（关键帧 + 100%→106% 缓推）是默认；动态只给 5–8 个关键镜，每镜只允许一个主要变化。
**文字默认后期叠**（气泡、拟声字、章节卡、字幕）；只有字卡/歌词这类"文字本身是设计"的才原生渲染，见 §5.3。

详见 `references/manju-playbook.md`；生图（三视图/洗图/放大）见 `references/image-pipelines.md`。

---

## 4. 科普产线（外星人 + 地球人）

**骨架**：钩子 → 赌约 → 第 N 天时间线 → 钻进比喻空间 → 求饶兑现 → 揭晓代价 → 下期赌约。

**核心手艺**：把数字变成能进去的房间——
`现实物件（冰箱灯/杠铃孔/秤盘/瞳孔）→ 推进穿过 → 荒诞空间（控制室/仓库/银行/工地）→ 可读仪表 → 数字变化`。
转场必须是**连续镜头**：推进 → 亮/暗一下 → 穿出已在 Y 空间，中间不切黑。

**预算**：14–15s 一段、3–4 镜、中文台词 ≤55–60 字；一段一个知识点。
**调度**：正反打一人一镜；外星人报数据用画外音；同框定场每段一次就够。

**合规**：每个数字有出处（作者/期刊/样本量），查不到不写；健康类不给治疗建议。

详见 `references/science-playbook.md`。

---

## 5. 声音

### 5.1 三条路线

| 路线 | 用在 | 代价 |
|---|---|---|
| **原生口播** | 情绪对白、吵架、哭戏 | 情绪最好，但一镜一句、≤14 字、跨段音色锁不住 |
| TTS | 旁白、数字/术语、情绪平 | 贴不上表演节奏（实测：情绪戏对不上） |
| **克隆 + 对口型** | 跨集同音色、给定音频 | 多一道工序，但最可控 |

口播情绪写法（强表演短语、短窗+无声尾动作、微表情节拍）见 `references/native-dialogue.md`。
克隆/对口型/长口播见 `references/talking-head.md`。

### 5.2 BGM

**H3 输出一条混好的音轨，没有 stems**——"保留对白只换音乐"做不到；而且它会自己加音乐（省略 `non_diegetic_music` 就补）。

- 多镜 >15s：**外挂独立音乐轨**（5–15s 出不来音乐弧线）。
- 要它别出音乐：显式 `non_diegetic_music: N/A`。
- 后期顺序：先 −16 LUFS → 再铺音乐 → 最后限幅；音乐比对白低 12–18dB，用 sidechain 闪避。

详见 `references/bgm.md`。

### 5.3 字幕

**H3 能画字幕，但那是像素不是轨**；改字要重渲。它会自己加字幕（韩语几乎必带），没有开关。

- 对白字幕 → **后期烧**（默认）；字卡/歌词/UI → 可原生。
- 品牌名、数字、外文 **一律后期**。
- 烧之前 `qa.py --textcheck` 看底部横条，别叠两层。

详见 `references/subtitles.md`。

---

## 6. 后期与交付

```bash
python scripts/finish.py --out final.mp4 --clips clips/*.mp4 \
    --aspect 9:16 --subs-from EP01/分镜.json --music bgm.mp3 --poster --sheet
```

统一画幅 → 合片 → 两遍 loudnorm（−16 LUFS）→ 自动字幕（按 17k+5）→ BGM 闪避 → faststart → 封面/分镜图。
中间文件落 `./.finish`，不碰 TEMP。

- `qa.py`：分辨率/帧率/响度/真峰值/冻结/黑场/场景切换数（`cuts` 应等于镜数−1）。
- `seam.py`：离线量接缝（≥33 续接 / 25–33 可接受 / <25 硬切；能检出复读和亮度跳变）。

交付规范（安全区、封面尺寸、合规）见 `references/delivery-and-qa.md`。

---

## 7. 成本与吞吐

| 动作 | 量级 |
|---|---|
| 0.4MP turbo 5s | 1–3 分钟 |
| 1.0MP 满步 10s | 6–15 分钟 |
| 一集 40 镜全动态 | 2–5 小时 GPU |
| 一集静态为主 | 0（只出图）+ 剪辑 |
| TTS 60 句 | 3–6 分钟 |

**先静态后动态**：整集用关键帧+配音剪一版，确认节奏再挑 5–8 镜做动态。返工最省。

---

## 8. 故障排查

| 现象 | 处理 |
|---|---|
| 模型名 400（缺 `minimax/` 前缀） | workflow 里写全路径 |
| `h3_post` 全 −13（插件） | TEMP 不可写；用 `finish.py` |
| `h3_generate` 报错但任务已提交（插件） | 先查 run/queue，别连续重试 |
| `comfy.py validate` 报缺节点 | 装对应自定义节点包（T8/Licon/KJ/rgthree） |
| r2v 缺 turbo LoRA | 装 `minimax_h3_ref2v_turbo_4step_v0.1` |
| 插件状态一直 `queued` | 以 output 文件为准 |
| 加了风格 LoRA 脸变了 | 降到 0.4 或去掉 |
| 打斗发软 | 加 `Motion_Repair` 0.2–0.7 |
| 成片削波 | `qa.py` 查峰值，先限幅再铺音乐 |

LoRA 用法与强度见 `references/lora-catalog.md`。

---

## 9. 资产索引

**类型地图**：`references/genres.md`（漫剧/换脸/科普/口播/亲情向/动作迁移/MV/四宫格/动物拟人）

**开头与钩子**：`references/hooks.md`（十种钩子句式、口播节奏、A/B 测试、失败清单）

**语法与工艺**：`references/h3-prompt-spec.md` / `references/dialogue-blocking.md` / `references/camera-and-transitions.md` / `references/action-dynamics.md` / `references/longform-continuity.md`

**三条产线**：`references/manju-playbook.md` / `references/science-playbook.md` / `references/face-swap.md` / `references/image-pipelines.md` / `references/templates.md`（可复制模板）

**功能**：`references/t8-pipelines.md` / `references/native-dialogue.md` / `references/talking-head.md` / `references/bgm.md` / `references/subtitles.md`

**生态**：`references/workflow-catalog.md`（35 套编目，其中 22 套随包）/ `references/alt-video-models.md`（Wan/LTX）/ `references/lora-catalog.md`

**模型权重**：`references/models.md`（54 个依赖、31 个可自动下载、`workflows/fetch-models.sh`、校验与许可）

**交付**：`references/delivery-and-qa.md` / `references/validation.md`（实测记录）

**脚本**：`comfy.py`（直连）/ `scaffold.py` / `check.py` / `finish.py` / `qa.py` / `seam.py`

**工作流**：`references/workflows/h3|image|video/`（22 套，API 格式，见该目录 README）

---

## 10. 验证摘要

| 结论 | 证据 |
|---|---|
| 二维画风守得住 | V1/V1b 赛璐璐未滑向实拍；大幅度运镜可见 |
| 三人站位成立 | V2 三角站位 + 单人特写切换正确 |
| 打斗有打击感但收尾会丢人 | V3 对手末两镜消失；补一镜对峙解决 |
| **Hub 不累积、Chain 累积** | 3 跳 −8.6% 亮度、vs 锚点 13.1dB；Hub 恒 1 跳 |
| 原生音轨偏爆 | V2 −10.2 LUFS / +1.2 dBTP |
| 同性别音色分不开 | 女 212Hz vs 外星人 165Hz，人耳无差 |
| 换脸 API 可行 | 原片→外星人，场景/动作保留 |

完整数据与"未验证清单"见 `references/validation.md`。
