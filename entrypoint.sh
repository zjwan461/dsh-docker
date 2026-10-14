#!/usr/bin/env bash
#
# Container entrypoint for the DeepSeek Harness Web profile.
#
# It does four things, in order, then replaces itself with `dsh` so that tini
# forwards SIGTERM/SIGINT straight to the Node process (dsh drains its plugin
# tree for up to five seconds and exits 0 on SIGTERM).
#
#   1. preflight  — prove $DSH_HOME and the workspace are writable, because the
#                   two classic container failures (a root-owned named volume,
#                   a host bind mount owned by another uid) are otherwise only
#                   discovered later as confusing per-tool errors.
#   2. doctor     — log the Linux sandbox rung this kernel will actually use.
#   3. overlay    — materialise the one deployment patch this image needs: the
#                   webserver row's bind host. `dsh web --host 0.0.0.0` is
#                   rejected by the CLI on purpose, but a reverse proxy talks to
#                   the container's bridge address, so the container must bind
#                   all interfaces. We pass it as a `--patch` overlay rather than
#                   editing the profile's own cordis.patch.yml: overlays are
#                   applied last, are idempotent, and survive image upgrades.
#                   (The profile file is initialised with an empty `[]` document,
#                   so appending entries to it would produce invalid YAML.)
#   4. exec       — hand over to dsh.
#
# Extra app arguments may be passed as the container command, e.g.
#   command: ["--port", "9000"]
# They are appended after the generated flags, so the last value wins.

set -euo pipefail

DSH_HOME="${DSH_HOME:-/data/dsh}"
SUBCMD="${DSH_SUBCOMMAND:-web}"
BIND_HOST="${DSH_BIND_HOST:-0.0.0.0}"
BIND_PORT="${DSH_BIND_PORT:-3080}"
OVERLAY_DIR="${DSH_HOME}/.runtime"
OVERLAY="${OVERLAY_DIR}/webserver-bind.yml"

log()  { printf '[dsh] %s\n' "$*" >&2; }
warn() { printf '[dsh] WARNING: %s\n' "$*" >&2; }
die()  { printf '[dsh] ERROR: %s\n' "$*" >&2; exit 1; }

# ── 0. pick the right dsh ───────────────────────────────────────────────────
#
# The npm CLI (@deepseek-ai/dsh, installed by `npm i -g`) ships the `web` profile
# and the browser UI, and it is the one this service must run. It is resolved to
# an ABSOLUTE path and executed as `node <pkg>/lib/bin.js` rather than as a bare
# `dsh`, so that no PATH entry, alias or shim can shadow it: the npm global
# prefix differs between base images, and the container's PATH is not ours to
# trust. The build records the authoritative path in
# $DSH_NPM_BIN_DISCOVERY_FILE; DSH_NPM_BIN and DSH_CLI override everything.
#
# History: this mattered much more before. An earlier image also installed the
# DeepSeek Harness Python SDK, whose runtime wheel shipped a second, minimal
# `dsh` console script into /usr/local/bin. That one shadowed the npm CLI and
# failed with a /snapshot/... path in the trace. The SDK is no longer installed,
# so the collision cannot happen; the explicit resolution stays because it is
# still the most robust way to identify the program.
resolve_dsh() {
  # Sets the DSH_CMD array. `node <bin.js> ...` is exact: no PATH entry can
  # shadow it, and the argv is passed through without any word splitting.
  if [[ -n "${DSH_CLI:-}" ]]; then
    DSH_CMD=("$DSH_CLI")
    DSH_KIND="DSH_CLI override"
    return 0
  fi

  local discovery="${DSH_NPM_BIN_DISCOVERY_FILE:-/tmp/dsh-npm-bin.path}"
  local candidates=()
  [[ -n "${DSH_NPM_BIN:-}" ]] && candidates+=("${DSH_NPM_BIN}")
  # The build records the authoritative path (`npm root -g`). The npm global
  # prefix is not hardcoded anywhere: it is /usr/lib/node_modules on some Debian
  # NodeSource installs and /usr/local/lib/node_modules on others, and guessing
  # wrong means running the wrong program.
  [[ -r "$discovery" ]] && candidates+=("$(<"$discovery")")
  if command -v npm >/dev/null 2>&1; then
    candidates+=("$(npm root -g 2>/dev/null)/@deepseek-ai/dsh/lib/bin.js")
  fi
  candidates+=(
    /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
    /usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -f "$candidate" ]] || continue
    if command -v node >/dev/null 2>&1; then
      DSH_CMD=(node "$candidate")
      DSH_KIND="npm CLI at ${candidate}"
      return 0
    fi
  done

  DSH_CMD=(dsh)
  DSH_KIND="bare 'dsh' (FALLBACK)"
}

resolve_dsh
log "dsh CLI: ${DSH_KIND}"
if [[ "$DSH_KIND" == *FALLBACK* ]]; then
  warn "the npm dsh CLI could not be found in any known location, so a bare"
  warn "'dsh' from PATH will be used. If that resolves to something else — a"
  warn "different install, a wrapper, or nothing at all — the GUI fails to start"
  warn "or serves a profile without the web plugins. Point DSH_NPM_BIN at the npm"
  warn "CLI's lib/bin.js (find it with: npm root -g) to fix this."
fi

# The overlay is attached as `dsh <subcommand> --patch ...`; a leading flag here
# would land in front of the subcommand and be misparsed.
if [[ "$SUBCMD" == -* ]]; then
  die "DSH_SUBCOMMAND must be a subcommand name such as 'web' (got '$SUBCMD'). Pass extra app arguments as the container command instead: command: [\"--port\", \"9000\"]"
fi

# ── 1. preflight ────────────────────────────────────────────────────────────

if [[ ! -d "$DSH_HOME" ]]; then
  die "\$DSH_HOME ($DSH_HOME) does not exist."
fi
if [[ ! -w "$DSH_HOME" ]]; then
  home_owner="$(stat -c '%u:%g' "$DSH_HOME" 2>/dev/null || echo '?')"
  die "\$DSH_HOME ($DSH_HOME) is not writable by uid $(id -u):$(id -g); it is owned by ${home_owner}. \$DSH_HOME is the host directory bind-mounted at /data/dsh, so fix it on the host: sudo chown -R $(id -u):$(id -g) <host directory mounted at $DSH_HOME>  -- or -- set DSH_UID=$(id -u) and DSH_GID=$(id -g) in .env and restart."
fi

# The settings document. $DSH_HOME is a host directory bind mount, so this file
# is shared: the host can edit it (the provider hot-reloads it) and the web UI can
# write it too. Each failure below looks like something else from the browser, so
# name it here.
SETTINGS_FILE="${DSH_HOME}/settings.yaml"
if [[ -d "$SETTINGS_FILE" ]]; then
  die "$SETTINGS_FILE is a DIRECTORY. The bind source on the host was missing when the container was created, so Docker made a directory in its place and the settings provider cannot parse it. On the host: rmdir <repo>/data/dsh/settings.yaml && git checkout -- data/dsh/settings.yaml, then: docker compose up -d --force-recreate"
elif [[ ! -e "$SETTINGS_FILE" ]]; then
  warn "no $SETTINGS_FILE: the composition defaults apply, so every provider and model setting is ignored until something writes it (the Models page can)."
elif [[ ! -f "$SETTINGS_FILE" ]]; then
  warn "$SETTINGS_FILE is not a regular file; the settings provider may fail to load it."
elif [[ ! -r "$SETTINGS_FILE" ]]; then
  warn "$SETTINGS_FILE is not readable by uid $(id -u):$(id -g); the provider keeps its last good document."
elif [[ ! -w "$SETTINGS_FILE" ]]; then
  warn "$SETTINGS_FILE is not WRITABLE by uid $(id -u):$(id -g): the settings pages will load but every save fails. On the host: sudo chown $(id -u):$(id -g) <repo>/data/dsh/settings.yaml"
else
  log "settings document: $SETTINGS_FILE (host-shared, writable)"
fi

# Built-in skills. The mechanism is always on: DSH_BUNDLED_SKILL_DIR is
# registered by dsh-skill-filesystem as the "bundled" root (trusted host, lowest
# precedence, read outside the agent's sandbox). Shipping ZERO skills is a valid
# state, so this reports instead of failing.
if [[ -n "${DSH_BUNDLED_SKILL_DIR:-}" ]]; then
  if [[ ! -d "$DSH_BUNDLED_SKILL_DIR" ]]; then
    warn "built-in skill root $DSH_BUNDLED_SKILL_DIR does not exist, so the bundled skill set is empty. If compose bind-mounts over it, the host directory must exist before 'up'."
  else
    bundled=0
    skipped=""
    for entry in "$DSH_BUNDLED_SKILL_DIR"/*/; do
      [[ -d "$entry" ]] || continue
      if [[ -f "${entry}SKILL.md" ]]; then
        bundled=$((bundled + 1))
      else
        skipped="$skipped $(basename "$entry")"
      fi
    done
    if [[ "$bundled" -eq 0 ]]; then
      log "built-in skills: none in $DSH_BUNDLED_SKILL_DIR (mechanism ready; see README: built-in skills)"
    else
      log "built-in skills: $bundled discovered in $DSH_BUNDLED_SKILL_DIR"
    fi
    if [[ -n "$skipped" ]]; then
      warn "these subdirectories hold no SKILL.md and are ignored by discovery:$skipped"
    fi
  fi
fi

# ── 1c. profile projection ──────────────────────────────────────────────────
#
# The profile's package.json declares NO dependencies (`dependencies: {}`): its
# plugin set is named by `dsh.profile.bundles` and materialised at boot as a
# PROJECTION of the installation's own packages into
# $DSH_HOME/profiles/node_modules. Nothing needs the npm registry at runtime, so
# there is nothing to pre-install — `dsh plugin --profile web install` is a no-op
# ("Already up to date"), which is worth knowing before trying to debug this.
#
# What IS dangerous is a projection inherited from an older home. A home migrated
# with `cp -a` keeps the previous owner and can carry a partial or
# older-generation projection. It SHADOWS the installation, and because the
# profile declares no dependencies dsh has nothing to reinstall, so plugin loading
# fails on every restart with
#   plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local; could not be resolved
# Fixing permissions does not help: the CONTENT is wrong, and nothing rebuilds it.
#
# Verifying completeness would need the bundles' dependency closure, which is not
# knowable from bash, so this does not delete anything — it reports the shape and
# prints the one command that fixes it.
PROJECTION="${DSH_HOME}/profiles/node_modules/@deepseek-ai"
dsh_bin="$(cat "${DSH_NPM_BIN_DISCOVERY_FILE:-/tmp/dsh-npm-bin.path}" 2>/dev/null || true)"
INSTALLATION=""
if [[ -n "$dsh_bin" ]]; then
  INSTALLATION="$(dirname "$(dirname "$dsh_bin")")/node_modules/@deepseek-ai"
fi
projected="$(ls -1 "$PROJECTION" 2>/dev/null | wc -l)"
installed=0
if [[ -n "$INSTALLATION" ]]; then
  installed="$(ls -1 "$INSTALLATION" 2>/dev/null | wc -l)"
fi
if [[ "$projected" -gt 0 && "$installed" -gt 0 && "$projected" -lt "$installed" ]]; then
  warn "the profile projection has $projected packages while the installation supplies $installed."
  warn "A partial projection shadows the installation and breaks plugin loading with"
  warn "  plugin(s) failed to load: ... could not be resolved"
  warn "Permissions are not the problem — the CONTENT is, and nothing rebuilds it because"
  warn "the profile declares no dependencies. Drop it and let dsh project it again:"
  warn "  rm -rf ${DSH_HOME}/profiles/node_modules && docker compose restart dsh"
elif [[ "$projected" -gt 0 ]]; then
  log "profile projection present ($projected packages)"
fi

mkdir -p "$OVERLAY_DIR" || die "cannot create $OVERLAY_DIR"
# mkdir -p succeeds when the directory already exists but is not writable (for
# example a .runtime/ left behind by an earlier run as root), and the failing
# write below would then abort the container with a bare redirection error.
if [[ ! -w "$OVERLAY_DIR" ]]; then
  overlay_owner="$(stat -c '%u:%g' "$OVERLAY_DIR" 2>/dev/null || echo '?')"
  die "$OVERLAY_DIR exists but is not writable by uid $(id -u):$(id -g); it is owned by ${overlay_owner}. The entrypoint regenerates its bind overlay there on every start. Fix on the host: sudo chown -R $(id -u):$(id -g) <host directory mounted at $DSH_HOME>/.runtime"
fi

WORKSPACE="$(pwd)"
owner_uid="$(stat -c '%u' "$WORKSPACE" 2>/dev/null || echo '?')"
owner_gid="$(stat -c '%g' "$WORKSPACE" 2>/dev/null || echo '?')"
if [[ -w "$WORKSPACE" ]]; then
  log "workspace $WORKSPACE is writable by uid $(id -u):$(id -g)"
else
  warn "workspace $WORKSPACE is NOT writable by uid $(id -u):$(id -g); it is owned by $owner_uid:$owner_gid."
  warn "The GUI will start, but every agent file write in the workspace will fail."
  warn "Fix on the host, either way:"
  warn "  sudo chown -R $(id -u):$(id -g) <host directory mounted at $WORKSPACE>"
  warn "  -- or -- set DSH_UID=$owner_uid and DSH_GID=$owner_gid in .env, then: docker compose up -d"
  warn "     Setting DSH_UID re-owns nothing by itself: the ./data/dsh host directory has its own owner, so chown it too: sudo chown -R $(id -u):$(id -g) <repo>/data/dsh"
fi

# A workspace that holds the deployment itself is a real misconfiguration, not
# just a permission problem: the agent can then rewrite the deployment (the
# Caddyfile, this image's build inputs) and DSH additionally reads
# <workspace>/.env as a launch environment layer for every session.
stray=""
for marker in compose.yaml Dockerfile Caddyfile .env .env.example; do
  if [[ -e "$WORKSPACE/$marker" ]]; then
    stray="$stray $marker"
  fi
done
if [[ -n "$stray" ]]; then
  warn "the workspace looks like the deployment directory: it contains${stray}"
  warn "DSH_WORKSPACES is pointing at the deployment instead of a projects directory. The agent would be able to rewrite the deployment, and DSH loads <workspace>/.env as a launch environment layer for every session."
  warn "Point DSH_WORKSPACES at a dedicated directory, e.g. DSH_WORKSPACES=/srv/projects/dsh-work"
fi

# The npm global root is a build-time fact, not a constant: NodeSource installs
# into /usr/lib/node_modules on this base while other layouts use
# /usr/local/lib/node_modules. doctor.mjs reads DSH_GLOBAL_ROOT, and a wrong
# value makes it report "cannot locate the Landlock launcher module" even though
# the launcher is right there. Point it at what the build recorded.
if [[ -r /tmp/dsh-global-root.path ]]; then
  DSH_GLOBAL_ROOT="$(cat /tmp/dsh-global-root.path)"
  export DSH_GLOBAL_ROOT
fi

# ── 2. doctor ───────────────────────────────────────────────────────────────

if [[ -z "${DSH_SKIP_DOCTOR:-}" ]]; then
  if [[ -r /usr/local/bin/dsh-doctor.mjs ]]; then
    node /usr/local/bin/dsh-doctor.mjs || warn "the sandbox doctor failed to run"
  else
    warn "the sandbox doctor is not readable by uid $(id -u); skipping it. Rebuild the image: COPY preserved a restrictive mode on doctor.mjs."
  fi
fi

if command -v bwrap >/dev/null 2>&1; then
  warn "bubblewrap is present in this image. The Linux chain probes bwrap before Landlock, and bwrap normally needs unprivileged user namespaces plus a relaxed seccomp profile inside a container. Remove bwrap unless you deliberately granted those."
fi

# ── 3. overlay ──────────────────────────────────────────────────────────────
#
# A patch replaces the targeted row's whole `config`, so every key the row owns
# is restated here. `port` keeps the `!!js` expression from the bundle layer so
# that a `--port` app argument still wins over this default.

cat >"$OVERLAY" <<EOF
# Generated by /usr/local/bin/dsh-entrypoint at $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Do not edit: it is rewritten on every container start.
#
# Why: the dsh CLI refuses \`--host 0.0.0.0\` by design, but a container behind a
# reverse proxy must accept connections on its bridge interface. host: 0.0.0.0
# is intentional and safe here only because this service publishes no port of
# its own — the caddy service is the single network entry point.
- id: webserver
  config:
    host: ${BIND_HOST}
    port: !!js ctx.webStartup.port ?? ${BIND_PORT}
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
EOF

log "wrote bind overlay $OVERLAY (host=${BIND_HOST}, port=${BIND_PORT})"

# Self-check the overlay, because a patch whose target does not match is
# reported but does not abort the boot: we would rather shout here than let the
# proxy return 502 forever. A failure here is a warning, never fatal.
if [[ -z "${DSH_SKIP_CONFIG_CHECK:-}" ]]; then
  if dump="$("${DSH_CMD[@]}" "$SUBCMD" --patch "$OVERLAY" --dump-config 2>&1)"; then
    if grep -q "host: ${BIND_HOST}" <<<"$dump"; then
      log "bind overlay verified against the composed config tree"
    else
      warn "the composed config tree does not report 'host: ${BIND_HOST}'. The reverse proxy will not reach this container."
      warn "Inspect with: ${DSH_CMD[*]} $SUBCMD --patch $OVERLAY --dump-config"
    fi
  else
    first_lines="$(printf '%s\n' "$dump" | head -n 3 | tr '\n' ' ')"
    warn "config dump failed; continuing to boot anyway: ${first_lines}"
  fi
fi

# ── 3b. deployment patch: settings UI on a remote origin ────────────────────
#
# The image applies this patch at BUILD time, as root, because the file it
# rewrites lives in the root-owned npm global installation and the profile's
# node_modules is a symlink farm pointing back into it — so a runtime attempt can
# only ever fail with EACCES. This is therefore a verification, not an apply: it
# catches a plugin package that was reinstalled (e.g. by `dsh plugin`) after the
# build, and the fix for that is a rebuild.
PATCH_TOOL=/usr/local/bin/dsh-patch-client-settings.mjs
if [[ -r "$PATCH_TOOL" ]]; then
  if node "$PATCH_TOOL" --check --quiet; then
    log "settings-UI patch present: the domain-served GUI edits the host document"
  else
    warn "the settings-UI patch is NOT present in this image's plugin tree, so the"
    warn "Models and General settings pages will report 'settings are available in"
    warn "this browser' when the GUI is opened through the domain."
    warn "The patch is applied during the image build; seeing this means the plugin"
    warn "package was reinstalled or replaced afterwards. Rebuild to restore it:"
    warn "  docker compose build && docker compose up -d"
    while IFS= read -r patch_line; do warn "  ${patch_line}"; done <<<"$(node "$PATCH_TOOL" --check 2>&1 || true)"
  fi
else
  warn "$PATCH_TOOL is missing; the settings-UI patch cannot be verified."
fi

# ── 4. exec ─────────────────────────────────────────────────────────────────

# Split on commas and whitespace. `|| true` keeps a here-string edge case from
# ever tripping `set -e` and aborting the container with no useful log.
read -r -a TRUSTED <<<"$(printf '%s' "${DSH_TRUSTED_HOSTS:-}" | tr ',' ' ')" || true

if [[ "$BIND_HOST" == "0.0.0.0" && "${#TRUSTED[@]}" -eq 0 ]]; then
  warn "the container binds all interfaces but DSH_TRUSTED_HOSTS is empty."
  warn "The /api browser-trust fence only accepts the loopback host and the container's own LAN literals, so a browser reaching this GUI through the proxy will get 403."
  warn "Set DSH_TRUSTED_HOSTS to the authority the browser uses, e.g. dsh.example.com"
fi

for host in "${TRUSTED[@]}"; do
  # Verified against dsh-client-connection's isTrustedAuthority: a port-less
  # entry is compared by hostname alone, while an entry with an explicit port is
  # compared as host:port; WHATWG normalization makes a scheme's default port
  # equal to "no port". A browser therefore sends a port-less Host for a
  # default-port URL, and an explicit :443 / :80 entry can never match it.
  if [[ "${host:0:1}" != "[" ]]; then
    case "$host" in
      *:443 | *:80)
        warn "trusted host '${host}' carries an explicit default port. Browsers omit the default port from the Host header, so this entry will never match a browser request. Use the port-less form instead, which already matches every port: ${host%:*}"
        ;;
    esac
  fi
done

ARGS=("$SUBCMD" "--patch" "$OVERLAY")
if [[ "${DSH_OPEN_BROWSER:-0}" != "1" ]]; then
  ARGS+=("--no-open")
fi
for host in "${TRUSTED[@]}"; do
  ARGS+=("--trusted-host" "$host")
done
ARGS+=("$@")

log "sandbox mode: ${DSH_PERMISSION_MODE:-workspace-write} (deployment default)"
log "starting: ${DSH_CMD[*]} ${ARGS[*]}"

exec "${DSH_CMD[@]}" "${ARGS[@]}"
