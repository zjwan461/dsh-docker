#!/usr/bin/env node
/**
 * Deployment patch: let the settings UI's DOCUMENT ACTIONS work when the GUI is
 * served from a remote origin (a domain) instead of loopback.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * The client connection defines, in the BROWSER:
 *
 *     // dsh-client-connection/lib/client.browser.js
 *     isLoopback: transport?.ownsHost === true || pageLocation === void 0
 *              || isLoopbackHostname(pageLocation.hostname),
 *
 * and `dsh-client-ui-settings-general` gates a whole controller on it:
 *
 *     const documentController = ctx.remote.$host.isLoopback
 *       ? new SettingsDocumentStore(ctx, ctx.configForms.describe())
 *       : void 0;
 *
 * On a domain-served deployment none of the three conditions is true, so the
 * General page loses the actions that read/import/export the HOST settings
 * document. Patching the DEFINITION fixes every consumer at once, which is why
 * this anchors there instead of on each consumer.
 *
 * ── What changed in 0.2.1-rc.2 (why this script looks different) ────────────
 *
 *   * The browser bundle MOVED. Up to 0.2.0-rc.2 the client half was a single
 *     `lib/client.js`; 0.2.1-rc.2 splits it into `lib/client.browser.js` and
 *     `lib/client.node.js` and publishes them through the `./client` subpath
 *     export. `dsh-client-modules` therefore resolves the served file from
 *     `exports["./client"]` (taking `default`, which points at the browser
 *     half), NOT from a hard-coded `lib/client.js`. This script now reads the
 *     same field, so it follows the package instead of guessing a filename.
 *
 *   * The Models page no longer depends on this flag. The settings pages in
 *     0.2.1-rc.2 read and write the Host document through `remote.settings`
 *     (`settings.describe` / `settings.mutate`), which works on any origin the
 *     trust fence admits. `isLoopback` now only decides the General page's
 *     document controller. The patch is kept because that page is part of the
 *     deployment's feature set, and because the flag is a client-side hint that
 *     costs nothing to make true here.
 *
 *   * The definition itself is byte-identical to 0.2.0-rc.2. That is the whole
 *     reason the anchor is the expression and not a line number: 0.1.5-rc.1 ->
 *     0.2.0-rc.2 -> 0.2.1-rc.2 moved every surrounding line at least once.
 *
 * ── Why a bundle patch and not a source build ───────────────────────────────
 *
 * The browser never receives a prebuilt asset: `dsh-client-modules` reads each
 * plugin's client bundle from disk and serves it under `/plugins/...`, composing
 * a per-revision combo URL. Patching that file IS patching what the browser
 * runs — no monorepo build, no fork, no per-release rebase.
 *
 * ── Why this runs at IMAGE BUILD time ───────────────────────────────────────
 *
 * The file lives in the root-owned npm global installation, while the container
 * runs as the unprivileged DSH_UID, so a runtime write can only ever end in
 * EACCES. Since 0.2.1-rc.2 the profile no longer holds a symlink projection of
 * the installation, so the installation copy is the ONLY copy — there is nothing
 * a runtime patch could redirect to. entrypoint.sh re-runs this script with
 * `--check` on every start and only warns, which covers a plugin package
 * reinstalled after the build.
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
 *   --root    an anchored search root (repeatable). Defaults to the npm
 *             installation tree derived from $DSH_NPM_BIN_DISCOVERY_FILE, the
 *             profile node_modules of $DSH_HOME, and the Node global roots.
 *
 * Exit codes: 0 = patched (or already patched), 1 = nothing found, or the anchor
 * is missing/ambiguous. entrypoint.sh only warns; the container still boots.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

const MARKER = 'PATCHED by dsh-docker';
const PACKAGE = '@deepseek-ai/dsh-client-connection';
/**
 * The client half when the manifest declares no usable `exports["./client"]`.
 * `client.browser.js` is the 0.2.1-rc.2 name; `client.js` is the 0.1.5/0.2.0 one.
 */
const FALLBACK_BUNDLES = [join('lib', 'client.browser.js'), join('lib', 'client.js')];

/**
 * Anchored on the whole ternary rather than on a line number, because line
 * numbers move between releases (0.1.5-rc.1 -> 0.2.1-rc.2 moved every gate) and
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
  // can write there.
  try {
    const bin = readFileSync(process.env.DSH_NPM_BIN_DISCOVERY_FILE ?? '/tmp/dsh-npm-bin.path', 'utf8').trim();
    if (bin !== '') roots.push(join(dirname(dirname(bin)), 'node_modules'));
  } catch { /* no record: fall through to the generic roots */ }
  const home = process.env.DSH_HOME;
  if (home) {
    // Where the deployment links its own bundles (entrypoint.sh) — the only
    // things a 0.2.1 profile keeps in node_modules. Harmless when absent.
    roots.push(join(home, 'profiles', 'node_modules'), join(home, 'profiles'));
  }
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');
}

const log = (...args) => { if (!quiet) console.log('[patch-client-settings]', ...args); };
const found = new Map(); // realpath -> path we will write

/**
 * The browser file a package's `exports["./client"]` names, or undefined.
 *
 * `dsh-client-modules` accepts a string or an object whose `default` is a
 * string, and picks `default` (which is the browser half). A nested condition
 * object is not something upstream ships today, but walking one level down keeps
 * this from silently returning undefined if it ever does.
 */
function clientExportOf(pkgDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  let declared = manifest?.exports?.['./client'];
  for (let depth = 0; depth < 3 && declared !== undefined; depth += 1) {
    if (typeof declared === 'string') return declared;
    if (typeof declared !== 'object' || declared === null) return undefined;
    declared = declared.browser ?? declared.default ?? declared.import ?? declared.node;
  }
  return undefined;
}

/** Record every candidate file under one package directory that exists. */
function considerPackageDir(pkgDir) {
  const declared = clientExportOf(pkgDir);
  const candidates = declared === undefined ? FALLBACK_BUNDLES : [declared, ...FALLBACK_BUNDLES];
  for (const relative of candidates) {
    const candidate = join(pkgDir, relative);
    try {
      if (statSync(candidate).isFile()) found.set(realpathSync(candidate), candidate);
    } catch { /* keep trying */ }
  }
}

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
    // package.json -> its directory; the api entry (lib/index.js) -> the package root
    considerPackageDir(spec.endsWith('package.json') ? dirname(resolved) : dirname(dirname(resolved)));
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
    if (st.isDirectory()) {
      viaWalk(full, depth - 1, seen);
      continue;
    }
    if (!st.isFile()) continue;
    // Only a client half of THIS package: the same file name exists in dozens of
    // plugin packages, so matching on the basename alone would patch the wrong one.
    if (!dirname(full).endsWith(sep + PACKAGE + sep + 'lib')) continue;
    if (entry.name !== 'client.browser.js' && entry.name !== 'client.js') continue;
    found.set(realpathSync(full), full);
  }
}

for (const root of roots) {
  try {
    if (!statSync(root).isDirectory()) continue;
  } catch {
    continue;
  }
  viaResolver(root);
  // The package directory itself may be the root handed in (--root <pkg>).
  considerPackageDir(root);
  viaWalk(root, 8, new Set());
}

if (found.size === 0) {
  console.error('[patch-client-settings] no client bundle found.');
  console.error(`  looked for ${PACKAGE}/{${FALLBACK_BUNDLES.join(', ')}} or its exports["./client"]`);
  for (const r of roots) console.error(`  under ${r}`);
  console.error('The web profile is not installed yet: it arrives with the first profile');
  console.error('composition (dsh web, or --dump-config). Re-run this after that.');
  process.exit(1);
}

let patched = 0;
let already = 0;
const problems = [];
/** Candidates that parse and match the anchor but carry no marker yet. */
const unpatched = [];

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
    unpatched.push(file);
    continue;
  }
  const replacement =
    '$1true /* ' +
    MARKER +
    ': a domain-served GUI is treated as loopback-equivalent for the settings UI document actions. ' +
    'The server still enforces the Host/Origin fence and the launch-token cookie. */$2';
  const next = source.replace(ANCHOR, replacement);

  // Stage NEXT TO the target and rename over it. Two reasons: pnpm hard-links
  // package files out of a content-addressed store, so writing in place would
  // corrupt that shared copy; and /tmp may be unwritable or on another
  // filesystem, which turns a simple replace into an EACCES or EXDEV. Staging in
  // the target's own directory also makes the failure unambiguous — if this
  // cannot write, the PACKAGE directory is what the current uid lacks permission
  // for, and the message says so instead of blaming the patch.
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
 * dsh-client-modules concatenates these bundles and serves them as classic
 * scripts, so vm.Script is the honest parser — and doing it here avoids two
 * traps that `node --check` walks into: it refuses a file whose extension it
 * does not recognise, and it picks its module system from the nearest
 * package.json, which is not what decides how the browser treats the file.
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
  console.error(`The upstream bundle changed. Find the new form with:`);
  console.error(`  grep -n 'isLoopback' ${[...found.values()].join(' ')}`);
  console.error('then update ANCHOR in this script. Do not fall back to a line number.');
  process.exit(1);
}

if (checkOnly && unpatched.length > 0) {
  // Distinct from an anchor failure on purpose: this is the normal state of a
  // freshly installed tree, and the fix is to run the build, not to edit ANCHOR.
  console.error('[patch-client-settings] NOT PATCHED:');
  for (const file of unpatched) console.error(`  ${file}`);
  console.error('The bundle matches the anchor but carries no marker, so this tree is unpatched.');
  console.error('Apply it (needs write access to the npm installation), then re-check:');
  console.error('  node patch-client-settings.mjs');
  process.exit(1);
}

if (checkOnly) log(`verified: ${already} bundle(s) carry the patch`);
else log(`done: ${patched} patched, ${already} already patched, ${found.size} bundle(s) inspected`);
process.exit(0);
