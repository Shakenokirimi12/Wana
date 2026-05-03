#!/usr/bin/env bash
# One command: shared local persist → D1 migrate (+ seed only when fresh / reset) → dev servers → smoke.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERSIST="${WANNA_PERSIST_DIR:-$REPO/.wrangler/preview-stack}"
export INGEST_URL="${INGEST_URL:-http://127.0.0.1:8787}"
export WORKER_URL="${WORKER_URL:-http://127.0.0.1:8788}"
export DASH_URL="${DASH_URL:-http://127.0.0.1:8789}"
# Ingest + worker share one wrangler dev → queue consumer sees producer; no standalone worker HTTP port.
export WANNA_COMBINED_INGEST_WORKER="${WANNA_COMBINED_INGEST_WORKER:-1}"

mkdir -p "$PERSIST"

PIDS=()
CLEANUP_DONE=0

# pgrep -P: immediate children (macOS / Linux)
kill_tree() {
  local sig=$1
  local p=$2
  [[ -n "$p" ]] && [[ "$p" =~ ^[0-9]+$ ]] || return 0
  local c
  for c in $(pgrep -P "$p" 2>/dev/null); do
    kill_tree "$sig" "$c"
  done
  if kill -0 "$p" 2>/dev/null; then
    kill "-${sig}" "$p" 2>/dev/null || true
  fi
}

cleanup() {
  if (( CLEANUP_DONE )); then
    return 0
  fi
  CLEANUP_DONE=1
  echo ""
  echo "Stopping preview…"
  local pid
  for pid in "${PIDS[@]:-}"; do
    kill_tree TERM "$pid"
  done
  sleep 0.8
  for pid in "${PIDS[@]:-}"; do
    kill_tree KILL "$pid"
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Run wrangler as a single Node process (no nested subshell + pnpm parent), so kill $! stops the whole tree.
launch_wrangler() {
  local app_dir=$1
  shift
  (
    cd "$app_dir" || exit 1
    exec node ./node_modules/wrangler/bin/wrangler.js "$@"
  ) &
  PIDS+=($!)
}

# Local Queues: producer + consumer must share one Miniflare instance (separate `wrangler dev` = messages never delivered).
launch_wrangler_ingest_and_worker() {
  (
    cd "$REPO" || exit 1
    exec node ./apps/ingest/node_modules/wrangler/bin/wrangler.js \
      dev \
      -c "$REPO/apps/ingest/wrangler.jsonc" \
      -c "$REPO/apps/worker/wrangler.jsonc" \
      --port 8787 \
      --inspector-port 9231 \
      --persist-to "$PERSIST" \
      --show-interactive-dev-session=false
  ) &
  PIDS+=($!)
}

echo "Using persist dir: $PERSIST"
SEED_MARKER="$PERSIST/.wana-preview-seeded"
HAD_LOCAL_D1=0
[[ -d "$PERSIST/v3/d1" ]] && HAD_LOCAL_D1=1

echo "Applying D1 schema (local)…"
(
  cd "$REPO/apps/ingest"
  pnpm exec wrangler d1 execute wana-control-plane --local --persist-to "$PERSIST" \
    --file "$REPO/packages/schema/migrations/0001_initial.sql"
)

SCHEMA_0002_MARKER="$PERSIST/.wana-migrated-0002"
if [[ ! -f "$SCHEMA_0002_MARKER" ]]; then
  echo "Applying D1 migration 0002 (sessions, username, invites, …)…"
  (
    cd "$REPO/apps/ingest"
    pnpm exec wrangler d1 execute wana-control-plane --local --persist-to "$PERSIST" \
      --file "$REPO/packages/schema/migrations/0002_auth_admin.sql"
  )
  touch "$SCHEMA_0002_MARKER"
else
  echo "Skip 0002 (marker present: $SCHEMA_0002_MARKER). Delete it to re-apply."
fi

# seed.sql wipes projects/api_keys — run only on fresh persist or explicit reset.
if [[ "${WANNA_PREVIEW_RESET:-}" == "1" ]]; then
  echo "WANNA_PREVIEW_RESET=1 → applying seed (projects reset to seed.sql)…"
  (
    cd "$REPO/apps/ingest"
    pnpm exec wrangler d1 execute wana-control-plane --local --persist-to "$PERSIST" \
      --file "$REPO/packages/schema/seed.sql"
  )
  touch "$SEED_MARKER"
elif [[ ! -f "$SEED_MARKER" ]]; then
  if [[ "$HAD_LOCAL_D1" == "0" ]]; then
    echo "Fresh persist → applying seed (proj_01 + test key)…"
    (
      cd "$REPO/apps/ingest"
      pnpm exec wrangler d1 execute wana-control-plane --local --persist-to "$PERSIST" \
        --file "$REPO/packages/schema/seed.sql"
    )
  else
    echo "Existing D1 state (no marker) → skip seed so your projects stay intact."
    echo "  To reset: rm -rf \"$PERSIST\"  or  WANNA_PREVIEW_RESET=1 pnpm preview"
  fi
  touch "$SEED_MARKER"
else
  echo "Skip seed (marker present). Use WANNA_PREVIEW_RESET=1 to reload seed.sql."
fi

# Avoid two wrangler processes opening the same DO persist at once; ingest+worker are one dev session.
echo "Building dashboard…"
(
  cd "$REPO/apps/dashboard"
  pnpm run build
)

cd "$REPO"

echo "Starting ingest + wana-worker (single wrangler dev, local queue :8787)…"
if [[ "${WANNA_COMBINED_INGEST_WORKER:-}" == "1" ]]; then
  launch_wrangler_ingest_and_worker
else
  echo "Starting ingest (:8787)…"
  launch_wrangler "$REPO/apps/ingest" \
    dev --port 8787 --inspector-port 9231 --persist-to "$PERSIST" \
    --show-interactive-dev-session=false
  pnpm exec wait-on -t 120000 tcp:127.0.0.1:8787
  echo "Starting worker (:8788)…"
  launch_wrangler "$REPO/apps/worker" \
    dev --port 8788 --inspector-port 9232 --persist-to "$PERSIST" \
    --show-interactive-dev-session=false
  pnpm exec wait-on -t 120000 tcp:127.0.0.1:8788
fi
pnpm exec wait-on -t 120000 tcp:127.0.0.1:8787

echo "Starting dashboard — Pages (:8789)…"
launch_wrangler "$REPO/apps/dashboard" \
  pages dev dist --port 8789 --inspector-port 9233 --persist-to "$PERSIST" \
  --show-interactive-dev-session=false
pnpm exec wait-on -t 120000 tcp:127.0.0.1:8789

echo ""
bash "$REPO/scripts/smoke-stack.sh"

echo ""
echo "────────────────────────────────────────"
echo "Preview URLs"
echo "  Ingest:    $INGEST_URL"
echo "  Worker:    queue consumer runs with ingest (no :8788 HTTP). Solo worker: WANNA_COMBINED_INGEST_WORKER=0 pnpm preview"
echo "  Dashboard: $DASH_URL"
echo "  永続: $PERSIST （消すと DB 初期化。シードだけやり直す: WANNA_PREVIEW_RESET=1）"
echo "  Sentry ブラウザテスト: pnpm run dev:playground （別ターミナル、DSN はダッシュボードから）"
echo "────────────────────────────────────────"
echo "Ctrl+C で停止します。"
wait
