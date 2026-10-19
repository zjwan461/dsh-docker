/**
 * The three official MiniMax H3 ComfyUI graphs, rebuilt as API-format objects.
 *
 * These are faithful ports of the graphs ComfyUG ships as the MiniMax H3
 * templates (`video_minimax_h3_t2v/i2v/r2v.json`): same node classes, same
 * wiring, same widget values. What the plugin adds is *parameterisation* — the
 * knobs a caller actually turns (prompt, size, duration, seed, Turbo LoRA) are
 * written into the same nodes rather than rewriting the graph.
 *
 * Node ids are readable strings instead of the templates' numeric ids, so a
 * dumped graph is legible. Every reference is `[String(id), slot]`, which is
 * what the server's `validate_inputs` dictionary lookup requires.
 */
import { DEFAULT_MODELS, MODES, modelsFor } from './models.js';

/**
 * The duration→frame-count expression the official templates use, verbatim.
 * MiniMax H3 only accepts frame counts ≡ 5 (mod 17) (5, 22, 39, …), so a requested
 * duration in seconds is snapped UP to the next legal length at `fps`.
 * Expressed as a graph node (a `ComfyMathExpression`) rather than computed here
 * so the workflow a user opens in ComfyUI shows the same rule.
 */
export const DURATION_EXPR = 'max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17';

/** Default frame rate of the assembled video, matching the official templates. */
export const DEFAULT_FPS = 24;

/**
 * In the reference-to-video template the scheduler reads the *raw* UNet while
 * every other mode feeds it the LoRA switch. Reproduced as-authored (so the
 * plugin's output matches the official graph), and switchable here in one place
 * for anyone who wants the Turbo LoRA's sampling config to reach the schedule.
 */
const R2V_SCHEDULER_USES_RAW_UNET = true;

/** Snap a frame count to MiniMax H3's legal ≡ 5 (mod 17) values (minimum 5). */
export function snapFrames(frames) {
    const n = Math.max(5, Math.round(Number(frames) || 5));
    // The official expression is evaluated by ComfyMathExpression, whose `%` is
    // Python's (always non-negative for a positive modulus). JavaScript's `%`
    // keeps the dividend's sign, so a literal port returns 141 instead of 158 for
    // 144 frames. The extra `+17 %17` restores the intended behaviour.
    return n + ((((5 - (n % 17)) % 17) + 17) % 17);
}

/**
 * The frame count a duration in seconds produces, by the official rule.
 *
 * Note that this snaps *up* to the next ≡ 5 (mod 17) value, so 5 s at 24 fps is 124
 * frames (≈5.17 s), not 120 — H3 has no 120-frame option.
 */
export function framesForDuration(seconds, fps = DEFAULT_FPS) {
    return snapFrames(Math.max(5, Math.round((Number(seconds) || 5) * fps)));
}

/** Deep clone a graph so a caller can never mutate a cached template. */
export function cloneGraph(graph) {
    return JSON.parse(JSON.stringify(graph));
}

/**
 * Build one MiniMax H3 graph.
 *
 * @param opts.mode - 't2v' | 'i2v' | 'r2v'.
 * @param opts.prompt - the positive prompt.
 * @param opts.refs - reference image file names (ComfyUI input-dir names).
 * @param opts.seed - noise seed.
 * @param opts.turbo - enable the Turbo/Lightning LoRA and its step count.
 * @param opts.steps - explicit step override; otherwise the mode's full/turbo pair.
 * @param opts.aspect / opts.megapixels - ResolutionSelector settings.
 * @param opts.width / opts.height - explicit size; replaces the selector's outputs.
 * @param opts.duration - seconds, written into the PrimitiveFloat duration node.
 * @param opts.frames - explicit length; bypasses the duration node entirely.
 * @param opts.lastFrame / opts.lastFrameInput - i2v final frame and its input name.
 * @param opts.vaeTile - tile edge for VAEDecodeTiled; 0 keeps one-shot VAEDecode.
 * @param opts.fps - CreateVideo frame rate.
 * @param opts.filenamePrefix - SaveVideo filename prefix.
 * @param opts.models - per-slot model file overrides.
 * @returns a ComfyUI API-format workflow object.
 */
export function buildWorkflow(opts) {
    const mode = MODES[opts.mode] !== undefined ? opts.mode : 't2v';
    const spec = MODES[mode];
    const models = { ...modelsFor(mode, opts.models ?? {}) };
    const fps = Number(opts.fps) || DEFAULT_FPS;
    const steps = Number(opts.steps);
    const stepsFull = Number.isFinite(steps) && steps > 0 ? Math.round(steps) : spec.steps.full;
    const stepsTurbo = Number.isFinite(steps) && steps > 0 ? Math.round(steps) : spec.steps.turbo;
    const seed = Number.isFinite(Number(opts.seed)) ? Math.trunc(Number(opts.seed)) : 0;
    const turbo = opts.turbo === true;
    const schedulerFromSwitch = mode !== 'r2v' || R2V_SCHEDULER_USES_RAW_UNET === false;

    const h3 = 'h3';
    const nodes = {
        unet: {
            class_type: 'UNETLoader',
            inputs: { unet_name: models.unet, weight_dtype: 'default' },
            _meta: { title: 'UNet 加载器（H3 主模型）' },
        },
        clip: {
            class_type: 'CLIPLoader',
            inputs: { clip_name: models.clip, type: 'minimax', device: 'default' },
            _meta: { title: '加载 CLIP（Qwen3-VL 文本/图像编码）' },
        },
        vae_video: {
            class_type: 'VAELoader',
            inputs: { vae_name: models.vaeVideo },
            _meta: { title: '加载 VAE（视频）' },
        },
        vae_audio: {
            class_type: 'VAELoader',
            inputs: { vae_name: models.vaeAudio },
            _meta: { title: '加载 VAE（音频）' },
        },
        lora: {
            class_type: 'LoraLoaderModelOnly',
            inputs: { lora_name: models.lora, strength_model: 1, model: ['unet', 0] },
            _meta: { title: 'LoRA 加载器（Turbo / Lightning）' },
        },
        turbo: {
            class_type: 'PrimitiveBoolean',
            inputs: { value: turbo },
            _meta: { title: 'Boolean（启用 Turbo LoRA）' },
        },
        switch_model: {
            class_type: 'ComfySwitchNode',
            inputs: { switch: ['turbo', 0], on_false: ['unet', 0], on_true: ['lora', 0] },
            _meta: { title: 'If/Else Switch（模型）' },
        },
        steps_full: {
            class_type: 'PrimitiveInt',
            inputs: { value: stepsFull },
            _meta: { title: 'Int（完整步数）' },
        },
        steps_turbo: {
            class_type: 'PrimitiveInt',
            inputs: { value: stepsTurbo },
            _meta: { title: 'Int（Turbo 步数）' },
        },
        switch_steps: {
            class_type: 'ComfySwitchNode',
            inputs: { switch: ['turbo', 0], on_false: ['steps_full', 0], on_true: ['steps_turbo', 0] },
            _meta: { title: 'If/Else Switch（步数）' },
        },
        noise: {
            class_type: 'RandomNoise',
            inputs: { noise_seed: seed },
            _meta: { title: '随机噪波' },
        },
        sampler_select: {
            class_type: 'KSamplerSelect',
            inputs: { sampler_name: 'res_multistep' },
            _meta: { title: 'K 采样器选择' },
        },
        scheduler: {
            class_type: 'BasicScheduler',
            inputs: {
                scheduler: 'simple',
                steps: ['switch_steps', 0],
                denoise: 1,
                model: [schedulerFromSwitch ? 'switch_model' : 'unet', 0],
            },
            _meta: { title: '基本调度器' },
        },
        guider: {
            class_type: 'BasicGuider',
            inputs: { model: ['switch_model', 0], conditioning: [h3, 0] },
            _meta: { title: '基本引导器' },
        },
        advanced: {
            class_type: 'SamplerCustomAdvanced',
            inputs: {
                noise: ['noise', 0],
                guider: ['guider', 0],
                sampler: ['sampler_select', 0],
                sigmas: ['scheduler', 0],
                latent_image: [h3, 1],
            },
            _meta: { title: '自定义采样器（高级）' },
        },
        // One-shot decode is the official wiring. `vaeTile > 0` switches to the
        // tiled decoder, which is what makes 480p on an 8 GB card survive: the
        // whole video latent does not have to fit in VRAM at once.
        decode_video: opts.vaeTile > 0
            ? {
                class_type: 'VAEDecodeTiled',
                inputs: {
                    samples: ['advanced', 0],
                    vae: ['vae_video', 0],
                    tile_size: Math.round(opts.vaeTile),
                    overlap: 64,
                    temporal_size: 64,
                    temporal_overlap: 8,
                },
                _meta: { title: 'VAE 分块解码（视频）' },
            }
            : {
                class_type: 'VAEDecode',
                inputs: { samples: ['advanced', 0], vae: ['vae_video', 0] },
                _meta: { title: 'VAE 解码（视频）' },
            },
        decode_audio: {
            class_type: 'VAEDecodeAudio',
            inputs: { samples: ['advanced', 0], vae: ['vae_audio', 0] },
            _meta: { title: 'VAE 解码（音频）' },
        },
        create_video: {
            class_type: 'CreateVideo',
            inputs: {
                fps,
                bit_depth: 8,
                color_space: 'sRGB',
                codec: 'none',
                images: ['decode_video', 0],
                audio: ['decode_audio', 0],
            },
            _meta: { title: '创建视频（画面 + 音频）' },
        },
        save_video: {
            class_type: 'SaveVideo',
            inputs: {
                filename_prefix: opts.filenamePrefix ?? 'video/MiniMax_H3',
                format: 'auto',
                'format.codec': 'auto',
                codec: 'auto',
                video: ['create_video', 0],
            },
            _meta: { title: '保存视频' },
        },
        size: {
            class_type: 'ResolutionSelector',
            inputs: {
                aspect_ratio: opts.aspect ?? '16:9 (Widescreen)',
                megapixels: Number.isFinite(Number(opts.megapixels)) ? Number(opts.megapixels) : 0.4,
                multiple: 32,
            },
            _meta: { title: '分辨率选择器' },
        },
    };

    // Size: an explicit width/height wins over the selector's outputs.
    const width = Number(opts.width);
    const height = Number(opts.height);
    const sizeRef = (slot) => (Number.isFinite(width) && Number.isFinite(height)
        ? (slot === 0 ? Math.round(width) : Math.round(height))
        : ['size', slot]);

    // Length: `frames` writes a literal, otherwise the duration expression runs.
    const frames = Number(opts.frames);
    let lengthRef;
    if (Number.isFinite(frames) && frames > 0) {
        lengthRef = snapFrames(frames);
    }
    else {
        nodes.duration = {
            class_type: 'PrimitiveFloat',
            inputs: { value: Number.isFinite(Number(opts.duration)) ? Number(opts.duration) : 5 },
            _meta: { title: 'Float（时长/秒）' },
        };
        nodes.length = {
            class_type: 'ComfyMathExpression',
            inputs: { expression: DURATION_EXPR, 'values.a': ['duration', 0] },
            _meta: { title: '数学表达式（秒 → 合法帧数）' },
        };
        lengthRef = ['length', 1];
    }

    const common = {
        width: sizeRef(0),
        height: sizeRef(1),
        length: lengthRef,
        clip: ['clip', 0],
        vae: ['vae_video', 0],
    };

    if (mode === 'r2v') {
        nodes.prompt_text = {
            class_type: 'PrimitiveStringMultiline',
            inputs: { value: String(opts.prompt ?? '') },
            _meta: { title: '提示词' },
        };
        const h3Inputs = {
            prompt: ['prompt_text', 0],
            ...common,
            ref_image_size: opts.refImageSize ?? 'match',
            audio_vae: ['vae_audio', 0],
        };
        for (const [index, ref] of (opts.refs ?? []).entries()) {
            const nodeId = `ref_${index}`;
            nodes[nodeId] = {
                class_type: 'LoadImage',
                inputs: { image: ref },
                _meta: { title: `参考图 ${index + 1}` },
            };
            h3Inputs[`${opts.refGroup ?? 'ref_images'}.ref_image_${index}`] = [nodeId, 0];
        }
        nodes[h3] = {
            class_type: 'MiniMaxH3ReferenceToVideo',
            inputs: h3Inputs,
            _meta: { title: 'MiniMax H3 参考转视频' },
        };
        return nodes;
    }

    const h3Inputs = { prompt: String(opts.prompt ?? ''), ...common };
    if (mode === 'i2v') {
        nodes.first_frame = {
            class_type: 'LoadImage',
            inputs: { image: (opts.refs ?? [])[0] ?? '' },
            _meta: { title: '首帧图' },
        };
        h3Inputs.first_frame = ['first_frame', 0];
        // Optional final frame (FL2V): the model interpolates the middle. The
        // input name comes from object_info because only some builds expose it.
        if (typeof opts.lastFrame === 'string' && opts.lastFrame !== '') {
            nodes.last_frame = {
                class_type: 'LoadImage',
                inputs: { image: opts.lastFrame },
                _meta: { title: '尾帧图' },
            };
            h3Inputs[opts.lastFrameInput ?? 'last_frame'] = ['last_frame', 0];
        }
    }
    nodes[h3] = {
        class_type: 'MiniMaxH3ImageToVideo',
        inputs: h3Inputs,
        _meta: { title: 'MiniMax H3 图像转视频' },
    };
    return nodes;
}

/** The model slots a mode requires on the server, for inventory checks. */
export function requiredSlots(mode) {
    const id = MODES[mode] !== undefined ? mode : 't2v';
    return {
        unet: DEFAULT_MODELS[id].unet,
        lora: DEFAULT_MODELS[id].lora,
        clip: DEFAULT_MODELS.shared.clip,
        vaeVideo: DEFAULT_MODELS.shared.vaeVideo,
        vaeAudio: DEFAULT_MODELS.shared.vaeAudio,
    };
}