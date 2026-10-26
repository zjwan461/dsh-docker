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
#   * Node.js 22 comes from NodeSource. Node >= 22.19 is mandatory in 0.2.1-rc.2:
#     `@deepseek-ai/libreoffice-kit` (pulled in by the web profile) declares
#     engines.node ">=22.19.0", and commander@15 needs >= 22.12. NodeSource's
#     22.x line is past both, and the build asserts the version instead of
#     trusting that.
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
#   docker build -t dsh:0.2.1-rc.2 .

FROM python:3.11-slim-bookworm

ARG NODE_MAJOR=22
ARG DSH_VERSION=0.2.1-rc.2
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

# ── python libraries: document generation + the everyday numeric stack ──────
# The python interpreter arrives with the base image; everything here is what
# turns it from "present" into a capability the agent reaches for. One single
# `pip install`, so it is one layer.
#
# Three groups, and the reason each one is here:
#
#   * document generation — python-pptx + Pillow are what the bundled pptx
#     workflow drives, python-docx / openpyxl cover Word and Excel. Without them
#     the agent answers "please pip install python-pptx", and pip in here needs
#     egress and time.
#   * numeric / data — numpy, pandas, scipy, matplotlib. matplotlib plots to
#     files with no display (Agg, pinned below), and Chinese labels come out as
#     text instead of boxes because fonts-noto-cjk is already in the layer above
#     — it only has to be selected:
#       rcParams['font.sans-serif'] = ['Noto Sans CJK SC']
#   * fetch / parse — requests, beautifulsoup4, lxml, PyYAML: the import header
#     of nearly every script the agent writes.
#
# Roughly 200–250 MB unpacked, so it multiplies this layer several times over.
# Build with --build-arg INSTALL_PYTHON_DOCS=0 (or INSTALL_PYTHON_DOCS=0 in .env)
# to leave all of it out.
#
# The argument keeps its old name on purpose: the list started as document
# libraries only and existing .env / compose files already set
# INSTALL_PYTHON_DOCS. Read it as "python libraries", not "python docs".
#
# Deliberately still absent: scikit-learn (another ~150 MB on top of
# numpy/scipy for models no skill trains) and markitdown (drags in magika +
# onnxruntime for file-type detection — a second doubling for a converter
# LibreOffice and pandoc already cover). Both are one line away when a task
# really calls for them.
#
# No-op when the layer is off, but declared outside the branch because ENV
# cannot be conditional: Agg keeps matplotlib from hunting for a backend and
# rules out a stray Tk import in a container with no display.
ENV MPLBACKEND=Agg
ARG INSTALL_PYTHON_DOCS=1
RUN set -eux; \
    if [ "${INSTALL_PYTHON_DOCS}" = "1" ]; then \
      pip install --no-cache-dir \
        python-pptx \
        python-docx \
        openpyxl \
        Pillow \
        numpy \
        pandas \
        scipy \
        matplotlib \
        requests \
        beautifulsoup4 \
        lxml \
        PyYAML; \
      python3 -c 'import numpy, pandas, scipy, pptx, docx, openpyxl, PIL, requests, bs4, lxml, yaml; print("python libraries import clean")'; \
      python3 -c 'import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt; plt.figure().savefig("/tmp/mpl-smoke.png"); print("matplotlib Agg renders to a file")'; \
      rm -rf /root/.cache/matplotlib /tmp/mpl-smoke.png; \
    else \
      echo 'INSTALL_PYTHON_DOCS=0: document-generation and numeric libraries are NOT in this image'; \
    fi

# ── Node.js 22 ──────────────────────────────────────────────────────────────
# The NodeSource setup script imports its signing key itself (dearmor), so no
# gnupg package is required on the image.
#
# The version assertion is not decoration. 0.2.1-rc.2 pulls
# `@deepseek-ai/libreoffice-kit` into the web profile, whose engines field is
# ">=22.19.0"; on an older 22.x the profile still composes but that package's
# code (and anyone reading its engines field) disagrees with the runtime. Assert
# the floor here, where the failure is one line instead of a plugin error later.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh \
 && bash /tmp/nodesource_setup.sh \
 && rm -f /tmp/nodesource_setup.sh \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && node --version \
 && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error(`ERROR: node ${process.versions.node} is below the 22.19 floor this dsh release needs (@deepseek-ai/libreoffice-kit engines.node)`); process.exit(1); } console.log("node meets the 22.19 floor");'

# ── dsh CLI + pnpm ──────────────────────────────────────────────────────────
# pnpm is required because `dsh plugin --profile <name> <args>` forwards to it.
#
# `@deepseek-ai/dsh-session-title-llm` is installed EXPLICITLY even though
# nothing lists it as a regular dependency. The real chain is:
#
#     @deepseek-ai/dsh -> @deepseek-ai/dsh-session-title-llm[peer of:]
#                      -> @deepseek-ai/dsh-session-title-first-prompt-llm
#
# i.e. a nested plugin peer-depends on it (exactly `0.2.1-rc.2` since 0.2.1).
# npm >= 7 installs peers itself, so this line is belt-and-braces: it makes the
# tree independent of npm's peer behaviour and of `--legacy-peer-deps`, and when
# the package IS deduped there is still exactly one copy on disk.
#
# The version MUST stay pinned to DSH_VERSION: this package's `latest` dist-tag
# is 0.0.1-rc.1 — a stale release that does not match the CLI — so an unpinned
# name would install the wrong thing.
RUN npm install --global --no-fund --no-audit \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "@deepseek-ai/dsh-session-title-llm@${DSH_VERSION}" \
      pnpm

# ── why no bundle pins here ─────────────────────────────────────────────────
# An earlier revision ALSO installed dsh-base / dsh-sandbox-local /
# dsh-bash-sandbox / dsh-fs-sandbox at the top level, to stop prerelease ranges
# from floating. That cure was worse than the disease: a top-level install lands
# at the npm global ROOT while the CLI's own dependencies nest under
# <cli>/node_modules, so the same package ends up on disk TWICE. Anything keyed by
# module or context IDENTITY then breaks, and it breaks in ways that never mention
# duplicates:
#
#     Agent preset binding requires a scoped context       (scope keys are
#                                                          identity-compared objects)
#     dsh: profile reload requires the root Include entry   (the booted root Include
#                                                          entry lives in a WeakMap
#                                                          keyed by the root context)
#
# FLOAT ITSELF IS GONE in 0.2.1-rc.2: every one of the ~1300 intra-family
# dependency and peer entries is an EXACT version (`"@deepseek-ai/dsh-base":
# "0.2.1-rc.2"`), not a `^0.2.x-rc.y` range. So the tree is deterministic for a
# given DSH_VERSION, and the assertion further down exists to catch the two things
# that can still go wrong: an npm that skips the linux-x64 optional dependency,
# and a duplicate copy at two locations. Choosing the newest release of its line
# is still the right rule for a line that DOES use ranges (0.1.5.x, 0.2.0.x); see
# the DSH_VERSION note in .env.example.
#
# The @deepseek-ai/dsh-session-title-llm pin above stays for an unrelated reason:
# its `latest` dist-tag is a stale 0.0.1-rc.1, so leaving it unpinned would fetch a
# release that does not match the CLI.

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
# The web profile resolves its plugins from THIS tree. Since 0.2.1-rc.2 there is
# no symlink projection into $DSH_HOME at all: `dsh-app-boot` computes a runtime
# resolution over the installation at every start. The profile still declares no
# dependencies (`dependencies: {}`), so a package that is missing here cannot be
# recovered from anywhere — not from the profile, and not from the registry at
# runtime, because this container has no npm egress by design.
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
# The list below is deliberately the set whose absence produces a confusing
# failure rather than a clear one:
#   dsh-base / dsh-web-app      the two bundles the web profile names
#   *-sandbox / sandbox-policy  the Linux confinement rung (see the doctor)
#   dsh-host-webserver          the row the bind overlay targets
#   dsh-client-connection       the browser bundle patch-client-settings edits
#   dsh-web-frontend            the built SPA the GUI serves
#   node-addon-system           the Landlock launcher module
#
# The check RESOLVES each package the way the runtime will, anchored at the CLI's
# own package.json: that covers the nested tree AND the npm global root (the global
# root is an ancestor node_modules directory), and it does not guess at a layout.
# An earlier version tested two hardcoded directories, which reports a false
# "missing" as soon as npm hoists differently. The boot smoke test after this is
# what actually proves the composed profile loads; this step makes a failure name
# the package instead of the import site.
RUN set -eux; \
    DSH_PKG_DIR="$(dirname "$(dirname "$(cat /tmp/dsh-npm-bin.path)")")"; \
    TREE="${DSH_PKG_DIR}/node_modules/@deepseek-ai"; \
    GLOBAL="$(npm root -g)/@deepseek-ai"; \
    pkg_version() { \
      node -e 'const { createRequire } = require("node:module"); const { dirname, join } = require("node:path"); const { readFileSync } = require("node:fs"); const req = createRequire(process.argv[1] + "/package.json"); let dir; try { dir = dirname(req.resolve("@deepseek-ai/" + process.argv[2] + "/package.json")); } catch { process.exit(1); } try { process.stdout.write(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version); } catch { process.stdout.write("?"); }' "${DSH_PKG_DIR}" "$1" 2>/dev/null || true; \
    }; \
    echo "--- npm $(npm --version) from $(command -v npm), npm root -g: $(npm root -g) ---"; \
    echo "--- plugin packages: $(ls "$TREE" 2>/dev/null | wc -l) beside the CLI, $(ls "$GLOBAL" 2>/dev/null | wc -l) at the global root ---"; \
    missing=""; \
    for p in dsh-base dsh-web-app dsh-sandbox-local dsh-bash-sandbox dsh-fs-sandbox dsh-host-webserver dsh-client-connection dsh-web-frontend node-addon-system; do \
      if [ -z "$(pkg_version "$p")" ]; then missing="${missing} ${p}"; fi; \
    done; \
    if [ -n "${missing}" ]; then \
      echo "ERROR: the global install is missing:${missing}"; \
      ls -la "$TREE" 2>/dev/null | head -40 || true; \
      ls -la "$GLOBAL" 2>/dev/null | head -40 || true; \
      exit 1; \
    fi; \
    mismatched=""; \
    echo "--- resolved versions (every one must equal DSH_VERSION=${DSH_VERSION}) ---"; \
    for p in dsh-base dsh-web-app dsh-sandbox-local dsh-bash-sandbox dsh-fs-sandbox dsh-pwsh-sandbox dsh-sandbox-policy dsh-host-webserver dsh-client-connection; do \
      v="$(pkg_version "$p")"; \
      if [ -z "${v}" ]; then v="missing"; fi; \
      echo "  ${p} ${v}"; \
      if [ "${v}" != "${DSH_VERSION}" ]; then mismatched="${mismatched} ${p}@${v}"; fi; \
    done; \
    if [ -n "${mismatched}" ]; then \
      echo "ERROR: these packages are not at DSH_VERSION=${DSH_VERSION}:${mismatched}"; \
      echo 'Every @deepseek-ai/dsh-* dependency in 0.2.1-rc.2 is an EXACT version, so a'; \
      echo 'mismatch here means the install was mixed (a second copy from the global'; \
      echo 'root, a stale node_modules layer, or a different DSH_VERSION in .env).'; \
      echo 'Rebuild without the npm cache: docker compose build --no-cache dsh'; \
      exit 1; \
    fi; \
    echo 'every package the web profile needs is installed, all at one version'

# ── deployment patch: settings UI document actions on a remote origin ───────
# The client connection defines, in the BROWSER:
#
#     isLoopback: transport?.ownsHost === true || pageLocation === void 0
#              || isLoopbackHostname(pageLocation.hostname),
#
# and `dsh-client-ui-settings-general` gates a controller on it:
#
#     ctx.remote.$host.isLoopback ? new SettingsDocumentStore(...) : void 0
#
# On a domain-served deployment none of the three conditions is true, so the
# General page loses its settings-document actions. The script rewrites that one
# definition, anchoring on the whole expression rather than a line number and
# validating that the result parses.
#
# What changed in 0.2.1-rc.2, and why this note exists:
#   * the browser bundle MOVED from lib/client.js to lib/client.browser.js and is
#     published through exports["./client"]; the script now reads that field, so
#     it follows the package instead of a filename;
#   * the Models page no longer uses this flag — it reads and writes the host
#     document through `remote.settings`, which works on any origin the trust
#     fence admits. The patch is kept for the General page's document actions.
#
# The patched file IS what the browser runs: dsh-client-modules resolves each
# plugin's client bundle from disk and serves it under /plugins/<id>/, so no
# monorepo build, no fork and no per-release rebase are needed.
#
# It is applied HERE, as root, and nowhere else can work. The file it rewrites
# belongs to the npm global installation:
#
#   /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.browser.js
#
# That tree is root-owned while the container runs as the unprivileged DSH_UID, so
# a runtime attempt can only ever end in
#
#   cannot stage a file in .../dsh-client-connection/lib (EACCES)
#
# and — unlike ≤0.2.0 — there is not even a symlinked copy in the profile, because
# 0.2.1 no longer projects the installation there. Patching the installation copy
# IS patching what the browser loads, because dsh-client-modules serves the file
# it resolves. entrypoint.sh re-runs this script with --check on every start and
# only warns, which covers a plugin package reinstalled by `dsh plugin`.
#
# The `--check` after the apply is a build gate: without it, a release that renames
# the expression again would ship an image whose log line admits the patch never
# landed. With it, the build fails and names the new file to grep.
RUN node /usr/local/bin/dsh-patch-client-settings.mjs \
 && node /usr/local/bin/dsh-patch-client-settings.mjs --check --quiet \
 && echo 'settings-UI patch applied to the installation copy'

# ── bundled plugins ─────────────────────────────────────────────────────────
# Everything under plugins/ ships into the image at /opt/dsh-plugins and is
# ENABLED AT CONTAINER START, not here, because a profile only exists once dsh
# has composed it. entrypoint.sh does two things per plugin:
#
#   1. links the package into $DSH_HOME/profiles/node_modules, so the plugin rows
#      in the composed tree can resolve it. Since 0.2.1-rc.2 those symlinks are
#      exactly what `dsh-app-boot` calls a "linked root": it registers every
#      symlink pointing outside the profiles tree by package name, and nothing
#      unlinks them during boot (removeLinkProjections only removes the ≤0.2.0
#      `.dsh-module-fallback` farm);
#   2. appends the bundle's own patch layer to $DSH_HOME/cordis.patch.yml, the
#      home-level patch applied over every profile's layer, which is also why the
#      first start already has the plugin. It is seeded ONCE, so the options you
#      edit there are never overwritten by a later start.
#
# A plugin directory must be a dsh bundle: a package.json with a name that
# resolves, an entry point that exists, and — when it declares
# `dsh.bundle.patch` — the patch file(s) it names. `patch` is one path OR an
# ordered list (dsh-web-app itself uses a list in 0.2.1-rc.2), so both shapes are
# validated here and both are seeded by entrypoint.sh, in order. The checks below
# fail the build rather than shipping an image whose GUI silently loses plugins.
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
      patches="$(node -p "const p = require('${manifest}').dsh?.bundle?.patch; Array.isArray(p) ? p.join(' ') : (p ?? '')")"; \
      for one in $patches; do \
        if [ ! -f "${dir}${one}" ]; then echo "ERROR: ${name}: dsh.bundle.patch ${one} does not exist"; exit 1; fi; \
      done; \
      echo "bundled plugin: ${name}  entry: ${entry}  patch: ${patches:-none}"; \
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
# plugin set is named by `dsh.profile.bundles` (web = dsh-base + dsh-web-app) and
# resolved AT BOOT from the installation — dsh-app-boot describes it as wiring
# "the installation and selected bundles to Node's ESM and CommonJS resolvers",
# and it only installs what "the installation does not supply".
#
# Two consequences:
#   * nothing needs the npm registry at runtime, so there is nothing to bake;
#   * the profile directory must NOT be treated as a package farm. 0.2.1-rc.2
#     removed the symlink projection that ≤0.2.0 wrote into
#     $DSH_HOME/profiles/node_modules, so in 0.2.1 that directory holds only the
#     bundles this entrypoint links. A leftover projection from an older home is
#     inert (it points at the same absolute installation paths) but is dead
#     weight, and it is exactly what used to shadow the installation and fail
#     plugin loading after an upgrade. entrypoint.sh recognises that shape and
#     prints how to clear it.

# ── deployment patch ────────────────────────────────────────────────────────
# Applied above, at build time, against the npm installation. There is no longer
# a profile copy to patch at boot: 0.2.1 does not project the installation into
# $DSH_HOME. entrypoint.sh only re-verifies it with --check.

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
#
# The resolution probe is anchored at the INSTALLATION, not at the profile: since
# 0.2.1-rc.2 the profile has no node_modules projection, so the ≤0.2.0 version of
# this step (resolve from /profiles/web) would print failures while the server was
# perfectly healthy. This probes the place the runtime resolution actually points
# at.
RUN set -eux; \
    DSH_NPM_BIN="$(cat /tmp/dsh-npm-bin.path)"; \
    DSH_PKG_DIR="$(dirname "$(dirname "${DSH_NPM_BIN}")")"; \
    mkdir -p /tmp/dsh-boot-check; \
    status=0; \
    timeout 60 env DSH_HOME=/tmp/dsh-boot-check \
      node "${DSH_NPM_BIN}" web --no-open > /tmp/dsh-boot.log 2>&1 || status=$?; \
    sed -n '1,40p' /tmp/dsh-boot.log; \
    echo "--- profile node_modules entries: $(ls /tmp/dsh-boot-check/profiles/node_modules 2>/dev/null | wc -l) (0 is expected: 0.2.1+ projects nothing) ---"; \
    echo '--- can Node resolve these from the installation? ---'; \
    for m in @deepseek-ai/dsh-base @deepseek-ai/dsh-sandbox-local @deepseek-ai/node-addon-system/landlock-run @deepseek-ai/dsh-client-connection/client; do \
      printf 'resolve %s -> ' "$m"; \
      (cd "${DSH_PKG_DIR}" && node -p "require.resolve('$m')" 2>&1 | head -n 1) || true; \
    done; \
    echo '--- did the composed profile name the two web bundles? ---'; \
    node -p "require('/tmp/dsh-boot-check/profiles/web/package.json').dsh.profile.bundles.join(' ')" || exit 1; \
    if grep -q 'plugin tree failed to load' /tmp/dsh-boot.log; then \
      echo 'the plugin tree does not load: this image cannot boot a profile'; \
      exit 1; \
    fi; \
    if [ "$status" != "124" ]; then \
      echo "the GUI exited on its own with status ${status} instead of staying up (124 = timed out while running, the success case)"; \
      exit 1; \
    fi; \
    echo 'the GUI booted from an empty home and stayed up for 60s'; \
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
