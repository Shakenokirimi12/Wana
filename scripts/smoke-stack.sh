#!/usr/bin/env bash
# Smoke-test a running local stack (ingest + worker + dashboard Pages).
# Use after `pnpm preview` is up, or against custom URLs via env vars.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INGEST="${INGEST_URL:-http://127.0.0.1:8787}"
WORKER="${WORKER_URL:-http://127.0.0.1:8788}"
DASH="${DASH_URL:-http://127.0.0.1:8789}"
PROJECT="${SMOKE_PROJECT_ID:-proj_01}"
KEY="${SMOKE_DSN_KEY:-wana_test_key_abc123}"

echo "→ GET $INGEST/health"
curl -sfS "$INGEST/health" | grep -q '"status":"ok"' || {
  echo "ingest /health failed or unexpected body"
  exit 1
}

echo "→ GET $INGEST/health"
curl -sfS "$INGEST/health" | grep -q '"status":"ok"' || {
  echo "ingest /health failed or unexpected body"
  exit 1
}

if [[ "${WANNA_COMBINED_INGEST_WORKER:-}" == "1" ]]; then
  echo "→ skip GET $WORKER/health (ingest + wana-worker share one dev; worker fetch is not on port 8788)"
else
  echo "→ GET $WORKER/health"
  curl -sfS "$WORKER/health" | grep -q '"status":"ok"' || {
    echo "worker /health failed or unexpected body"
    exit 1
  }
fi

echo "→ GET $DASH/"
curl -sfS "$DASH/" >/dev/null || {
  echo "dashboard root failed"
  exit 1
}

echo "→ POST Sentry envelope → ingest"
bash "$SCRIPT_DIR/send-sentry-envelope.sh" "$PROJECT" "$KEY" "$INGEST"

echo ""
echo "smoke-stack: OK"
