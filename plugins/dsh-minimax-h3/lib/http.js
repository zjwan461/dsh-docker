/** Tiny HTTP helpers for the panel routes. No framework, no dependencies. */

/** Send a JSON response with no-store caching. */
export function sendJson(response, status, body) {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(payload);
}

/** Read and parse a JSON request body; undefined when the body is empty. */
export async function readJsonBody(request, limitBytes = 32 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > limitBytes) throw new Error(`request body exceeds ${limitBytes} bytes`);
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '') return undefined;
    return JSON.parse(text);
}

/** Read a raw (possibly binary) request body, e.g. for multipart forwarding. */
export async function readRawBody(request, limitBytes = 512 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > limitBytes) throw new Error(`upload exceeds ${limitBytes} bytes`);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/** Whether a request originates from the page that served it (Origin vs Host). */
export function sameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin === undefined) return true;
    if (host === undefined) return false;
    return origin === `http://${host}` || origin === `https://${host}`;
}

/** Whether a request's method matches one of the expected verbs. */
export function methodIs(request, ...expected) {
    return expected.includes(String(request.method ?? '').toUpperCase());
}

/** Human-readable error message from an unknown thrown value. */
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** HTML-escape a string for the rare inline-HTML path. */
export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}