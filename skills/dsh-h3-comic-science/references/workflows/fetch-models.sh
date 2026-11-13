#!/usr/bin/env bash
# 自动生成：MiniMax H3 skill 的模型下载脚本
# 用法: 在 ComfyUI 根目录执行 bash fetch-models.sh
# 只下载缺失的文件；已存在会跳过（--skip-existing 由 curl -C - 与 test 实现）
set -u
COMFY="${COMFY_ROOT:-.}"
RATE="${RATE:-20M}"
mkdir -p "$COMFY/models/diffusion_models" "$COMFY/models/text_encoders" "$COMFY/models/vae" "$COMFY/models/loras" "$COMFY/models/checkpoints"

DEST="$COMFY/models/loras/Ltx/LTX-2.3-Licon-MSR-V2.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/LiconStudio/LTX-2.3-Multiple-Subject-Reference/resolve/main/LTX-2.3-Licon-MSR-V2.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/vae/LTX23_audio_vae_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/LTX23_audio_vae_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/vae/LTX23_video_vae_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/LTX23_video_vae_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/minimax/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/main/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/minimax/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/main/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/loras/Qwen/Qwen-Edit-2509-Multiple-angles.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/loras/Qwen/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors?download=true' || echo "FAIL $DEST"
fi
if [ -f "$DEST" ]; then echo "2a32ce938ec71db2b49a817b4844ae86995569518dea56ee0ddc209cbe8e1377  $DEST" | sha256sum -c - >/dev/null 2>&1 || echo "HASH MISMATCH $DEST (再下一次或手工核对)"; fi

DEST="$COMFY/models/text_encoders/clip_vision_h.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/clip_vision/clip_vision_h.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e4b_it_fp8_scaled.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/Ltx/ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/diffusion_models/ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/text_encoders/ltx-2.3_text_projection_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/text_encoders/ltx-2.3_text_projection_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/vae/minimax_h3_audio_vae_fp32.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/loras/minimax/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/loras/minimax/minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/loras/minimax/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/loras/minimax/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models/resolve/main/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/vae/minimax_h3_video_vae_fp16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/qwen/qwen_image_2512_fp8_e4m3fn.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/qwen/qwen_image_edit_2509_fp8_e4m3fn.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors?download=true' || echo "FAIL $DEST"
fi
if [ -f "$DEST" ]; then echo "318568f61951ab9da21100c7b896e3c1da67f0d2efad6421545e022cfaa2b2b4  $DEST" | sha256sum -c - >/dev/null 2>&1 || echo "HASH MISMATCH $DEST (再下一次或手工核对)"; fi

DEST="$COMFY/models/diffusion_models/qwen/qwen_image_edit_2511_int8_convrot.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/vae/qwen_image_vae.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/vae/wan_2.1_vae.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/Zimage/z_image_turbo_bf16.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors?download=true' || echo "FAIL $DEST"
fi

DEST="$COMFY/models/diffusion_models/Zimage/z_image_turbo_int8_convrot.safetensors"
if [ -f "$DEST" ]; then echo "skip  $DEST"; else
  echo "get   $DEST"
  mkdir -p "$(dirname "$DEST")"
  curl -L --fail --retry 3 -C - --limit-rate "$RATE" -o "$DEST" 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_int8_convrot.safetensors?download=true' || echo "FAIL $DEST"
fi
