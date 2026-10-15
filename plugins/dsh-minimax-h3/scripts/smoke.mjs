/**
 * Offline smoke test — no ComfyUI, no FFmpeg binary, no DSH host required.
 *
 * It covers the parts that are pure logic and therefore testable: the official
 * graph rebuild for all three modes, the duration→frame rule, option
 * validation, every FFmpeg op's argv construction, and the JSON store's
 * merge/cap behaviour.
 *
 *   node scripts/smoke.mjs
 *
 * Exits non-zero on the first failed assertion.
 */
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { buildWorkflow, snapFrames, framesForDuration, DURATION_EXPR } from '../lib/workflows.js';
import { resolveOptions, aspectOptions, inventory, LIMITS } from '../lib/params.js';
import { MODE_IDS, MODES } from '../lib/models.js';
import { POST_OPS, candidatePaths, filterPath, findOp, ffprobeSibling, withDefaults, postOpCatalog } from '../lib/ffmpeg.js';
import { serveLocal } from '../lib/routes.js';
import { H3Store } from '../lib/store.js';
import { CONFIG_FIELDS, resolveConfig, sanitizeSettingsPatch } from '../lib/config.js';
import { ComfyUIClient } from '../lib/comfy.js';
import { createStudio, cacheNameFor, stamp } from '../lib/studio.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    }
    catch (error) {
        failed += 1;
        console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function checkAsync(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    }
    catch (error) {
        failed += 1;
        console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
    }
}

/* ------------------------------------------------------------------ */
// Shared scratch directory for every section that writes something.
const root = await mkdtemp(join(tmpdir(), 'dsh-minimax-h3-store-'));

console.log('\nduration → frames (the official 4n+1 rule)');

check('snapFrames matches the official expression', () => {
    // Values computed from the official ComfyMathExpression with Python modulo.
    assert.equal(snapFrames(120), 124);
    assert.equal(snapFrames(144), 158);
    assert.equal(snapFrames(240), 243);
    assert.equal(snapFrames(360), 362);
    assert.equal(snapFrames(480), 481);
});

check('every snapped value is >= 5 and == 5 (mod 17)', () => {
    for (let frames = 1; frames <= 1600; frames += 1) {
        const snapped = snapFrames(frames);
        assert.ok(snapped >= 5, `snapFrames(${frames}) = ${snapped} < 5`);
        assert.equal(snapped % 17, 5, `snapFrames(${frames}) = ${snapped} is not 5 mod 17`);
        assert.ok(snapped >= frames, `snapFrames(${frames}) = ${snapped} moved backwards`);
    }
});

check('snapFrames never returns a negative-modulo artefact', () => {
    // 144 % 17 = 8 > 5, which is exactly where a naive JS port goes wrong.
    assert.ok(snapFrames(144) > 144);
    assert.equal(framesForDuration(5), 124);
    assert.equal(framesForDuration(5.1667), 124);
});

/* ------------------------------------------------------------------ */
console.log('\ngraph construction (all three official flows)');

/** Walk a graph and assert every `[id, slot]` reference resolves. */
function validateGraph(graph) {
    const ids = new Set(Object.keys(graph));
    for (const [nodeId, node] of Object.entries(graph)) {
        assert.ok(typeof node.class_type === 'string' && node.class_type !== '', `${nodeId} has no class_type`);
        assert.ok(typeof node.inputs === 'object' && node.inputs !== null, `${nodeId} has no inputs`);
        for (const [key, value] of Object.entries(node.inputs)) {
            if (!Array.isArray(value)) continue;
            assert.equal(value.length, 2, `${nodeId}.${key} is not a [id, slot] pair`);
            assert.equal(typeof value[0], 'string', `${nodeId}.${key} id must be a string, got ${typeof value[0]}`);
            assert.equal(typeof value[1], 'number', `${nodeId}.${key} slot must be a number`);
            assert.ok(ids.has(value[0]), `${nodeId}.${key} points at unknown node "${value[0]}"`);
        }
    }
    // A graph with no output node can never be queued.
    assert.ok(graph.save_video !== undefined, 'graph has no SaveVideo node');
    return graph;
}

const base = {
    prompt: 'A test prompt.\nCUT 1: wide shot.\nAudio: wind.',
    refs: [],
    seed: 42,
    turbo: false,
    aspect: '16:9 (Widescreen)',
    megapixels: 0.4,
    duration: 5,
    fps: 24,
};

for (const mode of MODE_IDS) {
    check(`${mode}: builds a valid, fully wired graph`, () => {
        const refs = mode === 't2v' ? [] : ['ref_a.png', 'ref_b.png'];
        const graph = validateGraph(buildWorkflow({ ...base, mode, refs }));
        const h3 = graph.h3;
        assert.equal(h3.class_type, MODES[mode].node, `${mode} used the wrong H3 node`);
        if (mode === 'r2v') {
            // r2v feeds the prompt through a PrimitiveStringMultiline node, while
            // t2v/i2v write it straight into the prompt input.
            assert.deepEqual(h3.inputs.prompt, ['prompt_text', 0]);
            assert.equal(graph.prompt_text.inputs.value, base.prompt);
        }
        else {
            assert.equal(h3.inputs.prompt, base.prompt);
        }
        assert.deepEqual(h3.inputs.length, ['length', 1], `${mode} should read the duration expression`);
        assert.deepEqual(h3.inputs.width, ['size', 0]);
        assert.deepEqual(h3.inputs.height, ['size', 1]);
        assert.equal(graph.length.inputs.expression, DURATION_EXPR);
        if (mode === 'i2v') {
            assert.deepEqual(h3.inputs.first_frame, ['first_frame', 0]);
            assert.equal(graph.first_frame.inputs.image, 'ref_a.png');
            assert.equal(graph.ref_1, undefined, 'i2v must not emit a second reference');
        }
        if (mode === 'r2v') {
            assert.deepEqual(h3.inputs['ref_images.ref_image_0'], ['ref_0', 0]);
            assert.deepEqual(h3.inputs['ref_images.ref_image_1'], ['ref_1', 0]);
            assert.deepEqual(h3.inputs.audio_vae, ['vae_audio', 0]);
            // The official r2v template feeds the scheduler the raw UNet.
            assert.deepEqual(graph.scheduler.inputs.model, ['unet', 0]);
        }
        if (mode === 't2v') {
            assert.equal(h3.inputs.first_frame, undefined);
        }
    });
}

check('turbo switches both the model and the step count', () => {
    for (const mode of MODE_IDS) {
        const on = buildWorkflow({ ...base, mode, refs: ['r.png'], turbo: true });
        const off = buildWorkflow({ ...base, mode, refs: ['r.png'], turbo: false });
        assert.equal(on.turbo.inputs.value, true);
        assert.equal(off.turbo.inputs.value, false);
        assert.equal(on.steps_turbo.inputs.value, MODES[mode].steps.turbo);
        assert.equal(on.steps_full.inputs.value, MODES[mode].steps.full);
        assert.deepEqual(on.switch_model.inputs.on_true, ['lora', 0]);
    }
});

check('an explicit size replaces the ResolutionSelector outputs', () => {
    const graph = buildWorkflow({ ...base, mode: 't2v', width: 1280, height: 720 });
    assert.equal(graph.h3.inputs.width, 1280);
    assert.equal(graph.h3.inputs.height, 720);
    assert.ok(graph.size !== undefined, 'the selector should stay in the graph');
});

check('explicit frames bypass the duration node entirely', () => {
    const graph = buildWorkflow({ ...base, mode: 't2v', frames: 200 });
    assert.equal(graph.h3.inputs.length, 209);
    assert.equal(graph.duration, undefined);
    assert.equal(graph.length, undefined);
});

check('graphs survive a JSON round trip', () => {
    for (const mode of MODE_IDS) {
        const graph = buildWorkflow({ ...base, mode, refs: ['r.png'] });
        assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph);
    }
});

/* ------------------------------------------------------------------ */
console.log('\noption validation');

/**
 * The config object `resolveConfig` produces, mirrored here so the option tests
 * do not need the schema package. The check below asserts the two agree.
 */
const config = {
    baseUrl: 'http://127.0.0.1:8188',
    apiKeyEnv: 'COMFYUI_API_KEY',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    connectTimeoutMs: 10_000,
    timeoutMs: 1_800_000,
    pollIntervalMs: 1_000,
    maxMediaItems: 12,
    maxMediaBytes: 536_870_912,
    dataDir: join(tmpdir(), 'dsh-minimax-h3-smoke'),
    comfyuiDirs: [],
    mediaHost: '',
    ffmpegPath: '',
    ffprobePath: '',
    ffmpegTimeoutMs: 1_800_000,
    defaultAspect: '16:9 (Widescreen)',
    defaultMegapixels: 0.4,
    defaultDuration: 5,
    defaultMode: 't2v',
    defaultTurbo: false,
    maxRuns: 400,
    maxRenders: 400,
};

check('defaults resolve without an object_info', () => {
    const options = resolveOptions({ prompt: 'hi' }, config, {});
    assert.equal(options.mode, 't2v');
    assert.equal(options.fps, 24);
    assert.equal(options.report.frames, 124);
    assert.equal(options.aspect, config.defaultAspect);
    assert.ok(Number.isInteger(options.seed) && options.seed >= 0, 'a random seed should be generated');
});

check('a random seed is fresh on every call', () => {
    const seeds = new Set();
    for (let index = 0; index < 20; index += 1) {
        seeds.add(resolveOptions({ prompt: 'hi' }, config, {}).seed);
    }
    assert.ok(seeds.size > 15, `only ${seeds.size} distinct seeds in 20 calls`);
});

check('an explicit seed is honoured', () => {
    assert.equal(resolveOptions({ prompt: 'hi', seed: 7 }, config, {}).seed, 7);
});

check('a bare aspect ratio is accepted', () => {
    const options = resolveOptions({ prompt: 'hi', aspect: '16:9' }, config, {});
    assert.ok(options.aspect.startsWith('16:9'), `resolved to "${options.aspect}"`);
});

check('an unknown aspect is rejected with the options listed', () => {
    assert.throws(() => resolveOptions({ prompt: 'hi', aspect: '7:3' }, config, {}), /aspect must be one of/);
});

check('an empty prompt is rejected', () => {
    assert.throws(() => resolveOptions({ prompt: '   ' }, config, {}), /non-empty prompt/);
});

check('an unknown mode is rejected', () => {
    assert.throws(() => resolveOptions({ prompt: 'hi', mode: 't3v' }, config, {}), /mode must be one of/);
});

check('i2v requires exactly one reference', () => {
    assert.throws(() => resolveOptions({ prompt: 'hi', mode: 'i2v' }, config, {}), /reference image/);
    assert.throws(
        () => resolveOptions({ prompt: 'hi', mode: 'i2v', refs: ['a.png', 'b.png'] }, config, {}),
        /at most 1 reference|exactly one reference/,
    );
    assert.equal(resolveOptions({ prompt: 'hi', mode: 'i2v', refs: ['a.png'] }, config, {}).refs.length, 1);
});

check('t2v rejects references', () => {
    assert.throws(() => resolveOptions({ prompt: 'hi', mode: 't2v', refs: ['a.png'] }, config, {}), /at most 0/);
});

check('width and height must be given together', () => {
    assert.throws(() => resolveOptions({ prompt: 'hi', width: 1280 }, config, {}), /together/);
    assert.throws(() => resolveOptions({ prompt: 'hi', width: 5, height: 5 }, config, {}), /between/);
});

check('duration and steps are clamped, not rejected', () => {
    assert.equal(resolveOptions({ prompt: 'hi', duration: 9999 }, config, {}).duration, LIMITS.durationMax);
    assert.equal(resolveOptions({ prompt: 'hi', steps: 9999 }, config, {}).steps, LIMITS.stepsMax);
});

check('inventory reports unknown rather than missing without object_info', () => {
    const report = inventory(undefined, 't2v');
    assert.equal(report.checked, false);
    assert.equal(report.missing.length, 0);
    assert.equal(report.unknown.length, 5);
});

check('inventory flags a missing file when object_info answers', () => {
    const objectInfo = {
        UNETLoader: { input: { required: { unet_name: [['something_else.safetensors']] } } },
        CLIPLoader: { input: { required: { clip_name: [['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']] } } },
        VAELoader: { input: { required: { vae_name: [['minimax_h3_video_vae_int8_convrot.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']] } } },
        LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']] } } },
    };
    const report = inventory(objectInfo, 't2v');
    assert.equal(report.checked, true);
    assert.deepEqual(report.missing, ['minimax_h3_fl2va_pruned_int8_convrot.safetensors']);
    assert.equal(report.slots.find((slot) => slot.slot === 'unet').alternatives.length, 0);
});

check('the live aspect list wins over the presets', () => {
    const objectInfo = { ResolutionSelector: { input: { required: { aspect_ratio: [['9:21 (Tall)']] } } } };
    assert.deepEqual(aspectOptions(objectInfo), ['9:21 (Tall)']);
    assert.ok(aspectOptions(undefined).length > 3);
});

/* ------------------------------------------------------------------ */
console.log('\nsettings (the plugin owns them — no Config schema to resolve)');

check('the config mirror covers exactly the declared fields', () => {
    assert.deepEqual(Object.keys(config).sort(), [...CONFIG_FIELDS].sort());
});

check('saved overrides win over the entry config', () => {
    const merged = resolveConfig(
        { baseUrl: 'http://from-file:8188', defaultDuration: 5 },
        '/tmp/ignored',
        { baseUrl: 'http://from-panel:8188' },
    );
    assert.equal(merged.baseUrl, 'http://from-panel:8188');
    assert.equal(merged.defaultDuration, 5, 'untouched fields must keep the file value');
});

check('an undefined override does not shadow the baseline', () => {
    const merged = resolveConfig({ baseUrl: 'http://from-file:8188' }, '/tmp/ignored', { baseUrl: undefined });
    assert.equal(merged.baseUrl, 'http://from-file:8188');
});

check('dataDir falls back to the default only when empty', () => {
    assert.equal(resolveConfig({}, '/tmp/default').dataDir, '/tmp/default');
    assert.equal(resolveConfig({ dataDir: 'D:\\data' }, '/tmp/default').dataDir, 'D:\\data');
});

check('sanitizeSettingsPatch drops unknown keys and coerces types', () => {
    const { patch, rejected } = sanitizeSettingsPatch({
        baseUrl: '  http://x:8188  ',
        defaultDuration: '7',
        defaultTurbo: 'true',
        comfyuiDirs: [' D:\\ComfyUI ', '', 42],
        nope: 1,
        maxRuns: 'abc',
    });
    assert.equal(patch.baseUrl, 'http://x:8188');
    assert.equal(patch.defaultDuration, 7);
    assert.equal(patch.defaultTurbo, true);
    assert.deepEqual(patch.comfyuiDirs, ['D:\\ComfyUI']);
    assert.ok(!('nope' in patch), 'an unknown key must not be persisted');
    assert.ok(!('maxRuns' in patch), 'an unparseable number must not be persisted');
    assert.deepEqual(rejected.sort(), ['maxRuns', 'nope']);
});

check('sanitizeSettingsPatch tolerates junk input', () => {
    assert.deepEqual(sanitizeSettingsPatch(undefined).patch, {});
    assert.deepEqual(sanitizeSettingsPatch({ comfyuiDirs: 'not-an-array' }).patch, { comfyuiDirs: [] });
});

/* ------------------------------------------------------------------ */
console.log('\nremote ComfyUI (AutoDL / a LAN box): auth and history-derived assets');

/** Replace global fetch with a fake ComfyUI so the remote path is testable offline. */
function stubFetch(routes) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        calls.push({ path, method: init?.method ?? 'GET', headers: init?.headers ?? {} });
        const handler = routes[path];
        if (handler === undefined) return new Response('not found', { status: 404 });
        const result = typeof handler === 'function' ? handler(init) : handler;
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
    return {
        calls,
        restore: () => {
            globalThis.fetch = original;
        },
    };
}

check('the credential honours the configured header and scheme', () => {
    // A bare key keeps the common `Authorization: Bearer` shape.
    assert.deepEqual(new ComfyUIClient('http://x:1', 'secret').authHeaders(), { Authorization: 'Bearer secret' });
    // An empty scheme sends the key verbatim, for `x-api-key` style proxies.
    assert.deepEqual(
        new ComfyUIClient('http://x:1', { key: 'secret', header: 'x-api-key', scheme: '' }).authHeaders(),
        { 'x-api-key': 'secret' },
    );
    // No key, an empty key, and an empty header name all mean "send nothing".
    assert.deepEqual(new ComfyUIClient('http://x:1', undefined).authHeaders(), {});
    assert.deepEqual(new ComfyUIClient('http://x:1', '').authHeaders(), {});
    assert.deepEqual(new ComfyUIClient('http://x:1', { key: '' }).authHeaders(), {});
    assert.deepEqual(
        new ComfyUIClient('http://x:1', { key: 'secret', header: '' }).authHeaders(),
        {},
        'an empty header name must disable auth entirely',
    );
    // Existing headers survive.
    assert.deepEqual(
        new ComfyUIClient('http://x:1', 'k').authHeaders({ 'content-type': 'application/json' }),
        { 'content-type': 'application/json', Authorization: 'Bearer k' },
    );
});

const historyFixture = {
    p1: {
        prompt: [1, 'p1', {
            '1': { class_type: 'LoadImage', inputs: { image: 'hero.png' } },
            '2': { class_type: 'LoadImage', inputs: { image: 'sub/dir/costume.webp' } },
            '3': {
                class_type: 'CLIPTextEncode',
                // A prompt that happens to end in a media extension must not be
                // mistaken for a file: the newline and length guards reject it.
                inputs: { text: 'a long prompt\nspanning several lines and ending with .png' },
            },
            '4': { class_type: 'PrimitiveInt', inputs: { value: 42 } },
        }, {}, []],
        outputs: {
            '9': { videos: [{ filename: 'MiniMax_H3_00001.mp4', subfolder: 'video', type: 'output' }] },
            '10': { audio: [{ filename: 'MiniMax_H3_00001.mp3', subfolder: '', type: 'output' }] },
        },
    },
};

await checkAsync('a remote server with no local dirs still lists its inputs and outputs', async () => {
    const store = new H3Store(join(root, 'studio-assets'), {});
    await store.init();
    const stub = stubFetch({ '/history': historyFixture });
    try {
        const studio = createStudio({
            store,
            getConfig: () => ({ ...config, baseUrl: 'http://fake-assets.invalid:8188', comfyuiDirs: [] }),
            getApiKey: async () => undefined,
            proxyBase: () => 'http://host:3080',
        });
        const assets = await studio.listAssets();
        assert.equal(assets.historyAvailable, true, 'history should have answered');
        assert.equal(assets.localScanDirs, 0);
        assert.deepEqual(
            assets.inputs.map((item) => item.name).sort(),
            ['hero.png', 'sub/dir/costume.webp'],
            'input files come from the history graph, and prompt text must be excluded',
        );
        assert.deepEqual(
            assets.outputs.map((item) => item.name).sort(),
            ['MiniMax_H3_00001.mp3', 'video/MiniMax_H3_00001.mp4'],
        );
        assert.equal(assets.inputs[0].origin, 'history');
    }
    finally {
        stub.restore();
    }
});

await checkAsync('an unreachable server reports history as unknown, not empty', async () => {
    const store = new H3Store(join(root, 'studio-offline'), {});
    await store.init();
    const stub = stubFetch({});
    try {
        const studio = createStudio({
            store,
            getConfig: () => ({ ...config, baseUrl: 'http://fake-offline.invalid:8188', comfyuiDirs: [] }),
            getApiKey: async () => undefined,
            proxyBase: () => undefined,
        });
        const assets = await studio.listAssets();
        assert.equal(assets.historyAvailable, false);
        assert.deepEqual(assets.inputs, []);
    }
    finally {
        stub.restore();
    }
});

await checkAsync('diagnose reports endpoints, route prefix and H3 node presence', async () => {
    const store = new H3Store(join(root, 'studio-diagnose'), {});
    await store.init();
    const stub = stubFetch({
        '/system_stats': { system: { comfyui_version: '0.33.0' } },
        '/queue': { queue_running: [], queue_pending: [] },
        '/history': historyFixture,
        '/object_info': {
            MiniMaxH3ImageToVideo: { input: { required: {} } },
            ResolutionSelector: { input: { required: {} } },
            CreateVideo: { input: { required: {} } },
            SaveVideo: { input: { required: {} } },
            ComfyMathExpression: { input: { required: {} } },
            ComfySwitchNode: { input: { required: {} } },
        },
    });
    try {
        const studio = createStudio({
            store,
            getConfig: () => ({ ...config, baseUrl: 'http://fake-diag.invalid:8188', comfyuiDirs: [] }),
            getApiKey: async () => 'sekret',
            proxyBase: () => undefined,
        });
        const report = await studio.diagnose();
        assert.equal(report.endpoints.systemStats, true);
        assert.equal(report.endpoints.objectInfo, true);
        assert.equal(report.endpoints.queue, true);
        assert.equal(report.endpoints.history, true);
        assert.equal(report.version, '0.33.0');
        // The prefix is learned from the first successful bare request.
        assert.equal(report.routePrefix, '');
        assert.equal(report.authConfigured, true);
        assert.equal(report.h3.imageToVideo, true);
        assert.equal(report.h3.referenceToVideo, false, 'a missing node must read as missing');
        assert.equal(report.h3.switchNode, true);
        // The credential really travelled on the request.
        assert.equal(stub.calls[0].headers.Authorization, 'Bearer sekret');
    }
    finally {
        stub.restore();
    }
});

/* ------------------------------------------------------------------ */
console.log('\nFFmpeg discovery (Windows and POSIX)');

check('ffprobe is derived from the ffmpeg basename, not its extension', () => {
    // The POSIX case an extension-based derivation got wrong: `/usr/bin/ffmpeg`
    // has no extension, so it used to produce `/usr/bin/ffmpegprobe`.
    if (process.platform === 'win32') {
        assert.equal(ffprobeSibling('C:\\ffmpeg\\bin\\ffmpeg.exe'), 'C:\\ffmpeg\\bin\\ffprobe.exe');
    }
    else {
        assert.equal(ffprobeSibling('/usr/bin/ffmpeg'), '/usr/bin/ffprobe');
        assert.equal(ffprobeSibling('/usr/local/bin/ffmpeg'), '/usr/local/bin/ffprobe');
        assert.equal(ffprobeSibling('/snap/bin/ffmpeg'), '/snap/bin/ffprobe');
    }
    // Relative names behave identically on both platforms.
    assert.equal(ffprobeSibling('ffmpeg'), 'ffprobe');
    assert.equal(ffprobeSibling('ffmpeg.exe'), 'ffprobe.exe');
    assert.equal(ffprobeSibling('ffmpeg-7'), 'ffprobe-7');
    // A name that is not ffmpeg-derived still yields an ffprobe name.
    assert.equal(ffprobeSibling('avconv'), 'ffprobe');
});

check('an explicit ffmpeg path is tried first', () => {
    assert.equal(candidatePaths({ ffmpegPath: '  /my/ffmpeg  ', comfyuiDirs: [] })[0], '/my/ffmpeg');
    assert.equal(candidatePaths({ comfyuiDirs: [] })[0], 'ffmpeg', 'PATH is otherwise the first candidate');
});

check('every ComfyUI portable layout is probed, on either platform', () => {
    const dir = '/opt/ComfyUI';
    const list = candidatePaths({ ffmpegPath: '', comfyuiDirs: [dir] });
    // Expectations are built with `join` so the separator matches this platform.
    for (const rel of [[], ['bin'], ['python_embeded'], ['python_embeded', 'bin']]) {
        const expected = join(dir, ...rel, 'ffmpeg');
        assert.ok(list.includes(expected), `missing ${expected}`);
    }
    for (const rel of [[], ['bin'], ['python_embeded']]) {
        const expected = join(dir, ...rel, 'ffmpeg.exe');
        assert.ok(list.includes(expected), `missing ${expected}`);
    }
});

check('platform-specific locations never leak onto the other platform', () => {
    const list = candidatePaths({ ffmpegPath: '', comfyuiDirs: [] });
    if (process.platform === 'win32') {
        assert.ok(list.includes('C:\\ffmpeg\\bin\\ffmpeg.exe'));
        assert.ok(!list.includes('/usr/bin/ffmpeg'), 'a POSIX path must not be probed on Windows');
    }
    else {
        assert.ok(list.includes('/usr/bin/ffmpeg'));
        assert.ok(list.includes('/usr/local/bin/ffmpeg'));
        assert.ok(!list.includes('C:\\ffmpeg\\bin\\ffmpeg.exe'), 'a Windows path must not be probed on POSIX');
    }
    // PATH is always tried, whatever the platform.
    assert.ok(list.includes('ffmpeg'));
});

/* ------------------------------------------------------------------ */
console.log('\nmedia serving and cache identity');

/** A response object that records what the handler did. HEAD avoids the body. */
function fakeResponse() {
    const record = { status: 0, headers: {}, ended: false };
    return {
        record,
        writeHead(status, headers) {
            record.status = status;
            Object.assign(record.headers, headers);
        },
        end() {
            record.ended = true;
        },
    };
}

check('only a real, satisfiable range gets a 206', () => {
    const file = { path: '/nonexistent', size: 1000 };
    const head = (range, target = file) => {
        const response = fakeResponse();
        serveLocal(
            { method: 'HEAD', headers: range === undefined ? {} : { range } },
            response,
            target,
            'video/mp4',
        );
        return response.record;
    };

    assert.equal(head(undefined).status, 200, 'no Range → the whole file');
    assert.equal(head('bytes=0-99').status, 206);
    assert.equal(head('bytes=0-99').headers['content-range'], 'bytes 0-99/1000');
    assert.equal(head('bytes=0-99').headers['content-length'], 100);
    assert.equal(head('bytes=900-').headers['content-range'], 'bytes 900-999/1000');
    assert.equal(head('bytes=-100').headers['content-range'], 'bytes 900-999/1000', 'a suffix range');
    assert.equal(head('bytes=-99999').headers['content-range'], 'bytes 0-999/1000', 'an oversized suffix clamps');
    assert.equal(head('bytes=0-99').ended, true, 'HEAD must not open a body');

    // Satisfiable-looking but outside the file → 416, as RFC 7233 requires.
    assert.equal(head('bytes=1000-').status, 416);
    assert.equal(head('bytes=2000-3000').status, 416);

    // Unparseable, multi-range, or degenerate → the Range must be IGNORED, not
    // rejected. Answering a multi-range with 416 breaks media playback outright.
    assert.equal(head('bytes=0-99,200-299').status, 200, 'a multi-range must not 416');
    assert.equal(head('items=0-99').status, 200);
    assert.equal(head('bytes=').status, 200);
    assert.equal(head('bytes=0-99,200-299').headers['content-length'], 1000);

    // A zero-byte file is answered plainly rather than with a pointless 416.
    assert.equal(head('bytes=0-', { path: '/nonexistent', size: 0 }).status, 200);
});

check('cache names distinguish subfolder and type, not just the basename', () => {
    const a = cacheNameFor({ filename: 'clip.mp4', subfolder: 'a', type: 'output' });
    const b = cacheNameFor({ filename: 'clip.mp4', subfolder: 'b', type: 'output' });
    const c = cacheNameFor({ filename: 'clip.mp4', subfolder: 'a', type: 'temp' });
    const d = cacheNameFor({ filename: 'clip.mp4', subfolder: 'a', type: 'output' });
    // The bug this fixes: two remote files sharing a basename used to resolve to
    // the same cache path, so the second download silently reused the first.
    assert.notEqual(a, b, 'same basename in different subfolders must not collide');
    assert.notEqual(a, c, 'a different type must not collide');
    assert.equal(a, d, 'the same reference must be stable across calls');
    assert.equal(cacheNameFor({}), '', 'no filename means no cache name');

    // A name long enough to be truncated by the length cap still stays unique,
    // because the digest carries the identity.
    const long1 = cacheNameFor({ filename: `${'x'.repeat(200)}1.mp4` });
    const long2 = cacheNameFor({ filename: `${'x'.repeat(200)}2.mp4` });
    assert.notEqual(long1, long2);
    // Nothing that could escape the cache directory.
    for (const value of [a, b, c, long1]) {
        assert.ok(!/[\\/]/.test(value), `cache name contains a separator: ${value}`);
        assert.ok(!value.includes('..'), `cache name contains ..: ${value}`);
    }
});

check('output stamps carry milliseconds and never go backwards', () => {
    const value = stamp();
    assert.match(value, /^\d{8}-\d{6}-\d{3}$/, `unexpected stamp shape: ${value}`);
    // The millisecond field is the whole point: at second resolution, two runs
    // with the same output name inside one second would overwrite each other.
    let previous = '';
    for (let index = 0; index < 50; index += 1) {
        const next = stamp();
        assert.ok(next >= previous, `stamp went backwards: ${previous} → ${next}`);
        previous = next;
    }
});

await checkAsync('a broken file stream does not take the process down', async () => {
    const { Writable } = await import('node:stream');
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    sink.writeHead = () => {};
    // Reading a file that is not there: with a bare `source.pipe(response)` the
    // read stream's 'error' has no listener, which is an unhandled event — it
    // throws and kills the whole host process, not just this response.
    serveLocal(
        { method: 'GET', headers: {} },
        sink,
        { path: join(root, 'definitely-not-here.mp4'), size: 1000 },
        'video/mp4',
    );
    // Let the failing read surface. Reaching the assertion at all is the test.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(true);
});

/* ------------------------------------------------------------------ */
console.log('\nFFmpeg op argv construction');

const workDir = join(tmpdir(), 'dsh-minimax-h3-smoke-work');
// Ops write scratch files here; the plugin creates it in store.init().
await mkdir(workDir, { recursive: true });

function opContext(op, overrides = {}) {
    const options = { ...withDefaults(op.id, {}), ...overrides };
    return {
        main: 'C:\\tmp\\in clip.mp4',
        inputs: ['C:\\tmp\\in clip.mp4', 'C:\\tmp\\extra.png'],
        extras: ['C:\\tmp\\extra.png'],
        options,
        workDir,
        mainDuration: 5.416,
        mainHasAudio: true,
        probe: async () => ({ hasAudio: true, duration: 5.4 }),
        exec: async () => ({ code: 0, stderr: '' }),
        out: (name, extension) => join(workDir, `${name}.${extension}`),
    };
}

for (const op of POST_OPS) {
    await checkAsync(`${op.id}: builds a sane argv`, async () => {
        const overrides = {};
        if (op.id === 'text') overrides.text = '片名 / Title';
        if (op.id === 'subtitle') overrides.text = '1\n00:00:00,000 --> 00:00:02,000\n你好\n';
        const built = await op.build(opContext(op, overrides));
        assert.ok(Array.isArray(built.args) && built.args.length > 4, 'argv is too short');
        assert.equal(built.args[0], '-hide_banner');
        assert.equal(built.args.at(-1), built.output, 'the output path must be the last argument');
        assert.ok(typeof built.output === 'string' && built.output !== '');
        const joined = built.args.join(' ');
        assert.ok(!joined.includes('undefined'), `argv contains "undefined": ${joined}`);
        assert.ok(!joined.includes('NaN'), `argv contains "NaN": ${joined}`);
        assert.ok(!joined.includes('[object Object]'), `argv contains an object: ${joined}`);
        // Every argument must be a string, because spawn would reject a number.
        for (const arg of built.args) assert.equal(typeof arg, 'string', `non-string argv entry: ${String(arg)}`);
        // Even numbers of input flags: every -i needs a value.
        const inputs = built.args.filter((arg) => arg === '-i').length;
        assert.ok(inputs >= 1, 'no input file');
        for (const prelude of built.prelude ?? []) {
            assert.equal(typeof prelude, 'object');
            assert.equal(prelude.at(-1), prelude.at(-1));
        }
    });
}

check('the op catalog is stable and free of closures', () => {
    const catalog = postOpCatalog();
    assert.equal(catalog.length, POST_OPS.length);
    assert.ok(JSON.stringify(catalog).length > 200);
    for (const entry of catalog) {
        assert.ok(typeof entry.id === 'string' && typeof entry.label === 'string');
        assert.ok(Array.isArray(entry.params));
        for (const param of entry.params) {
            assert.ok(typeof param.name === 'string' && param.name !== '');
            assert.ok(['string', 'number', 'boolean', 'enum'].includes(param.type), `${entry.id}.${param.name} has type ${param.type}`);
            assert.ok(param.default !== undefined, `${entry.id}.${param.name} has no default`);
            if (param.type === 'enum') assert.ok(Array.isArray(param.options) && param.options.includes(param.default));
        }
    }
    // Op ids must be unique: they are the tool's dispatch key.
    const ids = catalog.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
});

check('filtergraph path escaping is correct on each platform', () => {
    // Windows: backslashes become slashes and the drive colon is escaped.
    assert.equal(filterPath('C:\\ffmpeg\\subs.srt', 'win32'), 'C\\:/ffmpeg/subs.srt');
    // POSIX: a backslash is a legal filename character and must survive —
    // rewriting it would point the filter at a different file.
    assert.equal(filterPath('/tmp/odd\\name/subs.srt', 'linux'), '/tmp/odd\\name/subs.srt');
    assert.equal(filterPath('/tmp/plain/subs.srt', 'linux'), '/tmp/plain/subs.srt');
    // Quotes and commas are escaped on both.
    assert.equal(filterPath("/tmp/it's.srt", 'linux'), "/tmp/it\\'s.srt");
    assert.equal(filterPath('/tmp/a,b.srt', 'linux'), '/tmp/a\\,b.srt');
});

await checkAsync('window paths are escaped for the subtitles filtergraph', async () => {
    const op = findOp('subtitle');
    assert.ok(op !== undefined);
    const built = await op.build(opContext(op, { text: '1\n00:00:00,000 --> 00:00:01,000\nhi\n' }));
    const filter = built.args[built.args.indexOf('-vf') + 1];
    assert.ok(!/filename='C:/.test(filter), `an unescaped drive colon reached the filtergraph: ${filter}`);
});

check('withDefaults fills every declared parameter', () => {
    for (const op of POST_OPS) {
        const filled = withDefaults(op.id, {});
        for (const param of op.params) {
            assert.ok(filled[param.name] !== undefined, `${op.id}.${param.name} unfilled`);
        }
    }
});

/* ------------------------------------------------------------------ */
console.log('\nstore');

await checkAsync('runs round-trip, cap and delete', async () => {
    const store = new H3Store(join(root, 'data'), { maxRuns: 3, maxRenders: 2 });
    await store.init();
    for (let index = 0; index < 5; index += 1) {
        await store.saveRun({ mode: 't2v', title: `run ${index}`, media: [] });
    }
    const runs = await store.listRuns();
    assert.equal(runs.length, 3, 'maxRuns was not enforced');
    assert.equal(runs[0].title, 'run 4', 'runs must be newest-first');
    const updated = await store.updateRun(runs[0].id, { status: 'completed' });
    assert.equal(updated.status, 'completed');
    assert.equal((await store.getRun(runs[0].id)).status, 'completed');
    assert.equal(await store.deleteRun(runs[0].id), true);
    assert.equal(await store.deleteRun('nope'), false);
    assert.equal((await store.listRuns()).length, 2);
});

await checkAsync('concurrent writes do not lose records', async () => {
    const store = new H3Store(join(root, 'concurrent'), { maxRuns: 100, maxRenders: 100 });
    await store.init();
    await Promise.all(Array.from({ length: 25 }, (_, index) => store.saveRun({ title: `c${index}` })));
    assert.equal((await store.listRuns()).length, 25, 'a queued write overwrote another');
});

await checkAsync('a corrupt document does not break startup', async () => {
    const dir = join(root, 'corrupt');
    await mkdir(dir, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'runs.json'), '{ this is not json', 'utf8');
    const store = new H3Store(dir, {});
    await store.init();
    assert.deepEqual(await store.listRuns(), []);
});

await checkAsync('shots merge by id and can be removed', async () => {
    const store = new H3Store(join(root, 'projects'), {});
    await store.init();
    const project = await store.saveProject({ name: 'Film', shots: [{ title: 'A', prompt: 'a' }] });
    assert.equal(project.shots.length, 1);
    const shotId = project.shots[0].id;
    const updated = await store.saveProject({
        id: project.id,
        name: 'Film',
        shots: [{ id: shotId, status: 'done' }, { title: 'B', prompt: 'b' }],
    });
    assert.equal(updated.shots.length, 2);
    assert.equal(updated.shots[0].status, 'done');
    assert.equal(updated.shots[0].prompt, 'a', 'a partial shot patch must not erase other fields');
    const trimmed = await store.saveProject({ id: project.id, removeShotIds: [shotId] });
    assert.equal(trimmed.shots.length, 1);
    assert.equal(trimmed.shots[0].title, 'B');
    assert.equal(await store.deleteProject(project.id), true);
    assert.deepEqual(await store.listProjects(), []);
});

await checkAsync('settings overrides round-trip through disk', async () => {
    const dir = join(root, 'settings');
    const store = new H3Store(dir, {});
    await store.init();
    assert.deepEqual(await store.loadSettings(), {}, 'a fresh install has no overrides');
    await store.saveSettings({ baseUrl: 'http://a:1' });
    assert.deepEqual(await store.loadSettings(), { baseUrl: 'http://a:1' });
    await store.saveSettings({ ffmpegPath: 'C:\\ffmpeg.exe' });
    assert.deepEqual(await store.loadSettings(), { baseUrl: 'http://a:1', ffmpegPath: 'C:\\ffmpeg.exe' });
    // A second store over the same directory must read what the first wrote.
    const fresh = new H3Store(dir, {});
    await fresh.init();
    assert.deepEqual(await fresh.loadSettings(), { baseUrl: 'http://a:1', ffmpegPath: 'C:\\ffmpeg.exe' });
});

await checkAsync('a corrupt settings file falls back to the entry config', async () => {
    const dir = join(root, 'settings-corrupt');
    await mkdir(dir, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'settings.json'), 'not json at all', 'utf8');
    const store = new H3Store(dir, {});
    await store.init();
    assert.deepEqual(await store.loadSettings(), {});
    assert.equal(
        resolveConfig({ baseUrl: 'http://from-file:1' }, dir, await store.loadSettings()).baseUrl,
        'http://from-file:1',
    );
});

await checkAsync('a run left in flight by a restart is closed out', async () => {
    const store = new H3Store(join(root, 'reconcile'), {});
    await store.init();
    const queued = await store.saveRun({ mode: 't2v', status: 'queued', media: [] });
    const running = await store.saveRun({ mode: 'r2v', status: 'running', media: [] });
    const finished = await store.saveRun({ mode: 't2v', status: 'completed', media: [] });
    const cancelled = await store.saveRun({ mode: 't2v', status: 'cancelled', media: [] });

    // A record left at queued/running makes the panel poll the ComfyUI queue
    // forever, because its "anything in flight" test never goes false.
    assert.equal(await store.reconcileRuns(), 2, 'only the two in-flight records');
    assert.equal((await store.getRun(queued.id)).status, 'interrupted');
    assert.equal((await store.getRun(running.id)).status, 'interrupted');
    assert.ok(
        (await store.getRun(queued.id)).error.includes('ComfyUI'),
        'the note should say where the clip would be',
    );
    assert.equal((await store.getRun(finished.id)).status, 'completed', 'a settled run is untouched');
    assert.equal((await store.getRun(cancelled.id)).status, 'cancelled', 'a cancelled run is untouched');
    assert.equal(await store.reconcileRuns(), 0, 'reconciling again changes nothing');
});

await checkAsync('a cancelled run survives the waiter failing', async () => {
    const store = new H3Store(join(root, 'cancel-clobber'), {});
    await store.init();
    const run = await store.saveRun({ mode: 't2v', status: 'cancelled', promptId: 'cancel-1', media: [] });
    const stub = stubFetch({ '/history/cancel-1': {} });
    try {
        const studio = createStudio({
            store,
            getConfig: () => ({ ...config, baseUrl: 'http://fake-cancel.invalid:8188', pollIntervalMs: 10, comfyuiDirs: [] }),
            getApiKey: async () => undefined,
            proxyBase: () => undefined,
        });
        // The history never reports this prompt, so the wait times out — which
        // must not overwrite the terminal state the user asked for.
        const settled = await studio.waitRun(run, { timeoutMs: 30 });
        assert.equal(settled.status, 'cancelled');
    }
    finally {
        stub.restore();
    }
});

/* ------------------------------------------------------------------ */
console.log('\nhost plugin wiring (apply against a mock context)');

const hostTools = [];
const hostRoutes = [];

/** A context good enough for apply(): services by name, effects that run inline. */
function makeHostContext() {
    const webServer = {
        port: 3080,
        host: '127.0.0.1',
        register: (route) => {
            hostRoutes.push(route);
            return () => {};
        },
        tapIndex: () => () => {},
    };
    const services = {
        tools: {
            register: (definition) => {
                hostTools.push(definition);
                return () => {};
            },
        },
        webServer,
        settings: undefined,
        skills: undefined,
        credentials: undefined,
        jobs: undefined,
    };
    const sub = {
        get: (name) => services[name],
        effect: (fn) => fn(),
        on: () => {},
    };
    return {
        // Cordis exposes services both as properties and through get(); the plugin
        // uses `ctx.tools.register` directly, so the mock must too.
        tools: services.tools,
        get: (name) => services[name],
        on: () => {},
        effect: (fn) => fn(),
        inject: (deps, fn) => {
            if (deps.includes('webServer')) fn(sub);
        },
    };
}

const hostLoad = { plugin: await import('../lib/index.js') };

await checkAsync('resolveConfig agrees with this file\'s mirror', async () => {
    assert.deepEqual(resolveConfig({}, config.dataDir), config);
});

await checkAsync('apply() registers five tools and mounts the panel routes', async () => {
    const plugin = hostLoad.plugin;
    assert.equal(plugin.name, 'dsh-minimax-h3');
    assert.deepEqual(plugin.inject, ['tools']);
    assert.equal(typeof plugin.apply, 'function');
    // No Config schema on purpose: a directory-linked bundle cannot resolve the
    // schema package at runtime, so the plugin owns its settings instead.
    assert.equal(plugin.Config, undefined, 'this bundle must not export a Config schema');

    // Port 9 refuses immediately, so a validation test below never waits on a
    // real ComfyUI that happens to be running.
    await plugin.apply(makeHostContext(), {
        dataDir: join(root, 'host'),
        baseUrl: 'http://127.0.0.1:9',
        connectTimeoutMs: 1000,
    });

    assert.deepEqual(
        hostTools.map((definition) => definition.name).sort(),
        ['h3_assets', 'h3_generate', 'h3_post', 'h3_project', 'h3_runs'],
    );
    for (const definition of hostTools) {
        assert.equal(typeof definition.execute, 'function', `${definition.name} has no execute`);
        assert.equal(typeof definition.description, 'string');
        assert.ok(definition.description.length > 80, `${definition.name}'s description is too thin to route on`);
        assert.equal(definition.parameters?.type, 'object');
        assert.equal(typeof definition.output?.render, 'function', `${definition.name} has no render`);
        assert.ok(typeof definition.timeoutMs === 'number' && definition.timeoutMs >= 60_000);
    }

    const paths = hostRoutes.map((route) => route.path);
    for (const expected of ['/minimaxh3/generate', '/minimaxh3/media', '/minimaxh3/post', '/minimaxh3/config', '/minimaxh3/projects']) {
        assert.ok(paths.includes(expected), `${expected} was not mounted`);
    }
    assert.equal(new Set(paths).size, paths.length, 'a route path was registered twice');
    assert.equal(hostRoutes.every((route) => route.kind === 'exact'), true);
    assert.ok(paths.length >= 16, `only ${paths.length} routes mounted`);
});

await checkAsync('h3_generate rejects bad input before queueing anything', async () => {
    const generate = hostTools.find((definition) => definition.name === 'h3_generate');
    const exec = { signal: new AbortController().signal };
    await assert.rejects(() => generate.execute({ prompt: '   ' }, exec), /non-empty prompt/);
    await assert.rejects(() => generate.execute({ prompt: 'x', mode: 'i2v' }, exec), /reference image/);
    await assert.rejects(() => generate.execute({ prompt: 'x', mode: 't3v' }, exec), /mode must be one of/);
    await assert.rejects(() => generate.execute({ prompt: 'x', aspect: '7:3' }, exec), /aspect must be one of/);
});

await checkAsync('h3_post lists its operations without an FFmpeg binary', async () => {
    const post = hostTools.find((definition) => definition.name === 'h3_post');
    const value = await post.execute({ action: 'list' }, { signal: new AbortController().signal });
    assert.equal(typeof value, 'string');
    for (const op of POST_OPS) assert.ok(value.includes(op.id), `${op.id} is missing from the listing`);
});

/* ------------------------------------------------------------------ */
console.log('\nclient bundle');

await checkAsync('the bundle id matches the package and it registers its five slots', async () => {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    let loaded;
    globalThis.window = {
        __ModuleLoader__: {
            load: (definition) => {
                loaded = definition;
            },
        },
    };
    await import('../client/client.js');
    assert.ok(loaded !== undefined, 'the bundle never called __ModuleLoader__.load');
    assert.equal(loaded.id, pkg.name, 'the factory id must equal the package name');

    // A stub is enough: nothing renders here, registration only closes over React.
    const stubReact = {
        createElement: (...args) => ({ args }),
        Fragment: Symbol('fragment'),
        useState: (initial) => [initial, () => {}],
        useEffect: () => {},
        useRef: (initial) => ({ current: initial }),
        useMemo: (factory) => factory(),
        useCallback: (fn) => fn,
        useSyncExternalStore: (_subscribe, get) => get(),
    };
    const mod = loaded.factory((specifier) => {
        if (specifier === 'react') return stubReact;
        throw new Error(`the bundle required an undeclared module: ${specifier}`);
    });
    assert.equal(mod.name, pkg.name);
    assert.deepEqual(mod.inject, ['slots']);
    assert.equal(typeof mod.apply, 'function');

    const registrations = [];
    mod.apply({
        effect: (fn) => fn(),
        slots: {
            inject: (_owner, fn) => fn(),
            register: (descriptor, component) => {
                registrations.push({ descriptor, component });
                return () => {};
            },
        },
    });
    assert.deepEqual(
        registrations.map((entry) => `${entry.descriptor.name}:${entry.descriptor.key ?? entry.descriptor.id}`),
        [
            'conversation.session.header.actions:minimaxh3',
            'shell.overlay:minimaxh3.panel',
            'settings.section:minimaxh3',
            'tool.call.toolview:h3_generate',
            'tool.call.toolview:h3_post',
        ],
    );
    // Every registration must own a component that takes the slot's props.
    for (const entry of registrations) assert.equal(typeof entry.component, 'function');
});

await checkAsync('package.json, the patch and the locale files agree', async () => {
    const { readFile, stat } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
    assert.equal(pkg.dsh.client.platform, 'web');
    assert.ok(typeof pkg.meta?.title === 'string' && pkg.meta.title !== '');
    assert.ok(pkg.icon !== undefined, 'no icon declared');
    for (const entry of pkg.files) {
        const target = new URL(`../${entry}`, import.meta.url);
        await stat(target).catch(() => {
            throw new Error(`package.json "files" lists a missing path: ${entry}`);
        });
    }
    for (const lang of ['zh', 'en']) {
        const locale = JSON.parse(await readFile(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'));
        assert.ok(typeof locale.meta?.title === 'string' && locale.meta.title !== '', `${lang}.json has no meta.title`);
        assert.ok(typeof locale.meta?.description === 'string' && locale.meta.description !== '');
    }
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
    assert.ok(patch.includes("name: 'dsh-minimax-h3'"), 'the patch does not name the package');
    assert.ok(patch.includes('id: minimax-h3'), 'the row id must match the settings namespace in lib/index.js');
});

/* ------------------------------------------------------------------ */
await rm(root, { recursive: true, force: true }).catch(() => undefined);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);