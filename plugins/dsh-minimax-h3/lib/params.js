/**
 * Option normalisation and server-inventory probing.
 *
 * Everything a caller can ask for is validated here once, so the graph builder
 * and the HTTP routes both consume one canonical shape. Anything that depends
 * on what the server actually has installed (aspect-ratio spellings, reference
 * input group names, model file lists) is read from `/object_info` when
 * available and falls back to the values the official templates used.
 */
import { randomInt } from 'node:crypto';
import { DEFAULT_MODELS, MODES, MODE_IDS, modelsFor } from './models.js';
import { DEFAULT_FPS, framesForDuration, snapFrames } from './workflows.js';

/**
 * Fallback aspect-ratio spellings. The live list comes from `/object_info`
 * (ResolutionSelector's COMBO), because the exact wording is ComfyUI's and
 * changes with the node; these are the ones the official templates prove exist
 * plus the rest of the common set.
 */
export const ASPECT_PRESETS = [
    '1:1 (Square)',
    '3:4 (Portrait)',
    '9:16 (Portrait Widescreen)',
    '2:3 (Portrait Photo)',
    '16:9 (Widescreen)',
    '3:2 (Photo)',
    '4:3 (Standard)',
    '21:9 (Cinematic)',
];

/** Hard bounds the H3 graphs are safe inside. */
export const LIMITS = {
    durationMin: 1,
    durationMax: 60,
    megapixelsMin: 0.05,
    megapixelsMax: 4,
    stepsMin: 1,
    stepsMax: 100,
    refsMax: 9,
    sizeMin: 64,
    sizeMax: 4096,
};

/** A random seed — RandomNoise takes an integer and H3 is happy with any.
 *  `randomInt` rejects a span wider than 2^48 - 1, hence the minus one. */
export function randomSeed() {
    return randomInt(0, 2 ** 48 - 1);
}

/** Read a COMBO's options out of an object_info input spec. */
function comboOptions(objectInfo, classType, inputName) {
    const def = objectInfo?.[classType];
    if (def === undefined) return undefined;
    const spec = def.input?.required?.[inputName] ?? def.input?.optional?.[inputName];
    if (!Array.isArray(spec) || !Array.isArray(spec[0])) return undefined;
    return spec[0].filter((value) => typeof value === 'string');
}

/** The aspect-ratio options to offer: the server's own list when it answers. */
/** The loader node and input name that owns each model slot. */
export const SLOT_INPUTS = [
    { slot: 'unet', classType: 'UNETLoader', inputName: 'unet_name' },
    { slot: 'clip', classType: 'CLIPLoader', inputName: 'clip_name' },
    { slot: 'vaeVideo', classType: 'VAELoader', inputName: 'vae_name' },
    { slot: 'vaeAudio', classType: 'VAELoader', inputName: 'vae_name' },
    { slot: 'lora', classType: 'LoraLoaderModelOnly', inputName: 'lora_name' },
];

/**
 * Resolve one requested model file name against the loader's advertised list.
 *
 * The defaults are the official templates' bare file names, but a server may
 * keep the H3 files in a subfolder, and ComfyUI then only accepts the full
 * relative name (`minimax/xxx.safetensors`). `inventory` suffix-matches, so it
 * reported such a file as present while generation used the bare name and died
 * inside the sampler. Preference: exact name, then the shortest suffix match
 * (the one closest to the models root), then lexicographic for determinism.
 */
export function resolveModelName(available, name) {
    if (!Array.isArray(available) || available.length === 0) return name;
    if (available.includes(name)) return name;
    const base = String(name).split(/[\\/]/).pop();
    const matches = available.filter((candidate) => candidate.endsWith(`/${base}`) || candidate.endsWith(`\\${base}`));
    if (matches.length === 0) return name;
    return matches.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
}

export function aspectOptions(objectInfo) {
    const live = comboOptions(objectInfo, 'ResolutionSelector', 'aspect_ratio');
    if (live !== undefined && live.length > 0) return live;
    return ASPECT_PRESETS;
}

/** Every selectable file name of one loader class, from object_info. */
function loaderFiles(objectInfo, classType, inputName) {
    const live = comboOptions(objectInfo, classType, inputName);
    return live ?? [];
}

/**
 * What the server has, per model slot. `undefined` for a slot means
 * object_info could not answer, which is reported as "unknown", never "missing"
 * — a false "you must download this" is worse than saying nothing.
 */
export function inventory(objectInfo, mode) {
    const models = modelsFor(mode);
    const slots = [
        { slot: 'unet', label: '主模型 UNet', classType: 'UNETLoader', inputName: 'unet_name', file: models.unet },
        { slot: 'clip', label: '文本/图像编码 CLIP', classType: 'CLIPLoader', inputName: 'clip_name', file: models.clip },
        { slot: 'vaeVideo', label: '视频 VAE', classType: 'VAELoader', inputName: 'vae_name', file: models.vaeVideo },
        { slot: 'vaeAudio', label: '音频 VAE', classType: 'VAELoader', inputName: 'vae_name', file: models.vaeAudio },
        { slot: 'lora', label: 'Turbo LoRA', classType: 'LoraLoaderModelOnly', inputName: 'lora_name', file: models.lora },
    ];
    const entries = [];
    for (const item of slots) {
        const available = objectInfo === undefined
            ? undefined
            : loaderFiles(objectInfo, item.classType, item.inputName);
        const present = available === undefined
            ? undefined
            : available.length === 0
                ? undefined
                : available.some((name) => name === item.file || name.endsWith(`/${item.file}`) || name.endsWith(`\\${item.file}`));
        entries.push({
            ...item,
            present,
            available: available ?? [],
            alternatives: (available ?? []).filter((name) => /minimax_h3|minimax.*h3/i.test(name) && name !== item.file),
        });
    }
    return {
        mode,
        checked: objectInfo !== undefined,
        missing: entries.filter((entry) => entry.present === false).map((entry) => entry.file),
        unknown: entries.filter((entry) => entry.present === undefined).map((entry) => entry.file),
        slots: entries,
    };
}

/**
 * Which object_info group carries the reference media of a mode.
 *
 * The flattened API format spells an auto-grow input as `<group>.<item>_<n>`.
 * The group and item names are the node's, not ours, so they are read from
 * object_info when the server answers; otherwise the official template's
 * `ref_images` / `ref_image` pair is used.
 */
export function refGroupFor(objectInfo, mode) {
    const fallback = { group: 'ref_images', prefix: 'ref_image' };
    const spec = objectInfo?.[MODES[mode]?.node ?? ''];
    if (spec === undefined) return fallback;
    const keys = [
        ...Object.keys(spec.input?.required ?? {}),
        ...Object.keys(spec.input?.optional ?? {}),
    ];
    for (const key of keys) {
        const match = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)_\d+$/.exec(key);
        if (match !== null) return { group: match[1], prefix: match[2] };
    }
    return fallback;
}

/** The reference-media group names a mode's node actually declares. */
export function refGroupsOf(objectInfo, mode) {
    const spec = objectInfo?.[MODES[mode]?.node ?? ''];
    const groups = new Set();
    if (spec !== undefined) {
        const keys = [
            ...Object.keys(spec.input?.required ?? {}),
            ...Object.keys(spec.input?.optional ?? {}),
        ];
        for (const key of keys) {
            const match = /^([A-Za-z0-9_]+)\.[A-Za-z0-9_]+_\d+$/.exec(key);
            if (match !== null) groups.add(match[1]);
        }
    }
    if (groups.size === 0) groups.add('ref_images');
    return [...groups];
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function asBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1) return true;
    if (value === 'false' || value === 0) return false;
    return undefined;
}

/**
 * Turn a loose request into the canonical options object every consumer reads.
 * Throws an Error with a human message on anything that cannot run.
 *
 * @param input - raw request fields (from a tool call or the panel).
 * @param config - resolved plugin config, for the defaults.
 * @param opts.objectInfo - `/object_info` when it could be read, for live names.
 */
export function resolveOptions(input, config, opts = {}) {
    const raw = input ?? {};
    const requestedMode = asString(raw.mode) || config.defaultMode || 't2v';
    if (!MODE_IDS.includes(requestedMode)) {
        throw new Error(`mode must be one of ${MODE_IDS.join(', ')} — got "${requestedMode}"`);
    }
    const spec = MODES[requestedMode];

    const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
    if (prompt.trim() === '') {
        throw new Error(`${requestedMode} needs a non-empty prompt`);
    }

    const refs = (Array.isArray(raw.refs) ? raw.refs : raw.refs === undefined ? [] : [raw.refs])
        .map((entry) => (typeof entry === 'string' ? entry.trim() : asString(entry?.filename)))
        .filter((entry) => entry !== '');
    if (refs.length < spec.minRefs) {
        throw new Error(`${requestedMode} (${spec.label}) needs ${spec.minRefs === 1 ? 'at least one' : spec.minRefs} reference image${spec.minRefs === 1 ? '' : 's'} — pass refs: ["file.png"]`);
    }
    if (refs.length > spec.maxRefs) {
        throw new Error(`${requestedMode} (${spec.label}) accepts at most ${spec.maxRefs} reference images — got ${refs.length}`);
    }
    if (spec.maxRefs === 1 && refs.length > 1) {
        throw new Error(`${requestedMode} (${spec.label}) takes exactly one reference image (the first frame)`);
    }

    const aspectChoices = aspectOptions(opts.objectInfo);
    const aspect = asString(raw.aspect) || config.defaultAspect;
    if (!aspectChoices.includes(aspect)) {
        // Tolerate a caller passing the bare ratio: "16:9".
        const bare = /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspect)
            ? aspectChoices.find((choice) => choice.startsWith(`${aspect} `) || choice === aspect)
            : undefined;
        if (bare === undefined) {
            throw new Error(`aspect must be one of: ${aspectChoices.join(' | ')}`);
        }
    }
    const resolvedAspect = aspectChoices.includes(aspect)
        ? aspect
        : aspectChoices.find((choice) => choice.startsWith(`${aspect} `)) ?? aspect;

    const width = asNumber(raw.width);
    const height = asNumber(raw.height);
    if ((width === undefined) !== (height === undefined)) {
        throw new Error('width and height must be given together');
    }
    const sizeOverride = width !== undefined && height !== undefined;
    if (sizeOverride) {
        for (const [name, value] of [['width', width], ['height', height]]) {
            if (value < LIMITS.sizeMin || value > LIMITS.sizeMax) {
                throw new Error(`${name} must be between ${LIMITS.sizeMin} and ${LIMITS.sizeMax}`);
            }
        }
    }

    const megapixels = clamp(
        asNumber(raw.megapixels) ?? config.defaultMegapixels,
        LIMITS.megapixelsMin,
        LIMITS.megapixelsMax,
    );

    const fps = clamp(Math.round(asNumber(raw.fps) ?? DEFAULT_FPS), 8, 60);

    const duration = clamp(
        asNumber(raw.duration) ?? config.defaultDuration,
        LIMITS.durationMin,
        LIMITS.durationMax,
    );
    const explicitFrames = asNumber(raw.frames);
    const frames = explicitFrames !== undefined
        ? snapFrames(clamp(Math.round(explicitFrames), 5, 60 * fps))
        : undefined;

    const seedInput = raw.seed;
    const randomRequested = seedInput === undefined
        || seedInput === null
        || seedInput === 'random'
        || seedInput === -1
        || seedInput === '-1';
    const seed = randomRequested ? randomSeed() : Math.trunc(asNumber(seedInput) ?? 0);

    const turbo = asBoolean(raw.turbo) ?? config.defaultTurbo;
    const stepsInput = asNumber(raw.steps);
    const steps = stepsInput === undefined ? undefined : clamp(Math.round(stepsInput), LIMITS.stepsMin, LIMITS.stepsMax);

    const models = {};
    const rawModels = typeof raw.models === 'object' && raw.models !== null ? raw.models : {};
    for (const key of ['unet', 'clip', 'vaeVideo', 'vaeAudio', 'lora']) {
        const value = asString(rawModels[key] ?? raw[key]);
        if (value !== '') models[key] = value;
    }

    // Resolve every slot against the server's real file list before the graph is
    // built. A wrong-but-plausible name is the most expensive failure here: it
    // only surfaces deep inside the sampler, after the model has been queued.
    const effectiveModels = modelsFor(requestedMode, models);
    for (const item of SLOT_INPUTS) {
        models[item.slot] = resolveModelName(
            loaderFiles(opts.objectInfo, item.classType, item.inputName),
            effectiveModels[item.slot],
        );
    }

    const refGroup = refGroupFor(opts.objectInfo, requestedMode);
    const fpsUsed = fps;
    const effectiveFrames = frames ?? framesForDuration(duration, fpsUsed);

    return {
        mode: requestedMode,
        modeLabel: spec.label,
        prompt,
        refs,
        aspect: resolvedAspect,
        megapixels,
        width: sizeOverride ? Math.round(width) : undefined,
        height: sizeOverride ? Math.round(height) : undefined,
        duration,
        frames,
        fps: fpsUsed,
        seed,
        turbo,
        steps,
        models,
        refGroup: refGroup.group,
        refPrefix: refGroup.prefix,
        refImageSize: asString(raw.ref_image_size) || 'match',
        filenamePrefix: asString(raw.filename_prefix) || asString(raw.filenamePrefix) || 'video/MiniMax_H3',
        title: asString(raw.title) || asString(raw.note) || '',
        projectId: asString(raw.projectId) || asString(raw.project_id) || '',
        shotId: asString(raw.shotId) || asString(raw.shot_id) || '',
        /** Derived, for reporting: what the graph will really produce. */
        report: {
            frames: effectiveFrames,
            seconds: Number((effectiveFrames / fpsUsed).toFixed(3)),
            steps: steps ?? (turbo ? spec.steps.turbo : spec.steps.full),
            size: sizeOverride
                ? `${Math.round(width)}×${Math.round(height)}`
                : `${resolvedAspect} @ ${megapixels}MP`,
            model: models.unet ?? DEFAULT_MODELS[requestedMode].unet,
            lora: turbo ? (models.lora ?? DEFAULT_MODELS[requestedMode].lora) : null,
        },
    };
}

/** A short one-line summary of resolved options, for tool output. */
export function summarizeOptions(options) {
    const parts = [
        `${options.mode} ${options.report.size}`,
        `${options.report.frames}f / ${options.report.seconds}s @ ${options.fps}fps`,
        `${options.report.steps} steps`,
        `seed ${options.seed}`,
    ];
    if (options.turbo) parts.push('Turbo LoRA');
    if (options.refs.length > 0) parts.push(`${options.refs.length} ref${options.refs.length > 1 ? 's' : ''}`);
    return parts.join(' · ');
}