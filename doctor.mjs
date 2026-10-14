/**
 * Startup doctor: report which Linux sandbox rung this container will actually
 * use, before any agent session runs.
 *
 * Why this exists: `dsh-sandbox-local` picks a per-platform runner chain and
 * probes it functionally, once, lazily. On Linux the chain is bwrap then
 * Landlock, and if neither is usable the sandbox fails closed with
 * SANDBOX_UNAVAILABLE at the first confined call. That failure mode is easy to
 * mistake for a tool bug, so we surface the verdict in the container log at
 * boot instead. This script never changes behaviour and never exits non-zero:
 * a broken sandbox must not stop the GUI from starting.
 *
 * Module resolution: a global npm install nests the CLI's dependencies inside
 * the package (`<global root>/@deepseek-ai/dsh/node_modules/...`) rather than
 * hoisting them to the global root, so the launcher module is resolved through
 * a require anchored at the dsh package. The flat layout is kept as a fallback
 * for installers that do hoist.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const globalRoot = process.env.DSH_GLOBAL_ROOT ?? '/usr/local/lib/node_modules';
const dshPackageDir = `${globalRoot}/@deepseek-ai/dsh`;

/** Absolute path of the launcher module, or undefined when neither layout has it. */
function resolveLauncherModule() {
  const candidates = [];
  try {
    const require = createRequire(`${dshPackageDir}/package.json`);
    candidates.push(require.resolve('@deepseek-ai/node-addon-system/landlock-run'));
  } catch {
    // Not resolvable from the dsh package: fall through to the flat layout.
  }
  candidates.push(`${globalRoot}/@deepseek-ai/node-addon-system/lib/index.js`);
  return candidates.find((candidate) => existsSync(candidate));
}

const entry = resolveLauncherModule();

if (entry === undefined) {
  console.log(`dsh doctor: cannot locate the Landlock launcher module under ${globalRoot}; skipping the sandbox check`);
  process.exit(0);
}

let mod;
try {
  mod = await import(pathToFileURL(entry).href);
} catch (error) {
  console.log(`dsh doctor: cannot load the Landlock launcher module at ${entry}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
}

const launcher = mod.launcherPath();

if (!existsSync(launcher)) {
  console.log(`dsh doctor: WARNING the Landlock launcher binary is missing at ${launcher}`);
  console.log(
    'dsh doctor: that means the platform package @deepseek-ai/node-addon-system-<os>-<arch> is absent. '
    + 'npm installs it as an optional dependency for the installing platform only, so this happens when the image was built for a different architecture than it now runs on. '
    + 'Rebuild the image on this host (docker compose build --no-cache dsh).',
  );
  process.exit(0);
}

let verdict;
try {
  verdict = mod.probe(launcher);
} catch (error) {
  console.log(`dsh doctor: launcher probe threw: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
}

console.log(`dsh doctor: node ${process.version}; landlock launcher ${verdict} (${launcher})`);

if (verdict === 'unusable') {
  console.log(
    'dsh doctor: WARNING no usable Landlock runner on this kernel. '
    + 'workspace-write will fail closed with SANDBOX_UNAVAILABLE. '
    + 'Fix: host kernel >= 5.13 with the landlock syscalls allowed by the container seccomp profile '
    + '(recent Docker/containerd default profiles allow them). '
    + 'Alternative: set DSH_PERMISSION_MODE=danger-full-access, which drops file confinement AND the approval prompt, '
    + 'so the container becomes the only boundary.',
  );
} else if (verdict === 'partial') {
  console.log(
    'dsh doctor: NOTE this kernel exposes an older Landlock ABI, so enforcement is reported as partial. '
    + 'File effects are still confined; some newer access rights are not governed.',
  );
}
