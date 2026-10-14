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
#   docker build -t dsh:0.1.5-rc.1 .

FROM python:3.11-slim-bookworm

ARG NODE_MAJOR=22
ARG DSH_VERSION=0.1.5-rc.1
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
RUN chmod 0755 /usr/local/bin/dsh-entrypoint \
 && chmod 0755 /usr/local/bin/dsh-patch-client-settings.mjs \
 && chmod 0644 /usr/local/bin/dsh-doctor.mjs

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
# This step is deliberately FATAL on an anchor mismatch. A silently unpatched
# image looks exactly like a working one until a user opens the Models page, so
# the build is the only place where the failure is cheap. entrypoint.sh re-runs
# the same script with --check at every start, but only warns.
RUN node /usr/local/bin/dsh-patch-client-settings.mjs

# ── build-time self-check ───────────────────────────────────────────────────
# The `--dump-config` check is the valuable one: it makes dsh compose the whole
# `web` profile tree, forcing Node to resolve every plugin import. A missing
# package aborts the BUILD here instead of leaving an image whose GUI
# crash-loops with "plugin tree failed to load". It uses a throwaway home so the
# real one stays clean.
RUN set -eux; \
    DSH_NPM_BIN="$(cat /tmp/dsh-npm-bin.path)"; \
    mkdir -p /tmp/dsh-build-check; \
    DSH_HOME=/tmp/dsh-build-check node "${DSH_NPM_BIN}" --profile web --dump-config >/dev/null; \
    echo 'npm CLI composed the web profile: every plugin import resolved'; \
    rm -rf /tmp/dsh-build-check

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
