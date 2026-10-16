/**
 * The agent-facing surface.
 *
 * Five tools, each owning one noun, so the model never has to guess between
 * overlapping names: `h3_generate` makes video, `h3_runs` looks at what
 * happened, `h3_assets` gets reference media into ComfyUI, `h3_project` keeps a
 * shot board, and `h3_post` finishes the result with FFmpeg.
 *
 * Video generation takes minutes, so `h3_generate` defaults to `mode: "async"`:
 * it queues, registers a background job and returns immediately, and the
 * harness wakes the model when the job settles. `mode: "sync"` is available for
 * short tests and for callers that would rather block.
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { POST_OPS, findOp, resolveFFmpeg, withDefaults } from './ffmpeg.js';
import { MODES, MODE_IDS } from './models.js';
import { LIMITS } from './params.js';
import { guessContentType } from './comfy.js';

const TOOL_TIMEOUT_MS = 3_600_000;

/** One-line description of the modes, reused by several tool descriptions. */
const MODE_HELP = MODE_IDS
    .map((id) => `"${id}" = ${MODES[id].label} (${MODES[id].labelEn})`)
    .join(', ');

function summarizeMedia(media) {
    if (!Array.isArray(media) || media.length === 0) return 'no media outputs';
    const counts = new Map();
    for (const item of media) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return [...counts.entries()].map(([kind, count]) => `${count} ${kind}`).join(', ');
}

/** Render a completed (or background) generation as tool content. */
function renderGenerate(_args, value) {
    const result = value;
    if (result?.kind === 'background') {
        return [{
            type: 'text',
            text: `MiniMax H3 generation queued in the background — job ${result.jobId}, prompt ${result.promptId}, run ${result.runId}. Collect it with job_output; this session is notified when it settles.`,
        }];
    }
    const lines = [
        `MiniMax H3 ${result.status} — run ${result.runId}, prompt ${result.promptId}`
        + (result.elapsedMs !== undefined ? `, ${(result.elapsedMs / 1000).toFixed(1)}s` : ''),
        `mode ${result.mode}${result.summary !== undefined ? ` · ${result.summary}` : ''}`,
        `media: ${summarizeMedia(result.media)}`,
    ];
    if (typeof result.error === 'string' && result.error !== '') lines.push(`error: ${result.error}`);
    for (const item of result.media ?? []) {
        lines.push(`  ${item.kind}: ${item.url}`);
    }
    if ((result.media ?? []).length > 0) {
        lines.push(`Finish it with h3_post (source "run:${result.runId}:0"), e.g. trim / concat / subtitle / loudnorm.`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
}

/**
 * Render any tool value as text. Tools return plain strings for their
 * narrative actions and objects where the panel wants structured metadata, so
 * one renderer covers both.
 */
function renderText(_args, value) {
    // ⚠ 契约是 `render(args, value)`。早先只写了 `renderText(value)`，
    // 第一个形参接到的是**参数**，于是工具结果里只有参数回显
    // （实测：`h3_assets action:"ffmpeg"` 返回 `{"action":"ffmpeg"}`）。
    if (typeof value === 'string') return [{ type: 'text', text: value }];
    if (value !== null && typeof value === 'object' && typeof value.text === 'string') {
        return [{ type: 'text', text: value.text }];
    }
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/** The generation tool. */
function generateTool(ctx, studio, getConfig) {
    return {
        name: 'h3_generate',
        description: [
            'Generate a video with MiniMax H3 on the configured ComfyUI server.',
            `Modes: ${MODE_HELP}.`,
            't2v needs only a prompt. i2v needs one reference image as the first frame. r2v takes up to 9 reference images that the prompt addresses as <Picture 1>, <Picture 2>, …',
            'Reference images must already live in ComfyUI\'s input directory — put them there first with h3_assets action: "upload" (pass a local file path) and use the returned name in `refs`.',
            'Durations snap up to H3\'s legal frame counts (5 mod 17: 5, 22, 39, …, 124, 158, 243, 362, 481), so 5s becomes 124 frames (≈5.17s) and 6s becomes 158 (≈6.58s) — the snap adds up to ~0.7s.',
            'Turbo (Lightning LoRA) cuts steps from 20 to 8 (r2v: 4) and is much faster with a small quality cost; enable it with turbo: true.',
            'Defaults to mode: "async" — the call returns a job id and the harness notifies this session when the clip is ready. Use mode: "sync" only when you can afford to block.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The prompt. For r2v refer to reference images as <Picture 1>, <Picture 2>, … For i2v describe the motion starting from the given frame. Shot lists, camera moves and audio directions in the prompt all land (e.g. "CUT 1: … CUT 2: …", "Audio: …").',
                },
                mode: { type: 'string', enum: MODE_IDS, default: 't2v', description: 't2v text→video; i2v image→video (exactly one ref, the first frame); r2v reference→video (1–9 refs).' },
                refs: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Reference image file names in ComfyUI\'s input directory (the `name` returned by h3_assets action: "upload").',
                },
                aspect: { type: 'string', description: 'Aspect ratio exactly as the ResolutionSelector node spells it, e.g. "16:9 (Widescreen)", "9:16 (Portrait Widescreen)", "1:1 (Square)", "21:9 (Cinematic)". A bare "16:9" is also accepted.' },
                width: { type: 'number', description: 'Explicit output width; must be paired with height and overrides aspect/megapixels.' },
                height: { type: 'number', description: 'Explicit output height; must be paired with width.' },
                megapixels: { type: 'number', description: `Size budget when aspect is used, ${LIMITS.megapixelsMin}–${LIMITS.megapixelsMax}. Default 0.4 — H3 is trained near this and larger sizes cost a lot of VRAM.` },
                duration: { type: 'number', description: `Clip length in seconds, ${LIMITS.durationMin}–${LIMITS.durationMax}. Snapped up to a legal frame count. Default 5.` },
                frames: { type: 'number', description: 'Explicit frame count, bypassing duration. Snapped up to the nearest legal frame count ≡ 5 (mod 17) ≥ your input.' },
                fps: { type: 'number', description: 'Frame rate of the assembled video (default 24). Changing it changes what a duration means.' },
                seed: { type: 'number', description: 'Noise seed. Omit (or pass -1 / "random") for a fresh random seed every call; pass a number to reproduce a shot.' },
                turbo: { type: 'boolean', description: 'Enable the Turbo/Lightning LoRA and its distilled step count.' },
                steps: { type: 'number', description: 'Override the sampler step count (otherwise 20 full / 8 turbo, or 4 for r2v turbo).' },
                filename_prefix: { type: 'string', description: 'ComfyUI SaveVideo filename prefix, e.g. "film/shot03".' },
                title: { type: 'string', description: 'A label for this clip in the run history and shot board.' },
                models: {
                    type: 'object',
                    description: 'Per-slot model file overrides, e.g. {"unet": "…fp8.safetensors", "lora": "…", "clip": "…", "vaeVideo": "…", "vaeAudio": "…"}. Check what the server has with h3_runs action: "inventory".',
                },
                project_id: { type: 'string', description: 'Attach the run to a shot-board project (see h3_project).' },
                shot_id: { type: 'string', description: 'Attach the run to one shot of that project.' },
                mode_run: { type: 'string', enum: ['sync', 'async'], default: 'async', description: 'sync waits and returns the media; async returns a background job id.' },
                timeout_ms: { type: 'number', minimum: 5_000, maximum: 3_600_000, description: 'How long to wait before giving up (sync mode, or the async job budget). Default 30 minutes.' },
            },
            required: ['prompt'],
        },
        output: {
            schema: { type: 'object' },
            render: renderGenerate,
            presentationMeta(_args, value) {
                const result = value;
                if (result?.kind === 'background') {
                    return { kind: 'background', jobId: result.jobId, promptId: result.promptId, runId: result.runId };
                }
                return {
                    kind: 'sync',
                    runId: result?.runId,
                    promptId: result?.promptId,
                    status: result?.status,
                    media: result?.media ?? [],
                    summary: result?.summary,
                };
            },
        },
        timeoutMs: TOOL_TIMEOUT_MS,
        async execute(args, exec) {
            const config = getConfig();
            const runMode = args.mode_run === 'sync' ? 'sync' : 'async';
            const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : config.timeoutMs;
            const { run, promptId } = await studio.generate(args);

            const finish = async (signal) => {
                const settled = await studio.waitRun(run, { signal, timeoutMs });
                return {
                    kind: 'sync',
                    runId: settled.id,
                    promptId,
                    status: settled.status,
                    mode: settled.mode,
                    summary: settled.summary,
                    elapsedMs: settled.elapsedMs,
                    media: settled.media ?? [],
                    error: settled.error,
                };
            };

            if (runMode === 'sync') {
                return await finish(exec.signal);
            }
            const jobs = ctx.get('jobs');
            if (jobs === undefined) {
                // No job registry in this composition: degrade to a blocking wait
                // rather than failing a generation the server already accepted.
                return await finish(exec.signal);
            }
            const jobId = jobs.start({
                kind: 'h3',
                label: `MiniMax H3 ${run.modeLabel}${run.title !== '' ? ` · ${run.title}` : ''}`,
                ...(exec.agent !== undefined ? { owner: exec.agent } : {}),
                run: (job) => {
                    job.append(`run ${run.id} · prompt ${run.promptId}\n${run.summary}\n`);
                    const done = (async () => {
                        const settled = await studio.waitRun(run, { timeoutMs });
                        if (settled.status !== 'completed') {
                            return { status: 'failed', detail: 'minimax-h3', output: settled.error ?? 'generation failed' };
                        }
                        job.append(`completed in ${((settled.elapsedMs ?? 0) / 1000).toFixed(1)}s\n`);
                        for (const item of settled.media ?? []) job.append(`${item.kind}: ${item.url}\n`);
                        return {
                            status: 'completed',
                            output: JSON.stringify({
                                kind: 'sync',
                                runId: settled.id,
                                promptId,
                                status: settled.status,
                                mode: settled.mode,
                                summary: settled.summary,
                                elapsedMs: settled.elapsedMs,
                                media: settled.media ?? [],
                            }),
                        };
                    })();
                    return {
                        cancel: () => {
                            void studio.cancel({ promptId, runId: run.id }).catch(() => undefined);
                        },
                        done,
                    };
                },
            });
            return { kind: 'background', jobId, promptId, runId: run.id };
        },
    };
}

/** Run history, queue state and model inventory. */
function runsTool(studio) {
    return {
        name: 'h3_runs',
        description: [
            'Look at MiniMax H3 activity: the plugin\'s own run history, ComfyUI\'s live queue, and whether the model files a mode needs are actually installed.',
            'Actions: "list" (recent runs), "get" (one run), "queue" (ComfyUI running/pending prompts), "inventory" (which H3 unet/clip/vae/lora files the server has, per mode), "cancel" (interrupt a run), "delete" (drop a history record).',
            'Call action: "inventory" before the first generation on a new machine: it names the exact files to download instead of letting a run fail deep inside the sampler.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'get', 'queue', 'inventory', 'cancel', 'delete'], default: 'list' },
                run_id: { type: 'string', description: 'Run id for get / cancel / delete.' },
                prompt_id: { type: 'string', description: 'ComfyUI prompt id to interrupt instead of a run id.' },
                mode: { type: 'string', enum: MODE_IDS, description: 'Mode for action: "inventory" (defaults to every mode).' },
                limit: { type: 'number', minimum: 1, maximum: 200, default: 20, description: 'How many runs action: "list" returns.' },
            },
            required: [],
        },
        output: { schema: { type: 'string' }, render: renderText },
        timeoutMs: 120_000,
        async execute(args) {
            const action = typeof args.action === 'string' ? args.action : 'list';
            if (action === 'list') {
                const runs = await studio.store.listRuns();
                const limit = Math.min(200, Math.max(1, Number(args.limit) || 20));
                const items = runs.slice(0, limit).map((run) => ({
                    id: run.id,
                    mode: run.mode,
                    status: run.status,
                    title: run.title,
                    promptId: run.promptId,
                    summary: run.summary,
                    createdAt: run.createdAt,
                    elapsedMs: run.elapsedMs,
                    media: (run.media ?? []).map((item) => ({ kind: item.kind, url: item.url, filename: item.filename })),
                    error: run.error,
                }));
                const lines = items.length === 0
                    ? ['No MiniMax H3 runs recorded yet.']
                    : items.map((run) => `${run.id}  ${run.status.padEnd(9)} ${run.mode}  ${run.title || run.summary || ''}`.trimEnd());
                return lines.join('\n');
            }
            if (action === 'get') {
                if (typeof args.run_id !== 'string' || args.run_id === '') throw new Error('h3_runs: action "get" needs run_id');
                const run = await studio.store.getRun(args.run_id);
                if (run === undefined) throw new Error(`h3_runs: unknown run "${args.run_id}"`);
                return JSON.stringify(run, null, 2);
            }
            if (action === 'queue') {
                const client = await studio.clientFor();
                const queue = await client.getQueue();
                const lines = [
                    `running: ${queue.running.length}`,
                    ...queue.running.map((item) => `  #${item.number} ${item.promptId}`),
                    `pending: ${queue.pending.length}`,
                    ...queue.pending.map((item) => `  #${item.number} ${item.promptId}`),
                ];
                return lines.join('\n');
            }
            if (action === 'inventory') {
                const modes = typeof args.mode === 'string' && MODE_IDS.includes(args.mode) ? [args.mode] : MODE_IDS;
                const lines = [];
                for (const mode of modes) {
                    const report = await studio.meta();
                    const entry = report.inventory[mode];
                    lines.push(`${mode} (${MODES[mode].label}):`);
                    if (!entry.checked) {
                        lines.push('  ComfyUI did not answer /object_info — presence unknown. Check the server address with h3_assets action: "ffmpeg" / the plugin settings.');
                        continue;
                    }
                    for (const slot of entry.slots) {
                        const verdict = slot.present === true ? 'OK      ' : slot.present === false ? 'MISSING ' : 'UNKNOWN ';
                        lines.push(`  ${verdict} ${slot.label}: ${slot.file}`);
                        if (slot.alternatives.length > 0) {
                            lines.push(`           alternatives on the server: ${slot.alternatives.slice(0, 4).join(', ')}`);
                        }
                    }
                }
                return lines.join('\n');
            }
            if (action === 'cancel') {
                if (typeof args.run_id !== 'string' && typeof args.prompt_id !== 'string') {
                    throw new Error('h3_runs: action "cancel" needs run_id or prompt_id');
                }
                const result = await studio.cancel({ runId: args.run_id, promptId: args.prompt_id });
                return `interrupted${result.promptId !== null ? ` ${result.promptId}` : ' the running prompt'}`;
            }
            if (action === 'delete') {
                if (typeof args.run_id !== 'string' || args.run_id === '') throw new Error('h3_runs: action "delete" needs run_id');
                const removed = await studio.store.deleteRun(args.run_id);
                return removed ? `deleted ${args.run_id}` : `no run ${args.run_id}`;
            }
            throw new Error(`h3_runs: unknown action "${String(args.action)}"`);
        },
    };
}

/** Reference-asset tool: get local images into ComfyUI so a graph can use them. */
function assetsTool(studio, getConfig) {
    return {
        name: 'h3_assets',
        description: [
            'Manage the media MiniMax H3 graphs consume and the FFmpeg tooling they need.',
            'Actions: "list" (ComfyUI input/output files, plugin uploads and finished renders), "upload" (push a local file into ComfyUI\'s input directory and get back the name to use in `refs`), "attach" (copy a local file into the plugin\'s own uploads, for FFmpeg extras like a watermark, music or a .srt), "ffmpeg" (report the detected FFmpeg/FFprobe and how to fix it when missing), "diagnose" (one report covering reachability, the route prefix the server settled on, which endpoints answer, whether the H3 nodes exist there, and the local FFmpeg).',
            'Run "diagnose" first whenever the target ComfyUI is remote — a rented GPU, a LAN box, or a tunnel: it distinguishes "wrong address/port" from "ComfyUI predates H3" from "no local FFmpeg" in one call.',
            'Typical flow for image-to-video: generate a still frame, h3_assets action: "upload" with its path, then h3_generate with mode: "i2v" and refs: [<returned name>].',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'upload', 'attach', 'ffmpeg', 'diagnose'], default: 'list' },
                path: { type: 'string', description: 'Absolute local file path for action: "upload" / "attach".' },
                subfolder: { type: 'string', description: 'Optional ComfyUI input subfolder for action: "upload".' },
                limit: { type: 'number', minimum: 1, maximum: 500, default: 120 },
            },
            required: [],
        },
        output: { schema: { type: 'string' }, render: renderText },
        timeoutMs: 300_000,
        async execute(args) {
            const action = typeof args.action === 'string' ? args.action : 'list';
            if (action === 'list') {
                const assets = await studio.listAssets();
                const limit = Math.min(500, Math.max(1, Number(args.limit) || 120));
                const section = (title, items, note) => {
                    if (items.length === 0) return [`${title}: (none${note !== undefined ? ` — ${note}` : ''})`];
                    return [`${title} (${items.length}):`, ...items.slice(0, limit).map((item) => `  ${item.name}`)];
                };
                const lines = [
                    ...section('ComfyUI input (usable as `refs`)', assets.inputs),
                    ...section('Plugin uploads (FFmpeg extras, use "upload:<name>")', assets.uploads),
                    ...section('Finished renders (use "render:<name>")', assets.renders),
                    ...section('ComfyUI output (recent generations)', assets.outputs),
                ];
                return lines.join('\n');
            }
            if (action === 'upload') {
                const file = typeof args.path === 'string' ? args.path.trim() : '';
                if (file === '') throw new Error('h3_assets: action "upload" needs an absolute `path`');
                const bytes = await readFile(file);
                const client = await studio.clientFor();
                const name = basename(file);
                const result = await client.uploadMedia(bytes, name, guessContentType(name), {
                    subfolder: typeof args.subfolder === 'string' ? args.subfolder : undefined,
                });
                const stored = typeof result?.name === 'string' && result.name !== '' ? result.name : name;
                const subfolder = typeof result?.subfolder === 'string' ? result.subfolder : '';
                const useName = subfolder !== '' ? `${subfolder}/${stored}` : stored;
                await studio.rememberAsset(useName, { size: bytes.length, ext: extname(name).toLowerCase() });
                return [
                    `uploaded ${file} → ComfyUI input as "${useName}"`,
                    `use it as refs: ["${useName}"]`,
                ].join('\n');
            }
            if (action === 'attach') {
                const file = typeof args.path === 'string' ? args.path.trim() : '';
                if (file === '') throw new Error('h3_assets: action "attach" needs an absolute `path`');
                const bytes = await readFile(file);
                const saved = await studio.saveUpload(bytes, basename(file));
                return `attached as "upload:${saved.name}" (${saved.size} bytes) — pass it in h3_post's extras.`;
            }
            if (action === 'diagnose') {
                const report = await studio.diagnose();
                const mark = (ok) => (ok === true ? 'OK     ' : ok === false ? 'FAIL   ' : 'UNKNOWN');
                const lines = [
                    `baseUrl        ${report.baseUrl}`,
                    `reachable      ${mark(report.endpoints.systemStats)}${report.version !== '' ? ` ComfyUI ${report.version}` : ''} ${report.latencyMs} ms`,
                    `route prefix   "${report.routePrefix === '' ? '/' : report.routePrefix}"  (a proxy that only forwards /api/* shows up here)`,
                    `auth           ${report.authConfigured ? `${report.authHeader}${report.authScheme === '' ? '' : ` ${report.authScheme}`}` : 'none configured'}`,
                    'endpoints:',
                    ...Object.entries(report.endpoints).map(([name, ok]) => `  ${mark(ok)} /${name}`),
                ];
                if (Object.keys(report.h3).length > 0) {
                    lines.push('H3 nodes on that server:');
                    for (const [name, ok] of Object.entries(report.h3)) lines.push(`  ${mark(ok)} ${name}`);
                }
                lines.push(`ffmpeg (this machine)  ${report.ffmpeg?.ok === true ? `OK ${report.ffmpeg.version}` : `FAIL ${report.ffmpeg?.error ?? ''}`}`);
                lines.push(`local ComfyUI dirs configured: ${report.comfyuiDirs}`);
                if (report.error !== '') lines.push(`error: ${report.error}`);
                if (Object.values(report.h3).some((value) => value === false)) {
                    lines.push('→ The H3 nodes are missing there: that ComfyUI may predate 0.33, or MiniMax H3 support is not installed.');
                }
                return lines.join('\n');
            }
            if (action === 'ffmpeg') {
                const detection = await resolveFFmpeg(getConfig(), { force: true });
                if (!detection.ok) {
                    return [
                        detection.error,
                        'Tried:',
                        ...detection.tried.map((entry) => `  ${entry.candidate} — ${entry.reason}`),
                    ].join('\n');
                }
                return [
                    `ffmpeg: ${detection.ffmpeg}`,
                    `version: ${detection.version}`,
                    `ffprobe: ${detection.ffprobe ?? '(not found — probing and duration-dependent ops are limited)'}`,
                ].join('\n');
            }
            throw new Error(`h3_assets: unknown action "${String(args.action)}"`);
        },
    };
}

/** FFmpeg finishing. */
function postTool(ctx, studio) {
    const opsHelp = POST_OPS.map((op) => `${op.id} (${op.label})`).join(', ');
    return {
        name: 'h3_post',
        description: [
            'Finish MiniMax H3 clips with FFmpeg: cut, join, score, caption, reframe, deliver.',
            'Actions: "list" (every operation and its parameters), "run" (execute one), "renders" (previous outputs), "delete".',
            `Operations: ${opsHelp}.`,
            'Address the input with `source`: "run:<runId>:<index>" for a generated clip, "render:<name>" for a previous FFmpeg output, or "upload:<name>" for a file attached with h3_assets.',
            '`extras` are additional inputs, in the order the operation expects them (watermark image for watermark, music/voice for merge_audio, .srt/.ass for subtitle, the second clip for stack).',
            '`options` keys are exactly the parameter names action: "list" reports.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'run', 'renders', 'delete'], default: 'run' },
                op: { type: 'string', description: `Operation id: ${POST_OPS.map((entry) => entry.id).join(' | ')}.` },
                source: { type: 'string', description: 'Input media: "run:<runId>:<index>", "render:<name>", "upload:<name>", or a ComfyUI output file name.' },
                extras: { type: 'array', items: { type: 'string' }, description: 'Additional inputs, in the order the operation documents.' },
                options: { type: 'object', description: 'Operation parameters; omitted ones take the documented default.' },
                render_id: { type: 'string', description: 'For action: "delete".' },
                timeout_ms: { type: 'number', minimum: 5_000, maximum: 3_600_000, description: 'FFmpeg budget (default 30 minutes).' },
            },
            required: [],
        },
        output: {
            schema: { type: 'string' },
            render: renderText,
            /** The panel card renders a finished clip from this, not from the text. */
            presentationMeta(_args, value) {
                if (value !== null && typeof value === 'object' && typeof value.render === 'object' && value.render !== null) {
                    // Nested under `render` on purpose: the render record has its own
                    // `kind` ('video'/'audio'/'image'), which would otherwise overwrite
                    // the card's dispatch key.
                    return { kind: 'post', render: value.render };
                }
                return { kind: 'note' };
            },
        },
        timeoutMs: TOOL_TIMEOUT_MS,
        async execute(args, exec) {
            const action = typeof args.action === 'string' ? args.action : 'run';
            if (action === 'list') {
                const lines = [];
                for (const op of POST_OPS) {
                    lines.push(`${op.id}  [${op.group}]  ${op.label} / ${op.labelEn}`);
                    lines.push(`  ${op.description}`);
                    if (op.needsExtras === true) lines.push('  needs `extras`');
                    for (const param of op.params) {
                        const choices = param.type === 'enum' ? ` one of ${param.options.join('|')}` : '';
                        lines.push(`  - ${param.name} (${param.type}${choices}) default=${JSON.stringify(param.default)}  ${param.label ?? ''}`);
                    }
                }
                return lines.join('\n');
            }
            if (action === 'renders') {
                const renders = await studio.store.listRenders();
                if (renders.length === 0) return 'No FFmpeg renders yet.';
                return renders.slice(0, 40).map((render) => [
                    `${render.id}  ${render.op}  ${render.output}`,
                    `  ${render.note || ''} ${render.sizeBytes} bytes, ${((render.elapsedMs ?? 0) / 1000).toFixed(1)}s`,
                    ...(render.probe !== undefined && render.probe !== null
                        ? [`  ${render.probe.width}×${render.probe.height} ${render.probe.fps ?? '?'}fps ${(render.probe.duration ?? 0).toFixed(2)}s ${render.probe.hasAudio ? 'with audio' : 'silent'}`]
                        : []),
                    `  use as source: "render:${render.output}"`,
                ].join('\n')).join('\n');
            }
            if (action === 'delete') {
                if (typeof args.render_id !== 'string' || args.render_id === '') throw new Error('h3_post: action "delete" needs render_id');
                const render = await studio.store.getRender(args.render_id);
                if (render === undefined) throw new Error(`h3_post: unknown render "${args.render_id}"`);
                // Resolve through the same guarded lookup the routes use, rather
                // than rebuilding the path with a hardcoded separator.
                const file = await studio.localFile('render', render.output);
                if (file !== undefined) await studio.store.removeFile(file.path);
                await studio.store.deleteRender(args.render_id);
                return `deleted ${args.render_id}${file === undefined ? '（文件已不在磁盘上）' : ''}`;
            }
            if (action !== 'run') throw new Error(`h3_post: unknown action "${String(args.action)}"`);

            if (typeof args.op !== 'string' || findOp(args.op) === undefined) {
                throw new Error(`h3_post: op must be one of ${POST_OPS.map((entry) => entry.id).join(', ')}`);
            }
            const request = {
                op: args.op,
                source: args.source,
                extras: Array.isArray(args.extras) ? args.extras : [],
                options: withDefaults(args.op, typeof args.options === 'object' && args.options !== null ? args.options : {}),
            };
            const result = await studio.runPost(request, { signal: exec.signal });
            const render = result.render;
            const text = [
                `h3_post ${render.op} done — ${render.output}`,
                render.note !== '' ? `  ${render.note}` : undefined,
                `  ${render.sizeBytes} bytes in ${(render.elapsedMs / 1000).toFixed(1)}s`,
                render.probe !== undefined && render.probe !== null
                    ? `  ${render.probe.width}×${render.probe.height} ${render.probe.fps ?? '?'}fps ${(render.probe.duration ?? 0).toFixed(2)}s${render.probe.hasAudio ? ', with audio' : ', silent'}`
                    : undefined,
                `  render id ${render.id}; use as source: "render:${render.output}"`,
            ].filter((line) => line !== undefined).join('\n');
            return {
                text,
                render: {
                    id: render.id,
                    op: render.op,
                    opLabel: render.opLabel,
                    output: render.output,
                    // A relative URL resolves against whatever origin the page is
                    // served from, which is the one the browser can actually reach.
                    url: render.output === '' ? undefined : `/minimaxh3/render?name=${encodeURIComponent(render.output)}`,
                    kind: /\.(mp4|webm|mov|mkv|m4v)$/i.test(render.output) ? 'video'
                        : /\.(mp3|wav|m4a|flac|aac|ogg|opus)$/i.test(render.output) ? 'audio'
                            : 'image',
                    sizeBytes: render.sizeBytes,
                    elapsedMs: render.elapsedMs,
                    note: render.note,
                    probe: render.probe,
                },
            };
        },
    };
}

/** The shot board: a project, its shots, and batch generation over them. */
function projectTool(ctx, studio) {
    return {
        name: 'h3_project',
        description: [
            'Keep a shot board for a film: one project holds an ordered list of shots, each with its own mode, prompt, references, duration and aspect — plus the clip it produced.',
            'Actions: "list", "get", "save" (create or update a project and merge shots by id), "add_shots" (append shots), "delete".',
            'Generation stays a separate step: run each shot with h3_generate (pass project_id/shot_id so the result links back), then assemble the finished clips with h3_post op: "concat".',
            'Use a project when a piece has more than a couple of shots: it is what keeps prompts, seeds and reference images from drifting between sessions.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'get', 'save', 'add_shots', 'delete'], default: 'list' },
                id: { type: 'string', description: 'Project id for get / save / add_shots / delete.' },
                name: { type: 'string', description: 'Project title.' },
                style: { type: 'string', description: 'A style/look description shared by every shot — prepend or append it to each prompt so the whole film stays consistent.' },
                notes: { type: 'string', description: 'Free-form production notes.' },
                shots: {
                    type: 'array',
                    description: 'Shots to write. Each: { id?, title, mode, prompt, refs, duration, aspect, seed, turbo, status, notes }.',
                    items: { type: 'object' },
                },
                remove_shot_ids: { type: 'array', items: { type: 'string' }, description: 'Shot ids to drop.' },
            },
            required: [],
        },
        output: { schema: { type: 'string' }, render: renderText },
        timeoutMs: 60_000,
        async execute(args) {
            const action = typeof args.action === 'string' ? args.action : 'list';
            if (action === 'list') {
                const projects = await studio.store.listProjects();
                if (projects.length === 0) return 'No projects yet. Create one with h3_project action: "save".';
                return projects.map((project) => {
                    const shots = project.shots ?? [];
                    const done = shots.filter((shot) => shot.status === 'done').length;
                    return `${project.id}  ${project.name ?? '(untitled)'}  ${shots.length} shots (${done} done)  updated ${project.updatedAt ?? ''}`;
                }).join('\n');
            }
            if (action === 'get') {
                if (typeof args.id !== 'string' || args.id === '') throw new Error('h3_project: action "get" needs id');
                const project = await studio.store.getProject(args.id);
                if (project === undefined) throw new Error(`h3_project: unknown project "${args.id}"`);
                return JSON.stringify(project, null, 2);
            }
            if (action === 'delete') {
                if (typeof args.id !== 'string' || args.id === '') throw new Error('h3_project: action "delete" needs id');
                const removed = await studio.store.deleteProject(args.id);
                return removed ? `deleted ${args.id}` : `no project ${args.id}`;
            }
            if (action === 'save' || action === 'add_shots') {
                const input = {
                    id: typeof args.id === 'string' && args.id !== '' ? args.id : undefined,
                    ...(typeof args.name === 'string' ? { name: args.name } : {}),
                    ...(typeof args.style === 'string' ? { style: args.style } : {}),
                    ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
                    ...(Array.isArray(args.shots) ? { shots: args.shots } : {}),
                    ...(Array.isArray(args.remove_shot_ids) ? { removeShotIds: args.remove_shot_ids } : {}),
                };
                if (input.id === undefined && typeof input.name !== 'string') {
                    throw new Error('h3_project: creating a project needs a name');
                }
                const project = await studio.store.saveProject(input);
                const shots = project.shots ?? [];
                return [
                    `${project.id}  ${project.name ?? ''}  ${shots.length} shots`,
                    ...shots.map((shot, index) => `  ${String(index + 1).padStart(2, '0')}  ${shot.id}  ${shot.mode}  ${(shot.title || shot.prompt || '').slice(0, 70)}`),
                    'Generate with h3_generate (pass project_id and shot_id), then assemble with h3_post op: "concat".',
                ].join('\n');
            }
            throw new Error(`h3_project: unknown action "${String(args.action)}"`);
        },
    };
}

/** Register every tool on the plugin's fiber and return the disposers. */
export function registerH3Tools(ctx, studio, getConfig) {
    const definitions = [
        generateTool(ctx, studio, getConfig),
        runsTool(studio),
        assetsTool(studio, getConfig),
        postTool(ctx, studio),
        projectTool(ctx, studio),
    ];
    return definitions.map((definition) => ctx.tools.register(definition));
}