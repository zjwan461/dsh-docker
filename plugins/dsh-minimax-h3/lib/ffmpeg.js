/**
 * FFmpeg finishing for MiniMax H3 clips.
 *
 * Generation is only half of a video workflow; the other half is cutting,
 * joining, scoring, captioning and delivering. This module owns that half:
 * locating an FFmpeg binary, probing media, and a registry of post-processing
 * operations that each turn a descriptor into an argv list.
 *
 * Design rules:
 * - Every op is a pure descriptor: `build(ctx)` returns argv + the output path.
 *   Nothing spawns from a build, so the panel can preview a command.
 * - Long or quoted values never travel through a shell. argv goes straight to
 *   `spawn` with `shell: false`, so quoting bugs cannot become command
 *   injection; the only escaping left is FFmpeg's own filtergraph level.
 * - Text (drawtext) travels through a temp `textfile=`, because escaping
 *   arbitrary user text inline in a filtergraph is a losing game.
 * - Progress is read from `-progress pipe:1`, which is machine-readable,
 *   instead of scraping `time=` out of the human log.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

/** Raised when no usable FFmpeg could be found, or it exited non-zero. */
export class FFmpegError extends Error {
    constructor(message, detail) {
        super(message);
        this.name = 'FFmpegError';
        this.detail = detail;
    }
}

/* ------------------------------------------------------------------ */
/* Locating the binary                                                 */
/* ------------------------------------------------------------------ */

/**
 * Where an FFmpeg tends to live.
 *
 * A bare `ffmpeg` resolves through PATH and covers most system installs on
 * every platform; the absolute entries are the places a package manager or a
 * portable ComfyUI build hides one that PATH does not see. Windows and POSIX
 * get *separate* lists rather than one union, so a Windows-looking path (from a
 * stray environment variable) can never be probed on Linux, and vice versa.
 */
export function candidatePaths(config) {
    const candidates = [];
    const push = (value) => {
        if (typeof value === 'string' && value.trim() !== '') candidates.push(value.trim());
    };
    push(config.ffmpegPath);
    push('ffmpeg');
    const home = homedir();

    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA ?? '';
        const programData = process.env.ProgramData ?? 'C:\\ProgramData';
        push('C:\\ffmpeg\\bin\\ffmpeg.exe');
        if (local !== '') push(join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
        push(join(programData, 'chocolatey', 'bin', 'ffmpeg.exe'));
        push('D:\\ffmpeg\\bin\\ffmpeg.exe');
        push(join(home, 'scoop', 'shims', 'ffmpeg.exe'));
    }
    else {
        push('/usr/bin/ffmpeg');
        push('/usr/local/bin/ffmpeg');
        push('/snap/bin/ffmpeg');
        push('/opt/ffmpeg/bin/ffmpeg');
        // `pip install --user` / pipx, and a plain ~/bin.
        push(join(home, '.local', 'bin', 'ffmpeg'));
        push(join(home, 'bin', 'ffmpeg'));
        // Conda is a very common way to run ComfyUI on Linux, and its FFmpeg is
        // not on PATH unless that env was activated in this same shell.
        const conda = process.env.CONDA_PREFIX ?? '';
        if (conda !== '') push(join(conda, 'bin', 'ffmpeg'));
    }

    for (const dir of config.comfyuiDirs ?? []) {
        // A portable ComfyUI ships an FFmpeg somewhere next to the app, and the
        // exact spot moved between releases, so all plausible ones are probed on
        // both platforms.
        push(join(dir, 'ffmpeg'));
        push(join(dir, 'ffmpeg.exe'));
        push(join(dir, 'bin', 'ffmpeg'));
        push(join(dir, 'bin', 'ffmpeg.exe'));
        push(join(dir, 'python_embeded', 'ffmpeg'));
        push(join(dir, 'python_embeded', 'ffmpeg.exe'));
        push(join(dir, 'python_embeded', 'bin', 'ffmpeg'));
    }
    return candidates;
}

/**
 * FFmpeg binaries that ComfyUI's bundled `imageio_ffmpeg` ships.
 *
 * The layout differs by platform and release: the Windows portable build keeps
 * site-packages under `python_embeded/Lib/`, POSIX keeps it under
 * `lib/python3.x/`, and the binary is `ffmpeg-win64-v….exe` on one and
 * `ffmpeg-linux-x86_64-v…` on the other. So both the directory shape and the
 * name pattern are discovered rather than assumed.
 */
async function imageioBinariesUnder(dir) {
    const found = [];
    const collect = async (binaryDir) => {
        let entries;
        try {
            entries = await readdir(binaryDir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            // `ffmpeg`, `ffmpeg.exe`, `ffmpeg-linux-x86_64-v7.0.2`, `ffmpeg-win64-v7.0.2.exe`.
            if (/^ffmpeg([-_.].*)?(\.exe)?$/i.test(entry)) found.push(join(binaryDir, entry));
        }
    };
    await collect(join(dir, 'site-packages', 'imageio_ffmpeg', 'binaries'));
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        entries = [];
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !/^python\d/i.test(entry.name)) continue;
        await collect(join(dir, entry.name, 'site-packages', 'imageio_ffmpeg', 'binaries'));
    }
    return found;
}

async function imageioCandidates(config) {
    const found = [];
    for (const dir of config.comfyuiDirs ?? []) {
        const roots = [
            join(dir, 'python_embeded', 'Lib'), // Windows portable
            join(dir, 'python_embeded', 'lib'), // POSIX portable
            join(dir, 'python_embeded'),        // site-packages directly beneath it
            join(dir, 'venv', 'lib'),           // a hand-made venv
            join(dir, '.venv', 'lib'),
        ];
        for (const root of roots) found.push(...await imageioBinariesUnder(root));
    }
    return found;
}

/**
 * Run a binary with `-version`.
 *
 * Always resolves, and says *why* it failed. That distinction is the whole
 * value: on Linux the usual failure is `EACCES` (found it, not executable) or
 * `ENOENT` (not there at all), and reporting both as "not runnable" hides the
 * one thing the user needs to know.
 */
async function probeBinary(exe) {
    return new Promise((resolvePromise) => {
        let child;
        try {
            child = spawn(exe, ['-version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (error) {
            resolvePromise({ ok: false, reason: error?.code ?? String(error) });
            return;
        }
        let out = '';
        let settled = false;
        const done = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolvePromise(result);
        };
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch {
                // Already gone.
            }
            done({ ok: false, reason: 'timed out' });
        }, 15_000);
        child.stdout?.on('data', (chunk) => {
            out += chunk.toString();
        });
        child.on('error', (error) => {
            done({ ok: false, reason: error?.code ?? String(error) });
        });
        child.on('close', (code) => {
            if (code !== 0 || out === '') {
                done({ ok: false, reason: `exit ${code}` });
                return;
            }
            done({ ok: true, version: out.split('\n')[0].trim() });
        });
    });
}

/** Cached detection result, keyed by the config fields that can change it. */
let detectionCache;

/**
 * `ffmpeg` → `ffprobe`, `ffmpeg.exe` → `ffprobe.exe`,
 * `/usr/bin/ffmpeg` → `/usr/bin/ffprobe`.
 *
 * Derived from the *basename*, never the extension: on POSIX `/usr/bin/ffmpeg`
 * has no extension, and an extension-based version produced
 * `/usr/bin/ffmpegprobe` — so ffprobe was never found as a sibling on Linux and
 * every duration-dependent step (fade-out, loudness-free concat normalization)
 * silently degraded.
 */
export function ffprobeSibling(ffmpeg) {
    const base = basename(ffmpeg);
    const probeName = /ffmpeg/i.test(base) ? base.replace(/ffmpeg/i, 'ffprobe') : `ffprobe${extname(base)}`;
    if (!isAbsolute(ffmpeg)) return probeName;
    return join(dirname(ffmpeg), probeName);
}

/** The configured ffprobe wins; otherwise it is the sibling of the found ffmpeg. */
function siblingProbe(config, ffmpeg) {
    const explicit = (config.ffprobePath ?? '').trim();
    return explicit !== '' ? explicit : ffprobeSibling(ffmpeg);
}

/**
 * Find a usable FFmpeg. Resolves `{ ok: false }` (never throws) so callers can
 * report the situation instead of failing a generation over it.
 *
 * @param config - resolved plugin config.
 * @param opts.force - ignore the cache.
 */
export async function resolveFFmpeg(config, opts = {}) {
    const key = `${config.ffmpegPath}|${config.ffprobePath}|${(config.comfyuiDirs ?? []).join(';')}`;
    if (opts.force !== true && detectionCache !== undefined && detectionCache.key === key
        && Date.now() - detectionCache.at < 60_000) {
        return detectionCache.value;
    }

    const tried = [];
    const candidates = [...candidatePaths(config), ...(await imageioCandidates(config))];
    for (const candidate of candidates) {
        if (isAbsolute(candidate) && !existsSync(candidate)) {
            tried.push({ candidate, reason: 'not found' });
            continue;
        }
        const probe = await probeBinary(candidate);
        if (probe.ok !== true) {
            // The real error code (`ENOENT`, `EACCES`, `exit 1`) is what makes a
            // Linux failure diagnosable; "not runnable" would hide it.
            tried.push({ candidate, reason: probe.reason });
            continue;
        }
        const ffprobe = siblingProbe(config, candidate);
        const probeResult = await probeBinary(ffprobe);
        const value = {
            ok: true,
            ffmpeg: candidate,
            ffprobe: probeResult.ok === true ? ffprobe : undefined,
            version: probe.version,
            probeVersion: probeResult.ok === true ? probeResult.version : undefined,
            tried,
        };
        detectionCache = { key, at: Date.now(), value };
        return value;
    }

    const installHint = process.platform === 'win32'
        ? 'winget install Gyan.FFmpeg, or choco install ffmpeg'
        : 'apt install ffmpeg (or dnf / pacman / brew install ffmpeg)';
    const value = {
        ok: false,
        tried,
        error: `FFmpeg not found. Install it (${installHint}), or set the FFmpeg path in the plugin settings. FFprobe is optional, but without it duration-dependent steps (fade-out, concat normalization) are skipped.`,
    };
    detectionCache = { key, at: Date.now(), value };
    return value;
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

/**
 * Spawn FFmpeg, capture stderr, and stream `-progress` key/values to a
 * callback. Rejects with an FFmpegError carrying the stderr tail when the
 * process exits non-zero.
 */
export function runFFmpeg(exe, args, opts = {}) {
    const { signal, timeoutMs = 1_800_000, onProgress, totalDuration } = opts;
    return new Promise((resolvePromise, reject) => {
        let child;
        try {
            child = spawn(exe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (error) {
            reject(new FFmpegError(`could not start FFmpeg: ${error instanceof Error ? error.message : String(error)}`));
            return;
        }

        let stderr = '';
        let stdout = '';
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            fn(value);
        };

        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch {
                // Already gone.
            }
            finish(reject, new FFmpegError(`FFmpeg timed out after ${timeoutMs} ms`));
        }, timeoutMs);

        const onAbort = () => {
            try {
                child.kill('SIGKILL');
            }
            catch {
                // Already gone.
            }
            finish(reject, new FFmpegError('FFmpeg run aborted'));
        };
        if (signal?.aborted === true) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });

        child.stdout?.on('data', (chunk) => {
            // `-progress` output is only wanted for the progress callback; with no
            // callback there is nothing to parse and no reason to accumulate it.
            if (typeof onProgress !== 'function') return;
            stdout += chunk.toString();
            // -progress emits blocks of key=value lines ending with `progress=continue|end`.
            const lines = stdout.split('\n');
            stdout = lines.pop() ?? '';
            for (const line of lines) {
                const match = /^out_time_us=(\d+)$/.exec(line.trim());
                if (match === null) continue;
                const seconds = Number(match[1]) / 1_000_000;
                onProgress(totalDuration !== undefined && totalDuration > 0
                    ? Math.min(0.999, seconds / totalDuration)
                    : undefined, seconds);
            }
        });

        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
            // Keep the tail only: a failing encode can emit megabytes of log.
            if (stderr.length > 32_000) stderr = stderr.slice(-24_000);
        });

        child.on('error', (error) => {
            finish(reject, new FFmpegError(`FFmpeg failed to run: ${error.message}`, stderr));
        });

        child.on('close', (code) => {
            if (code === 0) {
                if (typeof onProgress === 'function') onProgress(1, totalDuration);
                finish(resolvePromise, { code, stderr });
                return;
            }
            const tail = stderr.trim().split('\n').slice(-12).join('\n');
            finish(reject, new FFmpegError(`FFmpeg exited with code ${code}`, tail));
        });
    });
}

/** FFprobe one file and return `{ duration, width, height, fps, hasAudio, hasVideo, ... }`. */
export async function probeMedia(ffprobe, file, opts = {}) {
    if (ffprobe === undefined) return undefined;
    const args = [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        file,
    ];
    const result = await new Promise((resolvePromise, reject) => {
        let child;
        try {
            child = spawn(ffprobe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (error) {
            reject(new FFmpegError(`could not start FFprobe: ${error.message}`));
            return;
        }
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch {
                // Already gone.
            }
            reject(new FFmpegError('FFprobe timed out'));
        }, opts.timeoutMs ?? 60_000);
        child.stdout?.on('data', (chunk) => {
            out += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            err += chunk.toString();
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(new FFmpegError(`FFprobe failed to run: ${error.message}`));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new FFmpegError(`FFprobe exited with code ${code}`, err.slice(-800)));
                return;
            }
            resolvePromise(out);
        });
    });
    let parsed;
    try {
        parsed = JSON.parse(result);
    }
    catch {
        return undefined;
    }
    const streams = parsed.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const rate = video?.avg_frame_rate ?? video?.r_frame_rate ?? '0/0';
    const [num, den] = String(rate).split('/').map(Number);
    return {
        duration: Number(parsed.format?.duration ?? video?.duration ?? 0),
        sizeBytes: Number(parsed.format?.size ?? 0),
        bitRate: Number(parsed.format?.bit_rate ?? 0),
        formatName: parsed.format?.format_name ?? '',
        width: video?.width,
        height: video?.height,
        fps: den !== undefined && den > 0 ? Number((num / den).toFixed(4)) : undefined,
        videoCodec: video?.codec_name,
        pixelFormat: video?.pix_fmt,
        hasVideo: video !== undefined,
        hasAudio: audio !== undefined,
        audioCodec: audio?.codec_name,
        sampleRate: audio === undefined ? undefined : Number(audio.sample_rate),
        channels: audio?.channels,
    };
}

/* ------------------------------------------------------------------ */
/* Filtergraph helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Make a path safe to embed inside a filtergraph value.
 *
 * On Windows backslashes must become slashes and the drive colon escaped — the
 * two things that reliably break `subtitles=`/`drawtext=`. On POSIX a backslash
 * is a perfectly legal *filename* character, so rewriting it there would point
 * the filter at a different file; only the colon and quote escapes apply.
 *
 * `platform` is injectable so both branches are testable from either host.
 */
export function filterPath(value, platform = process.platform) {
    const raw = String(value);
    const normalized = platform === 'win32' ? raw.replace(/\\/g, '/') : raw;
    return normalized.replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

/** The nine anchor positions, as overlay x/y expressions. */
function anchorExpressions(position, margin) {
    const m = Number.isFinite(margin) ? Math.round(margin) : 24;
    const table = {
        'top-left': { x: `${m}`, y: `${m}` },
        'top-center': { x: '(W-w)/2', y: `${m}` },
        'top-right': { x: `W-w-${m}`, y: `${m}` },
        'middle-left': { x: `${m}`, y: '(H-h)/2' },
        center: { x: '(W-w)/2', y: '(H-h)/2' },
        'middle-right': { x: `W-w-${m}`, y: '(H-h)/2' },
        'bottom-left': { x: `${m}`, y: `H-h-${m}` },
        'bottom-center': { x: '(W-w)/2', y: `H-h-${m}` },
        'bottom-right': { x: `W-w-${m}`, y: `H-h-${m}` },
    };
    return table[position] ?? table['bottom-right'];
}

/** drawtext's own variables differ from overlay's (lowercase w/h, text_w/text_h). */
function textAnchorExpressions(position, margin) {
    const m = Number.isFinite(margin) ? Math.round(margin) : 24;
    const table = {
        'top-left': { x: `${m}`, y: `${m}` },
        'top-center': { x: '(w-text_w)/2', y: `${m}` },
        'top-right': { x: `w-text_w-${m}`, y: `${m}` },
        'middle-left': { x: `${m}`, y: '(h-text_h)/2' },
        center: { x: '(w-text_w)/2', y: '(h-text_h)/2' },
        'middle-right': { x: `w-text_w-${m}`, y: '(h-text_h)/2' },
        'bottom-left': { x: `${m}`, y: `h-text_h-${m}` },
        'bottom-center': { x: '(w-text_w)/2', y: `h-text_h-${m}` },
        'bottom-right': { x: `w-text_w-${m}`, y: `h-text_h-${m}` },
    };
    return table[position] ?? table['bottom-center'];
}

/** Colour values arrive as `#rrggbb`, `0xrrggbb@a` or an FFmpeg colour name. */
function colour(value, fallback) {
    const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
    if (/^#[0-9a-fA-F]{6,8}$/.test(raw)) return `0x${raw.slice(1)}`;
    return raw;
}

/** A numeric option with a default when absent, NaN or out of range. */
function num(value, fallback, min, max) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    let out = parsed;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
}

function str(value, fallback = '') {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function bool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

/** Parse "1920x1080", "1920:1080", 1920 or "1920" into a width/height pair. */
function parseSize(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return { width: Math.round(value), height: -2 };
    const raw = String(value ?? '').trim();
    const match = /^(\d+)\s*[x×:]\s*(\d+)$/.exec(raw);
    if (match !== null) return { width: Number(match[1]), height: Number(match[2]) };
    if (/^\d+$/.test(raw)) return { width: Number(raw), height: -2 };
    return fallback;
}

/** Base argv every op starts from: quiet, non-interactive, overwrite. */
function baseArgs() {
    return ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];
}

/* ------------------------------------------------------------------ */
/* The post-processing operation registry                              */
/* ------------------------------------------------------------------ */

/**
 * Each op declares its user-facing parameters once; the panel renders them and
 * the `h3_post` tool validates against them. `build(ctx)` receives
 * `{ main, extras, options, out, workDir, probe }` and returns
 * `{ args, output, note }`.
 */
export const POST_OPS = [
    {
        id: 'transcode',
        label: '转码 / 封装',
        labelEn: 'Transcode',
        group: '交付',
        description: '重新编码或换封装格式：H.264/H.265/AV1/VP9，CRF 质量，faststart 便于网络播放。',
        params: [
            { name: 'container', label: '封装', type: 'enum', default: 'mp4', options: ['mp4', 'mkv', 'mov', 'webm'] },
            { name: 'video_codec', label: '视频编码', type: 'enum', default: 'libx264', options: ['libx264', 'libx265', 'libvpx-vp9', 'libsvtav1', 'copy'] },
            { name: 'crf', label: '质量 CRF（越小越清晰）', type: 'number', default: 18, min: 0, max: 51, step: 1 },
            { name: 'preset', label: '编码速度', type: 'enum', default: 'medium', options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'] },
            { name: 'pixel_format', label: '像素格式', type: 'enum', default: 'yuv420p', options: ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le'] },
            { name: 'audio_codec', label: '音频编码', type: 'enum', default: 'aac', options: ['aac', 'libopus', 'libmp3lame', 'copy', 'none'] },
            { name: 'audio_bitrate', label: '音频码率', type: 'string', default: '192k' },
            { name: 'faststart', label: '网络流式（faststart）', type: 'boolean', default: true },
            { name: 'max_width', label: '限宽（0=不限）', type: 'number', default: 0, min: 0, max: 8192, step: 2 },
        ],
        build(ctx) {
            const container = str(ctx.options.container, 'mp4');
            const videoCodec = str(ctx.options.video_codec, 'libx264');
            const audioCodec = str(ctx.options.audio_codec, 'aac');
            const args = [...baseArgs(), '-i', ctx.main];
            const filters = [];
            const maxWidth = num(ctx.options.max_width, 0, 0, 8192);
            if (maxWidth > 0) filters.push(`scale='min(${maxWidth},iw)':-2`);
            if (filters.length > 0) args.push('-vf', filters.join(','));
            args.push('-c:v', videoCodec);
            if (videoCodec !== 'copy') {
                args.push('-preset', str(ctx.options.preset, 'medium'));
                if (videoCodec === 'libx264' || videoCodec === 'libx265') {
                    args.push('-crf', String(num(ctx.options.crf, 18, 0, 51)));
                }
                else if (videoCodec === 'libvpx-vp9') {
                    args.push('-crf', String(num(ctx.options.crf, 32, 0, 63)), '-b:v', '0');
                }
                else if (videoCodec === 'libsvtav1') {
                    args.push('-crf', String(num(ctx.options.crf, 30, 0, 63)));
                }
                args.push('-pix_fmt', str(ctx.options.pixel_format, 'yuv420p'));
            }
            if (audioCodec === 'none') args.push('-an');
            else {
                args.push('-c:a', audioCodec);
                if (audioCodec !== 'copy') args.push('-b:a', str(ctx.options.audio_bitrate, '192k'));
            }
            if (bool(ctx.options.faststart, true) && (container === 'mp4' || container === 'mov')) {
                args.push('-movflags', '+faststart');
            }
            args.push('-f', container);
            const output = ctx.out(str(ctx.options.name, 'deliver'), container);
            args.push(output);
            return { args, output };
        },
    },

    {
        id: 'trim',
        label: '裁剪时长',
        labelEn: 'Trim',
        group: '剪辑',
        description: '掐头去尾。默认关键帧快速定位（秒级），勾选精确则逐帧定位（慢但准）。',
        params: [
            { name: 'start', label: '开始（秒）', type: 'number', default: 0, min: 0, step: 0.01 },
            { name: 'end', label: '结束（秒，0=到片尾）', type: 'number', default: 0, min: 0, step: 0.01 },
            { name: 'duration', label: '时长（秒，0=用结束）', type: 'number', default: 0, min: 0, step: 0.01 },
            { name: 'accurate', label: '精确到帧', type: 'boolean', default: false },
            { name: 'reencode', label: '重新编码', type: 'boolean', default: true },
        ],
        build(ctx) {
            const start = num(ctx.options.start, 0, 0);
            const end = num(ctx.options.end, 0, 0);
            const duration = num(ctx.options.duration, 0, 0);
            const accurate = bool(ctx.options.accurate, false);
            const reencode = bool(ctx.options.reencode, true);
            const args = [...baseArgs()];
            if (!accurate && start > 0) args.push('-ss', String(start));
            args.push('-i', ctx.main);
            if (accurate && start > 0) args.push('-ss', String(start));
            if (duration > 0) args.push('-t', String(duration));
            else if (end > start) args.push('-t', String(end - start));
            if (reencode) {
                args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
            }
            else {
                args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
            }
            const output = ctx.out(str(ctx.options.name, 'trim'), 'mp4');
            args.push(output);
            return { args, output, note: `${start}s → ${(duration > 0 ? start + duration : end > 0 ? end : 'end')}s` };
        },
    },

    {
        id: 'concat',
        label: '拼接合片',
        labelEn: 'Concatenate',
        group: '剪辑',
        description: '把多段片子按顺序接成一条。同源同参数用「直接拼接」（秒级、无损）；参数不齐用「归一化」（重编码，稳）。',
        params: [
            { name: 'order', label: '顺序（文件名，逗号分隔；留空=按列表顺序）', type: 'string', default: '' },
            { name: 'mode', label: '方式', type: 'enum', default: 'copy', options: ['copy', 'normalize'] },
            { name: 'width', label: '归一化宽度', type: 'number', default: 1280, min: 16, max: 8192, step: 2 },
            { name: 'height', label: '归一化高度', type: 'number', default: 720, min: 16, max: 8192, step: 2 },
            { name: 'fps', label: '归一化帧率', type: 'number', default: 24, min: 1, max: 120, step: 1 },
            { name: 'crf', label: '归一化质量 CRF', type: 'number', default: 16, min: 0, max: 51, step: 1 },
            { name: 'name', label: '输出名', type: 'string', default: 'final' },
        ],
        needsExtras: true,
        async build(ctx) {
            const inputs = ctx.inputs;
            if (inputs.length < 2) throw new FFmpegError('拼接至少需要两段视频');
            const mode = str(ctx.options.mode, 'copy');
            const output = ctx.out(str(ctx.options.name, 'final'), 'mp4');

            if (mode === 'copy') {
                const listFile = join(ctx.workDir, `concat-${Date.now()}.txt`);
                // The concat demuxer resolves relative entries against the list file.
                const body = inputs.map((file) => `file '${String(file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
                await writeFile(listFile, `${body}\n`, 'utf8');
                const args = [...baseArgs(), '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output];
                return { args, output, cleanup: [listFile], note: `直接拼接 ${inputs.length} 段` };
            }

            // Normalize: re-encode every segment to one shape, then concat with
            // the demuxer. Robust against mixed sizes, frame rates and missing
            // audio tracks — the three things that break a single filtergraph.
            const width = Math.round(num(ctx.options.width, 1280, 16, 8192) / 2) * 2;
            const height = Math.round(num(ctx.options.height, 720, 16, 8192) / 2) * 2;
            const fps = num(ctx.options.fps, 24, 1, 120);
            const crf = num(ctx.options.crf, 16, 0, 51);
            const normalized = [];
            const cleanup = [];
            for (const [index, file] of inputs.entries()) {
                const target = join(ctx.workDir, `norm-${Date.now()}-${index}.mp4`);
                cleanup.push(target);
                const info = ctx.probe === undefined ? undefined : await ctx.probe(file);
                const args = [
                    ...baseArgs(),
                    '-i', file,
                ];
                if (info !== undefined && info.hasAudio === false) {
                    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest');
                }
                args.push(
                    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`,
                    '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                    target,
                );
                await ctx.exec(args, info?.duration);
                normalized.push(target);
            }
            const listFile = join(ctx.workDir, `concat-${Date.now()}.txt`);
            cleanup.push(listFile);
            const body = normalized.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n');
            await writeFile(listFile, `${body}\n`, 'utf8');
            const args = [...baseArgs(), '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output];
            return { args, output, cleanup, note: `归一化拼接 ${inputs.length} 段 → ${width}×${height}@${fps}` };
        },
    },

    {
        id: 'merge_audio',
        label: '配音 / 配乐',
        labelEn: 'Add audio',
        group: '声音',
        description: '加旁白、BGM 或替换音轨；可混音、调音量、延迟入点、循环铺满。',
        params: [
            { name: 'mode', label: '方式', type: 'enum', default: 'mix', options: ['mix', 'replace'] },
            { name: 'volume', label: '新音轨音量（倍）', type: 'number', default: 1, min: 0, max: 4, step: 0.05 },
            { name: 'original_volume', label: '原音轨音量（倍）', type: 'number', default: 1, min: 0, max: 4, step: 0.05 },
            { name: 'offset', label: '入点延迟（秒）', type: 'number', default: 0, min: 0, step: 0.01 },
            { name: 'loop', label: '循环铺满', type: 'boolean', default: false },
            { name: 'fade_out', label: '片尾淡出（秒）', type: 'number', default: 0, min: 0, step: 0.1 },
            { name: 'name', label: '输出名', type: 'string', default: 'scored' },
        ],
        needsExtras: true,
        build(ctx) {
            const audio = ctx.extras[0];
            if (audio === undefined) throw new FFmpegError('配音/配乐需要一个音频文件作为附加输入');
            const mode = str(ctx.options.mode, 'mix');
            const volume = num(ctx.options.volume, 1, 0, 4);
            const originalVolume = num(ctx.options.original_volume, 1, 0, 4);
            const offset = num(ctx.options.offset, 0, 0);
            const fadeOut = num(ctx.options.fade_out, 0, 0);
            const loop = bool(ctx.options.loop, false);
            const args = [...baseArgs()];
            if (loop) args.push('-stream_loop', '-1');
            args.push('-i', ctx.main, '-i', audio);
            const total = ctx.mainDuration;
            let filter;
            if (mode === 'replace') {
                const chain = [`[1:a]volume=${volume}`, offset > 0 ? `adelay=${Math.round(offset * 1000)}|${Math.round(offset * 1000)}` : ''].filter(Boolean).join(',');
                filter = `${chain}${fadeOut > 0 && total !== undefined ? `,afade=t=out:st=${Math.max(0, total - fadeOut)}:d=${fadeOut}` : ''}[a]`;
            }
            else {
                const parts = [
                    `[0:a]volume=${originalVolume}[a0]`,
                    `[1:a]volume=${volume}${offset > 0 ? `,adelay=${Math.round(offset * 1000)}|${Math.round(offset * 1000)}` : ''}[a1]`,
                    '[a0][a1]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]',
                ];
                filter = parts.join(';');
            }
            args.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
            if (loop) args.push('-shortest');
            const output = ctx.out(str(ctx.options.name, 'scored'), 'mp4');
            args.push('-movflags', '+faststart', output);
            return { args, output, note: `${mode === 'mix' ? '混音' : '替换音轨'} ← ${audio}` };
        },
    },

    {
        id: 'extract_audio',
        label: '导出音轨',
        labelEn: 'Extract audio',
        group: '声音',
        description: '把片子里的声音单独导出，便于再配、送审或做字幕对齐。',
        params: [
            { name: 'format', label: '格式', type: 'enum', default: 'wav', options: ['wav', 'mp3', 'm4a', 'flac', 'aac'] },
            { name: 'bitrate', label: '码率', type: 'string', default: '192k' },
            { name: 'sample_rate', label: '采样率', type: 'number', default: 48000, min: 8000, max: 192000, step: 100 },
            { name: 'channels', label: '声道', type: 'enum', default: '2', options: ['1', '2'] },
            { name: 'name', label: '输出名', type: 'string', default: 'audio' },
        ],
        build(ctx) {
            const format = str(ctx.options.format, 'wav');
            const codec = { wav: 'pcm_s16le', mp3: 'libmp3lame', m4a: 'aac', flac: 'flac', aac: 'aac' }[format] ?? 'pcm_s16le';
            const args = [
                ...baseArgs(), '-i', ctx.main, '-vn', '-c:a', codec,
                '-ar', String(num(ctx.options.sample_rate, 48000, 8000, 192000)),
                '-ac', str(ctx.options.channels, '2'),
            ];
            if (codec !== 'pcm_s16le' && codec !== 'flac') args.push('-b:a', str(ctx.options.bitrate, '192k'));
            const output = ctx.out(str(ctx.options.name, 'audio'), format);
            args.push(output);
            return { args, output };
        },
    },

    {
        id: 'loudnorm',
        label: '响度标准化',
        labelEn: 'Loudness normalize',
        group: '声音',
        description: 'EBU R128 两遍标准化，把成片响度拉到平台常用目标，避免忽大忽小。',
        params: [
            { name: 'i', label: '目标响度 LUFS', type: 'number', default: -16, min: -36, max: -5, step: 0.5 },
            { name: 'tp', label: '真峰上限 dBTP', type: 'number', default: -1.5, min: -9, max: 0, step: 0.1 },
            { name: 'lra', label: '响度范围 LU', type: 'number', default: 11, min: 1, max: 20, step: 0.5 },
            { name: 'name', label: '输出名', type: 'string', default: 'normalized' },
        ],
        build(ctx) {
            const filter = `loudnorm=I=${num(ctx.options.i, -16, -36, -5)}:TP=${num(ctx.options.tp, -1.5, -9, 0)}:LRA=${num(ctx.options.lra, 11, 1, 20)}:print_format=summary`;
            const output = ctx.out(str(ctx.options.name, 'normalized'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main,
                '-c:v', 'copy', '-af', filter, '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', output,
            ];
            return { args, output };
        },
    },

    {
        id: 'mute',
        label: '静音',
        labelEn: 'Remove audio',
        group: '声音',
        description: '去掉音轨（例如要自己配旁白时先清干净）。',
        params: [{ name: 'name', label: '输出名', type: 'string', default: 'silent' }],
        build(ctx) {
            const output = ctx.out(str(ctx.options.name, 'silent'), 'mp4');
            return { args: [...baseArgs(), '-i', ctx.main, '-an', '-c:v', 'copy', output], output };
        },
    },

    {
        id: 'scale',
        label: '缩放 / 画布',
        labelEn: 'Scale & fit',
        group: '画面',
        description: '改分辨率或换画布：fit 完整放下、fill 裁满、stretch 拉伸、pad 加边。',
        params: [
            { name: 'size', label: '目标尺寸（如 1920x1080）', type: 'string', default: '1920x1080' },
            { name: 'mode', label: '方式', type: 'enum', default: 'fit', options: ['fit', 'fill', 'stretch', 'pad'] },
            { name: 'pad_color', label: '补边颜色', type: 'string', default: '#000000' },
            { name: 'filter', label: '缩放算法', type: 'enum', default: 'lanczos', options: ['lanczos', 'bicubic', 'bilinear', 'neighbor', 'spline'] },
            { name: 'name', label: '输出名', type: 'string', default: 'scaled' },
        ],
        build(ctx) {
            const size = parseSize(ctx.options.size, { width: 1920, height: 1080 });
            const mode = str(ctx.options.mode, 'fit');
            const algo = str(ctx.options.filter, 'lanczos');
            const pad = colour(ctx.options.pad_color, '0x000000');
            // A bare width ("1280") only means something when the aspect ratio is
            // free to follow; the fixed-size modes need a real height.
            if (size.height === -2 && mode !== 'fit') {
                size.height = Math.round((size.width * 9) / 16 / 2) * 2;
            }
            let filter;
            if (mode === 'fill') {
                filter = `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase:flags=${algo},crop=${size.width}:${size.height},setsar=1`;
            }
            else if (mode === 'stretch') {
                filter = `scale=${size.width}:${size.height}:flags=${algo},setsar=1`;
            }
            else if (mode === 'pad') {
                filter = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease:flags=${algo},pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=${pad},setsar=1`;
            }
            else {
                filter = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease:flags=${algo},setsar=1`;
            }
            const output = ctx.out(str(ctx.options.name, 'scaled'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-vf', filter,
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output, note: filter };
        },
    },

    {
        id: 'ratio',
        label: '改画幅比例',
        labelEn: 'Change aspect',
        group: '画面',
        description: '竖屏/横屏/方屏互转：既可按比例裁切，也可补边保留全部画面。',
        params: [
            { name: 'aspect', label: '目标比例', type: 'enum', default: '9:16', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '2.35:1', '21:9'] },
            { name: 'mode', label: '方式', type: 'enum', default: 'crop', options: ['crop', 'pad'] },
            { name: 'height', label: '输出高度', type: 'number', default: 1280, min: 64, max: 4320, step: 2 },
            { name: 'pad_color', label: '补边颜色', type: 'string', default: '#000000' },
            { name: 'name', label: '输出名', type: 'string', default: 'reframed' },
        ],
        build(ctx) {
            const [aw, ah] = str(ctx.options.aspect, '9:16').split(':').map(Number);
            const height = Math.round(num(ctx.options.height, 1280, 64, 4320) / 2) * 2;
            const width = Math.round((height * (aw / ah)) / 2) * 2;
            const mode = str(ctx.options.mode, 'crop');
            const pad = colour(ctx.options.pad_color, '0x000000');
            const filter = mode === 'pad'
                ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${pad},setsar=1`
                : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
            const output = ctx.out(str(ctx.options.name, 'reframed'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-vf', filter,
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output, note: `${width}×${height}` };
        },
    },

    {
        id: 'fps',
        label: '改帧率',
        labelEn: 'Frame rate',
        group: '画面',
        description: '统一帧率（合片前对齐用），或降帧做风格化。',
        params: [
            { name: 'fps', label: '帧率', type: 'number', default: 24, min: 1, max: 120, step: 1 },
            { name: 'name', label: '输出名', type: 'string', default: 'fps' },
        ],
        build(ctx) {
            const fps = num(ctx.options.fps, 24, 1, 120);
            const output = ctx.out(str(ctx.options.name, 'fps'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-vf', `fps=${fps}`,
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output };
        },
    },

    {
        id: 'speed',
        label: '变速',
        labelEn: 'Speed',
        group: '画面',
        description: '整体加速/减速，音高可保持（atempo）或随速度变化。',
        params: [
            { name: 'factor', label: '倍速', type: 'number', default: 1.5, min: 0.1, max: 8, step: 0.05 },
            { name: 'keep_pitch', label: '保持音高', type: 'boolean', default: true },
            { name: 'name', label: '输出名', type: 'string', default: 'speed' },
        ],
        build(ctx) {
            const factor = num(ctx.options.factor, 1.5, 0.1, 8);
            const keepPitch = bool(ctx.options.keep_pitch, true);
            const video = `setpts=${(1 / factor).toFixed(6)}*PTS`;
            // atempo accepts 0.5–2.0 per instance, so chain it for extreme factors.
            const chain = [];
            let remaining = factor;
            while (remaining > 2) {
                chain.push('atempo=2');
                remaining /= 2;
            }
            while (remaining < 0.5) {
                chain.push('atempo=0.5');
                remaining /= 0.5;
            }
            chain.push(`atempo=${remaining.toFixed(4)}`);
            const audio = keepPitch ? chain.join(',') : `asetrate=48000*${factor},aresample=48000,atempo=${(1 / factor).toFixed(4)}`;
            const output = ctx.out(str(ctx.options.name, 'speed'), 'mp4');
            const args = [...baseArgs(), '-i', ctx.main];
            if (ctx.mainHasAudio === false) {
                args.push('-vf', video);
            }
            else {
                args.push(
                    '-filter_complex', `[0:v]${video}[v];[0:a]${audio}[a]`,
                    '-map', '[v]', '-map', '[a]',
                );
            }
            args.push(
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', output,
            );
            return { args, output };
        },
    },

    {
        id: 'fade',
        label: '淡入淡出',
        labelEn: 'Fade',
        group: '画面',
        description: '画面与声音一起淡入/淡出；片头片尾的常规处理。',
        params: [
            { name: 'in', label: '淡入（秒）', type: 'number', default: 0.5, min: 0, max: 20, step: 0.1 },
            { name: 'out', label: '淡出（秒）', type: 'number', default: 1, min: 0, max: 20, step: 0.1 },
            { name: 'color', label: '底色', type: 'string', default: '#000000' },
            { name: 'name', label: '输出名', type: 'string', default: 'faded' },
        ],
        build(ctx) {
            const fadeIn = num(ctx.options.in, 0.5, 0, 20);
            const fadeOut = num(ctx.options.out, 1, 0, 20);
            const total = ctx.mainDuration;
            const c = colour(ctx.options.color, '0x000000');
            const video = [];
            if (fadeIn > 0) video.push(`fade=t=in:st=0:d=${fadeIn}:color=${c}`);
            if (fadeOut > 0 && total !== undefined && total > fadeOut) video.push(`fade=t=out:st=${(total - fadeOut).toFixed(3)}:d=${fadeOut}:color=${c}`);
            const audio = [];
            if (fadeIn > 0) audio.push(`afade=t=in:st=0:d=${fadeIn}`);
            if (fadeOut > 0 && total !== undefined && total > fadeOut) audio.push(`afade=t=out:st=${(total - fadeOut).toFixed(3)}:d=${fadeOut}`);
            const output = ctx.out(str(ctx.options.name, 'faded'), 'mp4');
            const args = [...baseArgs(), '-i', ctx.main];
            if (video.length > 0) args.push('-vf', video.join(','));
            if (audio.length > 0 && ctx.mainHasAudio !== false) args.push('-af', audio.join(','));
            args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output);
            if (total === undefined && fadeOut > 0) {
                // Without a probed duration the fade-out has no start time; say so
                // instead of silently producing a clip with no fade at all.
                return { args, output, note: '未能探测到时长：淡出已跳过（请确认 ffprobe 可用）' };
            }
            return { args, output };
        },
    },

    {
        id: 'reverse',
        label: '倒放',
        labelEn: 'Reverse',
        group: '画面',
        description: '整段倒放（画面 + 声音）。',
        params: [{ name: 'name', label: '输出名', type: 'string', default: 'reversed' }],
        build(ctx) {
            const output = ctx.out(str(ctx.options.name, 'reversed'), 'mp4');
            const args = [...baseArgs(), '-i', ctx.main, '-vf', 'reverse'];
            // areverse has nothing to work on in a silent clip and fails the run.
            if (ctx.mainHasAudio !== false) args.push('-af', 'areverse');
            args.push(
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', output,
            );
            return { args, output };
        },
    },

    {
        id: 'loop',
        label: '循环 / 时长对齐',
        labelEn: 'Loop',
        group: '剪辑',
        description: '把片段循环到指定总时长，用于把短镜头铺满固定时长的卡点。',
        params: [
            { name: 'times', label: '循环次数（0=用目标时长）', type: 'number', default: 2, min: 0, max: 100, step: 1 },
            { name: 'target', label: '目标总时长（秒，0=不用）', type: 'number', default: 0, min: 0, max: 3600, step: 0.1 },
            { name: 'name', label: '输出名', type: 'string', default: 'looped' },
        ],
        build(ctx) {
            const times = Math.round(num(ctx.options.times, 2, 0, 100));
            const target = num(ctx.options.target, 0, 0, 3600);
            const output = ctx.out(str(ctx.options.name, 'looped'), 'mp4');
            const args = [...baseArgs(), '-stream_loop', String(Math.max(0, times - 1)), '-i', ctx.main];
            if (target > 0) args.push('-t', String(target));
            args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output);
            return { args, output };
        },
    },

    {
        id: 'watermark',
        label: '加水印',
        labelEn: 'Watermark',
        group: '画面',
        description: '叠加角标/台标图，可选九宫格位置、大小比例与不透明度。',
        params: [
            { name: 'position', label: '位置', type: 'enum', default: 'bottom-right', options: ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] },
            { name: 'scale', label: '宽度占比', type: 'number', default: 0.14, min: 0.01, max: 1, step: 0.01 },
            { name: 'opacity', label: '不透明度', type: 'number', default: 0.85, min: 0.05, max: 1, step: 0.05 },
            { name: 'margin', label: '边距（像素）', type: 'number', default: 28, min: 0, max: 400, step: 1 },
            { name: 'name', label: '输出名', type: 'string', default: 'watermarked' },
        ],
        needsExtras: true,
        build(ctx) {
            const mark = ctx.extras[0];
            if (mark === undefined) throw new FFmpegError('加水印需要一张水印图作为附加输入');
            const { x, y } = anchorExpressions(str(ctx.options.position, 'bottom-right'), num(ctx.options.margin, 28, 0, 400));
            const scale = num(ctx.options.scale, 0.14, 0.01, 1);
            const opacity = num(ctx.options.opacity, 0.85, 0.05, 1);
            const filter = `[1:v]scale=iw*${scale}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=${x}:${y}[v]`;
            const output = ctx.out(str(ctx.options.name, 'watermarked'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-i', mark,
                '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output };
        },
    },

    {
        id: 'text',
        label: '烧字 / 标题',
        labelEn: 'Burn text',
        group: '画面',
        description: '在画面上烧一段文字（标题、时间地点、免责声明）。文字走临时文件，不会被转义搞坏。',
        params: [
            { name: 'text', label: '文字', type: 'string', default: '' },
            { name: 'position', label: '位置', type: 'enum', default: 'bottom-center', options: ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] },
            { name: 'font_size', label: '字号', type: 'number', default: 44, min: 8, max: 400, step: 1 },
            { name: 'color', label: '字色', type: 'string', default: '#FFFFFF' },
            { name: 'border', label: '描边宽度', type: 'number', default: 3, min: 0, max: 20, step: 1 },
            { name: 'border_color', label: '描边色', type: 'string', default: '#000000' },
            { name: 'box', label: '加底框', type: 'boolean', default: false },
            { name: 'box_color', label: '底框色', type: 'string', default: '#00000099' },
            { name: 'font_file', label: '字体文件（可留空）', type: 'string', default: '' },
            { name: 'start', label: '出现（秒）', type: 'number', default: 0, min: 0, step: 0.1 },
            { name: 'end', label: '消失（秒，0=到片尾）', type: 'number', default: 0, min: 0, step: 0.1 },
            { name: 'name', label: '输出名', type: 'string', default: 'titled' },
        ],
        async build(ctx) {
            const text = String(ctx.options.text ?? '');
            if (text.trim() === '') throw new FFmpegError('烧字需要 text');
            const textFile = join(ctx.workDir, `text-${Date.now()}.txt`);
            await writeFile(textFile, text, 'utf8');
            const { x, y } = textAnchorExpressions(str(ctx.options.position, 'bottom-center'), 32);
            const parts = [
                `textfile='${filterPath(textFile)}'`,
                `fontsize=${Math.round(num(ctx.options.font_size, 44, 8, 400))}`,
                `fontcolor=${colour(ctx.options.color, '0xFFFFFF')}`,
                `x=${x}`,
                `y=${y}`,
            ];
            const border = Math.round(num(ctx.options.border, 3, 0, 20));
            if (border > 0) parts.push(`borderw=${border}`, `bordercolor=${colour(ctx.options.border_color, '0x000000')}`);
            if (bool(ctx.options.box, false)) parts.push('box=1', `boxcolor=${colour(ctx.options.box_color, '0x00000099')}`, 'boxborderw=14');
            const fontFile = str(ctx.options.font_file);
            if (fontFile !== '') parts.push(`fontfile='${filterPath(fontFile)}'`);
            const start = num(ctx.options.start, 0, 0);
            const end = num(ctx.options.end, 0, 0);
            if (start > 0 || end > 0) {
                parts.push(`enable='between(t,${start},${end > 0 ? end : 1e6})'`);
            }
            const output = ctx.out(str(ctx.options.name, 'titled'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-vf', `drawtext=${parts.join(':')}`,
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output, cleanup: [textFile] };
        },
    },

    {
        id: 'subtitle',
        label: '字幕',
        labelEn: 'Subtitles',
        group: '交付',
        description: '烧录硬字幕（srt/ass）或软封装成可开关的字幕轨。中文旁白片建议硬字幕，兼容性最好。',
        params: [
            { name: 'text', label: '字幕内容（srt/ass 文本；也可留空用文件）', type: 'string', default: '' },
            { name: 'mode', label: '方式', type: 'enum', default: 'burn', options: ['burn', 'soft'] },
            { name: 'font_size', label: '字号（硬字幕）', type: 'number', default: 26, min: 8, max: 200, step: 1 },
            { name: 'language', label: '语言标记（软字幕）', type: 'string', default: 'chi' },
            { name: 'name', label: '输出名', type: 'string', default: 'subtitled' },
        ],
        needsExtras: true,
        async build(ctx) {
            const inline = String(ctx.options.text ?? '');
            let subtitleFile = ctx.extras[0];
            const cleanup = [];
            if (subtitleFile === undefined && inline.trim() !== '') {
                subtitleFile = join(ctx.workDir, `subs-${Date.now()}.srt`);
                await writeFile(subtitleFile, inline, 'utf8');
                cleanup.push(subtitleFile);
            }
            if (subtitleFile === undefined) throw new FFmpegError('字幕需要一个 .srt/.ass 文件，或直接给 text');
            const mode = str(ctx.options.mode, 'burn');
            const isAss = /\.ass$/i.test(subtitleFile);
            if (mode === 'soft') {
                const output = ctx.out(str(ctx.options.name, 'subtitled'), 'mp4');
                const args = [
                    ...baseArgs(), '-i', ctx.main, '-i', subtitleFile,
                    '-map', '0', '-map', '1:0', '-c', 'copy',
                    '-c:s', 'mov_text', '-metadata:s:s:0', `language=${str(ctx.options.language, 'chi')}`,
                    '-movflags', '+faststart', output,
                ];
                return { args, output, cleanup, note: '软字幕（可在播放器里开关）' };
            }
            const size = Math.round(num(ctx.options.font_size, 26, 8, 200));
            const filter = isAss
                ? `ass='${filterPath(subtitleFile)}'`
                : `subtitles=filename='${filterPath(subtitleFile)}':force_style='FontSize=${size},Outline=2,Shadow=1,MarginV=28'`;
            const output = ctx.out(str(ctx.options.name, 'subtitled'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-vf', filter,
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output, cleanup, note: '硬字幕' };
        },
    },

    {
        id: 'stack',
        label: '并排 / 上下对比',
        labelEn: 'Compare',
        group: '画面',
        description: '把两条片子并排或上下叠在一个画面里——对比参考图和成片、对比两版生成最直观。',
        params: [
            { name: 'layout', label: '排列', type: 'enum', default: 'hstack', options: ['hstack', 'vstack'] },
            { name: 'gap', label: '间距（像素）', type: 'number', default: 8, min: 0, max: 200, step: 1 },
            { name: 'gap_color', label: '间距色', type: 'string', default: '#101010' },
            { name: 'name', label: '输出名', type: 'string', default: 'compare' },
        ],
        needsExtras: true,
        build(ctx) {
            const second = ctx.extras[0];
            if (second === undefined) throw new FFmpegError('对比需要第二条视频');
            const layout = str(ctx.options.layout, 'hstack') === 'vstack' ? 'vstack' : 'hstack';
            const gap = Math.round(num(ctx.options.gap, 8, 0, 200));
            const gapColor = colour(ctx.options.gap_color, '0x101010');
            let filter;
            if (gap > 0) {
                const [first2, second2] = layout === 'hstack'
                    ? [`[0:v]pad=iw+${gap}:ih:0:0:color=${gapColor}[a]`, `[1:v]pad=iw+${gap}:ih:${gap}:0:color=${gapColor}[b]`]
                    : [`[0:v]pad=iw:ih+${gap}:0:0:color=${gapColor}[a]`, `[1:v]pad=iw:ih+${gap}:0:${gap}:color=${gapColor}[b]`];
                filter = `${first2};${second2};[a][b]${layout}=shortest=1[v]`;
            }
            else {
                filter = `[0:v][1:v]${layout}=shortest=1[v]`;
            }
            const output = ctx.out(str(ctx.options.name, 'compare'), 'mp4');
            const args = [
                ...baseArgs(), '-i', ctx.main, '-i', second,
                '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                '-movflags', '+faststart', output,
            ];
            return { args, output };
        },
    },

    {
        id: 'poster',
        label: '抽封面帧',
        labelEn: 'Poster frame',
        group: '交付',
        description: '在指定时间点抽一张静帧做封面/缩略图。',
        params: [
            { name: 'time', label: '时间点（秒）', type: 'number', default: 0.5, min: 0, step: 0.01 },
            { name: 'format', label: '格式', type: 'enum', default: 'png', options: ['png', 'jpg', 'webp'] },
            { name: 'width', label: '宽度（0=原尺寸）', type: 'number', default: 0, min: 0, max: 8192, step: 2 },
            { name: 'name', label: '输出名', type: 'string', default: 'poster' },
        ],
        build(ctx) {
            const time = num(ctx.options.time, 0.5, 0);
            const format = str(ctx.options.format, 'png');
            const width = num(ctx.options.width, 0, 0, 8192);
            const args = [...baseArgs(), '-ss', String(time), '-i', ctx.main, '-frames:v', '1'];
            if (width > 0) args.push('-vf', `scale=${Math.round(width)}:-2`);
            else if (format === 'jpg') args.push('-q:v', '2');
            const output = ctx.out(str(ctx.options.name, 'poster'), format);
            args.push(output);
            return { args, output };
        },
    },

    {
        id: 'contact_sheet',
        label: '分镜缩略图',
        labelEn: 'Contact sheet',
        group: '交付',
        description: '按固定间隔抽帧拼成一张网格图，用来一眼看完整条片子的分镜节奏。',
        params: [
            { name: 'interval', label: '抽帧间隔（秒）', type: 'number', default: 1, min: 0.05, step: 0.05 },
            { name: 'columns', label: '列数', type: 'number', default: 4, min: 1, max: 12, step: 1 },
            { name: 'rows', label: '行数', type: 'number', default: 3, min: 1, max: 12, step: 1 },
            { name: 'tile_width', label: '单格宽度', type: 'number', default: 320, min: 64, max: 1280, step: 2 },
            { name: 'name', label: '输出名', type: 'string', default: 'sheet' },
        ],
        build(ctx) {
            const interval = num(ctx.options.interval, 1, 0.05);
            const columns = Math.round(num(ctx.options.columns, 4, 1, 12));
            const rows = Math.round(num(ctx.options.rows, 3, 1, 12));
            const tileWidth = Math.round(num(ctx.options.tile_width, 320, 64, 1280) / 2) * 2;
            const count = columns * rows;
            const output = ctx.out(str(ctx.options.name, 'sheet'), 'png');
            const fps = Math.max(0.01, 1 / interval);
            const args = [
                ...baseArgs(), '-i', ctx.main,
                '-vf', `fps=${fps.toFixed(4)},scale=${tileWidth}:-2,tile=${columns}x${rows}:padding=6:margin=6`,
                '-frames:v', '1', output,
            ];
            return { args, output, note: `${columns}×${rows} = 最多 ${count} 格` };
        },
    },

    {
        id: 'gif',
        label: '导出 GIF',
        labelEn: 'Export GIF',
        group: '交付',
        description: '两遍调色板调优的高质量 GIF，适合做预览和表情包。',
        params: [
            { name: 'start', label: '开始（秒）', type: 'number', default: 0, min: 0, step: 0.05 },
            { name: 'duration', label: '时长（秒）', type: 'number', default: 3, min: 0.1, max: 60, step: 0.1 },
            { name: 'fps', label: '帧率', type: 'number', default: 12, min: 4, max: 30, step: 1 },
            { name: 'width', label: '宽度', type: 'number', default: 480, min: 64, max: 1280, step: 2 },
            { name: 'loop', label: '循环次数（0=无限）', type: 'number', default: 0, min: 0, max: 100, step: 1 },
            { name: 'name', label: '输出名', type: 'string', default: 'preview' },
        ],
        /** Two-pass palette generation needs two sequential commands. */
        build(ctx) {
            const start = num(ctx.options.start, 0, 0);
            const duration = num(ctx.options.duration, 3, 0.1, 60);
            const fps = num(ctx.options.fps, 12, 4, 30);
            const width = Math.round(num(ctx.options.width, 480, 64, 1280) / 2) * 2;
            const loop = Math.round(num(ctx.options.loop, 0, 0, 100));
            const output = ctx.out(str(ctx.options.name, 'preview'), 'gif');
            const palette = join(ctx.workDir, `palette-${Date.now()}.png`);
            const filter = `fps=${fps},scale=${width}:-1:flags=lanczos`;
            const pass1 = [
                ...baseArgs(), '-ss', String(start), '-t', String(duration), '-i', ctx.main,
                '-vf', `${filter},palettegen=stats_mode=diff`, palette,
            ];
            const pass2 = [
                ...baseArgs(), '-ss', String(start), '-t', String(duration), '-i', ctx.main,
                '-i', palette,
                '-lavfi', `${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
                '-loop', String(loop), output,
            ];
            return { args: pass2, output, prelude: [pass1], cleanup: [palette], note: '两遍调色板' };
        },
    },

    {
        id: 'images_to_video',
        label: '图片序列转视频',
        labelEn: 'Images to video',
        group: '剪辑',
        description: '把一串帧图（%05d.png 形式）合成视频，便于接外部补帧/重绘后再回到时间线。',
        params: [
            { name: 'pattern', label: '文件名模板（如 frame_%05d.png）', type: 'string', default: 'frame_%05d.png' },
            { name: 'fps', label: '帧率', type: 'number', default: 24, min: 1, max: 120, step: 1 },
            { name: 'audio', label: '要附的音频（可留空）', type: 'string', default: '' },
            { name: 'name', label: '输出名', type: 'string', default: 'sequence' },
        ],
        build(ctx) {
            const pattern = str(ctx.options.pattern, 'frame_%05d.png');
            const fps = num(ctx.options.fps, 24, 1, 120);
            const audio = str(ctx.options.audio);
            // `%05d` is an FFmpeg image-sequence token, not a filesystem path, so
            // the pattern is resolved against the work directory as-is.
            const sequence = isAbsolute(pattern) ? pattern : join(ctx.workDir, pattern);
            const output = ctx.out(str(ctx.options.name, 'sequence'), 'mp4');
            const args = [...baseArgs(), '-framerate', String(fps), '-i', sequence];
            if (audio !== '') args.push('-i', audio, '-map', '0:v', '-map', '1:a', '-shortest');
            args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p');
            if (audio !== '') args.push('-c:a', 'aac', '-b:a', '192k');
            args.push('-movflags', '+faststart', output);
            return { args, output, note: '音频需为本地路径' };
        },
    },
];

/** Look up one op descriptor by id. */
export function findOp(id) {
    return POST_OPS.find((op) => op.id === id);
}

/** The parameter descriptors of one op, as a flat list for the tool/panel. */
export function opParams(id) {
    return findOp(id)?.params ?? [];
}

/**
 * Apply an op's declared defaults to a raw options object, so a caller that
 * omits a field gets the same value the panel shows.
 */
export function withDefaults(id, raw) {
    const params = opParams(id);
    const out = {};
    for (const param of params) {
        const value = raw?.[param.name];
        if (value === undefined || value === null || value === '') out[param.name] = param.default;
        else if (param.type === 'number') out[param.name] = Number(value);
        else if (param.type === 'boolean') out[param.name] = bool(value, param.default);
        else out[param.name] = value;
    }
    return out;
}

/** A hidden helper kept for the panel: the op catalog without its build closures. */
export function postOpCatalog() {
    return POST_OPS.map((op) => ({
        id: op.id,
        label: op.label,
        labelEn: op.labelEn,
        group: op.group,
        description: op.description,
        needsExtras: op.needsExtras === true,
        params: op.params,
    }));
}

/** Compose a human-readable command line for display. Never executed: argv goes
 *  to spawn directly, so this is only for logs and the `command` field on a
 *  render record. */
export function previewCommand(exe, args) {
    return [exe ?? 'ffmpeg', ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}