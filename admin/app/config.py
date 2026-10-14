"""Configuration for the admin panel.

Deliberately dependency-light: a tiny ``KEY=VALUE`` reader instead of
pydantic-settings, so the panel runs on a bare ``python3`` plus fastapi/uvicorn.

In Docker (the normal way to run this) every value arrives as a real environment
variable set by ``compose.yaml``. The two ``.env`` files are a convenience for
running the panel directly on the host during development:

* ``admin/.env``      — this panel's own settings (``ADMIN_*``).
* ``../.env``         — the deployment's file, for ``DSH_SITE_ADDRESS`` /
  ``DSH_PUBLIC_PORT``. Only used to build the login URL; the dsh container never
  sees any of this.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ADMIN_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = ADMIN_DIR.parent

# Bind addresses that are not reachable from outside the machine. The security
# gate in main.py turns on exactly this set: no password is only acceptable when
# nothing off-box can connect.
_LOOPBACK_BINDS = {"127.0.0.1", "::1", "localhost"}


def _load_env_file(path: Path) -> dict[str, str]:
    """Minimal dotenv reader: ``KEY=VALUE``, ``#`` comments, optional quotes."""
    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return values
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def _pick(env: dict[str, str], name: str, default: str = "") -> str:
    """A real environment variable wins over the .env files."""
    value = os.environ.get(name)
    if value is None:
        value = env.get(name, default)
    return value.strip()


def _pick_int(env: dict[str, str], name: str, default: int = 0) -> int:
    raw = _pick(env, name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # --- panel -------------------------------------------------------------
    bind_host: str
    bind_port: int
    admin_user: str
    admin_password: str
    refresh_seconds: int

    # --- docker ------------------------------------------------------------
    docker_timeout: int
    container: str
    compose_service: str
    compose_project: str

    # --- log window --------------------------------------------------------
    log_tail: int
    log_tail_max: int
    startup_lines: int

    # --- deployment facts used to build the login URL ----------------------
    site_address: str
    public_port: int

    @property
    def auth_enabled(self) -> bool:
        return bool(self.admin_password)

    @property
    def bind_is_loopback(self) -> bool:
        return self.bind_host in _LOOPBACK_BINDS

    def security_problem(self) -> str | None:
        """Why this configuration must not serve requests, or ``None``.

        The panel hands out a credential and (in Docker) holds the Docker socket,
        which is root-equivalent on the host. Reaching it must therefore require
        a password — unless nothing off-box can reach it at all.
        """
        if not self.auth_enabled and not self.bind_is_loopback:
            return (
                f"拒绝启动：监听 {self.bind_host}:{self.bind_port} 但没有设置 ADMIN_PASSWORD。"
                "管理端会明文显示 dsh 的登录 token（等同密码），并且在容器里还持有 docker socket，"
                "因此只要不是只监听 127.0.0.1，就必须设置密码。"
                "在部署目录的 .env 里加一行 ADMIN_PASSWORD=<强密码>，然后重启管理端。"
            )
        return None


def load_settings() -> Settings:
    env: dict[str, str] = {}
    # Deployment file first, then admin's own (higher priority).
    env.update(_load_env_file(Path(REPO_DIR / ".env")))
    env.update(_load_env_file(Path(ADMIN_DIR / ".env")))

    site_address = _pick(env, "ADMIN_SITE_ADDRESS") or _pick(env, "DSH_SITE_ADDRESS")
    public_port = _pick_int(env, "ADMIN_PUBLIC_PORT") or _pick_int(env, "DSH_PUBLIC_PORT", 443)

    return Settings(
        bind_host=_pick(env, "ADMIN_BIND_HOST", "127.0.0.1"),
        bind_port=_pick_int(env, "ADMIN_BIND_PORT", 8642),
        admin_user=_pick(env, "ADMIN_USER", "admin"),
        admin_password=_pick(env, "ADMIN_PASSWORD"),
        refresh_seconds=_pick_int(env, "ADMIN_REFRESH_SECONDS", 5),
        docker_timeout=_pick_int(env, "ADMIN_DOCKER_TIMEOUT", 15),
        container=_pick(env, "ADMIN_CONTAINER"),
        compose_service=_pick(env, "ADMIN_COMPOSE_SERVICE", "dsh"),
        compose_project=_pick(env, "ADMIN_COMPOSE_PROJECT", "dsh"),
        log_tail=_pick_int(env, "ADMIN_LOG_TAIL", 200),
        log_tail_max=_pick_int(env, "ADMIN_LOG_TAIL_MAX", 20000),
        startup_lines=_pick_int(env, "ADMIN_STARTUP_LINES", 40),
        site_address=site_address,
        public_port=public_port,
    )