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
 * because it is reading a session-local document instead of $DSH_HOME/settings.yaml.
 * A second, independent gate sits in `dsh-client-ui-settings-general`, and both
 * read `$host.isLoopback` — so patching the DEFINITION fixes every consumer at
 * once. That matters: the consumer copy in `-general` changed its surrounding
 * code between 0.1.5-rc.1 and 0.2.0-rc.2, while the definition was byte-identical.
 *
 * ── Why this is a bundle patch and not a source build ───────────────────────
 *
 * The browser never receives a prebuilt asset: `dsh-client-modules` reads each
 * plugin's `lib/client.js` from disk and serves it as `plugins/<id>/client.js`.
 * Patching that file IS patching what the browser runs — no monorepo build, no
 * fork, no per-release rebase.
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
 *   --root    directory to search (repeatable). Defaults to the Node global
 *             module roots, which is where the image installs dsh.
 *
 * Exit codes: 0 = patched (or already patched), 1 = anchor missing/ambiguous or
 * (with --check) not patched. The caller decides whether that is fatal: the
 * Dockerfile treats it as fatal, entrypoint.sh only warns.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const MARKER = 'PATCHED by dsh-docker';
/** The bundle that carries the definition. Only this file is ever touched. */
const TARGET_SUFFIX = join('@deepseek-ai', 'dsh-client-connection', 'lib', 'client.js');

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
    const value = argv[i + 1];
    if (!value) {
      console.error('[patch-client-settings] --root needs a directory');
      process.exit(1);
    }
    roots.push(value);
    i += 1;
  }
}
if (roots.length === 0) {
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');
}

const log = (...args) => {
  if (!quiet) console.log('[patch-client-settings]', ...args);
};

/** Depth-limited recursive walk; the global tree is shallow but npm nests deeply. */
function walk(dir, depth, out) {
  if (depth < 0) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // absent or unreadable root: not an error on its own
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, depth - 1, out);
    else if (entry.isFile() && full.endsWith(TARGET_SUFFIX)) out.push(full);
  }
  return out;
}

const candidates = [];
for (const root of roots) {
  try {
    if (!statSync(root).isDirectory()) continue;
  } catch {
    continue;
  }
  walk(root, 8, candidates);
}

if (candidates.length === 0) {
  console.error('[patch-client-settings] no client bundle found. Searched for');
  console.error(`  .../${TARGET_SUFFIX}`);
  for (const root of roots) console.error(`  under ${root}`);
  console.error('Is the npm dsh CLI installed where the discovery step recorded it?');
  process.exit(1);
}

let patched = 0;
let already = 0;
const problems = [];

for (const file of candidates) {
  const source = readFileSync(file, 'utf8');
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
  // A replacement that does not parse would break the browser bundle, and the
  // browser is exactly where we would not see it until a user opens the page.
  // Validate before committing, and leave the original in place on failure.
  writeFileSync(file, next);
  const parsed = syntaxCheck(file);
  if (parsed !== true) {
    writeFileSync(file, source);
    problems.push(`${file}: the patched bundle does not parse (${parsed}); original restored`);
    continue;
  }
  patched += 1;
  log(`patched: ${file}`);
}

/**
 * Parse the file with this Node, in whichever module system its package
 * declares. Returns true when it parses, otherwise a short reason string.
 */
function syntaxCheck(file) {
  let result;
  try {
    result = spawnSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // A sandbox that forbids spawning must not fail the build for that reason
    // alone: the anchor match above is the real gate.
    void error;
    return true;
  }
  if (result.error) return true; // same reasoning as above
  if (result.status === 0) return true;
  const stderr = (result.stderr ?? '').toString().trim().split('\n').slice(0, 3).join(' | ');
  return stderr === '' ? `node --check exited ${result.status}` : stderr;
}

if (problems.length > 0) {
  console.error('[patch-client-settings] FAILED:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  console.error('The upstream bundle changed. Find the new form with:');
  console.error(`  grep -n 'isLoopback' ${candidates.join(' ')}`);
  console.error('then update ANCHOR in this script. Do not fall back to a line number.');
  process.exit(1);
}

if (checkOnly) {
  log(`verified: ${already} bundle(s) carry the patch`);
} else {
  log(`done: ${patched} patched, ${already} already patched, ${candidates.length} candidate(s) inspected`);
}
process.exit(0);
