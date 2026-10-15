/**
 * Plugin-owned persistence.
 *
 * Everything the studio remembers between restarts lives in a handful of JSON
 * documents under one data directory: generation runs, post-processing renders,
 * shot-board projects, and the index of reference assets that were uploaded.
 *
 * Two properties matter more than anything here:
 *
 * - **Atomic writes.** Each document is written to a sibling `.tmp` and renamed
 *   over the target, so a crash or a killed process never leaves a half-written
 *   file that fails to parse on the next start.
 * - **Serialised mutations.** Every document owns a promise chain; concurrent
 *   callers queue instead of interleaving a read-modify-write and losing a
 *   record. Reads inside `update()` always come from the in-memory copy, which
 *   is refreshed once at startup.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

/** Newest-first, capped list helper shared by every document. */
function cap(list, max) {
    if (!Array.isArray(list)) return [];
    if (!Number.isFinite(max) || max <= 0) return list;
    return list.length > max ? list.slice(0, max) : list;
}

/** One JSON document with atomic writes and a serialised mutation queue. */
class JsonFile {
    constructor(path, fallback) {
        this.path = path;
        this.fallback = fallback;
        this.value = undefined;
        this.queue = Promise.resolve();
    }

    async load() {
        try {
            const text = await readFile(this.path, 'utf8');
            const parsed = JSON.parse(text);
            this.value = parsed ?? this.fallback;
        }
        catch {
            // Missing or corrupt: start clean rather than refusing to boot. The
            // corrupt file is left in place for a human to inspect.
            this.value = Array.isArray(this.fallback) ? [] : { ...this.fallback };
        }
        return this.value;
    }

    /** Ensure the document is loaded before any read. */
    async current() {
        if (this.value === undefined) await this.load();
        return this.value;
    }

    async persist() {
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8');
        await rename(tmp, this.path);
    }

    /** Queue a mutation; `fn` receives the live value and may return a result. */
    update(fn) {
        const run = this.queue.then(async () => {
            const value = await this.current();
            const result = await fn(value);
            await this.persist();
            return result;
        });
        // Keep the chain alive even when a mutation throws, so one failure does
        // not wedge every later write.
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
}

/** Parse a shot's duration safely. */
function asDuration(value, fallback = 5) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class H3Store {
    /**
     * @param dataDir - absolute plugin data directory.
     * @param limits.maxRuns - retained generation records.
     * @param limits.maxRenders - retained post-processing records.
     */
    constructor(dataDir, limits = {}) {
        this.dataDir = resolve(dataDir);
        this.maxRuns = limits.maxRuns ?? 400;
        this.maxRenders = limits.maxRenders ?? 400;
        this.runsFile = new JsonFile(join(this.dataDir, 'runs.json'), []);
        this.rendersFile = new JsonFile(join(this.dataDir, 'renders.json'), []);
        this.projectsFile = new JsonFile(join(this.dataDir, 'projects.json'), []);
        this.assetsFile = new JsonFile(join(this.dataDir, 'assets.json'), []);
        /** Live settings overrides saved from the panel; layered over the entry config. */
        this.settingsFile = new JsonFile(join(this.dataDir, 'settings.json'), {});
    }

    /** Where post-processed outputs and cached source clips live. */
    get rendersRoot() {
        return join(this.dataDir, 'renders');
    }

    get cacheRoot() {
        return join(this.dataDir, 'cache');
    }

    get workRoot() {
        return join(this.dataDir, 'work');
    }

    /** Files the user attached for FFmpeg ops (watermarks, music, subtitles). */
    get uploadsRoot() {
        return join(this.dataDir, 'uploads');
    }

    async init() {
        await mkdir(this.dataDir, { recursive: true });
        await mkdir(this.rendersRoot, { recursive: true });
        await mkdir(this.cacheRoot, { recursive: true });
        await mkdir(this.workRoot, { recursive: true });
        await mkdir(this.uploadsRoot, { recursive: true });
        await Promise.all([
            this.runsFile.load(),
            this.rendersFile.load(),
            this.projectsFile.load(),
            this.assetsFile.load(),
            this.settingsFile.load(),
        ]);
    }

    /* ---------------------------------------------------------------- */
    /* Settings overrides                                                */
    /* ---------------------------------------------------------------- */

    /**
     * The saved settings overrides. This plugin owns them instead of
     * registering a `Config` schema, because a directory-linked bundle cannot
     * resolve a schema dependency at runtime (see lib/config.js).
     */
    async loadSettings() {
        const value = await this.settingsFile.current();
        // A copy, so a caller that drops a restart-only field cannot mutate the
        // in-memory document and have that edit ride along on the next write.
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    }

    /** Merge a validated patch into the saved overrides. */
    async saveSettings(patch) {
        return this.settingsFile.update((currentValue) => {
            const next = { ...currentValue };
            for (const [key, value] of Object.entries(patch ?? {})) {
                if (value === undefined) delete next[key];
                else next[key] = value;
            }
            // JsonFile persists the live reference, so replace its contents in place.
            for (const key of Object.keys(currentValue)) delete currentValue[key];
            Object.assign(currentValue, next);
            return { ...next };
        });
    }

    /* ---------------------------------------------------------------- */
    /* Generation runs                                                   */
    /* ---------------------------------------------------------------- */

    async listRuns() {
        const list = await this.runsFile.current();
        return Array.isArray(list) ? list : [];
    }

    async getRun(id) {
        return (await this.listRuns()).find((run) => run.id === id);
    }

    /** Insert or replace a run, keeping the list newest-first and capped. */
    async saveRun(run) {
        return this.runsFile.update((list) => {
            const record = {
                id: run.id ?? `run-${randomUUID().slice(0, 8)}`,
                createdAt: run.createdAt ?? new Date().toISOString(),
                ...run,
            };
            const next = [record, ...list.filter((entry) => entry.id !== record.id)];
            list.length = 0;
            list.push(...cap(next, this.maxRuns));
            return record;
        });
    }

    /** Patch one run in place; resolves undefined when the id is unknown. */
    async updateRun(id, patch) {
        return this.runsFile.update((list) => {
            const index = list.findIndex((run) => run.id === id);
            if (index < 0) return undefined;
            const next = { ...list[index], ...patch, id };
            list[index] = next;
            return next;
        });
    }

    async deleteRun(id) {
        return this.runsFile.update((list) => {
            const index = list.findIndex((run) => run.id === id);
            if (index < 0) return false;
            list.splice(index, 1);
            return true;
        });
    }

    /* ---------------------------------------------------------------- */
    /* Post-processing renders                                           */
    /* ---------------------------------------------------------------- */

    async listRenders() {
        const list = await this.rendersFile.current();
        return Array.isArray(list) ? list : [];
    }

    async getRender(id) {
        return (await this.listRenders()).find((render) => render.id === id);
    }

    async saveRender(render) {
        return this.rendersFile.update((list) => {
            const record = {
                id: render.id ?? `render-${randomUUID().slice(0, 8)}`,
                createdAt: render.createdAt ?? new Date().toISOString(),
                ...render,
            };
            const next = [record, ...list.filter((entry) => entry.id !== record.id)];
            list.length = 0;
            list.push(...cap(next, this.maxRenders));
            return record;
        });
    }

    async deleteRender(id) {
        return this.rendersFile.update((list) => {
            const index = list.findIndex((render) => render.id === id);
            if (index < 0) return false;
            list.splice(index, 1);
            return true;
        });
    }

    /* ---------------------------------------------------------------- */
    /* Shot-board projects                                               */
    /* ---------------------------------------------------------------- */

    async listProjects() {
        const list = await this.projectsFile.current();
        return Array.isArray(list) ? list : [];
    }

    async getProject(id) {
        return (await this.listProjects()).find((project) => project.id === id);
    }

    /**
     * Create or update a project. Shots arrive as a partial list and are merged
     * by id, so the panel can send one changed shot without echoing the rest.
     */
    async saveProject(input) {
        return this.projectsFile.update((list) => {
            const now = new Date().toISOString();
            const existing = input.id === undefined ? undefined : list.find((project) => project.id === input.id);
            const id = existing?.id ?? `proj-${randomUUID().slice(0, 8)}`;
            const shots = existing?.shots ?? [];
            if (Array.isArray(input.shots)) {
                for (const patch of input.shots) {
                    const index = patch.id === undefined ? -1 : shots.findIndex((shot) => shot.id === patch.id);
                    if (index >= 0) {
                        shots[index] = { ...shots[index], ...patch, id: shots[index].id };
                    }
                    else {
                        shots.push({
                            id: patch.id ?? `shot-${randomUUID().slice(0, 8)}`,
                            mode: patch.mode ?? 't2v',
                            prompt: patch.prompt ?? '',
                            refs: Array.isArray(patch.refs) ? patch.refs : [],
                            duration: asDuration(patch.duration, 5),
                            aspect: patch.aspect ?? '',
                            seed: patch.seed,
                            turbo: patch.turbo === true,
                            title: patch.title ?? '',
                            notes: patch.notes ?? '',
                            status: patch.status ?? 'draft',
                            media: Array.isArray(patch.media) ? patch.media : [],
                            runId: patch.runId ?? null,
                            updatedAt: now,
                        });
                    }
                }
            }
            if (Array.isArray(input.removeShotIds)) {
                for (const removeId of input.removeShotIds) {
                    const index = shots.findIndex((shot) => shot.id === removeId);
                    if (index >= 0) shots.splice(index, 1);
                }
            }
            const record = {
                ...existing,
                ...input,
                id,
                shots,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            };
            delete record.removeShotIds;
            const next = [record, ...list.filter((project) => project.id !== id)];
            list.length = 0;
            list.push(...next);
            return record;
        });
    }

    async deleteProject(id) {
        return this.projectsFile.update((list) => {
            const index = list.findIndex((project) => project.id === id);
            if (index < 0) return false;
            list.splice(index, 1);
            return true;
        });
    }

    /* ---------------------------------------------------------------- */
    /* Reference assets                                                  */
    /* ---------------------------------------------------------------- */

    /** Assets are keyed by their ComfyUI input-dir name: that is what a graph uses. */
    async listAssets() {
        const list = await this.assetsFile.current();
        return Array.isArray(list) ? list : [];
    }

    async saveAsset(asset) {
        return this.assetsFile.update((list) => {
            const record = { ...asset, updatedAt: new Date().toISOString() };
            const next = [record, ...list.filter((entry) => entry.name !== record.name)];
            list.length = 0;
            list.push(...next);
            return record;
        });
    }

    async deleteAsset(name) {
        return this.assetsFile.update((list) => {
            const index = list.findIndex((entry) => entry.name === name);
            if (index < 0) return false;
            list.splice(index, 1);
            return true;
        });
    }

    /** Remove one file, ignoring "already gone". */
    async removeFile(path) {
        try {
            await unlink(path);
            return true;
        }
        catch {
            return false;
        }
    }
}

export { cap };