# 模型依赖与下载

工作流搬进 skill 了，模型没有——**空有 JSON 跑不起来**。这一份解决"换台机器怎么把权重补齐"。

---

## 1. 一键下载

```bash
# 在 ComfyUI 根目录执行（脚本会把文件放进 models/<类别>/）
COMFY_ROOT=/root/ComfyUI bash references/workflows/fetch-models.sh

# 限速 20M、跳过已存在的文件（默认就是）
RATE=20M COMFY_ROOT=/path/to/ComfyUI bash references/workflows/fetch-models.sh
```

脚本行为：

- 只下**缺失**的（`[ -f "$DEST" ]` 跳过）；
- **有 sha256 的会自动校验**（manifest 里 `sha256` 字段；目前 2 个，其余可自行补），不符会喊 `HASH MISMATCH`；
- `curl -L --fail --retry 3 -C - --limit-rate "$RATE"`：断点续传、限速、失败不中断；
- 保留工作流里写的子目录（`minimax/xxx`、`Ltx/xxx`），因为服务器就是这么放的；
- 目标目录由节点类型决定：`unet_name→diffusion_models`、`clip_name→text_encoders`、`vae_name→vae`、`lora_name→loras`、`ckpt_name→checkpoints`。

**先看清单再下**：

```bash
python scripts/models.py scan     # 54 个依赖文件，含"被哪个工作流用到"
```

---

## 2. 覆盖情况（54 个文件）

| 状态 | 数量 | 说明 |
|---|---|---|
| 自动解析 | **31** | 官方仓库 + 可查到的社区仓库，脚本里已有 URL |
| 需手工 | 23 | 中文社区 LoRA（哩布/Civitai 为主），HF 上没有稳定直链 |

自动解析覆盖了**跑通主线的全部必需项**：H3 三件套（unet/clip/vae/audio_vae）、官方 t2v/i2v/r2v、turbo 加速、换脸 LoRA、Qwen 2512/Edit-2509、Z-Image、Wan2.1、LTX VAE 与 text projection、gemma4。

需手工的 23 个（`models.py plan` 会列出来）主要是：`H3_Combat_V2`、`Motion_Repair`、`真实电影质感`、`MysticXXX`、`Kook_Qwen_*`、`AnythingtoRealCharacters`、`White_Marble AIO`、`Krea2`、`10Eros/Dasiwa` 等。它们大多是**风格/动作微调**，不是跑通必需——先跑主线，再按需补。

### 2.1 可选：r2v 口播 8 步 LoRA

做 **r2v 带台词**（口播/对口型）需要 8 步 r2v turbo，它不在 54 个扫描依赖里（没有随包工作流引用），手动下：

```bash
cd /path/to/ComfyUI/models/loras
curl -L --fail --retry 3 -C - --limit-rate 20M \
  -o minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors \
  'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors?download=true'
```

无台词的 r2v 才用 4 步（`ref2v_turbo_4step_v0.1`，已在自动解析里）。

---

## 3. 来源表怎么维护

`references/model-sources.json`：

```json
{
  "explicit": {
    "文件名.safetensors": {"repo": "Comfy-Org/MiniMax-H3", "path": "diffusion_models/文件名.safetensors"},
    "另一个.safetensors": {"url": "https://huggingface.co/.../resolve/main/...?download=true"}
  },
  "candidates": ["Comfy-Org/MiniMax-H3", "Kijai/LTX2.3_comfy", "..."],
  "hints": {"某个社区LoRA.safetensors": "去哪搜、搜什么"}
}
```

- `explicit` 优先；支持 `repo+path` 或完整 `url`。
- 没收录的，按 `candidates` 顺序去 HF 仓库树里**按文件名匹配**（自动）。
- 还找不到就落到 `hints`，打印人话提示。

补新模型 = 往 `explicit` 加一行；重跑 `python scripts/models.py plan` 即可重新生成脚本。

---

## 4. 国内网络

脚本用的是 HuggingFace 官方 `resolve` 地址。国内慢可以自行把域名换成镜像（**这是你的选择，脚本不替你换**）：

```bash
RATE=20M bash references/workflows/fetch-models.sh          # 先按原速试
# 或者手工替换：把脚本里的 huggingface.co 改成 hf-mirror.com
```

`hf-mirror.com` 路径规则与 HF 一致，`resolve/main/...` 不用改。

---

## 5. 校验与磁盘

- 每个文件下完建议 `sha256sum` 对一次；HF 的 sha256 在文件页 `X-Linked-Etag` 里。
- 磁盘粗估：**H3 主线（unet×2 + 文本编码器 + 双 VAE + turbo/换脸 LoRA）约 70GB**；再加 Qwen/Z-Image/Wan/LTX 全家桶再翻一倍。**先只下主线**。
- 不要用同名不同版本互相覆盖（例如 `fl2v_turbo_4step_v1.0` 与 `v1.2`）——工作流里写死了版本。

---

## 6. 许可

- H3 权重是 **MiniMax H3 Community License**（排除美/欧/英/韩），商用前看清条款。
- 换脸 LoRA 是 **BFS Character Swap License**（禁托管 API/SaaS，年营收 >$1M 需署名）。
- Qwen / Wan / LTX / Z-Image 各有自己的许可；商用逐一看。
- 社区 LoRA（哩布/Civitai）多为"非商用/署名"类，**别默认能商用**。

---

## 7. 排错

| 现象 | 处理 |
|---|---|
| `401 Unauthorized` | 仓库是 gated：`huggingface-cli login` 或用镜像 |
| 下载到一半断 | 重跑同一条命令，`-C -` 会续传 |
| 文件在但模型仍报错 | 多半是**版本不对**（v1.0 vs v1.2）或放了子目录但工作流写的是根目录 |
| `models.py plan` 很慢 | 它在按文件名扫 HF 仓库树；用 `--offline` 只走内置映射 |
| 想只下某个工作流的依赖 | `scan` 看 `used_by`，手工挑 URL |
