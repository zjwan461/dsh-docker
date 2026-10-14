/**
 * Login gate — Host half.
 *
 * Publishes this row's `config` as one boot-time global (`webserver/index-inject`,
 * kind `global`) so the Client half renders the credential + captcha gate with the
 * values a user changes in `cordis.patch.yml`, instead of a hard-coded client
 * constant.
 *
 * The credential comparison itself runs in the browser. This is a UI gate in front
 * of the locally served Harness page, not an authentication boundary for the
 * Harness HTTP API: anything that can reach that API directly bypasses it.
 */

/** Fallback options, used for every field the row config omits. */
const DEFAULTS = {
  username: 'admin',
  password: 'dsh-admin',
  captchaLength: 4,
  title: 'DeepSeek Harness',
  rememberDays: 7,
};

/** Global name the Client half reads at boot. */
const OPTIONS_GLOBAL = '__DSH_LOGIN_GATE__';

/** The index row table only exists where the browser carrier is composed. */
export const inject = ['webServer'];

/**
 * Normalize one raw config value into the exact option shape the gate renders.
 * @param config - the row's `config` mapping from `cordis.patch.yml`.
 * @returns the options published as the boot global.
 */
function normalizeOptions(config) {
  const source = config !== null && typeof config === 'object' ? config : {};
  const pickText = (key, fallback) => (typeof source[key] === 'string' && source[key] !== '' ? source[key] : fallback);
  const pickCount = (key, fallback, min, max) => {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  return {
    username: pickText('username', DEFAULTS.username),
    // An explicitly empty password stays empty: that is the user's own choice.
    password: typeof source.password === 'string' ? source.password : DEFAULTS.password,
    captchaLength: pickCount('captchaLength', DEFAULTS.captchaLength, 3, 6),
    title: pickText('title', DEFAULTS.title),
    rememberDays: pickCount('rememberDays', DEFAULTS.rememberDays, 0, 365),
  };
}

/**
 * Contribute the gate options to every rendered index page.
 * @param ctx - Host plugin context carrying the web carrier.
 * @param config - this row's config, already normalized by the loader when the row declares one.
 */
export function apply(ctx, config) {
  const options = normalizeOptions(config);
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: OPTIONS_GLOBAL, value: options });
  });
}
