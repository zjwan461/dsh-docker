/**
 * Mobile Layout — the Client half of @local/dsh-mobile-layout.
 *
 * On a narrow viewport (or when the user forces the mode in Settings → General)
 * it reflows the shipped shell instead of replacing it:
 *
 *  - the 56px icon rail gives its width back to the conversation, and the sidebar
 *    becomes an overlay drawer opened from a floating button in `shell.overlay`;
 *  - the right panel (files, preview, terminal, deliverables) becomes a
 *    full-screen layer: the third grid track is zero-width on a phone, so a
 *    docked panel there can only be clipped;
 *  - the conversation header and chat column lose their desktop padding and
 *    respect the notch / home-indicator safe areas;
 *  - the composer gets a 16px field (no iOS zoom) and a thumb-sized submit, and
 *    the whole frame shrinks with the software keyboard;
 *  - the Settings sheet turns full screen with its section list as a tab strip.
 *
 * No component and no DOM node of the shell is replaced; only a stylesheet is
 * injected while the mode is active, and it is removed when the plugin unloads
 * or the mode turns off. All visible strings go through the Client locale.
 *
 * Two things this half does to the DOCUMENT rather than to the shell, both
 * removed again when the mode turns off:
 *
 *  - `viewport-fit=cover` (+ `interactive-widget=resizes-content`) added to the
 *    existing viewport meta. Without it every `env(safe-area-inset-*)` in this
 *    stylesheet resolves to 0, so the safe-area rules below would be decorative;
 *  - `--dshm-kb`, the height the software keyboard covers, measured from
 *    `visualViewport`. `100dvh` does not account for the keyboard on iOS.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-mobile-layout",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useState, useSyncExternalStore } = React;

    const NS = "mobile-layout";
    const ROOT_ID = "@local/dsh-mobile-layout";
    // The host collapses its own sidebar below 1024 (`SIDEBAR_AUTO_COLLAPSE` in
    // dsh-client-ui-layout). Matching that number is what keeps 769–1023px from
    // falling between the two layouts: a phone in landscape (844) and a tablet in
    // portrait (768/810/834) used to get the host's 56px rail with no drawer.
    const QUERY = "(max-width: 1023px)";
    const STORAGE_KEY = "dsh.mobileLayout.mode";
    const MODES = ["auto", "always", "never"];
    // Host content font defaults to 14px. Below this, a phone makes the chat
    // unreadable; above it the user's own choice wins (see applyFontFloor).
    const MIN_CONTENT_FONT_PX = 15;

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
    /* document-level fixes: viewport meta, font floor, keyboard inset      */
    /* ------------------------------------------------------------------ */

    /** The `content` we replaced, or undefined when we never touched the meta. */
    let savedViewportContent;

    /**
     * Ask the browser for the full screen, insets included.
     *
     * The host ships `<meta name="viewport" content="width=device-width,
     * initial-scale=1">` with no `viewport-fit`. On iOS that makes every
     * `env(safe-area-inset-*)` zero, so without this the notch and home-indicator
     * rules are no-ops. `interactive-widget=resizes-content` is the Chrome-only
     * half of the keyboard story: it shrinks the layout viewport instead of
     * letting the keyboard overlay it (Safari ignores it, and the
     * visualViewport hook below covers that case).
     */
    function patchViewportMeta() {
      if (savedViewportContent !== undefined) return;
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta === null) return;
      savedViewportContent = meta.getAttribute("content") ?? "";
      const parts = savedViewportContent
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      if (!parts.some((part) => part.startsWith("viewport-fit"))) parts.push("viewport-fit=cover");
      if (!parts.some((part) => part.startsWith("interactive-widget"))) {
        parts.push("interactive-widget=resizes-content");
      }
      meta.setAttribute("content", parts.join(", "));
      // Safari applies the new viewport only after a layout pass, and `env()`
      // values are read during that pass.
      void document.documentElement.offsetHeight;
    }

    function restoreViewportMeta() {
      if (savedViewportContent === undefined) return;
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta !== null) meta.setAttribute("content", savedViewportContent);
      savedViewportContent = undefined;
    }

    /**
     * Raise the content font to a legible floor, but never lower the user's.
     *
     * `--dsh-content-font-size` is a HOST setting (dsh-client-ui-theme), written
     * where this plugin cannot see it. Redefining it unconditionally would
     * override a deliberate choice, so we only set the floor when the current
     * value is below it — and that decision is re-made on every activation.
     */
    function applyFontFloor() {
      const root = document.documentElement;
      let current = Number.parseFloat(
        window.getComputedStyle(document.body).getPropertyValue("--dsh-content-font-size"),
      );
      if (!Number.isFinite(current)) current = 14;
      if (current < MIN_CONTENT_FONT_PX) root.setAttribute("data-dshm-font-floor", "");
      else root.removeAttribute("data-dshm-font-floor");
    }

    /**
     * Publish the keyboard's height as `--dshm-kb`.
     *
     * `100dvh` tracks the browser chrome, not the software keyboard: on iOS the
     * keyboard is an overlay, so a `100dvh` app keeps its full height and the
     * composer ends up behind it. The frame and the Settings sheet subtract this
     * variable. Small differences (< 40px) are the URL bar collapsing, not a
     * keyboard, and are reported as 0 so the layout does not jitter while
     * scrolling.
     */
    function useKeyboardInset(active) {
      useEffect(() => {
        if (!active) return;
        const vv = window.visualViewport;
        if (vv === null || vv === undefined) return;
        const root = document.documentElement;
        const sync = () => {
          const covered = Math.round(window.innerHeight - (vv.height + vv.offsetTop));
          root.style.setProperty("--dshm-kb", covered > 40 ? `${covered}px` : "0px");
        };
        sync();
        vv.addEventListener("resize", sync);
        vv.addEventListener("scroll", sync);
        return () => {
          vv.removeEventListener("resize", sync);
          vv.removeEventListener("scroll", sync);
          root.style.removeProperty("--dshm-kb");
        };
      }, [active]);
    }

    /* ------------------------------------------------------------------ */
    /* edge-swipe drawer gesture                                           */
    /* ------------------------------------------------------------------ */

    // A drag has to start this close to the left edge to open the drawer…
    const EDGE_PX = 24;
    // …and travel this far horizontally before it commits.
    const COMMIT_PX = 64;
    // Below this the touch is a tap or vertical scroll, not a swipe.
    const SLOP_PX = 10;
    // Matches the drawer's own open animation, so the hand-off is invisible.
    const SETTLE_MS = 180;

    /**
     * Drag the drawer out from the left edge, and swipe it away to close.
     *
     * The drawer is `display: none` while collapsed, so a "follow the finger"
     * drag has to force it visible itself (`data-dshm-dragging` + `--dshm-drag`).
     * On release the drawer either settles back or finishes opening, and only
     * then is `toggleSidebar()` called — with the host's own open animation
     * suppressed for a frame so the two do not fight.
     *
     * Everything here is a no-op if the shell's sidebar cannot be found, and the
     * listener is non-passive only because a committed horizontal drag must
     * `preventDefault()` (otherwise iOS Safari runs its back-navigation gesture).
     */
    function useEdgeSwipe(active, drawerOpen, toggle) {
      useEffect(() => {
        if (!active) return;
        const root = document.documentElement;
        let drawer = null;
        let startX = 0;
        let startY = 0;
        let delta = 0;
        let phase = "idle"; // idle | tracking | dragging
        let settleTimer;

        const width = () => Math.min(window.innerWidth * 0.86, 320);

        const cleanupDrag = () => {
          root.removeAttribute("data-dshm-dragging");
          root.removeAttribute("data-dshm-settling");
          root.style.removeProperty("--dshm-drag");
          phase = "idle";
          drawer = null;
        };

        const onStart = (event) => {
          if (event.touches.length !== 1 || phase !== "idle") return;
          const touch = event.touches[0];
          // Opening: only from the edge. Closing: anywhere on the open drawer.
          if (!drawerOpen && touch.clientX > EDGE_PX) return;
          drawer = document.querySelector('[class*="_sidebarCol"]');
          if (drawer === null) return;
          startX = touch.clientX;
          startY = touch.clientY;
          delta = 0;
          phase = "tracking";
        };

        const onMove = (event) => {
          if (phase === "idle" || event.touches.length !== 1) return;
          const touch = event.touches[0];
          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;
          if (phase === "tracking") {
            if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
            // A vertical gesture belongs to the conversation, not to this drawer.
            if (Math.abs(dy) > Math.abs(dx)) return cleanupDrag();
            if (dx <= 0 && !drawerOpen) return cleanupDrag();
            phase = "dragging";
            root.setAttribute("data-dshm-dragging", "");
          }
          // The listener is non-passive; without this iOS runs its back gesture.
          event.preventDefault();
          const limit = width();
          delta = drawerOpen
            ? Math.max(-limit, Math.min(0, dx))
            : Math.max(0, Math.min(limit, dx));
          root.style.setProperty("--dshm-drag", `${delta}px`);
        };

        const onEnd = () => {
          if (phase !== "dragging") return cleanupDrag();
          const opens = !drawerOpen && delta >= COMMIT_PX;
          const closes = drawerOpen && delta <= -COMMIT_PX / 2;
          const settleTo = opens ? width() : closes ? -width() : 0;
          // `settling` turns the transform transition back on for the final move.
          root.setAttribute("data-dshm-settling", "");
          root.style.setProperty("--dshm-drag", `${settleTo}px`);
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            if (opens || closes) {
              // Hand over to the host at the exact position the drawer already
              // occupies: suppress its slide-in animation for this commit.
              root.setAttribute("data-dshm-noanim", "");
              toggle();
              setTimeout(() => root.removeAttribute("data-dshm-noanim"), SETTLE_MS * 2);
            }
            cleanupDrag();
          }, SETTLE_MS);
        };

        const onCancel = () => {
          if (phase !== "dragging") return cleanupDrag();
          root.setAttribute("data-dshm-settling", "");
          root.style.setProperty("--dshm-drag", "0px");
          clearTimeout(settleTimer);
          settleTimer = setTimeout(cleanupDrag, SETTLE_MS);
        };

        document.addEventListener("touchstart", onStart, { passive: true });
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onEnd, { passive: true });
        document.addEventListener("touchcancel", onCancel, { passive: true });
        return () => {
          clearTimeout(settleTimer);
          document.removeEventListener("touchstart", onStart);
          document.removeEventListener("touchmove", onMove);
          document.removeEventListener("touchend", onEnd);
          document.removeEventListener("touchcancel", onCancel);
          root.removeAttribute("data-dshm-dragging");
          root.removeAttribute("data-dshm-settling");
          root.removeAttribute("data-dshm-noanim");
          root.style.removeProperty("--dshm-drag");
        };
      }, [active, drawerOpen, toggle]);
    }

    /* ------------------------------------------------------------------ */
    /* standalone-app meta + composer keyboard hints                        */
    /* ------------------------------------------------------------------ */

    /** Meta tags injected while the mobile mode is on, with their prior values. */
    const APP_META = [
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      // Makes the status bar overlay the page instead of shrinking it, which is
      // what the safe-area padding above already accounts for.
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "DSH" },
    ];
    /** Two media-scoped theme colors; the host's own bg tokens, resolved. */
    const THEME_COLORS = [
      { media: "(prefers-color-scheme: dark)", content: "#151517" },
      { media: "(prefers-color-scheme: light)", content: "#ffffff" },
    ];
    const injected = new Map(); // element -> attribute it replaced (undefined when new)

    function injectMeta(spec) {
      const selector = `meta[name="${spec.name}"]${spec.media === undefined ? "" : `[media="${spec.media}"]`}`;
      let element = document.head.querySelector(selector);
      if (element === null) {
        element = document.createElement("meta");
        element.setAttribute("name", spec.name);
        if (spec.media !== undefined) element.setAttribute("media", spec.media);
        document.head.appendChild(element);
        injected.set(element, undefined);
      } else if (!injected.has(element)) {
        injected.set(element, element.getAttribute("content"));
      }
      element.setAttribute("content", spec.content);
    }

    /**
     * Make "Add to Home Screen" launch this as a standalone app rather than as a
     * bookmark with browser chrome. iOS reads these meta tags and ignores the web
     * manifest, so they cannot live in index.html's manifest alone.
     */
    function injectAppMeta() {
      for (const spec of APP_META) injectMeta(spec);
      for (const spec of THEME_COLORS) injectMeta({ name: "theme-color", ...spec });
    }

    function restoreAppMeta() {
      for (const [element, previous] of injected) {
        if (previous === undefined) element.remove();
        else element.setAttribute("content", previous);
      }
      injected.clear();
    }

    /**
     * Keyboard hints on the composer field.
     *
     * `enterkeyhint="send"` is only a label on the return key, but it is the
     * difference between "换行" and a send affordance on a phone keyboard;
     * `autocorrect`/`spellcheck` off stops iOS from "fixing" code and commands,
     * which is most of what this box is used for.
     */
    function applyComposerHints() {
      const fields = document.querySelectorAll("[data-composer-input]");
      for (const field of fields) {
        if (!field.hasAttribute("data-dshm-hinted")) {
          field.setAttribute("data-dshm-hinted", "");
          if (!field.hasAttribute("enterkeyhint")) field.setAttribute("enterkeyhint", "send");
          if (!field.hasAttribute("autocorrect")) field.setAttribute("autocorrect", "off");
          if (!field.hasAttribute("autocapitalize")) field.setAttribute("autocapitalize", "sentences");
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* periodic DOM scan: overflow affordance + composer hints              */
    /* ------------------------------------------------------------------ */

    /**
     * Mark the code blocks and tables that actually scroll sideways, so the
     * stylesheet can fade their right edge (a mask on every `pre` would fade text
     * that fits), and (re)apply the composer's keyboard hints — the field mounts
     * after this plugin activates, and can be replaced on a session switch.
     *
     * Runs on activation, on resize, and after the conversation mutates — a code
     * block that streams in is measured once it has content.
     */
    function useLayoutScan(active) {
      useEffect(() => {
        if (!active) return;
        let timer;
        const scan = () => {
          const nodes = document.querySelectorAll(
            "[data-conversation-content] pre, [data-conversation-content] table",
          );
          for (const node of nodes) {
            if (node.scrollWidth > node.clientWidth + 1) node.setAttribute("data-dshm-scroll-x", "");
            else node.removeAttribute("data-dshm-scroll-x");
          }
          applyComposerHints();
        };
        const schedule = () => {
          clearTimeout(timer);
          timer = setTimeout(scan, 250);
        };
        schedule();
        window.addEventListener("resize", schedule);
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        return () => {
          clearTimeout(timer);
          window.removeEventListener("resize", schedule);
          observer.disconnect();
          for (const node of document.querySelectorAll("[data-dshm-scroll-x]")) {
            node.removeAttribute("data-dshm-scroll-x");
          }
        };
      }, [active]);
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

      useKeyboardInset(active);
      useEdgeSwipe(active, drawerOpen, toggle);
      useLayoutScan(active);

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
  -webkit-text-size-adjust: 100%;
}
/* Font floor only while the measured host value is below it (see applyFontFloor).
   !important is deliberate: the host writes its own value inline. */
html[data-dshm-font-floor] body {
  --dsh-content-font-size: 15px !important;
}
html[data-dsh-mobile] body {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  overscroll-behavior-y: none;
}
html[data-dsh-mobile] #root { height: 100%; }

/* the rail and the right track give their width back to the conversation, and
   the frame shrinks by whatever the software keyboard covers */
html[data-dsh-mobile] [class*="_frame"] {
  grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  height: calc(100vh - var(--dshm-kb, 0px)) !important;
  height: calc(100dvh - var(--dshm-kb, 0px)) !important;
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
/* Right panel (files, preview, terminal, deliverables): the third track is
   zero-width here, and the host panel is absolutely positioned with
   overflow:clip, so a docked panel on a phone can only be clipped. Lift the
   open panel out of the track instead and give it the whole viewport — this is
   the same thing the host's own fullscreen right panel does, without depending
   on that service API. */
html[data-dsh-mobile] [data-rightbar-col] [data-sidebar-right-open] {
  box-sizing: border-box !important;
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  max-width: 100vw !important;
  z-index: 28 !important;
  pointer-events: auto !important;
  background: var(--dsw-alias-bg-base);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  overscroll-behavior: contain;
}
html[data-dsh-mobile] [data-rightbar-col] [data-sidebar-right-open] > * {
  width: 100% !important;
  max-width: 100% !important;
}
/* The collapse control is the only way out of that full-screen layer, so it gets
   a thumb-sized hit area instead of the host's 28px. */
html[data-dsh-mobile] [data-rightbar-col] [data-sidebar-right-toggle] {
  width: 40px !important;
  height: 40px !important;
  padding: 8px !important;
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
  padding-left: env(safe-area-inset-left);
  box-shadow: 0 18px 60px rgb(0 0 0 / 30%);
  animation: dshm-drawer-in 180ms var(--ds-ease-in-out, ease-out);
}
/* Edge-swipe drag (see useEdgeSwipe): the collapsed drawer is display:none, so a
   finger-following drag has to reveal it itself. Placed AFTER the collapsed rule
   so it wins at equal specificity. */
html[data-dshm-dragging] [class*="_frame"][data-sidebar-collapsed] [class*="_sidebarCol"],
html[data-dshm-dragging] [class*="_sidebarCol"] {
  display: flex !important;
  animation: none !important;
  transform: translateX(calc(-100% + var(--dshm-drag, 0px))) !important;
  transition: transform 180ms var(--ds-ease-in-out, ease-out);
}
/* While the drag is live the drawer must track the finger with no easing; the
   transition is only wanted for the settle. */
html[data-dshm-dragging]:not([data-dshm-settling]) [class*="_sidebarCol"] {
  transition: none;
}
/* One commit frame: the host's own slide-in would otherwise replay from -100%. */
html[data-dshm-noanim] [class*="_sidebarCol"] {
  animation: none !important;
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
  padding: calc(env(safe-area-inset-top) + 10px) calc(10px + env(safe-area-inset-right)) 8px calc(56px + env(safe-area-inset-left)) !important;
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
  padding: 12px calc(14px + env(safe-area-inset-right)) 12px calc(14px + env(safe-area-inset-left)) !important;
}
/* Keep the conversation's own scroll chain from reaching the page, which is what
   triggers Android's pull-to-refresh (and iOS's rubber-band on the document). */
html[data-dsh-mobile] [data-conversation-scroll] {
  overscroll-behavior-y: contain;
}
html[data-dsh-mobile] [data-conversation-content] pre {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
}
html[data-dsh-mobile] [data-conversation-content] table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
/* Fade the right edge of a block that actually scrolls sideways. The attribute is
   set by useLayoutScan only when scrollWidth exceeds clientWidth, so text that
   fits is never dimmed. */
html[data-dsh-mobile] [data-dshm-scroll-x] {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent 100%);
  mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent 100%);
}
/* The host lets wide tables bleed past the text column with negative margins
   (the md-table-wide class). On a phone that just overflows the viewport. */
html[data-dsh-mobile] [data-conversation-content] .md-table-wide {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
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
  box-sizing: border-box;
  height: calc(100vh - var(--dshm-kb, 0px)) !important;
  height: calc(100dvh - var(--dshm-kb, 0px)) !important;
  max-height: calc(100vh - var(--dshm-kb, 0px)) !important;
  max-height: calc(100dvh - var(--dshm-kb, 0px)) !important;
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

/* every other modal stays inside the viewport (and above the keyboard) */
html[data-dsh-mobile] [role="dialog"]:not(:has(> nav)) {
  max-width: calc(100vw - 16px) !important;
  max-height: calc(100vh - 24px) !important;
  max-height: calc(100dvh - var(--dshm-kb, 0px) - 24px) !important;
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
          const root = document.documentElement;
          if (isActive()) {
            patchViewportMeta();
            root.setAttribute("data-dsh-mobile", "");
            applyFontFloor();
            injectAppMeta();
            applyComposerHints();
          } else {
            root.removeAttribute("data-dsh-mobile");
            root.removeAttribute("data-dshm-font-floor");
            restoreViewportMeta();
            restoreAppMeta();
          }
        };
        sync();
        const unsubscribe = subscribeMode(sync);
        mql.addEventListener("change", sync);
        return () => {
          unsubscribe();
          mql.removeEventListener("change", sync);
          const root = document.documentElement;
          root.removeAttribute("data-dsh-mobile");
          root.removeAttribute("data-dshm-font-floor");
          restoreViewportMeta();
          restoreAppMeta();
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
