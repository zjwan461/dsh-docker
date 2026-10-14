"""API-level tests: auth behaviour and response shape.

Skipped automatically when fastapi is not installed, so the log-parsing suite in
``test_dsh_logs.py`` stays runnable on a bare python3.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.dsh_logs import DockerError  # noqa: E402
from tests.test_dsh_logs import REAL_TOKEN, make_settings  # noqa: E402


def fake_report(**overrides):
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": True,
        "container": {"name": "dsh-dsh-1", "running": True, "status": "running"},
        "token": {"found": True, "value": REAL_TOKEN, "stale": False},
        "urls": {"public": f"https://dsh.example.com/?token={REAL_TOKEN}"},
        "log": {"startup_lines": ["[dsh] dsh CLI: ..."]},
        "warnings": [],
    }
    report.update(overrides)
    return report


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "settings", make_settings())
    monkeypatch.setattr(main, "collect", lambda settings, docker=None: fake_report())
    return TestClient(main.app)


def test_healthz_is_open(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_index_and_token_are_served_without_a_password(client):
    assert client.get("/").status_code == 200
    response = client.get("/api/token")
    assert response.status_code == 200
    assert response.json()["token"]["value"] == REAL_TOKEN


def test_credential_responses_are_never_cached(client):
    response = client.get("/api/token")
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["referrer-policy"] == "no-referrer"


def test_token_txt_is_plain_and_one_line(client):
    response = client.get("/api/token.txt")
    assert response.status_code == 200
    assert response.text == REAL_TOKEN + "\n"


def test_password_is_enforced_when_configured(monkeypatch):
    monkeypatch.setattr(main, "settings", make_settings(admin_password="s3cret"))
    monkeypatch.setattr(main, "collect", lambda settings, docker=None: fake_report())
    client = TestClient(main.app)

    assert client.get("/api/token").status_code == 401
    assert client.get("/", follow_redirects=False).status_code == 401

    ok = client.get("/api/token", auth=("admin", "s3cret"))
    assert ok.status_code == 200

    bad = client.get("/api/token", auth=("admin", "wrong"))
    assert bad.status_code == 401
    assert bad.headers["www-authenticate"].startswith("Basic")


def test_without_a_password_non_loopback_peers_are_refused(monkeypatch):
    monkeypatch.setattr(main, "settings", make_settings())
    remote = SimpleNamespace(client=SimpleNamespace(host="203.0.113.9"))
    with pytest.raises(HTTPException) as excinfo:
        main.require_auth(remote, None)
    assert excinfo.value.status_code == 403

    local = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    assert main.require_auth(local, None) is None


def test_missing_token_answers_503_on_the_txt_route(monkeypatch):
    monkeypatch.setattr(main, "settings", make_settings())
    monkeypatch.setattr(
        main, "collect", lambda settings, docker=None: fake_report(token={"found": False, "value": None})
    )
    client = TestClient(main.app)
    assert client.get("/api/token.txt").status_code == 503


def test_docker_failure_is_reported_as_json_not_a_crash(monkeypatch):
    def boom(settings, docker=None):
        return {"ok": False, "error": "找不到 docker 命令", "warnings": ["找不到 docker 命令"]}

    monkeypatch.setattr(main, "settings", make_settings())
    monkeypatch.setattr(main, "collect", boom)
    client = TestClient(main.app)

    response = client.get("/api/token")
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["error"] == "找不到 docker 命令"


def test_config_endpoint_leaks_no_secrets(monkeypatch):
    monkeypatch.setattr(main, "settings", make_settings(admin_password="s3cret", site_address="dsh.example.com"))
    payload = TestClient(main.app).get("/api/config", auth=("admin", "s3cret")).json()
    assert payload["auth_enabled"] is True
    assert payload["site_address"] == "dsh.example.com"
    assert "s3cret" not in str(payload)
    assert "password" not in payload