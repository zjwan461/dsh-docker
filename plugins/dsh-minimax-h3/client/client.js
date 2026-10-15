/**
 * dsh-minimax-h3 client half.
 *
 * Registers four things, all through `slots.inject` so they wait for the real
 * slot declarations and unwind with this plugin's fiber:
 *   - a header trigger in `conversation.session.header.actions`,
 *   - the studio panel in `shell.overlay`,
 *   - tool cards for `h3_generate` and `h3_post` in `tool.call.toolview`.
 *
 * Everything is written against the host theme tokens (`--dsw-alias-*`) and
 * plain React from the shared module table — no Harness Client package is
 * imported, because those change without notice and a throw inside a slot entry
 * blanks the whole entry instead of degrading.
 *
 * The bundle format is the loader's: a lazy factory whose id is the package
 * name, returning `{ name, inject, apply }`.
 */
window.__ModuleLoader__.load({
    id: 'dsh-minimax-h3',
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
        const react = require('react');
        const h = react.createElement;

        /* ------------------------------------------------------------------ */
        /* Locale                                                              */
        /* ------------------------------------------------------------------ */

        const DICT = {
            zh: {
                panelTitle: 'MiniMax H3 视频',
                tabGenerate: '生成',
                tabShots: '分镜',
                tabResults: '结果',
                tabPost: '后期',
                tabSettings: '设置',
                mode: '模式',
                prompt: '提示词',
                promptPlaceholder: '写清介质/风格、场景、分镜（CUT 1: … CUT 2: …）、镜头语言、Audio: 声音，最后写排除项（No text, subtitles, logos…）。',
                refs: '参考图',
                refsHint: 'i2v 用一张首帧图；r2v 可用多张，提示词里用 <Picture 1>、<Picture 2> 指代。',
                addRef: '选择素材',
                uploadRef: '上传图片',
                noRefs: '还没有参考图',
                aspect: '画幅',
                megapixels: '像素预算 (MP)',
                duration: '时长（秒）',
                frames: '帧数（可选，覆盖时长）',
                fps: '帧率',
                seed: '种子',
                random: '随机',
                turbo: '启用 Turbo LoRA',
                turboHint: '步数 20 → 8（r2v 为 4），快 2~3 倍，细节略降。打样开、定稿关。',
                steps: '步数（可选）',
                title: '标题',
                titlePlaceholder: '例如 台城-04 破城',
                generate: '开始生成',
                queued: '已排队',
                advanced: '高级',
                width: '宽（可选）',
                height: '高（可选）',
                sizeHint: '填宽高可覆盖画幅与像素预算。',
                reset: '重置参数',
                results: '历史结果',
                noResults: '还没有生成记录。',
                useAsSource: '送去后期',
                cancel: '中断',
                remove: '删除',
                copyPrompt: '复制提示词',
                copied: '已复制',
                refresh: '刷新',
                status: '状态',
                promptId: '任务 ID',
                elapsed: '耗时',
                overview: '概要',
                shots: '分镜板',
                newProject: '新建项目',
                projectName: '项目名',
                projectStyle: '风格基线（会提示拼进每个镜头的提示词）',
                shotsCount: '{n} 个镜头',
                addShot: '加一个镜头',
                noProjects: '还没有项目。',
                noProjectSelected: '选一个项目，或新建一个。',
                generateShot: '生成此镜',
                deleteShot: '删',
                save: '保存',
                batchPending: '生成所有待生成镜头',
                post: 'FFmpeg 后期',
                op: '操作',
                source: '输入',
                extras: '附加输入',
                extrasHint: '按操作要求的顺序选择：水印图 / 音频 / 字幕 / 第二段视频。',
                run: '执行',
                running: '执行中',
                renders: '后期产物',
                noRenders: '还没有后期产物。',
                deleteRender: '删除',
                settings: '设置',
                baseUrl: 'ComfyUI 地址',
                apiKeyEnv: 'API Key 环境变量',
                mediaHost: '媒体访问地址',
                mediaHostHint: '留空自动使用浏览器当前地址。',
                ffmpegPath: 'FFmpeg 路径',
                ffmpegProbe: 'FFprobe 路径',
                dataDir: '数据目录',
                settingsWhere: '设置改动会写进插件数据目录的 settings.json 并立即生效；cordis.patch.yml 里 minimax-h3 这一行的值作为基线。',
                settingsIntro: '这些值保存在插件数据目录的 settings.json，改完立即生效，不用重启。cordis.patch.yml 里 minimax-h3 那一行的 config 是基线，会被这里的改动覆盖。',
                comfyuiDirs: 'ComfyUI 安装目录（每行一个）',
                ffmpegCheck: '检测 FFmpeg',
                testConn: '测试连接',
                testing: '测试中…',
                connOk: '连接正常 · ComfyUI {version} · {ms} ms',
                connFail: '连接失败：{message}',
                save2: '保存设置',
                saved: '已保存',
                saveFailed: '保存失败',
                defaults: '默认值',
                language: '界面语言',
                diagnostics: '连接诊断',
                latency: '延迟',
                routePrefix: '路由前缀',
                authNone: '未配置认证',
                authHeader: '认证头',
                authHeaderHint: '留空则不发送认证头。默认 Authorization；有些反代要 x-api-key。',
                authScheme: '认证方案',
                authSchemeHint: '留空 = 直接发 key 本身（x-api-key 风格）；默认 Bearer。',
                h3NodesMissing: '这台服务器上缺 H3 节点：ComfyUI 版本可能低于 0.33，或者没装 MiniMax H3 的支持。',
                historyEntries: 'history 条目',
                ffmpegMissingShort: '本机未探测到 FFmpeg',
                localScanDirs: '本地 ComfyUI 目录数',
                loading: '加载中…',
                error: '出错',
                notConfigured: '未探测到 FFmpeg：只能生成，不能后期。装好后在这里填路径。',
                ffmpegOk: 'FFmpeg {version}',
                inventory: '模型清单',
                missingModel: '缺文件',
                noObjectInfo: 'ComfyUI 没有响应 /object_info，模型清单未知。',
                upload: '上传',
                pickFrom: '从素材选择',
                bytes: '字节',
                close: '关闭',
                generatingNow: '正在生成',
                bgJob: '后台任务',
                collectWithJob: '用 job_output 收结果，或看「结果」页。',
                shotStatus: '状态',
                markDone: '标记完成',
                all: '全部',
                emptyPrompt: '提示词不能为空。',
                modeLockedRefs: '这张模式需要 {n} 张参考图。',
                queueEmpty: '队列空闲',
                running_: '运行中 {n}',
                pending_: '排队 {n}',
            },
            en: {
                panelTitle: 'MiniMax H3 Video',
                tabGenerate: 'Generate',
                tabShots: 'Shots',
                tabResults: 'Results',
                tabPost: 'Finish',
                tabSettings: 'Settings',
                mode: 'Mode',
                prompt: 'Prompt',
                promptPlaceholder: 'State the medium/style, the scene, the shot list (CUT 1: … CUT 2: …), camera language, an Audio: line, and finish with exclusions (No text, subtitles, logos…).',
                refs: 'Reference images',
                refsHint: 'i2v takes one first frame; r2v takes several, addressed as <Picture 1>, <Picture 2> in the prompt.',
                addRef: 'Pick asset',
                uploadRef: 'Upload image',
                noRefs: 'No reference images yet',
                aspect: 'Aspect',
                megapixels: 'Size budget (MP)',
                duration: 'Duration (s)',
                frames: 'Frames (optional, overrides duration)',
                fps: 'Frame rate',
                seed: 'Seed',
                random: 'Random',
                turbo: 'Enable Turbo LoRA',
                turboHint: 'Steps 20 → 8 (4 for r2v): 2–3× faster, slightly softer. On for drafts, off for finals.',
                steps: 'Steps (optional)',
                title: 'Title',
                titlePlaceholder: 'e.g. siege-04 breach',
                generate: 'Generate',
                queued: 'Queued',
                advanced: 'Advanced',
                width: 'Width (optional)',
                height: 'Height (optional)',
                sizeHint: 'Width+height override aspect and size budget.',
                reset: 'Reset',
                results: 'Runs',
                noResults: 'No runs recorded yet.',
                useAsSource: 'Send to finishing',
                cancel: 'Interrupt',
                remove: 'Delete',
                copyPrompt: 'Copy prompt',
                copied: 'Copied',
                refresh: 'Refresh',
                status: 'Status',
                promptId: 'Prompt',
                elapsed: 'Elapsed',
                overview: 'Summary',
                shots: 'Shot board',
                newProject: 'New project',
                projectName: 'Project name',
                projectStyle: 'Style baseline (meant to be folded into every shot prompt)',
                shotsCount: '{n} shots',
                addShot: 'Add a shot',
                noProjects: 'No projects yet.',
                noProjectSelected: 'Pick a project, or create one.',
                generateShot: 'Generate shot',
                deleteShot: 'Del',
                save: 'Save',
                batchPending: 'Generate every pending shot',
                post: 'FFmpeg finishing',
                op: 'Operation',
                source: 'Input',
                extras: 'Extra inputs',
                extrasHint: 'In the order the operation expects: watermark image / audio / subtitles / second clip.',
                run: 'Run',
                running: 'Running',
                renders: 'Renders',
                noRenders: 'No renders yet.',
                deleteRender: 'Delete',
                settings: 'Settings',
                baseUrl: 'ComfyUI URL',
                apiKeyEnv: 'API key env var',
                mediaHost: 'Media host',
                mediaHostHint: 'Empty uses the address the browser is on.',
                ffmpegPath: 'FFmpeg path',
                ffmpegProbe: 'FFprobe path',
                dataDir: 'Data directory',
                settingsWhere: 'Changes are written to settings.json in the plugin data directory and apply immediately; the minimax-h3 row in cordis.patch.yml is the baseline.',
                settingsIntro: 'These values live in settings.json in the plugin data directory and apply immediately — no restart. The config on the minimax-h3 row in cordis.patch.yml is the baseline, and changes here override it.',
                comfyuiDirs: 'ComfyUI install dirs (one per line)',
                ffmpegCheck: 'Detect FFmpeg',
                testConn: 'Test connection',
                testing: 'Testing…',
                connOk: 'Connected · ComfyUI {version} · {ms} ms',
                connFail: 'Connection failed: {message}',
                save2: 'Save settings',
                saved: 'Saved',
                saveFailed: 'Save failed',
                defaults: 'Defaults',
                language: 'Language',
                diagnostics: 'Connection report',
                latency: 'Latency',
                routePrefix: 'Route prefix',
                authNone: 'no auth configured',
                authHeader: 'Auth header',
                authHeaderHint: 'Empty sends no auth header. Default Authorization; some proxies want x-api-key.',
                authScheme: 'Auth scheme',
                authSchemeHint: 'Empty sends the key verbatim (x-api-key style). Default Bearer.',
                h3NodesMissing: 'The H3 nodes are missing on this server: ComfyUI may predate 0.33, or MiniMax H3 support is not installed.',
                historyEntries: 'history entries',
                ffmpegMissingShort: 'no FFmpeg found on this machine',
                localScanDirs: 'local ComfyUI dirs',
                loading: 'Loading…',
                error: 'Error',
                notConfigured: 'FFmpeg not found: generation works, finishing does not. Install it and set the path here.',
                ffmpegOk: 'FFmpeg {version}',
                inventory: 'Model inventory',
                missingModel: 'Missing file',
                noObjectInfo: 'ComfyUI did not answer /object_info; the inventory is unknown.',
                upload: 'Upload',
                pickFrom: 'Pick asset',
                bytes: 'bytes',
                close: 'Close',
                generatingNow: 'Generating',
                bgJob: 'Background job',
                collectWithJob: 'Collect it with job_output, or watch the Results tab.',
                shotStatus: 'Status',
                markDone: 'Mark done',
                all: 'All',
                emptyPrompt: 'The prompt cannot be empty.',
                modeLockedRefs: 'This mode needs {n} reference image(s).',
                queueEmpty: 'Queue idle',
                running_: '{n} running',
                pending_: '{n} pending',
            },
        };

        const LANG_KEY = 'dsh-minimax-h3-lang';

        /** The active language: an explicit choice wins, then the document, then the browser. */
        function getLang() {
            try {
                const stored = localStorage.getItem(LANG_KEY);
                if (stored === 'zh' || stored === 'en') return stored;
            }
            catch {
                // Private mode or no storage: fall through to detection.
            }
            const doc = typeof document !== 'undefined' ? document.documentElement.lang : '';
            const nav = typeof navigator !== 'undefined' ? navigator.language : '';
            const value = String(doc !== '' ? doc : nav).toLowerCase();
            return value.startsWith('zh') ? 'zh' : 'en';
        }

        function setLang(lang) {
            try {
                localStorage.setItem(LANG_KEY, lang);
            }
            catch {
                // Nothing to do; the choice simply will not persist.
            }
        }

        /** Build a translator for one language, with `{name}` interpolation. */
        function makeT(lang) {
            const dict = DICT[lang] ?? DICT.en;
            return (key, vars) => {
                let text = dict[key] ?? DICT.en[key] ?? key;
                if (vars !== undefined) {
                    for (const [name, value] of Object.entries(vars)) {
                        text = text.split(`{${name}}`).join(String(value));
                    }
                }
                return text;
            };
        }

        /* ------------------------------------------------------------------ */
        /* Styles                                                             */
        /* ------------------------------------------------------------------ */

        const CSS = `
.mh3-panel { position: fixed; z-index: 40; display: flex; flex-direction: column; pointer-events: auto;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; box-shadow: 0 20px 56px rgba(0,0,0,.3); overflow: hidden;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.mh3-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: move;
  background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); user-select: none; }
.mh3-head-title { font-weight: 600; font-size: 13px; flex: 1; }
.mh3-head-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.mh3-tabs { display: flex; gap: 4px; padding: 8px 12px 0; flex-wrap: wrap; }
.mh3-tab { padding: 5px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; font-family: inherit; }
.mh3-tab:hover { color: var(--dsw-alias-label-primary); }
.mh3-tab--on { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l1); }
.mh3-body { flex: 1; overflow: auto; padding: 12px; }
.mh3-field { margin-bottom: 10px; }
.mh3-label { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.mh3-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
.mh3-input, .mh3-select, .mh3-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 13px; font-family: inherit; }
.mh3-input:focus, .mh3-select:focus, .mh3-textarea:focus { outline: none;
  border-color: var(--dsw-alias-brand-primary); }
.mh3-textarea { min-height: 132px; resize: vertical; line-height: 1.55; }
.mh3-textarea--sm { min-height: 62px; }
.mh3-row { display: flex; gap: 8px; }
.mh3-row > * { flex: 1; min-width: 0; }
.mh3-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer;
  font-size: 12px; font-family: inherit; white-space: nowrap; }
.mh3-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.mh3-btn:disabled { opacity: .5; cursor: default; }
.mh3-btn--primary { background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-layer-1); font-weight: 600; }
.mh3-btn--primary:hover:not(:disabled) { opacity: .9; }
.mh3-btn--danger { color: var(--dsw-alias-state-error-primary); }
.mh3-btn--sm { padding: 3px 8px; font-size: 11px; }
.mh3-badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.mh3-badge--ok { color: var(--dsw-alias-state-success-primary); border-color: currentColor; }
.mh3-badge--err { color: var(--dsw-alias-state-error-primary); border-color: currentColor; }
.mh3-badge--run { color: var(--dsw-alias-brand-primary); border-color: currentColor; }
.mh3-badge--warn { color: var(--dsw-alias-state-warn-primary); border-color: currentColor; }
.mh3-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px;
  margin-bottom: 10px; background: var(--dsw-alias-bg-layer-2); }
.mh3-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.mh3-card-title { font-weight: 600; font-size: 12px; flex: 1; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.mh3-media { width: 100%; border-radius: 8px; background: #000; display: block; max-height: 320px; }
.mh3-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mh3-mode { padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  cursor: pointer; background: var(--dsw-alias-bg-layer-2); text-align: left; font-family: inherit;
  color: var(--dsw-alias-label-primary); }
.mh3-mode--on { border-color: var(--dsw-alias-brand-primary); }
.mh3-mode-name { font-weight: 600; font-size: 12px; }
.mh3-mode-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
.mh3-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mh3-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; max-width: 100%; }
.mh3-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.mh3-empty { padding: 22px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.mh3-toast { padding: 7px 10px; border-radius: 8px; font-size: 12px; margin-bottom: 10px;
  border: 1px solid var(--dsw-alias-border-l2); }
.mh3-toast--err { color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary); }
.mh3-toast--ok { color: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary); }
.mh3-resize { position: absolute; right: 1px; bottom: 1px; width: 16px; height: 16px;
  cursor: nwse-resize; opacity: .5; }
.mh3-sep { height: 1px; background: var(--dsw-alias-border-l1); margin: 12px 0; }
.mh3-kv { display: flex; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary);
  flex-wrap: wrap; margin-top: 4px; }
.mh3-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.mh3-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 12px; font-family: inherit; }
.mh3-trigger:hover { border-color: var(--dsw-alias-brand-primary); }
.mh3-trigger[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary); }
.mh3-card-host { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px;
  background: var(--dsw-alias-bg-layer-2); margin: 4px 0; }
.mh3-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.mh3-checkline { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.mh3-scroll { max-height: 240px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; padding: 6px; }
.mh3-section { max-width: 760px; }
.mh3-section-intro { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 14px; }
`;

        /** Inject the stylesheet once; owned by the plugin so HMR removes it. */
        function injectStyles() {
            if (typeof document === 'undefined') return;
            if (document.getElementById('dsh-minimax-h3-styles') !== null) return;
            const style = document.createElement('style');
            style.id = 'dsh-minimax-h3-styles';
            style.setAttribute('data-plugin', 'dsh-minimax-h3');
            style.textContent = CSS;
            document.head.append(style);
        }

        /* ------------------------------------------------------------------ */
        /* Panel store (module-level, shared by the two registrations)          */
        /* ------------------------------------------------------------------ */

        const panelListeners = new Set();
        let panelOpen = false;
        let panelTab = 'generate';
        /** What the finishing tab is pointed at, set by "send to finishing". */
        let panelSource = '';
        let panelExtras = [];

        function panelEmit() {
            for (const listener of panelListeners) listener();
        }

        const panelStore = {
            isOpen: () => panelOpen,
            toggle: () => {
                panelOpen = !panelOpen;
                panelEmit();
            },
            open: (tab) => {
                if (tab !== undefined) panelTab = tab;
                panelOpen = true;
                panelEmit();
            },
            close: () => {
                panelOpen = false;
                panelEmit();
            },
            tab: () => panelTab,
            setTab: (next) => {
                panelTab = next;
                panelEmit();
            },
            source: () => panelSource,
            extras: () => panelExtras,
            setSource: (next, extras) => {
                panelSource = next;
                panelExtras = Array.isArray(extras) ? extras : [];
                panelTab = 'post';
                panelOpen = true;
                panelEmit();
            },
            subscribe(listener) {
                panelListeners.add(listener);
                return () => {
                    panelListeners.delete(listener);
                };
            },
        };

        function usePanelOpen() {
            return react.useSyncExternalStore(panelStore.subscribe, panelStore.isOpen, panelStore.isOpen);
        }

        function usePanelTab() {
            return react.useSyncExternalStore(panelStore.subscribe, panelStore.tab, panelStore.tab);
        }

        /* ------------------------------------------------------------------ */
        /* API                                                                 */
        /* ------------------------------------------------------------------ */

        const BASE = '/minimaxh3';

        async function requestJson(path, init) {
            const response = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init });
            const text = await response.text();
            let body;
            try {
                body = text === '' ? {} : JSON.parse(text);
            }
            catch {
                throw new Error(`${path}: non-JSON response (HTTP ${response.status})`);
            }
            if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
            return body;
        }

        const api = {
            get: (path) => requestJson(path),
            post: (path, body) => requestJson(path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body ?? {}),
            }),
            upload: (path, file) => requestJson(path, { method: 'POST', body: file }),
        };

        /* ------------------------------------------------------------------ */
        /* Hooks                                                               */
        /* ------------------------------------------------------------------ */

        /** Load once (and on demand); `deps` must be stable. */
        function useAsync(loader, deps) {
            const [state, setState] = react.useState({ loading: true, data: null, error: null });
            const [nonce, setNonce] = react.useState(0);
            react.useEffect(() => {
                let alive = true;
                setState((previous) => ({ ...previous, loading: true }));
                Promise.resolve()
                    .then(loader)
                    .then(
                        (data) => {
                            if (alive) setState({ loading: false, data, error: null });
                        },
                        (error) => {
                            if (alive) {
                                setState({
                                    loading: false,
                                    data: null,
                                    error: error instanceof Error ? error.message : String(error),
                                });
                            }
                        },
                    );
                return () => {
                    alive = false;
                };
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [...(deps ?? []), nonce]);
            return { ...state, reload: () => setNonce((value) => value + 1) };
        }

        /** Run `fn` every `ms` while `ms` is truthy. */
        function useInterval(fn, ms) {
            const ref = react.useRef(fn);
            ref.current = fn;
            react.useEffect(() => {
                if (!ms) return undefined;
                const id = setInterval(() => ref.current(), ms);
                return () => clearInterval(id);
            }, [ms]);
        }

        /* ------------------------------------------------------------------ */
        /* Small building blocks                                               */
        /* ------------------------------------------------------------------ */

        function Field({ label, hint, children }) {
            return h('div', { className: 'mh3-field' },
                label !== undefined ? h('label', { className: 'mh3-label' }, label) : null,
                children,
                hint !== undefined && hint !== '' ? h('div', { className: 'mh3-hint' }, hint) : null);
        }

        function TextInput({ value, onChange, placeholder, type, min, max, step }) {
            return h('input', {
                className: 'mh3-input',
                type: type ?? 'text',
                value: value === undefined || value === null ? '' : value,
                placeholder: placeholder ?? '',
                min,
                max,
                step,
                onChange: (event) => onChange(event.target.value),
            });
        }

        function TextArea({ value, onChange, placeholder, small }) {
            return h('textarea', {
                className: small === true ? 'mh3-textarea mh3-textarea--sm' : 'mh3-textarea',
                value: value ?? '',
                placeholder: placeholder ?? '',
                onChange: (event) => onChange(event.target.value),
            });
        }

        function Select({ value, onChange, options, placeholder }) {
            return h('select', {
                className: 'mh3-select',
                value: value ?? '',
                onChange: (event) => onChange(event.target.value),
            }, [
                placeholder !== undefined ? h('option', { key: '__none', value: '' }, placeholder) : null,
                ...options.map((option) => {
                    const item = typeof option === 'string' ? { value: option, label: option } : option;
                    return h('option', { key: item.value, value: item.value }, item.label);
                }),
            ]);
        }

        function Toggle({ checked, onChange, label }) {
            return h('label', { className: 'mh3-checkline' },
                h('input', {
                    type: 'checkbox',
                    checked: checked === true,
                    onChange: (event) => onChange(event.target.checked),
                }),
                label);
        }

        function Badge({ tone, children }) {
            return h('span', { className: `mh3-badge${tone !== undefined ? ` mh3-badge--${tone}` : ''}` }, children);
        }

        function Button({ onClick, children, primary, danger, small, disabled, title }) {
            const classes = ['mh3-btn'];
            if (primary === true) classes.push('mh3-btn--primary');
            if (danger === true) classes.push('mh3-btn--danger');
            if (small === true) classes.push('mh3-btn--sm');
            return h('button', {
                type: 'button',
                className: classes.join(' '),
                onClick,
                disabled: disabled === true,
                title: title ?? '',
            }, children);
        }

        /** A status badge for a run or a post job. */
        function StatusBadge({ t, status }) {
            const tone = status === 'completed' ? 'ok'
                : status === 'failed' ? 'err'
                    : status === 'queued' || status === 'running' ? 'run'
                        : status === 'cancelled' ? 'warn' : undefined;
            return h(Badge, { tone }, status ?? '—');
        }

        /** Render one media item: a player for video/audio, an image otherwise. */
        function MediaBox({ item }) {
            if (item === undefined || item === null || typeof item.url !== 'string' || item.url === '') return null;
            if (item.kind === 'video') {
                return h('video', { className: 'mh3-media', src: item.url, controls: true, preload: 'metadata' });
            }
            if (item.kind === 'audio') {
                return h('audio', { style: { width: '100%' }, src: item.url, controls: true });
            }
            return h('img', { className: 'mh3-media', src: item.url, alt: item.filename ?? '' });
        }

        /* ------------------------------------------------------------------ */
        /* Asset picker                                                        */
        /* ------------------------------------------------------------------ */

        /**
         * A compact picker over everything the host knows about: ComfyUI's input
         * directory, plugin uploads, and finished renders. It stays inline
         * (a disclosure rather than a modal) so it cannot fight the host for
         * focus or escape handling.
         */
        function AssetPicker({ t, mode, onPick, onClose, assets, reload }) {
            const [filter, setFilter] = react.useState('');
            const groups = mode === 'ref'
                ? [{ title: 'ComfyUI input', items: assets?.inputs ?? [] },
                    { title: 'Plugin uploads', items: assets?.uploads ?? [] }]
                : [{ title: 'ComfyUI output', items: assets?.outputs ?? [] },
                    { title: 'Renders', items: assets?.renders ?? [] },
                    { title: 'Plugin uploads', items: assets?.uploads ?? [] }];
            const lower = filter.trim().toLowerCase();
            return h('div', { className: 'mh3-card' },
                h('div', { className: 'mh3-card-head' },
                    h('span', { className: 'mh3-card-title' }, t('pickFrom')),
                    h(Button, { small: true, onClick: reload }, t('refresh')),
                    h(Button, { small: true, onClick: onClose }, t('close'))),
                h('input', {
                    className: 'mh3-input',
                    placeholder: '…',
                    value: filter,
                    onChange: (event) => setFilter(event.target.value),
                }),
                h('div', { className: 'mh3-scroll', style: { marginTop: '8px' } },
                    groups.map((group) => {
                        const items = group.items.filter((item) => lower === '' || item.name.toLowerCase().includes(lower));
                        if (items.length === 0) return null;
                        return h('div', { key: group.title },
                            h('div', { className: 'mh3-label' }, `${group.title} (${items.length})`),
                            h('div', { className: 'mh3-chips', style: { marginBottom: '8px' } },
                                items.slice(0, 200).map((item) => h('button', {
                                    key: `${group.title}:${item.name}`,
                                    type: 'button',
                                    className: 'mh3-chip',
                                    style: { cursor: 'pointer', background: 'transparent', color: 'inherit', fontFamily: 'inherit' },
                                    onClick: () => onPick(item),
                                }, h('span', { className: 'mh3-chip-name' }, item.name)))));
                    })));
        }

        /* ------------------------------------------------------------------ */
        /* Generate tab                                                        */
        /* ------------------------------------------------------------------ */

        function GenerateTab({ t, meta, onGenerated }) {
            const [mode, setMode] = react.useState('t2v');
            const [prompt, setPrompt] = react.useState('');
            const [refs, setRefs] = react.useState([]);
            const [aspect, setAspect] = react.useState('');
            const [megapixels, setMegapixels] = react.useState('');
            const [duration, setDuration] = react.useState('');
            const [frames, setFrames] = react.useState('');
            const [width, setWidth] = react.useState('');
            const [height, setHeight] = react.useState('');
            const [seed, setSeed] = react.useState('');
            const [turbo, setTurbo] = react.useState(false);
            const [advanced, setAdvanced] = react.useState(false);
            const [title, setTitle] = react.useState('');
            const [busy, setBusy] = react.useState(false);
            const [notice, setNotice] = react.useState(null);
            const [picking, setPicking] = react.useState(false);
            const fileRef = react.useRef(null);

            // Seed the form from the plugin defaults once the meta arrives, and
            // never overwrite a value the user has already touched.
            const seeded = react.useRef(false);
            react.useEffect(() => {
                if (meta === null || seeded.current) return;
                seeded.current = true;
                setAspect(meta.defaults.aspect);
                setMegapixels(String(meta.defaults.megapixels));
                setDuration(String(meta.defaults.duration));
                setTurbo(meta.defaults.turbo === true);
                if (typeof meta.defaults.mode === 'string') setMode(meta.defaults.mode);
            }, [meta]);

            const assets = useAsync(() => api.get('/assets'), [picking === true]);
            const spec = meta?.modes?.find((entry) => entry.id === mode);
            const aspects = (meta?.aspects ?? []).map((value) => ({ value, label: value }));

            const submit = async () => {
                setNotice(null);
                if (prompt.trim() === '') {
                    setNotice({ tone: 'err', text: t('emptyPrompt') });
                    return;
                }
                if (spec !== undefined && refs.length < spec.minRefs) {
                    setNotice({ tone: 'err', text: t('modeLockedRefs', { n: spec.minRefs }) });
                    return;
                }
                setBusy(true);
                try {
                    const payload = {
                        mode,
                        prompt,
                        refs,
                        aspect: aspect === '' ? undefined : aspect,
                        megapixels: megapixels === '' ? undefined : Number(megapixels),
                        duration: duration === '' ? undefined : Number(duration),
                        frames: frames === '' ? undefined : Number(frames),
                        width: width === '' ? undefined : Number(width),
                        height: height === '' ? undefined : Number(height),
                        seed: seed === '' ? undefined : Number(seed),
                        turbo,
                        title,
                    };
                    const result = await api.post('/generate', payload);
                    setNotice({ tone: 'ok', text: `${t('queued')} · ${result.promptId}` });
                    if (typeof onGenerated === 'function') onGenerated(result.run);
                }
                catch (error) {
                    setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                }
                finally {
                    setBusy(false);
                }
            };

            const uploadRef = async (file) => {
                if (file === undefined || file === null) return;
                setNotice(null);
                try {
                    const result = await api.upload(`/ref/upload?name=${encodeURIComponent(file.name)}`, file);
                    setRefs((current) => [...current, result.name]);
                }
                catch (error) {
                    setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                }
            };

            return h('div', null,
                notice !== null ? h('div', { className: `mh3-toast mh3-toast--${notice.tone}` }, notice.text) : null,

                h(Field, { label: t('mode'), hint: spec?.description },
                    h('div', { className: 'mh3-modes' },
                        (meta?.modes ?? []).map((entry) => h('button', {
                            key: entry.id,
                            type: 'button',
                            className: `mh3-mode${entry.id === mode ? ' mh3-mode--on' : ''}`,
                            onClick: () => {
                                setMode(entry.id);
                                setRefs((current) => current.slice(0, Math.max(entry.maxRefs, 0)));
                            },
                        },
                        h('div', { className: 'mh3-mode-name' }, entry.label),
                        h('div', { className: 'mh3-mode-desc' }, entry.labelEn))))),

                h(Field, { label: t('prompt') },
                    h(TextArea, { value: prompt, onChange: setPrompt, placeholder: t('promptPlaceholder') })),

                mode === 't2v' ? null : h(Field, { label: t('refs'), hint: t('refsHint') },
                    h('div', { className: 'mh3-chips', style: { marginBottom: '8px' } },
                        refs.length === 0
                            ? h('span', { className: 'mh3-hint' }, t('noRefs'))
                            : refs.map((name, index) => h('span', { key: `${name}:${index}`, className: 'mh3-chip' },
                                h('span', { className: 'mh3-chip-name' }, name),
                                h('button', {
                                    type: 'button',
                                    className: 'mh3-btn mh3-btn--sm',
                                    onClick: () => setRefs((current) => current.filter((_, i) => i !== index)),
                                }, '×')))),
                    h('div', { className: 'mh3-row' },
                        h(Button, { onClick: () => setPicking((value) => !value) }, t('addRef')),
                        h(Button, { onClick: () => fileRef.current?.click() }, t('uploadRef')),
                        h('input', {
                            ref: fileRef,
                            type: 'file',
                            accept: 'image/*',
                            style: { display: 'none' },
                            onChange: (event) => {
                                uploadRef(event.target.files?.[0]);
                                event.target.value = '';
                            },
                        })),
                    picking ? h(AssetPicker, {
                        t,
                        mode: 'ref',
                        assets: assets.data,
                        reload: assets.reload,
                        onClose: () => setPicking(false),
                        onPick: (item) => {
                            setRefs((current) => (current.includes(item.name) ? current : [...current, item.name]));
                            setPicking(false);
                        },
                    }) : null),

                h('div', { className: 'mh3-row' },
                    h(Field, { label: t('aspect') },
                        h(Select, { value: aspect, onChange: setAspect, options: aspects })),
                    h(Field, { label: t('megapixels') },
                        h(TextInput, { type: 'number', min: 0.05, max: 4, step: 0.05, value: megapixels, onChange: setMegapixels }))),

                h('div', { className: 'mh3-row' },
                    h(Field, { label: t('duration') },
                        h(TextInput, { type: 'number', min: 1, max: 60, step: 1, value: duration, onChange: setDuration })),
                    h(Field, { label: t('frames') },
                        h(TextInput, { type: 'number', min: 5, step: 4, value: frames, onChange: setFrames })),
                    h(Field, { label: t('seed') },
                        h(TextInput, { value: seed, onChange: setSeed, placeholder: t('random') }))),

                h(Field, { label: t('turbo'), hint: t('turboHint') },
                    h(Toggle, { checked: turbo, onChange: setTurbo, label: t('turbo') })),

                h(Button, { onClick: () => setAdvanced((value) => !value), small: true }, t('advanced')),
                advanced
                    ? h('div', { style: { marginTop: '10px' } },
                        h('div', { className: 'mh3-row' },
                            h(Field, { label: t('width') }, h(TextInput, { type: 'number', value: width, onChange: setWidth })),
                            h(Field, { label: t('height') }, h(TextInput, { type: 'number', value: height, onChange: setHeight }))),
                        h(Field, { label: t('title') },
                            h(TextInput, { value: title, onChange: setTitle, placeholder: t('titlePlaceholder') })),
                        h('div', { className: 'mh3-hint' }, t('sizeHint')))
                    : null,

                h('div', { className: 'mh3-sep' }),
                h('div', { className: 'mh3-row' },
                    h(Button, { primary: true, onClick: submit, disabled: busy }, busy ? t('running') : t('generate')),
                    h(Button, {
                        onClick: () => {
                            setPrompt('');
                            setRefs([]);
                            setFrames('');
                            setSeed('');
                            setTitle('');
                        },
                    }, t('reset'))));
        }

        /* ------------------------------------------------------------------ */
        /* Shots tab                                                           */
        /* ------------------------------------------------------------------ */

        /**
         * A textarea that edits a local buffer and writes it on blur.
         *
         * The project document lives on the host, so committing on every
         * keystroke would send a request per character; committing on blur keeps
         * one write per edit without making the field feel laggy.
         */
        function BlurTextArea({ value, placeholder, small, onCommit }) {
            const [text, setText] = react.useState(value ?? '');
            const committed = react.useRef(value ?? '');
            react.useEffect(() => {
                // Adopt an external change (project switched, another writer), but
                // never clobber what the user is currently typing.
                if ((value ?? '') !== committed.current) {
                    committed.current = value ?? '';
                    setText(value ?? '');
                }
            }, [value]);
            return h('textarea', {
                className: small === true ? 'mh3-textarea mh3-textarea--sm' : 'mh3-textarea',
                value: text,
                placeholder: placeholder ?? '',
                onChange: (event) => setText(event.target.value),
                onBlur: () => {
                    if (text !== committed.current) {
                        committed.current = text;
                        onCommit(text);
                    }
                },
            });
        }

        /** One shot row on the board. */
        function ShotRow({ t, index, shot, onCommit, onGenerate, onDelete }) {
            const [prompt, setPrompt] = react.useState(shot.prompt ?? '');
            react.useEffect(() => {
                setPrompt(shot.prompt ?? '');
            }, [shot.id]);
            return h('div', { className: 'mh3-card' },
                h('div', { className: 'mh3-card-head' },
                    h('span', { className: 'mh3-card-title' }, `${String(index + 1).padStart(2, '0')} · ${shot.title || shot.id}`),
                    h(StatusBadge, { t, status: shot.status })),
                h('div', { className: 'mh3-kv' },
                    h('span', null, shot.mode),
                    h('span', null, `${shot.duration ?? 5}s`),
                    shot.runId !== undefined && shot.runId !== null ? h('span', { className: 'mh3-mono' }, shot.runId) : null),
                h('textarea', {
                    className: 'mh3-textarea mh3-textarea--sm',
                    value: prompt,
                    onChange: (event) => setPrompt(event.target.value),
                    onBlur: () => {
                        if (prompt !== (shot.prompt ?? '')) onCommit(prompt);
                    },
                }),
                h('div', { className: 'mh3-row', style: { marginTop: '8px' } },
                    h(Button, {
                        primary: true,
                        small: true,
                        onClick: () => onGenerate({ ...shot, prompt }),
                    }, t('generateShot')),
                    h(Button, { small: true, danger: true, onClick: () => onDelete() }, t('deleteShot'))));
        }

        function ShotsTab({ t, meta, onGenerated }) {
            const projects = useAsync(() => api.get('/projects'), []);
            const [selected, setSelected] = react.useState('');
            const [notice, setNotice] = react.useState(null);
            const [draft, setDraft] = react.useState({ mode: 't2v', prompt: '', duration: 5 });

            const list = projects.data?.projects ?? [];
            const project = list.find((entry) => entry.id === selected);

            react.useEffect(() => {
                if (selected === '' && list.length > 0) setSelected(list[0].id);
            }, [list, selected]);

            const save = async (patch) => {
                setNotice(null);
                try {
                    await api.post('/projects', { project: patch });
                    projects.reload();
                }
                catch (error) {
                    setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                }
            };

            const createProject = async () => {
                const name = window.prompt(t('projectName'), '');
                if (name === null || name.trim() === '') return;
                await save({ name: name.trim(), shots: [] });
            };

            const addShot = async () => {
                if (project === undefined) return;
                if (draft.prompt.trim() === '') {
                    setNotice({ tone: 'err', text: t('emptyPrompt') });
                    return;
                }
                await save({
                    id: project.id,
                    shots: [{
                        title: draft.title ?? '',
                        mode: draft.mode,
                        prompt: draft.prompt,
                        duration: Number(draft.duration) || 5,
                        status: 'pending',
                    }],
                });
                setDraft({ mode: draft.mode, prompt: '', duration: draft.duration });
            };

            const generateShot = async (shot) => {
                setNotice(null);
                try {
                    const result = await api.post('/generate', {
                        mode: shot.mode ?? 't2v',
                        prompt: project?.style !== undefined && project.style !== '' && shot.prompt !== undefined
                            ? `${project.style}\n\n${shot.prompt}`
                            : shot.prompt,
                        refs: shot.refs ?? [],
                        duration: shot.duration,
                        aspect: shot.aspect === undefined || shot.aspect === '' ? undefined : shot.aspect,
                        seed: shot.seed,
                        turbo: shot.turbo === true,
                        title: shot.title,
                        projectId: project.id,
                        shotId: shot.id,
                    });
                    await save({ id: project.id, shots: [{ id: shot.id, status: 'running', runId: result.run.id }] });
                    if (typeof onGenerated === 'function') onGenerated(result.run);
                    setNotice({ tone: 'ok', text: `${shot.title || shot.id} · ${t('queued')}` });
                }
                catch (error) {
                    setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                }
            };

            return h('div', null,
                notice !== null ? h('div', { className: `mh3-toast mh3-toast--${notice.tone}` }, notice.text) : null,
                h('div', { className: 'mh3-row', style: { marginBottom: '10px' } },
                    h(Select, {
                        value: selected,
                        onChange: setSelected,
                        options: list.map((entry) => ({
                            value: entry.id,
                            label: `${entry.name ?? entry.id} · ${(entry.shots ?? []).length}`,
                        })),
                        placeholder: list.length === 0 ? t('noProjects') : t('noProjectSelected'),
                    }),
                    h(Button, { onClick: createProject }, t('newProject'))),

                project === undefined ? h('div', { className: 'mh3-empty' }, t('noProjectSelected')) : h('div', null,
                    h(Field, { label: t('projectStyle') },
                        h(BlurTextArea, {
                            small: true,
                            value: project.style ?? '',
                            onCommit: (value) => save({ id: project.id, style: value }),
                        })),

                    (project.shots ?? []).map((shot, index) => h(ShotRow, {
                        key: shot.id,
                        t,
                        index,
                        shot,
                        onCommit: (value) => save({ id: project.id, shots: [{ id: shot.id, prompt: value }] }),
                        onGenerate: generateShot,
                        onDelete: () => save({ id: project.id, removeShotIds: [shot.id] }),
                    })),

                    h('div', { className: 'mh3-sep' }),
                    h(Field, { label: t('addShot') },
                        h('div', { className: 'mh3-row' },
                            h(Select, {
                                value: draft.mode,
                                onChange: (value) => setDraft((current) => ({ ...current, mode: value })),
                                options: (meta?.modes ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
                            }),
                            h(TextInput, {
                                type: 'number',
                                min: 1,
                                max: 60,
                                value: draft.duration,
                                onChange: (value) => setDraft((current) => ({ ...current, duration: value })),
                            }),
                            h(TextInput, {
                                value: draft.title ?? '',
                                placeholder: t('title'),
                                onChange: (value) => setDraft((current) => ({ ...current, title: value })),
                            })),
                        h(TextArea, {
                            small: true,
                            value: draft.prompt,
                            placeholder: t('promptPlaceholder'),
                            onChange: (value) => setDraft((current) => ({ ...current, prompt: value })),
                        }),
                        h('div', { style: { marginTop: '8px' } },
                            h(Button, { onClick: addShot }, t('addShot'))))));
        }

        /* ------------------------------------------------------------------ */
        /* Results tab                                                         */
        /* ------------------------------------------------------------------ */

        function ResultsTab({ t, runs, reload, busy }) {
            useInterval(() => {
                if (busy === true) reload();
            }, busy === true ? 4000 : null);

            const list = runs.data?.runs ?? [];
            return h('div', null,
                h('div', { className: 'mh3-card-head' },
                    h('span', { className: 'mh3-card-title' }, `${t('results')} (${list.length})`),
                    h(Button, { small: true, onClick: reload }, t('refresh'))),
                runs.error !== null && runs.error !== undefined
                    ? h('div', { className: 'mh3-toast mh3-toast--err' }, runs.error)
                    : null,
                list.length === 0 ? h('div', { className: 'mh3-empty' }, t('noResults')) : list.map((run) => h('div', {
                    key: run.id,
                    className: 'mh3-card',
                },
                h('div', { className: 'mh3-card-head' },
                    h('span', { className: 'mh3-card-title' }, run.title || `${run.mode} · ${run.id}`),
                    h(StatusBadge, { t, status: run.status })),
                h('div', { className: 'mh3-kv' },
                    h('span', null, run.summary ?? ''),
                    run.elapsedMs !== undefined ? h('span', null, `${t('elapsed')} ${(run.elapsedMs / 1000).toFixed(1)}s`) : null,
                    h('span', { className: 'mh3-mono' }, run.promptId ?? '')),
                run.error !== undefined && run.error !== null ? h('div', { className: 'mh3-toast mh3-toast--err' }, run.error) : null,
                (run.media ?? []).length > 0
                    ? h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
                        run.media.map((item, index) => h('div', { key: `${run.id}:${index}` },
                            h(MediaBox, { item }),
                            h('div', { className: 'mh3-kv' }, h('span', { className: 'mh3-mono' }, item.filename ?? '')))))
                    : null,
                h('div', { className: 'mh3-row', style: { marginTop: '8px' } },
                    h(Button, {
                        small: true,
                        disabled: (run.media ?? []).length === 0,
                        onClick: () => panelStore.setSource(`run:${run.id}:0`),
                    }, t('useAsSource')),
                    h(Button, {
                        small: true,
                        onClick: () => {
                            void navigator.clipboard?.writeText(run.prompt ?? '');
                        },
                    }, t('copyPrompt')),
                    run.status === 'queued' || run.status === 'running'
                        ? h(Button, {
                            small: true,
                            onClick: async () => {
                                await api.post('/runs/cancel', { runId: run.id });
                                reload();
                            },
                        }, t('cancel'))
                        : null,
                    h(Button, {
                        small: true,
                        danger: true,
                        onClick: async () => {
                            await api.post('/runs/delete', { runId: run.id });
                            reload();
                        },
                    }, t('remove'))))));
        }

        /* ------------------------------------------------------------------ */
        /* Post tab                                                            */
        /* ------------------------------------------------------------------ */

        function PostTab({ t, meta, runs, source, extras, onSourceChange }) {
            const ops = meta?.ops ?? [];
            const [op, setOp] = react.useState('');
            const [options, setOptions] = react.useState({});
            const [localSource, setLocalSource] = react.useState(source ?? '');
            const [localExtras, setLocalExtras] = react.useState(Array.isArray(extras) ? extras : []);
            const [picking, setPicking] = react.useState(false);
            const [job, setJob] = react.useState(null);
            const [notice, setNotice] = react.useState(null);
            const extraFileRef = react.useRef(null);
            const renders = useAsync(() => api.get('/renders'), []);

            react.useEffect(() => {
                if (op === '' && ops.length > 0) setOp(ops[0].id);
            }, [ops, op]);
            react.useEffect(() => {
                setLocalSource(source ?? '');
        }, [source]);
            react.useEffect(() => {
                setLocalExtras(Array.isArray(extras) ? extras : []);
            }, [extras]);

            const descriptor = ops.find((entry) => entry.id === op);

            // The operation's own defaults seed the form; switching op resets it.
            react.useEffect(() => {
                if (descriptor === undefined) return;
                const next = {};
                for (const param of descriptor.params) next[param.name] = param.default;
                setOptions(next);
            }, [op]);

            useInterval(() => {
                if (job === null || job.status !== 'running') return;
                api.get(`/post/status?id=${encodeURIComponent(job.id)}`).then((record) => {
                    setJob(record);
                    if (record.status !== 'running') renders.reload();
                }).catch(() => undefined);
            }, job !== null && job.status === 'running' ? 1500 : null);

            const assets = useAsync(() => api.get('/assets'), [picking === true]);
            const runList = runs.data?.runs ?? [];

            const execute = async () => {
                setNotice(null);
                if (localSource === '') {
                    setNotice({ tone: 'err', text: `${t('source')} …` });
                    return;
                }
                try {
                    const started = await api.post('/post', {
                        op,
                        source: localSource,
                        extras: localExtras,
                        options,
                    });
                    setJob({ ...started, progress: 0 });
                }
                catch (error) {
                    setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                }
            };

            const paramField = (param) => {
                const value = options[param.name];
                const set = (next) => setOptions((current) => ({ ...current, [param.name]: next }));
                if (param.type === 'enum') {
                    return h(Field, { key: param.name, label: param.label },
                        h(Select, { value, onChange: set, options: param.options }));
                }
                if (param.type === 'boolean') {
                    return h(Field, { key: param.name, label: param.label },
                        h(Toggle, { checked: value === true, onChange: set, label: param.label }));
                }
                if (param.type === 'number') {
                    return h(Field, { key: param.name, label: param.label },
                        h(TextInput, {
                            type: 'number',
                            min: param.min,
                            max: param.max,
                            step: param.step,
                            value,
                            onChange: (next) => set(next === '' ? '' : Number(next)),
                        }));
                }
                return h(Field, { key: param.name, label: param.label },
                    h(TextInput, { value, onChange: set }));
            };

            return h('div', null,
                notice !== null ? h('div', { className: `mh3-toast mh3-toast--${notice.tone}` }, notice.text) : null,

                h(Field, { label: t('op'), hint: descriptor?.description },
                    h(Select, {
                        value: op,
                        onChange: setOp,
                        options: ops.map((entry) => ({ value: entry.id, label: `${entry.group} · ${entry.label}` })),
                    })),

                h(Field, { label: t('source') },
                    h('div', { className: 'mh3-chips', style: { marginBottom: '8px' } },
                        localSource === ''
                            ? h('span', { className: 'mh3-hint' }, '…')
                            : h('span', { className: 'mh3-chip' },
                                h('span', { className: 'mh3-chip-name' }, localSource),
                                h('button', {
                                    type: 'button',
                                    className: 'mh3-btn mh3-btn--sm',
                                    onClick: () => setLocalSource(''),
                                }, '×'))),
                    h('div', { className: 'mh3-row' },
                        h(Select, {
                            value: '',
                            onChange: (value) => {
                                if (value !== '') setLocalSource(value);
                            },
                            options: [
                                ...runList.filter((run) => (run.media ?? []).length > 0)
                                    .map((run) => ({ value: `run:${run.id}:0`, label: `run · ${run.title || run.id}` })),
                                ...(renders.data?.renders ?? []).map((render) => ({
                                    value: `render:${render.output}`,
                                    label: `render · ${render.output}`,
                                })),
                                ...(assets.data?.uploads ?? []).map((item) => ({
                                    value: `upload:${item.name}`,
                                    label: `upload · ${item.name}`,
                                })),
                            ],
                            placeholder: '…',
                        }),
                        h(Button, { onClick: () => setPicking((value) => !value) }, t('pickFrom'))),
                    picking ? h(AssetPicker, {
                        t,
                        mode: 'post',
                        assets: assets.data,
                        reload: assets.reload,
                        onClose: () => setPicking(false),
                        onPick: (item) => {
                            const value = item.source === 'render' ? `render:${item.name}` : `upload:${item.name}`;
                            setLocalSource(value);
                            setPicking(false);
                        },
                    }) : null),

                descriptor?.needsExtras === true
                    ? h(Field, { label: t('extras'), hint: t('extrasHint') },
                        h('div', { className: 'mh3-chips', style: { marginBottom: '8px' } },
                            localExtras.length === 0
                                ? h('span', { className: 'mh3-hint' }, '…')
                                : localExtras.map((name, index) => h('span', { key: `${name}:${index}`, className: 'mh3-chip' },
                                    h('span', { className: 'mh3-chip-name' }, name),
                                    h('button', {
                                        type: 'button',
                                        className: 'mh3-btn mh3-btn--sm',
                                        onClick: () => setLocalExtras((current) => current.filter((_, i) => i !== index)),
                                    }, '×')))),
                        h('div', { className: 'mh3-row' },
                            h(Select, {
                                value: '',
                                onChange: (value) => {
                                    if (value !== '') setLocalExtras((current) => [...current, value]);
                                },
                                options: [
                                    ...(assets.data?.uploads ?? []).map((item) => ({ value: `upload:${item.name}`, label: `upload · ${item.name}` })),
                                    ...(renders.data?.renders ?? []).map((render) => ({ value: `render:${render.output}`, label: `render · ${render.output}` })),
                                    ...runList.filter((run) => (run.media ?? []).length > 0)
                                        .map((run) => ({ value: `run:${run.id}:0`, label: `run · ${run.title || run.id}` })),
                                ],
                                placeholder: '…',
                            }),
                            h('input', {
                                ref: extraFileRef,
                                type: 'file',
                                style: { display: 'none' },
                                onChange: async (event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (file === undefined || file === null) return;
                                    try {
                                        const saved = await api.upload(`/upload/save?name=${encodeURIComponent(file.name)}`, file);
                                        setLocalExtras((current) => [...current, `upload:${saved.name}`]);
                                        assets.reload();
                                    }
                                    catch (error) {
                                        setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                                    }
                                },
                            }),
                            h(Button, {
                                onClick: () => extraFileRef.current?.click(),
                            }, t('upload'))))
                    : null,

                h('div', { className: 'mh3-grid2' }, (descriptor?.params ?? []).map(paramField)),

                h('div', { className: 'mh3-sep' }),
                h('div', { className: 'mh3-row' },
                    h(Button, {
                        primary: true,
                        onClick: execute,
                        disabled: job !== null && job.status === 'running',
                    }, job !== null && job.status === 'running'
                        ? `${t('running')} ${Math.round((job.progress ?? 0) * 100)}%`
                        : t('run')),
                    onSourceChange !== undefined
                        ? h(Button, {
                            onClick: () => {
                                onSourceChange(localSource, localExtras);
                            },
                        }, t('save'))
                        : null),

                job !== null && job.status === 'failed'
                    ? h('div', { className: 'mh3-toast mh3-toast--err', style: { marginTop: '10px' } }, job.error)
                    : null,
                job !== null && job.status === 'completed' && job.render !== null
                    ? h('div', { className: 'mh3-card', style: { marginTop: '10px' } },
                        h('div', { className: 'mh3-card-head' },
                            h('span', { className: 'mh3-card-title' }, job.render.output),
                            h(Badge, { tone: 'ok' }, job.render.opLabel ?? job.render.op)),
                        h(MediaBox, {
                            item: {
                                kind: /\.(mp4|webm|mov|mkv)$/i.test(job.render.output) ? 'video'
                                    : /\.(mp3|wav|m4a|flac)$/i.test(job.render.output) ? 'audio' : 'image',
                                url: `${BASE}/render?name=${encodeURIComponent(job.render.output)}`,
                            },
                        }))
                    : null,

                h('div', { className: 'mh3-sep' }),
                h('div', { className: 'mh3-card-head' },
                    h('span', { className: 'mh3-card-title' }, `${t('renders')} (${(renders.data?.renders ?? []).length})`),
                    h(Button, { small: true, onClick: renders.reload }, t('refresh'))),
                (renders.data?.renders ?? []).length === 0
                    ? h('div', { className: 'mh3-empty' }, t('noRenders'))
                    : (renders.data?.renders ?? []).map((render) => h('div', { key: render.id, className: 'mh3-card' },
                        h('div', { className: 'mh3-card-head' },
                            h('span', { className: 'mh3-card-title' }, render.output),
                            h(Badge, null, render.op)),
                        h('div', { className: 'mh3-kv' },
                            h('span', null, render.note ?? ''),
                            h('span', null, `${render.sizeBytes} ${t('bytes')}`),
                            render.probe !== undefined && render.probe !== null
                                ? h('span', null, `${render.probe.width}×${render.probe.height} · ${(render.probe.duration ?? 0).toFixed(1)}s`)
                                : null),
                        h(MediaBox, {
                            item: {
                                kind: /\.(mp4|webm|mov|mkv)$/i.test(render.output) ? 'video'
                                    : /\.(mp3|wav|m4a|flac)$/i.test(render.output) ? 'audio' : 'image',
                                url: `${BASE}/render?name=${encodeURIComponent(render.output)}`,
                            },
                        }),
                        h('div', { className: 'mh3-row', style: { marginTop: '8px' } },
                            h(Button, {
                                small: true,
                                onClick: () => setLocalSource(`render:${render.output}`),
                            }, t('source')),
                            h(Button, {
                                small: true,
                                danger: true,
                                onClick: async () => {
                                    await api.post('/renders/delete', { renderId: render.id });
                                    renders.reload();
                                },
                            }, t('deleteRender')))))); 
        }

        /* ------------------------------------------------------------------ */
        /* Settings tab                                                        */
        /* ------------------------------------------------------------------ */

        function SettingsTab({ t, meta, lang, onLang }) {
            const config = useAsync(() => api.get('/config'), []);
            const [form, setForm] = react.useState(null);
            const [notice, setNotice] = react.useState(null);
            const [busy, setBusy] = react.useState(false);
            const [report, setReport] = react.useState(null);

            react.useEffect(() => {
                if (config.data !== null && form === null) {
                    const data = config.data;
                    setForm({
                        baseUrl: data.baseUrl ?? '',
                        apiKeyEnv: data.apiKeyEnv ?? '',
                        authHeader: data.authHeader ?? 'Authorization',
                        authScheme: data.authScheme ?? 'Bearer',
                        mediaHost: data.mediaHost ?? '',
                        ffmpegPath: data.ffmpegPath ?? '',
                        ffprobePath: data.ffprobePath ?? '',
                        comfyuiDirs: (data.comfyuiDirs ?? []).join('\n'),
                        defaultAspect: data.defaults?.aspect ?? '',
                        defaultMegapixels: String(data.defaults?.megapixels ?? 0.4),
                        defaultDuration: String(data.defaults?.duration ?? 5),
                        defaultTurbo: data.defaults?.turbo === true,
                    });
                }
            }, [config.data, form]);

            if (form === null) return h('div', { className: 'mh3-empty' }, t('loading'));

            const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

            const save = async () => {
                setBusy(true);
                setNotice(null);
                try {
                    await api.post('/config', {
                        patch: {
                            baseUrl: form.baseUrl,
                            apiKeyEnv: form.apiKeyEnv,
                            authHeader: form.authHeader,
                            authScheme: form.authScheme,
                            mediaHost: form.mediaHost,
                            ffmpegPath: form.ffmpegPath,
                            ffprobePath: form.ffprobePath,
                            comfyuiDirs: form.comfyuiDirs.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
                            defaultAspect: form.defaultAspect,
                            defaultMegapixels: Number(form.defaultMegapixels) || 0.4,
                            defaultDuration: Number(form.defaultDuration) || 5,
                            defaultTurbo: form.defaultTurbo === true,
                        },
                    });
                    setNotice({ tone: 'ok', text: t('saved') });
                    config.reload();
                }
                catch (error) {
                    setNotice({ tone: 'err', text: `${t('saveFailed')}: ${error instanceof Error ? error.message : String(error)}` });
                }
                finally {
                    setBusy(false);
                }
            };

            const test = async () => {
                setBusy(true);
                setNotice(null);
                try {
                    const result = await api.post('/test', {});
                    setReport(result.report ?? null);
                    setNotice(result.ok === true
                        ? { tone: 'ok', text: t('connOk', { version: result.report?.version ?? '?', ms: result.report?.latencyMs ?? 0 }) }
                        : { tone: 'err', text: t('connFail', { message: result.report?.error || result.error || '' }) });
                }
                catch (error) {
                    setNotice({ tone: 'err', text: error instanceof Error ? error.message : String(error) });
                }
                finally {
                    setBusy(false);
                }
            };

            return h('div', null,
                notice !== null ? h('div', { className: `mh3-toast mh3-toast--${notice.tone}` }, notice.text) : null,
                h('div', { className: 'mh3-hint', style: { marginBottom: '10px' } }, t('settingsWhere')),

                h(Field, { label: t('baseUrl') }, h(TextInput, { value: form.baseUrl, onChange: set('baseUrl') })),
                h('div', { className: 'mh3-row' },
                    h(Field, { label: t('apiKeyEnv') }, h(TextInput, { value: form.apiKeyEnv, onChange: set('apiKeyEnv') })),
                    h(Field, { label: t('mediaHost'), hint: t('mediaHostHint') },
                        h(TextInput, { value: form.mediaHost, onChange: set('mediaHost') }))),
                // Remote setups disagree here: a LAN box needs no auth at all, while
                // a rented GPU behind nginx may want x-api-key with no scheme.
                h('div', { className: 'mh3-row' },
                    h(Field, { label: t('authHeader'), hint: t('authHeaderHint') },
                        h(TextInput, { value: form.authHeader, onChange: set('authHeader') })),
                    h(Field, { label: t('authScheme'), hint: t('authSchemeHint') },
                        h(TextInput, { value: form.authScheme, onChange: set('authScheme') }))),
                h('div', { className: 'mh3-row' },
                    h(Field, {
                        label: t('ffmpegPath'),
                        hint: meta?.ffmpeg?.ok === true
                            ? t('ffmpegOk', { version: meta.ffmpeg.version })
                            : t('notConfigured'),
                    }, h(TextInput, { value: form.ffmpegPath, onChange: set('ffmpegPath') })),
                    h(Field, { label: t('ffmpegProbe') },
                        h(TextInput, { value: form.ffprobePath, onChange: set('ffprobePath') }))),
                // Not editable here on purpose: the store is built from it at apply time,
                // so changing it restarts the plugin — that belongs in
                // cordis.patch.yml, not in a live settings form.
                h(Field, { label: t('dataDir') },
                    h('div', { className: 'mh3-mono' }, config.data?.dataDir ?? '')),
                h(Field, { label: t('comfyuiDirs') },
                    h(TextArea, {
                        small: true,
                        value: form.comfyuiDirs,
                        onChange: set('comfyuiDirs'),
                    })),

                h('div', { className: 'mh3-sep' }),
                h('div', { className: 'mh3-label' }, t('defaults')),
                h('div', { className: 'mh3-row' },
                    h(Field, { label: t('aspect') },
                        h(Select, {
                            value: form.defaultAspect,
                            onChange: set('defaultAspect'),
                            options: (meta?.aspects ?? []).map((value) => ({ value, label: value })),
                        })),
                    h(Field, { label: t('megapixels') },
                        h(TextInput, { type: 'number', step: 0.05, value: form.defaultMegapixels, onChange: set('defaultMegapixels') })),
                    h(Field, { label: t('duration') },
                        h(TextInput, { type: 'number', step: 1, value: form.defaultDuration, onChange: set('defaultDuration') }))),
                h(Field, { label: t('turbo') },
                    h(Toggle, { checked: form.defaultTurbo, onChange: set('defaultTurbo'), label: t('turbo') })),

                h('div', { className: 'mh3-sep' }),
                h(Field, { label: t('language') },
                    h(Select, {
                        value: lang,
                        onChange: (value) => {
                            onLang(value);
                            setLang(value);
                        },
                        options: [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }],
                    })),

                h('div', { className: 'mh3-row', style: { marginTop: '10px' } },
                    h(Button, { primary: true, onClick: save, disabled: busy === true || config.data?.writable !== true }, t('save2')),
                    h(Button, { onClick: test, disabled: busy === true }, busy === true ? t('testing') : t('testConn'))),

                // The connection report. This is the panel that earns its keep when
                // pointing at a rented GPU or another machine: it names the route
                // prefix the server settled on, says which endpoints answered, and
                // reports whether the H3 nodes are even installed there.
                report === null ? null : h('div', { className: 'mh3-card', style: { marginTop: '12px' } },
                    h('div', { className: 'mh3-card-head' },
                        h('span', { className: 'mh3-card-title' }, t('diagnostics')),
                        h(Badge, { tone: report.endpoints?.systemStats === true ? 'ok' : 'err' }, report.version || '—')),
                    h('div', { className: 'mh3-kv' },
                        h('span', { className: 'mh3-mono' }, report.baseUrl),
                        h('span', null, `${t('latency')} ${report.latencyMs} ms`),
                        h('span', null, `${t('routePrefix')} "${report.routePrefix === '' ? '/' : report.routePrefix}"`),
                        h('span', null, report.authConfigured === true
                            ? `${report.authHeader}${report.authScheme === '' ? '' : ` ${report.authScheme}`}`
                            : t('authNone'))),
                    h('div', { className: 'mh3-kv' },
                        Object.entries(report.endpoints ?? {}).map(([name, ok]) => h('span', { key: name },
                            h(Badge, { tone: ok === true ? 'ok' : 'err' }, name)))),
                    Object.keys(report.h3 ?? {}).length === 0 ? null : h('div', { className: 'mh3-kv' },
                        Object.entries(report.h3).map(([name, ok]) => h('span', { key: name },
                            h(Badge, { tone: ok === true ? 'ok' : 'err' }, name)))),
                    h('div', { className: 'mh3-kv' },
                        report.ffmpeg === undefined ? null : h(Badge, { tone: report.ffmpeg.ok === true ? 'ok' : 'warn' },
                            report.ffmpeg.ok === true ? `ffmpeg ${report.ffmpeg.version}` : t('ffmpegMissingShort')),
                        h(Badge, null, `${t('localScanDirs')} ${report.comfyuiDirs}`)),
                    report.historyEntries !== undefined
                        ? h('div', { className: 'mh3-hint' }, `${t('historyEntries')} ${report.historyEntries}`)
                        : null,
                    Object.values(report.h3 ?? {}).some((value) => value === false)
                        ? h('div', { className: 'mh3-hint' }, t('h3NodesMissing'))
                        : null));
        }

        /* ------------------------------------------------------------------ */
        /* Settings-page section                                               */
        /* ------------------------------------------------------------------ */

        /**
         * The 设置 → MiniMax H3 视频 page (`settings.section`, id `minimaxh3`).
         *
         * The host's settings page is schema-driven, and this plugin
         * deliberately ships no `Config` schema (see `lib/config.js`: a
         * directory-linked bundle cannot resolve a schema dependency at
         * runtime). So the section contributes its own form instead of relying
         * on one being generated — it is the very same component the panel's
         * Settings tab renders, so the two doors can never drift apart.
         */
        function H3SettingsSection({ t, lang, onLang }) {
            // Only for the aspect-ratio choices and the FFmpeg verdict the form shows.
            const meta = useAsync(() => api.get('/meta'), []);
            const [langState, setLangState] = react.useState(lang);
            const tt = react.useMemo(() => makeT(langState), [langState]);
            return h('div', { className: 'mh3-section' },
                h('div', { className: 'mh3-section-intro' }, tt('settingsIntro')),
                h(SettingsTab, {
                    t: tt,
                    meta: meta.data,
                    lang: langState,
                    onLang: (value) => {
                        setLangState(value);
                        if (typeof onLang === 'function') onLang(value);
                    },
                }));
        }

        /* ------------------------------------------------------------------ */
        /* Panel shell                                                         */
        /* ------------------------------------------------------------------ */

        const GEOM_KEY = 'dsh-minimax-h3-panel-geom';

        function loadGeometry() {
            try {
                const raw = localStorage.getItem(GEOM_KEY);
                if (raw === null) return {};
                const parsed = JSON.parse(raw);
                const geometry = {};
                if (typeof parsed.x === 'number') geometry.x = parsed.x;
                if (typeof parsed.y === 'number') geometry.y = parsed.y;
                if (typeof parsed.width === 'number' && parsed.width >= 380) geometry.width = parsed.width;
                if (typeof parsed.height === 'number' && parsed.height >= 300) geometry.height = parsed.height;
                return geometry;
            }
            catch {
                return {};
            }
        }

        function H3Panel({ t, lang, onLang }) {
            const open = usePanelOpen();
            const tab = usePanelTab();
            const [geometry, setGeometry] = react.useState(loadGeometry);
            const [langState, setLangState] = react.useState(lang);
            const tt = react.useMemo(() => makeT(langState), [langState]);
            const meta = useAsync(() => api.get('/meta'), []);
            const runs = useAsync(() => api.get('/runs?limit=40'), []);
            const dragState = react.useRef(null);

            /** Runs still queued or running drive the polling cadence. */
            const busy = (runs.data?.runs ?? []).some((run) => run.status === 'queued' || run.status === 'running');
            useInterval(() => {
                if (busy) runs.reload();
            }, busy ? 5000 : null);

            const persist = react.useCallback((next) => {
                setGeometry(next);
                try {
                    localStorage.setItem(GEOM_KEY, JSON.stringify(next));
                }
                catch {
                    // Geometry simply will not persist.
                }
            }, []);

            react.useEffect(() => {
                const onMove = (event) => {
                    const state = dragState.current;
                    if (state === null) return;
                    if (state.mode === 'move') {
                        persist({ ...state.base, x: state.base.x + (event.clientX - state.originX), y: state.base.y + (event.clientY - state.originY) });
                    }
                    else {
                        persist({
                            ...state.base,
                            width: Math.max(380, state.base.width + (event.clientX - state.originX)),
                            height: Math.max(300, state.base.height + (event.clientY - state.originY)),
                        });
                    }
                };
                const onUp = () => {
                    dragState.current = null;
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [persist]);

            if (!open) return null;

            const geometryStyle = {
                left: `${geometry.x ?? (window.innerWidth - (geometry.width ?? 720) - 24)}px`,
                top: `${geometry.y ?? 72}px`,
                width: `${geometry.width ?? 720}px`,
                height: `${geometry.height ?? 560}px`,
            };

            const startDrag = (mode) => (event) => {
                if (event.button !== 0) return;
                dragState.current = {
                    mode,
                    originX: event.clientX,
                    originY: event.clientY,
                    base: {
                        x: geometry.x ?? (window.innerWidth - (geometry.width ?? 720) - 24),
                        y: geometry.y ?? 72,
                        width: geometry.width ?? 720,
                        height: geometry.height ?? 560,
                    },
                };
                event.preventDefault();
            };

            const tabs = [
                ['generate', tt('tabGenerate')],
                ['shots', tt('tabShots')],
                ['results', tt('tabResults')],
                ['post', tt('tabPost')],
                ['settings', tt('tabSettings')],
            ];

            return h('div', { className: 'mh3-panel', style: geometryStyle },
                h('div', { className: 'mh3-head', onPointerDown: startDrag('move') },
                    h('span', { className: 'mh3-head-title' }, tt('panelTitle')),
                    h('span', { className: 'mh3-head-sub' },
                        meta.data === null
                            ? tt('loading')
                            : meta.data.reachable === true
                                ? `ComfyUI ${meta.data.version}`
                                : (meta.data.error ?? tt('error'))),
                    h(Button, { small: true, onClick: () => panelStore.close() }, '×')),
                h('div', { className: 'mh3-tabs' },
                    tabs.map(([id, label]) => h('button', {
                        key: id,
                        type: 'button',
                        className: `mh3-tab${tab === id ? ' mh3-tab--on' : ''}`,
                        onClick: () => panelStore.setTab(id),
                    }, label))),
                h('div', { className: 'mh3-body' },
                    tab === 'generate'
                        ? h(GenerateTab, { t: tt, meta: meta.data, onGenerated: () => runs.reload() })
                        : null,
                    tab === 'shots'
                        ? h(ShotsTab, { t: tt, meta: meta.data, onGenerated: () => runs.reload() })
                        : null,
                    tab === 'results'
                        ? h(ResultsTab, { t: tt, runs, reload: runs.reload, busy })
                        : null,
                    tab === 'post'
                        ? h(PostTab, {
                            t: tt,
                            meta: meta.data,
                            runs,
                            source: panelStore.source(),
                            extras: panelStore.extras(),
                            onSourceChange: (next, extra) => panelStore.setSource(next, extra),
                        })
                        : null,
                    tab === 'settings'
                        ? h(SettingsTab, {
                            t: tt,
                            meta: meta.data,
                            lang: langState,
                            onLang: (value) => {
                                setLangState(value);
                                if (typeof onLang === 'function') onLang(value);
                            },
                        })
                        : null),
                h('div', { className: 'mh3-resize', onPointerDown: startDrag('resize') }));
        }

        function H3Trigger({ t }) {
            const open = usePanelOpen();
            return h('button', {
                type: 'button',
                className: 'mh3-trigger',
                title: t('panelTitle'),
                'aria-label': t('panelTitle'),
                'aria-pressed': open,
                onClick: () => panelStore.toggle(),
            },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
                h('rect', { x: 1, y: 3, width: 14, height: 10, rx: 2.5, fill: 'currentColor', opacity: 0.22 }),
                h('path', { d: 'M6.5 5.8v4.4L10.4 8z', fill: 'currentColor' })),
            h('span', null, t('panelTitle')));
        }

        /* ------------------------------------------------------------------ */
        /* Tool cards                                                          */
        /* ------------------------------------------------------------------ */

        function parseArgs(raw) {
            try {
                const parsed = JSON.parse(raw);
                return typeof parsed === 'object' && parsed !== null ? parsed : {};
            }
            catch {
                return {};
            }
        }

        /** A generation card: running state, background job, or the finished clip. */
        function H3GenerateCard({ t, block }) {
            if (block === null || block === undefined || typeof block !== 'object') {
                return h('div', { className: 'mh3-card-host' }, h(Badge, null, 'MiniMax H3'));
            }
            if (block.kind === 'tool-result') {
                if (block.isError === true) {
                    return h('div', { className: 'mh3-card-host' },
                        h('div', { className: 'mh3-card-head' },
                            h(Badge, { tone: 'err' }, t('error')),
                            h('span', { className: 'mh3-card-title' }, block.error?.name ?? 'h3_generate')));
                }
                const meta = block.meta;
                if (meta === null || typeof meta !== 'object') {
                    return h('div', { className: 'mh3-card-host' }, h(Badge, null, 'MiniMax H3'));
                }
                if (meta.kind === 'background') {
                    return h('div', { className: 'mh3-card-host' },
                        h('div', { className: 'mh3-card-head' },
                            h(Badge, { tone: 'run' }, t('bgJob')),
                            h('span', { className: 'mh3-card-title' }, meta.runId ?? '')),
                        h('div', { className: 'mh3-kv' },
                            h('span', { className: 'mh3-mono' }, `job ${meta.jobId}`),
                            h('span', { className: 'mh3-mono' }, `prompt ${meta.promptId}`)),
                        h('div', { className: 'mh3-hint' }, t('collectWithJob')));
                }
                const media = Array.isArray(meta.media) ? meta.media : [];
                return h('div', { className: 'mh3-card-host' },
                    h('div', { className: 'mh3-card-head' },
                        h(StatusBadge, { t, status: meta.status }),
                        h('span', { className: 'mh3-card-title' }, meta.summary ?? meta.runId ?? ''),
                        h(Button, {
                            small: true,
                            disabled: media.length === 0,
                            onClick: () => panelStore.setSource(`run:${meta.runId}:0`),
                        }, t('useAsSource'))),
                    media.map((item, index) => h('div', { key: index },
                        h(MediaBox, { item }),
                        h('div', { className: 'mh3-kv' }, h('span', { className: 'mh3-mono' }, item.filename ?? '')))));
            }
            const args = parseArgs(block.argsRaw);
            const prompt = typeof args.prompt === 'string' ? args.prompt : '';
            return h('div', { className: 'mh3-card-host' },
                h('div', { className: 'mh3-card-head' },
                    h(Badge, { tone: 'run' }, t('generatingNow')),
                    h('span', { className: 'mh3-card-title' }, args.mode ?? 't2v')),
                h('div', { className: 'mh3-hint' },
                    prompt.length > 220 ? `${prompt.slice(0, 220)}…` : prompt));
        }

        /** A finishing card: the produced file, ready to play. */
        function H3PostCard({ t, block }) {
            if (block === null || block === undefined || typeof block !== 'object') {
                return h('div', { className: 'mh3-card-host' }, h(Badge, null, 'h3_post'));
            }
            if (block.kind === 'tool-result') {
                if (block.isError === true) {
                    return h('div', { className: 'mh3-card-host' },
                        h('div', { className: 'mh3-card-head' },
                            h(Badge, { tone: 'err' }, t('error')),
                            h('span', { className: 'mh3-card-title' }, block.error?.name ?? 'h3_post')));
                }
                const meta = block.meta;
                if (meta === null || typeof meta !== 'object' || meta.kind !== 'post' || meta.render === undefined) {
                    return h('div', { className: 'mh3-card-host' }, h(Badge, null, 'h3_post'));
                }
                const render = meta.render;
                return h('div', { className: 'mh3-card-host' },
                    h('div', { className: 'mh3-card-head' },
                        h(Badge, { tone: 'ok' }, render.opLabel ?? render.op ?? 'ffmpeg'),
                        h('span', { className: 'mh3-card-title' }, render.output ?? ''),
                        render.url !== undefined
                            ? h(Button, {
                                small: true,
                                onClick: () => panelStore.setSource(`render:${render.output}`),
                            }, t('useAsSource'))
                            : null),
                    h(MediaBox, { item: { kind: render.kind, url: render.url } }),
                    h('div', { className: 'mh3-kv' },
                        render.note !== undefined && render.note !== '' ? h('span', null, render.note) : null,
                        h('span', null, `${render.sizeBytes ?? 0} ${t('bytes')}`)));
            }
            const args = parseArgs(block.argsRaw);
            return h('div', { className: 'mh3-card-host' },
                h('div', { className: 'mh3-card-head' },
                    h(Badge, { tone: 'run' }, t('running')),
                    h('span', { className: 'mh3-card-title' }, args.op ?? 'ffmpeg')));
        }

        /* ------------------------------------------------------------------ */
        /* Plugin entry                                                        */
        /* ------------------------------------------------------------------ */

        const name = 'dsh-minimax-h3';
        const inject = ['slots'];

        function apply(ctx) {
            let lang = getLang();
            ctx.effect(() => {
                injectStyles();
                // Removing the element on unload keeps HMR and plugin toggling from
                // leaving a stale stylesheet behind.
                return () => {
                    document.getElementById('dsh-minimax-h3-styles')?.remove();
                };
            }, 'dsh-minimax-h3: styles');

            ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
                name: 'conversation.session.header.actions',
                id: 'minimaxh3',
                order: 110,
                label: () => makeT(getLang())('panelTitle'),
            }, (props) => h(H3Trigger, { t: makeT(getLang()), ...(props ?? {}) })));

            ctx.slots.inject('shell.overlay', () => ctx.slots.register({
                name: 'shell.overlay',
                id: 'minimaxh3.panel',
                order: 25,
                label: () => makeT(getLang())('panelTitle'),
            }, (props) => h(H3Panel, {
                t: makeT(lang),
                lang,
                onLang: (value) => {
                    lang = value;
                },
                ...(props ?? {}),
            })));

            // The host settings page gets a real section for this plugin. It is a
            // client-side slot, so it needs no schema — which is exactly what makes
            // it possible for a bundle that ships no Config.
            ctx.slots.inject('settings.section', () => ctx.slots.register({
                name: 'settings.section',
                id: 'minimaxh3',
                order: 30,
                label: () => makeT(getLang())('panelTitle'),
            }, (props) => h(H3SettingsSection, {
                t: makeT(lang),
                lang,
                onLang: (value) => {
                    lang = value;
                },
                ...(props ?? {}),
            })));

            ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
                name: 'tool.call.toolview',
                key: 'h3_generate',
            }, (props) => h(H3GenerateCard, { t: makeT(getLang()), ...(props ?? {}) })));

            ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
                name: 'tool.call.toolview',
                key: 'h3_post',
            }, (props) => h(H3PostCard, { t: makeT(getLang()), ...(props ?? {}) })));
        }

        exports.apply = apply;
        exports.inject = inject;
        exports.name = name;
        return module.exports;
    },
});