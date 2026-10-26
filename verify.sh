#!/usr/bin/env bash
#
# Host-side end-to-end verification for this deployment.
#
# Run it on the DOCKER HOST, in this directory:   bash verify.sh
#
# This host does NOT need to resolve the public name. When it cannot (split DNS:
# the browser resolves the name, the server does not), the script pins every
# request to 127.0.0.1 with `curl --resolve` while keeping SNI and the Host
# header at the real name — which is exactly what Caddy and the DSH trust fence
# match on. Force a different address with:
#   VERIFY_ADDR=127.0.0.1 bash verify.sh
#
# It probes one layer at a time, so a failure names the layer that broke:
#   DNS -> TLS chain -> Caddy -> DSH browser-trust fence -> launch token
#   -> session cookie -> /api bridge -> WebSocket upgrade
#
# Expected codes come from dsh-client-connection's authorizeIndex() and
# isTrustedApiRequest(), not from guesswork:
#   GET /                        without cookie        -> 401
#   GET /?token=<launch token>   correct token         -> 303 + Location: / + Set-Cookie
#   GET /                        with cookie           -> 200 (the SPA index)
#   /api/*                       trusted, no cookie    -> 401
#   any request                  Host not trusted      -> 403
#
# Exits 0 only when every asserted check passes.
#
# Deliberately uses plain strings instead of arrays for the optional curl flags,
# so it also runs on hosts with an older bash (empty-array expansion under
# `set -u` differs before bash 4.4).

set -uo pipefail
cd "$(dirname "$0")"

PASS=0
FAIL=0

ok()   { printf '  PASS  %-48s %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL  %-48s got %s, want %s\n' "$1" "$3" "$2"; FAIL=$((FAIL + 1)); }
note() { printf '  ----  %s\n' "$1"; }

expect() { # label expected actual
  if [[ "$2" == "$3" ]]; then ok "$1" "$3"; else bad "$1" "$2" "$3"; fi
}

# ---------------------------------------------------------------- target ----

SITE="${DSH_SITE_ADDRESS:-$(grep -m1 '^DSH_SITE_ADDRESS=' .env 2>/dev/null | cut -d= -f2-)}"
# DSH_SITE_ADDRESS holds an AUTHORITY (host or IP, no scheme); this script talks
# HTTPS to it. A full URL is still accepted, so older .env files keep working.
case "$SITE" in
  http://*|https://*|"") : ;;
  *) SITE="https://${SITE}" ;;
esac
if [[ -z "${SITE:-}" ]]; then
  echo "ERROR: DSH_SITE_ADDRESS is unset and .env has no DSH_SITE_ADDRESS." >&2
  echo "       Run this next to compose.yaml, or export DSH_SITE_ADDRESS first." >&2
  exit 2
fi

BASE="${SITE%/}"
AUTH="${BASE#*://}"
HOSTNAME_="${AUTH%%:*}"
if [[ "$AUTH" == *:* ]]; then PORT="${AUTH##*:}"; else PORT=443; fi

echo "Target: ${BASE}   (host=${HOSTNAME_} port=${PORT})"
echo

# ------------------------------------------------------------ DNS / route ----

echo "[1/8] name resolution"
# VERIFY_ADDR forces the address every check connects to, bypassing DNS
# completely. Use it when this host cannot resolve the public name (split DNS:
# the browser resolves it, the server does not):
#   VERIFY_ADDR=127.0.0.1 bash verify.sh
RESOLVE=""
if [[ -n "${VERIFY_ADDR:-}" ]]; then
  note "VERIFY_ADDR=${VERIFY_ADDR}: bypassing DNS for every check"
  RESOLVE="--resolve ${HOSTNAME_}:${PORT}:${VERIFY_ADDR}"
elif RESOLVED="$(getent hosts "$HOSTNAME_" 2>/dev/null | awk '{print $1}' | head -1)" && [[ -n "$RESOLVED" ]]; then
  LOCAL_IPS="$(ip -o -4 addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1)"
  if [[ -n "$LOCAL_IPS" ]] && grep -qx "$RESOLVED" <<<"$LOCAL_IPS"; then
    note "$HOSTNAME_ -> $RESOLVED (an address of this host)"
  else
    note "$HOSTNAME_ -> $RESOLVED, which is NOT an address of this host"
    note "pinning to 127.0.0.1 so the checks still exercise THIS deployment"
    note "if the browser resolves the name somewhere else, that front end is NOT this stack"
    RESOLVE="--resolve ${HOSTNAME_}:${PORT}:127.0.0.1"
  fi
else
  note "$HOSTNAME_ does not resolve on this host (split DNS is normal here)"
  note "pinning to 127.0.0.1; SNI and the Host header stay ${HOSTNAME_}, which is what matters"
  RESOLVE="--resolve ${HOSTNAME_}:${PORT}:127.0.0.1"
fi
echo

# ------------------------------------------------------------------- TLS ----

echo "[2/8] TLS chain"
CA="$(mktemp)"
JAR="$(mktemp)"
trap 'rm -f "$CA" "$JAR"' EXIT

TLS=""
if docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$CA" >/dev/null 2>&1 && [[ -s "$CA" ]]; then
  note "exported the Caddy local root CA; verifying the chain with --cacert (no --insecure)"
  TLS="--cacert $CA"
  SUBJECT="$(openssl x509 -in "$CA" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  [[ -n "$SUBJECT" ]] && note "CA subject: $SUBJECT"
else
  note "could not export the Caddy CA (is the caddy service up?); falling back to --insecure"
  TLS="--insecure"
fi

# shellcheck disable=SC2086
CODE="$(curl -s -o /dev/null -w '%{http_code}' $TLS $RESOLVE "${BASE}/" 2>/dev/null)"
if [[ "$CODE" == "000" ]]; then
  echo "  FAIL  TLS handshake / connection                      could not connect at all"
  note "Caddy not serving ${HOSTNAME_}:${PORT}? Check: docker compose ps ; docker compose logs caddy"
  echo
  echo "Result: ${PASS} passed, ${FAIL} +1 failed"
  exit 1
fi
ok "TLS handshake + certificate chain" "HTTP ${CODE} received"
echo

# --------------------------------------------- compose network reachability --

echo "[3/8] compose network: caddy -> dsh"
# DSH answers exactly 401 on GET / with no session, so 401 proves this whole
# container-to-container hop is clean. Two very different faults produce
# something else, and conflating them wastes a debugging round:
#   5xx (usually 504) -> an intermediary answered. On hosts with a corporate
#        HTTP proxy this is it: Docker injects httpProxy/httpsProxy from
#        ~/.docker/config.json into containers, Caddy's reverse_proxy honors
#        them, and that config's noProxy normally lists only 172.17.0.0/16 (the
#        default bridge) while compose allocates 172.18.0.0/16 or later.
#   no HTTP response -> the host is not forwarding between bridge interfaces
#        (ip_forward / FORWARD policy / icc).
PROBE="$(docker compose exec -T caddy wget -S -q -T 3 -O /dev/null http://dsh:3080/ 2>&1)"
PROBE_CODE="$(printf '%s' "$PROBE" | grep -m1 -o 'HTTP/[0-9.]* [0-9]*' | awk '{print $2}')"
if [[ "$PROBE" == *"not found"* ]]; then
  note "cannot probe from the caddy image (no wget); skipping this check"
else
  expect "caddy -> dsh:3080 answers 401" "401" "${PROBE_CODE:-no HTTP response}"
fi
if [[ "${PROBE_CODE:-}" == 5* ]]; then
  note "a 5xx here cannot come from DSH: an intermediary answered it."
  note "  caddy proxy env: $(docker compose exec -T caddy printenv 2>/dev/null | grep -i proxy | tr '\n' ' ' | cut -c1-160)"
  note "  dsh   proxy env: $(docker compose exec -T dsh printenv 2>/dev/null | grep -i proxy | tr '\n' ' ' | cut -c1-160)"
  note "  compose subnet: $(docker network inspect dsh_dsh -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null)"
  note "The compose subnet must be covered by noProxy in ~/.docker/config.json"
  note "(checking for 172.17.0.0/16 is not enough: that is only the default bridge)."
  note "Fix A: add 172.16.0.0/12 to noProxy there."
  note "Fix B: run both services with network_mode: host; 127.0.0.0/8 is already excluded."
elif [[ -z "${PROBE_CODE:-}" && "$PROBE" != *"not found"* ]]; then
  note "no HTTP response at all: the host is not forwarding between bridge interfaces."
  note "  sysctl net.ipv4.ip_forward ; sudo iptables -S FORWARD | head ; firewall-cmd --state"
fi

# Egress from inside the container breaks for the same reason. Informational:
# a corporate egress policy can block this legitimately.
EGRESS="$(docker compose exec -T dsh curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://api.deepseek.com/ 2>/dev/null)"
if [[ "$EGRESS" == "000" ]]; then
  note "dsh -> api.deepseek.com: NO RESPONSE (model calls would fail; likely the same cause)"
else
  note "dsh -> api.deepseek.com: HTTP ${EGRESS} (container egress works)"
fi
echo

# ------------------------------------------------------ trust fence + auth --

echo "[4/8] DSH reachable through Caddy, unauthenticated"
expect "GET / (no cookie) -> 401" "401" "$CODE"
if [[ "$CODE" == "502" || "$CODE" == "503" ]]; then
  note "Caddy could not reach the container: docker compose logs dsh (did the bind overlay verify?)"
elif [[ "$CODE" == "404" ]]; then
  note "Caddy has no site block for this Host: check DSH_SITE_ADDRESS in .env"
fi
echo

echo "[5/8] launch token exchange"
TOKEN="$(docker compose logs dsh 2>/dev/null | grep -o 'token=[A-Za-z0-9._-]*' | tail -1 | cut -d= -f2)"
if [[ -z "$TOKEN" ]]; then
  echo "  FAIL  could not read the launch token from the container log"
  FAIL=$((FAIL + 1))
  note "try: docker compose logs dsh | grep token="
  JAR=""
else
  note "token ${TOKEN:0:8}... (${#TOKEN} chars)"
  # shellcheck disable=SC2086
  TOKEN_CODE="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" $TLS $RESOLVE "${BASE}/?token=${TOKEN}")"
  expect "GET /?token=<token> -> 303" "303" "$TOKEN_CODE"
  if [[ -s "$JAR" ]] && grep -qi 'dsh' "$JAR"; then
    ok "session cookie stored in the cookie jar" "$(grep -c 'dsh' "$JAR") cookie line(s)"
  else
    bad "session cookie stored in the cookie jar" "a dsh cookie" "none"
  fi
fi
echo

echo "[6/8] session cookie accepted on the index"
if [[ -n "${JAR:-}" && -s "$JAR" ]]; then
  # shellcheck disable=SC2086
  COOKIE_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $TLS $RESOLVE "${BASE}/")"
  expect "GET / (with cookie) -> 200" "200" "$COOKIE_CODE"
else
  note "skipped (no cookie jar)"
fi
echo

echo "[7/8] /api bridge"
# shellcheck disable=SC2086
API_CODE="$(curl -s -o /dev/null -w '%{http_code}' $TLS $RESOLVE "${BASE}/api/verify-probe")"
expect "/api/* (no cookie) -> 401, not 403" "401" "$API_CODE"
if [[ "$API_CODE" == "403" ]]; then
  note "403 means the Host header failed the trust fence. DSH_TRUSTED_HOSTS is currently:"
  note "  $(grep -m1 '^DSH_TRUSTED_HOSTS=' .env 2>/dev/null | cut -d= -f2-)"
fi
if [[ -n "${JAR:-}" && -s "$JAR" ]]; then
  # shellcheck disable=SC2086
  API_AUTH="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $TLS $RESOLVE "${BASE}/api/verify-probe")"
  note "/api/* (with cookie) -> ${API_AUTH}  (404 is expected: the route is unclaimed)"
fi
echo

echo "[8/8] fence enforcement + WebSocket"
# The negative test must target /api: the browser-trust fence is applied there
# (`isTrustedApiRequest` -> 403), while GET / goes through authorizeIndex(),
# which answers 401 for any missing session regardless of Host.
# It also runs INSIDE the container against DSH directly: through Caddy a wrong
# Host would be answered by Caddy's own site matching, proving nothing.
#
# The probe address is the one the server bound, not 127.0.0.1: dsh 0.2.1 rejects
# wildcard binds, so the entrypoint binds the container's own IPv4 and publishes it
# to $DSH_HOME/.runtime/bind-host. `DSH_INNER_ADDR` overrides (e.g. for
# network_mode: host).
INNER="${DSH_INNER_ADDR:-}"
if [[ -z "$INNER" ]]; then
  INNER="$(docker compose exec -T dsh cat /data/dsh/.runtime/bind-host 2>/dev/null | tr -d '\r\n')"
fi
if [[ -z "$INNER" ]]; then
  INNER="127.0.0.1"
  note "could not read /data/dsh/.runtime/bind-host; probing 127.0.0.1"
else
  note "probing the container's bound address: ${INNER}"
fi
# Same precedence as the deployment: the environment, then .env, then the default.
INNER_PORT="${DSH_BIND_PORT:-$(grep -m1 '^DSH_BIND_PORT=' .env 2>/dev/null | cut -d= -f2-)}"
[[ -n "${INNER_PORT}" ]] || INNER_PORT=3080
WRONG="$(docker compose exec -T dsh curl --noproxy '*' -s -o /dev/null -w '%{http_code}' \
  -H 'Host: not-the-configured-name.invalid' "http://${INNER}:${INNER_PORT}/api/verify-probe" 2>/dev/null)"
expect "wrong Host on /api straight to DSH -> 403" "403" "$WRONG"
if [[ "$WRONG" == "000" || -z "$WRONG" ]]; then
  note "no connection to ${INNER}:${INNER_PORT} — the server may have bound another address;"
  note "check: docker compose exec -T dsh cat /data/dsh/.runtime/bind-host"
fi

if [[ -n "${JAR:-}" && -s "$JAR" ]]; then
  # shellcheck disable=SC2086
  WS="$(curl -s -o /dev/null -w '%{http_code}' --http1.1 -b "$JAR" \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    $TLS $RESOLVE "${BASE}/api/remote.mux" 2>/dev/null)"
  # 101 is the only success. 504 here means the caddy->dsh hop is broken (step 3).
  expect "WebSocket /api/remote.mux -> 101" "101" "$WS"
fi
echo

echo "Result: ${PASS} passed, ${FAIL} failed"
echo
echo "Covered by this run: TLS chain, Caddy site routing, DSH browser-trust fence,"
echo "                     launch-token exchange, session cookie, /api bridge, WebSocket upgrade."
echo "NOT covered:         the client's own DNS resolution, the network path from that client"
echo "                     to this host, and the browser's certificate click-through."
echo "                     Those need a client that can resolve ${HOSTNAME_} (see README)."
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
echo
echo "Log in at: ${BASE}/?token=<the token printed above>"
