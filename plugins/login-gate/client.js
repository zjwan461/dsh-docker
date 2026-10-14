/**
 * Login gate — Client half.
 *
 * Two surfaces, one plugin:
 *   - `shell.overlay` — the opaque, full-viewport gate that asks for account,
 *     password, and a graphic digit captcha before the Harness UI behind it is
 *     visible or clickable;
 *   - `sidebar.footer.action` — the sign-out action beside Settings at the sidebar
 *     foot, which drops the unlock markers and brings the gate back.
 *
 * Styling copies the shipped primitives (`Button.module.css`, `Modal.module.css`,
 * `settings-form/fields.module.css`, `Checkbox.module.css`) and reaches the theme
 * only through `--dsw-*` tokens. Note that the brand color is monochrome, so a
 * filled control uses `--dsw-alias-button-primary-fill` with
 * `--dsw-alias-label-primary-foreground`, never the brand color plus fixed white.
 *
 * The options come from the Host half (boot global `__DSH_LOGIN_GATE__`); the
 * built-in fallbacks keep the gate working if that row is inactive. Slot props come
 * from the slot contract: `t` is the locale-bound translator for this plugin's
 * namespace, `wide` is the sidebar column state, and `options`/`gate` are this
 * plugin's own registration `inject`.
 *
 * Verification is a browser-side comparison. It gates this page, not the Harness
 * HTTP API, which a client that skips the page can still call.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-login-gate',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace this plugin owns. */
    const NS = 'loginGate';
    /** Boot global the Host half publishes. */
    const OPTIONS_GLOBAL = '__DSH_LOGIN_GATE__';
    /** Per-tab unlock marker: one signed-in tab, a new tab asks again. */
    const SESSION_KEY = 'dsh:login-gate:tab';
    /** Optional durable unlock marker, holding its expiry in epoch milliseconds. */
    const REMEMBER_KEY = 'dsh:login-gate:remember';
    const DAY_MS = 86400000;

    /** Fallbacks, matching the Host half's own defaults. */
    const FALLBACK_OPTIONS = {
      username: 'admin',
      password: 'dsh-admin',
      captchaLength: 4,
      title: 'DeepSeek Harness',
      rememberDays: 7,
    };

    const DICTIONARIES = {
      zh: {
        'subtitle': '请先登录后继续',
        'username': '账号',
        'usernamePlaceholder': '请输入账号',
        'password': '密码',
        'passwordPlaceholder': '请输入密码',
        'captcha': '验证码',
        'captchaPlaceholder': '请输入图中的数字',
        'captchaAlt': '图形数字验证码，看不清楚可以点击更换',
        'refresh': '换一张',
        'submit': '登录',
        'remember': '记住我 {days} 天',
        'signOut': '登出',
        'errorEmpty': '请填写账号、密码和验证码',
        'errorCaptcha': '验证码不正确，已换一张，请重新输入',
        'errorCredentials': '账号或密码不正确',
        'footer': '校验通过后才能进入控制台',
      },
      en: {
        'subtitle': 'Sign in to continue',
        'username': 'Account',
        'usernamePlaceholder': 'Enter your account',
        'password': 'Password',
        'passwordPlaceholder': 'Enter your password',
        'captcha': 'Verification code',
        'captchaPlaceholder': 'Enter the digits shown',
        'captchaAlt': 'Graphic digit verification code; click to replace it',
        'refresh': 'New code',
        'submit': 'Sign in',
        'remember': 'Remember me for {days} days',
        'signOut': 'Sign out',
        'errorEmpty': 'Enter the account, the password, and the code',
        'errorCaptcha': 'Wrong code — a new one is shown, enter it again',
        'errorCredentials': 'Wrong account or password',
        'footer': 'The console opens only after this check passes',
      },
    };

    const FOCUS_BORDER = { borderColor: 'var(--dsw-alias-state-business-primary)' };

    const STYLES = {
      // Modal geometry from the shipped Modal.module.css: fixed layer, 24px air.
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(24px, var(--dsh-frame-overlay-top, 24px)) 24px',
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        background: 'var(--dsw-alias-bg-base, #101418)',
        color: 'var(--dsw-alias-label-primary)',
        font: '400 14px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      },
      card: {
        width: 'min(380px, 100%)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '22px 24px 24px',
        borderRadius: 'var(--dsw-radius-panel, 16px)',
        background: 'var(--dsw-alias-bg-layer-2)',
        boxShadow: 'var(--dsw-elevation-prominent, 0 18px 50px rgba(0, 0, 0, 0.3))',
      },
      header: { display: 'flex', flexDirection: 'column', gap: '4px' },
      title: { margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      subtitle: { margin: 0, fontSize: '14px', lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' },
      field: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '13px', fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
      input: {
        height: '34px',
        boxSizing: 'border-box',
        padding: '0 12px',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        borderRadius: 'var(--dsw-radius-md, 12px)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      captchaRow: { display: 'flex', alignItems: 'center', gap: '8px' },
      canvas: {
        display: 'block',
        flex: 'none',
        borderRadius: 'var(--dsw-radius-md, 12px)',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      ghost: {
        height: '28px',
        padding: '0 10px',
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        cursor: 'pointer',
      },
      ghostHover: { background: 'var(--dsw-alias-interactive-bg-hover)' },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)' },
      submit: {
        width: '100%',
        height: '36px',
        marginTop: '6px',
        padding: '0 14px',
        border: 'none',
        borderRadius: 'var(--dsw-radius-md, 12px)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '14px',
        lineHeight: '22px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        background: 'var(--dsw-alias-button-primary-fill, #0f1115)',
      },
      submitHover: { background: 'var(--dsw-alias-button-primary-hover, #1f2023)' },
      rememberRow: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '14px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      rememberBox: { width: '16px', height: '16px', margin: 0, flex: '0 0 auto', accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'inherit' },
      footer: { margin: 0, fontSize: '12px', lineHeight: 1.5, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)' },
      // Sidebar-footer geometry copied from the shipped action in the same seat.
      actionLayer: { display: 'flex', alignItems: 'center', flex: 'none', width: '100%', height: '42px', margin: '8px 0 0' },
      actionLayerRail: { display: 'flex', alignItems: 'center', flex: 'none', width: '36px', height: '36px', margin: 0 },
      actionLabel: { textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden' },
    };

    /**
     * Read the Host-published options, clamped to what the form can render.
     * @returns the option set this gate renders with.
     */
    function readOptions() {
      const injected = globalThis[OPTIONS_GLOBAL];
      const source = injected !== null && typeof injected === 'object' ? injected : {};
      const options = Object.assign({}, FALLBACK_OPTIONS, source);
      const length = Number(options.captchaLength);
      options.captchaLength = Number.isFinite(length) ? Math.min(6, Math.max(3, Math.round(length))) : FALLBACK_OPTIONS.captchaLength;
      const days = Number(options.rememberDays);
      options.rememberDays = Number.isFinite(days) && days > 0 ? Math.round(days) : 0;
      if (typeof options.username !== 'string') options.username = FALLBACK_OPTIONS.username;
      if (typeof options.password !== 'string') options.password = FALLBACK_OPTIONS.password;
      if (typeof options.title !== 'string' || options.title === '') options.title = FALLBACK_OPTIONS.title;
      return options;
    }

    /**
     * Whether this tab already passed the gate.
     * @returns true when the tab marker or a live remember marker is present.
     */
    function readUnlocked() {
      try {
        if (sessionStorage.getItem(SESSION_KEY) === 'unlocked') return true;
        const expires = Number(localStorage.getItem(REMEMBER_KEY));
        return Number.isFinite(expires) && expires > Date.now();
      } catch (error) {
        // Storage blocked (private mode, policy): the gate stays for this page.
        return false;
      }
    }

    /**
     * Record a successful check.
     * @param options - the gate options, for the remember window.
     * @param remember - whether the user asked to stay signed in.
     */
    function markUnlocked(options, remember) {
      try {
        sessionStorage.setItem(SESSION_KEY, 'unlocked');
        if (remember && options.rememberDays > 0) {
          localStorage.setItem(REMEMBER_KEY, String(Date.now() + options.rememberDays * DAY_MS));
        }
      } catch (error) {
        // A blocked write only costs the convenience marker; the session stays unlocked.
      }
    }

    /** Drop every unlock marker, so the gate comes back. */
    function clearUnlocked() {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch (error) {
        // Nothing to clear when storage is blocked.
      }
      try {
        localStorage.removeItem(REMEMBER_KEY);
      } catch (error) {
        // Nothing to clear when storage is blocked.
      }
    }

    /**
     * The one unlock state both surfaces read: the gate renders from it and the
     * sign-out action writes it.
     * @param initial - whether the tab starts unlocked.
     * @returns a minimal external store shaped for `React.useSyncExternalStore`.
     */
    function createGateState(initial) {
      let unlocked = initial;
      const listeners = new Set();
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        get() {
          return unlocked;
        },
        set(next) {
          if (unlocked === next) return;
          unlocked = next;
          for (const listener of [...listeners]) listener();
        },
      };
    }

    /**
     * One random digit string.
     * @param length - digit count.
     * @returns the code the user must retype.
     */
    function createCode(length) {
      let code = '';
      for (let index = 0; index < length; index += 1) code += String(Math.floor(Math.random() * 10));
      return code;
    }

    /** Keep a computed color only when the canvas can consume it. */
    function usableColor(value, fallback) {
      const text = typeof value === 'string' ? value.trim() : '';
      return /^(#|rgba?\(|hsla?\(|color\(|oklch\(|lab\(|lch\()/i.test(text) ? text : fallback;
    }

    /**
     * Paint the captcha into a transparent bitmap: the element's own themed
     * background stays visible, and every digit carries a halo in the resolved
     * label color so it reads on a light or a dark surface.
     * @param canvas - the target canvas element.
     * @param code - digits to draw.
     */
    function drawCaptcha(canvas, code) {
      const width = 132;
      const height = 44;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const painter = canvas.getContext('2d');
      if (!painter) return;
      painter.setTransform(ratio, 0, 0, ratio, 0, 0);
      painter.clearRect(0, 0, width, height);
      // `color` is a real property, so this resolves the token to a usable rgb().
      const ink = usableColor(getComputedStyle(canvas).color, '#9aa0a6');
      const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6'];

      painter.globalAlpha = 0.35;
      painter.strokeStyle = ink;
      for (let index = 0; index < 3; index += 1) {
        painter.beginPath();
        painter.lineWidth = 1;
        let x = 0;
        let y = 8 + Math.random() * (height - 16);
        painter.moveTo(x, y);
        while (x < width) {
          x += 8 + Math.random() * 12;
          y += (Math.random() - 0.5) * 14;
          painter.lineTo(x, y);
        }
        painter.stroke();
      }
      painter.fillStyle = ink;
      for (let index = 0; index < 46; index += 1) {
        painter.globalAlpha = 0.15 + Math.random() * 0.25;
        painter.beginPath();
        painter.arc(Math.random() * width, Math.random() * height, 0.6 + Math.random() * 1.4, 0, Math.PI * 2);
        painter.fill();
      }
      painter.globalAlpha = 1;

      const step = width / (code.length + 1);
      painter.textAlign = 'center';
      painter.textBaseline = 'middle';
      painter.lineWidth = 3;
      painter.lineJoin = 'round';
      painter.strokeStyle = ink;
      for (let index = 0; index < code.length; index += 1) {
        painter.save();
        painter.translate(step * (index + 1), height / 2 + 2);
        painter.rotate((Math.random() - 0.5) * 0.5);
        painter.font = `bold ${24 + Math.round(Math.random() * 4)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
        painter.strokeText(code[index], 0, 0);
        painter.fillStyle = palette[index % palette.length];
        painter.fillText(code[index], 0, 0);
        painter.restore();
      }
    }

    /** The drawn captcha plus its replace control. */
    function CaptchaImage(props) {
      const canvasRef = React.useRef(null);
      const [hover, setHover] = React.useState(false);
      React.useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) drawCaptcha(canvas, props.code);
      }, [props.code]);
      return h(
        'div',
        { style: STYLES.captchaRow },
        h('canvas', {
          ref: canvasRef,
          role: 'img',
          'aria-label': props.alt,
          title: props.alt,
          onClick: props.onRefresh,
          style: STYLES.canvas,
        }),
        h(
          'button',
          {
            type: 'button',
            onClick: props.onRefresh,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            style: hover ? Object.assign({}, STYLES.ghost, STYLES.ghostHover) : STYLES.ghost,
          },
          props.refreshLabel,
        ),
      );
    }

    /**
     * The form itself. It mounts only while the tab is locked, so signing out hands
     * the next visitor empty fields and a freshly drawn captcha for free.
     * @param props - slot kit (`t`) plus this entry's `inject` (`options`, `gate`).
     */
    function LoginForm(props) {
      const t = props.t;
      const options = props.options;
      const gate = props.gate;
      const [account, setAccount] = React.useState('');
      const [secret, setSecret] = React.useState('');
      const [typed, setTyped] = React.useState('');
      const [code, setCode] = React.useState(() => createCode(options.captchaLength));
      const [remember, setRemember] = React.useState(false);
      const [error, setError] = React.useState('');
      const [focused, setFocused] = React.useState('');
      const [submitHover, setSubmitHover] = React.useState(false);
      const panelRef = React.useRef(null);
      const accountRef = React.useRef(null);
      const codeRef = React.useRef(null);

      const replaceCode = React.useCallback(() => {
        setCode(createCode(options.captchaLength));
        setTyped('');
        const field = codeRef.current;
        if (field) field.focus();
      }, [options.captchaLength]);

      React.useEffect(() => {
        const field = accountRef.current;
        if (field) field.focus();
      }, []);

      React.useEffect(() => {
        // The app is still mounted behind an opaque panel: keep its window-level
        // shortcuts from answering keys the gate does not own.
        const onKeyDown = (event) => {
          const panel = panelRef.current;
          const target = event.target;
          if (panel && target instanceof Node && !panel.contains(target)) event.stopPropagation();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, []);

      const fieldStyle = (name) => (focused === name ? Object.assign({}, STYLES.input, FOCUS_BORDER) : STYLES.input);
      const submitStyle = submitHover ? Object.assign({}, STYLES.submit, STYLES.submitHover) : STYLES.submit;

      const submit = (event) => {
        event.preventDefault();
        const name = account.trim();
        if (name === '' || secret === '' || typed.trim() === '') {
          setError(t('errorEmpty'));
          return;
        }
        if (typed.trim() !== code) {
          setError(t('errorCaptcha'));
          replaceCode();
          return;
        }
        if (name !== options.username || secret !== options.password) {
          setError(t('errorCredentials'));
          setSecret('');
          replaceCode();
          return;
        }
        setError('');
        markUnlocked(options, remember);
        gate.set(true);
      };

      return h(
        'div',
        {
          ref: panelRef,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': options.title,
          style: STYLES.backdrop,
        },
        h(
          'form',
          { onSubmit: submit, noValidate: true, style: STYLES.card },
          h(
            'div',
            { style: STYLES.header },
            h('h1', { style: STYLES.title }, options.title),
            h('p', { style: STYLES.subtitle }, t('subtitle')),
          ),
          h(
            'div',
            { style: STYLES.field },
            h('label', { style: STYLES.label, htmlFor: 'dsh-login-account' }, t('username')),
            h('input', {
              id: 'dsh-login-account',
              ref: accountRef,
              type: 'text',
              value: account,
              autoComplete: 'username',
              spellCheck: false,
              placeholder: t('usernamePlaceholder'),
              onChange: (event) => setAccount(event.target.value),
              onFocus: () => setFocused('account'),
              onBlur: () => setFocused(''),
              style: fieldStyle('account'),
            }),
          ),
          h(
            'div',
            { style: STYLES.field },
            h('label', { style: STYLES.label, htmlFor: 'dsh-login-secret' }, t('password')),
            h('input', {
              id: 'dsh-login-secret',
              type: 'password',
              value: secret,
              autoComplete: 'current-password',
              placeholder: t('passwordPlaceholder'),
              onChange: (event) => setSecret(event.target.value),
              onFocus: () => setFocused('secret'),
              onBlur: () => setFocused(''),
              style: fieldStyle('secret'),
            }),
          ),
          h(
            'div',
            { style: STYLES.field },
            h('label', { style: STYLES.label, htmlFor: 'dsh-login-code' }, t('captcha')),
            h(CaptchaImage, {
              code,
              alt: t('captchaAlt'),
              refreshLabel: t('refresh'),
              onRefresh: replaceCode,
            }),
            h('input', {
              id: 'dsh-login-code',
              ref: codeRef,
              type: 'text',
              value: typed,
              inputMode: 'numeric',
              autoComplete: 'off',
              maxLength: options.captchaLength,
              placeholder: t('captchaPlaceholder'),
              onChange: (event) => setTyped(event.target.value),
              onFocus: () => setFocused('code'),
              onBlur: () => setFocused(''),
              style: fieldStyle('code'),
            }),
          ),
          error === '' ? null : h('p', { role: 'alert', style: STYLES.error }, error),
          options.rememberDays > 0
            ? h(
                'label',
                { style: STYLES.rememberRow, htmlFor: 'dsh-login-remember' },
                h('input', {
                  id: 'dsh-login-remember',
                  type: 'checkbox',
                  checked: remember,
                  onChange: (event) => setRemember(event.target.checked),
                  style: STYLES.rememberBox,
                }),
                t('remember', { days: options.rememberDays }),
              )
            : null,
          h(
            'button',
            {
              type: 'submit',
              onMouseEnter: () => setSubmitHover(true),
              onMouseLeave: () => setSubmitHover(false),
              style: submitStyle,
            },
            t('submit'),
          ),
          h('p', { style: STYLES.footer }, t('footer')),
        ),
      );
    }

    /**
     * The gate's outer half: it renders the form only while the tab is locked.
     * @param props - slot kit plus this entry's `inject`.
     */
    function LoginGate(props) {
      const unlocked = React.useSyncExternalStore(props.gate.subscribe, props.gate.get, props.gate.get);
      if (unlocked) return null;
      return h(LoginForm, props);
    }

    /** The sign-out glyph: an arrow leaving a doorway. */
    function SignOutIcon(props) {
      const size = props.size;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
          style: { flex: 'none', display: 'block' },
        },
        h('path', {
          d: 'M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M10.5 5.25 13.25 8l-2.75 2.75',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M13.25 8H6.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      );
    }

    /**
     * The sign-out action beside Settings: wide in the expanded column, round and
     * icon-only in the rail. It renders nothing while the gate is up.
     * @param props - owner share (`wide`) plus this entry's `inject` (`gate`) and `t`.
     */
    function SignOutAction(props) {
      const t = props.t;
      const gate = props.gate;
      const unlocked = React.useSyncExternalStore(gate.subscribe, gate.get, gate.get);
      const [hover, setHover] = React.useState(false);
      if (!unlocked) return null;
      const wide = props.wide !== false;
      const button = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: wide ? '8px' : 0,
        justifyContent: wide ? 'flex-start' : 'center',
        width: wide ? 'calc(100% + 4px)' : '36px',
        height: wide ? '42px' : '36px',
        margin: wide ? '0 -2px' : 0,
        padding: wide ? '0 10px 0 8px' : 0,
        borderRadius: wide ? 'var(--dsw-radius-sm, 12px)' : '50%',
        border: 'none',
        overflow: 'hidden',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '14px',
        color: 'var(--dsw-alias-label-primary)',
        background: hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
      };
      return h(
        'div',
        { style: wide ? STYLES.actionLayer : STYLES.actionLayerRail },
        h(
          'button',
          {
            type: 'button',
            title: t('signOut'),
            'aria-label': t('signOut'),
            onClick: () => {
              clearUnlocked();
              gate.set(false);
            },
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            onFocus: () => setHover(true),
            onBlur: () => setHover(false),
            style: button,
          },
          h(SignOutIcon, { size: wide ? 16 : 18 }),
          wide ? h('span', { style: STYLES.actionLabel }, t('signOut')) : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, 'zh', DICTIONARIES.zh),
            ctx.locale.register(NS, 'en', DICTIONARIES.en),
          ];
          return () => {
            for (const dispose of disposers) dispose();
          };
        }, 'login-gate: locale dictionaries');
        const options = readOptions();
        const gate = createGateState(readUnlocked());
        const translate = ctx.locale.bind(NS);
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-login-gate',
              order: 1000,
              label: options.title,
              locale: NS,
              inject: () => ({ options, gate }),
            },
            LoginGate,
          ),
        );
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'dsh-login-gate.sign-out',
              order: 10,
              label: () => translate('signOut'),
              locale: NS,
              inject: () => ({ gate }),
            },
            SignOutAction,
          ),
        );
      },
    };
  },
});
