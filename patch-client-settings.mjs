#!/usr/bin/env node
/**
 * Deployment patch: let the settings UI work when the GUI is served from a
 * remote origin (a domain) instead of loopback.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * dsh decides where the settings document lives, in the BROWSER:
 *
 *     // dsh-client-ui-settings/lib/client.js
 *     const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
 *
 * and `$host.isLoopback` comes from the connection's own definition:
 *
 *     // dsh-client-connection/lib/client.js
 *     isLoopback: transport?.ownsHost === true
 *              || pageLocation === void 0
 *              || isLoopbackHostname(pageLocation.hostname),
 *
 * On a domain-served deployment none of those three is true, so persistence is
 * "memory": the Models page then reports
 *
 *     Loading the provider directory failed: settings are available in this browser
 *
 * because it reads a session-local document instead of $DSH_HOME/settings.yaml.
 * A second, independent gate sits in `dsh-client-ui-settings-general`, and both
 * read `$host.isLoopback` — so patching the DEFINITION fixes every consumer at
 * once. That matters: the consumer in `-general` changed its surrounding code
 * between 0.1.5-rc.1 and 0.2.0-rc.2, while the definition was byte-identical.
 *
 * ── Why a bundle patch and not a source build ───────────────────────────────
 *
 * The browser never receives a prebuilt asset: `dsh-client-modules` reads each
 * plugin's `lib/client.js` from disk and serves it as `plugins/<id>/client.js`.
 * Patching that file IS patching what the browser runs — no monorepo build, no
 * fork, no per-release rebase.
 *
 * ── Why this runs at CONTAINER START, not at image build ────────────────────
 *
 * The client packages are NOT dependencies of the npm CLI. They arrive with the
 * `web` PROFILE, which dsh installs with pnpm into `$DSH_HOME/profiles/` on first
 * composition. At image build time $DSH_HOME is empty or a throwaway, so there is
 * nothing to patch yet — the entrypoint applies this AFTER it has composed the
 * profile, which is also why it must be idempotent and cheap to re-run.
 *
 * ── Why patching this flag is not a security regression ─────────────────────
 *
 * `isLoopback` is a client-side hint, not a fence: the server independently
 * enforces the Host/Origin trust boundary and the launch-token cookie. The flag
 * only chooses which document the page edits. An attacker who can already reach
 * these routes with a valid cookie can drive the agent inside the container,
 * which is strictly worse than reading the settings document.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *
 *   node patch-client-settings.mjs [--check] [--root <dir>]... [--quiet]
 *
 *   --check   verify only; never write. Exit 0 when patched, 1 when not.
 *   --root    an anchored search root (repeatable). Defaults to the profile
 *             node_modules of $DSH_HOME plus the Node global module roots.
 *
 * Exit codes: 0 = patched (or already patched), 1 = nothing found, or the anchor
 * is missing/ambiguous. entrypoint.sh only warns; the container still boots.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

const MARKER = 'PATCHED by dsh-docker';
const PACKAGE = '@deepseek-ai/dsh-client-connection';
/** Path under the package root. */
const RELATIVE = join('lib', 'client.js');

/**
 * Anchored on the whole ternary rather than on a line number, because line
 * numbers move between releases (0.1.5-rc.1 -> 0.2.0-rc.2 moved every gate) and
 * a stale line number would silently patch the wrong thing.
 */
const ANCHOR = /(isLoopback:\s*)transport\?\.ownsHost === true \|\| pageLocation === void 0 \|\| isLoopbackHostname\(pageLocation\.hostname\)(,)/g;

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const quiet = argv.includes('--quiet');
const roots = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') {
    if (!argv[i + 1]) { console.error('[patch-client-settings] --root needs a directory'); process.exit(1); }
    roots.push(argv[i + 1]);
    i += 1;
  }
}
if (roots.length === 0) {
  // The npm CLI's own dependency tree, derived from the path the build recorded.
  // In a global install this is where the client packages actually live — nested
  // beside the CLI — and it is root-owned: only the image build, running as root,
  // can write there. A container running as the unprivileged DSH_UID can only read
  // it, so a runtime patch attempt can only ever fail with EACCES.
  try {
    const bin = readFileSync(process.env.DSH_NPM_BIN_DISCOVERY_FILE ?? '/tmp/dsh-npm-bin.path', 'utf8').trim();
    if (bin !== '') roots.push(join(dirname(dirname(bin)), 'node_modules'));
  } catch { /* no record: fall through to the generic roots */ }
  const home = process.env.DSH_HOME;
  if (home) {
    // Where the web profile projects its plugins — symlinks into the tree above,
    // so patching the installation copy is what the browser ends up loading.
    roots.push(join(home, 'profiles', 'node_modules'), join(home, 'profiles'));
  }
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');
}

const log = (...args) => { if (!quiet) console.log('[patch-client-settings]', ...args); };
const found = new Map(); // realpath -> path we will write

/**
 * Route 1: let Node resolve the package. This follows pnpm's symlinks and
 * honours package exports, which a directory walk cannot do reliably.
 */
function viaResolver(root) {
  let req;
  try {
    req = createRequire(join(root, '_dsh_patch_resolve_.cjs'));
  } catch {
    return;
  }
  for (const spec of [`${PACKAGE}/package.json`, PACKAGE]) {
    let resolved;
    try {
      resolved = req.resolve(spec);
    } catch {
      continue;
    }
    // package.json -> <pkg>/lib/client.js ; api entry (lib/index.js) -> sibling
    const candidate = spec.endsWith('package.json')
      ? join(dirname(resolved), RELATIVE)
      : join(dirname(resolved), 'client.js');
    try {
      if (statSync(candidate).isFile()) found.set(realpathSync(candidate), candidate);
    } catch { /* keep trying */ }
  }
}

/**
 * Route 2: a walk that FOLLOWS symlinks. pnpm wires node_modules with symlinks,
 * so a Dirent-based walk (isDirectory()/isFile() are false for links) sees
 * nothing at all — which is exactly the bug this route exists to avoid.
 */
function viaWalk(dir, depth, seen) {
  if (depth < 0) return;
  let real;
  try {
    real = realpathSync(dir);
  } catch {
    return;
  }
  if (seen.has(real)) return;
  seen.add(real);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    let st;
    try {
      st = statSync(full); // follows symlinks
    } catch {
      continue;
    }
    if (st.isDirectory()) viaWalk(full, depth - 1, seen);
    else if (st.isFile() && full.endsWith(join(PACKAGE, RELATIVE))) found.set(realpathSync(full), full);
  }
}

for (const root of roots) {
  try {
    if (!statSync(root).isDirectory()) continue;
  } catch {
    continue;
  }
  viaResolver(root);
  viaWalk(root, 8, new Set());
}

if (found.size === 0) {
  console.error('[patch-client-settings] no client bundle found.');
  console.error(`  looked for .../${join(PACKAGE, RELATIVE)}`);
  for (const r of roots) console.error(`  under ${r}`);
  console.error('The web profile is not installed yet: it arrives with the first profile');
  console.error('composition (dsh web, or --dump-config). Re-run this after that.');
  process.exit(1);
}

let patched = 0;
let already = 0;
const problems = [];

for (const file of found.values()) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    problems.push(`${file}: cannot read (${error.code ?? error.message})`);
    continue;
  }
  if (source.includes(MARKER)) {
    already += 1;
    log(`already patched: ${file}`);
    continue;
  }
  const matches = source.match(ANCHOR);
  if (matches === null) {
    problems.push(`${file}: the isLoopback definition did not match the anchor`);
    continue;
  }
  if (matches.length !== 1) {
    problems.push(`${file}: the anchor matched ${matches.length} times, expected exactly 1`);
    continue;
  }
  if (checkOnly) {
    problems.push(`${file}: not patched`);
    continue;
  }
  const replacement =
    '$1true /* ' +
    MARKER +
    ': a domain-served GUI is treated as loopback-equivalent for the settings UI. ' +
    'The server still enforces the Host/Origin fence and the launch-token cookie. */$2';
  const next = source.replace(ANCHOR, replacement);

  // Stage NEXT TO the target and rename over it. Two reasons: pnpm hard-links
  // package files out of a content-addressed store, so writing in place would
  // corrupt that shared copy; and /tmp may be unwritable or on another
  // filesystem, which turns a simple replace into an EACCES or EXDEV. Staging in
  // the target's own directory also makes the failure unambiguous — if this
  // cannot write, the PACKAGE directory is what the current uid lacks permission
  // for, and the message says so instead of blaming the patch.
  //
  // The staged name keeps a .js extension for the sake of tooling that cares; the
  // syntax gate below no longer depends on it.
  const staged = join(dirname(file), `.dsh-client-patch-${process.pid}.js`);
  try {
    writeFileSync(staged, next);
  } catch (error) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
    problems.push(`${file}: cannot stage a file in ${dirname(file)} (${error.code ?? error.message}) — that directory is not writable by uid ${uid}`);
    continue;
  }
  const parsed = syntaxCheck(next);
  if (parsed !== true) {
    problems.push(`${file}: the patched bundle does not parse (${parsed}); left untouched`);
    try { unlinkSync(staged); } catch { /* nothing to clean */ }
    continue;
  }
  try {
    renameSync(staged, file);
  } catch (error) {
    problems.push(`${file}: cannot replace the target (${error.code ?? error.message})`);
    try { unlinkSync(staged); } catch { /* nothing to clean */ }
    continue;
  }
  patched += 1;
  log(`patched: ${file}`);
}

/**
 * Parse the patched source the way the BROWSER will, in-process.
 *
 * dsh-client-modules loads these bundles as classic scripts, so vm.Script is the
 * honest parser — and doing it here avoids two traps that `node --check` walks
 * into: it refuses a file whose extension it does not recognise (an earlier
 * version staged the file as ".tmp" and this gate then failed on every run), and
 * it picks its module system from the nearest package.json, which is not what
 * decides how the browser treats the file.
 *
 * Returns true when it parses, otherwise the first line of the parse error.
 */
function syntaxCheck(source) {
  try {
    new Script(source, { filename: 'client.js' });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n')[0];
  }
}

if (problems.length > 0) {
  console.error('[patch-client-settings] FAILED:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  console.error('The upstream bundle changed. Find the new form with:');
  console.error(`  grep -n 'isLoopback' ${[...found.values()].join(' ')}`);
  console.error('then update ANCHOR in this script. Do not fall back to a line number.');
  process.exit(1);
}

if (checkOnly) log(`verified: ${already} bundle(s) carry the patch`);
else log(`done: ${patched} patched, ${already} already patched, ${found.size} bundle(s) inspected`);
process.exit(0);
