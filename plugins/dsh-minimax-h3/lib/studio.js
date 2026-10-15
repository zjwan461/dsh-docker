/**
 * The studio: everything that actually does work.
 *
 * The agent tools and the panel HTTP routes are two thin shells over this one
 * object, so a generation started from the panel and one started from a tool
 * take exactly the same path — same option validation, same run record, same
 * FFmpeg invocation. Keeping it in one place is also what makes the two
 * surfaces impossible to drift apart.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { ComfyUIClient, collectMedia, mediaProxyUrl } from './comfy.js';
import { buildWorkflow } from './workflows.js';
import {
    LIMITS,
    aspectOptions,
    inventory,
    refGroupsOf,
    resolveOptions,
    summarizeOptions,
} from './params.js';
import { MODES, MODE_IDS, DEFAULT_MODELS } from './models.js';
import { POST_OPS, findOp, postOpCatalog, previewCommand, probeMedia, resolveFFmpeg, runFFmpeg, withDefaults } from './ffmpeg.js';
import { errorMessage } from './http.js';

/** `/object_info` is large and only changes when nodes are (re)installed. */
const OBJECT_INFO_TTL_MS = 60_000;
let objectInfoCache = { key: '', at: 0, value: undefined };

/** Video/audio/image extensions the asset scanners care about. */
const MEDIA_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|mp3|wav|ogg|flac|m4a|aac|png|jpe?g|webp|gif|bmp)$/i;

/** Keep a user-supplied base name safe for a file name on every platform. */
function safeBase(value, fallback) {
    const raw = String(value ?? '').trim();
    const cleaned = raw
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 60);
    return cleaned === '' ? fallback : cleaned;
}

/** A compact, sortable timestamp for generated file names. */
function stamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

/** True when a path stays inside a root. */
function inside(root, target) {
    const rel = relative(root, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..');
}

/**
 * Read a media tree (ComfyUI input/output) for the asset picker. Bounded in
 * depth and count so a huge output directory cannot stall a panel request.
 */
async function scanMedia(root, options = {}) {
    const { depth = 2, limit = 400 } = options;
    const found = [];
    const walk = async (dir, level) => {
        if (level > depth || found.length >= limit) return;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (found.length >= limit) return;
            if (entry.name.startsWith('.')) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full, level + 1);
                continue;
            }
            if (!MEDIA_EXT.test(entry.name)) continue;
            let info;
            try {
                info = await stat(full);
            }
            catch {
                continue;
            }
            found.push({
                name: relative(root, full).split(sep).join('/'),
                relativePath: relative(root, full).split(sep).join('/'),
                size: info.size,
                modified: info.mtime.toISOString(),
            });
        }
    };
    await walk(root, 0);
    // Newest first: the clip that was just produced is the one being looked for.
    return found.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** A file name that looks like media rather than prompt text. */
function looksLikeMediaName(value) {
    // Prompts are long and multi-line; a real widget value is a short name. The
    // length and newline guards keep a prompt that happens to end in ".png"
    // from being offered as a reference image.
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 260
        && !value.includes('\n')
        && MEDIA_EXT.test(value);
}

/**
 * What a ComfyUI server knows about, read from its own history.
 *
 * This is the remote case's *only* listing: there is no HTTP endpoint that
 * enumerates the input or output directory, but every history entry carries the
 * outputs it produced and the file names its graph consumed — which is exactly
 * the set a user wants to pick from (including files staged on a rented box by
 * some other route).
 *
 * `available: false` means the server did not answer; callers report that as
 * "unknown", never as "empty".
 */
async function historyAssets(client, maxEntries, cap) {
    let entries;
    try {
        entries = await client.listHistory(maxEntries);
    }
    catch {
        return { inputs: [], outputs: [], available: false };
    }
    const inputs = new Map();
    const outputs = new Map();
    for (const { entry } of entries) {
        for (const output of Object.values(entry?.outputs ?? {})) {
            for (const key of ['images', 'videos', 'gifs', 'audio']) {
                for (const ref of output?.[key] ?? []) {
                    if (ref === null || typeof ref !== 'object' || typeof ref.filename !== 'string') continue;
                    const name = typeof ref.subfolder === 'string' && ref.subfolder !== ''
                        ? `${ref.subfolder}/${ref.filename}`
                        : ref.filename;
                    if (!outputs.has(name)) outputs.set(name, { name, size: 0, source: 'output', origin: 'history' });
                }
            }
        }
        // On the wire a history entry's `prompt` is
        // [number, promptId, graph, extraData, outputsToExecute]; tolerate a
        // bare graph object as well.
        const graph = Array.isArray(entry?.prompt) ? entry.prompt[2] : entry?.prompt;
        if (graph === null || typeof graph !== 'object') continue;
        for (const node of Object.values(graph)) {
            for (const value of Object.values(node?.inputs ?? {})) {
                if (!looksLikeMediaName(value)) continue;
                const name = value.trim();
                if (name === '' || inputs.has(name)) continue;
                inputs.set(name, { name, size: 0, source: 'input', origin: 'history' });
            }
        }
        if (inputs.size >= cap && outputs.size >= cap) break;
    }
    return {
        inputs: [...inputs.values()].slice(0, cap),
        outputs: [...outputs.values()].slice(0, cap),
        available: true,
    };
}

export function createStudio(deps) {
    const { store, getConfig, getApiKey, proxyBase } = deps;

    /**
     * A client built from the current (possibly just-changed) config.
     *
     * The credential carries the configured header name and scheme, because a
     * remote server behind a reverse proxy may want `x-api-key: <key>` rather
     * than `Authorization: Bearer <key>`.
     */
    const clientFor = async () => {
        const config = getConfig();
        return new ComfyUIClient(
            config.baseUrl,
            { key: await getApiKey(), header: config.authHeader, scheme: config.authScheme },
            config.connectTimeoutMs,
            config.maxMediaBytes,
        );
    };

    /** `/object_info`, cached per base URL; a failed read never clears the cache. */
    async function objectInfo(options = {}) {
        const config = getConfig();
        const key = config.baseUrl;
        const now = Date.now();
        if (options.force !== true && objectInfoCache.key === key && now - objectInfoCache.at < OBJECT_INFO_TTL_MS) {
            return objectInfoCache.value;
        }
        try {
            const value = await (await clientFor()).objectInfo();
            objectInfoCache = { key, at: now, value };
            return value;
        }
        catch {
            return objectInfoCache.key === key ? objectInfoCache.value : undefined;
        }
    }

    /** Everything the panel needs to render its controls. */
    async function meta() {
        const config = getConfig();
        const info = await objectInfo();
        const detection = await resolveFFmpeg(config);
        let reachable = false;
        let version;
        let error;
        try {
            const stats = await (await clientFor()).systemStats();
            reachable = true;
            version = stats?.system?.comfyui_version ?? 'unknown';
        }
        catch (caught) {
            error = errorMessage(caught);
        }
        return {
            baseUrl: config.baseUrl,
            reachable,
            version,
            error,
            modes: MODE_IDS.map((id) => ({
                id,
                label: MODES[id].label,
                labelEn: MODES[id].labelEn,
                description: MODES[id].description,
                node: MODES[id].node,
                minRefs: MODES[id].minRefs,
                maxRefs: MODES[id].maxRefs,
                steps: MODES[id].steps,
                refGroups: refGroupsOf(info, id),
            })),
            aspects: aspectOptions(info),
            ops: postOpCatalog(),
            limits: LIMITS,
            ffmpeg: detection,
            models: DEFAULT_MODELS,
            defaults: {
                aspect: config.defaultAspect,
                megapixels: config.defaultMegapixels,
                duration: config.defaultDuration,
                mode: config.defaultMode,
                turbo: config.defaultTurbo,
            },
            inventory: Object.fromEntries(MODE_IDS.map((id) => [id, inventory(info, id)])),
            objectInfoAvailable: info !== undefined,
        };
    }

    /** The media reference of one run, by index. */
    function mediaRefOf(run, index) {
        const media = run?.media ?? [];
        const item = media[index ?? 0];
        if (item === undefined) return undefined;
        if (typeof item.url === 'string' && item.url.startsWith('http')) {
            return { filename: item.filename, subfolder: item.subfolder ?? '', type: item.type ?? 'output' };
        }
        return { filename: item.filename, subfolder: item.subfolder ?? '', type: item.type ?? 'output' };
    }

    /**
     * Queue one generation and record it.
     *
     * @returns `{ run, promptId, workflow }`. The caller decides whether to wait.
     */
    async function generate(rawOptions = {}) {
        const config = getConfig();
        const info = await objectInfo();
        const options = resolveOptions(rawOptions, config, { objectInfo: info });
        const workflow = buildWorkflow(options);
        const client = await clientFor();
        const promptId = await client.queuePrompt(workflow, {
            extraData: {
                extra_pnginfo: {
                    workflow: {
                        id: options.shotId !== '' ? options.shotId : `minimax-h3-${options.mode}`,
                        name: options.title !== '' ? options.title : `MiniMax H3 ${options.modeLabel}`,
                    },
                },
            },
        });
        const run = await store.saveRun({
            id: `run-${randomUUID().slice(0, 8)}`,
            mode: options.mode,
            modeLabel: options.modeLabel,
            title: options.title,
            prompt: options.prompt,
            options,
            summary: summarizeOptions(options),
            promptId,
            status: 'queued',
            startedAt: Date.now(),
            media: [],
            projectId: options.projectId,
            shotId: options.shotId,
        });
        return { run, promptId, workflow };
    }

    /** Wait for a queued run and finalise its record. Never throws. */
    async function waitRun(run, options = {}) {
        const config = getConfig();
        const client = await clientFor();
        const startedAt = Date.now();
        try {
            const entry = await client.waitForCompletion({
                promptId: run.promptId,
                timeoutMs: options.timeoutMs ?? config.timeoutMs,
                pollIntervalMs: config.pollIntervalMs,
                signal: options.signal,
            });
            const media = collectMedia({
                entry,
                maxItems: config.maxMediaItems,
                proxyBase: proxyBase(),
            });
            return await store.updateRun(run.id, {
                status: 'completed',
                finishedAt: Date.now(),
                elapsedMs: Date.now() - startedAt,
                media,
            });
        }
        catch (error) {
            return await store.updateRun(run.id, {
                status: 'failed',
                finishedAt: Date.now(),
                elapsedMs: Date.now() - startedAt,
                error: errorMessage(error),
            });
        }
    }

    /** Interrupt a run on the server and mark it cancelled. */
    async function cancel({ promptId, runId }) {
        const client = await clientFor();
        let target = promptId;
        if (target === undefined && runId !== undefined) {
            target = (await store.getRun(runId))?.promptId;
        }
        await client.interrupt(target === undefined ? undefined : target);
        if (runId !== undefined) {
            await store.updateRun(runId, { status: 'cancelled', finishedAt: Date.now() });
        }
        return { interrupted: true, promptId: target ?? null };
    }

    /**
     * Parse the many ways a caller can name a media file.
     *
     * `render:name.mp4`, `upload:ref.png`, `run:<runId>:<index>`,
     * `comfy:file.png|subfolder|output`, or a bare file name that is looked up
     * in the renders directory first and treated as a ComfyUI output otherwise.
     */
    async function parseSource(spec) {
        if (spec === undefined || spec === null || spec === '') return undefined;
        if (typeof spec === 'object') {
            if (typeof spec.runId === 'string') return parseSource(`run:${spec.runId}:${spec.index ?? 0}`);
            if (typeof spec.render === 'string') return parseSource(`render:${spec.render}`);
            if (typeof spec.upload === 'string') return parseSource(`upload:${spec.upload}`);
            if (typeof spec.filename === 'string') {
                return { kind: 'comfy', filename: spec.filename, subfolder: spec.subfolder ?? '', type: spec.type ?? 'output' };
            }
            return undefined;
        }
        const raw = String(spec).trim();
        const colon = raw.indexOf(':');
        if (colon > 0) {
            const scheme = raw.slice(0, colon).toLowerCase();
            const rest = raw.slice(colon + 1);
            if (scheme === 'render') return { kind: 'render', name: rest };
            if (scheme === 'upload') return { kind: 'upload', name: rest };
            if (scheme === 'run') {
                const [runId, index] = rest.split(':');
                const run = await store.getRun(runId);
                if (run === undefined) throw new Error(`unknown run "${runId}"`);
                const ref = mediaRefOf(run, Number(index) || 0);
                if (ref === undefined) throw new Error(`run "${runId}" has no media at index ${Number(index) || 0}`);
                return { kind: 'comfy', ...ref };
            }
            if (scheme === 'comfy') {
                const [filename, subfolder, type] = rest.split('|');
                return { kind: 'comfy', filename: filename ?? rest, subfolder: subfolder ?? '', type: type ?? 'output' };
            }
        }
        // Bare name: a local render wins, then an uploaded file, then ComfyUI.
        try {
            const candidate = join(store.rendersRoot, basename(raw));
            const info = await stat(candidate);
            if (info.size > 0) return { kind: 'render', name: basename(raw) };
        }
        catch {
            // Not a render; keep looking.
        }
        try {
            const candidate = join(store.uploadsRoot, basename(raw));
            const info = await stat(candidate);
            if (info.size > 0) return { kind: 'upload', name: basename(raw) };
        }
        catch {
            // Not an upload either.
        }
        return { kind: 'comfy', filename: raw, subfolder: '', type: 'output' };
    }

    /** Ensure a local absolute path exists for a media source. */
    async function materialize(spec) {
        const source = await parseSource(spec);
        if (source === undefined) throw new Error('a source media file is required');
        if (source.kind === 'render' || source.kind === 'upload') {
            const root = source.kind === 'render' ? store.rendersRoot : store.uploadsRoot;
            const target = resolve(root, source.name);
            // `resolve` alone would happily walk out of the directory with "..",
            // and an empty name would resolve to the directory itself.
            if (String(source.name).trim() === '' || !inside(root, target)) {
                throw new Error(`${source.kind} name "${source.name}" is not a file in the ${source.kind} directory`);
            }
            const info = await stat(target).catch(() => undefined);
            if (info === undefined || !info.isFile()) {
                throw new Error(`${source.kind === 'render' ? 'render' : 'uploaded file'} "${source.name}" not found`);
            }
            return { path: target, kind: source.kind, name: basename(target), size: info.size };
        }
        // ComfyUI output: cache it locally so FFmpeg has a real file to read.
        const target = join(store.cacheRoot, safeBase(source.filename, `clip-${Date.now()}`));
        const existing = await stat(target).catch(() => undefined);
        if (existing !== undefined && existing.size > 0) {
            return { path: target, kind: 'comfy', name: basename(target), size: existing.size };
        }
        const client = await clientFor();
        const { body } = await client.fetchViewStreamed(
            { filename: source.filename, subfolder: source.subfolder ?? '', type: source.type ?? 'output' },
            undefined,
            'GET',
        );
        if (body === null || body === undefined) throw new Error(`ComfyUI returned no body for ${source.filename}`);
        await pipeline(Readable.fromWeb(body), createWriteStream(target));
        const info = await stat(target).catch(() => undefined);
        return { path: target, kind: 'comfy', name: basename(target), size: info?.size ?? 0 };
    }

    /**
     * Run one FFmpeg op end to end: resolve inputs, build argv, execute, record.
     *
     * @param request.op - a POST_OPS id.
     * @param request.source - the main clip (see parseSource).
     * @param request.extras - extra inputs (watermark image, music, subtitles).
     * @param request.options - op parameters; defaults fill the gaps.
     * @param opts.signal / opts.onProgress - cancellation and progress.
     */
    async function runPost(request, options = {}) {
        const config = getConfig();
        const detection = await resolveFFmpeg(config);
        if (!detection.ok) throw new Error(detection.error);
        const op = findOp(request?.op);
        if (op === undefined) {
            throw new Error(`unknown ffmpeg op "${String(request?.op)}" — use one of: ${POST_OPS.map((entry) => entry.id).join(', ')}`);
        }
        const opOptions = withDefaults(op.id, request.options ?? {});
        const main = await materialize(request.source);
        const extras = [];
        for (const extra of request.extras ?? []) {
            extras.push((await materialize(extra)).path);
        }

        const mainProbe = await probeMedia(detection.ffprobe, main.path).catch(() => undefined);
        const inputs = [main.path, ...extras];
        const outDir = store.rendersRoot;
        const suffix = stamp();
        const captured = [];
        // Ops write scratch files here (concat lists, palettes, drawtext text), so
        // the directory must exist even if a cleanup pass removed it.
        await mkdir(store.workRoot, { recursive: true });

        const progress = (fraction, seconds) => {
            if (typeof options.onProgress === 'function') options.onProgress(fraction, seconds);
        };

        const exec = async (args, totalDuration) => {
            captured.push(args);
            return runFFmpeg(detection.ffmpeg, args, {
                signal: options.signal,
                timeoutMs: config.ffmpegTimeoutMs,
                onProgress: progress,
                totalDuration,
            });
        };

        const built = await op.build({
            main: main.path,
            inputs,
            extras,
            options: opOptions,
            workDir: store.workRoot,
            mainDuration: mainProbe?.duration,
            mainHasAudio: mainProbe?.hasAudio,
            probe: (file) => probeMedia(detection.ffprobe, file).catch(() => undefined),
            exec,
            out: (base, extension) => join(outDir, `${safeBase(base, op.id)}_${suffix}.${extension}`),
        });

        const startedAt = Date.now();
        for (const prelude of built.prelude ?? []) {
            await exec(prelude, mainProbe?.duration);
        }
        await exec(built.args, mainProbe?.duration);
        const elapsedMs = Date.now() - startedAt;

        const outputInfo = await stat(built.output).catch(() => undefined);
        const outputProbe = await probeMedia(detection.ffprobe, built.output).catch(() => undefined);
        const render = await store.saveRender({
            id: `render-${randomUUID().slice(0, 8)}`,
            op: op.id,
            opLabel: op.label,
            source: { path: main.path, kind: main.kind, name: main.name, size: main.size },
            extras: extras.map((file) => basename(file)),
            options: opOptions,
            note: built.note ?? '',
            output: basename(built.output),
            outputDir: outDir,
            sizeBytes: outputInfo?.size ?? 0,
            elapsedMs,
            probe: outputProbe,
            command: captured.map((args) => previewCommand(detection.ffmpeg, args)),
        });

        // Temp files: the concat list, the palette, the drawtext text file.
        for (const file of built.cleanup ?? []) {
            await store.removeFile(file);
        }

        return { render, output: built.output, command: captured.map((args) => previewCommand(detection.ffmpeg, args)) };
    }

    /**
     * The asset picker's data.
     *
     * `inputs` and `outputs` are merged from three sources, because no single
     * one is complete:
     *   - the local ComfyUI install's directories, when `comfyuiDirs` is set
     *     (finds older files the server's history has already dropped);
     *   - the server's own history (the only listing a remote server offers —
     *     this is what makes a rented GPU or a LAN box usable);
     *   - the plugin's own upload record (files this plugin pushed, which stay
     *     visible even when history is cleared).
     */
    async function listAssets() {
        const config = getConfig();
        const [uploads, renders, tracked] = await Promise.all([
            scanMedia(store.uploadsRoot, { depth: 1, limit: 200 }),
            scanMedia(store.rendersRoot, { depth: 1, limit: 200 }),
            store.listAssets(),
        ]);
        const imported = [];
        const generated = [];
        for (const dir of config.comfyuiDirs ?? []) {
            imported.push(...await scanMedia(join(dir, 'input'), { depth: 2, limit: 300 }));
            generated.push(...await scanMedia(join(dir, 'output'), { depth: 2, limit: 300 }));
        }
        const history = await historyAssets(await clientFor(), 300, 400);

        const inputs = new Map();
        for (const item of imported) inputs.set(item.name, { ...item, source: 'input', origin: 'dir' });
        for (const item of history.inputs) if (!inputs.has(item.name)) inputs.set(item.name, item);
        for (const item of tracked) {
            if (!inputs.has(item.name)) {
                inputs.set(item.name, { name: item.name, source: 'input', origin: 'plugin', size: item.size ?? 0 });
            }
        }
        const outputs = new Map();
        for (const item of generated) outputs.set(item.name, { ...item, source: 'output', origin: 'dir' });
        for (const item of history.outputs) if (!outputs.has(item.name)) outputs.set(item.name, item);

        return {
            uploads: uploads.map((item) => ({ ...item, source: 'upload', origin: 'plugin' })),
            renders: renders.map((item) => ({ ...item, source: 'render', origin: 'plugin' })),
            inputs: [...inputs.values()],
            outputs: [...outputs.values()],
            tracked,
            /** False = the server did not answer `/history`; the lists are then only partial. */
            historyAvailable: history.available,
            /** How many local ComfyUI roots are configured (0 on a remote-only setup). */
            localScanDirs: (config.comfyuiDirs ?? []).length,
        };
    }

    /**
     * A one-shot health report, for when a remote server "half works".
     *
     * It answers the four questions that actually come up when pointing this
     * plugin at a rented GPU or another machine: can we reach it at all; which
     * route prefix did it settle on (a proxy that only forwards `/api/*` is
     * otherwise invisible); does its ComfyUI have the H3 nodes; and is there an
     * FFmpeg on *this* machine to finish the clip with.
     */
    async function diagnose() {
        const config = getConfig();
        const client = await clientFor();
        const key = await getApiKey();
        const startedAt = Date.now();
        const report = {
            baseUrl: config.baseUrl,
            authConfigured: key !== undefined && key !== null && key !== '',
            authHeader: config.authHeader,
            authScheme: config.authScheme,
            routePrefix: '',
            latencyMs: 0,
            version: '',
            endpoints: {},
            h3: {},
            comfyuiDirs: (config.comfyuiDirs ?? []).length,
            ffmpeg: undefined,
            error: '',
        };
        try {
            const stats = await client.systemStats();
            report.version = stats?.system?.comfyui_version ?? 'unknown';
            report.endpoints.systemStats = true;
        }
        catch (error) {
            report.endpoints.systemStats = false;
            report.error = errorMessage(error);
        }
        // Reading it after the first request is what makes it meaningful.
        report.routePrefix = client.learnedPrefix();
        report.latencyMs = Date.now() - startedAt;

        const info = await objectInfo({ force: true });
        report.endpoints.objectInfo = info !== undefined;
        if (info !== undefined) {
            const classes = {
                imageToVideo: 'MiniMaxH3ImageToVideo',
                referenceToVideo: 'MiniMaxH3ReferenceToVideo',
                resolutionSelector: 'ResolutionSelector',
                createVideo: 'CreateVideo',
                saveVideo: 'SaveVideo',
                mathExpression: 'ComfyMathExpression',
                switchNode: 'ComfySwitchNode',
            };
            for (const [key2, classType] of Object.entries(classes)) report.h3[key2] = info[classType] !== undefined;
        }
        try {
            await client.getQueue();
            report.endpoints.queue = true;
        }
        catch {
            report.endpoints.queue = false;
        }
        try {
            const entries = await client.listHistory(1);
            report.endpoints.history = true;
            report.historyEntries = entries.length;
        }
        catch {
            report.endpoints.history = false;
        }

        const detection = await resolveFFmpeg(config);
        report.ffmpeg = detection.ok
            ? { ok: true, version: detection.version, path: detection.ffmpeg }
            : { ok: false, version: '', path: '', error: detection.error };
        return report;
    }

    /** Stream one local plugin file (render or upload) with a traversal guard. */
    async function localFile(kind, name) {
        const root = kind === 'render' ? store.rendersRoot : store.uploadsRoot;
        const target = resolve(root, name);
        if (!inside(root, target)) return undefined;
        const info = await stat(target).catch(() => undefined);
        if (info === undefined || !info.isFile()) return undefined;
        return { path: target, size: info.size, ext: extname(target) };
    }

    /** Persist an uploaded file from the panel into the plugin's uploads dir. */
    async function saveUpload(bytes, name) {
        await mkdir(store.uploadsRoot, { recursive: true });
        const target = join(store.uploadsRoot, safeBase(name, `file-${Date.now()}`));
        await pipeline(Readable.from([bytes]), createWriteStream(target));
        const info = await stat(target).catch(() => undefined);
        return { name: basename(target), path: target, size: info?.size ?? 0 };
    }

    /** Record a reference image that was pushed into ComfyUI's input directory. */
    async function rememberAsset(name, meta2 = {}) {
        return store.saveAsset({ name, ...meta2, at: new Date().toISOString() });
    }

    return {
        store,
        objectInfo,
        meta,
        generate,
        waitRun,
        cancel,
        parseSource,
        materialize,
        runPost,
        listAssets,
        diagnose,
        localFile,
        saveUpload,
        rememberAsset,
        mediaRefOf,
        mediaUrl: (ref) => mediaProxyUrl(ref, proxyBase()),
        clientFor,
    };
}