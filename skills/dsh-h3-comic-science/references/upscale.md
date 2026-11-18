# 视频超分（SeedVR2）

**结论先说**：你盘上已有的 **SeedVR2 3B** 就是现成的通用视频超分，**零下载**。它做的事是"把糊的画面重新长出细节"，不是"改成另一个画面"——构图、手势、多出来的一只手，它一概不管。

实测环境：单卡 32G，DiT 用 fp8（3.2GB），batch 5，2026-11。**这是该配置下的数字，换卡会变**。

---

## 1. 三条路，只有一条是"真超分"

| 路线 | 状态 | 说明 |
|---|---|---|
| **SeedVR2 3B**（像素空间） | ✅ 现成 | `seedvr2_ema_3b_fp16` / `_fp8_e4m3fn` / `-Q4_K_M.gguf` + `ema_vae_fp16`；节点 `SeedVR2VideoUpscaler` |
| 潜空间二次上采样 | ⚠️ 只能"生成时顺带" | `h3_upscaler_lms_v0.1`、`MinimaxH3LatentUpscaler3D`、`ltx-2.3-spatial-upscaler-x2`。U17 用它把 124 帧放到 3840×2176（1346 秒）。**不能拿来处理已有视频** |
| ESRGAN / FlashVSR / Topaz | ❌ 用不了 | `upscale_models/` 只有 `h3_upscaler_lms_v0.1` 一个文件（`UpscaleModelLoader` 的 options 就一项），没有 RealESRGAN；FlashVSR 只有代码没权重；Topaz/HitPaw/Magnific/Recraft/WaveSpeed/ByteDance 都是云端 API 节点，没 key |

---

## 2. 实测成本（1080 短边 ≈ 3.3 秒/帧）

| 输入 | 输出 | 耗时 |
|---|---|---|
| 22 帧 512×288 | 1280×720 | **40 s** |
| 22 帧 512×288 | 1920×1080 | **75 s** |
| 107 帧 768×1344（4.46 s 竖屏） | 720×1260 | **155 s** |
| 107 帧 768×1344 | 1080×1890 | **350 s** |

换算：

- **一集 3 分钟（约 4300 帧）≈ 4 小时** → 它是"交付前整片过一遍"的量级，不是逐镜试错用的
- 竖屏 4.46 秒镜头：720 档 2.5 分钟、1080 档 6 分钟
- 只给特写镜头做 1080、广角走 720 或 lanczos，能省掉一半以上

**原音轨会带过去**：`VHS_LoadVideo` 的 `audio` 输出直接喂 `CreateVideo`，输出 mp4 里仍有原 AAC，不用二次合音。

---

## 3. 画质（量化过，不是"看起来更清楚"）

| | 拉普拉斯方差（细节，越高越好） | 帧间抖动（闪烁，越低越稳） |
|---|---|---|
| 源 512×288 | 1276.2 | 17.28 |
| lanczos → 720p | 68.8 | 17.20 |
| **SeedVR2 → 720p** | **261.0** | 17.91 |
| SeedVR2 → 1080p | 114.9 | 18.02 |

- 同尺寸下**细节是 lanczos 的 3.8 倍**（261.0 / 68.8）
- 帧间抖动只比原片高 **4%** → 没有引入逐帧闪烁。这是视频超分最容易翻车的地方，上表就是"它没翻"的证据
- 观感差异主要是：**8×8 压缩块被抹掉、边缘被重建、皮肤没被磨成塑料**（h264 源尤其明显）

测量脚本参考：抽 10–12 帧算拉普拉斯方差均值 + 相邻帧差的均值。不要只看单帧截图。

### 3.1 复测（2026-11-18，本 skill `episode.py sr` 实跑）

源：480×864 / 107 帧 / 3.04 s（U11 对口型成片）；`--short-edge 720` → **720×1296**，253 s，**48k 音轨完整带过**。

| | 拉普拉斯方差 | 帧间抖动 |
|---|---|---|
| 源 480×864 | 819.0 | 7.73 |
| **lanczos → 720×1296** | 222.7 | 7.71 |
| **SeedVR2 → 720×1296** | **911.7** | 7.58 |

- 同尺寸下细节是 lanczos 的 **4.09 倍**（`911.7 / 222.7`），比原文档的 3.8 倍还高一点
- 抖动 **−1.7%**（比源更低），确认没有引入逐帧闪烁
- **注意测法**：必须拿"lanczos 放大到同尺寸"当基线，不能拿源直接比——直接跟源比只有 1.11×，那是分辨率差异不是细节差异

**坑**：测量脚本别把中间帧写进系统临时目录——temp 目录可能不可写或空间不足，ffmpeg 会以 −13 失败。中间帧写到项目工作区内（或显式 `--workdir`），并保证与源同帧率。

---

## 4. 怎么跑

```bash
# 整段视频超分（保留原音轨）
python scripts/episode.py --base http://127.0.0.1:8188 sr \
    --video ep01/s1.mp4 --short-edge 1080 --out ep01/s1_1080.mp4

# 只给特写：720 档
python scripts/episode.py ... sr --video ep01/s3.mp4 --short-edge 720 --out ep01/s3_720.mp4
```

清单里也能用（`kind: "sr"`，`ref` 指向前面某个镜头）：

```json
{"id": "s3sr", "kind": "sr", "ref": "s3", "short_edge": 1080, "out": "s3_1080.mp4"}
```

图形（等价手搭）：

```
VHS_LoadVideo ──IMAGE──> SeedVR2VideoUpscaler ──IMAGE──> CreateVideo(fps) ──> SaveVideo
       └──────audio[slot 2]──────────────────────────────────┘
SeedVR2LoadDiTModel ─dit─┘
SeedVR2LoadVAEModel ─vae─┘
```

---

## 5. 参数

| 参数 | 取什么 | 说明 |
|---|---|---|
| `resolution` | 720 / 1080 | **短边**目标。填 1080 → 竖屏出 1080×1890 |
| `max_resolution` | 0 | 0 = 不限；显存紧就填个上限让长边截断 |
| `batch_size` | **4n+1**（5、9、13） | 填 6 会直接报错 |
| `uniform_batch_size` | True | 让最后一批补齐，减少接缝 |
| `temporal_overlap` | 2 | 批与批之间重叠帧数，压接缝闪烁 |
| `color_correction` | `lab` | 默认；偏色明显才换 `wavelet` |
| `blocks_to_swap` | **0** | fp8 只有 3.2GB，不用换出。**填 >0 必须同时把 DiT 的 `offload_device` 设 `cpu`**，否则报 `BlockSwap enabled (blocks_to_swap=32) but dit_offload_device is invalid` |
| DiT 权重 | 有 6.5GB 显存余量用 `fp16`，否则 `fp8` | `-Q4_K_M.gguf` 最省（1.9GB），细节略软 |

---

## 6. 三个坑

1. **`batch_size` 必须是 4n+1** —— 模型内部按 `4n+1` 的时序窗口做注意力，其它值直接抛错。
2. **`blocks_to_swap` 与 `offload_device` 是一对** —— 只改前者会报错；要么都关（0 + none），要么配对（32 + cpu）。
3. **长片别硬拼** —— 超过约 300 帧用 `SeedVR2TemporalChunk` / `SeedVR2TemporalMerge`（潜空间切块）或抬高 `temporal_overlap`；分段跑完再 concat 的话，**每段参数必须完全一致**，否则接缝处的锐度和色彩会对不上。

---

## 7. 什么时候别用

- **画面本身就是错的**（多一只手、构图崩了、人物发光）→ 超分只会把错的放大得更清楚。回 `episode-pipeline.md` 的构图闸。
- **源本身是 720p 以上的干净素材** → 直接 lanczos 就够，3 倍时间不值得。
- **要交付 4K 竖屏** → 先 SR 到 1080 再遇到"还得更大"的情况，优先回去用生成时的潜空间上采样（U17 路线），比二次像素超分干净。

---

## 8. 和整条流水线的关系

```
still / edit / crop  →  shot / pan  →  [sr]  →  finish.py（concat / 响度 / 字幕）
```

- `sr` 是**可选的一段**，放在合片之前、单条素材上做
- 做了 SR 的素材进 `finish.py` 时，把它自己的 `scale=1080:1920` 保留着（幂等，不会二次放大）
- 整集统一 SR 的话，先算时间：4300 帧 ≈ 4 小时，排产时要单独留一晚