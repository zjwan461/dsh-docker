/**
 * dsh-minimax-h3 — the MiniMax H3 video studio.
 *
 * One plugin, one job: drive MiniMax H3 on a ComfyUI server for video
 * generation, and finish the result with FFmpeg. It deliberately does not try
 * to be a general ComfyUI client — there is no workflow library, no canvas
 * extraction and no image pipeline. What it does instead is own the parts that
 * a video pipeline actually needs: a faithful port of the three official H3
 * graphs, a reference-image path that gets stills into ComfyUI, a shot board
 * that survives across sessions, and a post-processing surface.
 *
 * Registration follows the harness conventions:
 * - `tools` is a hard dependency, declared in `inject`, because the fiber must
 *   wait for the registry before writing into it.
 * - `webServer`, `settings`, `skills` and `credentials` stay optional: the
 *   plugin degrades to tools-only on a headless host instead of throwing.
 * - Every registration lives inside an effect and returns its disposer, so
 *   unloading the plugin removes exactly what it added.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RESTART_FIELDS, resolveConfig, sanitizeSettingsPatch } from './config.js';
import { H3Store } from './store.js';
import { createStudio } from './studio.js';
import { registerH3Tools } from './tools.js';
import { mountH3Routes } from './routes.js';
import { H3_SKILL } from './skill.js';
import { createHostHint, detectLanOrigin } from './host-hint.js';

export const name = 'dsh-minimax-h3';

/**
 * Required services. Only the tool registry: reading `ctx.tools` without
 * declaring it here is what cordis rejects with `cannot get property "tools"
 * without inject`.
 */
export const inject = ['tools'];

/** Default plugin data directory under the harness home. */
function defaultDataDir() {
    const base = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(base, 'data', 'dsh-minimax-h3');
}

/** Resolve the optional ComfyUI API key from credentials first, then the environment. */
async function resolveApiKey(ctx, envName) {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
        try {
            const resolved = await credentials.resolve(envName);
            if (resolved !== undefined) return resolved.value;
        }
        catch {
            // Fall through to the process environment.
        }
    }
    return process.env[envName];
}

export async function apply(ctx, entryConfig) {
    // Older hosts and hand-written rows can leave this undefined; every read
    // below assumes an object.
    const rawEntry = entryConfig ?? {};
    // The store is built from the *baseline* data directory, before saved
    // overrides are read — those overrides live inside the store, so the store
    // cannot depend on them. `dataDir` is therefore a restart field.
    const baseline = resolveConfig(rawEntry, defaultDataDir());
    const store = new H3Store(baseline.dataDir, {
        maxRuns: baseline.maxRuns,
        maxRenders: baseline.maxRenders,
    });
    await store.init();
    // Anything still marked in-flight belongs to a previous process, and a record
    // left at `queued` would make the panel poll the ComfyUI queue forever.
    await store.reconcileRuns();

    // Settings the user changed in the panel are layered over the entry config.
    // `dataDir` is excluded: it was already used to build the store, and a saved
    // value would silently point two stores at different directories.
    const saved = await store.loadSettings();
    delete saved.dataDir;

    // The one plain object every consumer reads, refreshed in place when a
    // setting changes so a live edit needs no restart.
    const resolved = resolveConfig(rawEntry, defaultDataDir(), saved);

    const hostHint = createHostHint();

    /**
     * The absolute base URL generated media should be addressed with. Chat
     * markdown needs a full URL, and the correct host is whatever the browser
     * actually reached — loopback, LAN address, Tailscale name or proxy.
     */
    const proxyBase = () => {
        const explicit = (resolved.mediaHost ?? '').trim().replace(/\/+$/, '');
        if (explicit !== '') return explicit;
        const hinted = hostHint.origin();
        if (hinted !== undefined) return hinted;
        const webServer = ctx.get('webServer');
        if (webServer === undefined || webServer.port === undefined) return undefined;
        const lan = detectLanOrigin(webServer.port);
        if (lan !== undefined) return lan;
        const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : (webServer.host ?? '127.0.0.1');
        return `http://${host}:${webServer.port}`;
    };

    const studio = createStudio({
        store,
        getConfig: () => resolved,
        getApiKey: () => resolveApiKey(ctx, resolved.apiKeyEnv),
        proxyBase,
    });

    /** Replace the live config in place; readers hold this same reference. */
    const refreshConfig = (next) => {
        Object.assign(resolved, next);
    };

    /** Pick up a change to the entry config (or a volatile-reference update) in place. */
    const reread = async () => {
        const overrides = await store.loadSettings();
        delete overrides.dataDir;
        refreshConfig(resolveConfig(rawEntry, defaultDataDir(), overrides));
    };
    ctx.on('loader/volatile-update', () => {
        void reread();
    });

    // This plugin owns its configuration (see lib/config.js), so a panel write
    // is always possible: it lands in <dataDir>/settings.json and is re-read
    // immediately. The host's settings service is not involved.
    const settingsWritable = () => true;

    /**
     * Persist a settings change and apply it without a restart.
     *
     * Unknown keys are dropped and reported rather than written: a saved
     * override is replayed on every later start, so a typo would otherwise
     * become permanent.
     */
    const updateConfig = async (patch) => {
        const { patch: clean, rejected } = sanitizeSettingsPatch(patch);
        for (const key of Object.keys(clean)) {
            if (RESTART_FIELDS.has(key)) {
                delete clean[key];
                rejected.push(key);
            }
        }
        if (Object.keys(clean).length === 0) {
            return {
                ok: false,
                error: rejected.length > 0
                    ? `没有可写入的设置项（已忽略：${rejected.join(', ')}）`
                    : '没有可写入的设置项',
            };
        }
        const savedNext = await store.saveSettings(clean);
        refreshConfig(resolveConfig(rawEntry, defaultDataDir(), savedNext));
        return { ok: true, ignored: rejected };
    };

    ctx.effect(() => {
        const disposers = registerH3Tools(ctx, studio, () => resolved);
        return () => {
            for (const dispose of disposers) dispose();
        };
    }, 'dsh-minimax-h3: tools');

    // The companion skill rides the same optional-services pattern: a host
    // without a skills service simply skips it. Runtime skills register at rank
    // 250, so project and user skills can override the shipped guidance.
    ctx.effect(() => {
        const skills = ctx.get('skills');
        if (skills === undefined) return () => {};
        return skills.register({ ...H3_SKILL, content: H3_SKILL.content });
    }, 'dsh-minimax-h3: skill');

    // Routes ride a `webServer` sub-fiber rather than a one-shot `ctx.get` at
    // apply time: loader entries settle concurrently, so reading the service
    // here would silently skip the mount whenever the web server happens to
    // activate after this plugin. A headless host never activates this fiber
    // and keeps the tools alone.
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => {
            const dispose = mountH3Routes(webCtx, {
                studio,
                getConfig: () => resolved,
                getApiKey: () => resolveApiKey(ctx, resolved.apiKeyEnv),
                updateConfig,
                settingsWritable,
                hostHint,
                proxyBase,
            });
            return () => {
                if (typeof dispose === 'function') dispose();
            };
        }, 'dsh-minimax-h3: panel routes');
    });
}