/**
 * dsh-minimax-h3 host configuration.
 *
 * This plugin deliberately declares **no `Config` schema and no dependencies**.
 *
 * A `dsh.bundle` installed from a directory is linked into the profile as a
 * portal (`link:`), which means Node resolves its bare imports against the
 * package's own real location — not the profile's `node_modules`. A dependency
 * declared here would therefore never resolve at runtime, and the entry would
 * fail to import. Keeping this module schema-free is what lets the bundle
 * install as a plain link with nothing to fetch.
 *
 * The trade-off is that the host cannot auto-generate a settings page from a
 * schema, so settings are owned here instead: the entry config in
 * `cordis.patch.yml` is the baseline, and anything the user changes in the
 * plugin's own panel is persisted to `<dataDir>/settings.json` and layered on
 * top. Overrides win, so a live change always beats the file it was made from.
 *
 * Field order of precedence: defaults → `cordis.patch.yml` row config → live
 * overrides saved by the panel.
 */

/** Every tunable field, its default, and how to read it. */
export const CONFIG_DEFAULTS = {
    baseUrl: 'http://127.0.0.1:8188',
    apiKeyEnv: 'COMFYUI_API_KEY',
    /** Header name the credential is sent in; empty disables auth entirely. */
    authHeader: 'Authorization',
    /** Scheme prefix before the key; empty sends the key verbatim (`x-api-key` style). */
    authScheme: 'Bearer',
    connectTimeoutMs: 10_000,
    timeoutMs: 1_800_000,
    pollIntervalMs: 1_000,
    maxMediaItems: 12,
    maxMediaBytes: 536_870_912,
    dataDir: '',
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

/** The fields a settings write may touch; anything else is a typo and is dropped. */
export const CONFIG_FIELDS = new Set(Object.keys(CONFIG_DEFAULTS));

/** Fields the store is built from at apply time: changing one restarts the plugin. */
export const RESTART_FIELDS = new Set(['dataDir']);

/** The volatile-reference protocol shared across cosmokit copies (Symbol.for). */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** Read a config value that may be a volatile reference (dsh 0.1.7+) or a plain value. */
function current(value) {
    if (typeof value === 'object' && value !== null && VOLATILE_WRITE in value) {
        try {
            return value.get();
        }
        catch {
            return undefined;
        }
    }
    return value;
}

/**
 * Resolve the entry config and any saved overrides into the plain object every
 * consumer reads.
 *
 * @param raw - parsed entry config from the Loader row; values may be volatile references.
 * @param defaultDataDir - data directory used when `dataDir` is empty.
 * @param overrides - live overrides saved by the panel; they win over `raw`.
 * @returns a fully populated plain config.
 */
export function resolveConfig(raw, defaultDataDir, overrides = {}) {
    const merged = { ...(raw ?? {}) };
    for (const [key, value] of Object.entries(overrides ?? {})) {
        // An explicit undefined in a saved override must not shadow the baseline.
        if (value !== undefined && CONFIG_FIELDS.has(key)) merged[key] = value;
    }

    const str = (key, fallback) => {
        const value = current(merged[key]);
        return typeof value === 'string' ? value : fallback;
    };
    const num = (key, fallback) => {
        const value = current(merged[key]);
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    const bool = (key, fallback) => {
        const value = current(merged[key]);
        return typeof value === 'boolean' ? value : fallback;
    };

    const dataDir = str('dataDir', '');
    const dirs = current(merged.comfyuiDirs);
    return {
        baseUrl: str('baseUrl', CONFIG_DEFAULTS.baseUrl),
        apiKeyEnv: str('apiKeyEnv', CONFIG_DEFAULTS.apiKeyEnv),
        authHeader: str('authHeader', CONFIG_DEFAULTS.authHeader),
        authScheme: str('authScheme', CONFIG_DEFAULTS.authScheme),
        connectTimeoutMs: num('connectTimeoutMs', CONFIG_DEFAULTS.connectTimeoutMs),
        timeoutMs: num('timeoutMs', CONFIG_DEFAULTS.timeoutMs),
        pollIntervalMs: num('pollIntervalMs', CONFIG_DEFAULTS.pollIntervalMs),
        maxMediaItems: num('maxMediaItems', CONFIG_DEFAULTS.maxMediaItems),
        maxMediaBytes: num('maxMediaBytes', CONFIG_DEFAULTS.maxMediaBytes),
        dataDir: dataDir !== '' ? dataDir : defaultDataDir,
        comfyuiDirs: Array.isArray(dirs)
            ? dirs.filter((dir) => typeof dir === 'string' && dir.trim() !== '')
            : [],
        mediaHost: str('mediaHost', CONFIG_DEFAULTS.mediaHost),
        ffmpegPath: str('ffmpegPath', CONFIG_DEFAULTS.ffmpegPath),
        ffprobePath: str('ffprobePath', CONFIG_DEFAULTS.ffprobePath),
        ffmpegTimeoutMs: num('ffmpegTimeoutMs', CONFIG_DEFAULTS.ffmpegTimeoutMs),
        defaultAspect: str('defaultAspect', CONFIG_DEFAULTS.defaultAspect),
        defaultMegapixels: num('defaultMegapixels', CONFIG_DEFAULTS.defaultMegapixels),
        defaultDuration: num('defaultDuration', CONFIG_DEFAULTS.defaultDuration),
        defaultMode: str('defaultMode', CONFIG_DEFAULTS.defaultMode),
        defaultTurbo: bool('defaultTurbo', CONFIG_DEFAULTS.defaultTurbo),
        maxRuns: num('maxRuns', CONFIG_DEFAULTS.maxRuns),
        maxRenders: num('maxRenders', CONFIG_DEFAULTS.maxRenders),
    };
}

/**
 * Keep only the fields a settings write is allowed to persist, with the type
 * each one needs. Unknown keys and unparseable values are dropped rather than
 * written, because a saved override is applied blindly on every later start.
 *
 * @returns `{ patch, rejected }`
 */
export function sanitizeSettingsPatch(input) {
    const patch = {};
    const rejected = [];
    const numbers = new Set([
        'connectTimeoutMs', 'timeoutMs', 'pollIntervalMs', 'maxMediaItems', 'maxMediaBytes',
        'ffmpegTimeoutMs', 'defaultMegapixels', 'defaultDuration', 'maxRuns', 'maxRenders',
    ]);
    const booleans = new Set(['defaultTurbo']);
    const lists = new Set(['comfyuiDirs']);
    for (const [key, value] of Object.entries(input ?? {})) {
        if (!CONFIG_FIELDS.has(key)) {
            rejected.push(key);
            continue;
        }
        if (lists.has(key)) {
            patch[key] = (Array.isArray(value) ? value : [])
                .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
                .map((entry) => entry.trim());
            continue;
        }
        if (booleans.has(key)) {
            patch[key] = value === true || value === 'true';
            continue;
        }
        if (numbers.has(key)) {
            const parsed = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(parsed)) {
                rejected.push(key);
                continue;
            }
            patch[key] = parsed;
            continue;
        }
        if (typeof value !== 'string') {
            rejected.push(key);
            continue;
        }
        patch[key] = value.trim();
    }
    return { patch, rejected };
}