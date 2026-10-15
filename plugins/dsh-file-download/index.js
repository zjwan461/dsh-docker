/**
 * Host half of the file-download bundle.
 *
 * One authenticated Fetch route, `GET|HEAD /api/file.download`, hands a file to
 * the browser's own download manager. A caller names the file either by its
 * recorded Session coordinates — the same coordinates the delivered-file card
 * and the turn's change review already carry — or by an absolute path for a file
 * a Sidebar preview is showing. Bytes are streamed in windows through
 * `ctx.fs.readByteRange`, so a large deliverable never lands in Host memory.
 *
 * Coordinates are re-validated here from the Session log, so this route grants
 * nothing the Session itself does not already record.
 *
 * This half imports nothing: a bundle linked from the workspace resolves bare
 * specifiers from its own directory, so tunables arrive as ordinary row
 * `config` values read below instead of through a validated schema.
 *
 * @module @local/dsh-file-download
 */

/** Absolute path the Host registers the download route under. */
const DOWNLOAD_PATH = '/api/file.download';

/** Query values accepted as a non-negative integer coordinate. */
const NUMERIC = /^\d+$/;

/** Headers every answer carries: no caching, no sniffing, no rendered document. */
const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
};

/** Extension → media type for the download's `Content-Type`. */
const MEDIA_TYPES = {
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  yml: 'application/yaml; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  jsx: 'text/jsx; charset=utf-8',
  ts: 'text/typescript; charset=utf-8',
  tsx: 'text/tsx; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  sh: 'text/x-shellscript; charset=utf-8',
  ps1: 'text/plain; charset=utf-8',
  sql: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/vnd.microsoft.icon',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  sqlite: 'application/vnd.sqlite3',
  db: 'application/vnd.sqlite3',
  exe: 'application/vnd.microsoft.portable-executable',
  dll: 'application/vnd.microsoft.portable-executable',
};

/** Services this bundle needs; every one is required for its routes to answer. */
export const inject = [
  'connection',
  'fs',
  'workspaceFiles',
  'sessionQuery',
  'sandboxPolicy',
  'workspaceChanges',
];

/** Default bytes read per window while streaming one download. */
const DEFAULT_CHUNK_BYTES = 1048576;

/** Largest window a caller may configure. */
const MAX_CHUNK_BYTES = 8388608;

/**
 * Register the download route for the lifetime of this plugin.
 * @param ctx - Host context carrying Connection and the filesystem services.
 * @param config - row configuration: `chunkBytes` per read window, `maxBytes` as
 *   an inclusive size limit (`0`, the default, serves a file of any size).
 */
export function apply(ctx, config = {}) {
  const requestedChunk = Number(config?.chunkBytes);
  const requestedMax = Number(config?.maxBytes);
  const options = {
    chunkBytes:
      Number.isSafeInteger(requestedChunk) && requestedChunk >= 4096
        ? Math.min(requestedChunk, MAX_CHUNK_BYTES)
        : DEFAULT_CHUNK_BYTES,
    maxBytes: Number.isSafeInteger(requestedMax) && requestedMax > 0 ? requestedMax : 0,
  };
  const lifetime = new AbortController();
  ctx.effect(
    () => () => {
      lifetime.abort();
    },
    'file-download: cancel in-flight reads',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DOWNLOAD_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => answer(ctx, request, options, lifetime.signal),
      }),
    'file-download: /api/file.download route',
  );
}

/**
 * Answer one download request.
 * @param ctx - Host context.
 * @param request - authenticated request below Connection's fence.
 * @param options - resolved tunables.
 * @param lifetime - plugin disposal signal.
 * @returns the download, or the refusal to answer with.
 */
async function answer(ctx, request, options, lifetime) {
  const head = request.method === 'HEAD';
  const signal = AbortSignal.any([request.signal, lifetime]);
  let located;
  try {
    located = await locate(ctx, new URL(request.url).searchParams, signal);
  } catch (error) {
    request.signal.throwIfAborted();
    return fail(failureStatus(error), 'file unavailable');
  }
  if (located instanceof Response) {
    return head ? new Response(null, { status: located.status, headers: located.headers }) : located;
  }
  if (options.maxBytes > 0 && located.size !== undefined && located.size > options.maxBytes) {
    return fail(413, `file exceeds the ${options.maxBytes}-byte download limit`);
  }
  const headers = {
    ...BASE_HEADERS,
    'Content-Type': mediaType(located.name),
    'Content-Disposition': contentDisposition(located.name),
  };
  if (located.size !== undefined) headers['Content-Length'] = String(located.size);
  if (head) return new Response(null, { status: 200, headers });
  return new Response(
    bodyStream(ctx, located.target, located.size, options.chunkBytes, signal),
    { status: 200, headers },
  );
}

/**
 * Resolve the requested file without reading it.
 * @param ctx - Host context.
 * @param query - request query parameters.
 * @param signal - caller cancellation.
 * @returns the file's target, display name, and size, or the refusal to answer with.
 */
async function locate(ctx, query, signal) {
  const from = query.get('from') ?? 'path';
  if (from === 'present' || from === 'changes') {
    const sessionId = query.get('sessionId');
    if (sessionId === null || sessionId.length === 0) return fail(400, 'missing sessionId');
    const seq = coordinate(query.get('seq'));
    const index = coordinate(query.get('index'));
    if (seq === undefined || index === undefined) {
      return fail(400, `invalid ${from} file coordinates`);
    }
    if (from === 'present') {
      const read = await ctx.sessionQuery.readEvent(
        { sessionId, seq, before: 0, after: 0 },
        signal,
      );
      const target = read?.target;
      const file =
        target?.type === 'deliverables/presented' && isPresentedData(target.data)
          ? target.data.files[index]
          : undefined;
      if (!isPresentedFile(file)) {
        return fail(404, 'presented file not found in this Session result');
      }
      return await statOf(
        ctx,
        { sessionId, workspaceRoot: read.session?.cwd ?? ctx.sandboxPolicy.workspaceRoot },
        file.path,
        signal,
      );
    }
    const summary = ctx.workspaceChanges.summary(sessionId, seq);
    if (summary === undefined) return fail(404, 'change summary unavailable');
    const file = Array.isArray(summary.files) ? summary.files[index] : undefined;
    if (file === undefined || typeof file.path !== 'string' || file.path.length === 0) {
      return fail(404, 'changed file not found in this summary');
    }
    return await statOf(
      ctx,
      { sessionId, workspaceRoot: summary.cwd ?? ctx.sandboxPolicy.workspaceRoot },
      file.path,
      signal,
    );
  }
  if (from !== 'path') return fail(400, `unknown from "${from}"`);
  const path = query.get('path');
  if (path === null || path.length === 0) return fail(400, 'missing path');
  if (path.includes('\0')) return fail(400, 'invalid path');
  if (!isAbsolutePath(path)) return fail(400, 'absolute path required');
  return await targetAt(ctx, path, signal);
}

/**
 * Resolve one path the Session's own workspace vocabulary names.
 * @param ctx - Host context.
 * @param scope - Session identity and its workspace root.
 * @param path - absolute path or path relative to the workspace root.
 * @param signal - caller cancellation.
 * @returns the file's target, display name, and size, or the refusal to answer with.
 */
async function statOf(ctx, scope, path, signal) {
  const stat = await ctx.workspaceFiles.stat(scope, path, signal);
  return await targetAt(ctx, stat.absolutePath, signal);
}

/**
 * Resolve one absolute execution-world path and prove it is a regular file.
 * @param ctx - Host context.
 * @param path - absolute path in the composed filesystem.
 * @param signal - caller cancellation.
 * @returns the file's target, display name, and size, or the refusal to answer with.
 */
async function targetAt(ctx, path, signal) {
  const target = await ctx.fs.resolve(path, { signal });
  const info = await ctx.fs.stat(target, signal);
  if (info === undefined) return fail(404, 'not found');
  if (info.type !== 'file') return fail(403, 'not a regular file');
  const displayPath = ctx.fs.processPath(target);
  return { target, name: basename(displayPath), size: info.size };
}

/**
 * Stream the file in windows, so the response never holds the whole file.
 * @param ctx - Host context.
 * @param target - resolved file target.
 * @param size - complete file size when the backend reports one.
 * @param chunkBytes - bytes per window.
 * @param signal - cancellation, from the request or plugin disposal.
 * @returns the response body.
 */
function bodyStream(ctx, target, size, chunkBytes, signal) {
  let offset = 0;
  return new ReadableStream({
    async pull(controller) {
      if (signal.aborted) {
        controller.error(signal.reason ?? new Error('download aborted'));
        return;
      }
      try {
        if (size !== undefined && offset >= size) {
          controller.close();
          return;
        }
        const length = size === undefined ? chunkBytes : Math.min(chunkBytes, size - offset);
        const bytes = await ctx.fs.readByteRange(target, { offset, length }, signal);
        if (bytes.byteLength === 0) {
          controller.close();
          return;
        }
        offset += bytes.byteLength;
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/** Validate a file declaration read from a Session log. */
function isPresentedFile(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { path, description } = value;
  return (
    typeof path === 'string' &&
    path.trim().length > 0 &&
    (description === undefined || typeof description === 'string')
  );
}

/** Validate a delivery event before reading its file declarations. */
function isPresentedData(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { turn, callId, files } = value;
  return (
    typeof turn === 'number' &&
    Number.isSafeInteger(turn) &&
    turn >= 1 &&
    typeof callId === 'string' &&
    callId.length > 0 &&
    Array.isArray(files)
  );
}

/** One query value as a safe non-negative integer coordinate. */
function coordinate(value) {
  return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;
}

/** Whether a path is absolute in either path vocabulary the Host composes. */
function isAbsolutePath(path) {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(path);
}

/** Trailing path segment, the part that names the downloaded file. */
function basename(path) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = cut === -1 ? path : path.slice(cut + 1);
  return name.length === 0 ? 'download' : name;
}

/** Media type for one filename, by its extension. */
function mediaType(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return 'application/octet-stream';
  return MEDIA_TYPES[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** Attachment disposition carrying both an ASCII fallback and the real UTF-8 name. */
function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** One refusal, carrying the shared headers. */
function fail(status, text) {
  return new Response(text, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Translate a lookup or filesystem failure into the status the browser reports. */
function failureStatus(error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'session/not-found':
    case 'session-query/session-not-found':
    case 'workspace-file/not-found':
    case 'FS_NOT_FOUND':
    case 'SESSION_QUERY_SESSION_NOT_FOUND':
    case 'SESSION_QUERY_EVENT_NOT_FOUND':
    case 'ENOENT':
    case 'ENOTDIR':
      return 404;
    case 'workspace-file/not-regular-file':
    case 'FS_NOT_REGULAR_FILE':
    case 'FS_PERMISSION_DENIED':
    case 'FS_SANDBOX_DENIED':
      return 403;
    case 'workspace-file/too-large':
    case 'FS_TOO_LARGE':
      return 413;
    case 'FS_ABORTED':
      return 499;
    default:
      return 500;
  }
}