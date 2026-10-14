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

- **想用公司 CA 的证书**：不需要 nginx，走下面的 Option B，把证书文件喂给 Caddy 即可。证书由谁签发 ≠ 必须由谁托管。
- **只有一种情况值得引入 nginx**：TLS 必须在**集中入口**（已有的 nginx / F5 / LB）终结。那时的正确做法是**把 compose 里的 caddy 服务整个删掉**，让 nginx 直接反代 dsh，而不是两层叠加。届时必须做到五件事：`proxy_set_header Host $host`（nginx 默认是 `$proxy_host`，会导致 /api 信任围栏 403）、`proxy_buffering off`（SSE）、WebSocket upgrade 头、`client_max_body_size` 提到 300m 以上（否则上传 413）、以及明文那一跳只允许走 loopback 或 compose 内网。

## 为什么是这样设计的（都是对着 `@deepseek-ai/dsh@0.1.5-rc.1` 源码核过的）

| 事实 | 由此产生的设计 |
|---|---|
| CLI 依赖 `commander@15`，engines 为 `>=22.12.0` | Node 必须 ≥ 22.12，故用 NodeSource 在 Debian glibc 基线上装 Node 22 |
| `node-pty` 自带 `prebuilds/linux-x64`，`sharp`/`ripgrep`/`landlock-run` 都是预编译 npm 包 | 镜像里不需要 gcc/python-dev；**不要用 Alpine**（musl 下 `node-pty` 会退化成源码编译） |
| Linux 沙箱链是 `bwrap → Landlock`，按顺序探测，两者都不可用则 fail closed（`SANDBOX_UNAVAILABLE`） | 镜像**故意不装 bubblewrap**，让容器稳定落到无需任何特权的 Landlock |
| `dsh web --host 0.0.0.0` 被 CLI 明确拒绝（usage error 退出） | 用 `--patch` 覆盖层把 `webserver` 行的 `host` 改成 `0.0.0.0`（只有容器内网可见） |
| 每个请求要过 Host/Origin 信任围栏，`--trusted-host` 决定放行哪些 authority | 必须设置 `DSH_TRUSTED_HOSTS` 为浏览器实际使用的 `host`，否则 403 |
| 会话 cookie 故意不带 `Secure` 标志（项目假设 loopback HTTP） | **绝不要**为同一域名再开明文 HTTP；只发布 TLS 端口并上 HSTS |
| 首次访问需要 `?token=...` 换取签名 cookie，密钥持久化在 `$DSH_HOME/.credentials.yaml` | 卷要持久化（同一签名密钥 ⇒ cookie 在重启后仍可复用） |
| `DSH_*` 前缀变量是 bootstrap-only，不能来自任何 `.env` | `DSH_HOME` 等必须用 compose `environment` 传 |
| 凭据解析顺序：继承环境 > `$DSH_HOME/.credentials.yaml` > cwd `.env` > `$DSH_HOME/.env` | `DEEPSEEK_API_KEY` 用真实环境变量传，避免被工作区里克隆来的 `.env` 劫持 |
| 首次初始化 profile 会写入内容为 `[]` 的 `cordis.patch.yml` | entrypoint 不改这个文件（往 `[]` 后追加会得到非法 YAML），改用 `--patch` 覆盖层 |
| SIGTERM 会优雅退出（最多 5 秒） | `stop_grace_period: 15s`，用 tini 做 PID 1 转发信号 |
| 一个 harness home 只能装一份 dsh（profiles/ 下同一份 profile 目录） | 本部署只有一个服务：`./data/dsh` 以**目录 bind mount** 挂到 `/data/dsh`。不用命名卷、也不用单文件挂载——设置提供方落盘走「临时文件 + rename」，单文件挂载时 rename 的目标是挂载点（EBUSY），`:ro` 则是 EROFS；只有目录挂载能让宿主编辑与 UI 保存写同一个真文件 |

## 文件清单

| 文件 | 作用 |
|---|---|
| `Dockerfile` | `python:3.11-slim-bookworm`（glibc 基线；选它是因为这是目标主机上已验证过的配置，Python 解释器本身已无其它用途）+ NodeSource Node 22 + 全局 `@deepseek-ai/dsh` + `pnpm` + 常用工具层（见「镜像里预装了什么」）；构建期用 `--dump-config` 自检整个 `web` profile |
| `entrypoint.sh` | 预检目录可写性 → 打印沙箱体检结论 → 生成 `--patch` 覆盖层并自检 → exec dsh |
| `doctor.mjs` | 启动时探测并打印 Landlock runner 的实际可用性 |
| `compose.yaml` | `dsh`（不发布端口）+ `caddy`（TLS 入口，唯一对外端口）|
| `Caddyfile` | TLS 终结、HSTS、SSE/WebSocket 免缓冲透传、可选 basic_auth |
| `.env.example` | 所有可调项 |
| `verify.sh` | 在**物理机**上逐层验证 GUI 链路（DNS→TLS→Caddy→信任围栏→token→cookie→/api→WebSocket），失败项直接给出排查命令 |
| `data/dsh/settings.yaml` | 服务端配置（提供方/端点/模型），mock 值可直接用。位于 `./data/dsh` 目录挂载内（容器路径 `/data/dsh/settings.yaml`）：**宿主编辑会热重载，Models 页保存也会落到这个文件** |
| `patch-client-settings.mjs` | 给浏览器 bundle 打补丁，让域名访问时设置页也能读写宿主文档（见「设置页为什么现在能用」）。**构建期打在镜像预装的 profile 上（锚点不匹配即构建失败）**；entrypoint 每次启动再重放一次，覆盖运行时重装的 profile |
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
| `INSTALL_PYTHON_DOCS=1` | `python-pptx` `python-docx` `openpyxl` `Pillow` | 约 50MB |

设成 `0` 可以瘦身，但**必须重新构建**（`docker compose build && docker compose up -d`）。

### 预装的 web profile（默认开）

`INSTALL_PROFILE=1` 会在**构建期**用 dsh 自己把 `web` profile 的插件（约 250 个包）装进镜像的 `/opt/dsh-profile`，启动时由 entrypoint 种子化到 `$DSH_HOME/profiles`：`cp -a` 保留 pnpm 的符号链接结构；若运行时那份不完整（包数少于镜像），则整体替换 `node_modules`——但**不碰** `cordis.patch.yml` 等用户状态。

**为什么这么做**：dsh 在**每次启动**都会校验/安装 profile（`installFailLoud`）。那要求**容器内**能访问 npm registry（构建期的网络不等于容器的网络），而且装到一半会留下坏树导致重启循环。放到构建期就都没有了，首启也快得多。设 `INSTALL_PROFILE=0` 可退回运行时安装。

镜像里还有一道**启动冒烟测试**：构建时真的跑一次 `dsh web --no-open`，60 秒内自己退出就算失败。因为 `--dump-config` 只组合配置、**不 import 插件模块**，它在插件树坏掉时依然「成功」——那正是坏 profile 溜到线上并变成重启循环的原因。

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
DSH_SITE_ADDRESS=https://dsh.example.com
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

> ⚠️ 这个 CA 只存在于 `caddy-data` 卷里：**删卷（`docker compose down -v`）会重新生成 CA**，所有客户端都要重新信任一次。想长期免维护，就在拿到公司内部 CA 签发的证书后切到 Option B。

> ℹ️ Caddy 启动日志里的 `installing root certificate ... certificate installed properly in linux trusts` 指的是它把 CA 装进**容器内**的信任库——对宿主机浏览器无效，容器一重建就失效，别被这条日志误导。

### 证书 Option B（公司内部 CA，无警告）

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

把打印出的 URL 里的 `http://127.0.0.1:3080` 换成你的 `DSH_SITE_ADDRESS`：

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

`dsh` 决定「设置文档存在哪里」是在**浏览器里**做的，而且是硬编码：

```js
// dsh-client-ui-settings/lib/client.js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

`$host.isLoopback` 来自连接层自己的定义：

```js
// dsh-client-connection/lib/client.js
isLoopback: transport?.ownsHost === true || pageLocation === void 0
          || isLoopbackHostname(pageLocation.hostname)
```

从域名访问时三项全不成立 → `persistence = "memory"` → Models 页读的是一份**会话内的**文档，于是报 `Loading the provider directory failed: settings are available in this browser`。**General 设置页另有一处独立但同源的门禁**（`dsh-client-ui-settings-general`）。

### 本镜像怎么处理的

`patch-client-settings.mjs` 把上面那条定义改成 `true`，**在容器启动、profile 组合完成之后**应用。三条理由：

- **不需要编译源码。** 浏览器拿到的不是预构建产物：`dsh-client-modules` 是从磁盘读每个插件的 `lib/client.js`，再以 `plugins/<id>/client.js` 提供。改这个文件就是改浏览器实际执行的东西——不用编译 monorepo、不用 fork、不用每次发版 rebase。
- **只改定义那一处，两处门禁同时生效。** 这是刻意的：`-general` 那处的周边代码在 `0.1.5-rc.1 → 0.2.0-rc.2` 之间**已经变过**（`ctx.settingsScope.describe()` → `ctx.configForms.describe()`），而定义那一行**逐字未变**。
- **不依赖行号。** 锚点是整条表达式；匹配不到就打印「该用哪条 `grep` 去找上游的新写法」的诊断。写盘前还会用 `node --check` 校验语法，不通过就不落盘。定位也不靠猜路径：先用 Node 的解析器找 `@deepseek-ai/dsh-client-connection`，再退回**跟随符号链接**的遍历——pnpm 的 `node_modules` 全是符号链接，不跟随就什么都找不到。

补丁失败**只告警、不致命**：没有它整个 GUI 照常工作，只有 Models / General 设置页退化成 `settings are available in this browser`。

> **为什么镜像里要预装 profile**（踩过的坑，值得记下）：最初的设计是在 Dockerfile 里 `RUN` 这个脚本并且**锚点不匹配就让构建失败**。结果构建直接报 `no client bundle found`——因为**客户端插件包不属于 npm CLI，而属于 profile**：`npm i -g @deepseek-ai/dsh` 装出来的树里没有它们，它们由 dsh 在**首次启动**时用 pnpm 装进 `$DSH_HOME/profiles/`。
>
> 于是脚本被挪到启动期。但那样暴露了更大的问题：**首启要求容器内能访问 npm registry**（dsh 还会把环境里的 `HTTP_PROXY`/`HTTPS_PROXY` 装成自己的代理，`installProxyFromEnvironment`），而且**装到一半会留下坏树**，表现为 `plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local; could not be resolved` + 重启循环。
>
> 最终方案是**把 profile 预装进镜像**（`INSTALL_PROFILE=1`，默认开）：安装发生在构建期，那里的网络已被证明可用（同一个构建刚装完 dsh/pnpm）；entrypoint 再把结果种子化到 `$DSH_HOME`。补丁因此可以**在构建期打在预装的 profile 上**并恢复硬保证，启动期那次应用只作为兜底。

### 这不是安全回退，但确实放宽了一件事

`isLoopback` 是**客户端提示**，不是围栏：服务端仍然独立校验 Host/Origin 信任边界与 launch-token cookie，这个标志只决定页面编辑哪份文档。能带着有效 cookie 走到这些路由的攻击者，本来就能驱动容器内的 agent——那比读设置文档严重得多。

但它确实让**远端浏览器可以读写 provider 凭据**（`settings.yaml` 里的 apiKey 字段）。这是有意识的取舍，见「安全边界」一节。

### 验证

```bash
# 启动日志里应出现：
docker compose logs dsh | grep 'settings-UI patch'
#   [dsh] settings-UI patch applied: the domain-served GUI edits the host document

# 手工复核：应打印 `isLoopback: true ...`（路径在 $DSH_HOME/profiles 下，不在 /usr/local/lib/node_modules）
docker compose exec dsh sh -lc \
  'grep -n "isLoopback:" /data/dsh/profiles/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'
```

### 如果补丁哪天失效了（上游改了写法）

退路仍是 **loopback 源**。给 dsh 服务加回：

```yaml
    ports:
      - "127.0.0.1:3080:3080"
```

然后 `ssh -L 3080:127.0.0.1:3080 <user>@<server>`，浏览器打开 `http://127.0.0.1:3080/?token=<从 docker compose logs dsh 取>`。Host `127.0.0.1` 天然过信任围栏、cookie 绑 `127.0.0.1:3080`、`isLoopback` 为真 → 完整设置可用；端口只绑宿主 loopback，网络上访问不到。

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
docker compose exec -T dsh curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: nope.invalid' http://127.0.0.1:3080/

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
docker compose exec dsh curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/

# 沙箱真的在生效：在 GUI 里让 agent 跑一次 bash 写 /etc/probe，期望看到
#   [sandbox: file access denied under workspace-write mode]
# 若看到 SANDBOX_UNAVAILABLE，见下方排障表。

docker compose ps                                          # 容器健康状态
docker compose logs caddy | grep -i -E 'certificate|obtain|error'
```

`verify.sh` 会逐层打印 PASS/FAIL，退出码非 0 表示有断言失败；失败项旁边会直接给出对应的排查命令。

## 常用运维

```bash
docker compose logs -f dsh                 # 跟踪日志
docker compose restart dsh                 # 重启（会生成新的登录 token）
docker compose down                        # 停止（数据保留在 ./data/dsh）
docker compose down -v                     # 停止并删除 Caddy 数据卷（CA 会重新生成；./data/dsh 不受影响）

# 升级 dsh 版本
#   改 .env 里的 DSH_VERSION，然后：
docker compose build --pull && docker compose up -d

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
| `DSH_WORKSPACES` | `./workspaces` | 宿主目录 → 容器 `/workspaces`，也是 `workspace-write` 的边界和 agent 默认工作目录 |
| `DSH_UID` / `DSH_GID` | `1000` | 容器运行身份，必须能写 `DSH_WORKSPACES` 和宿主目录 `./data/dsh`（里面有会话、凭据与设置） |
| `DSH_PUBLIC_PORT` | `443` | Caddy 发布到宿主机的 GUI 端口 |
| `DSH_TELEMETRY_DISABLED` | `1` | 非空即关闭 OTel 上报 |

> ℹ️ 会话日志上传在这条链路上是**默认关闭**的，不必额外处理。可核实的依据：`dsh-session-log-deepseek` 的 schema 是 `enabled: z.boolean().default(false)`，其 `apply` 在 `enabled !== true` 时直接返回，而 base bundle 插入该行时没有给任何 config。
>
> 注意：仓库 master 上的 CLI 参考写的却是「default-on DeepSeek session-log upload」，与 `0.1.5-rc.1` 实际行为矛盾（很可能 master 已经演进）。**升级 `DSH_VERSION` 后请重新核对一次**：确认方式是 `docker compose exec dsh dsh plugin --profile web why @deepseek-ai/dsh-session-log-deepseek` 之外，直接看启动后的 `dsh web --dump-config | grep -A2 session-log-deepseek`，如果出现 `enabled: true`，就在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里把它改回 `false`（该文件初始内容是 `[]`，编辑时要**替换**它而不是追加）。

## 排障

| 现象 | 原因与处理 |
|---|---|
| **模型调用失败 / 一直转圈**（走内网 vLLM、LiteLLM 之类的自建端点时） | 头号嫌疑是**公司代理把内网请求也劫持走了**：容器里被注入了 `HTTP_PROXY`，而 `~/.docker/config.json` 的 `noProxy` 只列了 `172.17.0.0/16`、`192.168.*`、`.corp.local`。若端点地址是 `10.x.x.x`，请求就被送到代理 → 失败。对照验证：<br>`docker compose exec -T dsh curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 http://<端点>:端口/v1/models -H "Authorization: Bearer $KEY"`<br>再加 `--noproxy '*'` 跑一次；**两次结果不一致就确认是代理**。修法：把该 host/IP 加进 `noProxy`（顺带补 `172.16.0.0/12`）。<br>次要嫌疑：容器里写 `localhost` 到不了宿主机——用宿主局域网 IP，或给 dsh 服务加 `extra_hosts: ["host.docker.internal:host-gateway"]`。 |
| 浏览器**没有**「继续访问」按钮 | 受管 Chrome/Edge 的 `SSLErrorOverrideAllowed=false` 策略会彻底禁用跳过证书错误。打开 `chrome://policy` 搜 `SSLErrorOverrideAllowed`：若为 false，点击继续这条路走不通，只能导入 CA（Option A）或改用公司 CA 证书（Option B）。 |
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
| 改了 `DSH_BIND_PORT` 后不通 | `DSH_UPSTREAM` 会跟着变，检查 `docker compose config` 里 caddy 的 `DSH_UPSTREAM` 与 healthcheck。 |
| 流式响应「卡住」直到最后才一次性吐完 | 检查是否有中间件在缓冲 SSE：`Caddyfile` 的 site 块必须有 `flush_interval -1`（少了它，GUI 的事件流会被攒到最后才发）。 |

| `plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local; could not be resolved`（并伴随重启循环）| **profile 插件树不完整**，不是权限问题就是安装没装完。`$DSH_HOME/profiles` 是 dsh 启动时用 pnpm 装的，装一半就会这样。先看宿主侧（A2 之后状态就在眼前）：`ls data/dsh/profiles/node_modules/@deepseek-ai \| wc -l`（完整约 250）。修法：镜像预装（`INSTALL_PROFILE=1`，默认）后重启会自动种子化/修复；或手动重装并把 pnpm 的报错原样打出来：`docker compose run --rm --entrypoint sh dsh -lc 'node "$(cat /tmp/dsh-npm-bin.path)" plugin --profile web install'`——若它失败，通常就是**容器内到 npm registry 的出网**问题（注意容器会继承 `HTTP_PROXY`/`HTTPS_PROXY`）。 |

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

7. **设置页补丁**（2026-10，本地对 `0.2.0-rc.2` 实测）：补丁生效、幂等、`--check` 通过、`node --check` 语法校验通过、旧表达式归零；两处门禁读同一个定义，所以只改一处就够。**rc.1 容器上的锚点匹配仍需一次构建确认**。

### 仍待确认（部署侧动作，不是未知项）

1. **属主**：宿主目录属于别的 uid（实测 10001）时，最省事的是把 `.env` 的 `DSH_UID/DSH_GID` 设成该属主——构建参数会把它带进镜像，`./data/dsh` 这个宿主目录再 chown 一次即可。entrypoint 会打印实际属主与两种修法。
2. 首次浏览器访问的证书信任：本项目已决定**接受自签警告、点一次继续**（前提是受管浏览器未禁用 `SSLErrorOverrideAllowed`）。
3. **本轮改动需要一次构建验证**：Dockerfile / entrypoint 以 Linux 上已跑通的版本为基线，本轮新增的是「启动期补丁」与 python_server 相关删除，因此要在服务器上 `docker compose build` 一次。构建期会跑补丁断言与 `--profile web --dump-config`，失败点都落在构建阶段，而不是首次打开页面时。

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

`LICENSE` 末段附录里的 `[yyyy] [name of copyright owner]` 仍是官方占位符：要署名就替换成实际值，或另加一个 `NOTICE` 文件（Apache 2.0 第 4(d) 条要求随分发传递 NOTICE 的内容）。
