/**
 * The MiniMax H3 model/LoRA catalog this plugin knows about.
 *
 * The file names are the ones the three official ComfyUI templates ship with.
 * They are *defaults*, not requirements: every one of them can be overridden
 * per generation (and the panel/tools surface what the server actually has via
 * `/object_info`), because a user may well have a fp8, bf16 or merged variant
 * instead. `required` marks the files a mode cannot run without.
 */

/** What kind of ComfyUI loader node owns each model slot. */
export const SLOT_LOADERS = {
    unet: 'UNETLoader',
    clip: 'CLIPLoader',
    vaeVideo: 'VAELoader',
    vaeAudio: 'VAELoader',
    lora: 'LoraLoaderModelOnly',
};

/** Default file names, keyed by slot, per mode. */
export const DEFAULT_MODELS = {
    shared: {
        clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
        vaeVideo: 'minimax_h3_video_vae_int8_convrot.safetensors',
        vaeAudio: 'minimax_h3_audio_vae_fp32.safetensors',
    },
    t2v: {
        unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
        lora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    },
    i2v: {
        unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
        lora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    },
    r2v: {
        unet: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
        lora: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
    },
};

/**
 * The three official flows.
 *
 * `minRefs` / `maxRefs` describe the reference media the mode consumes:
 * i2v takes exactly one still as the first frame; r2v takes one or more
 * reference stills (the official graph wires two). t2v takes none.
 *
 * `steps` is the pair the official templates switch between: the full model's
 * step count and the Turbo LoRA's distilled step count.
 */
export const MODES = {
    t2v: {
        id: 't2v',
        label: '文生视频',
        labelEn: 'Text to video',
        description: '纯提示词生成视频：H3 自己决定首帧、构图与运镜。',
        node: 'MiniMaxH3ImageToVideo',
        media: 'none',
        minRefs: 0,
        maxRefs: 0,
        steps: { full: 20, turbo: 8 },
        model: 'fl2va',
    },
    i2v: {
        id: 'i2v',
        label: '图生视频',
        labelEn: 'Image to video',
        description: '一张首帧图 + 提示词：画面从这张图开始动起来。人物/场景一致性最稳。',
        node: 'MiniMaxH3ImageToVideo',
        media: 'first_frame',
        minRefs: 1,
        maxRefs: 1,
        steps: { full: 20, turbo: 8 },
        model: 'fl2va',
    },
    r2v: {
        id: 'r2v',
        label: '参考生视频',
        labelEn: 'Reference to video',
        description: '若干参考图 + 提示词：用 <Picture 1>… 指代参考图，跨镜头锁住角色与画风。',
        node: 'MiniMaxH3ReferenceToVideo',
        media: 'refs',
        minRefs: 1,
        maxRefs: 9,
        steps: { full: 20, turbo: 4 },
        model: 'ref2va',
    },
};

/** Every mode id, in the order the UI lists them. */
export const MODE_IDS = ['t2v', 'i2v', 'r2v'];

/**
 * The reference-media input group of each reference-taking mode, as the
 * flattened API format spells it (`<group>.<item>_<index>`). Read from
 * `/object_info` when the server answers, so a renamed or extra group (audio,
 * video) is picked up automatically; this is the fallback.
 */
export const REF_GROUPS = {
    i2v: [],
    r2v: ['ref_images'],
};

/** Resolve the effective model file names for a mode, applying per-run overrides. */
export function modelsFor(mode, overrides = {}) {
    const id = MODE_IDS.includes(mode) ? mode : 't2v';
    const pick = (key) => {
        const override = overrides[key];
        if (typeof override === 'string' && override.trim() !== '') return override.trim();
        return DEFAULT_MODELS[id][key] ?? DEFAULT_MODELS.shared[key];
    };
    return {
        unet: pick('unet'),
        clip: pick('clip'),
        vaeVideo: pick('vaeVideo'),
        vaeAudio: pick('vaeAudio'),
        lora: pick('lora'),
    };
}

/** Human-readable summary of the mode catalog, for tool descriptions. */
export function describeModes() {
    return MODE_IDS.map((id) => `${id} (${MODES[id].label} / ${MODES[id].labelEn})`).join(', ');
}