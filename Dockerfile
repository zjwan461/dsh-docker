# DeepSeek Harness (dsh) Web GUI in one image.
#
#   service   entrypoint
#   ───────   ────────────────────────────────────────────────────────────────
#   dsh       /usr/local/bin/dsh-entrypoint -> `dsh web`
#
#   * python:3.11-slim-bookworm is the base. Debian (glibc 2.36) is deliberate:
#     dsh's native npm pieces (node-pty, sharp, @vscode/ripgrep, landlock-run)
#     ship as prebuilt glibc binaries, and Alpine/musl would force node-pty into
#     a source build.
#
#     The Python interpreter itself is no longer used by anything in this stack.
#     The base is kept deliberately: it is the configuration that is proven on
#     the target host, and switching to node:22-bookworm-slim changes two things
#     that need a fresh round of verification — the npm global prefix, and the
#     `useradd --create-home` step below, which silently becomes a no-op because
#     the official node image ALREADY has a uid-1000 `node` user (that leaves the
#     runtime uid with no writable $HOME whenever DSH_UID != 1000).
#
#   * Node.js 22 comes from NodeSource. Node >= 22.12 is mandatory: the CLI
#     depends on commander@15, whose engines field is ">=22.12.0".
#
#   * bubblewrap is deliberately NOT installed. On Linux the sandbox chain is
#     ["bwrap", "landlock"] and is probed in that order; bwrap inside a
#     container needs unprivileged user namespaces plus a relaxed seccomp
#     profile, so leaving it absent makes the container land deterministically
#     on the Landlock rung, which needs no privileges at all. DSH fails closed
#     (SANDBOX_UNAVAILABLE) rather than running unconfined, so a missing runner
#     is loud, never silent.
#
# Build (context is the repository root):
#   docker build -t dsh:0.1.5-rc.3 .

FROM python:3.11-slim-bookworm

ARG NODE_MAJOR=22
ARG DSH_VERSION=0.1.5-rc.3
ARG DSH_UID=1000
ARG DSH_GID=1000
# Absolute path of the npm dsh CLI entry file. Deliberately NOT set here: the
# npm global prefix differs between base images (/usr/lib vs /usr/local/lib), and
# guessing wrong is fatal. It is discovered with `npm root -g` after the install
# steps and recorded in /tmp/dsh-npm-bin.path, which entrypoint.sh reads.
# DSH_NPM_BIN at runtime still overrides everything.

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NODE_ENV=production \
    DSH_HOME=/data/dsh \
    DSH_GLOBAL_ROOT=/usr/local/lib/node_modules \
    DSH_NPM_BIN_DISCOVERY_FILE=/tmp/dsh-npm-bin.path

# Built-in ("bundled") skills. This path is registered by
# @deepseek-ai/dsh-skill-filesystem as the bundled skill root — source
# "bundled", trustedHost (its SKILL.md is read OUTSIDE the agent's sandbox, which
# is what makes a root outside the workspace readable at all), and rank 600, the
# highest rank number. Ranks sort ascending, so bundled is the LOWEST precedence:
# a project or user skill of the same name overrides it — the behaviour you want
# for built-ins.
#
# It ships EMPTY on purpose: the mechanism is the deliverable. Drop a skill in,
# rebuild, and it is live. An empty root is a valid state — discovery treats a
# subdirectory without SKILL.md as absent, and entrypoint.sh reports the count at
# every start. See compose.yaml for the no-rebuild alternative and README 「内置技能」.
ENV DSH_BUNDLED_SKILL_DIR=/opt/dsh-skills

# ── base tooling ────────────────────────────────────────────────────────────
# The container is a WORKING environment for an agent, so every missing binary
# is either a dead end or a network install at run time. Grouped by what they
# unblock:
#
#   transfer    curl wget rsync
#   vcs/build   git (the agent is a coding agent), openssh-client for ssh remotes
#   archives    unzip zip p7zip-full bzip2 zstd — xz-utils is here for the same
#               reason (the agent unpacks downloads)
#   inspection  file (what IS this?), jq (what does this JSON say?), tree,
#               sqlite3 for the many small databases agent tooling produces
#   editing     vim-tiny nano — there is otherwise NO editor in the image, which
#               makes a container-side fix to /data/dsh/settings.yaml impossible
#               without docker cp
#   runtime     less procps tini (PID 1 forwards SIGTERM)
#   networking  iproute2 bind9-dnsutils iputils-ping netcat-openbsd — the
#               compose/proxy troubleshooting in the README keeps asking for
#               dig/ss/ping from inside the container
#   time        tzdata — without it TZ from compose is silently ignored by tools
#               that read the zone database
#   text search ripgrep — @vscode/ripgrep ships inside dsh, but the agent's own
#               shell wants a plain `rg` on PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      wget \
      rsync \
      git \
      openssh-client \
      unzip \
      zip \
      p7zip-full \
      bzip2 \
      zstd \
      xz-utils \
      file \
      jq \
      tree \
      sqlite3 \
      vim-tiny \
      nano \
      less \
      procps \
      ripgrep \
      tini \
      iproute2 \
      bind9-dnsutils \
      iputils-ping \
      netcat-openbsd \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

# ── documents, PDF, media ───────────────────────────────────────────────────
#   poppler-utils          pdftotext / pdftoppm / pdfinfo — PDF to text and PDF
#                          to image, the two PDF operations an agent needs most
#   qpdf                   merge, linearise, decrypt
#   ghostscript            PDF post-processing; also a hard dependency of several
#                          LibreOffice and pandoc export paths
#   imagemagick            convert / identify / montage. Overlaps with the sharp
#                          npm package the GUI already carries, but the agent's
#                          shell needs a COMMAND, not a library binding
#   ffmpeg                 transcode, extract frames, build thumbnails, mux audio
#   sox                    light audio work (trim, resample, concat)
#   libimage-exiftool-perl read and write EXIF — tag generated images, inspect
#                          what a camera or a model wrote
#   fonts-noto-cjk         THE important one: without a CJK font every Chinese
#                          character in a LibreOffice/pandoc/preview render comes
#                          out as a tofu box. fonts-noto-color-emoji is the same
#                          argument for emoji.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      poppler-utils \
      qpdf \
      ghostscript \
      imagemagick \
      ffmpeg \
      sox \
      libimage-exiftool-perl \
      fonts-dejavu-core \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# ── office documents (the heavy layer, switchable) ──────────────────────────
# Build with --build-arg INSTALL_OFFICE=0 (or INSTALL_OFFICE=0 in .env) to leave
# roughly half a gigabyte out of the image.
#
# COMPONENT packages, not the `libreoffice` metapackage. Together with
# --no-install-recommends that is what keeps a desktop out of the image: the
# metapackage drags in gtk3, java and the mail/merge extras. Headless conversion
# works without any of it:
#   soffice --headless --convert-to pdf --outdir /tmp deck.pptx
#
# pandoc lives here rather than in the layer above because it is a ~120 MB
# static Haskell binary; it converts markdown to and from docx/pptx/html.
# Producing PDF through pandoc additionally needs a PDF engine — LaTeX is
# hundreds of megabytes and is deliberately NOT installed; use LibreOffice
# (--convert-to pdf) or ghostscript instead.
ARG INSTALL_OFFICE=1
RUN set -eux; \
    if [ "${INSTALL_OFFICE}" = "1" ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        pandoc; \
      rm -rf /var/lib/apt/lists/*; \
      soffice --headless --version; \
    else \
      echo 'INSTALL_OFFICE=0: LibreOffice and pandoc are NOT in this image'; \
    fi

# ── python libraries for document generation (switchable) ───────────────────
# The python interpreter arrives with the base image; these are the libraries the
# document skills need. In particular python-pptx + Pillow are what the bundled
# pptx workflow drives, and without them the agent has to pip install at run time
# (which needs egress and is slow).
#
# pandas / matplotlib / markitdown are one line away in the same list when a task
# calls for them; they are not here by default because they roughly double this
# layer for nothing.
ARG INSTALL_PYTHON_DOCS=1
RUN set -eux; \
    if [ "${INSTALL_PYTHON_DOCS}" = "1" ]; then \
      pip install --no-cache-dir \
        python-pptx \
        python-docx \
        openpyxl \
        Pillow; \
    else \
      echo 'INSTALL_PYTHON_DOCS=0: document-generation libraries are NOT in this image'; \
    fi

# ── Node.js 22 ──────────────────────────────────────────────────────────────
# The NodeSource setup script imports its signing key itself (dearmor), so no
# gnupg package is required on the image.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh \
 && bash /tmp/nodesource_setup.sh \
 && rm -f /tmp/nodesource_setup.sh \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# ── dsh CLI + pnpm ──────────────────────────────────────────────────────────
# pnpm is required because `dsh plugin --profile <name> <args>` forwards to it.
#
# `@deepseek-ai/dsh-session-title-llm` is installed EXPLICITLY even though
# nothing lists it as a regular dependency. The real chain is:
#
#     @deepseek-ai/dsh -> @deepseek-ai/dsh-base
#                      -> @deepseek-ai/dsh-session-title-first-prompt-llm
#                      -> peerDependencies: @deepseek-ai/dsh-session-title-llm
#
# A peer dependency is the consumer's job to provide, and npm does not reliably
# put this one in the global tree. When it is absent, `dsh web` aborts while
# composing the `web` profile with ERR_MODULE_NOT_FOUND for
# '@deepseek-ai/dsh-session-title-llm'. Installing it at the top level places it
# where Node's resolver finds it from the nested plugin.
#
# The version MUST stay pinned to DSH_VERSION: this package's `latest` dist-tag
# is 0.0.1-rc.1, so an unpinned name would fetch a stale release that does not
# match the CLI, and `next` is 0.1.5-rc.2, so it would also drift ahead.
RUN npm install --global --no-fund --no-audit \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "@deepseek-ai/dsh-session-title-llm@${DSH_VERSION}" \
      pnpm

# ── why those extra pins exist ──────────────────────────────────────────────
# PRERELEASE RANGES FLOAT, and that broke a deployment. `@deepseek-ai/dsh@0.1.5-rc.1`
# depends on `@deepseek-ai/dsh-base@^0.1.5-rc.1`, and npm resolves the NEWEST
# prerelease inside that range — dsh-base 0.1.5-rc.3 in practice — while the CLI
# stays rc.1. The newer bundle declares its sandbox packages at `^0.1.5-rc.3`, and
# three of them ended up absent from the tree:
#
#     @deepseek-ai/dsh-bash-sandbox   ^0.1.5-rc.3  MISSING
#     @deepseek-ai/dsh-fs-sandbox     ^0.1.5-rc.3  MISSING
#     @deepseek-ai/dsh-sandbox-local  ^0.1.5-rc.3  MISSING
#
# The web profile then asks to load a plugin the installation does not carry, and
# because the profile's own package.json declares no dependencies there is nothing
# that can fill the gap — the GUI dies on every start with
#     plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local; could not be resolved
#
# A TOP-LEVEL EXACT PIN defeats the float: the range is satisfied by the pinned
# version instead of by the newest prerelease. That is the same mechanism that
# makes the @deepseek-ai/dsh-session-title-llm pin above work, and it is why every
# entry here is spelled out rather than left to a range.
#
# If one of these pins has no published version, the BUILD fails with npm's
# "No matching version found" — which is the honest answer, and the fix at that
# point is to move DSH_VERSION to a release whose whole tree is consistent.

# ── persistent roots ────────────────────────────────────────────────────────
# /data/dsh   every piece of GUI state (profiles, sessions, storages,
#             settings.yaml, .credentials.yaml).
# /workspaces the sandbox workspace root.
RUN mkdir -p /data/dsh /workspaces

# ── application code ────────────────────────────────────────────────────────
COPY entrypoint.sh             /usr/local/bin/dsh-entrypoint
COPY doctor.mjs                /usr/local/bin/dsh-doctor.mjs
COPY patch-client-settings.mjs /usr/local/bin/dsh-patch-client-settings.mjs
# COPY preserves the build context's permission bits, so a checkout produced
# under a restrictive umask (or copied with scp -p) lands in the image as
# root-owned mode 0600 and the unprivileged runtime uid then fails with
# EACCES. Pin every mode explicitly instead of trusting the host.
# `bash -n` here is a guard, not decoration: the entrypoint runs on every start, so
# a syntax error in it turns a working image into a container that dies before its
# first log line. `node --check` covers the patch script the same way — it parses as
# ESM, which is how Node will load it.
RUN chmod 0755 /usr/local/bin/dsh-entrypoint \
 && chmod 0755 /usr/local/bin/dsh-patch-client-settings.mjs \
 && chmod 0644 /usr/local/bin/dsh-doctor.mjs \
 && bash -n /usr/local/bin/dsh-entrypoint \
 && node --check /usr/local/bin/dsh-patch-client-settings.mjs \
 && echo 'entrypoint and patch script parse'

# ── built-in skills (empty by default) ──────────────────────────────────────
# One directory per skill, each containing SKILL.md:
#   /opt/dsh-skills/<name>/SKILL.md      (+ optional scripts/, assets/, reference/)
# A single <name>.md in the root also works. Frontmatter needs at least `name`
# and `description`; a .md WITHOUT frontmatter is ignored and logged as a warning
# on every scan, so do not park a plain README.md here.
#
# a+rX rather than trusting the build context: COPY preserves the host's modes,
# so a restrictive umask would otherwise make the skills unreadable to the
# unprivileged runtime uid — the same trap that already bit entrypoint.sh.
COPY skills/ /opt/dsh-skills/
RUN chmod -R a+rX /opt/dsh-skills

# ── locate the npm dsh CLI ──────────────────────────────────────────────────
# The npm global prefix is NOT hardcoded, because it differs between base images
# (/usr/lib/node_modules for some Debian NodeSource installs,
# /usr/local/lib/node_modules for others) and guessing wrong is fatal.
#
# Three independent discovery routes are tried, newest-most-authoritative first:
#   1. npm root -g                      -> ${root}/@deepseek-ai/dsh/lib/bin.js
#   2. the installed `dsh` bin symlink  -> readlink it; it points at <pkg>/lib/bin.js
#   3. a filesystem search for the file
# The result is validated with `test -f`; if nothing is found the build prints
# the layout it did see and fails, so the next run is diagnosable rather than a
# bare "file not found".
RUN set -eux; \
    echo "--- npm global root: $(npm root -g) ---"; \
    echo "--- which dsh: $(command -v dsh || echo none) ---"; \
    found=""; \
    root="$(npm root -g 2>/dev/null || true)"; \
    if [ -n "${root}" ] && [ -f "${root}/@deepseek-ai/dsh/lib/bin.js" ]; then \
      found="${root}/@deepseek-ai/dsh/lib/bin.js"; \
    fi; \
    if [ -z "${found}" ]; then \
      bin="$(command -v dsh || true)"; \
      if [ -n "${bin}" ]; then \
        resolved="$(readlink -f "${bin}" 2>/dev/null || true)"; \
        case "${resolved}" in \
          */lib/bin.js) [ -f "${resolved}" ] && found="${resolved}" ;; \
        esac; \
      fi; \
    fi; \
    if [ -z "${found}" ]; then \
      found="$(find /usr /opt /root /home -maxdepth 8 \
        -path '*/@deepseek-ai/dsh/lib/bin.js' -print -quit 2>/dev/null || true)"; \
    fi; \
    if [ -z "${found}" ] || [ ! -f "${found}" ]; then \
      echo 'ERROR: could not locate the npm dsh CLI. Layout observed:'; \
      echo "  npm prefix: $(npm prefix -g 2>/dev/null || echo '?')"; \
      ls -la /usr/lib/node_modules 2>/dev/null | head -20 || true; \
      ls -la /usr/local/lib/node_modules 2>/dev/null | head -20 || true; \
      echo '  searching for the package.json:'; \
      find / -maxdepth 9 -path '*/@deepseek-ai/dsh/package.json' -print 2>/dev/null | head -5 || true; \
      exit 1; \
    fi; \
    echo "npm dsh CLI: ${found}"; \
    printf '%s' "${found}" > /tmp/dsh-npm-bin.path; \
    node "${found}" --version

# ── verify the global install actually carries the plugin tree ──────────────
# The web profile resolves its plugins from THIS tree: dsh projects the
# installation into $DSH_HOME/profiles/node_modules as symlinks, and the profile
# itself declares no dependencies, so a package missing here cannot be recovered
# from anywhere.
#
# `@deepseek-ai/dsh-sandbox-local` is a regular dependency of
# `@deepseek-ai/dsh-base`, and it imports
# `@deepseek-ai/node-addon-system/landlock-run` at module scope. That subpath is
# supplied by the platform package `node-addon-system-linux-x64`, which arrives
# as an OPTIONAL dependency — so an npm that skips optional deps (or a different
# npm prefix than the one the CLI was installed with) takes the whole plugin tree
# down, with the symptom pointing at the import site rather than the cause:
#   plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local; could not be resolved
#
# RESOLVED, and verified by a real build: with DSH_VERSION at the newest release
# of its line and the four packages above pinned explicitly, the install is
# consistent. npm then places the pinned four at the npm global ROOT and nests
# the rest beside the CLI — two locations, both of which Node resolves (the
# global root is itself an ancestor node_modules directory), which is why the
# check below looks in both. The boot smoke test that follows is what actually
# proves the profile projection resolves the sandbox plugins from wherever they
# landed; that test is the reason this image is known to boot.
RUN set -eux; \
    DSH_PKG_DIR="$(dirname "$(dirname "$(cat /tmp/dsh-npm-bin.path)")")"; \
    TREE="${DSH_PKG_DIR}/node_modules/@deepseek-ai"; \
    GLOBAL="$(npm root -g)/@deepseek-ai"; \
    resolve_pkg() { \
      if [ -d "${TREE}/$1" ]; then printf '%s' "${TREE}/$1"; \
      elif [ -d "${GLOBAL}/$1" ]; then printf '%s' "${GLOBAL}/$1"; \
      fi; \
    }; \
    echo "--- npm $(npm --version) from $(command -v npm), npm root -g: $(npm root -g) ---"; \
    echo "--- plugin packages: $(ls "$TREE" 2>/dev/null | wc -l) beside the CLI, $(ls "$GLOBAL" 2>/dev/null | wc -l) at the global root ---"; \
    missing=""; \
    for p in dsh-base dsh-web-app dsh-sandbox-local dsh-bash-sandbox dsh-fs-sandbox node-addon-system; do \
      if [ -z "$(resolve_pkg "$p")" ]; then missing="${missing} ${p}"; fi; \
    done; \
    if [ -n "${missing}" ]; then \
      echo "ERROR: the global install is missing:${missing}"; \
      ls -la "$TREE" 2>/dev/null | head -40 || true; \
      ls -la "$GLOBAL" 2>/dev/null | head -40 || true; \
      exit 1; \
    fi; \
    mismatched=""; \
    echo "--- resolved versions (every one must equal DSH_VERSION=${DSH_VERSION}) ---"; \
    for p in dsh-base dsh-web-app dsh-sandbox-local dsh-bash-sandbox dsh-fs-sandbox dsh-pwsh-sandbox dsh-sandbox-policy; do \
      d="$(resolve_pkg "$p")"; \
      v="missing"; \
      if [ -n "$d" ]; then v="$(node -p "require('${d}/package.json').version" 2>/dev/null || echo '?')"; fi; \
      echo "  ${p} ${v}"; \
      if [ "${v}" != "${DSH_VERSION}" ]; then mismatched="${mismatched} ${p}@${v}"; fi; \
    done; \
    if [ -n "${mismatched}" ]; then \
      echo "ERROR: these packages are not at DSH_VERSION=${DSH_VERSION}:${mismatched}"; \
      echo 'Prerelease ranges resolve to the NEWEST prerelease, so the CLI and its'; \
      echo 'bundles can disagree with each other. DSH_VERSION must be the newest'; \
      echo 'release of its line, and everything that pattern needs is pinned above.'; \
      exit 1; \
    fi; \
    echo 'every package the web profile needs is installed, all at one version'

# ── deployment patch: settings UI on a remote origin ────────────────────────
# dsh decides where the settings document lives in the BROWSER:
#
#     const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
#
# `$host.isLoopback` is true only for an Electron shell, a document with no
# location, or a loopback hostname — so on a domain-served deployment the Models
# page reads a session-local document and reports "settings are available in this
# browser". The script rewrites that one definition (a second, independent gate
# in dsh-client-ui-settings-general reads the same flag), anchoring on the whole
# expression rather than a line number and validating that the result parses.
#
# The patched file IS what the browser runs: dsh-client-modules serves each
# plugin's lib/client.js from disk as plugins/<id>/client.js, so no monorepo
# build, no fork and no per-release rebase are needed.
#
# It is applied HERE, as root, and nowhere else can work. The file it rewrites
# belongs to the npm global installation:
#
#   /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js
#
# That tree is root-owned while the container runs as the unprivileged DSH_UID, so
# a runtime attempt can only ever end in
#
#   cannot stage a file in .../dsh-client-connection/lib (EACCES)
#
# and the profile's node_modules is a SYMLINK FARM pointing back into that same
# tree, so there is no writable copy to patch instead. Patching the installation
# copy IS patching what the browser loads, because dsh-client-modules serves the
# file it resolves. entrypoint.sh re-runs this script with --check on every start
# and only warns, which covers a plugin package reinstalled by `dsh plugin`.
RUN node /usr/local/bin/dsh-patch-client-settings.mjs

# ── bundled plugins ─────────────────────────────────────────────────────────
# Everything under plugins/ ships into the image at /opt/dsh-plugins and is
# ENABLED AT CONTAINER START, not here, because a profile only exists once dsh
# has composed it. entrypoint.sh does two things per plugin:
#
#   1. links the package into $DSH_HOME/profiles/node_modules, so the plugin rows
#      in the composed tree can resolve it. This survives dsh's own link
#      projection: removeLinkProjections only unlinks symlinks whose target sits
#      inside <profile>/.dsh-module-fallback, and "every other symlink stays";
#   2. appends the bundle's own patch layer to $DSH_HOME/cordis.patch.yml, the
#      home-level patch applied over every profile's layer, which is also why the
#      first start already has the plugin. It is seeded ONCE, so the options you
#      edit there are never overwritten by a later start.
#
# A plugin directory must be a dsh bundle: a package.json with a name that
# resolves, an entry point that exists, and — when it declares
# `dsh.bundle.patch` — that patch file. The checks below fail the build rather
# than shipping an image whose GUI silently loses its plugins.
COPY plugins/ /opt/dsh-plugins/
RUN set -eux; \
    chmod -R a+rX /opt/dsh-plugins; \
    count=0; \
    for dir in /opt/dsh-plugins/*/; do \
      [ -d "$dir" ] || continue; \
      manifest="${dir}package.json"; \
      if [ ! -f "$manifest" ]; then echo "ERROR: ${dir} has no package.json"; exit 1; fi; \
      name="$(node -p "require('${manifest}').name ?? ''")"; \
      if [ -z "$name" ]; then echo "ERROR: ${manifest} declares no name"; exit 1; fi; \
      entry="$(node -p "const p = require('${manifest}'); const e = p.exports ?? p.main ?? ''; typeof e === 'string' ? e : (e['.'] ?? '')")"; \
      if [ -z "$entry" ] || [ ! -e "${dir}${entry}" ]; then echo "ERROR: ${name}: entry point ${entry:-<none>} does not exist"; exit 1; fi; \
      patch="$(node -p "require('${manifest}').dsh?.bundle?.patch ?? ''")"; \
      if [ -n "$patch" ] && [ ! -f "${dir}${patch}" ]; then echo "ERROR: ${name}: dsh.bundle.patch ${patch} does not exist"; exit 1; fi; \
      echo "bundled plugin: ${name}  entry: ${entry}  patch: ${patch:-none}"; \
      count=$((count + 1)); \
    done; \
    echo "bundled plugins: ${count} — add a directory under plugins/ to grow the set"

# ── build-time self-check ───────────────────────────────────────────────────
# The `--dump-config` check is the valuable one: it makes dsh compose the whole
# `web` profile tree, forcing Node to resolve every plugin import. A missing
# package aborts the BUILD here instead of leaving an image whose GUI
# crash-loops with "plugin tree failed to load". It uses a throwaway home so the
# real one stays clean.
#
# It also records the npm global root. DSH_GLOBAL_ROOT cannot be a fixed ENV
# value: NodeSource installs into /usr/lib/node_modules on one base and
# /usr/local/lib on another, and a wrong value silently breaks doctor.mjs, which
# is exactly what happened (the doctor reported "cannot locate the Landlock
# launcher module under /usr/local/lib/node_modules" while the CLI actually lived
# in /usr/lib). entrypoint.sh exports this file back into DSH_GLOBAL_ROOT.
RUN set -eux; \
    DSH_NPM_BIN="$(cat /tmp/dsh-npm-bin.path)"; \
    npm root -g > /tmp/dsh-global-root.path; \
    cat /tmp/dsh-global-root.path; \
    mkdir -p /tmp/dsh-build-check; \
    DSH_HOME=/tmp/dsh-build-check node "${DSH_NPM_BIN}" --profile web --dump-config >/dev/null; \
    echo 'npm CLI composed the web profile: every plugin import resolved'; \
    rm -rf /tmp/dsh-build-check

# ── profile plugins are NOT installed here ──────────────────────────────────
# An earlier revision of this file pre-installed the profile with
# `dsh plugin --profile web install`, and the build disproved it:
#     Already up to date
#     Done in 919ms using pnpm v12.11.2
# The profile's package.json declares NO dependencies (`dependencies: {}`). Its
# plugin set is named by `dsh.profile.bundles` and materialised AT BOOT as a
# projection of the installation's own packages — dsh-app-boot describes it as
# wiring "the installation and selected bundles to Node's ESM and CommonJS
# resolvers", and it only installs what "the installation does not supply".
#
# Two consequences:
#   * nothing needs the npm registry at runtime, so there is nothing to bake;
#   * a STALE projection is fatal. A profiles/node_modules carried over from an
#     older home (a volume migrated with `cp -a` keeps the old owner) shadows the
#     installation, and because the profile declares no dependencies NOTHING ever
#     rebuilds it — so plugin resolution fails with "plugin(s) failed to load:
#     … could not be resolved" on every restart, and a chown does not help.
#     entrypoint.sh recognises that shape and says how to clear it.

# ── deployment patch ────────────────────────────────────────────────────────
# Applied by entrypoint.sh at start, NOT here: the profile — and therefore the
# client bundle this rewrites — only exists once dsh has projected it into
# $DSH_HOME at boot. See the note above.

# ── boot smoke test ─────────────────────────────────────────────────────────
# Prove the image can boot a profile AT ALL, from an EMPTY home, which is exactly
# what the container does on a first start. `--dump-config` cannot prove this: it
# composes the config tree without ever importing the plugin modules, so it
# succeeds on a tree that cannot load — that gap is how a broken deployment got
# as far as a restart loop.
#
# `timeout` exiting 124 means the server was still up when the clock ran out:
# that is the success signal. Any other exit code means it crashed on the way up,
# and its first log lines are printed to say why.
RUN set -eux; \
    DSH_NPM_BIN="$(cat /tmp/dsh-npm-bin.path)"; \
    mkdir -p /tmp/dsh-boot-check; \
    status=0; \
    timeout 60 env DSH_HOME=/tmp/dsh-boot-check DSH_TRUSTED_HOSTS=localhost \
      node "${DSH_NPM_BIN}" web --no-open > /tmp/dsh-boot.log 2>&1 || status=$?; \
    sed -n '1,40p' /tmp/dsh-boot.log; \
    echo "--- the profile projected $(ls /tmp/dsh-boot-check/profiles/node_modules/@deepseek-ai 2>/dev/null | wc -l) packages ---"; \
    ls /tmp/dsh-boot-check/profiles/node_modules/@deepseek-ai 2>/dev/null | grep -iE 'sandbox|addon' || echo '(no sandbox/addon packages projected)'; \
    echo '--- can Node resolve these from the profile directory? ---'; \
    mkdir -p /tmp/dsh-boot-check/profiles/web; \
    for m in @deepseek-ai/dsh-base @deepseek-ai/dsh-sandbox-local @deepseek-ai/node-addon-system/landlock-run; do \
      printf 'resolve %s -> ' "$m"; \
      (cd /tmp/dsh-boot-check/profiles/web && node -p "require.resolve('$m')" 2>&1 | head -n 1) || true; \
    done; \
    if grep -q 'plugin tree failed to load' /tmp/dsh-boot.log; then \
      echo 'the plugin tree does not load: this image cannot boot a profile'; \
      exit 1; \
    fi; \
    if [ "$status" != "124" ]; then \
      echo "the GUI exited on its own with status ${status} instead of staying up (124 = timed out while running, the success case)"; \
      exit 1; \
    fi; \
    echo 'the GUI booted from an empty home and stayed up for 60s'; \
    echo "projected profile packages: $(ls /tmp/dsh-boot-check/profiles/node_modules/@deepseek-ai | wc -l)"; \
    rm -rf /tmp/dsh-boot-check /tmp/dsh-boot.log

# ── unprivileged identity ───────────────────────────────────────────────────
# A fresh named volume inherits this owner. compose.yaml overrides the runtime
# uid/gid with DSH_UID/DSH_GID so the container matches the host owner of the
# workspaces bind mount; this build-time value is the default for a bare
# `docker run`.
RUN groupadd --gid "${DSH_GID}" node 2>/dev/null || true; \
    useradd --uid "${DSH_UID}" --gid "${DSH_GID}" --create-home --shell /bin/bash node 2>/dev/null || true; \
    chown -R "${DSH_UID}:${DSH_GID}" /data/dsh /workspaces
USER ${DSH_UID}:${DSH_GID}

WORKDIR /workspaces

# Documentation only: 3080 is served by the caddy service, never published by
# this one.
EXPOSE 3080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dsh-entrypoint"]
# The entrypoint owns the subcommand (`web`); the CMD carries extra app
# arguments only, for example: command: ["--port", "9000"]
CMD []
