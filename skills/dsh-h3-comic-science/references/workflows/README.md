# 工作流资产（API 格式，可直接提交）

全部是 ComfyUI **API 格式**（`{"prompt": {...}}`），用 `scripts/comfy.py` 直接提交，**不依赖任何插件工具**。

## 文件

| 文件 | 对应 | 说明 |
|---|---|---|
| `h3_t2v_api.json` | 官方 T2V 模板 | `MiniMaxH3ImageToVideo` 不接首帧 = 文生视频；14 节点 |
| `h3_i2v_api.json` | 官方 I2V 模板 | 同节点接 `first_frame`（可加 `last_frame` 做 FL2VA） |
| `h3_r2v_api.json` | 官方 R2V 模板 | `MiniMaxH3ReferenceToVideo` + `ref_images` 列表，参考生视频 |
| `character-swap-api.json` | Character Swap LoRA | 换脸/人物替换（AddGuide + body_swap） |
| `U22-9图3音.json` | T8 工作流 | 9 图 + 3 音满参考（原样保存，节点依赖 T8） |
| `U24-文武双修T8版.json` | T8 工作流 | 混合底模 + LoRA 栈 + 两遍采样（原样保存） |

> 官方三套是**官方模板的节点图**（ImageToVideo / ReferenceToVideo + `SamplerCustomAdvanced` 链路）转成的 API 格式；
> `U22/U24` 是用户提供的原始 T8 工作流，保持原样，依赖 T8 自定义节点。

## 用法

```bash
B=http://<真实ComfyUI地址>:<端口>

# 0) 只读校验（不提交、不占 GPU）
python scripts/comfy.py --base $B validate --workflow references/workflows/h3_t2v_api.json

# 1) 要挂图的先上传
python scripts/comfy.py --base $B upload --file my.png --subfolder proj

# 2) 提交（打印 prompt_id）
python scripts/comfy.py --base $B submit --workflow references/workflows/h3_t2v_api.json

# 3) 等待 + 下载
python scripts/comfy.py --base $B wait --id <PID> --timeout 900
python scripts/comfy.py --base $B download --id <PID> --out out/
```

## 提交前改什么

| 字段 | 位置 | 说明 |
|---|---|---|
| `prompt` | `5.inputs.prompt` | 三段/六段式提示词 |
| `width`/`height`/`length` | `5.inputs` | 32 倍数；`length` 用 17k+5（5s=124、3s=73） |
| `image` | `16.inputs.image` | 占位是 `zealman-blank-image.png`，换成自己上传的文件名 |
| `filename_prefix` | `14.inputs` | 输出名 |
| `noise_seed` | `9.inputs` | 换种子 |
| turbo | 加 `LoraLoaderModelOnly`（`minimax/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`, strength 1.0）并把 `8.steps` 改 8 | 快 2–3 倍，细节略降 |

## 已知约束

- 模型路径必须带 `minimax/` 前缀（服务器上的实际子目录）。
- `SaveVideo.format="auto"`；`CreateVideo.fps=24`。
- r2v 的参考图是**列表**：`"ref_images": [["16", 0]]`（不是 `ref_image_0`）。
- 官方模板默认 20 步、无 LoRA；turbo 是可选项，不是默认。
