# 在 OpenShift 上部署 DeepSeek Harness（dsh）

本手册把仓库里的 docker-compose 部署搬到 OpenShift。**Caddy 整个去掉**：TLS 终结、站点路由、SSE/WebSocket 透传全部交给 OpenShift Router（HAProxy）。容器只提供一个 ClusterIP Service 背后的 HTTP 端口。

清单文件都在 [`docs/openshift/`](openshift/)：

| 文件 | 作用 | 是否必需 |
|---|---|---|
| `00-namespace.yaml` | 命名空间 `dsh` | 是（或用 `oc new-project`） |
| `01-serviceaccount.yaml` | 专用 SA，不挂载 API token | 是 |
| `02-pv-static.example.yaml` | 静态 PV 示例（无动态 provisioner 时才用） | 否 |
| `03-pvc.yaml` | 两个 PVC：`dsh-home`、`dsh-workspaces` | 是 |
| `04-configmap.yaml` | 运行时环境变量 + `settings.yaml` 种子 | 是 |
| `05-secret.example.yaml` | API key（建议改用 `oc create secret`） | 是（值可空） |
| `06-deployment.yaml` | 主工作负载 | 是 |
| `07-service.yaml` | ClusterIP，端口 3080 | 是 |
| `08-route.yaml` | 对外入口、edge TLS | 是 |
| `09-buildconfig.yaml` | 集群内构建镜像（可选） | 否 |
| `10-networkpolicy.yaml` | 只允许 router 入站（可选加固） | 否 |
| `kustomization.yaml` | `oc apply -k` 的入口 | 是 |

---

## 1. 与 compose 版的差异（先看这个）

| | docker compose | OpenShift |
|---|---|---|
| TLS 终结 | Caddy（`tls internal`，浏览器要点一次"继续"） | **Router edge termination**，用集群的 `*.apps.<cluster>` 证书，浏览器直接受信 |
| 入口 | Caddy 容器，宿主 443 | `Route` → `Service` → Pod，容器不发布端口 |
| 后端绑定地址 | entrypoint 探测容器 IPv4 | 同样探测**Pod** IPv4（`DSH_BIND_HOST=auto`）；Service DNAT 的目标就是它 |
| 状态存储 | `./data/dsh` 目录 bind mount | PVC `dsh-home` |
| 工作区 | `./workspaces` bind mount | PVC `dsh-workspaces` |
| 配置 | `.env` 文件 | ConfigMap `dsh-config` + Secret `dsh-secrets` |
| 身份 | `user: 1000:1000` | `runAsUser/fsGroup: 1000` + SCC |
| 健康检查 | compose healthcheck（curl 401） | **tcpSocket** probe（原因见 §7） |

有一点**没有**变，而且必须照做：`DSH_TRUSTED_HOSTS` 要等于浏览器实际使用的 authority，否则 `/api` 一律 403。在 OpenShift 上这个值就是 **Route 的 host**。

---

## 2. 前置条件

- **OpenShift ≥ 4.12**（RHCOS 内核 5.14，满足 Landlock 需要的 ≥5.13）。
- 一个默认 **StorageClass**（AWS `gp3-csi`、ODF `ocs-storagecluster-ceph-rbd`、vSphere CSI 等任意一种）。没有的话走 §5 的静态 PV。
- 能拉镜像：集群内构建，或把镜像推到内部 registry / GHCR / Quay。
- 若集群配置了 **cluster proxy**，确认它能访问 `deb.nodesource.com`、`registry.npmjs.org`、模型端点；构建镜像时还需要 `deb.debian.org`、`dl.google.com`（Chrome）。
- 权限：能在自己的 namespace 里创建 Deployment/Service/Route/PVC。**不需要** cluster-admin —— 除非 §8 的沙箱诊断发现 seccomp 需要额外 SCC。

部署前记下集群的 apps 域名：

```bash
oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}'
# 例如 apps.mycluster.example.com
```

---

## 3. 快速开始

```bash
# 0) 取仓库
git clone https://github.com/zjwan461/dsh-docker.git
cd dsh-docker

# 1) 建 namespace（同时把 kubectl 上下文切过去）
oc new-project dsh

# 2) 定一个对外域名（必须是集群 apps 域下的名字）
HOST=dsh.apps.mycluster.example.com

# 3) 把占位符换成你的域名 —— ConfigMap 和 Route 两处，一条命令搞定
sed -i.bak "s/dsh\.apps\.example\.com/${HOST}/g" \
  docs/openshift/04-configmap.yaml docs/openshift/08-route.yaml

# 4) Secret。key 可以先留空：Deployment 里两个都是 optional，pod 照样起；
#    之后补 key 或直接在模型页里填都行。
#    （必须在 namespace 建好之后做，所以这一步排在 1 后面。）
oc create secret generic dsh-secrets -n dsh \
  --from-literal=DEEPSEEK_API_KEY='' \
  --from-literal=LITELLM_API_KEY='' --dry-run=client -o yaml | oc apply -f -

# 5) 其余清单
oc apply -k docs/openshift

# 6) 等它就绪（首次启动要组合 profile，约 30–60 秒）
oc rollout status deployment/dsh -n dsh

# 7) 取登录 token
oc logs -n dsh deployment/dsh | grep -o 'https\?://[^ ]*token=[A-Za-z0-9._-]*' | tail -1
```

第 7 步打印出来的地址形如 `http://10.128.x.x:3080/?token=…`（容器只绑 Pod IP，这是**集群内**地址，浏览器打不开）。把它换成：

```
https://${HOST}/?token=<刚才那串>
```

打开后 token 会换成签名 cookie 并跳转到干净 URL。cookie 默认 30 天，签名密钥在 PVC 里，所以 pod 重启通常不需要重新登录。

> **顺带一提**：这个"日志里是内网地址"不是故障。entrypoint 绑定 Pod IPv4 是 0.2.1 的硬性要求（该行拒绝 `0.0.0.0`），Router 会把它映射到你的域名。

---

## 4. 镜像从哪来（三选一）

Deployment 里写的是集群内部 registry 地址：

```yaml
image: image-registry.openshift-image-registry.svc:5000/dsh/dsh:latest
```

### 方式 A：集群内构建（推荐，最省事）

```bash
oc apply -f docs/openshift/09-buildconfig.yaml
oc start-build dsh -n dsh --follow
```

首次构建 20–40 分钟（apt + npm + LibreOffice/Chrome）。注意构建 Pod 需要出网；被代理卡住时给 `BuildConfig` 加 `strategy.dockerStrategy.env` 里的 `HTTP_PROXY` 等，或改用方式 C。

### 方式 B：本地构建后推进内部 registry

```bash
# 本机有 docker/podman
podman build -t dsh:0.2.1-rc.5 .
podman tag dsh:0.2.1-rc.5 $(oc registry info)/dsh/dsh:latest
podman push --tls-verify=true $(oc registry info)/dsh/dsh:latest
oc rollout restart deployment/dsh -n dsh
```

### 方式 C：用 GHCR 上 CI 构建好的镜像

仓库自带 GitHub Actions（构建并推 `ghcr.io/zjwan461/dsh-docker`）。如果包是公开的：

```bash
oc set image deployment/dsh -n dsh \
  dsh=ghcr.io/zjwan461/dsh-docker:0.2.1-rc.5
```

私有的就在 namespace 里建一个 pull secret 并挂到 SA 上：

```bash
oc create secret docker-registry ghcr-pull -n dsh \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<token>
oc secrets link dsh ghcr-pull --for=pull -n dsh
```

---

## 5. 存储

默认用动态 provisioner：`03-pvc.yaml` 里不写 `storageClassName`，两个 PVC 会自动绑定。

- `dsh-home` 10Gi —— `settings.yaml`、`.credentials.yaml`、`profiles/`、`sessions/`、`logs/`。**备份就是备份它**。
- `dsh-workspaces` 20Gi —— agent 的工作目录，产物都在这，会无限长大。

**必须 ReadWriteOnce、必须单副本。** `06-deployment.yaml` 用的是 `strategy: Recreate`，就是为保证"先杀旧 pod 再挂新 pod"，同一时刻只有一个进程写这个卷。

集群没有动态 provisioner 时，启用静态 PV：

```bash
# 1) 按注释改好 02-pv-static.example.yaml 里的 NFS server/path 和容量
oc apply -f docs/openshift/02-pv-static.example.yaml
# 2) 在 03-pvc.yaml 里取消注释 storageClassName: "" 与 volumeName
oc apply -f docs/openshift/03-pvc.yaml
```

> `persistentVolumeReclaimPolicy: Retain` 是刻意的：删 PVC 不该连带删掉会话和设置。

---

## 6. 安全上下文与 SCC（最容易踩的一节）

镜像构建时的 `DSH_UID=1000` 就是容器里的 `node` 用户。清单把运行身份钉死成同一组数字：

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
```

**为什么不能交给 OpenShift 随机分配 UID**：dsh 0.2.1 在启动时要求 `$DSH_HOME/.credentials.yaml` 只对属主可读，否则硬失败（`credentials-local: … is readable beyond its owner`）。entrypoint 会主动 `chmod 600` 修它 —— 而 **chmod 需要文件属主身份**。随机 UID 下这个文件由 `root:fsGroup` 创建，容器无权 chmod，于是启动即失败：

```
[dsh] ERROR: /data/dsh/.credentials.yaml is mode 777 and this container cannot chmod it
        (uid 1000 does not own it). dsh 0.2.1 refuses to start on a group/other-readable
        credentials file. On the host: sudo chmod 600 …
```

> 最后那句 "On the host: sudo chmod …" 是给 docker 版写的；在 OpenShift 上没有"宿主目录"，等价做法是用一个以 root 运行的临时 pod 去改，或（更推荐）直接确认 `runAsUser` 与文件属主一致，让 entrypoint 自己改成功。最简单：`oc exec -n dsh deploy/dsh -- rm -f /data/dsh/.credentials.yaml` 再重启，凭据在网页里重填一次。

`runAsUser: 1000` 是让文件属主与进程一致，`fsGroup: 1000` 是让 PVC 挂上时目录对 1000 组可写。

**用哪个 SCC**：默认的 `restricted-v2` 就够 —— `runAsUser` 是 `MustRunAsNonRoot`，显式写 4 位非零 UID 是允许的；`fsGroup` 不限值。检查一下：

```bash
oc get scc restricted-v2 -o jsonpath='{.runAsUser}{"\n"}{.fsGroup}'
oc adm policy scc-subject-review -z dsh -n dsh   # 确认 SA 能用哪个 SCC
```

如果被策略挡住（`runAsUser: 1000` 报 `not allowed`），说明集群改过 SCC，需要管理员给 `dsh` 这个 SA 绑定 `nonroot-v2`：

```bash
oc adm policy add-scc-to-user nonroot-v2 -z dsh -n dsh
```

> 改了镜像的 `DSH_UID` 构建参数就必须同步改这里的 `runAsUser`/`fsGroup`，两者不一致会以同样的 chmod 错误失败。

---

## 7. 健康检查为什么是 TCP 而不是 HTTP

dsh 对未登录的 `GET /` 返回 **401** —— 这是健康状态。而 Kubernetes 的 `httpGet` 探针只把 **2xx/3xx** 当成功，401 会被判为失败，健康的 pod 会被反复重启。

所以三个探针都用 `tcpSocket`：TCP 能连上 = 监听正常；而 profile 组合失败时进程会直接退出、端口随之关闭，照样能被发现。

首次启动要组合 profile、chmod 凭据、连插件树，所以 `startupProbe` 给了 36×5s ≈ 3 分钟。

---

## 8. 沙箱（Landlock）与 seccomp

容器里 agent 的 `workspace-write` 约束依赖 **Landlock**，而 Landlock 系统调用可能被容器的 seccomp profile 拦掉。启动日志里有一行体检结论：

```bash
oc logs -n dsh deployment/dsh | grep 'landlock launcher'
# 期望：full (/usr/local/lib/node_modules/.../landlock-run)
```

三种结果对应三种处置：

| 结论 | 含义 | 处置 |
|---|---|---|
| `full` | 一切正常 | 无 |
| `partial` | 内核 Landlock ABI 偏旧 | 可接受：文件写入仍受限，部分新权限位不受治理 |
| `unusable` / 出现 `SANDBOX_UNAVAILABLE` | seccomp 拦了 landlock 系统调用，或内核 < 5.13 | 见下 |

`unusable` 的两条出路：

1. **（推荐）** 让平台放行。需要集群管理员为这个 SA 提供一个允许 landlock 的 seccomp profile（自定义 SCC 的 `seccompProfiles`，或升级到已放行 landlock 的 OCP 版本）。
2. **降低沙箱强度**：在 ConfigMap 里设

   ```yaml
   DSH_PERMISSION_MODE: danger-full-access
   ```

   注意这一项**同时**把审批提示变成 `never`，容器就成了唯一边界 —— 只在你能接受"agent 在容器内不受文件限制"时这么做，并配合 §11 的 NetworkPolicy。

---

## 9. Route、TLS 与长连接

`08-route.yaml` 的关键点：

```yaml
tls:
  termination: edge
  insecureEdgeTerminationPolicy: Redirect
```

- **edge**：Router 持证书、对 pod 说 HTTP。dsh 自己不提供 TLS，这正是我们要的。
- **Redirect**：浏览器打 `http://` 会被 301 到 https，避免 cookie 明文上路（dsh 的会话 cookie 没有 `Secure` 标志）。
- **`haproxy.router.openshift.io/timeout: 3600s`**：SSE 事件流和 `/api/remote.mux` 的 WebSocket 会长时间静默，Router 默认 30s 会掐断。这条等价于 compose 版 Caddyfile 里的 `flush_interval -1`。

**为什么不再需要 Caddy 的其它职责**：

| Caddy 原本做的事 | OpenShift 上谁做 |
|---|---|
| 证书签发（`tls internal`） | 集群 ingress 的默认证书 |
| 443 监听 | Router |
| `reverse_proxy dsh:3080` | `Route` → `Service` → Pod |
| SSE 免缓冲 | HAProxy 默认流式 + 上面的 timeout |
| WebSocket 升级 | Router 原生支持 |
| 可选 `basic_auth` | 需要的话用 Route 的 `ip_whitelist`，或在前置的 oauth-proxy 后面 |

如果确实要再加一层认证，标准做法是把 dsh 的 Service 放到一个带 `oauth-proxy` sidecar 的 pod 后面，让 Route 指向那个 Service —— 但那已经超出本手册范围。

---

## 10. 验证

按顺序过一遍，每条给出期望值与失败时的方向：

```bash
# 1) Pod 起来了
oc get pods -n dsh
#    期望 READY 1/1，STATUS Running，RESTARTS 0

# 2) 启动日志里的关键行
oc logs -n dsh deployment/dsh | grep -E \
  'dsh version|credentials document|bind overlay|bundled plugin|settings-UI patch|landlock launcher'
#    [dsh] dsh version: 0.2.1-rc.5
#    [dsh] credentials document: /data/dsh/.credentials.yaml (mode 600, owner-only)
#    [dsh] wrote bind overlay /data/dsh/.runtime/webserver-bind.yml (host=10.128.x.x, port=3080; requested auto)
#    [dsh] bind overlay verified against the composed config tree
#    [dsh] bundled plugins: N from /opt/dsh-plugins
#    [dsh] settings-UI patch present: the domain-served GUI edits the host document
#    dsh doctor: landlock launcher full (...)

# 3) 未经认证访问应得 401（不是 403/502/404）
curl -s -o /dev/null -w '%{http_code}\n' https://dsh.apps.mycluster.example.com/
#    401 = 通过 Router、通过 Host 信任围栏、dsh 要求认证 → 正常
#    403 = DSH_TRUSTED_HOSTS 与 Route host 不一致
#    503 = pod 未就绪；504/502 = Router 到不了 Service

# 4) /api 围栏（无 cookie 也是 401；403 同上说明 Host 不对）
curl -s -o /dev/null -w '%{http_code}\n' https://dsh.apps.mycluster.example.com/api/probe

# 5) 登录流程（303 + cookie，然后 200）
TOKEN=$(oc logs -n dsh deployment/dsh | grep -o 'token=[A-Za-z0-9._-]*' | tail -1 | cut -d= -f2)
curl -s -o /dev/null -w '%{http_code}\n' -c /tmp/dsh.jar "https://dsh.apps.mycluster.example.com/?token=$TOKEN"   # 303
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/dsh.jar https://dsh.apps.mycluster.example.com/                  # 200

# 6) WebSocket 能升级（101）
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 -b /tmp/dsh.jar \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://dsh.apps.mycluster.example.com/api/remote.mux
#    101 = 正常；504 = 第 3 步的 Router→Service 链路有问题
```

浏览器里再做三件事：

1. **设置 → 模型**：能看到 provider 并可保存（说明 `settings-UI patch` 生效、PVC 可写）。
2. 让 agent 跑 `touch /etc/probe`，应报 `[sandbox: file access denied under workspace-write mode]`。
3. 让 agent 写一个文件，然后 `oc exec -n dsh deploy/dsh -- ls /workspaces` 能看到它（说明 PVC 挂对了）。

---

## 11. 运维

```bash
# 升级镜像版本
oc set image deployment/dsh -n dsh dsh=<registry>/dsh:0.2.1-rc.6
oc rollout status deployment/dsh -n dsh

# 改配置（ConfigMap 不会自动重启 pod）
oc edit configmap dsh-config -n dsh
oc rollout restart deployment/dsh -n dsh

# 改登录门禁的账号密码（login-gate 插件的选项）
oc exec -n dsh deploy/dsh -- vi /data/dsh/cordis.patch.yml
#   该文件是"首次启动时播种、之后不再覆盖"的，改完重启生效

# 备份（会话、设置、凭据都在 dsh-home 里）
oc exec -n dsh deploy/dsh -- tar czf - -C /data/dsh . > dsh-home-$(date +%F).tgz

# 看实时日志
oc logs -n dsh deploy/dsh -f
```

**不要扩到 2 副本。** 这不是"再加一个就更快"的服务：两个 pod 会同时写同一个 RWO 卷里的 profile 和会话库。需要更高并发时，正确做法是每个用户/团队一个 namespace + 一套独立 PVC。

**改 `DSH_TRUSTED_HOSTS` 后**必须重启 pod 才生效（环境变量在进程启动时读）。

---

## 12. 可选：把 settings.yaml 的来源换成仓库里的完整版

`04-configmap.yaml` 里内嵌的是一份精简种子。想用仓库里带完整注释的那份：

```bash
oc create configmap dsh-settings-seed -n dsh \
  --from-file=settings.yaml=data/dsh/settings.yaml \
  --dry-run=client -o yaml | oc apply -f -
```

注意这只是**种子**：只有 PVC 上还没有 `settings.yaml` 时才会被复制过去。已经跑起来的实例要改配置，请直接改 `$DSH_HOME/settings.yaml`（宿主无挂载，用 `oc exec` 进去改，或走模型页），或者删掉卷上那份再重启。

---

## 13. 与 compose 版的行为差异 / 已知限制

- **没有 Caddy 的 basic_auth**。需要额外认证就用 Route 的 `ip_whitelist`，或前置 oauth-proxy。
- **没有明文 HTTP 站点**。compose 版可以选择性发布 `:80`（带 HSTS 警告），OpenShift 上 `insecureEdgeTerminationPolicy: Redirect` 直接封掉这条路。这是好事：cookie 不带 `Secure`。
- **`oc port-forward` 得到的 `127.0.0.1` 是 loopback 源**，`isLoopback` 为真，设置页功能完整 —— 如果哪天客户端补丁失效，这是等价的退路：

  ```bash
  oc port-forward -n dsh svc/dsh 3080:3080
  # 浏览器打开 http://127.0.0.1:3080/?token=…（token 从日志取）
  ```

- **构建缓存**：OCP 的 Docker 构建默认不保留层缓存（除非管理员配了 `buildOverrides` 的 build cache），所以集群内重建通常比本地慢。频繁迭代建议本地构建 + push。
- **会话格式**：0.2.1 是 v4，安装树里带 v3→v4 迁移。升级前照 §11 备份 `dsh-home`。

---

## 14. 排障

| 现象 | 原因与处置 |
|---|---|
| Pod 一直 `Pending` | PVC 没绑上。`oc get pvc -n dsh` 看 `dsh-home`/`dsh-workspaces` 是否 `Bound`；没有默认 StorageClass 就按 §5 建静态 PV。 |
| Pod `CrashLoopBackOff`，日志 `$DSH_HOME (/data/dsh) is not writable` | `fsGroup` 没设定或与 PVC 的实际属主冲突。确认 `06-deployment.yaml` 的 `fsGroup: 1000` 还在；已有卷被别的 UID 写过时，`oc exec` 进去 `ls -ln /data/dsh` 看属主。 |
| 日志 `credentials-local: … is readable beyond its owner (mode 777)` | 卷上那份凭据文件权限过宽，而容器不是它的属主、chmod 不动。确认 `runAsUser: 1000` 与创建它的身份一致；必要时 `oc exec`（以 root 需 SCC）或临时 job 把该文件改成 600。 |
| 日志 `[dsh] ERROR: … this container cannot chmod it` | 同上，属于 UID 不一致。检查 `runAsUser` 是否等于镜像构建时的 `DSH_UID`。 |
| 日志 `webserver: host "0.0.0.0" is an unspecified (wildcard) address` | ConfigMap 里 `DSH_BIND_HOST` 被写成了 `0.0.0.0`。改回 `auto`。 |
| 浏览器 403 | `DSH_TRUSTED_HOSTS` 与 Route 的 host 不一致，或多写了 `:443`。两者都必须是**无端口**的裸 authority。改完记得 `oc rollout restart`。 |
| 浏览器 503 / 504 | pod 未就绪或 Router 到不了 Service。先 `oc get endpoints dsh -n dsh`（应有 IP），再看 §10 第 3 步。 |
| 页面能开但**设置页**保存不了 | 确认日志有 `settings-UI patch present`；没有就是镜像在构建后被改过，重建。临时退路见 §13 的 `oc port-forward`。 |
| 流式回答「卡住」到最后一起来了 | Route 少了 `haproxy.router.openshift.io/timeout`，长连接被缓冲/掐断。确认 `08-route.yaml` 的注解还在。 |
| 日志 `SANDBOX_UNAVAILABLE` | §8：seccomp 拦了 landlock，或内核过旧。 |
| 构建失败，`registry.npmjs.org` / `deb.nodesource.com` 超时 | 构建 Pod 出不了网。给 BuildConfig 加代理环境变量，或改用 §4 方式 B/C。 |
| 拉镜像 `ImagePullBackOff`，事件里是内部 registry 的 **401** | `01-serviceaccount.yaml` 里的 `automountServiceAccountToken: false` 与集群的 registry 鉴权方式冲突（少见）。先把它改成 `true` 重试；仍失败就用 §4 方式 B 推到外部 registry，并用 `imagePullSecrets`。 |
| 首次启动很慢（>2 分钟仍未 ready） | 首次要组合 profile 并建插件树，正常 30–60 秒；PVC 是网络存储（NFS/ceph）时会慢一些。`startupProbe` 已给到 3 分钟。 |
| 升级后日志出现 `found N leftover package link(s) in …/@deepseek-ai` | 0.2.0 时代的旧投影残留在 `dsh-home` 里。0.2.1 不致命，清理：`oc exec -n dsh deploy/dsh -- rm -rf /data/dsh/profiles/node_modules` 后重启。 |

---

## 15. 卸载

```bash
oc delete -k docs/openshift
```

⚠️ **PVC 默认不会随 `delete -k` 删除**（kustomize 清单里没有它们被删除的语义，且 PV 是 `Retain`）。要连数据一起清：

```bash
oc delete pvc dsh-home dsh-workspaces -n dsh
oc delete project dsh
```

删之前先备份 `dsh-home`（§11）—— 里面是全部会话、设置和凭据。