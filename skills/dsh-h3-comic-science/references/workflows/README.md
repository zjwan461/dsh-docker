# 工作流资产（随 skill 分发，用相对路径引用）

全部是 ComfyUI **API 格式**（`{"prompt": {...}}`），用 `scripts/comfy.py` 直接提交，**不依赖任何插件工具**，也不依赖某台机器的绝对路径。

## 目录

```
workflows/
├── h3/       MiniMax H3（本 skill 主线）
├── image/    生图 / 编辑（静帧、三视图、洗图）
└── video/    Wan / LTX / 对口型 / 声音克隆
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

### image/

| 文件 | 用途 |
|---|---|
| `A01-Qwen2512文生图放大.json` | Qwen-Image-2512 + Lightning + SeedVR2 放大 |
| `A08-二次元转真人.json` | AnythingtoRealCharacters，动漫脸转写实 |
| `B13-角色多角度.json` | Qwen-Image-Edit 多角度并行（三视图/多机位） |
| `C19-三视图zimage双采.json` | Z-Image + 本地 LLM 扩写 + 双采 |
| `T4-Krea2三视图.json` | Krea2 角色三视图 |

### video/

| 文件 | 用途 |
|---|---|
| `G02-Wan首尾帧.json` | Wan2.2 首尾帧硬约束 |
| `P02-WanAnimate动作迁移.json` | 真人动作迁移 / 角色替换 |
| `H41-LTX-MSR多参考.json` | LTX 2.3 多主体参考（2–5 张） |
| `Y08-LTX四宫格.json` | LTX 四宫格分镜 |
| `J13-InfiniteTalk长口播.json` | 90 秒级长口播（分段续接） |
| `N2-FishAudio声音克隆.json` | 参考音 → 克隆 TTS |

> `h3_*_api.json` 是**官方模板的节点图**转成的 API 格式；`U*` / `A*` / `B*` / `C*` / `T*` / `G*` / `P*` / `H*` / `Y*` / `J*` / `N*` 是社区工作流原件（保留原节点与默认参数）。社区工作流依赖各自的自定义节点（T8 / Licon / KJ / rgthree / llama_cpp 等），缺节点时会报红——提交前先 `validate`。

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
- 官方模板默认 20 步、无 LoRA；turbo 是可选项，不是默认。
- 社区工作流的模型名可能与你的服务器不同，先 `validate` 再提交。
