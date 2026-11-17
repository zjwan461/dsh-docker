# 独立音频产物：H3 口播（speech）与 MiniMax Music 3（BGM）

**实测发现（2026-11-17，服务器任务历史）**：ComfyUI 里可以产出**独立的音频文件**——`*_speech_*.flac`（对白/口播）与 `*_bgm_*.flac`（配乐），不只是视频里那条混音。这修正了 `bgm.md` 的旧结论："没有分轨、只能外挂音乐"。

**准确表述**：
- 视频** baked **音轨仍是**一条混音**（对白+环境+音乐混在一起，无法事后分离）。
- 但**分轨可以"独立生成"得到**：speech 用 **H3 T8 Speech Studio**（音频-only），BGM 用 **MiniMax Music 3**（文本→音乐）。两者是独立资产，后期可自由混音、**保留对白只换音乐**。

> 来源：服务器真实工作流图 + [T8 Speech 验证报告](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/main/docs/SPEECH_VALIDATION_REPORT.md) + [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3)。

---

## 1. 两条产线一览

| | speech（对白/口播） | BGM（配乐） |
|---|---|---|
| 模型 | **H3 fl2va/ref2va**（复用视频权重） | **MiniMax Music 3**（独立音乐模型） |
| 节点 | `MiniMaxH3VoiceProfileT8 → SpeechPlanT8 → SpeechStudioT8 → SpeechDecodeT8 → SaveAudio` | `MiniMaxMusic3TextEncode → EmptyMiniMaxMusic3LatentAudio → KSampler → VAEDecodeAudio → SaveAudio` |
| 输入 | 音色描述/参考音 + 台词 + 表演方向 | 音乐 caption（乐器/空间/质感/情绪） |
| 输出 | 32kHz stereo FLAC，能量裁边 | FLAC，时长由 caption/seconds 定 |
| 采样 | 20 步 res_multistep/simple，低分辨率画布（32–128，只取音频） | 40 步 euler/simple，**cfg 1.5** |
| 工作流 | `workflows/h3/U33-H3口播音频T8.json` | `workflows/audio/M1-MiniMaxMusic3配乐.json` |
| 依赖 | T8 插件节点 + H3 三件套（已有） | Music3 三件权重 + Music3 节点 |

**关键**：speech 复用 H3 视频模型，但跑在**极小暗色画布**上、只解码音频——所以它是"H3 当 TTS 用"，不需要出视频，成本低于带视频的口播镜。

---

## 2. H3 Speech Studio（speech stem）

### 2.1 节点与参数

```text
VoiceProfileT8:  voice_mode=described_voice | reference_voice
                 speaker_id, voice_description, language, rights_confirmed,
                 reference_start_seconds, reference_duration_seconds,
                 highpass_60hz, peak_limit_minus_3_dbfs
SpeechPlanT8:    text, acting_direction, emotion, emotion_intensity,
                 space, chunking, target_units, max_units
SpeechStudioT8:  model/clip/video_vae/audio_vae, voice_profile, speech_plan,
                 segment_index, seed, render_seconds, resolution(32–128),
                 steps=20, sampler=res_multistep, scheduler=simple,
                 shift_video=12, shift_audio=3, trim_mode,
                 verify_mode=off, asr_model_directory, asr_language, min_similarity,
                 unload_asr_after_verify, speaker_check_mode=off,
                 speaker_model_directory, min_speaker_similarity,
                 unload_speaker_after_verify, peak_limit_dbfs=-1, release_policy
SpeechDecodeT8:  av_latent=[studio,3], audio_vae,
                 trim_mode=conservative_energy|auto_reference_voice|trim_exact_target|none,
                 energy_threshold_dbfs=-50, trim_padding_seconds=0.08
SaveAudio:       filename_prefix
```

> 必填项很多（verify/asr/speaker/release_policy 等），`U33` 模板已填全（verify/speaker 默认 off）。**改节点后先 `comfy.py validate`**——本次就是靠它抓出漏填的必填项。共用服务器 `release_policy` 用 `unload_all_models` 释放显存。

### 2.2 音色与表演写法

```text
voice_description: a Chinese man in his forties, low and slightly dry voice,
                   restrained and measured, almost no emotion, speaking slowly
                   and evenly as if reading a ledger aloud
acting_direction:  slow, level, uninflected delivery; place each clause and stop
emotion: calm   emotion_intensity: 0.15   space: studio
text: 二十八年，六个皇帝。
```

### 2.3 诚实边界（来自 T8 验证报告，**别过度承诺**）

- **emotion / intensity / pace / pitch / energy 是"未校准的方向提示"**，不是数值声学控制（单调性矩阵实测失败）。写 `emotion_intensity=0.15` 不保证可测量的"更平静"。
- **中文未稳定**：单样本 CER 7.14%，未达每语言 30 样本门槛。生成后**必须逐条听/ASR 核**。
- **reference_voice 有无关 lead-in**：裸 Ref2VA 输出常带几秒无关前导；用 `trim_exact_target`（fail-closed：找不到完整目标序列就不裁）或 `conservative_energy` 裁边。
- **说话人身份是初步信号**（WavLM genuine 0.95 vs impostor p95 0.89），**不是高保真克隆**；要跨集严格同音色仍优先 FishAudio 克隆（`talking-head.md`）。
- **joint 多说话人被明确否定**（会生成未请求的话）；多人对白用**独立 turn 生成 + 精确样本拼接**。
- **长段**：durable chunk manifest 可 resume（32s/4seg 机械通过），但 2/10min 的音色/频谱连续性**未测**；长口播仍优先 J13。
- **16GiB 显存不安全**（peak≈16.2G，余量仅 ~64–118MB）；用 `unload_all_models`，别 `keep_loaded`。
- 同 seed 同环境 PCM 可复现；final limiter 护峰值（≈−1dBFS）。

### 2.4 什么时候用 speech stem

- 要**可控音色描述**的旁白/对白、且不想出视频（省 GPU）。
- 要**保留对白、自由换 BGM**（speech 与 music 独立）。
- 情绪戏仍优先**视频原生口播**（表演+口型一体）；speech stem 没有口型，配画面需另对口型或只做画外。

---

## 3. MiniMax Music 3（BGM stem）

### 3.1 节点与参数

```text
UNETLoader:   minimax_music3_dit_int8_convrot.safetensors
CLIPLoader:   minimax_music3_text_encoder_pruned_int8_convrot.safetensors  type=minimax
VAELoader:    minimax_music3_dav.safetensors
MiniMaxMusic3TextEncode: caption（→ [cond, seconds]）, lyrics="",
                 seed, max_duration, cfg_scale=1.5, top_k=50
EmptyMiniMaxMusic3LatentAudio: seconds=[encode,1], batch_size=1
KSampler:     steps=40, cfg=1.5, euler, simple, denoise=1.0
VAEDecodeAudio → SaveAudio
```

### 3.2 caption 写法（具体到乐器/空间/质感）

```text
dark ambient score for a historical horror film, ancient Chinese instruments
recorded in a large empty stone hall: a single guqin harmonic struck and left
to decay, a low xun clay ocarina drone, a bowed bronze bell tone, distant
sub-bass rumble, tape hiss and room reverb
```

要点：**乐器 + 演奏法 + 空间 + 录音质感 + 情绪**；避免只写"epic cinematic music"（会落到通用预告片套路）。

### 3.3 模型与下载（int8 组合 ≈12GB）

| 文件 | 大小 | 目录 |
|---|---|---|
| `minimax_music3_dit_int8_convrot.safetensors` | 2.50 GB | diffusion_models |
| `minimax_music3_text_encoder_pruned_int8_convrot.safetensors` | 9.20 GB | text_encoders |
| `minimax_music3_dav.safetensors` | 0.22 GB | vae |

```bash
R=https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main
cd /path/to/ComfyUI/models
curl -L --fail --retry 3 -C - --limit-rate 20M -o diffusion_models/minimax_music3_dit_int8_convrot.safetensors "$R/diffusion_models/minimax_music3_dit_int8_convrot.safetensors?download=true"
curl -L --fail --retry 3 -C - --limit-rate 20M -o text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors "$R/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors?download=true"
curl -L --fail --retry 3 -C - --limit-rate 20M -o vae/minimax_music3_dav.safetensors "$R/vae/minimax_music3_dav.safetensors?download=true"
```

---

## 4. 混音：现在可以"保留对白只换音乐"

因为 speech 与 BGM 是**独立资产**：

```bash
# 对白轨 = speech stem（或视频提取的人声/克隆配音）；BGM = Music3 flac
python scripts/finish.py --out final.mp4 --clips video.mp4 \
    --music bgm.flac --music-volume 0.25          # sidechain 闪避，对白优先
```

- 视频若自带混音且只要它的画面：先 `-an` 去掉 baked 音轨，再铺 speech + BGM。
- 换音乐 = 换 `--music` 文件重跑，**对白不动**。
- 响度顺序：先对白 −16 LUFS → 铺 BGM（低 12–18dB）→ 限幅（`bgm.md`）。

---

## 5. 选型表

| 需求 | 路线 |
|---|---|
| 情绪对白 + 口型一体 | 视频原生口播（i2v/r2v 8 步） |
| 给定音频对嘴 | 克隆 + U11 对口型 |
| 跨集严格同音色 | FishAudio 克隆（N2） |
| 可控音色描述的旁白/对白、不出视频 | **H3 Speech Studio（U33）** |
| 本地 AI 配乐、可反复换 | **MiniMax Music 3（M1）** |
| 现成版权音乐 | 外部文件 + finish.py --music |

---

## 6. 合规

- `rights_confirmed` 勾选**不等于**授权；reference_voice 用真人声音需本人同意。
- AI 生成的 speech/BGM 同样要标 AI；音乐若模仿特定在世艺术家风格注意平台规则。
- Speech Studio 是 **EXP/T8** 实验路径，交付前按 §2.3 逐条验收。
