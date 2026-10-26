# 在 Docker 里跑 DeepSeek Harness（dsh）

面向「本地 Linux 服务器 + Docker」的部署模板：**一个镜像、一个服务、一个对外入口**。DSH 只监听容器内网，唯一的对外入口是 Caddy 的 TLS 端口。

```
浏览器   ──HTTPS(443)──>  caddy  ──HTTP(compose 网络)──>  dsh :3080        （Web GUI，不发布端口）
           dsh.example.com
```

**只有一个对外端口:443，只服务一个站点。** Caddy 是这个栈唯一的网络入口：

- 宿主机只需一个端口要放通、要保证空闲;
- Caddy 的内部 CA 对**所有**主机名只有**一个根证书**,浏览器只做**一次**信任决定。

`dsh` 是唯一的服务：**Web GUI**，entrypoint 是 `dsh-entrypoint`，最终 exec `dsh web`。镜像基于 `python:3.11-slim-bookworm` + NodeSource 的 Node 22（glibc；**不要换 Alpine**，musl 下 `node-pty` 会退化成源码编译）。

### 为什么不加 nginx（架构决定，勿重复讨论）

Caddy 已经同时承担了**域名虚拟主机、TLS 终结、反向代理**三件事，再挂一层 nginx 会变成 `nginx(TLS) → caddy(TLS) → dsh`：两个 TLS 终结者、证书要管两处，而浏览器信任的始终只是最外层那一张，纯属多一跳。

- **想用 CA 的证书**：不需要 nginx，走下面的 Option B，把证书文件喂给 Caddy 即可。证书由谁签发 ≠ 必须由谁托管。
- **只有一种情况值得引入 nginx**：TLS 必须在**集中入口**（已有的 nginx / F5 / LB）终结。那时的正确做法是**把 compose 里的 caddy 服务整个删掉**，让 nginx 直接反代 dsh，而不是两层叠加。届时必须做到五件事：`proxy_set_header Host $host`（nginx 默认是 `$proxy_host`，会导致 /api 信任围栏 403）、`proxy_buffering off`（SSE）、WebSocket upgrade 头、`client_max_body_size` 提到 300m 以上（否则上传 413）、以及明文那一跳只允许走 loopback 或 compose 内网。

## 为什么是这样设计的（都是对着 `@deepseek-ai/dsh` 的 0.2.1-rc.2 源码核过的；0.1.5-rc.x / 0.2.0-rc.x 的结论仍然有效）

> 版本基线：本仓库已适配 **0.2.1-rc.2**（原为 0.2.0-rc.2）。0.2.1 改了六处**会直接影响本部署**的东西——profile 不再向 `$DSH_HOME` 投影安装树、设置页改为走 `remote.settings`、客户端 bundle 从 `lib/client.js` 拆成 `lib/client.browser.js`、`webserver` 行的 config 多了 `tls`、**该行不再接受 `0.0.0.0`**、**`.credentials.yaml` 必须 owner-only**——外加「依赖全部精确锁版」这一项顺带简化。逐条差异与升级动作见「[升级到 0.2.1-rc.2](#升级到-021-rc2)」。

| 事实 | 由此产生的设计 |
|---|---|
| CLI 依赖 `commander@15`（`>=22.12`），且 0.2.1-rc.2 的 `@deepseek-ai/libreoffice-kit` engines 为 `>=22.19.0` | Node 必须 ≥ 22.19，故用 NodeSource 在 Debian glibc 基线上装 Node 22；**构建期断言**这个下限 |
| `node-pty` 自带 `prebuilds/linux-x64`，`sharp`/`ripgrep`/`landlock-run` 都是预编译 npm 包 | 镜像里不需要 gcc/python-dev；**不要用 Alpine**（musl 下 `node-pty` 会退化成源码编译） |
| Linux 沙箱链是 `bwrap → Landlock`，按顺序探测，两者都不可用则 fail closed（`SANDBOX_UNAVAILABLE`） | 镜像**故意不装 bubblewrap**，让容器稳定落到无需任何特权的 Landlock |
| `dsh web --host 0.0.0.0` 被 CLI 拒绝；**0.2.1 起连 `webserver` 行的 `host` 也拒通配地址**（只接受具体 IPv4/IPv6 字面量，主机名也不行），而且这个校验只在插件激活时跑，`--dump-config` 看不出来 | 用 `--patch` 覆盖层把 `webserver` 行的 `host` 改成**容器自己的 IPv4**（entrypoint 每次启动探测，写进 `/data/dsh/.runtime/bind-host` 供 healthcheck 与 `verify.sh` 使用）；caddy 用 `dsh:<port>` 按名字连，自动跟上。**该行的 `config` 在 0.2.1 还多了一个 `tls`，覆盖层必须一并重述**，否则命令行给的 `--tls-cert/--tls-key` 会被静默丢掉 |
| 每个请求要过 Host/Origin 信任围栏，`--trusted-host` 决定放行哪些 authority | 必须设置 `DSH_TRUSTED_HOSTS` 为浏览器实际使用的 `host`，否则 403。0.2.1 的 `--trusted-host <authority...>` 是可重复的变参，entrypoint 仍一个 authority 一个 flag（两种语义下都成立） |
| 会话 cookie 故意不带 `Secure` 标志（项目假设 loopback HTTP） | **绝不要**为同一域名再开明文 HTTP；只发布 TLS 端口并上 HSTS |
| 首次访问需要 `?token=...` 换取签名 cookie，密钥持久化在 `$DSH_HOME/.credentials.yaml` | 卷要持久化（同一签名密钥 ⇒ cookie 在重启后仍可复用） |
| **0.2.1 起** `$DSH_HOME/.credentials.yaml` 必须是 owner-only（group/other 位为 0），否则 `credentials` 插件在 init 阶段就报错退出，连带 `connection`/`authorization`/`deepseek-account` 全部不激活 ⇒ 容器起不来 | entrypoint 每次启动检查并 `chmod 600`；容器内改不动时直接报出宿主上的修复命令。绑定目录在 Windows/macOS 上生成的文件常见 0777，这是升级后最常见的启动失败 |
| `DSH_*` 前缀变量是 bootstrap-only，不能来自任何 `.env` | `DSH_HOME` 等必须用 compose `environment` 传 |
| 凭据解析顺序：继承环境 > `$DSH_HOME/.credentials.yaml` > cwd `.env` > `$DSH_HOME/.env` | `DEEPSEEK_API_KEY` 用真实环境变量传，避免被工作区里克隆来的 `.env` 劫持 |
| 首次初始化 profile 会写入 `cordis.patch.yml`（模板内容仍是 `[]` 文档） | entrypoint 不改这个文件（往 `[]` 后追加会得到非法 YAML），改用 `--patch` 覆盖层 |
| SIGTERM 会优雅退出（最多 5 秒） | `stop_grace_period: 15s`，用 tini 做 PID 1 转发信号 |
| 一个 harness home 只能装一份 dsh（profiles/ 下同一份 profile 目录） | 本部署只有一个服务：`./data/dsh` 以**目录 bind mount** 挂到 `/data/dsh`。不用命名卷、也不用单文件挂载——设置提供方落盘走「临时文件 + rename」，单文件挂载时 rename 的目标是挂载点（EBUSY），`:ro` 则是 EROFS；只有目录挂载能让宿主编辑与 UI 保存写同一个真文件 |

## 文件清单

| 文件 | 作用 |
|---|---|
| `Dockerfile` | `python:3.11-slim-bookworm`（glibc 基线；选它不是因为需要 Python，而是因为这是目标主机上已验证过、且能拿到预编译 glibc 原生依赖的配置）+ NodeSource Node 22 + 全局 `@deepseek-ai/dsh` + `pnpm` + 常用工具层（见「镜像里预装了什么」）；构建期用 `--dump-config` 自检整个 `web` profile |
| `entrypoint.sh` | 预检目录可写性 → 打印沙箱体检结论 → 生成 `--patch` 覆盖层并自检 → exec dsh |
| `doctor.mjs` | 启动时探测并打印 Landlock runner 的实际可用性 |
| `compose.yaml` | `dsh`（不发布端口）+ `caddy`（TLS 入口，唯一对外端口）；|
| `Caddyfile` | TLS 终结、HSTS、SSE/WebSocket 免缓冲透传、可选 basic_auth |
| `.env.example` | 所有可调项 |
| `verify.sh` | 在**物理机**上逐层验证 GUI 链路（DNS→TLS→Caddy→信任围栏→token→cookie→/api→WebSocket），失败项直接给出排查命令 |
| `data/dsh/settings.yaml` | 服务端配置（提供方/端点/模型），mock 值可直接用。位于 `./data/dsh` 目录挂载内（容器路径 `/data/dsh/settings.yaml`）：**宿主编辑会热重载，Models 页保存也会落到这个文件** |
| `patch-client-settings.mjs` | 给浏览器 bundle 打补丁，让域名访问时 General 设置页仍能操作宿主设置文档（见「设置页为什么现在能用」）。**构建期以 root 应用、随后 `--check` 复核**——它改的文件在 root 所有的 npm 全局安装树里，0.2.1 起 profile 里连符号链接副本都没有了，运行时 uid 无论怎么写都只能 EACCES。entrypoint 每次启动再 `--check` 一次 |
| `workspaces/` | 工作区 bind mount 源目录 |
| `skills/` | 内置（bundled）技能目录；构建时 COPY 到镜像 `/opt/dsh-skills`。**目前故意为空**，机制已就绪 |
| `LICENSE` | Apache License 2.0 全文（与官方文本逐字节一致） |

## 镜像里预装了什么

这是一个**给 agent 用的工作环境**：容器里少一个命令，任务就多一次联网安装，或者直接卡死。所以常用工具预装在镜像里，按「解锁了什么」分组。

### 基础工具（始终安装）

| 类别 | 包 |
|---|---|
| 传输 | `curl` `wget` `rsync` |
| 版本控制 | `git` `openssh-client` |
| 压缩包 | `unzip` `zip` `p7zip-full` `bzip2` `zstd` `xz-utils` |
| 查看/检查 | `file` `jq` `tree` `sqlite3` |
| 编辑 | `vim-tiny` `nano` —— **没有编辑器的话，改容器内的 `/data/dsh/settings.yaml` 就只能靠 `docker cp`** |
| 运行/信号 | `less` `procps` `tini` |
| 文本搜索 | `ripgrep`（dsh 自带 `@vscode/ripgrep`，但 agent 自己的 shell 需要一个 `rg` 在 PATH 上） |
| 网络排障 | `iproute2`（`ss`/`ip`）`bind9-dnsutils`（`dig`）`iputils-ping` `netcat-openbsd` |
| 时区 | `tzdata` —— 否则 compose 里的 `TZ` 会被一部分工具静默忽略 |

### 文档 / PDF / 媒体（始终安装）

| 包 | 用途 |
|---|---|
| `poppler-utils` | `pdftotext` / `pdftoppm` / `pdfinfo` —— PDF 转文本、PDF 转图片，agent 最常用的两个 PDF 操作 |
| `qpdf` | 合并、线性化、解密 |
| `ghostscript` | PDF 后处理；也是 LibreOffice / pandoc 若干导出路径的硬依赖 |
| `imagemagick` | `convert` / `identify` / `montage`（与 GUI 自带的 sharp 功能重叠，但 shell 里需要的是**命令**，不是库） |
| `ffmpeg` | 转码、抽帧、生成缩略图、音视频封装 |
| `sox` | 轻量音频处理（裁剪、重采样、拼接） |
| `libimage-exiftool-perl` | 读写 EXIF：给生成图打标、检查相机或模型写了什么 |
| `fonts-dejavu-core` `fonts-noto-cjk` `fonts-noto-color-emoji` | **`fonts-noto-cjk` 是关键**：没有 CJK 字体，中文在 LibreOffice / pandoc / 预览渲染里全是**豆腐块** |

### 可选层（`.env` 开关，默认开）

| 开关 | 装上什么 | 量级 |
|---|---|---|
| `INSTALL_OFFICE=1` | `libreoffice-core/writer/calc/impress` + `pandoc` | **约 500MB 以上** |
| `INSTALL_PYTHON_DOCS=1` | 文档生成 `python-pptx` `python-docx` `openpyxl` `Pillow`；数值栈 `numpy` `pandas` `scipy` `matplotlib`；抓取/解析 `requests` `beautifulsoup4` `lxml` `PyYAML` | 约 200–250MB |

`INSTALL_PYTHON_DOCS` 这个名字比内容窄了：这一层早已不只是文档库（当时只有后面 4 个）。参数名保留是为了不和已有的 `.env` / `compose.yaml` 冲突，读作"Python 库"即可。`matplotlib` 走 Agg 后端（`MPLBACKEND=Agg`），画图直接出文件；中文标签靠上一层已装的 `fonts-noto-cjk`，用前选一下字体：`rcParams['font.sans-serif'] = ['Noto Sans CJK SC']`。

没装的是 `scikit-learn`（在 numpy/scipy 之上再加 150MB 左右，技能里没有要训练的模型）和 `markitdown`（会拖进 magika + onnxruntime 做文件类型识别，为了一个 LibreOffice/pandoc 已经覆盖的转换器再翻一倍体积）——真需要时都是一行。

设成 `0` 可以瘦身，但**必须重新构建**（`docker compose build && docker compose up -d`）。

### profile 的插件树：0.2.1 起不再投影，运行时解析

`$DSH_HOME/profiles/web/package.json` 的 `dependencies` 是**空的**——插件集由 `dsh.profile.bundles`（web = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）指定。**谁把安装树接到 Node 的解析器上，0.2.1-rc.2 变了：**

| | ≤ 0.2.0-rc.2 | 0.2.1-rc.2 |
|---|---|---|
| 机制 | 启动时把安装树里的每个包 **symlink 投影**到 `$DSH_HOME/profiles/node_modules`（簿记目录 `<profile>/.dsh-module-fallback`） | **完全不投影**。`dsh-app-boot` 每次启动从安装树现算一份 runtime resolution，直接交给 Node 的 ESM/CJS 解析器 |
| `profiles/node_modules` 里的内容 | 安装树的镜像 | 只有**本 entrypoint 链接的自带插件** |
| 升级风险 | 旧 home 的投影会**遮蔽**安装树，且 profile 无依赖 ⇒ dsh 没东西可重装 ⇒ 永远坏，只能 `rm -rf` | 旧投影**不再致命**（它指向同一批绝对路径），但属于死重量；dsh 把它当「linked root」登记，不影响启动 |

三个实际结论：

- **运行时不需要 npm registry**，所以**没有东西可以预装**：`dsh plugin --profile web install` 只会回 `Already up to date`（构建里实测到的就是这个）。
- **自带插件靠「显式符号链接 + HOME 级 patch」接入**：entrypoint 把 `/opt/dsh-plugins/<name>` 链到 `profiles/node_modules/<name>`。这正是 0.2.1 认的 **linked root**（`linkedProfileRoots` 只收「指向 profiles 树之外」的符号链接，按包名登记给解析器），每次启动用 `ln -sfn` 重建，所以失效目标不会跨重启残留。
- **从 0.2.0 升级上来的 home 会带一份旧投影**：`profiles/node_modules/@deepseek-ai` 非空即为此。它不是错误、但也没用，entrypoint 会打印出来并给出清理命令（只删宿主目录，容器不动手）：

```bash
rm -rf data/dsh/profiles/node_modules && docker compose restart dsh
```

> 0.2.1 起删这个目录**不再有「删了就必须恢复才能启动」的风险**：dsh 不往里建东西，entrypoint 自己的插件链接下一次启动自动重建。

镜像里还有一道**启动冒烟测试**：构建期从**空 home** 真跑一次 `dsh web --no-open`，60 秒内自己退出即判失败。从空 home 跑是关键，那正是容器首启的路径；而 `--dump-config` 只组合配置、**不 import 插件模块**，坏树它照样「成功」。0.2.1 起冒烟测试的解析探针锚在**安装树**上（`profiles/web` 里已经没有可解析的东西了），并额外断言组合出来的 profile 确实点名了这两个 bundle。

LibreOffice 有两点值得说明：

- **装的是组件包，不是 `libreoffice` 元包**，且全程 `--no-install-recommends`。元包的 recommends 会把 gtk3、Java、邮件合并等桌面依赖拖进来，而 headless 转换不需要它们：

  ```bash
  soffice --headless --convert-to pdf --outdir /tmp deck.pptx
  ```

- **`pandoc` 生成 PDF 需要一个 PDF 引擎**，而 LaTeX 是几百 MB、**故意不装**。要 PDF 就用 LibreOffice 的 `--convert-to pdf`，或者 ghostscript。

### 故意不装的

`texlive-*`（几百 MB 起）、`chromium`/`xvfb`（HTML 截图或页面渲染才需要，体积很大）、`build-essential`（dsh 的原生依赖都走预编译 npm 包与 `node-addon-system`，不需要编译器）。

> 本机（Windows）没有 Docker，**无法测量确切体积**；上表给的是量级。构建后用 `docker image ls dsh` 看实际大小。

## 前置条件

- Docker + Compose v2（`docker compose version`）
- 宿主内核 **≥ 5.13**（Landlock ABI v1），且容器 seccomp 放行 landlock 系统调用——较新的 Docker/containerd 默认 profile 已放行
- 一个域名（公网 DNS 或内网 DNS/`/etc/hosts`）。**非公网域名拿不到公网证书**（`.local` 这类 RFC 6762 保留域更是永远拿不到），只能用 `tls internal` 或你自己的内部 CA 证书

> **本部署只需要一个域名，解析到本机，只用 443：**
>
> | 域名 | 用途 | 变量 |
> |---|---|---|
> | `dsh.example.com` | dsh Web GUI | `DSH_SITE_ADDRESS` |
>
>
> 这个名字必须在**服务器**和**每个客户端**上解析到本机。解析不到就等同于"服务不存在"。先验证:
>
> ```bash
> getent hosts dsh.example.com
> ```
>
> `verify.sh` 在服务器自己解析不到时会自动把名字钉到 `127.0.0.1`（`--resolve`），所以**容器侧仍然可以验证**，但浏览器侧必须真的能解析。

## 部署目标：把域名换成你自己的

`.env` 已按这个域名预置好（与 `.env.example` 同一份内容），需要动的只有 `DEEPSEEK_API_KEY`：

```ini
DSH_SITE_ADDRESS=dsh.example.com          # 只写 authority，不含 https://
DSH_TRUSTED_HOSTS=dsh.example.com
DSH_PUBLIC_PORT=443
```

三点说明：

1. **`DSH_TRUSTED_HOSTS` 必须是不带端口的裸域名。** 这是核对 `dsh-client-connection` 里 `isTrustedAuthority` 实现后的结论：

   ```js
   // 无端口条目 -> 只比 hostname；带端口条目 -> 比 host:port
   return canonical === entryUrl.hostname
     ? entryUrl.hostname === hostUrl.hostname
     : entryUrl.host === hostUrl.host;
   ```

   WHATWG 归一化会把 `https://` 的默认端口 443 变成「没有端口」，而浏览器访问默认端口的 HTTPS 时 Host 头本来就不带端口。所以 `dsh.example.com:443` **永远匹配不上**，裸域名才匹配（且对任意端口都成立）。entrypoint 检测到这种写法会直接在启动日志里告警。Origin 比对（`new URL(origin).host === hostUrl.host`）两边同样归一化，默认 443 不会造成 403。

2. **这个域名拿不到公网证书**（`example.com` 是文档保留域；`.local` 更是 RFC 6762 保留域），Caddy 不能走 ACME，因此 `Caddyfile` 里已用 `tls internal`（Caddy 内置本地 CA），并显式关掉了 :80 跳转监听。

3. **443 必须空闲**，先确认：

   ```bash
   sudo ss -ltnp 'sport = :443'
   ```

   如果这个域名现在指向的是**另一台**前置代理/负载均衡，或者本机 443 已被别的服务占用——告诉我，我把架构换成「DSH 发布到宿主 loopback + 你现有的前置代理反代过去」，而不是让 Caddy 直接占 443。

### 证书 Option A（当前采用，开箱可用，浏览器有警告）

Caddy 用内置 CA 为 `dsh.example.com` 签发证书。把它的**根证书**装进客户端信任库后警告消失：

```bash
# 导出根证书（两种等价写法，任选其一）
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
# docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt

# 确认导出的确实是 CA 证书：Issuer 与 Subject 都应显示 Caddy Local Authority
openssl x509 -in caddy-root.crt -noout -subject -issuer

# Windows 客户端：把 caddy-root.crt 拷过去，双击 ->
#   安装证书 -> 本地计算机 -> 受信任的根证书颁发机构 -> 完成
# macOS：双击导入「钥匙串访问」-> 系统 -> 设为「始终信任」
```

导入后打开 `https://dsh.example.com/`，证书颁发者应显示 `Caddy Local Authority` 且不再报警告。

> ⚠️ 这个 CA 只存在于 `caddy-data` 卷里：**删卷（`docker compose down -v`）会重新生成 CA**，所有客户端都要重新信任一次。想长期免维护，就在拿到内部 CA 签发的证书后切到 Option B。

> ℹ️ Caddy 启动日志里的 `installing root certificate ... certificate installed properly in linux trusts` 指的是它把 CA 装进**容器内**的信任库——对宿主机浏览器无效，容器一重建就失效，别被这条日志误导。

### 证书 Option B

1. 把证书与私钥放进 `dsh-docker/certs/`，例如 `dsh.example.com.crt` 和 `dsh.example.com.key`
2. 编辑 `Caddyfile`：注释掉 `tls internal`，取消注释 `tls /certs/...` 那行（文件名要与实际一致）
3. `docker compose restart caddy`

证书的 SAN 必须包含 `dsh.example.com`（现代客户端只认 SAN，不看 CN）。

## 快速开始

```bash
cd dsh-docker
$EDITOR .env                  # 只需填 DEEPSEEK_API_KEY，域名已预置

mkdir -p workspaces certs data/dsh     # 已存在则跳过（data/dsh 已随仓库带一份 settings.yaml）
sudo chown -R "$(id -u):$(id -g)" workspaces data/dsh   # 与 .env 里的 DSH_UID/DSH_GID 一致

docker compose up -d --build
docker compose logs -f dsh
```

## 首次登录

DSH 的登录 token 每次进程启动重新随机生成，只在日志里出现一次：

```bash
docker compose logs dsh | grep -o 'https\?://[^ ]*token=[A-Za-z0-9._-]*' | tail -1
```

把打印出的 URL 里的 `http://<容器地址>:3080` 换成 `https://` + 你的 `DSH_SITE_ADDRESS`（该变量只存 authority，scheme 在 Caddyfile 里）。0.2.1 起这个地址是**容器自己的 IPv4**（见「[升级到 0.2.1-rc.2](#升级到-021-rc2)」第 6 条），不要拿它直接访问，它只在 compose 网络内可达：

```
https://dsh.example.com/?token=xxxxx
```

打开后 `GET /` 会用 token 换一个签名 cookie 并跳转到干净 URL，之后按 cookie 认证（默认 30 天，签名密钥在持久卷里，所以容器重启后一般不需要重新取 token）。

> 为什么不能直接用日志里那个 URL：容器内看到的 LAN 地址是 bridge 网段（如 `172.20.0.3`），宿主机浏览器到不了。

### token 与登录状态的有效期（源码核对）

- **token 每个进程启动时随机生成**：`randomBytes(32)` → base64url **43 字符**，只存在于内存、不落盘，进程内固定（HMR / 插件重载不会换）。所以每次重启或重建容器都会换一个新 token。
- **但登录状态不是靠 token 维持的**：`GET /?token=...` 换来的是一个 HMAC-SHA256 签名的 cookie（`v1.<payload>.<sig>`，`HttpOnly; SameSite=Strict; Path=/`），签名密钥同样是 32 字节随机、**持久化在 `$DSH_HOME/.credentials.yaml`**，只在缺失时才生成。默认有效期 **30 天**（`cookieMaxAgeDays`，最小 1）。
- cookie 的 payload 里绑定了 `authority`（归一化后的 `host:port`），所以**换端口或换域名会让旧 cookie 失效**。

| 操作 | token | 已登录的浏览器 |
|---|---|---|
| `restart` / `up -d --build` | 换新 | ✅ 仍有效（密钥持久且未过期） |
| 改 `DSH_PUBLIC_PORT` 或域名 | 换新 | ❌ 需用新 token 重新登录 |
| 删掉 `data/dsh/.credentials.yaml` | 换新 | ❌ 密钥丢失，全部失效 |
| 删 `$DSH_HOME/.credentials.yaml` 后重启 | 换新 | ❌ 等于吊销所有会话 |
| 只清浏览器 cookie | 不变 | ❌ 用当前进程日志里的 token 重新登录 |
| 超过 30 天 | 不变（进程未重启时） | ❌ cookie 过期，重新登录 |

两点运维含义：

1. **重启不是吊销手段**——它换了 token，但已登录的浏览器照旧能用。要吊销所有人：
   `docker compose exec dsh rm /data/dsh/.credentials.yaml && docker compose restart dsh`
2. token **自身没有过期时间**，只要进程没重启，日志里那个链接就一直可用（这也是 30 天后还能靠它重新登录的原因）。它**等同于密码**，而且明文出现在 `docker logs` 里——不要贴进工单或聊天工具。


## 设置页为什么现在能用（本镜像的补丁）

### 0.2.1 之前：设置文档只能在 loopback 上编辑

`dsh` 决定「设置文档存在哪里」是在**浏览器里**做的，而且是硬编码：

```js
// dsh-client-ui-settings/lib/client.js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

`$host.isLoopback` 来自连接层自己的定义（`dsh-client-connection`）：

```js
isLoopback: transport?.ownsHost === true || pageLocation === void 0
          || isLoopbackHostname(pageLocation.hostname)
```

从域名访问时三项全不成立 → `persistence = "memory"` → Models 页读的是一份**会话内的**文档，于是报 `settings are available in this browser`。

### 0.2.1-rc.2：Models 页不再依赖这个标志

0.2.1 把设置读写改成了**服务端 RPC**：`dsh-client-ui-settings` 提供 `configForms` 服务，页面通过 `remote.settings.describe()` / `remote.settings.mutate()` 读写**宿主**的 `settings.yaml`（`SettingsDescribeMirror` + `ConfigFormController`）。这条路径只受 Host/Origin 信任围栏约束，**与 origin 是不是 loopback 无关**——`settings are available in this browser` 这句话在 0.2.1 的代码里已经不存在了。

`isLoopback` 只剩**一处消费者**：General 页的“设置文档动作”控制器。

```js
// dsh-client-ui-settings-general/lib/client.js
const documentController = ctx.remote.$host.isLoopback
  ? new SettingsDocumentStore(ctx, ctx.configForms.describe())
  : void 0;
```

### 本镜像怎么处理的

`patch-client-settings.mjs` 仍然把连接层那条 `isLoopback` 定义改成 `true`，**在构建期以 root 应用，随后立刻 `--check` 复核**。理由：

- **保留这个补丁**：General 页的文档动作是这套部署会用到的能力（导入/导出宿主设置文档），而 `isLoopback` 只是个客户端提示，把它置真不引入新的服务端信任。
- **不用编译源码。** 浏览器拿到的不是预构建产物：`dsh-client-modules` 从磁盘读每个插件的 client bundle 并以 `/plugins/<id>/…`（combo URL）提供。改这个文件就是改浏览器实际执行的东西——不用编译 monorepo、不用 fork、不用每次发版 rebase。
- **定位跟着包的 `exports` 走，不猜文件名。** 0.2.1 把客户端半边从 `lib/client.js` 劈成 `lib/client.browser.js` + `lib/client.node.js`，并挂到 `exports["./client"]` 上（`dsh-client-modules` 取其中的 `default`，也就是 browser 那份）。脚本现在读同一个字段，`lib/client.js` 只作为旧版本的兜底。
- **不依赖行号。** 锚点是整条表达式；匹配不到就打印「该用哪条 `grep` 去找上游的新写法」。写盘前用 `vm.Script` 校验语法（这比 `node --check` 更贴近浏览器：后者按扩展名和最近的 `package.json` 选模块系统，都不是浏览器看这份文件的方式），不通过就不落盘。路径定位先用 Node 解析器，再退回**跟随符号链接**的遍历。
- **补丁失败只告警、不致命**：没有它整个 GUI 照常工作，只有 General 页的文档动作缺失。

> **为什么补丁必须在构建期打**（踩过的坑，0.2.1 更彻底）：它改的文件属于 **npm 全局安装树**——`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.browser.js`。那棵树是 **root 所有**，而容器以非特权 `DSH_UID` 运行 ⇒ 运行时写入**必然 EACCES**（实测报错：`cannot stage a file in … (EACCES)`）。0.2.1 之前 profile 的 `node_modules` 里还有指向同一棵树的符号链接；0.2.1 连这份副本都不再生成，所以**安装树里这一份就是唯一一份**。`entrypoint.sh` 每次启动用 `--check` 复核，是为了抓「构建之后插件包被 `dsh plugin` 重装或替换」这种情况——那种情况下修法是重建镜像。

### 这不是安全回退，但确实放宽了一件事

`isLoopback` 是**客户端提示**，不是围栏：服务端仍然独立校验 Host/Origin 信任边界与 launch-token cookie，这个标志只决定页面编辑哪份文档。能带着有效 cookie 走到这些路由的攻击者，本来就能驱动容器内的 agent——那比读设置文档严重得多。

但设置页（0.2.1 起是 `remote.settings` 本身，补丁之前是 Models 页）确实让**远端浏览器可以读写 provider 凭据**（`settings.yaml` 里的 apiKey 字段）。这是有意识的取舍，见「安全边界」一节。

### 验证

```bash
# 启动日志里应出现（0.2.1 起还会先打一行 dsh version）：
docker compose logs dsh | grep -E 'dsh version|settings-UI patch'
#   [dsh] dsh version: 0.2.1-rc.2
#   [dsh] settings-UI patch present: the domain-served GUI edits the host document

# 手工复核（0.2.1 起文件叫 client.browser.js，且只在 npm 安装树里）：
# 先定位文件，再看那一行与补丁标记
docker compose exec dsh sh -lc '
  f=$(find / -path "*dsh-client-connection/lib/client.browser.js" 2>/dev/null | head -1)
  echo "$f"
  grep -n "isLoopback:" "$f"
  grep -c "PATCHED by dsh-docker" "$f"'     # 期望：路径 + `isLoopback: true ...` + 计数 1
```

### 如果补丁哪天失效了（上游改了写法）

补丁失效**不影响 Models 与其余设置页**（0.2.1 走 `remote.settings`）；只影响 General 页的文档动作。真要用到它时，退路仍是 **loopback 源**。给 dsh 服务加回：

```yaml
    ports:
      - "127.0.0.1:3080:3080"
```

然后 `ssh -L 3080:127.0.0.1:3080 <user>@<server>`，浏览器打开 `http://127.0.0.1:3080/?token=<从 docker compose logs dsh 取>`。Host `127.0.0.1` 天然过信任围栏、cookie 绑 `127.0.0.1:3080`、`isLoopback` 为真 → 完整设置可用；端口只绑宿主 loopback，网络上访问不到。

> **别把 `DSH_BIND_HOST` 设成 `127.0.0.1` 来配合这个映射**：Docker 的端口发布是 DNAT 到**容器 IP**，容器里只监听 loopback 的话宿主侧转发进来是连不上的。保持 `auto`（容器自己的 IPv4）即可，浏览器看到的 Host 仍然是 `127.0.0.1:3080`。只有 `network_mode: host` 的部署才适合把 `DSH_BIND_HOST` 指向 `127.0.0.1`。

> 换 loopback 访问后浏览器是**另一套 cookie**（authority 不同），需要用同一个 token 重新登录一次；token 与域名访问共享，不用重启容器。

## 验证清单

### 从物理机用 curl 逐层验证（推荐）

每一层的失败方式不同，所以下面每个请求只回答一个问题：

```bash
cd dsh-docker

# 0) 名称解析：这个域名在本机解析到哪？
getent hosts dsh.example.com
#    解析不到、或解析到的不是本机地址时，给后面所有 curl 加上：
#    --resolve dsh.example.com:443:127.0.0.1

# 1) 导出 Caddy 的根 CA —— 用它做真实的证书链校验，比 -k 更有说服力
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt

# 2) 未登录访问 → 期望 401
#    401 = TLS 通过、Caddy 反代成功、Host 过了信任围栏、DSH 要求认证（一切正常）
#    403 = 信任围栏拒绝，DSH_TRUSTED_HOSTS 与 Host 不匹配
#    502 = Caddy 到不了容器
#    404 = Caddy 没有这个 Host 的站点块，DSH_SITE_ADDRESS 不对
curl -s -o /dev/null -w '%{http_code}\n' \
  --cacert /tmp/caddy-root.crt https://dsh.example.com/

# 3) 用启动 token 换 cookie → 期望 303 + Location: / + Set-Cookie
TOKEN=$(docker compose logs dsh | grep -o 'token=[A-Za-z0-9._-]*' | tail -1 | cut -d= -f2)
curl -s -o /dev/null -D - -c /tmp/dsh.jar \
  --cacert /tmp/caddy-root.crt \
  "https://dsh.example.com/?token=$TOKEN" | head -6

# 4) 带 cookie 再访问 → 期望 200（这一步等价于「浏览器能登录」）
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/dsh.jar \
  --cacert /tmp/caddy-root.crt https://dsh.example.com/

# 5) /api 桥：无 cookie 期望 401；若得 403 就是围栏没过
curl -s -o /dev/null -w '%{http_code}\n' \
  --cacert /tmp/caddy-root.crt https://dsh.example.com/api/probe

# 6) 围栏确实在拦：故意发错的 Host，**直连容器**应得 403
#    （必须绕过 Caddy：Caddy 会用自己的站点匹配先回 404，测不到围栏）
#    0.2.1 起容器只绑自己的 IPv4，所以要连那个地址而不是 127.0.0.1：
docker compose exec -T dsh curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: nope.invalid' "http://$(docker compose exec -T dsh cat /data/dsh/.runtime/bind-host | tr -d '\r\n'):3080/"

# 7) 一次跑完以上全部，外加 WebSocket 升级检查
bash verify.sh
```

几个容易踩的点：

- **token 只在不带其他参数的 `GET /` 上被接受**（源码里是 `pathname === "/" && tokens.length === 1 && tokenMatches(...)`），带别的参数会直接 401。
- 不加 `--cacert` 也不加 `-k` 时 curl 会报 `SSL certificate problem: unable to get local issuer certificate`——这**正是自签证书的预期表现**，不是故障。
- `--cacert` 通过说明证书链自洽、SAN 匹配；但**浏览器仍需点一次「继续访问」**，因为浏览器不认这个 CA。
- 以上全部通过只代表 HTTP 链路健康。**沙箱是否真在生效**要另测（见下）。

### 服务器解析不了这个域名时（分离式 DNS）

浏览器能解析、Linux 服务器不能解析，这在企业内网很常见，**既不影响部署也不影响服务器侧验证**：

- DSH 只把 `Host` 头当**字符串**比较，从不解析域名；Caddy 用 `tls internal` 也不需要外部解析。所以整条链路在服务器完全没有该域名 DNS 的情况下照样工作。
- 服务器侧验证只需加 `--resolve`：连接地址被改写到 loopback，但 **SNI 和 Host 仍然是真名**——那才是 Caddy 与信任围栏匹配的对象。

```bash
# 确认 Caddy 在所有网卡上监听（应显示 0.0.0.0:443 或 *:443）
sudo ss -ltnp 'sport = :443'

# 绕过 DNS 做同样的验证
curl -s -o /dev/null -w '%{http_code}\n' \
  --cacert /tmp/caddy-root.crt \
  --resolve dsh.example.com:443:127.0.0.1 \
  https://dsh.example.com/
```

`verify.sh` 会自动判断：解析不到、或解析到的不是本机地址时，自动固定到 `127.0.0.1`；也可以用 `VERIFY_ADDR=<地址> bash verify.sh` 强制指定。

### 从客户端验证（只有这一步能证明浏览器真的可达）

服务器上的全部验证**不能**证明浏览器能进来——DNS 解析、网络路径、证书点击都发生在客户端。在能解析该域名的机器上：

```powershell
# Windows PowerShell
Resolve-DnsName dsh.example.com | Select-Object Name, IPAddress
curl.exe -k -s -o NUL -w '%{http_code}' https://dsh.example.com/
```

**关键判断：解析出来的 IP 是不是跑 Docker 的那台机器？**

- **是** → 浏览器打开 token 链接即可，收工。
- **不是**（VIP / 负载均衡 / 另一台前置代理）→ 我们的 Caddy 根本不在浏览器路径上。此时二选一：让 IT 把这个名字指到本机，或让那台前置代理转发到本机（按需去掉 compose 里的 caddy 服务）。**这种情况下你之前看到的「浏览器可访问」，访问到的是那台设备上的另一个服务，不是这套 DSH。**

客户端侧的 token 流程（Windows）：

```powershell
$t = '<从服务器日志里取的 token>'
curl.exe -k -s -D - -c "$env:TEMP\dsh.jar" "https://dsh.example.com/?token=$t" | Select-Object -First 6
curl.exe -k -s -o NUL -w '%{http_code}' -b "$env:TEMP\dsh.jar" https://dsh.example.com/
```

### 容器内与沙箱检查

```bash
# 内部健康检查（401 = 正常，表示已启动但未登录）
# 0.2.1 起容器绑的是自己的 IPv4（不是 0.0.0.0，也不保证是 127.0.0.1），
# compose 的 healthcheck 就是读这个文件来探的：
docker compose exec dsh sh -lc 'cat /data/dsh/.runtime/bind-host'
docker compose exec dsh sh -lc 'curl --noproxy "*" -s -o /dev/null -w "%{http_code}\n" "http://$(cat /data/dsh/.runtime/bind-host):${DSH_BIND_PORT:-3080}/"'

# 沙箱真的在生效：在 GUI 里让 agent 跑一次 bash 写 /etc/probe，期望看到
#   [sandbox: file access denied under workspace-write mode]
# 若看到 SANDBOX_UNAVAILABLE，见下方排障表。

docker compose ps                                          # 容器健康状态
docker compose logs caddy | grep -i -E 'certificate|obtain|error'
```

`verify.sh` 会逐层打印 PASS/FAIL，退出码非 0 表示有断言失败；失败项旁边会直接给出对应的排查命令。


### 部署完成后的验收清单（本镜像新增的那些能力）

按顺序过一遍。每条都给出期望值，以及不符合时先看哪里。

| # | 检查 | 期望 | 不符合时 |
|---|---|---|---|
| 1 | `docker compose logs dsh \| grep -E 'dsh version\|credentials document\|bind overlay\|settings-UI patch'` | `dsh version: 0.2.1-rc.2`、`credentials document: … (mode 600, owner-only)`、`bind overlay … (host=<容器的 IPv4>)`、`settings-UI patch present` | 版本不对 ⇒ `.env` 的 `DSH_VERSION` 与镜像 tag 不一致；补丁缺失 ⇒ 插件包在构建后被重装/替换过 ⇒ `docker compose build && docker compose up -d`；`host=127.0.0.1` ⇒ 见排障表「caddy 502」那条 |
| 1b | `docker compose ps` | dsh 为 `healthy` | healthcheck 探的就是 `bind-host` 里的地址；`unhealthy` 先看上面第 1 条的 `bind overlay` 日志 |
| 2 | 浏览器打开 GUI → 设置 → 模型 | 列出 provider（DeepSeek 与你的自定义 provider），可编辑并保存 | 0.2.1 起 Models 页走 `remote.settings`，不再依赖 `isLoopback`；页面若仍报旧版的 `settings are available in this browser`，说明跑的不是 0.2.1（先看第 1 条） |
| 2b | 设置 → 通用：导出/导入设置文档 | 按钮可用（不再因域名访问而消失） | 只有这一处依赖补丁；回到第 1 条 |
| 3 | 在模型页改一项并保存，宿主上 `git diff data/dsh/settings.yaml` | 看到 UI 的写入落到宿主文件 | `data/dsh` 不是目录挂载，或属主与 `DSH_UID` 不一致（见排障表） |
| 4 | 让 agent 执行 `touch /etc/probe` | `[sandbox: file access denied under workspace-write mode]` | 出现 `SANDBOX_UNAVAILABLE` ⇒ 该内核没有 Landlock（启动日志里有 doctor 结论） |
| 5 | `docker compose logs dsh \| grep 'landlock launcher'` | `full (/usr/.../landlock-run)` | `partial` = 内核 Landlock ABI 偏旧（文件效果仍受限，fail-closed）；`cannot locate` = `DSH_GLOBAL_ROOT` 指错目录 |
| 6 | `docker compose exec dsh soffice --headless --version`；同理试 `ffmpeg -version`、`pdftotext -v`、`python3 -c "import pptx, pandas, numpy, matplotlib"`、`fc-list \| grep -ci CJK` | 各自输出版本；CJK 字体数为正 | 检查 `.env` 的 `INSTALL_OFFICE` / `INSTALL_PYTHON_DOCS` 是否为 1，然后重建镜像 |
| 7 | `docker compose logs dsh \| grep 'built-in skills'` | `none in /opt/dsh-skills (mechanism ready; …)`；放了技能后变成计数 | 打出「机制就绪」即算通过：本镜像不带技能 |
| 8 | 同时开 443 与明文端口时：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<宿主端口>/` | `401` | `403` = `DSH_HTTP_ALLOWED_RANGES` 挡住了（**从服务器自己发起会被挡，属正常**，见下）；`000`/拒绝连接 = compose 里那行 `:80` 映射还没解开，或 caddy 没重建（明文站点本身现在**默认已定义**，见 Caddyfile 末尾） |
| 9 | 明文用 `http://<authority>:<宿主端口>/`，HTTPS 用 `https://<authority>/` | 两条路各自可用 | `https://…:<明文端口>` **必然失败**：TLS 打到了明文监听上 |

**明文通道的两个配对关系（都踩过）**

- 端口映射的**容器侧固定 80**（站点地址不带端口 ⇒ Caddy 在容器内监听 80）；**宿主侧随便挑**。
  把宿主端口写进 `DSH_SITE_ADDRESS` 会同时移动 HTTPS 监听并让明文站点错位 ✗
- `DSH_TRUSTED_HOSTS` 写**无端口** authority：无端口条目按主机名比较，一个条目覆盖 443 / 80 / 任意宿主端口 ✔
- 白名单判的是**客户端出口 IP**：验证必须从客户端做 ✔（在服务器上 curl 会经 docker 网桥，得到 403 属正常）
- **HSTS 只对域名生效**：用 IP 访问时两条路可长期并存；若以后改用域名，一旦 HTTPS 访问成功，浏览器会把 `http://域名` 强制升级一年 ⇒ 明文那条路消失（Caddyfile 里 HSTS 头旁边也写了）

## 升级到 0.2.1-rc.2

本仓库从 **0.2.0-rc.2** 适配到 **0.2.1-rc.2**。上游这一版动了六处会影响本部署的东西（外加一项顺带简化），下面按「症状 → 本仓库怎么处理」列清楚，便于你 review 和以后升级时复用这套方法。

### 1. profile 不再把安装树投影到 `$DSH_HOME`

0.2.0 的 `dsh-app-boot` 会把安装树里的包 symlink 进 `$DSH_HOME/profiles/node_modules`；0.2.1 改为**每次启动现算 runtime resolution**，profile 里只剩 `package.json` / `cordis.yml` / `cordis.patch.yml` / `node_modules`（后者只有本 entrypoint 链接的自带插件）。

- 旧 home 里残留的 `profiles/node_modules/@deepseek-ai` **不再致命**（它指向同一批绝对路径，dsh 会把它当 linked root），但属于死重量。
- entrypoint 的「投影包数 < 安装树包数」告警随之失效，已改成「发现旧投影 → 说明来历 + 给清理命令」。
- 构建期冒烟测试的解析探针原来在 `profiles/web` 里跑，0.2.1 下那里什么都没有，已改为锚在**安装树**，并额外断言组合出的 profile 点名了 `dsh-base` + `dsh-web-app`。

### 2. 客户端 bundle 换了文件名和出口

`dsh-client-connection` 的浏览器半边从 `lib/client.js` 拆成 **`lib/client.browser.js`**（+ `client.node.js`），通过 `exports["./client"]` 发布；`dsh-client-modules` 取该字段的 `default` 来服务浏览器。

- `patch-client-settings.mjs` 改为**读 `exports["./client"]`** 定位目标（`lib/client.js` 仅作旧版兜底），不再硬编码文件名。
- 顺带把 `--check` 的「没打补丁」与「锚点失配」拆成两种报错：前者是正常状态（构建会打上），后者才是上游改写法。

### 3. 设置页门禁只剩一处，Models 页不再依赖它

0.2.1 的设置读写走服务端 RPC（`remote.settings`），`isLoopback` 只剩 General 页的文档动作在用。补丁**保留**（General 页需要），但它的说明、日志与验收口径都改了——再拿旧版的 `settings are available in this browser` 去判断会误判。

### 4. `webserver` 行的 `config` 多了 `tls`

0.2.1 的 web-app bundle 里这一行是：

```yaml
- id: webserver
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080
    tls: !!js ctx.webStartup.tls
```

patch **整体替换**该行的 `config`，所以 entrypoint 生成的覆盖层必须一并重述 `tls`，否则命令行上的 `--tls-cert/--tls-key` 会被静默丢弃（实测：不加这一行，dump 出来的 config 里没有 `tls` 键）。

### 5. `webserver` 行不再接受 `0.0.0.0`（**升级后第一个会撞上的坑**）

0.2.0 时通配绑定的拦截只在 `--host` 这个 CLI flag 上，行配置里的 `host: 0.0.0.0` 是放行的——本镜像正是靠 `--patch` 覆盖层写 `0.0.0.0` 才让 caddy 能连进来。0.2.1 把这条守卫搬进了**行自己的 schema**（`dsh-host-webserver` 的 `WebServer.Config.host`）：

```
webserver: host "0.0.0.0" is an unspecified (wildcard) address, which is not supported:
binding every interface would expose remote code execution to the network;
bind one concrete IPv4 or IPv6 address of a local interface instead
```

而且它只接受**具体 IP 字面量**（主机名会报 `is not a concrete IPv4 or IPv6 address literal`），并且**只在插件激活时校验**——`--dump-config` 不跑 schema，所以构建期自检照样“通过”，直到容器启动才炸：

```
dsh: startup failed: 3 required plugins did not activate
  Failed plugins (2): webserver (required) …
```

本仓库的处理：entrypoint **每次启动探测容器自己的 IPv4**（`ip -4 -o addr show scope global`，退回 `hostname -I`），把它写进覆盖层；同时写一份到 `/data/dsh/.runtime/bind-host`，给 compose healthcheck 和 `verify.sh` 用。caddy 的 upstream 是 `dsh:<port>`（按名字解析），所以容器换了地址它自动跟上。

- `DSH_BIND_HOST=auto`（新默认）：自动探测。
- `DSH_BIND_HOST=<具体IP>`：照用（`network_mode: host` 或特殊网络时用）。
- `DSH_BIND_HOST=0.0.0.0`：**警告并改为自动探测**（不静默失败，也不按旧行为硬试）。
- `DSH_BIND_HOST=127.0.0.1`：只在 `network_mode: host` 时有意义——Docker 的端口发布是 DNAT 到容器 IP，容器只监听 loopback 时宿主转发连不上。

### 6. `$DSH_HOME/.credentials.yaml` 必须是 owner-only（**第二个会撞上的坑**）

0.2.1 的 `dsh-credentials-local` 在 init 阶段就拒绝任何 group/other 可读的凭据文件：

```
credentials-local: /data/dsh/.credentials.yaml is readable beyond its owner (mode 777);
run "chmod 600 /data/dsh/.credentials.yaml" before starting again
```

文件由提供方以 `0600` 创建，但**手写、拷贝、或由宿主机/Windows 端生成的**那份会带宿主 umask（绑定目录里出现 `0777` 很常见），而这是个**硬启动失败**：`credentials` 不激活 → `connection`/`authorization`/`deepseek-account` 以及所有依赖它们的插件全部排队等待 → 界面永远不监听端口。

本仓库的处理：entrypoint 在预检阶段检查该文件的 group/other 位，需要就 `chmod 600`（容器以 `DSH_UID` 运行，属主正确时必然成功）；改不动时**直接给出宿主上的修复命令**，而不是让 dsh 用堆栈把容器拖进重启循环。

### 7. 依赖全部精确锁版（顺带简化）

0.2.1-rc.2 里约 1300 条 `@deepseek-ai/dsh-*` 依赖/peer **全部是精确版本**，不再是 `^0.2.0-rc.2` 这类预发布范围。`.env` / `Dockerfile` 里那套「必须选本系列最新版、否则预发布范围会漂」的长篇说明因此改写为「一个版本决定整棵树」，构建期版本断言保留（它现在防的是混装/去重问题，而不是漂移）。Node 下限也从 22.12 提到 **22.19**（`libreoffice-kit` 的 engines），构建期断言。

### 升级操作顺序

```bash
git pull                                  # 拿到本次适配
grep -n 'DSH_VERSION' .env                # 应为 0.2.1-rc.2
docker compose build --no-cache dsh       # 关键：让新版本重新装 npm 树，别复用旧层缓存
docker compose up -d
docker compose logs -f dsh | grep -E 'dsh version|credentials document|bind overlay|profile node_modules|bundled plugin|settings-UI patch'
```

期望日志（首启）：

```
[dsh] dsh version: 0.2.1-rc.2
[dsh] credentials document: /data/dsh/.credentials.yaml tightened 777 -> 600 (dsh 0.2.1 refuses group/other-readable credentials)
[dsh] profile node_modules: no installation projection (expected on 0.2.1+)
[dsh] bundled plugin @local/dsh-file-download: enabled
[dsh] bundled plugin dsh-minimax-h3: enabled
[dsh] bundled plugin @local/dsh-login-gate: enabled, options in /data/dsh/cordis.patch.yml
[dsh] wrote bind overlay /data/dsh/.runtime/webserver-bind.yml (host=172.18.0.2, port=3080; requested auto)
[dsh] bind overlay verified against the composed config tree
[dsh] settings-UI patch present: the domain-served GUI edits the host document
```

两条 `bind overlay` 日志里的 `host=` 就是 caddy 要连的地址；`docker compose ps` 里 dsh 应变成 `healthy`。如果 binding 行打出的是 `host=127.0.0.1`，说明容器里没探测到非 loopback 地址（`docker compose exec dsh ip -4 addr` 可确认），此时 caddy 会 502。

如果打出了 `found N leftover package link(s) in /data/dsh/profiles/node_modules/@deepseek-ai`，按提示清一次（不影响启动，只是把 0.2.0 的残留去掉）：

```bash
rm -rf data/dsh/profiles/node_modules && docker compose restart dsh
```

> **升级前先备份 `./data/dsh`**（`tar czf dsh-home-$(date +%F).tgz -C data/dsh .`）。会话格式在 0.2.1 是 **v4**，安装树里带着 `dsh-session-format-v3-to-v4` 的迁移插件：升级时旧会话会被向前迁移，这种迁移不保证可逆，回滚到更旧的 dsh 版本可能读不了迁移后的会话。设置文档（`settings.yaml`）与会话是分开的，回滚它没有这个问题。

## 常用运维

```bash
docker compose logs -f dsh                 # 跟踪日志
docker compose restart dsh                 # 重启（会生成新的登录 token）
docker compose down                        # 停止（数据保留在 ./data/dsh）
docker compose down -v                     # 停止并删除 Caddy 数据卷（CA 会重新生成；./data/dsh 不受影响）

# 升级 dsh 版本（完整步骤见「升级到 0.2.1-rc2」）
#   1) 改 .env 里的 DSH_VERSION
#   2) 重建 dsh 服务，别复用旧层缓存（npm 全局树必须重新装）
docker compose build --no-cache dsh && docker compose up -d
#   3) 看这几行：dsh version / profile node_modules / bundled plugin / settings-UI patch
docker compose logs dsh | grep -E 'dsh version|profile node_modules|bundled plugin|settings-UI patch'

# 备份（会话/设置/凭据都在 ./data/dsh，直接打包目录即可）
tar czf "dsh-home-$(date +%F).tgz" -C data/dsh .

# 安装/卸载插件（profile 目录在 ./data/dsh 里，容器内执行）
docker compose exec dsh dsh plugin --profile web add <package>
docker compose exec dsh dsh plugin --profile web remove <package>
# 插件集合变更需要重启 profile： docker compose restart dsh

```

## 配置项

见 `.env.example`，几个关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PERMISSION_MODE` | `workspace-write` | `read-only` / `workspace-write` / `danger-full-access`；最后一项**同时**把审批策略变成 `never` |
| `DSH_TRUSTED_HOSTS` | `dsh.example.com` | 浏览器实际使用的 authority，逗号分隔；为空则浏览器访问会 403。默认端口（443/80）**必须写不带端口的裸域名**，写 `:443` 永远匹配不上 |
| `DSH_HTTP_ALLOWED_RANGES` | `127.0.0.1/32 ::1/128` | 谁可以用**明文 :80** 监听（需先在 Caddyfile 解开那个站点、并在 compose 里发布 `:80`）。表外的来源一律 403；默认只有 loopback ⇒ 发布了 80 也"谁都进不来"，直到你填上客户端出口 IP（在**客户端**打开 https://ifconfig.me 查到）。验证必须从**客户端**做：从服务器自己发起会走 docker 网桥，得到 403 是正常的。 |
| `DSH_WORKSPACES` | `./workspaces` | 宿主目录 → 容器 `/workspaces`，也是 `workspace-write` 的边界和 agent 默认工作目录 |
| `DSH_UID` / `DSH_GID` | `1000` | 容器运行身份，必须能写 `DSH_WORKSPACES` 和宿主目录 `./data/dsh`（里面有会话、凭据与设置） |
| `DSH_PUBLIC_PORT` | `443` | Caddy 发布到宿主机的 GUI 端口 |
| `DSH_TELEMETRY_DISABLED` | `1` | 非空即关闭 OTel 上报 |

> ℹ️ 会话日志上传在这条链路上是**默认关闭**的，不必额外处理。可核实的依据：`dsh-session-log-deepseek` 的 schema 是 `enabled: z.boolean().default(false)`，其 `apply` 在 `enabled !== true` 时直接返回，而 base bundle 插入该行时没有给任何 config。
>
> **0.2.1-rc.2 已重新核对**：`dsh web --dump-config` 里这一行仍然只有 `id` + `name`、没有 `config`，即默认关闭——与 `0.1.5-rc.x` 的实测一致（仓库 master 的 CLI 参考写「default-on」，与实际行为矛盾，以 dump 为准）。再升级后照旧核对一次：如果出现 `enabled: true`，就在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里把它改回 `false`（该文件初始内容是带注释的 `[]`，编辑时要**替换**它而不是追加）。

## 排障

| 现象 | 原因与处理 |
|---|---|
| **模型调用失败 / 一直转圈**（走内网 vLLM、LiteLLM 之类的自建端点时） | 头号嫌疑是**代理把内网请求也劫持走了**：容器里被注入了 `HTTP_PROXY`，而 `~/.docker/config.json` 的 `noProxy` 只列了 `172.17.0.0/16`、`192.168.*`、`.corp.local`。若端点地址是 `10.x.x.x`，请求就被送到代理 → 失败。对照验证：<br>`docker compose exec -T dsh curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' --max-time 8 http://<端点>:端口/v1/models -H "Authorization: Bearer $KEY"`<br>去掉 `--noproxy '*'` 再跑一次；**两次结果不一致就确认是代理**。<br>本 compose 现在给 dsh 服务默认设了 `NO_PROXY=127.0.0.1,localhost,172.16.0.0/12`（容器地址、compose 网络、healthcheck 都靠它），这只覆盖私网段；**`10.x.x.x` / 自定义域名不在里面**，要加就设 `.env` 的 `DSH_NO_PROXY`（例如 `127.0.0.1,localhost,172.16.0.0/12,10.0.0.0/8`），或在 `~/.docker/config.json` 的 `noProxy` 里补。<br>次要嫌疑：容器里写 `localhost` 到不了宿主机——用宿主局域网 IP，或给 dsh 服务加 `extra_hosts: ["host.docker.internal:host-gateway"]`（已默认加）。 |
| 浏览器**没有**「继续访问」按钮 | 受管 Chrome/Edge 的 `SSLErrorOverrideAllowed=false` 策略会彻底禁用跳过证书错误。打开 `chrome://policy` 搜 `SSLErrorOverrideAllowed`：若为 false，点击继续这条路走不通，只能导入 CA（Option A）或改用 CA 证书（Option B）。 |
| 以前能点击继续，某天突然进不去且没有绕过选项 | HSTS 生效了。浏览器**不会**从证书错误的连接记录 HSTS，所以只要证书一直不受信任，「继续」就一直可用；但一旦导入过 CA（连接变合法），该域名就被写入 HSTS，此后证书再出问题就没有「继续」按钮了。清除方法：Chrome/Edge → `chrome://net-internals/#hsts` → "Delete domain security policies" 输入 `dsh.example.com`；Firefox → 设置里清除该站点数据。 |
| 浏览器 403 | `DSH_TRUSTED_HOSTS` 与浏览器实际发出的 Host 头不匹配。规则（已核对实现）：**不带端口的条目匹配任意端口，带端口的条目要求完全一致**。所以默认端口场景必须写裸域名 `dsh.example.com`；写成 `:443` 一定 403。另外该条目必须是裸 authority，写成 `https://dsh.example...` 或带路径会让插件加载直接报错。 |
| 502 / 界面转圈 | ① dsh 容器还没起完，等 `start_period`；② 看日志有没有 `bind overlay verified`，没有就是覆盖层没命中；③ 检查 `Caddyfile` 的 `flush_interval -1` 还在（少了它 SSE 会被缓冲）。 |
| `SANDBOX_UNAVAILABLE` | Landlock 不可用。看启动日志 `dsh doctor` 那行：`unusable` 表示内核 < 5.13 或 seccomp 拦了 landlock 系统调用。要么升级内核/放行 seccomp，要么把 `DSH_PERMISSION_MODE` 设为 `danger-full-access`（此时容器是唯一边界，务必收窄挂载）。 |
| `dsh doctor` 报 `partial` | 内核 Landlock ABI 较旧，文件写入仍受限，但部分新权限位不受治理。可接受。 |
| agent 无法写工作区 | 启动日志会打印实际属主，例如 `it is owned by 10001:10001`。二选一：`sudo chown -R 1000:1000 <宿主工作区目录>`；或改 `.env` 里的 `DSH_UID`/`DSH_GID` 匹配该属主，**并同时**把 `./data/dsh` 也 chown（否则 entrypoint 会以 `$DSH_HOME is not writable` 直接退出）。**以 root 执行 `mkdir workspaces` 时最容易踩到**：目录属主是 root，而容器默认以 1000 运行。 |
| 日志出现 `the workspace looks like the deployment directory` | `DSH_WORKSPACES` 指向了部署目录本身。这既是权限问题也是安全问题：agent 能改写 `Caddyfile`/`.env`，而且 DSH 会把 `<工作区>/.env` 当作启动环境层读入（同一个 `.env` 因此被每个会话加载）。把 `DSH_WORKSPACES` 指到专门的项目目录，例如 `/srv/projects`。 |
| `EACCES ... /usr/local/bin/dsh-doctor.mjs` | `COPY` 保留了构建上下文里该文件的权限位（受限 umask 出来的 0600 会让非 root 运行身份读不了）。Dockerfile 现已显式 `chmod 0644`；`docker compose up -d --build` 重建即可。entrypoint 遇到不可读时会跳过体检而不是刷堆栈。 |
| `$DSH_HOME is not writable` | `./data/dsh` 宿主目录的属主与 `DSH_UID` 不一致（例如曾被 root 写过）。`sudo chown -R 10001:10001 ./data/dsh`，用 `.env` 里的实际值。 |
| 证书申请失败 / 浏览器一直报不安全 | 非公网域名无法走 ACME，这是预期行为。默认的 `tls internal` 需要先信任 Caddy 的根 CA（见上文 Option A）；想要零警告就用内部 CA 证书（Option B）。若日志出现 `obtain` / `acme` 相关错误，说明 `Caddyfile` 里的 `tls internal` 被误删了。 |
| `caddy` 日志出现 `installing root certificate ... certificate installed properly in linux trusts` | 这是 Caddy 把内置 CA 装进**容器内**的信任库，对宿主机浏览器**无效**，而且容器一重建就失效。浏览器要消除警告仍须按 Option A 手动导入 `caddy-root.crt`（`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./`），或直接用 Option B 的内部 CA 证书。 |
| `dsh` 容器报 `plugin tree failed to load` / `Cannot find package` | 先看堆栈里有没有 **`/snapshot/deepseek-harness/...`** 前缀 —— 那说明跑的是**另一个**同名的 `dsh`（单文件 Node 可执行体，只有最小 profile、没有 `web` profile），而不是 npm CLI。历史上这个冲突来自 Python SDK 安装的 runtime wheel，**现在镜像里已不含 SDK**，理论上不会再出现；entrypoint 仍显式解析 npm CLI（`DSH_NPM_BIN` → 构建期写下的 `/tmp/dsh-npm-bin.path` → `npm root -g` → 常见前缀），启动时打印 `dsh CLI: ...`，可用 `DSH_CLI` 覆盖。 |
| **`dsh: startup failed: N required plugins did not activate`**，失败项里有 `webserver (required)`，错误为 `host "0.0.0.0" is an unspecified (wildcard) address` | 0.2.1 把通配绑定拦截搬进了 `webserver` 行的 schema。本镜像的 entrypoint 会探测容器 IPv4 并写进覆盖层；若仍出现，说明 `DSH_BIND_HOST` 被设成了通配地址且探测失败（日志里会有对应 WARNING）。改回 `DSH_BIND_HOST=auto`，或直接设成容器地址（`docker compose exec dsh ip -4 -o addr show scope global`）。**注意 `--dump-config` 查不出这类问题**，它不跑 schema。 |
| 同上，失败项里有 `credentials`，错误为 `is readable beyond its owner (mode 777)` | 0.2.1 要求 `.credentials.yaml` 为 owner-only。entrypoint 会自动 `chmod 600`；看到这条说明它改不动（文件属主不是 `DSH_UID`）。宿主上：`sudo chmod 600 data/dsh/.credentials.yaml`（必要时连同 `sudo chown -R $(id -u):$(id -g) data/dsh`），再 `docker compose up -d --force-recreate`。 |
| 日志里 `host=127.0.0.1` 或 caddy 502，但容器是 healthy 状态不明 | 容器没探测到非 loopback 地址（少见：`network_mode: none` 或自定义网络无 IPv4）。`docker compose exec dsh ip -4 addr` 确认后，显式设 `DSH_BIND_HOST` 为可用地址，或改用 `network_mode: host`。 |
| 改了 `DSH_BIND_PORT` 后不通 | `DSH_UPSTREAM` 会跟着变，检查 `docker compose config` 里 caddy 的 `DSH_UPSTREAM` 与 healthcheck。 |
| 流式响应「卡住」直到最后才一次性吐完 | 检查是否有中间件在缓冲 SSE：`Caddyfile` 的 site 块必须有 `flush_interval -1`（少了它，GUI 的事件流会被攒到最后才发）。 |

| `plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local; could not be resolved`（并伴随重启循环）| **0.2.0 及更早**的典型症状：`$DSH_HOME/profiles/node_modules` 里那份从安装树投影出来的符号链接农场过期/残缺，而 profile 自身没有依赖，所以没有任何东西会重建它。0.2.1 起这种投影**不再产生**，该目录只剩 entrypoint 链接的自带插件，因此这条错误若在 0.2.1 上出现，指向的是**镜像里的安装树**（构建期断言本应拦住）或**日志里点名的那个包被 `dsh plugin` 动过**。先看启动日志的 `dsh version` 与 `profile node_modules` 两行：<br>• 有 `found N leftover package link(s)` ⇒ 清一次：`rm -rf data/dsh/profiles/node_modules && docker compose restart dsh`；<br>• 版本与 `.env` 不符 ⇒ `docker compose build --no-cache dsh`；<br>• 全新 home 首启就失败 ⇒ 镜像本身有问题，看构建期冒烟测试的输出。 |

| 构建期 `ERESOLVE could not resolve`，或启动报 `plugin(s) failed to load: … could not be resolved` | **安装树混装**。0.2.1-rc.2 的 `@deepseek-ai/dsh-*` 依赖全部是精确版本，所以「预发布范围漂移」这个老原因已经不存在了；现在剩下的成因是：`.env` 的 `DSH_VERSION` 与镜像 tag 不一致、构建复用了旧的 `node_modules` 层、或 npm 在全局根目录多放了一份同名包。构建期的版本断言会点名版本不符的包。<br>两点实测事实仍然成立：**显式 pin 的包可能落在 npm 全局根**（`/usr/lib/node_modules/@deepseek-ai/`），而 **CLI 的依赖会嵌套在它旁边**（`.../dsh/node_modules/@deepseek-ai/`）——Node 两处都能解析（全局根本身是祖先 `node_modules` 目录），所以构建期断言**两处都查**（这一点曾被断言误报为 missing）。 |

## 安全边界（务必知悉）

- DSH 自带的服务端**没有 TLS，也没有自己的账号体系**，唯一的认证是启动时随机打印的登录 token + 签名 cookie。所以 Caddy 这一层是必需品，不是可选项。
- cookie 不带 `Secure`，因此**不要**为同一 authority 提供明文 HTTP（包括 80 端口跳转，第一次明文请求就会泄露 cookie）。建议再加 `basic_auth` 作为第二因子。
- `workspace-write` 只限制**写文件**；读和网络不受限，agent 仍可访问容器能访问的一切网络（包括 `api.deepseek.com` 和内网服务）。需要更强隔离请把它放到独立网段。
- **不要**把 `/var/run/docker.sock`、宿主家目录、SSH 私钥挂进容器。当前挂载面只有宿主目录 `./data/dsh`（= `$DSH_HOME`，含会话、cookie 签名密钥与 provider 凭据）和 `DSH_WORKSPACES`。
- **不要把部署目录本身当作 `DSH_WORKSPACES`。** 工作区是 agent 可写目录：挂成部署目录等于把 `Caddyfile`、`.env`、Dockerfile 交给 agent；同时 DSH 会把 `<工作区>/.env` 读作启动环境层（`DEEPSEEK_API_KEY` 若只靠该文件提供，就可能被改写指向别处——compose 里已用真实环境变量传入，环境变量优先级更高，这一点是安全的）。
- 若使用 `danger-full-access`，容器就是唯一边界：此时更要保证镜像来源可信、挂载面最小。
- **设置页补丁放宽了一件事**（见前文）：域名访问时浏览器现在能**读写 provider 凭据**。它不改变服务端围栏（Host/Origin + cookie），但把「谁能改 key」从 loopback 使用者扩大到任何持有有效 cookie 的人。若不可接受，删掉 Dockerfile 里的补丁步骤并改用 loopback 源访问设置页。

## 已验证 / 仍待确认

### 已实测确认（2026-09，真实内网部署）

1. `--patch` 覆盖层里的 `!!js ctx.webStartup.port ?? 3080` 表达式可正常求值——日志出现 `bind overlay verified against the composed config tree`。
2. `--dump-config` 自检的 grep 目标与输出格式一致（同上）。
3. 信任围栏在默认端口 443 下工作正常：`isTrustedAuthority` 对无端口条目只比 hostname，Origin 侧同样归一化，裸域名 `dsh.example.com` 即可（写 `:443` 反而永远不匹配）。
4. `auto_https disable_redirects` + `tls internal` 组合在 `caddy:2-alpine` 上行为符合预期：日志有 `automatic HTTP->HTTPS redirects are disabled` 与 `enabling automatic TLS certificate management domains: [...]`，且没有 :80 监听。
5. **容器内 Landlock runner 探测通过**，`workspace-write` 无需放宽 seccomp：

   ```
   dsh doctor: node v22.23.2; landlock launcher full (/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run)
   ```

   该路径顺带确认了全局安装的布局：`npm i -g` 把依赖嵌套在 `@deepseek-ai/dsh/node_modules/` 下，而不是提升到全局根目录。
6. `dsh` 容器能以配置的 `DSH_UID:DSH_GID`（本部署为 10001）启动，`dsh web` 打印出带 token 的登录 URL。

7. **设置页补丁**（2026-10，对 `0.2.0-rc.2` 实测）：补丁生效、幂等、`--check` 通过、语法校验通过、旧表达式归零。

8. **0.2.1-rc.2 适配**（2026-10-26，本机对着真实 `@deepseek-ai/dsh@0.2.1-rc.2` 安装实测，Windows + Node 24，非容器）：`--profile web --dump-config` 能组合；`dsh web` 从空 home 启动并常驻，`GET /` 无 cookie 401、`/api/*` 无 cookie 401、错误 Host 直连 `/api` 403（与 `verify.sh` 的期望一致）；`profiles/web` 只有 `package.json` / `cordis.yml` / `cordis.patch.yml`，**没有** `profiles/node_modules`；三个自带插件按 entrypoint 的方式链接 + 注入 HOME patch 后出现在组合树里，浏览器 combo bundle 返回 200 且包含它们；补丁脚本对 `lib/client.browser.js` 的锚点匹配、写入、幂等、`--check` 全部通过；构建期那套「Node 解析 + 版本比对」断言与插件校验循环也用本机安装实跑过（9 个包全部 0.2.1-rc.2，无 missing/mismatch）；`webserver` 行**绑定具体 IPv4 时能起并返回 401，绑回环时确实不监听**（证明探测+覆盖层的做法成立）。

9. **第一次真实构建/启动暴露的两个坑（已修，值得记下来）**：`--dump-config` 与构建期自检都**不跑 schema**，所以 (a) `webserver` 行拒绝 `0.0.0.0`、(b) `.credentials.yaml` 必须 owner-only，这两条只能在容器启动时暴露，症状都是 `dsh: startup failed: N required plugins did not activate`。修法见「[升级到 0.2.1-rc.2](#升级到-021-rc2)」第 5、6 条；本仓库已在 entrypoint 里分别做了「探测容器 IPv4」与「chmod 600」。同时发现容器内 `curl` 会被注入的 `HTTP(S)_PROXY` 劫持（healthcheck 也会误判），已在 dsh 服务的环境里补 `NO_PROXY`，并给 healthcheck/verify 的容器内探测加 `--noproxy '*'`。

### 仍待确认（部署侧动作，不是未知项）

1. **属主**：宿主目录属于别的 uid（实测 10001）时，最省事的是把 `.env` 的 `DSH_UID/DSH_GID` 设成该属主——构建参数会把它带进镜像，`./data/dsh` 这个宿主目录再 chown 一次即可。entrypoint 会打印实际属主与两种修法。
2. 首次浏览器访问的证书信任：本项目已决定**接受自签警告、点一次继续**（前提是受管浏览器未禁用 `SSLErrorOverrideAllowed`）。
3. **本轮修改需要一次构建 + 启动验证**：构建期会跑 Node 版本下限断言、安装树完整性/版本断言、设置页补丁 `--check`、`--profile web --dump-config`，以及从空 home 的 60 秒启动冒烟；但**运行期校验（schema、文件权限）只有真正启动才跑**——第一轮就是这么发现 `webserver` 通配绑定与 credentials 权限两处问题的。启动后先看这两行日志：`credentials document: … (mode 600, owner-only)` 与 `bind overlay … (host=<非 127.0.0.1>)`，再看 `docker compose ps` 是否 `healthy`。
4. **三个自带插件的运行时功能**：0.2.1 下它们都能加载、能被组合进浏览器图，但登录门禁的表单渲染、文件下载的路由、MiniMax H3 的 ComfyUI 调用属于浏览器交互或外部服务，需要你在有 Docker 的环境里点一遍（`README` 的验收清单第 7～9 条附近）。它们用的服务（`webServer`、`webserver/index-inject`、`ctx.connection.fetch.register`、`ctx.fs.readByteRange`、`ctx.workspaceChanges`、`ctx.sandboxPolicy`、`ctx.sessionQuery`）都还在 0.2.1 的安装树里。

## 内置插件（`plugins/` 目录）

`plugins/` 下的**每个目录**都会在构建期被复制到镜像的 `/opt/dsh-plugins`，并在**容器启动时自动启用**：

- 插件必须是 dsh 的 **bundle**：`package.json` 有可解析的 `name`、入口文件存在、声明了 `dsh.bundle.patch` 时该 patch 文件（一个或**一串**，0.2.1 支持数组）也存在。**构建期逐项校验，不符合即构建失败**（坏插件进不了镜像）。
- **为什么启用发生在启动期而不是构建期**：profile 是 dsh **首次启动时才组合出来**的，构建期不存在。启动脚本因此做两件事：
  1. 把包**软链**进 `$DSH_HOME/profiles/node_modules/`，让组合树里的插件行能解析到它。0.2.1 起这正是 dsh 认的 **linked root**：`linkedProfileRoots` 收集所有指向 profiles 树之外的符号链接并按包名登记，启动过程中不会删它们（`removeLinkProjections` 只清 ≤0.2.0 的 `.dsh-module-fallback` 农场），entrypoint 每次启动 `ln -sfn` 重建；
  2. 把该 bundle 自带的 patch 层（数组则按声明顺序拼接）**追加进 `$DSH_HOME/cordis.patch.yml`**（home 级 patch，覆盖所有 profile，所以**首次启动就生效**）。追加**只做一次**：之后你在那里改的选项（例如登录门禁的账号密码）不会被后续启动覆盖。
- **改选项**：编辑 `data/dsh/cordis.patch.yml` 里对应插件的段落 → `docker compose restart dsh`。
- **运行时加插件（不重建镜像）**：把宿主目录挂进容器，并把 `DSH_PLUGIN_ROOT` 指向它。

### 附带插件：登录门禁 `@local/dsh-login-gate`

在 Harness UI 前加一道「账号 + 密码 + 图形验证码」的门，选项位置见上一段（`data/dsh/cordis.patch.yml`）。

⚠️ **两条边界必须知道**（都出自该插件自己的 README，请据此判断它适合什么用途）：

1. **它不是认证**。校验在浏览器里做，账号与密码随页面一起下发 ⇒ 它挡的是「随手打开的 Harness 窗口」，**不保护** Harness 的 HTTP API、CLI 或磁盘上的 profile：绕过页面直接请求 API 依然可达。
2. **默认凭据是公开的**（`admin` / `dsh-admin`）⇒ 启动脚本会在日志里告警提醒你改。尤其注意**明文 :80 那条路**：页面下发的内容与会话 cookie 都能被链路上的观察者读到 ⇒ 这门禁在明文通道上**不提供任何保护**。

## 首次登录：token 与「多久要再登一次」

`dsh web` 启动时会把一条带 `?token=…` 的地址打进容器日志；浏览器拿它换一个**签名的会话 cookie**，之后直接访问即可。两点必须知道：

- token **每次重启重新生成、不落盘** ⇒ 新设备/新浏览器第一次需要它（重启后旧 token 立即失效）
- cookie 是**持久**的（签名密钥在 `data/dsh/.credentials.yaml`，随宿主目录走）⇒ 只要 cookie 没过期，重启容器甚至重建镜像都不用再输 token

所以真正决定「多久要再登一次」的是 **cookie 有效期**，上游默认 **30 天**。要改长，只需在 **`data/dsh/cordis.patch.yml`**（= `$DSH_HOME/cordis.patch.yml`，启动时读入；登录门禁的选项也在同一个文件里）追加：

```yaml
- id: connection
  config:
    # 必须一并重复声明：补丁层可能是「替换」而非「合并」语义，
    # 丢掉这个表达式会让浏览器信任围栏失效，所有访问变成 403。
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    cookieMaxAgeDays: 365
```

改完 `docker compose restart dsh` 即可，**不需要重建镜像**。

⚠️ 只在 **TLS** 这条路上加长：会话 cookie **不带 `Secure`**，明文监听上它能被链路上的观察者嗅探。

拿不到 token 时，HTTPS 站点会给你一个**提示页**（`unauth/index.html`），上面就是到服务器取链接的命令。明文监听那一侧**没有**接这个页面，原因写在 Caddyfile 里那段注释中：白名单外的人不该知道该监听器存在。

## 内置技能（机制已就绪，暂不带技能）

镜像里**已经装好了「内置技能」的机制**，但**故意一个技能都不带**。想加的时候，把技能放进仓库的 `skills/`，重新构建即可。

### 机制是什么

`dsh-skill-filesystem` 把它当作一个独立的技能根：`DSH_BUNDLED_SKILL_DIR=/opt/dsh-skills`（Dockerfile 里设的），`source: "bundled"`、`trustedHost: true`、`rank: 600`。三个要点：

- **`trustedHost: true` 是必需的**：它的 `SKILL.md` 是**绕过沙箱直读**的（`readSkillText(..., trustedHost)`）。技能放在工作区之外（`/opt/dsh-skills`），沙箱化的文件系统读不到，只有 trusted 根能读——**所以别用 `customSkillDirs` 放镜像内置技能**。
- **内置技能优先级最低**：rank 是**升序取小**（`left.rank - right.rank`），bundled = 600 是最大值 ⇒ 项目技能、用户技能同名时**覆盖内置**。这正是内置技能应有的语义。
- **空目录是合法状态**：发现逻辑把「没有 `SKILL.md` 的子目录」视为不存在，不会报错；entrypoint 每次启动打印一行计数。

### 技能可以放哪：六个根，按优先级

| 优先级 | source | 路径 | 备注 |
|---|---|---|---|
| 1 | `project-dsh` | `<项目根>/.dsh/skills` | 项目根 = 从 cwd **向上找含 `.git`** 的目录 |
| 2 | `project-agents` | `<项目根>/.agents/skills` | 同上 |
| 3 | `custom` | profile 的 `customSkillDirs` | 任意目录，可配多个 |
| 4 | `user-dsh` | `$DSH_HOME/skills` → 容器 `/data/dsh/skills`，宿主 `<repo>/data/dsh/skills` | **宿主可改、热重载**；带 `skipSystem`（忽略其下 `.system`） |
| 5 | `user-agents` | `~/.agents/skills`（`DSH_AGENTS_HOME` 可改） | |
| 6 | **`bundled`** | **`/opt/dsh-skills`** | 本文讲的这个 |

想临时加技能又不想重建镜像：把 `compose.yaml` 里那行注释打开（`- ./skills:/opt/dsh-skills:ro`），宿主目录会**遮蔽**镜像里那份，并且**热重载**。

### 一个技能的最小结构

```
skills/
└── my-skill/
    ├── SKILL.md          ← 必须有；该目录即 resourceBase
    ├── scripts/…         ← 可选
    └── assets/…          ← 可选
```

`SKILL.md` 的 frontmatter 至少要 `name` 和 `description`：

```yaml
---
name: my-skill            # 技能名（取自 frontmatter，不必与目录名相同）
description: 一行说明，出现在技能目录里
whenToUse: 可选，给模型的提示
invocation:
  modelInvocable: true
  userInvocable: true
---
正文……
```

（`name` 不必等于目录名：框架自带的技能就是解压到随机临时目录、而 frontmatter 里写固定名字的。但 `name` 必须符合技能名规则。）

也支持单文件形式：`/opt/dsh-skills/my-skill.md`（此时 resourceBase 是根目录本身）。

> ⚠️ **别在这个目录里放没有 frontmatter 的 `.md`**（比如随手一个 `README.md`）：发现逻辑会把根目录下每个 `.md` 都当成技能候选，解析不出来就**每次扫描都打一条 warning**。所以本仓库的说明写在这里，而不是 `skills/` 里。

### 怎么确认机制是活的

```bash
docker compose logs dsh | grep 'built-in skills'
#   空着时：   [dsh] built-in skills: none in /opt/dsh-skills (mechanism ready; see README: built-in skills)
#   加了之后： [dsh] built-in skills: 1 discovered in /opt/dsh-skills
```

技能目录变更由 watcher 捕获并热重载（`skills/change` 事件）。`skills/` 下的内容**会随仓库提交**——这是有意的：内置技能属于这个项目的一部分。

## 许可证

本项目采用 **Apache License 2.0**，全文见 [`LICENSE`](LICENSE)。该文件与官方文本 <https://www.apache.org/licenses/LICENSE-2.0.txt> **逐字节一致**（SHA256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`）。

