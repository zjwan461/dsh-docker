# 工作流资产（随 skill 分发，用相对路径引用）

全部是 ComfyUI **API 格式**（`{"prompt": {...}}`），用 `scripts/comfy.py` 直接提交，**不依赖任何插件工具**，也不依赖某台机器的绝对路径。

## 目录

```
workflows/
├── h3/       MiniMax H3（本 skill 主线）
├── image/    生图 / 编辑（静帧、三视图、洗图）
├── video/    Wan / LTX / 对口型 / 声音克隆
└── audio/    独立音频产物（MiniMax Music 3 配乐）
```

### h3/

| 文件 | 用途 |
|---|---|
| `h3_t2v_api.json` | 官方 T2V（文生视频），14 节点，已校验 |
| `h3_i2v_api.json` | 官方 I2V（图生视频，可加尾帧做 FL2VA） |
| `h3_r2v_api.json` | 官方 R2V（参考生视频） |
| `U00-提示词LLM扩写.json` | 本地 LLM 看多图写 H3 提示词 |
| `U06V9-9图3音.json` | 9 图 + 3 音满参考 |
| `U11-图音对口型.json` | **图 + 音频 → 对口型视频** |
| `U17-9图1视频3音频.json` | 加参考视频（运动参考） |
| `U22-9图3音.json` | 多角色 + 多音色 |
| `U24-文武双修T8版.json` | 混合底模 + LoRA 栈 + 两遍采样 |
| `U30-三段采样与AV分离.json` | 三段采样 + AV latent 分离 + 3D 放大 |
| `U32-Sigma精修与动作修复.json` | Sigma 精修 + Motion_Repair |
| `U33-H3口播音频T8.json` | **H3 Speech Studio：音频-only 口播 → 独立 speech FLAC** |

### image/

| 文件 | 用途 |
|---|---|
| `A01-Qwen2512文生图放大.json` | Qwen-Image-2512 + Lightning + SeedVR2 放大 |
| `A08-二次元转真人.json` | AnythingtoRealCharacters，动漫脸转写实 |
| `A08b-Krea2二次元转真人.json` | **Krea2 版洗图**：`Krea2_Anything2RealCharacters-V3` 0.9 + img2img(0.75) + SeedVR2，20 秒出 2048 真人 |
| `B13-角色多角度.json` | Qwen-Image-Edit 多角度并行（三视图/多机位） |
| `C19-三视图zimage双采.json` | Z-Image + 本地 LLM 扩写 + 双采 |
| `T4-Krea2三视图.json` | Krea2 角色三视图 |
| `E1-首帧重建-Qwen编辑.json` | **换脸路线 E 第一步**：人像+原布景 → 新首帧（Qwen-Image-Edit 2509） |

### video/

| 文件 | 用途 |
|---|---|
| `G02-Wan首尾帧.json` | Wan2.2 首尾帧硬约束 |
| `P02-WanAnimate动作迁移.json` | 真人动作迁移 / 角色替换 |
| `H41-LTX-MSR多参考.json` | LTX 2.3 多主体参考（2–5 张） |
| `Y08-LTX四宫格.json` | LTX 四宫格分镜 |
| `J13-InfiniteTalk长口播.json` | 90 秒级长口播（分段续接） |
| `N2-FishAudio声音克隆.json` | 参考音 → 克隆 TTS |

### audio/

| 文件 | 用途 |
|---|---|
| `M1-MiniMaxMusic3配乐.json` | **MiniMax Music 3 文本→配乐 → 独立 BGM FLAC** |

> `h3_*_api.json` 是**官方模板的节点图**转成的 API 格式；`U*` / `A*` / `B*` / `C*` / `T*` / `G*` / `P*` / `H*` / `Y*` / `J*` / `N*` 是社区工作流原件（保留原节点与默认参数）。社区工作流依赖各自的自定义节点（T8 / Licon / KJ / rgthree / llama_cpp 等），缺节点时会报红——提交前先 `validate`。
>
> **`validate` 只是"名字和类都对得上"，不是验收**：它不校验 combo 值（模型名）和必填项，会把错的判成 OK。真正判据是提交一次——报 `value_not_in_list` 才算摸到真问题。
>
> **三套有"跑之前先看一眼"的前置条件**：`E1` 的场景参考图必须空棚（带人会出两个人）；`J13` 的三个加载器各认一个固定目录（`audio_encoders` / `model_patches` / `diffusion_models`）；`N2` 首次跑要自己下 11GB 的 `s2-pro`。细节见 `references/talking-head.md` 与 `references/face-swap.md` §12。

## 场景 → 工作流 速查

**先按场景挑，再看上面各表的"用途/前置"。** 口播不绑定 i2v：锁人锁声用 r2v，精确续接构图用 i2v（`manju-playbook.md` §5.5）。

| 场景 | 用哪个 | 备注 / 前置 |
|---|---|---|
| 无参考文生视频（空镜/概念/打样） | `h3/h3_t2v_api.json` | 最简；画风靠提示词重申 |
| 已有设计好的起始帧，要精确开场/续接 | `h3/h3_i2v_api.json` | 钉首帧；Hub 锚点/动作接动作 |
| 跨镜锁身份/锁音色、多参考、**原生口播** | `h3/h3_r2v_api.json` | 不钉首帧；脸板+造型板+场景；台词 8 步 |
| 让本地 LLM 看多图自动写 H3 提示词 | `h3/U00-提示词LLM扩写.json` | 需 llama_cpp 节点 |
| 满参考顶配（9 图 + 3 音） | `h3/U06V9-9图3音.json` | T8；多角色多音色 |
| **给定音频对口型**（配音/口播/歌） | `h3/U11-图音对口型.json` | r2v+ref_audios；已验证 |
| 加参考视频做运动参考 | `h3/U17-9图1视频3音频.json` | 运动迁移 |
| 多角色 + 多音色（T8） | `h3/U22-9图3音.json` | 治跨镜变脸/变声 |
| 对白 + 打戏 + 两遍高清（T8 文武） | `h3/U24-文武双修T8版.json` | 混合底模+LoRA 栈 |
| 三段采样 + AV 分离 + 3D 放大 | `h3/U30-三段采样与AV分离.json` | 高清精修 |
| 打斗发软/漂 → Sigma 精修+动作修复 | `h3/U32-Sigma精修与动作修复.json` | Motion_Repair |
| 文生静帧 + 放大（锚点/场景/封面） | `image/A01-Qwen2512文生图放大.json` | Lightning 4step+SeedVR2 |
| 动漫脸转写实（洗图） | `image/A08-二次元转真人.json` / `image/A08b-Krea2二次元转真人.json` | A08b 更快（~20s/2048） |
| 角色三视图 / 多机位 | `image/B13-角色多角度.json` / `image/C19-三视图zimage双采.json` / `image/T4-Krea2三视图.json` | B13 多角度并行；C19 双采；T4 Krea2 |
| **换脸路线 E**：人像+原布景→新首帧 | `image/E1-首帧重建-Qwen编辑.json` | 场景图必须空棚；接 h3_i2v |
| 承接上一镜 / 必须落到某构图 | `video/G02-Wan首尾帧.json` | 首尾帧硬约束 |
| 真人动作搬到角色 | `video/P02-WanAnimate动作迁移.json` | 全身+干净背景 |
| 2–5 主体同时保身份 | `video/H41-LTX-MSR多参考.json` | LTX MSR |
| 四宫格分镜预览 | `video/Y08-LTX四宫格.json` | 一屏四格 |
| >15s 长口播要对嘴 | `video/J13-InfiniteTalk长口播.json` | 分段续接；三个固定目录 |
| 克隆音色做 TTS（跨集同声） | `video/N2-FishAudio声音克隆.json` | 首次下 11GB s2-pro |
| **可控音色口播/旁白、不出视频**（speech stem） | `h3/U33-H3口播音频T8.json` | T8 Speech Studio；情绪未校准、中文逐条听 |
| **本地 AI 配乐、可反复换**（BGM stem） | `audio/M1-MiniMaxMusic3配乐.json` | Music3 三件权重 ~12GB；cfg1.5/40步 |

**三条快速决策**：

```
要"对嘴/给定音频"？ → U11（短）/ J13（长）；音色先 N2 克隆
要"锁多个角色/音色"？ → r2v / U22 / U06V9；要"精确续接构图"？ → i2v / G02
只是要静帧/三视图/洗图？ → image/（A01/B13/C19/T4/A08），别烧视频 GPU
要"独立 speech / 可换 BGM"？ → U33（speech stem）+ M1（BGM stem），后期混音
```

> 换脸路线 B（Character Swap LoRA 严格跟原片）的工作流在 `references/character-swap-api.json`（不在本目录）；路线 E 用本目录 `E1`+`h3_i2v`。详见 `references/face-swap.md`。
> 图形/字卡/片头/数据动效不走这里，走兄弟 skill `motion-showreel`。
> 能力级选型（含未随包的 35 套编目）见 `references/workflow-catalog.md` §6。

## 用法

```bash
B=http://<真实ComfyUI地址>:<端口>
S=references/workflows

# 0) 只读校验（不提交、不占 GPU）
python scripts/comfy.py --base $B validate --workflow $S/h3/h3_t2v_api.json

# 1) 要挂图的先上传
python scripts/comfy.py --base $B upload --file my.png --subfolder proj

# 2) 提交（打印 prompt_id）
python scripts/comfy.py --base $B submit --workflow $S/h3/h3_t2v_api.json

# 3) 等待 + 下载
python scripts/comfy.py --base $B wait --id <PID> --timeout 900
python scripts/comfy.py --base $B download --id <PID> --out out/
```

## 提交前改什么

| 字段 | 位置 | 说明 |
|---|---|---|
| `prompt` | `5.inputs.prompt`（h3_*_api） | 三段/六段式提示词 |
| `width`/`height`/`length` | `5.inputs` | 32 倍数；`length` 用 17k+5（5s=124、3s=73） |
| `image` | `16.inputs.image`（i2v/r2v 模板） | 占位是 `zealman-blank-image.png`，换成自己上传的文件名 |
| `filename_prefix` | `14.inputs` | 输出名 |
| `noise_seed` | `9.inputs` | 换种子 |
| turbo | 加 `LoraLoaderModelOnly`（`minimax/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`, strength 1.0）并把 `8.steps` 改 8 | 快 2–3 倍，细节略降 |

## 已知约束

- 模型路径必须带 `minimax/` 前缀（服务器上的实际子目录）。
- `SaveVideo.format="auto"`；`CreateVideo.fps=24`。
- r2v 的参考图是**列表**：`"ref_images": [["16", 0]]`（不是 `ref_image_0`）。
- **音频解码用 `VAEDecodeAudio`**，不是 `VAEDecode`（后者出 IMAGE，接 `CreateVideo.audio` 报类型不匹配）。
- 上传后的文件名带序号（`x.png` → `x_00001_.png`），`LoadImage` 要写带序号全名。
- 官方模板默认 20 步、无 LoRA；turbo 是可选项，不是默认。
- 社区工作流的模型名可能与你的服务器不同，先 `validate` 再提交。
