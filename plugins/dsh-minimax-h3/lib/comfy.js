/**
 * Minimal ComfyUI HTTP client for the MiniMax H3 studio.
 *
 * Only the endpoints a video studio needs are implemented: queue a prompt, poll
 * history for completion, read `/object_info` and `/system_stats`, upload
 * reference media, interrupt, and stream generated files back. The server's
 * WebSocket progress channel is deliberately unused — history polling is
 * simpler and survives reverse proxies and remote installs.
 */
import { randomUUID } from 'node:crypto';

/** Failure talking to the ComfyUI server. */
export class ComfyUIError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'ComfyUIError';
    }
}

/** The per-process client id ComfyUI correlates queued prompts with. */
export const CLIENT_ID = randomUUID();

export function sleep(millis, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(new ComfyUIError('MiniMax H3 generation aborted'));
            return;
        }
        const timer = setTimeout(resolve, millis);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new ComfyUIError('MiniMax H3 generation aborted'));
        }, { once: true });
    });
}

/** The media kind of a file name, from its extension. */
export function kindOfName(name) {
    const lower = String(name ?? '').toLowerCase();
    if (/\.(mp4|webm|mov|mkv|avi|m4v)$/.test(lower)) return 'video';
    if (/\.(mp3|wav|ogg|flac|m4a|aac|opus)$/.test(lower)) return 'audio';
    if (/\.(png|jpe?g|gif|webp|bmp|tiff?|avif)$/.test(lower)) return 'image';
    return 'other';
}

export function guessContentType(filename) {
    const lower = String(filename ?? '').toLowerCase();
    const table = [
        ['.png', 'image/png'],
        ['.jpg', 'image/jpeg'],
        ['.jpeg', 'image/jpeg'],
        ['.webp', 'image/webp'],
        ['.gif', 'image/gif'],
        ['.bmp', 'image/bmp'],
        ['.mp4', 'video/mp4'],
        ['.m4v', 'video/mp4'],
        ['.mov', 'video/quicktime'],
        ['.webm', 'video/webm'],
        ['.mkv', 'video/x-matroska'],
        ['.avi', 'video/x-msvideo'],
        ['.mp3', 'audio/mpeg'],
        ['.wav', 'audio/wav'],
        ['.ogg', 'audio/ogg'],
        ['.flac', 'audio/flac'],
        ['.m4a', 'audio/mp4'],
        ['.aac', 'audio/aac'],
        ['.opus', 'audio/opus'],
        ['.srt', 'text/plain; charset=utf-8'],
        ['.ass', 'text/plain; charset=utf-8'],
    ];
    for (const [extension, type] of table) {
        if (lower.endsWith(extension)) return type;
    }
    return 'application/octet-stream';
}

/**
 * Route prefix learned per base URL: '' when bare routes answer, '/api' when
 * only the /api-prefixed mirror does. ComfyUI serves every route under both,
 * but API-only reverse proxies forward just `/api/*`, so the bare
 * `/system_stats` probe 404s. Learned on the first request and kept for the
 * process, because clients are created per call.
 */
const routePrefix = new Map();

/**
 * Normalise the credential forms callers pass.
 *
 * Remote ComfyUI setups disagree about both the header name and the scheme: a
 * LAN box usually has none, a rented GPU behind nginx often uses
 * `Authorization: Bearer`, and some proxies want a bare `x-api-key` with no
 * scheme at all.
 *
 * Accepts a bare key string (the common case) or `{ key, header, scheme }`.
 * An explicit empty `scheme` means "send the key verbatim".
 */
function normalizeAuth(input) {
    if (input === undefined || input === null) return undefined;
    if (typeof input === 'string') {
        return input === '' ? undefined : { key: input, header: 'Authorization', scheme: 'Bearer' };
    }
    const key = typeof input.key === 'string' ? input.key : '';
    if (key === '') return undefined;
    return {
        key,
        // An explicit empty header name means "send no credential at all"; only an
        // omitted one falls back to the default. (A ternary that treated '' as
        // absent is exactly the bug this distinction avoids.)
        header: typeof input.header === 'string' ? input.header.trim() : 'Authorization',
        scheme: typeof input.scheme === 'string' ? input.scheme.trim() : 'Bearer',
    };
}

/** HTTP client over the ComfyUI REST API. */
export class ComfyUIClient {
    /**
     * @param baseUrl - ComfyUI HTTP base URL: loopback, a LAN address, or a
     *   rented GPU reachable through a port mapping or a tunnel.
     * @param auth - optional credential (see `normalizeAuth`).
     * @param connectTimeoutMs - per-request connect/read budget.
     * @param maxMediaBytes - largest file the media proxy will stream.
     */
    constructor(baseUrl, auth, connectTimeoutMs, maxMediaBytes) {
        this.baseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
        this.auth = normalizeAuth(auth);
        this.connectTimeoutMs = connectTimeoutMs ?? 10_000;
        this.maxMediaBytes = maxMediaBytes ?? 536_870_912;
    }

    /** A fresh header object carrying this client's credential. */
    authHeaders(base = {}) {
        const headers = { ...base };
        const auth = this.auth;
        if (auth === undefined || auth.header === '') return headers;
        headers[auth.header] = auth.scheme === '' ? auth.key : `${auth.scheme} ${auth.key}`;
        return headers;
    }

    /**
     * The route prefix learned for this base URL ('' or '/api'), exposed for
     * diagnostics: a proxy that only forwards `/api/*` is invisible otherwise,
     * and "which prefix did it settle on" is the first thing to check when a
     * remote server half-works.
     */
    learnedPrefix() {
        return routePrefix.get(this.base()) ?? '';
    }

    base() {
        return this.baseUrl;
    }

    endpoint(path) {
        if (path.startsWith('/api/')) return `${this.base()}${path}`;
        return `${this.base()}${routePrefix.get(this.base()) ?? ''}${path}`;
    }

    /** fetch() one route, retrying a 404 under /api until the prefix is known. */
    async fetchRoute(path, init) {
        const base = this.base();
        const response = await fetch(this.endpoint(path), init);
        if (path.startsWith('/api/') || routePrefix.has(base)) return response;
        if (response.ok) {
            routePrefix.set(base, '');
            return response;
        }
        if (response.status !== 404) return response;
        const retry = await fetch(`${base}/api${path}`, init);
        if (!retry.ok) {
            await retry.body?.cancel();
            return response;
        }
        routePrefix.set(base, '/api');
        await response.body?.cancel();
        return retry;
    }

    async request(path, init = {}, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.connectTimeoutMs);
        try {
            const headers = this.authHeaders(init.headers);
            const response = await this.fetchRoute(path, { ...init, headers, signal: controller.signal });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new ComfyUIError(
                    `ComfyUI ${path} failed: HTTP ${response.status}${body !== '' ? ` — ${body.slice(0, 400)}` : ''}`,
                    response.status,
                );
            }
            const text = await response.text();
            if (text === '') return undefined;
            try {
                return JSON.parse(text);
            }
            catch {
                throw new ComfyUIError(`ComfyUI ${path} returned a non-JSON body`);
            }
        }
        finally {
            clearTimeout(timer);
        }
    }

    /**
     * Put one file into ComfyUI's input directory.
     *
     * `/upload/image` only accepts multipart/form-data: posting raw bytes with
     * their own content-type answers HTTP 400. The form is built here so callers
     * can pass plain bytes; `overwrite: true` keeps a repeated pick from piling
     * up "name (1).png" copies.
     */
    async uploadMedia(bytes, filename, contentType, opts = {}) {
        const form = new FormData();
        form.append('image', new Blob([bytes], { type: contentType !== '' ? contentType : 'application/octet-stream' }), filename);
        form.append('overwrite', opts.overwrite === false ? 'false' : 'true');
        if (opts.subfolder !== undefined && opts.subfolder !== '') form.append('subfolder', opts.subfolder);
        const data = await this.request(
            '/upload/image',
            { method: 'POST', body: form },
            opts.timeoutMs ?? Math.max(this.connectTimeoutMs, 300_000),
        );
        return data ?? {};
    }

    /** Queue one API-format workflow and return its prompt id. */
    async queuePrompt(workflow, options = {}) {
        const payload = { prompt: workflow, client_id: CLIENT_ID };
        if (options.promptId !== undefined) payload['prompt_id'] = options.promptId;
        if (options.front === true) payload['front'] = true;
        if (options.extraData !== undefined && Object.keys(options.extraData).length > 0) {
            payload['extra_data'] = options.extraData;
        }
        const data = await this.request('/prompt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (typeof data?.prompt_id !== 'string') {
            throw new ComfyUIError('ComfyUI /prompt returned no prompt_id');
        }
        return data.prompt_id;
    }

    /** Read one prompt's history entry; undefined while the prompt is unknown or evicted. */
    async getHistory(promptId) {
        const data = await this.request(`/history/${encodeURIComponent(promptId)}`);
        return data?.[promptId];
    }

    /** The server-side queue: running + pending prompts. */
    async getQueue() {
        const raw = await this.request('/queue');
        const parse = (list) => {
            if (!Array.isArray(list)) return [];
            const items = [];
            for (const entry of list) {
                if (Array.isArray(entry) && typeof entry[1] === 'string' && entry[1] !== '') {
                    items.push({ number: typeof entry[0] === 'number' ? entry[0] : 0, promptId: entry[1] });
                }
            }
            return items;
        };
        return { running: parse(raw?.queue_running), pending: parse(raw?.queue_pending) };
    }

    /**
     * Every prompt the server still remembers, newest first.
     *
     * This is the only cross-version way to enumerate a *remote* server's files
     * over HTTP: ComfyUI has no endpoint that lists its input or output
     * directory, but every history entry carries both the outputs it produced
     * and the file names its graph consumed. Recent builds accept `max_items`;
     * older ones ignore the parameter and return everything, so the cap is
     * applied here as well.
     *
     * Ordering assumes insertion order is chronological (true in practice for
     * `/history`), and the list is only used for de-duplicated asset browsing,
     * so a wrong guess costs nothing.
     */
    async listHistory(maxItems = 400) {
        const data = await this.request('/history', {}, Math.max(this.connectTimeoutMs, 60_000));
        if (data === null || typeof data !== 'object') return [];
        const entries = Object.entries(data);
        const cap = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : entries.length;
        return entries.slice(-cap).reverse().map(([promptId, entry]) => ({ promptId, entry }));
    }

    /** Remove specific prompts from the pending queue. */
    async deleteQueueItems(promptIds) {
        await this.request('/queue', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ delete: promptIds }),
        });
    }

    /** Interrupt the running prompt; without an id, interrupt globally. */
    async interrupt(promptId) {
        await this.request('/interrupt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(promptId !== undefined ? { prompt_id: promptId } : {}),
        });
    }

    /** Ask ComfyUI to unload models / free memory. */
    async freeMemory(options = {}) {
        await this.request('/free', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                unload_models: options.unloadModels === true,
                free_memory: options.freeMemory === true,
            }),
        });
    }

    /** Node definitions, used to discover real file names and input options. */
    async objectInfo() {
        return this.request('/object_info', {}, Math.max(this.connectTimeoutMs, 60_000));
    }

    /** Server health/version probe. */
    async systemStats() {
        return this.request('/system_stats');
    }

    /**
     * Stream one generated file through GET /view without buffering it, honoring
     * an optional Range header so the browser can seek (the media proxy re-emits
     * the status/headers and pipes the body). ComfyUI answers valid ranges with
     * 206 + Content-Range and out-of-range starts with 416 — both pass through.
     */
    async fetchViewStreamed(ref, rangeHeader, method = 'GET') {
        const params = new URLSearchParams({
            filename: ref.filename,
            subfolder: ref.subfolder ?? '',
            type: ref.type ?? 'output',
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(this.connectTimeoutMs, 60_000));
        const headers = this.authHeaders();
        if (rangeHeader !== undefined) headers['Range'] = rangeHeader;
        try {
            const response = await this.fetchRoute(`/view?${params.toString()}`, { headers, method, signal: controller.signal });
            if (response.status !== 206 && response.status !== 416 && !response.ok) {
                throw new ComfyUIError(`ComfyUI /view failed: HTTP ${response.status}`);
            }
            if (response.status === 200) {
                const contentLength = response.headers.get('content-length');
                if (contentLength !== null && Number(contentLength) > this.maxMediaBytes) {
                    throw new ComfyUIError(
                        `ComfyUI media too large: ${contentLength} bytes exceeds maxMediaBytes ${this.maxMediaBytes}`,
                    );
                }
            }
            // The body must outlive this call, so the timeout only guards connect+headers.
            clearTimeout(timer);
            return { status: response.status, headers: response.headers, body: response.body };
        }
        catch (error) {
            clearTimeout(timer);
            throw error;
        }
    }

    /**
     * Poll history until the prompt completes, fails, or the budget/signal ends.
     * Interrupts the server when the signal aborts before throwing.
     */
    async waitForCompletion({ promptId, timeoutMs, pollIntervalMs, signal }) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (signal?.aborted === true) {
                await this.interrupt().catch(() => undefined);
                throw new ComfyUIError(`MiniMax H3 generation interrupted (prompt ${promptId})`);
            }
            const entry = await this.getHistory(promptId);
            if (entry !== undefined) {
                const status = entry.status;
                if (status?.status_str === 'success' || status?.completed === true || hasMedia(entry)) {
                    return entry;
                }
                if (status?.status_str === 'error') {
                    throw new ComfyUIError(historyErrorMessage(promptId, entry));
                }
            }
            if (Date.now() >= deadline) {
                throw new ComfyUIError(`MiniMax H3 generation timed out after ${timeoutMs} ms (prompt ${promptId})`);
            }
            await sleep(pollIntervalMs, signal);
        }
    }
}

export function hasMedia(entry) {
    for (const output of Object.values(entry?.outputs ?? {})) {
        if ((output.images?.length ?? 0) > 0
            || (output.videos?.length ?? 0) > 0
            || (output.gifs?.length ?? 0) > 0
            || (output.audio?.length ?? 0) > 0) {
            return true;
        }
    }
    return false;
}

/** Compose a readable failure message from history status messages. */
export function historyErrorMessage(promptId, entry) {
    const details = [];
    for (const message of entry?.status?.messages ?? []) {
        if (!Array.isArray(message) || typeof message[0] !== 'string') continue;
        const payload = message[1];
        if (typeof payload !== 'object' || payload === null) continue;
        if (typeof payload.exception_message === 'string') details.push(payload.exception_message.slice(0, 600));
        else if (typeof payload.exception_type === 'string') details.push(payload.exception_type);
    }
    return `ComfyUI execution failed (prompt ${promptId}): ${details.join('; ') || 'unknown error'}`;
}

/**
 * Build a stable, self-describing proxy URL for one media file.
 *
 * The file is addressed by name/subfolder/type rather than by
 * prompt+node+index: the latter resolves through ComfyUI's in-memory /history,
 * which is dropped on restart or a "clear history" click, after which every
 * stored URL 404s even though the file is untouched on disk.
 */
export function mediaProxyUrl(ref, proxyBase) {
    const query = new URLSearchParams({
        filename: ref.filename,
        subfolder: ref.subfolder ?? '',
        type: ref.type ?? 'output',
    });
    return `${proxyBase ?? ''}/minimaxh3/media?${query.toString()}`;
}

/**
 * Collect media items from a completed history entry, in node/output order,
 * capped by maxItems. Every output array ComfyUI uses is scanned and the kind
 * is re-derived from the file extension, because nodes routinely emit audio and
 * video through the `images`/`videos` arrays.
 */
export function collectMedia({ entry, maxItems, proxyBase }) {
    const items = [];
    for (const [node, output] of Object.entries(entry?.outputs ?? {})) {
        const collections = [
            ['image', output.images],
            ['video', output.videos],
            ['image', output.gifs],
            ['audio', output.audio],
        ];
        for (const [fallback, refs] of collections) {
            for (const [index, ref] of (refs ?? []).entries()) {
                if (items.length >= maxItems) return items;
                if (ref === null || typeof ref !== 'object' || typeof ref.filename !== 'string') continue;
                const kind = kindOfName(ref.filename);
                items.push({
                    filename: ref.filename,
                    subfolder: ref.subfolder ?? '',
                    type: ref.type ?? 'output',
                    ...(typeof ref.fullpath === 'string' ? { fullpath: ref.fullpath } : {}),
                    node,
                    index,
                    kind: kind === 'other' ? fallback : kind,
                    url: proxyBase !== undefined ? mediaProxyUrl(ref, proxyBase) : ref.filename,
                });
            }
        }
    }
    return items;
}