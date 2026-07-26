#!/usr/bin/env bash
# Deploy / verify edge-quote-api dual-live readiness.
# Primary production path today: blog Pages Functions via sync:quote.
# Optional secondary path: independent Cloudflare Worker (requires Workers write token).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ACCOUNT_HINT="325ec15c00814124ef32ac0a72f2c08f"
WORKER_NAME="edge-quote-api"
WORKER_URL_DEFAULT="https://edge-quote-api.brucelau1987.workers.dev"
WORKER_URL="${EDGE_QUOTE_WORKER_URL:-$WORKER_URL_DEFAULT}"
PAGES_QUOTE_URL="${PAGES_QUOTE_URL:-https://etf.peekabo.cc/api/public/v1/quote}"

# Prefer Global API Key auth for Worker ops if local dual-live credentials exist.
# Pages deploy continues to use cloudflare-pages.env separately.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_API_KEY:-}" && -f /root/.hermes/credentials/cloudflare-global.env ]]; then
  # shellcheck disable=SC1091
  source /root/.hermes/credentials/cloudflare-global.env
fi
if [[ -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ]]; then
  unset CLOUDFLARE_API_TOKEN
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "FAIL missing command: $1" >&2
    exit 1
  }
}

need_cmd node
need_cmd curl
need_cmd npx

echo "== offline unit tests"
OFFLINE=1 npm test

echo
echo "== dual-live status"
echo "Pages quote (primary): $PAGES_QUOTE_URL"
if [[ -n "$WORKER_URL" ]]; then
  echo "Worker quote (secondary): $WORKER_URL"
else
  echo "Worker quote (secondary): not configured (set EDGE_QUOTE_WORKER_URL after first successful worker deploy)"
fi

probe_quote() {
  local label="$1"
  local url="$2"
  local hdr body code cache session ttl layer
  body="$(curl -fsS -H 'User-Agent: Hermes-Edge-Quote-Probe' "${url}?symbol=600021&exchange=SSE" || true)"
  hdr="$(curl -fsSI -X GET -H 'User-Agent: Hermes-Edge-Quote-Probe' -D - -o /dev/null "${url}?symbol=600021&exchange=SSE" || true)"
  if ! printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "FAIL $label body status!=ok: ${body:0:180}"
    return 1
  fi
  cache="$(printf '%s' "$hdr" | tr '[:upper:]' '[:lower:]' | grep -E 'x-quote-cache:' | head -n1 | sed -E 's/.*:[[:space:]]*//' | tr -d '\r')"
  session="$(printf '%s' "$hdr" | tr '[:upper:]' '[:lower:]' | grep -E 'x-quote-cache-session:' | head -n1 | sed -E 's/.*:[[:space:]]*//' | tr -d '\r')"
  ttl="$(printf '%s' "$hdr" | tr '[:upper:]' '[:lower:]' | grep -E 'x-quote-cache-ttl-ms:' | head -n1 | sed -E 's/.*:[[:space:]]*//' | tr -d '\r')"
  layer="$(printf '%s' "$hdr" | tr '[:upper:]' '[:lower:]' | grep -E 'x-quote-cache-layer:' | head -n1 | sed -E 's/.*:[[:space:]]*//' | tr -d '\r')"
  echo "OK  $label status=ok cache=${cache:-na} layer=${layer:-na} session=${session:-na} ttl=${ttl:-na}"
  return 0
}

echo
echo "== probe primary Pages Functions path"
probe_quote "pages" "$PAGES_QUOTE_URL"

deploy_worker=0
if [[ "${1:-}" == "--deploy-worker" ]]; then
  deploy_worker=1
fi

if (( deploy_worker == 1 )); then
  echo
  echo "== attempt independent Worker deploy"
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "FAIL CLOUDFLARE_API_TOKEN is empty"
    echo "Required token permissions for dual-live Worker deploy:"
    echo "  - Account / Workers Scripts: Edit"
    echo "  - Account / Account Settings: Read (recommended)"
    echo "  - User / Memberships: Read (recommended)"
    exit 1
  fi
  set +e
  deploy_out="$(npx --yes wrangler deploy 2>&1)"
  deploy_code=$?
  set -e
  printf '%s\n' "$deploy_out" | tail -n 40
  if (( deploy_code != 0 )); then
    echo
    echo "FAIL worker deploy (exit=$deploy_code)"
    if printf '%s' "$deploy_out" | grep -Eqi 'Authentication error|10000|permissions'; then
      echo "Likely missing Workers write scope on CLOUDFLARE_API_TOKEN."
      echo "Current token can deploy Cloudflare Pages, but not Workers services."
      echo "Create/update token with:"
      echo "  Account permissions -> Workers Scripts -> Edit"
      echo "  Account ID: $ACCOUNT_HINT"
      echo "  Worker name: $WORKER_NAME"
      echo
      echo "Until then, production dual-live remains Pages-primary only:"
      echo "  1) edit edge-quote-api"
      echo "  2) npm test"
      echo "  3) in blog: npm run sync:quote && npm run deploy:pages && npm run verify:pages"
      exit 2
    fi
    exit "$deploy_code"
  fi

  # Best-effort extract workers.dev URL from deploy output.
  extracted="$(printf '%s' "$deploy_out" | grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -n1 || true)"
  if [[ -n "$extracted" ]]; then
    WORKER_URL="$extracted"
    echo "OK  worker URL: $WORKER_URL"
  fi
fi

if [[ -n "$WORKER_URL" ]]; then
  echo
  echo "== probe secondary Worker path"
  # Worker serves quote on any path (root and /api/public/v1/quote both work).
  if probe_quote "worker-root" "$WORKER_URL"; then
    :
  elif probe_quote "worker-path" "$WORKER_URL/api/public/v1/quote"; then
    :
  else
    echo "FAIL worker quote probe"
    exit 1
  fi
else
  echo
  echo "SKIP worker probe (EDGE_QUOTE_WORKER_URL unset and deploy not successful)"
fi

echo
echo "Dual-live summary:"
echo "  primary: Pages Functions @ $PAGES_QUOTE_URL"
if [[ -n "$WORKER_URL" ]]; then
  echo "  secondary: Worker @ $WORKER_URL"
  echo "  status: dual-live ready"
else
  echo "  secondary: blocked on Workers write token"
  echo "  status: pages-primary only"
fi
