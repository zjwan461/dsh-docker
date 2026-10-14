"""Read the ``dsh`` container's log and pull out the current login token.

This module is the whole point of the admin panel, so the rules it encodes are
spelled out here.

Facts it is built around (verified against the deployment README and real startup
logs):

* ``dsh web`` prints the token exactly once per process, on one line::

      dsh web: http://127.0.0.1:3080/?token=<43 chars> (LAN: http://172.24.0.2:3080/?token=<same>)

* The token is random per process and never written to disk, so **only the token
  printed by the process running now** is usable. Docker keeps stdout across
  restarts, so one log can hold several tokens; the newest wins. We therefore ask
  the daemon for ``since = <container StartedAt>`` (the current run only) and take
  the last match inside that window.
* A stopped container's token is dead: we report ``running`` so the page says so
  instead of handing out a link that cannot work.

How it talks to Docker
----------------------
Through the **Docker SDK** (``docker.from_env()``, i.e. ``DOCKER_HOST`` or the
mounted ``/var/run/docker.sock``), never by shelling out to the ``docker`` CLI.
The import is lazy so the parsing logic stays unit-testable on a machine without
the SDK, and everything falls back to a :class:`DockerError` carrying a message
meant for the operator.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol, Sequence

# --------------------------------------------------------------------------- #
# Patterns
# --------------------------------------------------------------------------- #

# The token itself is base64url (43 chars for 32 random bytes). The character
# class stops at the space before "(LAN:" and at the closing parenthesis.
_TOKEN_RE = re.compile(r"[?&]token=(?P<token>[A-Za-z0-9._~-]{20,})")

# URLs in the startup line never contain spaces or parentheses.
_URL_RE = re.compile(r"https?://[^\s()<>\"']+")

# ``timestamps=True`` makes the daemon prefix every line with RFC3339(Nano) + one
# space.
_LOG_PREFIX_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}T[0-9:.]{8,}(?:Z|[+-]\d{2}:\d{2}))\s(?P<msg>.*)$",
    re.DOTALL,
)

# Docker timestamps carry up to nanosecond precision; datetime handles 6 digits.
_DOCKER_TS_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})T(?P<clock>\d{2}:\d{2}:\d{2})"
    r"(?:\.(?P<frac>\d+))?(?P<tz>Z|[+-]\d{2}:\d{2})$"
)

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}
_LOOPBACK_BINDS = {"127.0.0.1", "::1", "localhost"}

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class DockerError(RuntimeError):
    """Docker was unreachable, the container was missing, or a call failed."""


# --------------------------------------------------------------------------- #
# Time helpers
# --------------------------------------------------------------------------- #


def parse_docker_time(value: str | None) -> datetime | None:
    """Parse a docker RFC3339(Nano) timestamp; ``None`` for the zero value."""
    if not value:
        return None
    value = value.strip()
    # A container that never ran reports 0001-01-01T00:00:00Z.
    if value.startswith("0001-01-01"):
        return None
    match = _DOCKER_TS_RE.match(value)
    if not match:
        return None
    frac = (match["frac"] or "")[:6].ljust(6, "0")
    tz = "+00:00" if match["tz"] == "Z" else match["tz"]
    try:
        return datetime.fromisoformat(f"{match['date']}T{match['clock']}.{frac}{tz}")
    except ValueError:
        return None


def iso(value: datetime | None) -> str | None:
    return None if value is None else value.astimezone(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Log parsing (pure functions — no docker, no framework)
# --------------------------------------------------------------------------- #


@dataclass
class LogLine:
    ts: datetime | None
    text: str
    raw: str


@dataclass
class TokenMatch:
    token: str
    ts: datetime | None
    raw_line: str
    loopback_url: str | None
    lan_url: str | None
    urls: list[str] = field(default_factory=list)

    @property
    def login_url(self) -> str | None:
        """The in-container URL, which is what the log itself offers."""
        return self.loopback_url or (self.urls[0] if self.urls else None)


def parse_log_lines(output: str) -> list[LogLine]:
    """Split timestamped log output into lines."""
    lines: list[LogLine] = []
    for raw in output.splitlines():
        match = _LOG_PREFIX_RE.match(raw)
        if match:
            lines.append(LogLine(parse_docker_time(match["ts"]), match["msg"], raw))
        else:
            # A continuation line, or a driver that prints no timestamps.
            lines.append(LogLine(None, raw, raw))
    return lines


def _host_of(url: str) -> str | None:
    match = re.match(r"^https?://(?P<host>\[[^\]]+\]|[^/:?#]+)", url)
    if not match:
        return None
    return match["host"].strip("[]").lower()


def is_loopback(url: str) -> bool:
    host = _host_of(url)
    return host in _LOOPBACK_HOSTS if host else False


def extract_token_lines(lines: Sequence[LogLine]) -> list[TokenMatch]:
    """Every ``?token=`` occurrence in the window, one entry per distinct token."""
    found: list[TokenMatch] = []
    for line in lines:
        if "token=" not in line.text:
            continue
        urls = [u for u in _URL_RE.findall(line.text) if "token=" in u]
        if not urls:
            continue
        grouped: dict[str, list[str]] = {}
        for url in urls:
            match = _TOKEN_RE.search(url)
            if not match:
                continue
            bucket = grouped.setdefault(match["token"], [])
            if url not in bucket:
                bucket.append(url)
        for token, token_urls in grouped.items():
            found.append(
                TokenMatch(
                    token=token,
                    ts=line.ts,
                    raw_line=line.text,
                    loopback_url=next((u for u in token_urls if is_loopback(u)), None),
                    lan_url=next((u for u in token_urls if not is_loopback(u)), None),
                    urls=token_urls,
                )
            )
    return found


def choose_token(
    matches: Sequence[TokenMatch],
    started_at: datetime | None,
    tolerance: timedelta = timedelta(seconds=3),
) -> tuple[TokenMatch | None, bool | None]:
    """Pick the token that belongs to the current run.

    Returns ``(match, stale)``. ``stale`` is ``None`` when freshness cannot be
    decided (no container start time available).
    """
    if not matches:
        return None, None
    ordered = sorted(matches, key=lambda m: (m.ts is None, m.ts or _EPOCH))
    if started_at is None:
        return ordered[-1], None
    threshold = started_at - tolerance
    fresh = [m for m in ordered if m.ts is None or m.ts >= threshold]
    if fresh:
        return fresh[-1], False
    # Only tokens from before the current process exist: the log holds a dead
    # token, which normally means the container was restarted and the new line
    # was rotated away.
    return ordered[-1], True


# --------------------------------------------------------------------------- #
# Docker access, via the SDK
# --------------------------------------------------------------------------- #


@dataclass
class ContainerInfo:
    id: str
    name: str
    status: str
    running: bool
    started_at: datetime | None
    finished_at: datetime | None
    discovery: str

    @property
    def short_id(self) -> str:
        return self.id[:12]


def _sdk():
    try:
        import docker  # noqa: PLC0415 - lazy on purpose
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise DockerError(
            "没有安装 docker SDK。装依赖：pip install -r requirements.txt"
        ) from exc
    return docker


def _connect_hint(exc: Exception) -> str:
    """Turn a client-construction failure into something the operator can act on.

    The TLS branches matter for the *remote daemon* setup: a wrong cert layout is
    raised by ``from_env()`` itself, before any connection is attempted, so
    without this it would look like "the daemon is down".
    """
    text = str(exc)
    lowered = text.lower()
    if isinstance(exc, PermissionError) or "permission denied" in lowered:
        return (
            "没有权限访问 docker socket（PermissionError）。运行这个容器的用户不在宿主 docker 组里："
            "把宿主 docker 组的 GID 传给构建参数，然后重建 —— "
            "ADMIN_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock) "
            "docker compose --profile admin up -d --build admin"
        )
    # TLS config errors: raised while building the client, no connection yet.
    if any(
        marker in lowered
        for marker in ("tls parameter", "tls_parameter", "client_cert", "ca_cert", "must be provided")
    ):
        return (
            "Docker 的 TLS 配置不完整：只要设置了 DOCKER_TLS_VERIFY（任何非空值）或 DOCKER_CERT_PATH，"
            "DOCKER_CERT_PATH 指向的目录里就必须有 cert.pem 和 key.pem；开启校验时还要 ca.pem。"
            "（只想用本地 socket 就把这两个变量留空，本面板不需要 TLS。）"
            f"（原始错误：{text}）"
        )
    if any(marker in lowered for marker in ("certificate verify failed", "sslerror", "ssl:")):
        return (
            "TLS 握手或证书校验失败：远端 daemon 的证书不被信任。"
            "把签发它的 CA 放进 DOCKER_CERT_PATH 目录下的 ca.pem，"
            "或确认 DOCKER_TLS_VERIFY 是否本来就应该留空。"
            f"（原始错误：{text}）"
        )
    # The daemon is absent, the socket is not mounted, or nothing listens there.
    # The exact wording differs per platform (and per language), hence the list.
    unreachable = isinstance(exc, (FileNotFoundError, ConnectionError)) or any(
        marker in lowered
        for marker in (
            "no such file",
            "cannot find the file",
            "createfile",
            "connection refused",
            "connection aborted",
            "docker_engine",
        )
    )
    if unreachable:
        return (
            "连不上 Docker：找不到 docker socket，或那里没有人在监听。"
            "在容器里跑时，compose.yaml 的 admin 服务必须挂载 "
            "/var/run/docker.sock:/var/run/docker.sock（或改成 DOCKER_HOST 指向远程 daemon）；"
            "在宿主机上跑时，请确认 socket 路径或 DOCKER_HOST。"
            f"（原始错误：{text}）"
        )
    return f"连不上 Docker：{text}"


class DockerSource:
    """Everything this panel needs from the Docker daemon.

    Kept deliberately small (find one container, inspect it, read its log) and
    injectable, so tests can substitute a fake. Only :meth:`client` imports the
    SDK, and only on first use.
    """

    def __init__(self, timeout: int = 15, client=None) -> None:
        self.timeout = timeout
        # Injected in tests; otherwise connected lazily on first use.
        self._client = client

    @property
    def client(self):
        if self._client is None:
            docker = _sdk()
            try:
                client = docker.from_env(timeout=self.timeout)
                client.ping()
            except DockerError:
                raise
            except Exception as exc:  # noqa: BLE001 - reported, not swallowed
                raise DockerError(_connect_hint(exc)) from exc
            self._client = client
        return self._client

    # -- discovery ---------------------------------------------------------- #

    def find_container(self, container_ref: str, project: str, service: str):
        """Return ``(container, discovery)`` for the dsh container.

        Order: explicit reference, compose labels, then container name. When
        several candidates match, a running one wins, then the newest start.
        """
        client = self.client

        if container_ref:
            try:
                return client.containers.get(container_ref), "ADMIN_CONTAINER"
            except Exception as exc:  # noqa: BLE001
                raise DockerError(
                    f"找不到容器 {container_ref!r}（来自 ADMIN_CONTAINER）：{exc}"
                ) from exc

        attempts = (
            (
                "label",
                {
                    "label": [
                        f"com.docker.compose.project={project}",
                        f"com.docker.compose.service={service}",
                    ]
                },
            ),
            ("name", {"name": f"{project}-{service}"}),
        )
        errors: list[str] = []
        for discovery, filters in attempts:
            try:
                candidates = client.containers.list(all=True, filters=filters)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{discovery}: {exc}")
                continue
            # list() returns *summary* records, which lack State.StartedAt; a
            # reload gives the inspect payload. A candidate can disappear between
            # the two calls — that is not an error, just skip it.
            live = []
            for candidate in candidates:
                try:
                    candidate.reload()
                except Exception:  # noqa: BLE001
                    continue
                live.append(candidate)
            if not live:
                continue
            live.sort(key=_running_first_key, reverse=True)
            return live[0], discovery

        raise DockerError(
            "找不到 dsh 容器（已按 compose 标签和容器名查找"
            + (f"；错误：{' | '.join(errors)}" if errors else "")
            + "）。用 ADMIN_CONTAINER=<容器名或ID> 直接指定。"
        )

    # -- inspection --------------------------------------------------------- #

    def container_info(self, container, discovery: str) -> ContainerInfo:
        attrs = getattr(container, "attrs", None) or {}
        state = _state_of(container)
        return ContainerInfo(
            id=attrs.get("Id") or getattr(container, "id", ""),
            name=(attrs.get("Name") or getattr(container, "name", "") or "").lstrip("/"),
            status=state.get("Status") or "unknown",
            running=bool(state.get("Running")),
            started_at=parse_docker_time(state.get("StartedAt")),
            finished_at=parse_docker_time(state.get("FinishedAt")),
            discovery=discovery,
        )

    # -- logs --------------------------------------------------------------- #

    def read_logs(
        self,
        container,
        since: datetime | None = None,
        tail: int | None = None,
    ) -> str:
        """Current-run log as text, with timestamps, capped at ``tail`` lines.

        ``since`` is handed over as a timezone-aware ``datetime``: the SDK accepts
        only a datetime or a positive number here (it converts with
        ``int(dt.timestamp())``, so the granularity is one second — hence the
        caller's slack).
        """
        kwargs: dict[str, Any] = {"timestamps": True, "stdout": True, "stderr": True}
        if since is not None:
            kwargs["since"] = since
        if tail:
            kwargs["tail"] = int(tail)
        try:
            raw = container.logs(**kwargs)
        except Exception as exc:  # noqa: BLE001
            raise DockerError(_log_hint(exc)) from exc
        if isinstance(raw, bytes):
            return raw.decode("utf-8", "replace")
        # A stream was requested after all: drain it.
        return b"".join(raw).decode("utf-8", "replace")


def _log_hint(exc: Exception) -> str:
    """Turn a log-read failure into something the operator can act on."""
    text = str(exc)
    if "does not support reading" in text or "not support reading" in text:
        return (
            "这个容器的日志驱动不支持读取，读不到启动日志。"
            "dsh 服务必须用默认的 json-file/local 驱动（compose.yaml 里没有 logging 配置即是默认），"
            f"否则请用 `docker compose logs dsh` 手工取 token。（原始错误：{text}）"
        )
    return f"读取容器日志失败：{text}"


def _state_of(container) -> dict[str, Any]:
    """The ``State`` object of a reloaded container, or ``{}``.

    ``containers.list()`` hands back *summary* records whose ``State`` is a plain
    string (``"running"``) rather than the object ``inspect`` returns, so callers
    reload first — and this stays defensive anyway.
    """
    state = (getattr(container, "attrs", None) or {}).get("State")
    return state if isinstance(state, dict) else {}


def _running_first_key(container) -> tuple[int, datetime]:
    state = _state_of(container)
    started = parse_docker_time(state.get("StartedAt")) or _EPOCH
    return (1 if state.get("Running") else 0, started)


class LogSource(Protocol):  # pragma: no cover - typing only
    def find_container(self, container_ref: str, project: str, service: str): ...
    def container_info(self, container, discovery: str) -> ContainerInfo: ...
    def read_logs(self, container, since: datetime | None = None, tail: int | None = None) -> str: ...


# --------------------------------------------------------------------------- #
# URLs
# --------------------------------------------------------------------------- #


def build_public_url(
    site_address: str | None, public_port: int | None, token: str | None
) -> str | None:
    """``https://<DSH_SITE_ADDRESS>[/:port]/?token=...`` — the URL a browser uses.

    The log's own URL points at the container's loopback/bridge address, which a
    browser cannot reach (README「首次登录」), so the public one is built from the
    deployment's ``DSH_SITE_ADDRESS``.
    """
    if not site_address or not token:
        return None
    authority = re.sub(r"^https?://", "", site_address.strip().rstrip("/"))
    if ":" not in authority and public_port and public_port != 443:
        authority = f"{authority}:{public_port}"
    return f"https://{authority}/?token={token}"


# --------------------------------------------------------------------------- #
# The report
# --------------------------------------------------------------------------- #


def _startup_slice(lines: Sequence[LogLine], limit: int) -> tuple[list[str], bool]:
    if limit <= 0:
        return [], False
    return [line.raw for line in lines[:limit]], len(lines) > limit


def collect(settings: Any, source: LogSource | None = None) -> dict[str, Any]:
    """Build the whole report the API returns.

    Never raises for environment problems: a missing container, an unreachable
    daemon or a rotated log all come back as ``ok: false`` / a warning, because
    the page is supposed to explain the situation.
    """
    source = source or DockerSource(settings.docker_timeout)
    report: dict[str, Any] = {
        "generated_at": iso(datetime.now(timezone.utc)),
        "ok": False,
        "container": None,
        "token": {"found": False, "value": None},
        "urls": {"loopback": None, "lan": None, "public": None},
        "log": {"since": None, "lines_read": 0, "startup_lines": [], "truncated": False},
        "warnings": [],
    }

    try:
        container, discovery = source.find_container(
            settings.container, settings.compose_project, settings.compose_service
        )
        info = source.container_info(container, discovery)
    except DockerError as exc:
        report["error"] = str(exc)
        report["warnings"].append(str(exc))
        return report

    report["ok"] = True
    report["container"] = {
        "id": info.id,
        "short_id": info.short_id,
        "name": info.name,
        "running": info.running,
        "status": info.status,
        "started_at": iso(info.started_at),
        "finished_at": iso(info.finished_at),
        "discovery": info.discovery,
    }

    since = info.started_at
    windows = [settings.log_tail]
    if settings.log_tail_max > settings.log_tail:
        windows.append(settings.log_tail_max)

    lines: list[LogLine] = []
    matches: list[TokenMatch] = []
    tail_used = windows[0]
    for index, tail in enumerate(windows):
        # Two seconds of slack for clock skew between the daemon and the log.
        anchor = None if since is None else since - timedelta(seconds=2)
        try:
            output = source.read_logs(container, since=anchor, tail=tail)
        except DockerError as exc:
            report["error"] = str(exc)
            report["warnings"].append(str(exc))
            return report
        tail_used = tail
        lines = parse_log_lines(output)
        matches = extract_token_lines(lines)
        if matches or index == len(windows) - 1:
            break

    report["log"]["since"] = iso(since)
    report["log"]["lines_read"] = len(lines)
    report["log"]["tail"] = tail_used

    startup_lines, cut = _startup_slice(lines, settings.startup_lines)
    report["log"]["startup_lines"] = startup_lines
    report["log"]["truncated"] = cut or (since is not None and len(lines) >= tail_used)

    match, stale = choose_token(matches, since)
    if match is None:
        report["token"] = {"found": False, "value": None, "matches_in_window": 0}
        if not info.running:
            report["warnings"].append(
                f"容器 {info.name} 当前状态为 {info.status}：日志里没有可用 token，"
                "先把它启动起来（docker compose up -d dsh）。"
            )
        elif since is None:
            report["warnings"].append("容器从未启动过，日志里没有 token。")
        else:
            report["warnings"].append(
                "当前这次运行的日志里没有 dsh 启动行。可能已被日志轮转截掉，"
                "重启容器即可重新打印：docker compose restart dsh"
                f"（当前窗口：--tail {tail_used}）。"
            )
        return report

    report["token"] = {
        "found": True,
        "value": match.token,
        "issued_at": iso(match.ts),
        "stale": bool(stale),
        "matches_in_window": len(matches),
        "raw_line": match.raw_line,
    }
    report["urls"] = {
        "loopback": match.loopback_url,
        "lan": match.lan_url,
        "public": build_public_url(settings.site_address, settings.public_port, match.token),
    }

    if not info.running:
        report["warnings"].append(
            f"容器 {info.name} 当前状态为 {info.status}：这个 token 属于已经结束的进程，"
            "启动容器后需要重新读取。"
        )
    elif stale:
        report["warnings"].append(
            "日志里最新的 token 早于本次容器启动时间，可能已经失效；重启容器可重新生成。"
        )
    if len(matches) > 1:
        report["warnings"].append(
            f"日志窗口里有 {len(matches)} 个 token，已取最新（时间最靠后）的那个。"
        )
    if not settings.site_address:
        report["warnings"].append(
            "没有读到 DSH_SITE_ADDRESS，无法拼出浏览器可用的登录链接；"
            "在 .env 里设置 DSH_SITE_ADDRESS（compose 会把它传给管理端）。"
        )
    return report