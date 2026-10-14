# dsh 管理端（FastAPI）

给 `dsh-docker` 这套部署配的一个**很小的管理端**，自己也是一个容器。目前只做一件事：

> 读 `dsh` 容器的启动日志，把**当前这次运行**的登录 token 取出来，
> 并拼出浏览器可以直接点的登录链接。

## 为什么需要它

token 由 `dsh web` 在启动时随机生成、只打印一次、**不落盘**（见部署 README「首次登录」）。
取它的原始命令是：

```bash
docker compose logs dsh | grep -o 'token=[A-Za-z0-9._-]*' | tail -1
```

这条命令有三个坑，管理端就是把它们处理掉：

| 坑 | 管理端的处理 |
|---|---|
| `docker logs` **跨重启保留**，日志里可能有好几个 token，只有最新那个有效 | 向 daemon 要 `since = <容器本次 StartedAt>`，只看**当前这次运行**，并在窗口内取时间最靠后的一个 |
| 日志里的地址是**容器内**的（`127.0.0.1:3080` / bridge 网段 `172.x`），浏览器到不了 | 从部署的 `.env` 读 `DSH_SITE_ADDRESS`，拼出 `https://<域名>/?token=...` |
| 容器停掉以后，日志里那个 token **已经失效** | 一并返回容器状态；容器不在运行就直接在页面上说明 |

## 它是怎么跑、怎么读日志的

```
  宿主机浏览器 ──SSH 隧道──> 127.0.0.1:8642 ──> admin 容器 (FastAPI)
                                                   │  Docker SDK over socket
                                                   ▼
                                            /var/run/docker.sock
                                                   │
                                                   ▼
                                         dsh 容器（读它的 stdout 日志）
```

- **用 Docker SDK（`docker` 包）通过 `/var/run/docker.sock` 调用 daemon**，不调 `docker` CLI，
  所以镜像里不需要装 docker 客户端，也不需要 `DOCKER_HOST`。
- 它挂在 compose 的 `admin` profile 下，因此**默认不启动**：`docker compose up -d` 的行为
  和以前完全一样（仍然是「一个入口、只服务一个站点」）。
- 它和 dsh 之间**不走网络**，只走 socket，所以不需要知道 dsh 的端口，也不需要 Caddy 参与。

## 快速开始

```bash
cd dsh-docker

# 1) 在 .env 里加两项（ADMIN_PASSWORD 是必填的，compose 会拒绝缺失）
#    ADMIN_PASSWORD=<一个强密码>
#    ADMIN_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
echo "ADMIN_PASSWORD=$(openssl rand -base64 18)" >> .env
echo "ADMIN_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)" >> .env

# 2) 构建并启动（profile: admin）
docker compose --profile admin up -d --build admin
docker compose --profile admin logs -f admin

# 3) 从你本机通过 SSH 隧道打开
ssh -L 8642:127.0.0.1:8642 <user>@<server>
#    浏览器打开 http://127.0.0.1:8642/ ，用 ADMIN_USER/ADMIN_PASSWORD 登录
```

页面上会显示：token（默认打码，点「显示 token」）、可复制的登录链接、
容器与日志窗口状态，以及本次运行的启动日志。

> `ADMIN_DOCKER_GID` 是**构建参数**，改了它必须重建：`--build` 已经带上了。
> 宿主上 `stat -c '%g' /var/run/docker.sock` 通常给出 `999`（Debian/Ubuntu）。
> 填错的表现是页面上一条 `PermissionError` 提示，它会告诉你该怎么做。

## 接口

所有接口（除 `/healthz`）都要过密码认证。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 页面 |
| GET | `/api/token` | 完整报告（JSON）。`?lines=N` 控制返回多少行启动日志 |
| GET | `/api/token.txt` | **只有 token 一行**，给脚本用 |
| GET | `/api/config` | 页面需要的非敏感配置（不含 token、不含密码） |
| GET | `/healthz` | 存活探针，**不需要认证**，且不含任何部署信息（镜像的 HEALTHCHECK 用它） |

`/api/token` 永远返回 200，用一个 `ok` 字段表示成败——容器没起、日志被轮转、daemon 连不上
都是这里的正常运行状态，页面会把原因直接显示出来。示例：

```json
{
  "ok": true,
  "container": {
    "name": "dsh-dsh-1", "running": true, "status": "running",
    "started_at": "2026-07-16T07:23:41+00:00", "discovery": "label"
  },
  "token": {
    "found": true,
    "value": "Nq_NkUTavtzTdSUFu1_nJSlXHRN7AEq3f-E9yDlec1A",
    "issued_at": "2026-07-16T07:23:58+00:00",
    "stale": false,
    "matches_in_window": 1
  },
  "urls": {
    "loopback": "http://127.0.0.1:3080/?token=...",
    "lan": "http://172.24.0.2:3080/?token=...",
    "public": "https://dsh.gen-ai.website/?token=..."
  },
  "log": { "since": "...", "lines_read": 14, "tail": 200, "startup_lines": ["..."], "truncated": false },
  "warnings": []
}
```

脚本里取 token（在宿主机上，经隧道或本机）：

```bash
TOKEN=$(curl -s -u "$ADMIN_USER:$ADMIN_PASSWORD" http://127.0.0.1:8642/api/token.txt)
curl -s -o /dev/null -D - -c /tmp/dsh.jar --cacert /tmp/caddy-root.crt \
  "https://dsh.example.com/?token=$TOKEN" | head -3
```

## 配置

容器里的值由 compose 从部署目录的 `.env` 传入，全部见 [`../.env.example`](../.env.example) 的
「admin panel」一段；其中几个：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 无 | **必填**。管理端的 HTTP Basic 密码；空值 compose 直接拒绝启动 |
| `ADMIN_USER` | `admin` | Basic 用户名 |
| `ADMIN_PORT` | `8642` | 发布到**宿主 loopback** 的端口 |
| `ADMIN_DOCKER_GID` | `999` | 宿主 docker socket 的组号，**构建参数** |
| `ADMIN_CONTAINER` | 空 | 直接指定容器名/ID；为空时自动发现 |
| `ADMIN_REFRESH_SECONDS` | `5` | 页面自动刷新间隔 |

自动发现顺序（容器名按 `compose.yaml` 的 `name: dsh` 推出，即 `dsh-dsh-1`）：

1. `ADMIN_CONTAINER`（显式指定）
2. compose 标签 `com.docker.compose.project=dsh` + `com.docker.compose.service=dsh`
3. 容器名含 `dsh-dsh`

匹配到多个时，**优先运行中**的那个，其次取启动时间最新的。

其余调优项（`ADMIN_LOG_TAIL`、`ADMIN_LOG_TAIL_MAX`、`ADMIN_STARTUP_LINES`、`ADMIN_DOCKER_TIMEOUT`、
`ADMIN_SITE_ADDRESS`、`ADMIN_PUBLIC_PORT`、`ADMIN_COMPOSE_PROJECT`、`ADMIN_COMPOSE_SERVICE`）
见 [`admin/.env.example`](.env.example)——那是**在宿主上直接跑**时的配置文件，
容器运行时同名环境变量仍然生效（可以直接在 compose 的 `admin.environment` 里加）。

## 安全

两件事让这个管理端必须在受控的位置运行：

1. **它显示的是密码。** token 只在 dsh 进程存活期间有效，但拿到它的人可以驱动一个
   能在 dsh 容器里执行命令的 agent。
2. **它持有 Docker socket。** 为了读另一个容器的日志，它必须能调用 daemon——
   而那等同于宿主机的 root：这个容器可以让 daemon 做任何事（起特权容器、挂载宿主目录…）。
   这是它比「只读日志」大得多的一项权限，**没有更窄的路可走**。

因此：

- `ADMIN_PASSWORD` **必填**；且 `app/main.py` 在启动时独立检查——只要绑定的不是
  `127.0.0.1`/`::1`/`localhost` 而没有密码，进程**直接拒绝启动**（日志里给出中文说明）。
  这是第二道锁：compose 的 `:?` 是第一道。
- 只发布到 **宿主 loopback**（`127.0.0.1:${ADMIN_PORT}:8642`）。要访问就 SSH 隧道：
  `ssh -L 8642:127.0.0.1:8642 <user>@<server>`。
- 所有响应带 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`，凭据不会被缓存或经
  Referer 泄出。
- 管理端**不打印 token**：它自己的日志里只有「谁在什么时候取过一次报告」。
- `/docs`、`/openapi.json` 关闭。
- 容器以非 root 用户运行，只加进 socket 的组。

**不要**把它接到公网（例如加进 Caddy 的站点、或把端口发布到 `0.0.0.0`）。真要做，
至少要做到三件事：TLS、强密码、来源 IP 限制；并且清楚上面第 2 条意味着什么。
部署 README「安全边界」一节对 dsh 本身的结论同样适用。

## 在宿主上直接跑（开发用）

不需要 Docker 时也可以直接在宿主机跑（用同样的 Docker SDK + socket）：

```bash
cd dsh-docker/admin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env      # 默认只监听 127.0.0.1:8642，不需要密码
./run.sh
```

需要当前用户能访问 `/var/run/docker.sock`（在 `docker` 组里即可，**不需要 root**）。
这只是开发/备用路径；正常部署用上面的 compose 服务。

## 指向远程 daemon（可选，需要自己改几行）

**结论先说：代码不用改，接线要改。** `DockerSource` 用的就是 `docker.from_env()`，
而它和 docker CLI 读同一组变量，所以远程 daemon 一样能读——`container.logs()` 本来就是
daemon 侧调用，`since` 窗口、取最新 token、失效判定的逻辑完全相同。

下面是**我用装好的 SDK 实测过**的行为（`docker.utils.kwargs_from_env`，docker-py 7.x），
不是从文档抄的——请按这个理解：

| 变量 | 实测语义 |
|---|---|
| `DOCKER_HOST` | daemon 地址，如 `tcp://10.0.0.9:2376`。**空串或未设 = 用默认本地 socket**，所以留空就等于今天的行为 |
| `DOCKER_TLS_VERIFY` | **空串 = 不做校验**；**其它任何值（连 `0` 也算）= 视为开启校验**。开启后若证书目录里缺 `cert.pem`/`key.pem`，客户端**在创建时就抛 `TLSParameterError`**（不会静默降级成明文）。想关就留空，别写 `0` |
| `DOCKER_CERT_PATH` | 容器内的证书目录。**只要非空就启用 TLS**（此时即使不校验，也仍然要求 `cert.pem`+`key.pem` 存在）；校验开启时 `ca.pem` 也**必须**是合法 CA，否则报 `Invalid CA certificate provided for 'ca_cert'`。空串 = 不启用 TLS |

实测还确认了一个细节：开启校验但**没给** `DOCKER_CERT_PATH` 时，SDK 会去容器的 `~/.docker`
找证书——镜像里没有这个目录，所以会直接报错。**三个变量一起填或一起留空**最省事，
而且实测确认：**三个都留空 = 与今天完全一致**（走本地 socket，不启用 TLS），
所以你可以先在 compose 里把那几行加上、值留空，确认行为没变，再逐个填。

### 1) 改 `compose.yaml` 的 `admin` 服务

```yaml
    environment:
      # ……原有的 ADMIN_* 保留……
      DOCKER_HOST: ${DOCKER_HOST:-}
      DOCKER_TLS_VERIFY: ${DOCKER_TLS_VERIFY:-}
      DOCKER_CERT_PATH: ${DOCKER_CERT_PATH:-}
    volumes:
      # 走 TLS 才需要这一行（宿主目录 → 容器内目录）
      - ${DOCKER_CERT_DIR:-./certs/docker}:/certs/docker:ro
      # 同时【删掉】这一行：
      # - /var/run/docker.sock:/var/run/docker.sock
```

**那条 socket 挂载必须删掉**，不是可选项：设了 `DOCKER_HOST` 之后它会被 SDK 忽略，
但挂载本身仍然有效——等于这个容器同时握着**本机 root 和远程 root**，白送一份权限。

### 2) 在 `.env` 里填值

见 [`../.env.example`](../.env.example) 的「管理端指向远程 daemon」一段。
证书目录在宿主上的样子：

```
./certs/docker/
├── cert.pem     # 客户端证书（必需）
├── key.pem      # 客户端私钥（必需）
└── ca.pem       # 校验服务端用（DOCKER_TLS_VERIFY 非空时必需）
```

对应 `DOCKER_CERT_PATH=/certs/docker`（**容器内**路径，不是宿主路径）。

### 3) 三个容易踩的点

- **容器发现在远程那台机器上做**：仍按 compose 标签/名字找，所以要指向远程那套 ——
  改 `ADMIN_COMPOSE_PROJECT`/`ADMIN_COMPOSE_SERVICE`（默认 `dsh`/`dsh`），
  或直接 `ADMIN_CONTAINER=<远程容器名>`。找不到时的报错会把尝试过的方式列出来。
- **远端日志驱动必须可读**：`json-file`/`local` 可以；换成 syslog/journald 之类读不到，
  页面会给专门提示（这种情况只能在那台机器上 `docker compose logs dsh` 手工取）。
- **时钟不用对**：`since` 用的是**远端容器自己的 `StartedAt`**，比较也发生在远端 daemon 上，
  所以管理端与远端时钟不同步不影响判定。

### 4) 改完这样验证

容器里没有 docker CLI，但有 python + SDK，直接自查最快：

```bash
docker compose --profile admin exec admin python -c \
  "import docker; c=docker.from_env(); print('base_url:', c.api.base_url); \
   print('ping:', c.ping(), '| server:', c.version()['Version']); \
   print('containers:', [x.name for x in c.containers.list(all=True, filters={'name':'dsh'})])"
```

`base_url` 应显示你填的 `DOCKER_HOST`、`server` 显示远端 daemon 版本、
`containers` 列出远端那台机器上的 dsh 容器。之后打开页面即可。

配错时页面上会直接显示下面这些（`app/dsh_logs.py` 会把这些错误翻译成人话，
所以不要把「配置不完整」误读成「daemon 挂了」）：

| 页面上的提示 | 实际原因 |
|---|---|
| `Docker 的 TLS 配置不完整：……必须有 cert.pem 和 key.pem` | 设了 `DOCKER_TLS_VERIFY` 或 `DOCKER_CERT_PATH`，但目录里缺 `cert.pem`/`key.pem`（SDK 的 `TLSParameterError`，发生在建立连接**之前**） |
| `TLS 握手或证书校验失败：远端 daemon 的证书不被信任` | 连上了，但 `ca.pem` 不对（自签 CA 没放进目录 / 放的不是签发者） |
| `连不上 Docker：找不到 docker socket，或那里没有人在监听` | `DOCKER_HOST` 地址或端口不对、防火墙、或（本地场景）没挂 socket |
| `没有权限访问 docker socket（PermissionError）` | 本地场景的 socket 组不对 → 用 `ADMIN_DOCKER_GID` 重建 |
| `这个容器的日志驱动不支持读取` | 远端 daemon 上 dsh 容器用了 syslog/journald 之类；只能在那台机器上手工取 |

### 5) `ssh://` 形式要付额外代价

`DOCKER_HOST=ssh://user@host` 也能用，但 SDK 的 ssh transport **依赖 paramiko**（我方核实过，
镜像里没有），所以需要 `pip install "docker[ssh]"` 并准备私钥 / `known_hosts`。
只为了连远程的话，**`tcp://` + 客户端证书更省事**。

### 6) 安全提醒（远程比本地更需要注意）

- **绝不要用明文 `tcp://…:2375`**：未认证的 daemon 端口等于把远程 root 敞开给任何能连上的人。
  要么 `2376` + 客户端证书（`DOCKER_TLS_VERIFY` 非空 + 三个 pem），要么走 SSH 隧道。
- 指向远程后，这个容器持有的是**那台远程机**的 root 等价权限。生产机上建议配合：
  只发布 loopback（默认已经是）、强 `ADMIN_PASSWORD`、以及不要把管理端接进 Caddy。
- 远程 daemon 的证书私钥是「谁能读谁就能 root 那台机器」，所以 `./certs/docker` 的权限按这个标准收。

## 测试

```bash
cd dsh-docker/admin
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

`tests/test_dsh_logs.py` 用一个假的 Docker SDK 客户端喂**真实启动日志的形状**
（含真实 token、两次重启、日志轮转、容器已停、daemon 连不上等），覆盖 `--since` 窗口、
取最新 token、失效判定、容器发现顺序、URL 拼装；
`tests/test_api.py` 覆盖认证、缓存头、启动门禁与错误路径。共 44 个用例。

## 目录结构

```
admin/
├── app/
│   ├── config.py        # 配置：ADMIN_* 与从部署 .env 读的 DSH_*；安全门禁
│   ├── dsh_logs.py      # 核心：Docker SDK 定位容器 → 读日志 → 提取/判定 token
│   └── main.py          # FastAPI 路由、Basic 认证、安全响应头
├── static/index.html    # 页面（原生 JS，无构建步骤）
├── tests/               # pytest；test_dsh_logs.py 不需要 fastapi
├── Dockerfile           # admin 镜像（非 root；socket 组由构建参数决定）
├── .dockerignore
├── .env.example         # 宿主直跑时用；容器里由 compose 传环境变量
├── requirements.txt / requirements-dev.txt
├── pytest.ini
└── run.sh               # 宿主直跑入口（开发用）
```

## 后续可以加的功能

按需要再加，目前刻意没做：重启 dsh 容器（token 会随之更新）、显示 Caddy/证书状态、
把登录链接生成二维码、多容器/多项目切换、token 变化时发通知。