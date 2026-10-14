"""Unit tests for the log/token reader.

No Docker daemon and no fastapi needed: a fake Docker SDK client stands in for
the daemon, so the whole find → inspect → read-log → decide path is exercised
against the real startup-log shape.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from app import dsh_logs
from app.config import Settings
from app.dsh_logs import (
    DockerError,
    DockerSource,
    LogLine,
    TokenMatch,
    build_public_url,
    choose_token,
    collect,
    extract_token_lines,
    parse_docker_time,
    parse_log_lines,
)

# The token from the real deployment log this panel was written against.
REAL_TOKEN = "Nq_NkUTavtzTdSUFu1_nJSlXHRN7AEq3f-E9yDlec1A"
NEWER_TOKEN = "Ab1_Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3Ab4"

CONTAINER_ID = "3f9a1c7b8d2e4f50617283940aabbccddeeff00112233445566778899aabbcc"

# The real ``docker logs`` startup burst, minus the timestamp prefix (added by
# ``render``): a line-for-line copy of the deployment log this was built against.
STARTUP_LINES = [
    "[dsh] dsh CLI: npm CLI at /usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
    "[dsh] WARNING: no /data/dsh/settings.yaml: the composition defaults apply, so every provider and model setting is ignored until something writes it (the Models page can).",
    "[dsh] built-in skills: none in /opt/dsh-skills (mechanism ready; see README: built-in skills)",
    "[dsh] no profile projection yet: dsh builds it during this start",
    "[dsh] bundled plugin @local/dsh-login-gate: enabled",
    "[dsh] bundled plugins: 1 from /opt/dsh-plugins",
    "[dsh] workspace /workspaces is writable by uid 1000:1000",
    "dsh doctor: node v22.23.3; landlock launcher partial (/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/node-addon-system-linux-x64/bin/landlock-run)",
    "[dsh] wrote bind overlay /data/dsh/.runtime/webserver-bind.yml (host=0.0.0.0, port=3080)",
    "[dsh] bind overlay verified against the composed config tree",
    "[dsh] settings-UI patch present: the domain-served GUI edits the host document",
    "[dsh] sandbox mode: workspace-write (deployment default)",
    "[dsh] starting: node /usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --patch /data/dsh/.runtime/webserver-bind.yml --no-open --trusted-host dsh.gen-ai.website",
]


def login_line(token: str, port: int = 3080, lan_ip: str = "172.24.0.2") -> str:
    return (
        f"dsh web: http://127.0.0.1:{port}/?token={token} "
        f"(LAN: http://{lan_ip}:{port}/?token={token})"
    )


def render(start: datetime, token: str | None = None, offset: int = 9) -> list[str]:
    """One container run: the startup burst, optionally ending in the token line."""
    out = []
    for index, message in enumerate(STARTUP_LINES):
        ts = start + timedelta(seconds=index * 0.4)
        out.append(f"{ts.strftime('%Y-%m-%dT%H:%M:%S.%f')}000Z {message}")
    if token is not None:
        ts = start + timedelta(seconds=offset)
        out.append(f"{ts.strftime('%Y-%m-%dT%H:%M:%S.%f')}000Z {login_line(token)}")
    return out


RUN_1 = datetime(2026, 7, 15, 10, 0, 0, tzinfo=timezone.utc)
RUN_2 = datetime(2026, 7, 16, 7, 23, 41, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# A fake Docker SDK
# --------------------------------------------------------------------------- #


def inspect_payload(
    started_at: datetime,
    running: bool = True,
    status: str = "running",
    name: str = "dsh-dsh-1",
    container_id: str = CONTAINER_ID,
    labels: dict[str, str] | None = None,
) -> dict:
    """Shaped like ``GET /containers/{id}/json``."""
    if labels is None:
        labels = {
            "com.docker.compose.project": "dsh",
            "com.docker.compose.service": "dsh",
        }
    stamp = started_at.strftime("%Y-%m-%dT%H:%M:%S.%f") + "000Z"
    return {
        "Id": container_id,
        "Name": f"/{name}",
        "Config": {"Labels": labels},
        "State": {
            "Status": status,
            "Running": running,
            "StartedAt": stamp,
            "FinishedAt": "0001-01-01T00:00:00Z" if running else stamp,
        },
    }


def _timestamp_of(raw: str) -> datetime | None:
    parsed = parse_log_lines(raw + "\n")
    return parsed[0].ts if parsed else None


class FakeContainer:
    """The slice of ``docker.models.containers.Container`` this panel uses."""

    def __init__(self, payload: dict, log_text: str = "") -> None:
        self.attrs = payload
        self.id = payload["Id"]
        self.name = payload["Name"].lstrip("/")
        self.log_text = log_text
        self.log_calls: list[dict] = []
        self.reloads = 0

    def reload(self) -> None:
        self.reloads += 1

    def logs(self, timestamps=False, stdout=True, stderr=True, since=None, tail=None, **kwargs) -> bytes:
        self.log_calls.append({"timestamps": timestamps, "since": since, "tail": tail})
        lines = self.log_text.splitlines()
        if since is not None:
            # The SDK passes `since` as a datetime (its own conversion is
            # int(dt.timestamp()), i.e. whole seconds).
            anchor = since if isinstance(since, datetime) else parse_docker_time(since)
            lines = [raw for raw in lines if (ts := _timestamp_of(raw)) is None or ts >= anchor]
        if tail:
            lines = lines[-int(tail) :]
        return ("\n".join(lines) + "\n").encode("utf-8")


class FakeContainers:
    def __init__(self, containers: list[FakeContainer]) -> None:
        self._containers = containers

    def get(self, ref: str) -> FakeContainer:
        for container in self._containers:
            if ref in (container.id, container.name):
                return container
        raise DockerError(f"no such container: {ref}")

    def list(self, all=False, filters=None) -> list[FakeContainer]:
        filters = filters or {}
        found = list(self._containers)
        wanted = filters.get("label")
        if wanted:
            if isinstance(wanted, str):
                wanted = [wanted]
            # The daemon compares label filters as `key=value` pairs.
            def has_labels(candidate: FakeContainer) -> bool:
                labels = candidate.attrs.get("Config", {}).get("Labels") or {}
                for label in wanted:
                    key, _, value = label.partition("=")
                    if labels.get(key) != value:
                        return False
                return True

            found = [c for c in found if has_labels(c)]
        name_filter = filters.get("name")
        if name_filter:
            found = [c for c in found if name_filter in c.name]
        return found


class FakeClient:
    def __init__(self, containers: list[FakeContainer]) -> None:
        self.containers = FakeContainers(containers)
        self.pings = 0

    def ping(self) -> bool:
        self.pings += 1
        return True


def make_source(*containers: FakeContainer) -> DockerSource:
    return DockerSource(client=FakeClient(list(containers)))


def make_settings(**overrides) -> Settings:
    base = Settings(
        bind_host="127.0.0.1",
        bind_port=8642,
        admin_user="admin",
        admin_password="",
        refresh_seconds=5,
        docker_timeout=15,
        container="dsh-dsh-1",
        compose_service="dsh",
        compose_project="dsh",
        log_tail=200,
        log_tail_max=20000,
        startup_lines=40,
        site_address="dsh.gen-ai.website",
        public_port=443,
    )
    return replace(base, **overrides)


# --------------------------------------------------------------------------- #
# timestamps
# --------------------------------------------------------------------------- #


def test_parse_docker_time_accepts_nanoseconds_and_z():
    got = parse_docker_time("2026-07-16T07:23:58.123456789Z")
    assert got == datetime(2026, 7, 16, 7, 23, 58, 123456, tzinfo=timezone.utc)


def test_parse_docker_time_rejects_zero_time_and_junk():
    assert parse_docker_time("0001-01-01T00:00:00Z") is None
    assert parse_docker_time("") is None
    assert parse_docker_time(None) is None
    assert parse_docker_time("not a timestamp") is None


def test_parsed_timestamps_are_timezone_aware():
    # The SDK converts a datetime with int(dt.timestamp()), which needs an
    # unambiguous instant: docker always reports UTC.
    got = parse_docker_time("2026-07-16T07:23:41.500000Z")
    assert got == datetime(2026, 7, 16, 7, 23, 41, 500000, tzinfo=timezone.utc)
    assert got.utcoffset() == timedelta(0)


# --------------------------------------------------------------------------- #
# log parsing
# --------------------------------------------------------------------------- #


def test_parse_log_lines_splits_timestamp_from_message():
    lines = parse_log_lines(f"2026-07-16T07:23:58.123456789Z {login_line(REAL_TOKEN)}\n")
    assert len(lines) == 1
    assert lines[0].text.startswith("dsh web: http://127.0.0.1:3080/")
    assert lines[0].ts == datetime(2026, 7, 16, 7, 23, 58, 123456, tzinfo=timezone.utc)


def test_parse_log_lines_keeps_unprefixed_lines():
    lines = parse_log_lines("plain line without timestamp\n")
    assert lines[0].ts is None
    assert lines[0].text == "plain line without timestamp"


# --------------------------------------------------------------------------- #
# token extraction
# --------------------------------------------------------------------------- #


def test_extracts_real_token_with_both_urls():
    lines = parse_log_lines("\n".join(render(RUN_2, REAL_TOKEN)) + "\n")
    matches = extract_token_lines(lines)
    assert len(matches) == 1
    match = matches[0]
    assert match.token == REAL_TOKEN
    assert match.loopback_url == f"http://127.0.0.1:3080/?token={REAL_TOKEN}"
    assert match.lan_url == f"http://172.24.0.2:3080/?token={REAL_TOKEN}"
    assert match.ts == RUN_2 + timedelta(seconds=9)


def test_token_is_read_from_a_lan_only_line():
    lines = parse_log_lines(
        f"2026-07-16T07:23:58.000000000Z dsh web: http://10.0.0.5:3080/?token={REAL_TOKEN}\n"
    )
    match = extract_token_lines(lines)[0]
    assert match.token == REAL_TOKEN
    assert match.loopback_url is None
    assert match.lan_url == f"http://10.0.0.5:3080/?token={REAL_TOKEN}"
    # Still usable as the in-log URL when no loopback variant was printed.
    assert match.login_url == match.lan_url


def test_ignores_lines_without_a_token():
    lines = parse_log_lines("2026-07-16T07:23:58.000000000Z [dsh] settings-UI patch present\n")
    assert extract_token_lines(lines) == []


# --------------------------------------------------------------------------- #
# freshness
# --------------------------------------------------------------------------- #


def _match(token: str, ts: datetime | None) -> TokenMatch:
    return TokenMatch(token=token, ts=ts, raw_line="", loopback_url=None, lan_url=None)


def test_choose_token_prefers_the_newest():
    match, stale = choose_token([_match("new", RUN_2), _match("old", RUN_1)], RUN_1)
    assert match.token == "new"
    assert stale is False


def test_choose_token_flags_a_token_older_than_the_process():
    match, stale = choose_token([_match("old", RUN_1)], RUN_2)
    assert match.token == "old"
    assert stale is True


def test_choose_token_without_start_time_cannot_decide():
    match, stale = choose_token([_match("only", RUN_1)], None)
    assert match.token == "only"
    assert stale is None


def test_choose_token_tolerates_missing_timestamps():
    match, stale = choose_token([_match("no-ts", None)], RUN_2)
    assert match.token == "no-ts"
    assert stale is False


# --------------------------------------------------------------------------- #
# URLs
# --------------------------------------------------------------------------- #


def test_build_public_url_default_port():
    assert build_public_url("dsh.example.com", 443, "abc") == "https://dsh.example.com/?token=abc"


def test_build_public_url_custom_port_and_messy_input():
    assert build_public_url("dsh.example.com", 8443, "abc") == "https://dsh.example.com:8443/?token=abc"
    assert build_public_url("https://dsh.example.com/", 443, "abc") == "https://dsh.example.com/?token=abc"
    # An authority that already carries a port is left alone.
    assert build_public_url("dsh.example.com:9443", 8443, "abc") == "https://dsh.example.com:9443/?token=abc"


def test_build_public_url_needs_site_and_token():
    assert build_public_url("", 443, "abc") is None
    assert build_public_url("dsh.example.com", 443, None) is None


# --------------------------------------------------------------------------- #
# collect() end to end, against the fake SDK
# --------------------------------------------------------------------------- #


def test_collect_reads_the_current_run_and_builds_the_public_url():
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(render(RUN_2, REAL_TOKEN)) + "\n")
    report = collect(make_settings(), make_source(container))

    assert report["ok"] is True
    assert report["container"]["name"] == "dsh-dsh-1"
    assert report["container"]["running"] is True
    assert report["container"]["discovery"] == "ADMIN_CONTAINER"
    assert report["token"]["found"] is True
    assert report["token"]["value"] == REAL_TOKEN
    assert report["token"]["stale"] is False
    assert report["urls"]["public"] == f"https://dsh.gen-ai.website/?token={REAL_TOKEN}"
    assert report["urls"]["lan"] == f"http://172.24.0.2:3080/?token={REAL_TOKEN}"
    assert report["warnings"] == []

    call = container.log_calls[0]
    assert call["timestamps"] is True
    assert call["tail"] == 200
    # The window must be anchored at the container start, otherwise an older
    # token from a previous run could win. A datetime is what the SDK requires.
    assert call["since"] == RUN_2 - timedelta(seconds=2)
    assert isinstance(call["since"], datetime)


def test_collect_after_restart_picks_the_new_token():
    log_text = "\n".join(render(RUN_1, REAL_TOKEN) + render(RUN_2, NEWER_TOKEN)) + "\n"
    container = FakeContainer(inspect_payload(RUN_2), log_text)
    report = collect(make_settings(), make_source(container))

    assert report["token"]["value"] == NEWER_TOKEN
    assert report["token"]["stale"] is False
    # Both tokens are in the file, but only the current run is in the window.
    assert report["token"]["matches_in_window"] == 1
    assert report["urls"]["public"].endswith(NEWER_TOKEN)


def test_collect_warns_when_several_tokens_are_in_the_window():
    lines = render(RUN_2, REAL_TOKEN) + render(RUN_2, NEWER_TOKEN)
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(lines) + "\n")
    report = collect(make_settings(), make_source(container))

    assert report["token"]["matches_in_window"] == 2
    assert report["token"]["value"] == NEWER_TOKEN
    assert any("2 个 token" in warning for warning in report["warnings"])


def test_collect_reports_missing_token_with_a_hint():
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(render(RUN_2, None)) + "\n")
    report = collect(make_settings(), make_source(container))

    assert report["ok"] is True
    assert report["token"]["found"] is False
    assert any("重启容器" in warning for warning in report["warnings"])


def test_collect_warns_when_the_container_is_stopped():
    container = FakeContainer(
        inspect_payload(RUN_1, running=False, status="exited"),
        "\n".join(render(RUN_1, REAL_TOKEN)) + "\n",
    )
    report = collect(make_settings(), make_source(container))

    assert report["container"]["running"] is False
    assert report["token"]["found"] is True
    assert any("已经结束的进程" in warning for warning in report["warnings"])


def test_collect_notes_missing_site_address():
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(render(RUN_2, REAL_TOKEN)) + "\n")
    report = collect(make_settings(site_address=""), make_source(container))

    assert report["urls"]["public"] is None
    assert any("DSH_SITE_ADDRESS" in warning for warning in report["warnings"])


def test_collect_reports_a_docker_failure_without_raising():
    class Broken:
        def find_container(self, *args):
            raise DockerError("连不上 Docker：找不到 socket 或无人监听")

        def container_info(self, *args):  # pragma: no cover - never reached
            raise AssertionError

        def read_logs(self, *args, **kwargs):  # pragma: no cover - never reached
            raise AssertionError

    report = collect(make_settings(), Broken())
    assert report["ok"] is False
    assert "socket" in report["error"]


def test_collect_reports_a_log_read_failure_without_raising():
    class LogFail(DockerSource):
        def read_logs(self, *args, **kwargs):
            raise DockerError("读取容器日志失败：500 Server Error")

    container = FakeContainer(inspect_payload(RUN_2), "")
    report = collect(make_settings(), LogFail(client=FakeClient([container])))
    assert report["ok"] is True
    assert report["error"] == "读取容器日志失败：500 Server Error"
    assert any("读取容器日志失败" in warning for warning in report["warnings"])


def test_collect_finds_the_container_by_compose_labels():
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(render(RUN_2, REAL_TOKEN)) + "\n")
    report = collect(make_settings(container=""), make_source(container))

    assert report["container"]["discovery"] == "label"
    assert report["token"]["value"] == REAL_TOKEN
    # list() candidates are reloaded so that State.StartedAt is present.
    assert container.reloads == 1


def test_collect_falls_back_to_the_container_name():
    labels = {"com.docker.compose.project": "other", "com.docker.compose.service": "other"}
    container = FakeContainer(
        inspect_payload(RUN_2, labels=labels), "\n".join(render(RUN_2, REAL_TOKEN)) + "\n"
    )
    report = collect(make_settings(container=""), make_source(container))

    assert report["container"]["discovery"] == "name"
    assert report["token"]["value"] == REAL_TOKEN


def test_collect_prefers_a_running_container_over_a_newer_stopped_one():
    stale = FakeContainer(
        inspect_payload(RUN_2 + timedelta(hours=1), running=False, status="exited", name="dsh-dsh-1",
                        container_id="b" * 64),
        "\n".join(render(RUN_1, REAL_TOKEN)) + "\n",
    )
    live = FakeContainer(
        inspect_payload(RUN_2, name="dsh-dsh-2", container_id="c" * 64),
        "\n".join(render(RUN_2, NEWER_TOKEN)) + "\n",
    )
    report = collect(make_settings(container=""), make_source(stale, live))

    assert report["container"]["name"] == "dsh-dsh-2"
    assert report["token"]["value"] == NEWER_TOKEN


def test_collect_escalates_the_log_window_when_the_token_is_missing():
    body = render(RUN_2, None) + [f"2026-07-16T08:00:0{i}.000000000Z noise line {i}" for i in range(9)]
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(body) + "\n")
    report = collect(make_settings(log_tail=5, log_tail_max=500), make_source(container))

    assert [call["tail"] for call in container.log_calls] == [5, 500]
    assert report["token"]["found"] is False
    assert report["log"]["tail"] == 500


def test_collect_reports_an_unreachable_daemon_helpfully(monkeypatch):
    monkeypatch.setitem(sys.modules, "docker", None)
    report = collect(make_settings())
    assert report["ok"] is False
    assert "docker SDK" in report["error"]


def test_collect_explains_a_tls_misconfiguration(monkeypatch):
    """Pointing the panel at a remote daemon with a broken cert layout must not
    read as 'the daemon is down': the SDK raises while BUILDING the client."""

    class Boom:
        @staticmethod
        def from_env(**kwargs):
            raise RuntimeError(
                "TLSParameterError: Path to a certificate and key files "
                "must be provided through the client_cert parameter"
            )

    monkeypatch.setattr(dsh_logs, "_sdk", lambda: Boom)
    report = collect(make_settings())

    assert report["ok"] is False
    assert "cert.pem" in report["error"] and "DOCKER_CERT_PATH" in report["error"]
    assert "连不上 Docker" not in report["error"]


def test_connect_hint_distinguishes_remote_tls_failures():
    from app.dsh_logs import _connect_hint

    incomplete = _connect_hint(RuntimeError("Invalid CA certificate provided for `ca_cert`."))
    assert "ca.pem" in incomplete

    handshake = _connect_hint(RuntimeError("SSLError: certificate verify failed: self signed"))
    assert "ca.pem" in handshake and "cert.pem" not in handshake

    denied = _connect_hint(PermissionError("Permission denied"))
    assert "ADMIN_DOCKER_GID" in denied

    absent = _connect_hint(RuntimeError("Error while fetching server API version: Connection refused"))
    assert "socket" in absent


def test_startup_lines_are_returned_for_display():
    container = FakeContainer(inspect_payload(RUN_2), "\n".join(render(RUN_2, REAL_TOKEN)) + "\n")
    report = collect(make_settings(startup_lines=3), make_source(container))

    assert len(report["log"]["startup_lines"]) == 3
    assert "dsh CLI:" in report["log"]["startup_lines"][0]
    assert report["log"]["truncated"] is True


# --------------------------------------------------------------------------- #
# the connection gate
# --------------------------------------------------------------------------- #


def test_collect_skips_a_candidate_that_vanishes_before_inspect():
    class Vanishing(FakeContainer):
        def reload(self):
            raise DockerError("No such container: gone")

    gone = Vanishing(inspect_payload(RUN_2), "\n".join(render(RUN_2, REAL_TOKEN)) + "\n")
    alive = FakeContainer(
        inspect_payload(RUN_2, name="dsh-dsh-2", container_id="d" * 64),
        "\n".join(render(RUN_2, NEWER_TOKEN)) + "\n",
    )
    report = collect(make_settings(container=""), make_source(gone, alive))

    assert report["ok"] is True
    assert report["container"]["name"] == "dsh-dsh-2"
    assert report["token"]["value"] == NEWER_TOKEN


def test_log_driver_that_cannot_be_read_gets_a_specific_hint():
    class NoLogSupport(FakeContainer):
        def logs(self, **kwargs):
            raise DockerError(
                "400 Client Error: Bad Request "
                '("configured logging driver does not support reading")'
            )

    container = NoLogSupport(inspect_payload(RUN_2), "")
    report = collect(make_settings(), make_source(container))

    assert report["ok"] is True
    assert "日志驱动不支持读取" in report["error"]
    assert any("json-file" in warning for warning in report["warnings"])


def test_container_info_survives_a_summary_record():
    # containers.list() returns summary records whose State is the plain string
    # "running", not the object inspect returns. Never raise on that shape.
    summary = FakeContainer({"Id": "f" * 64, "Name": "/dsh-dsh-1", "State": "running"}, "")
    info = DockerSource(client=FakeClient([])).container_info(summary, "label")
    assert info.id == "f" * 64
    assert info.name == "dsh-dsh-1"
    assert info.status == "unknown"
    assert info.running is False
    assert info.started_at is None


def test_password_is_required_when_not_bound_to_loopback():
    problem = make_settings(bind_host="0.0.0.0").security_problem()
    assert problem is not None
    assert "ADMIN_PASSWORD" in problem
    assert make_settings(bind_host="0.0.0.0", admin_password="s3cret").security_problem() is None
    assert make_settings(bind_host="127.0.0.1").security_problem() is None
    assert make_settings(bind_host="::1").security_problem() is None