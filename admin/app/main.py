"""FastAPI admin panel for this dsh-docker deployment.

Current scope: read the running ``dsh`` container's startup log and hand back the
login token plus a ready-to-click login URL.

It runs as a **container** (see ``compose.yaml``, service ``admin``) and reaches
the Docker daemon through the mounted ``/var/run/docker.sock`` using the Docker
SDK — never by shelling out to the ``docker`` CLI.

Security posture (read the deployment README's 「安全边界」 before changing it)
--------------------------------------------------------------------------------
Two things make this panel dangerous in the wrong place:

* it prints the login token in plain text, and that token **is** the password for
  the Harness GUI — whoever holds it drives an agent that runs commands inside
  the dsh container;
* to read another container's log it holds the Docker socket, which is
  effectively root on the host.

Hence: a password is **mandatory** whenever the panel is not bound to loopback
(enforced at startup by :meth:`Settings.security_problem`), ``compose.yaml``
publishes it on ``127.0.0.1`` only, every response is ``Cache-Control: no-store``,
and the token is never written to this panel's own logs.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import replace
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import __version__
from .config import Settings, load_settings
from .dsh_logs import collect

logger = logging.getLogger("dsh_admin")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# "testclient" is what fastapi's TestClient reports as the peer address.
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}

settings: Settings = load_settings()

# Fail closed and loudly: an unauthenticated panel that holds the Docker socket
# and prints tokens must never come up. Checked again on every request below.
_problem = settings.security_problem()
if _problem:  # pragma: no cover - misconfiguration path
    raise SystemExit(_problem)

app = FastAPI(
    title="dsh admin",
    version=__version__,
    # This panel only ever shows a credential; there is nothing to explore here.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

security = HTTPBasic(auto_error=False)


def _peer_host(request: Request) -> str:
    return request.client.host if request.client else ""


def require_auth(
    request: Request,
    credentials: HTTPBasicCredentials | None = Depends(security),
) -> None:
    """HTTP Basic when ``ADMIN_PASSWORD`` is set, loopback-only otherwise."""
    if settings.auth_enabled:
        ok = credentials is not None and secrets.compare_digest(
            credentials.username, settings.admin_user
        ) and secrets.compare_digest(credentials.password, settings.admin_password)
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="需要认证",
                headers={"WWW-Authenticate": 'Basic realm="dsh-admin"'},
            )
        return

    # No password: only reachable configurations are harmless ones. Startup
    # already refuses a non-loopback bind, so this is defence in depth.
    if _peer_host(request) not in LOOPBACK_HOSTS or not settings.bind_is_loopback:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "管理端未设置 ADMIN_PASSWORD：只接受来自本机 127.0.0.1 的请求。"
                "请设置 ADMIN_PASSWORD 后重启管理端。"
            ),
        )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # The body carries a live credential: never let anything cache it.
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/healthz")
def healthz() -> dict[str, object]:
    """Unauthenticated liveness probe; deliberately carries no deployment facts."""
    return {"ok": True, "version": __version__}


@app.get("/", include_in_schema=False)
def index(_: None = Depends(require_auth)) -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")


@app.get("/api/token")
def api_token(
    request: Request,
    _: None = Depends(require_auth),
    lines: int | None = Query(
        default=None, ge=0, le=2000, description="返回多少行启动日志"
    ),
) -> dict[str, object]:
    """The full report.

    Always answers 200 with an ``ok`` flag: a missing container or a docker
    failure is normal operational state here, and the page renders the reason.
    """
    active = settings if lines is None else replace(settings, startup_lines=lines)
    report = collect(active)
    container = report.get("container") or {}
    logger.info(
        "token report: ok=%s container=%s running=%s found=%s peer=%s",
        report.get("ok"),
        container.get("name"),
        container.get("running"),
        (report.get("token") or {}).get("found"),
        _peer_host(request),
    )
    return report


@app.get("/api/token.txt", response_class=PlainTextResponse)
def api_token_txt(_: None = Depends(require_auth)) -> PlainTextResponse:
    """Just the token, one line — for shell scripts.

    Example::

        TOKEN=$(curl -s http://127.0.0.1:8642/api/token.txt)
    """
    report = collect(settings)
    token = (report.get("token") or {}).get("value")
    if not report.get("ok") or not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=report.get("error") or "当前日志里没有可用的 token",
        )
    return PlainTextResponse(f"{token}\n")


@app.get("/api/config")
def api_config(_: None = Depends(require_auth)) -> dict[str, object]:
    """Non-secret facts the page needs (no token, no password)."""
    return {
        "bind_host": settings.bind_host,
        "bind_port": settings.bind_port,
        "auth_enabled": settings.auth_enabled,
        "refresh_seconds": settings.refresh_seconds,
        "site_address": settings.site_address or None,
        "container_hint": settings.container or settings.compose_service,
    }


def main() -> None:  # pragma: no cover - convenience entry point
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.bind_host,
        port=settings.bind_port,
        log_level="info",
    )


if __name__ == "__main__":  # pragma: no cover
    main()