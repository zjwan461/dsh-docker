/**
 * Same-origin HTTP routes for the panel.
 *
 * Everything the panel does goes through here rather than calling ComfyUI
 * directly, for two reasons: the ComfyUI API key never reaches the browser, and
 * generated media is re-served from this origin so the page does not need
 * CORS or a second host to preview a clip.
 *
 * Requests that genuinely take minutes (generation, FFmpeg) are started and
 * answered immediately; the panel polls the corresponding list endpoint. A
 * request handler that blocks for ten minutes is a request handler that dies
 * behind a proxy.
 */
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
    errorMessage,
    methodIs,
    readJsonBody,
    readRawBody,
    sameOrigin,
    sendJson,
} from './http.js';
import { guessContentType } from './comfy.js';
import { resolveFFmpeg } from './ffmpeg.js';

/** In-flight FFmpeg runs started from the panel, keyed by a request-scoped id. */
const activePosts = new Map();
/** How long a finished post record stays visible to polling. */
const POST_RETENTION_MS = 10 * 60_000;

function prunePosts() {
    const cutoff = Date.now() - POST_RETENTION_MS;
    for (const [id, record] of activePosts) {
        if (record.status !== 'running' && record.startedAt < cutoff) activePosts.delete(id);
    }
}

/** A redacted view of the config, safe to hand to the browser. */
function redact(config, detection, hasApiKey, writable) {
    return {
        baseUrl: config.baseUrl,
        apiKeyEnv: config.apiKeyEnv,
        authHeader: config.authHeader,
        authScheme: config.authScheme,
        hasApiKey,
        timeoutMs: config.timeoutMs,
        connectTimeoutMs: config.connectTimeoutMs,
        mediaHost: config.mediaHost,
        dataDir: config.dataDir,
        comfyuiDirs: config.comfyuiDirs,
        ffmpegPath: config.ffmpegPath,
        ffprobePath: config.ffprobePath,
        ffmpegDetected: detection.ok ? detection.ffmpeg : '',
        ffmpegVersion: detection.ok ? detection.version : '',
        defaults: {
            aspect: config.defaultAspect,
            megapixels: config.defaultMegapixels,
            duration: config.defaultDuration,
            mode: config.defaultMode,
            turbo: config.defaultTurbo,
        },
        writable,
    };
}

/** Serve a local file with Range support, so video seeking works. */
function serveLocal(request, response, file, contentType) {
    const size = file.size;
    const range = request.headers.range;
    const headers = {
        'content-type': contentType,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
    };
    if (typeof range !== 'string' || range === '') {
        response.writeHead(200, { ...headers, 'content-length': size });
        if (methodIs(request, 'HEAD')) {
            response.end();
            return;
        }
        createReadStream(file.path).pipe(response);
        return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match === null) {
        response.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
        response.end();
        return;
    }
    const startRaw = match[1];
    const endRaw = match[2];
    let start = startRaw === '' ? undefined : Number(startRaw);
    let end = endRaw === '' ? undefined : Number(endRaw);
    if (start === undefined && end !== undefined) {
        // A suffix range: the last N bytes.
        start = Math.max(0, size - end);
        end = size - 1;
    }
    if (start === undefined) start = 0;
    if (end === undefined || end >= size) end = size - 1;
    if (start > end || start >= size) {
        response.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
        response.end();
        return;
    }
    response.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
    });
    if (methodIs(request, 'HEAD')) {
        response.end();
        return;
    }
    createReadStream(file.path, { start, end }).pipe(response);
}

/**
 * Mount every panel route.
 *
 * @returns a disposer, or undefined when there is no web server to mount on.
 */
export function mountH3Routes(ctx, deps) {
    const { studio, getConfig, getApiKey, updateConfig, settingsWritable, hostHint, proxyBase } = deps;
    const webServer = ctx.get('webServer');
    if (webServer === undefined) return undefined;

    const disposers = [];
    /** Record the browser's origin on every route so media URLs match it. */
    const withHint = (handler) => (request, response) => {
        hostHint.record(request);
        return handler(request, response);
    };
    const route = (path, handler) => {
        disposers.push(webServer.register({ kind: 'exact', path, handler: withHint(handler) }));
    };
    /** Guard state-changing calls: same-origin POST only. */
    const guardPost = (request, response) => {
        if (!methodIs(request, 'POST')) {
            sendJson(response, 405, { error: 'method not allowed' });
            return false;
        }
        if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'forbidden: same-origin requests only' });
            return false;
        }
        return true;
    };

    route('/minimaxh3/ping', async (_request, response) => {
        sendJson(response, 200, { ok: true });
    });

    route('/minimaxh3/meta', async (_request, response) => {
        try {
            sendJson(response, 200, await studio.meta());
        }
        catch (error) {
            sendJson(response, 500, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/config', async (request, response) => {
        const config = getConfig();
        const detection = await resolveFFmpeg(config);
        if (methodIs(request, 'GET')) {
            const apiKey = await getApiKey();
            sendJson(response, 200, redact(config, detection, apiKey !== undefined && apiKey !== '', settingsWritable()));
            return;
        }
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: `invalid body: ${errorMessage(error)}` });
            return;
        }
        const patch = body?.patch;
        if (typeof patch !== 'object' || patch === null) {
            sendJson(response, 400, { error: 'a patch object is required' });
            return;
        }
        const result = await updateConfig(patch);
        if (!result.ok) {
            sendJson(response, 409, { error: result.error });
            return;
        }
        const apiKey = await getApiKey();
        sendJson(response, 200, {
            ok: true,
            ignored: result.ignored ?? [],
            config: redact(getConfig(), await resolveFFmpeg(getConfig(), { force: true }), apiKey !== undefined && apiKey !== '', settingsWritable()),
        });
    });

    route('/minimaxh3/test', async (request, response) => {
        if (!guardPost(request, response)) return;
        try {
            const report = await studio.diagnose();
            sendJson(response, 200, { ok: report.endpoints.systemStats === true, report });
        }
        catch (error) {
            sendJson(response, 200, { ok: false, error: errorMessage(error), report: null });
        }
    });

    route('/minimaxh3/generate', async (request, response) => {
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: `invalid body: ${errorMessage(error)}` });
            return;
        }
        try {
            const { run, promptId } = await studio.generate(body ?? {});
            sendJson(response, 200, { ok: true, run, promptId });
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/runs', async (request, response) => {
        try {
            const runs = await studio.store.listRuns();
            const url = new URL(request.url ?? '/', 'http://localhost');
            const id = url.searchParams.get('id');
            if (id !== null && id !== '') {
                sendJson(response, 200, { ok: true, run: runs.find((run) => run.id === id) ?? null });
                return;
            }
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 30));
            sendJson(response, 200, { ok: true, runs: runs.slice(0, limit) });
        }
        catch (error) {
            sendJson(response, 500, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/runs/cancel', async (request, response) => {
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
            return;
        }
        try {
            const result = await studio.cancel({ runId: body?.runId, promptId: body?.promptId });
            sendJson(response, 200, { ok: true, ...result });
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/runs/delete', async (request, response) => {
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
            return;
        }
        const removed = typeof body?.runId === 'string' ? await studio.store.deleteRun(body.runId) : false;
        sendJson(response, 200, { ok: true, removed });
    });

    route('/minimaxh3/queue', async (_request, response) => {
        try {
            const client = await studio.clientFor();
            sendJson(response, 200, { ok: true, ...(await client.getQueue()) });
        }
        catch (error) {
            sendJson(response, 500, { error: errorMessage(error) });
        }
    });

    /** Stream one generated file from ComfyUI through this origin, Range included. */
    route('/minimaxh3/media', async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const filename = url.searchParams.get('filename') ?? '';
        if (filename === '') {
            sendJson(response, 400, { error: 'filename is required' });
            return;
        }
        try {
            const client = await studio.clientFor();
            const upstream = await client.fetchViewStreamed(
                {
                    filename,
                    subfolder: url.searchParams.get('subfolder') ?? '',
                    type: url.searchParams.get('type') ?? 'output',
                },
                request.headers.range,
                methodIs(request, 'HEAD') ? 'HEAD' : 'GET',
            );
            const headers = {};
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
                const value = upstream.headers.get(name);
                if (value !== null) headers[name] = value;
            }
            if (headers['content-type'] === undefined) headers['content-type'] = guessContentType(filename);
            headers['cache-control'] = 'no-store';
            response.writeHead(upstream.status, headers);
            if (upstream.body === null || methodIs(request, 'HEAD')) {
                response.end();
                return;
            }
            Readable.fromWeb(upstream.body).pipe(response);
        }
        catch (error) {
            if (!response.headersSent) sendJson(response, 502, { error: errorMessage(error) });
            else response.end();
        }
    });

    /** Serve a finished render or an uploaded extra from the plugin's own data dir. */
    const serveOwn = (kind) => async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const name = url.searchParams.get('name') ?? '';
        if (name === '') {
            sendJson(response, 400, { error: 'name is required' });
            return;
        }
        const file = await studio.localFile(kind, name);
        if (file === undefined) {
            sendJson(response, 404, { error: `${kind} "${name}" not found` });
            return;
        }
        serveLocal(request, response, file, guessContentType(basename(file.path)));
    };
    route('/minimaxh3/render', serveOwn('render'));
    route('/minimaxh3/upload', serveOwn('upload'));

    /**
     * Accept an upload for use as an FFmpeg extra (watermark, music, .srt).
     *
     * The body is the raw bytes with the intended name in `?name=`: no
     * multipart parser, and nothing about the file is interpreted here beyond
     * its name.
     */
    route('/minimaxh3/upload/save', async (request, response) => {
        if (!guardPost(request, response)) return;
        const url = new URL(request.url ?? '/', 'http://localhost');
        const name = url.searchParams.get('name') ?? '';
        if (name === '') {
            sendJson(response, 400, { error: 'name is required' });
            return;
        }
        try {
            const bytes = await readRawBody(request, getConfig().maxMediaBytes);
            const saved = await studio.saveUpload(bytes, name);
            sendJson(response, 200, { ok: true, ...saved, source: `upload:${saved.name}` });
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
        }
    });

    /** Upload a reference image into ComfyUI's input directory. */
    route('/minimaxh3/ref/upload', async (request, response) => {
        if (!guardPost(request, response)) return;
        const url = new URL(request.url ?? '/', 'http://localhost');
        const name = url.searchParams.get('name') ?? '';
        if (name === '') {
            sendJson(response, 400, { error: 'name is required' });
            return;
        }
        try {
            const bytes = await readRawBody(request, getConfig().maxMediaBytes);
            const client = await studio.clientFor();
            const result = await client.uploadMedia(bytes, name, guessContentType(name), {
                subfolder: url.searchParams.get('subfolder') ?? undefined,
            });
            const stored = typeof result?.name === 'string' && result.name !== '' ? result.name : name;
            const subfolder = typeof result?.subfolder === 'string' ? result.subfolder : '';
            const useName = subfolder !== '' ? `${subfolder}/${stored}` : stored;
            await studio.rememberAsset(useName, { size: bytes.length, source: 'panel' });
            sendJson(response, 200, { ok: true, name: useName, size: bytes.length });
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/assets', async (_request, response) => {
        try {
            sendJson(response, 200, { ok: true, ...(await studio.listAssets()) });
        }
        catch (error) {
            sendJson(response, 500, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/projects', async (request, response) => {
        if (methodIs(request, 'GET')) {
            const projects = await studio.store.listProjects();
            sendJson(response, 200, { ok: true, projects });
            return;
        }
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
            return;
        }
        if (body?.delete === true && typeof body.id === 'string') {
            const removed = await studio.store.deleteProject(body.id);
            sendJson(response, 200, { ok: true, removed });
            return;
        }
        try {
            const project = await studio.store.saveProject(body?.project ?? {});
            sendJson(response, 200, { ok: true, project });
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
        }
    });

    route('/minimaxh3/renders', async (_request, response) => {
        const renders = await studio.store.listRenders();
        sendJson(response, 200, { ok: true, renders });
    });

    /**
     * Start an FFmpeg op. Answers immediately with a post id; the panel polls
     * `/minimaxh3/post/status`, and the finished record also lands in
     * `/minimaxh3/renders`.
     */
    route('/minimaxh3/post', async (request, response) => {
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
            return;
        }
        const detection = await resolveFFmpeg(getConfig());
        if (!detection.ok) {
            sendJson(response, 409, { error: detection.error });
            return;
        }
        prunePosts();
        const id = `post-${randomUUID().slice(0, 8)}`;
        const record = {
            id,
            op: typeof body?.op === 'string' ? body.op : '',
            status: 'running',
            progress: 0,
            startedAt: Date.now(),
            error: null,
            render: null,
        };
        activePosts.set(id, record);
        // Deliberately not awaited: the response is sent now, the work runs on.
        void (async () => {
            try {
                const result = await studio.runPost(body ?? {}, {
                    onProgress: (fraction) => {
                        if (typeof fraction === 'number' && Number.isFinite(fraction)) record.progress = fraction;
                    },
                });
                record.status = 'completed';
                record.progress = 1;
                record.render = result.render;
                record.finishedAt = Date.now();
            }
            catch (error) {
                record.status = 'failed';
                record.error = errorMessage(error);
                record.finishedAt = Date.now();
            }
        })();
        sendJson(response, 202, { ok: true, id, status: 'running' });
    });

    route('/minimaxh3/post/status', async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const id = url.searchParams.get('id') ?? '';
        prunePosts();
        const record = activePosts.get(id);
        if (record === undefined) {
            sendJson(response, 404, { error: `no post job "${id}"` });
            return;
        }
        sendJson(response, 200, { ok: true, ...record });
    });

    route('/minimaxh3/renders/delete', async (request, response) => {
        if (!guardPost(request, response)) return;
        let body;
        try {
            body = await readJsonBody(request);
        }
        catch (error) {
            sendJson(response, 400, { error: errorMessage(error) });
            return;
        }
        const render = typeof body?.renderId === 'string' ? await studio.store.getRender(body.renderId) : undefined;
        if (render === undefined) {
            sendJson(response, 404, { error: 'no such render' });
            return;
        }
        const file = await studio.localFile('render', render.output);
        if (file !== undefined) await studio.store.removeFile(file.path);
        await studio.store.deleteRender(render.id);
        sendJson(response, 200, { ok: true });
    });

    return () => {
        for (const dispose of disposers) dispose();
    };
}