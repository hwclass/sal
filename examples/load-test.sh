#!/usr/bin/env bash

# Simple load test to enqueue many SAL jobs and observe the UI updates.
# Defaults: 100 jobs, 10 concurrent requests, local job-service at http://localhost:8787.

set -euo pipefail

JOBS=${JOBS:-100}
CONCURRENCY=${CONCURRENCY:-10}
JOB_SERVICE_URL=${JOB_SERVICE_URL:-http://localhost:8787}
PROMPT=${PROMPT:-"Go to the WebAssembly article and extract the lead paragraph."}

payload_template=$(cat <<'JSON'
{
  "prompt": "__PROMPT__",
  "env": {
    "ITEMS_PATH": "/wiki/WebAssembly",
    "PLANNING_MODE": "heuristic",
    "LOGIN_PATH": "/no-login",
    "LOGIN_EMAIL_SELECTOR": "",
    "LOGIN_PASSWORD_SELECTOR": "",
    "LOGIN_SUBMIT_SELECTOR": "",
    "RUN_STEP_TIMEOUT_MS": "20000"
  }
}
JSON
)

export JOB_SERVICE_URL PROMPT payload_template

echo "Enqueuing $JOBS jobs with concurrency=$CONCURRENCY against $JOB_SERVICE_URL"

seq "$JOBS" | xargs -I{} -P "$CONCURRENCY" bash -c '
  idx="$1"
  payload="${payload_template/__PROMPT__/$PROMPT}" || exit 1
  curl -sS -X POST "$JOB_SERVICE_URL/jobs" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null || echo "Failed to enqueue job $idx"
' _ {}

echo "Done. Open $JOB_SERVICE_URL/ui to watch jobs run."
