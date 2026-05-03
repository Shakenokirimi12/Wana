#!/usr/bin/env bash
# Step 3.3: send a minimal Sentry-compatible envelope to local ingest.
set -euo pipefail

PROJECT_ID="${1:-proj_01}"
KEY="${2:-wana_test_key_abc123}"
HOST="${3:-http://127.0.0.1:8787}"

EVENT_ID="$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

BODY="$(printf '%s\n%s\n%s' \
  "{\"event_id\":\"${EVENT_ID}\",\"sent_at\":\"${TS}\"}" \
  '{"type":"event","length":0}' \
  '{"exception":{"values":[{"type":"Error","value":"Wana E2E from send-envelope.sh"}]},"event_id":"'"${EVENT_ID}"'"}')"

curl -sS -X POST "${HOST}/api/${PROJECT_ID}/envelope/" \
  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_client=test/1.0, sentry_key=${KEY}" \
  -H "Content-Type: application/x-sentry-envelope" \
  --data-binary "${BODY}" \
  -w "\nHTTP %{http_code}\n"

echo "event_id=${EVENT_ID}"
