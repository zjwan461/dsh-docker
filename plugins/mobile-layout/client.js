/**
 * Mobile Layout — the Client half of @local/dsh-mobile-layout.
 *
 * On a narrow viewport (or when the user forces the mode in Settings → General)
 * it reflows the shipped shell instead of replacing it:
 *
 *  - the 56px icon rail and the right track give their width back to the
 *    conversation, and the sidebar becomes an overlay drawer opened from a
 *    floating button in `shell.overlay`;
 *  - the conversation header and chat column lose their desktop padding and
 *    respect the notch / home-indicator safe areas;
 *  - the composer gets a 16px field (no iOS zoom) and a thumb-sized submit;
 *  - the Settings sheet turns full screen with its section list as a tab strip.
 *
 * No component and no DOM node of the shell is replaced; only a stylesheet is
 * injected while the mode is active, and it is removed when the plugin unloads
 * or the mode turns off. All visible strings go through the Client locale.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-mobile-layout",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState, useSyncExternalStore } = React;

    const NS = "mobile-layout";
    const ROOT_ID = "@local/dsh-mobile-layout";
    const QUERY = "(max-width: 768px)";
    const STORAGE_KEY = "dsh.mobileLayout.mode";
    const MODES = ["auto", "always", "never"];

    const zh = {
      "settings.title": "移动布局",
      "settings.description": "窄屏时把侧栏收成抽屉、让对话占满屏幕，并加大输入区与弹窗的触摸目标。",
      "mode.auto": "自动",
      "mode.always": "始终",
      "mode.never": "关闭",
      "drawer.open": "打开会话列表",
    };
    const en = {
      "settings.title": "Mobile layout",
      "settings.description": "On narrow screens the sidebar becomes a drawer, the conversation takes the full width, and controls are sized for touch.",
      "mode.auto": "Auto",
      "mode.always": "Always",
      "mode.never": "Off",
      "drawer.open": "Open the session list",
    };

    /* ------------------------------------------------------------------ */
    /* preference store (localStorage + a tiny observable for both slots)   */
    /* ------------------------------------------------------------------ */

    const listeners = new Set();

    function readMode() {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return MODES.includes(stored) ? stored : "auto";
      } catch {
        return "auto";
      }
    }

    let mode = readMode();

    function subscribeMode(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function setMode(next) {
      if (!MODES.includes(next) || next === mode) return;
      mode = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode: the choice stays for this page only */
      }
      for (const listener of listeners) listener();
    }

    function isActive() {
      if (mode === "always") return true;
      if (mode === "never") return false;
      return window.matchMedia(QUERY).matches;
    }

    function useMode() {
      return useSyncExternalStore(subscribeMode, () => mode, () => "auto");
    }

    function useNarrow() {
      const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches);
      useEffect(() => {
        const mql = window.matchMedia(QUERY);
        const sync = () => setNarrow(mql.matches);
        sync();
        mql.addEventListener("change", sync);
        return () => mql.removeEventListener("change", sync);
      }, []);
      return narrow;
    }

    function useMobile() {
      const current = useMode();
      const narrow = useNarrow();
      return current === "always" || (current === "auto" && narrow);
    }

    /* ------------------------------------------------------------------ */
    /* shell observation: is the sidebar expanded right now?                */
    /* ------------------------------------------------------------------ */

    function useDrawerOpen(active) {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        if (!active) {
          setOpen(false);
          return;
        }
        const frame = document.querySelector('[class*="_frame"]');
        if (frame === null) return;
        const sync = () => setOpen(!frame.hasAttribute("data-sidebar-collapsed"));
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(frame, { attributes: true, attributeFilter: ["data-sidebar-collapsed"] });
        return () => observer.disconnect();
      }, [active]);
      return open;
    }

    /* ------------------------------------------------------------------ */
    /* frame-wide chrome: drawer trigger, scrim, escape + row dismissal     */
    /* ------------------------------------------------------------------ */

    function MobileChrome(props) {
      const active = useMobile();
      const drawerOpen = useDrawerOpen(active);
      const toggle = props.toggleSidebar;

      useEffect(() => {
        if (!active || !drawerOpen) return;
        const onKeyDown = (event) => {
          if (event.key === "Escape") toggle();
        };
        const onClick = (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          // Session rows, the New Session button, the global panel rows and the
          // Settings trigger all navigate: the drawer has done its job.
          if (target.closest('[data-row-key^="session:"]') !== null) return toggle();
          if (target.closest('[class*="_newSession"]') !== null) return toggle();
          if (target.closest('[class*="_panelRow"]') !== null) return toggle();
          if (target.closest('[class*="_triggerRow"]') !== null) return toggle();
        };
        window.addEventListener("keydown", onKeyDown);
        document.addEventListener("click", onClick, true);
        return () => {
          window.removeEventListener("keydown", onKeyDown);
          document.removeEventListener("click", onClick, true);
        };
      }, [active, drawerOpen, toggle]);

      if (!active) return null;

      return h(
        React.Fragment,
        null,
        drawerOpen
          ? h("div", {
              className: "dshm-scrim",
              "aria-hidden": true,
              onClick: toggle,
            })
          : null,
        drawerOpen
          ? null
          : h(
              "button",
              {
                type: "button",
                className: "dshm-drawer-button",
                title: props.t("drawer.open"),
                "aria-label": props.t("drawer.open"),
                onClick: toggle,
              },
              h(
                "svg",
                { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true },
                h("path", {
                  d: "M4 7h16M4 12h16M4 17h11",
                  stroke: "currentColor",
                  strokeWidth: 1.7,
                  strokeLinecap: "round",
                }),
              ),
            ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Settings → General row: Auto / Always / Off                          */
    /* ------------------------------------------------------------------ */

    function MobileSettingsRow(props) {
      const current = useMode();
      const t = props.t;
      return h(
        "div",
        { className: "dshm-row" },
        h(
          "div",
          { className: "dshm-rowText" },
          h("div", { className: "dshm-rowTitle" }, t("settings.title")),
          h("div", { className: "dshm-rowDescription" }, t("settings.description")),
        ),
        h(
          "div",
          { className: "dshm-segmented", role: "group", "aria-label": t("settings.title") },
          MODES.map((value) =>
            h(
              "button",
              {
                key: value,
                type: "button",
                className: "dshm-segment",
                "aria-pressed": current === value ? "true" : "false",
                onClick: () => setMode(value),
              },
              t("mode." + value),
            ),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* stylesheet                                                          */
    /* ------------------------------------------------------------------ */

    const css = `
html[data-dsh-mobile] {
  --dsh-content-font-size: 15px;
  -webkit-text-size-adjust: 100%;
}
html[data-dsh-mobile] body {
  height: 100dvh;
  overflow: hidden;
  overscroll-behavior-y: none;
}
html[data-dsh-mobile] #root { height: 100%; }

/* the rail and the right track give their width back to the conversation */
html[data-dsh-mobile] [class*="_frame"] {
  grid-template-columns: 0 minmax(0, 1fr) 0 !important;
}
html[data-dsh-mobile] [class*="_centerCol"] {
  grid-column: 2 !important;
  grid-row: 1 !important;
  min-width: 0;
}
html[data-dsh-mobile] [data-rightbar-col] {
  grid-column: 3 !important;
  grid-row: 1 !important;
}
html[data-dsh-mobile] [class*="_handle"] { display: none !important; }

/* the sidebar is a drawer over the conversation */
html[data-dsh-mobile] [class*="_sidebarCol"] {
  position: fixed !important;
  inset: 0 auto 0 0 !important;
  width: min(86vw, 320px) !important;
  height: 100dvh !important;
  z-index: 30 !important;
  overflow: hidden !important;
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top);
  box-shadow: 0 18px 60px rgb(0 0 0 / 30%);
  animation: dshm-drawer-in 180ms var(--ds-ease-in-out, ease-out);
}
html[data-dsh-mobile] [class*="_sidebarCol"] > * {
  box-sizing: border-box;
  padding-bottom: calc(env(safe-area-inset-bottom) + 6px);
}
html[data-dsh-mobile] [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"] {
  display: none !important;
}
html[data-dsh-mobile] [class*="_sidebarCol"] [data-row-key] {
  min-height: 40px;
  display: flex;
  align-items: center;
}

/* conversation header: compact, safe-area aware, action cluster scrolls */
html[data-dsh-mobile] [data-window-drag][class*="_header"] {
  min-height: 0 !important;
  padding: calc(env(safe-area-inset-top) + 10px) 10px 8px 56px !important;
  gap: 8px;
}
html[data-dsh-mobile] [class*="_titleRow"] { min-height: 0 !important; }
html[data-dsh-mobile] [data-window-drag] [class*="_headerActions"] {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
html[data-dsh-mobile] [data-window-drag] [class*="_headerActions"]::-webkit-scrollbar { display: none; }
html[data-dsh-mobile] [data-window-drag] [class*="_headerActions"] > * { flex: none; }

/* chat column */
html[data-dsh-mobile] [data-conversation-scroll] [class*="_scroll"] {
  padding: 12px 14px !important;
}
html[data-dsh-mobile] [data-conversation-content] pre {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
html[data-dsh-mobile] [data-conversation-content] table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
html[data-dsh-mobile] [data-conversation-content] img,
html[data-dsh-mobile] [data-conversation-content] video {
  max-width: 100%;
  height: auto;
}

/* composer: 16px keeps iOS from zooming, 40px submit, safe-area floor */
html[data-dsh-mobile] [data-composer-seat] {
  padding-bottom: calc(8px + env(safe-area-inset-bottom)) !important;
}
html[data-dsh-mobile] [data-composer-card] { border-radius: 22px !important; }
html[data-dsh-mobile] [data-composer-input],
html[data-dsh-mobile] [data-composer-placeholder] {
  font-size: 16px !important;
  line-height: 24px !important;
}
html[data-dsh-mobile] [data-composer-card] [class*="_primary"] {
  width: 40px !important;
  height: 40px !important;
}

/* settings: full-screen sheet, section list as a tab strip */
html[data-dsh-mobile] [role="dialog"]:has(> nav) {
  position: relative;
  width: 100vw !important;
  max-width: 100vw !important;
  height: 100dvh !important;
  max-height: 100dvh !important;
  border-radius: 0 !important;
  flex-direction: column !important;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) !important;
  transform: none !important;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) > nav {
  flex: none;
  width: 100% !important;
  padding: 12px 12px 0 !important;
  gap: 10px !important;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) > nav > [class*="_navTitle"] {
  padding: 0 4px !important;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) > nav > [class*="_navList"] {
  flex-direction: row !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  gap: 6px !important;
  padding-bottom: 6px;
  scrollbar-width: none;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) > nav > [class*="_navList"]::-webkit-scrollbar { display: none; }
html[data-dsh-mobile] [role="dialog"]:has(> nav) [class*="_navCell"] {
  flex: none !important;
  height: 34px !important;
  padding: 0 12px !important;
  white-space: nowrap;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) > [class*="_content"] {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) > [class*="_content"] > [class*="_header"] {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 8px);
  right: 8px;
  height: auto !important;
  padding: 0 !important;
  z-index: 3;
}
html[data-dsh-mobile] [role="dialog"]:has(> nav) [class*="_options"] {
  padding: 4px 16px 24px !important;
}

/* every other modal stays inside the viewport */
html[data-dsh-mobile] [role="dialog"]:not(:has(> nav)) {
  max-width: calc(100vw - 16px) !important;
  max-height: calc(100dvh - 24px) !important;
}

/* plugin pages (Plugins, and any panel registered into main): clear the drawer
   button at the top-left, and let the title row and its toolbar wrap */
html[data-dsh-mobile] [data-plugin-panel] {
  padding-top: calc(env(safe-area-inset-top) + 52px) !important;
}
html[data-dsh-mobile] [data-plugin-panel] [class*="_pageHead"] {
  flex-wrap: wrap;
  row-gap: 12px;
  padding-top: 0 !important;
}
html[data-dsh-mobile] [data-plugin-panel] [class*="_toolbar"] {
  flex-wrap: wrap;
  row-gap: 8px;
}

/* plugin chrome */
.dshm-drawer-button {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 6px);
  left: 8px;
  z-index: 22;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.dshm-drawer-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshm-drawer-button:active { background: var(--dsw-alias-interactive-bg-active); }
.dshm-drawer-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dshm-scrim {
  position: fixed;
  inset: 0;
  z-index: 25;
  background: var(--dsw-alias-bg-mask-1);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  animation: dshm-fade-in 160ms ease-out;
}
@keyframes dshm-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes dshm-drawer-in { from { transform: translateX(-100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .dshm-scrim { animation: none; }
  html[data-dsh-mobile] [class*="_sidebarCol"] { animation: none; }
}

/* Settings row */
.dshm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dshm-rowText { min-width: 0; }
.dshm-rowTitle { font-size: 14px; line-height: 20px; }
.dshm-rowDescription {
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dshm-segmented {
  display: inline-flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
}
.dshm-segment {
  appearance: none;
  min-height: 28px;
  padding: 4px 10px;
  border: none;
  border-radius: calc(var(--dsw-radius-md) - 2px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.dshm-segment[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}
.dshm-segment:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
@media (prefers-color-scheme: light) {
  .dshm-segment[aria-pressed="true"] { box-shadow: 0 1px 2px rgb(0 0 0 / 8%); }
}
`;

    /* ------------------------------------------------------------------ */
    /* plugin activation                                                   */
    /* ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.plugin = ROOT_ID;
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, "mobile-layout: stylesheet");

      ctx.effect(() => {
        const mql = window.matchMedia(QUERY);
        const sync = () => {
          if (isActive()) document.documentElement.setAttribute("data-dsh-mobile", "");
          else document.documentElement.removeAttribute("data-dsh-mobile");
        };
        sync();
        const unsubscribe = subscribeMode(sync);
        mql.addEventListener("change", sync);
        return () => {
          unsubscribe();
          mql.removeEventListener("change", sync);
          document.documentElement.removeAttribute("data-dsh-mobile");
        };
      }, "mobile-layout: root attribute");

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "mobile-layout: dictionaries");

      const toggleSidebar = () => ctx.layout.toggleSidebar();

      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "mobile-layout.chrome",
            order: 5,
            locale: NS,
          },
          (props) => h(MobileChrome, { t: props.t, toggleSidebar }),
        ),
      );

      ctx.slots.inject("settings.general.item", () =>
        ctx.slots.register(
          {
            name: "settings.general.item",
            id: "mobile-layout",
            order: 14,
            locale: NS,
          },
          MobileSettingsRow,
        ),
      );
    }

    return { inject: ["slots", "locale", "layout"], apply };
  },
});
