#!/usr/bin/env bash

# Multi-Job Execution: Semantic Plan Caching with Deterministic Navigation
# Demonstrates SAL as infrastructure for repeatable browser workflows
# - Semantic plan reuse across similar tasks
# - Parallel job execution with bounded concurrency
# - Deterministic navigation with explicit anchors
# - Infrastructure-grade performance using Lightpanda

set -euo pipefail

JOB_SERVICE_URL=${JOB_SERVICE_URL:-http://localhost:8787}
CONCURRENCY=${CONCURRENCY:-10}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_FILE="$SCRIPT_DIR/prompts.json"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     SAL Multi-Job Execution: Semantic Cache & Parallelism     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  • Job Service: $JOB_SERVICE_URL"
echo "  • Concurrency: $CONCURRENCY"
echo "  • Jobs File: $JOBS_FILE"
echo ""

# Check if job service is available
echo "Checking job service health..."
if ! curl -sf "$JOB_SERVICE_URL/health" > /dev/null 2>&1; then
  echo "✗ Job service is not responding at $JOB_SERVICE_URL"
  echo "  Run 'make sal-restart' to start the service"
  exit 1
fi
echo "✓ Job service is ready"
echo ""

# Count total jobs
TOTAL_JOBS=$(jq -r '.jobs | length' "$JOBS_FILE")
echo "Loaded $TOTAL_JOBS jobs"
echo ""

# Create payload template
payload_template=$(cat <<'JSON'
{
  "prompt": "__TASK__",
  "env": {
    "ITEMS_PATH": "__TARGET__",
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

echo "Submitting $TOTAL_JOBS jobs with concurrency=$CONCURRENCY..."
echo ""

start_ts=$(date +%s)

# Extract jobs and submit them
jq -r '.jobs[] | "\(.task)|\(.target)"' "$JOBS_FILE" | while IFS='|' read -r task target; do
  echo "$task|$target"
done | xargs -I{} -P "$CONCURRENCY" bash -c '
  IFS="|" read -r task target <<< "$1"
  payload_template="$2"
  job_service_url="$3"

  # Replace placeholders
  payload="${payload_template/__TASK__/$task}"
  payload="${payload/__TARGET__/$target}"

  response=$(curl -sS -X POST "$job_service_url/jobs" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1)

  if [ $? -eq 0 ]; then
    job_id=$(echo "$response" | jq -r ".id // empty")
    if [ -n "$job_id" ]; then
      echo "  ✓ Enqueued: $job_id (task: ${task:0:40}...)"
    else
      echo "  ✗ Failed to parse response for task: ${task:0:50}..."
    fi
  else
    echo "  ✗ Failed to enqueue: ${task:0:50}..."
  fi
' bash {} "$payload_template" "$JOB_SERVICE_URL"

end_ts=$(date +%s)
enqueue_duration=$(( end_ts - start_ts ))

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "All $TOTAL_JOBS jobs enqueued in ${enqueue_duration}s"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Monitoring progress..."
echo "  • Live UI: $JOB_SERVICE_URL/ui"
echo "  • Metrics: $JOB_SERVICE_URL/metrics"
echo ""

# Wait for jobs to complete and show progress
echo "Waiting for execution to complete..."
prev_completed=0
dots=""
timeout=300  # 5 minutes max
elapsed=0

while true; do
  sleep 2
  elapsed=$((elapsed + 2))

  # Get current metrics
  metrics=$(curl -sf "$JOB_SERVICE_URL/metrics" 2>/dev/null || echo '{}')

  total=$(echo "$metrics" | jq -r '.total // 0')
  active=$(echo "$metrics" | jq -r '.active // 0')
  pending=$(echo "$metrics" | jq -r '.pending // 0')

  # Calculate completed
  completed=$total

  # Show progress if changed
  if [ "$completed" -ne "$prev_completed" ]; then
    dots=""
    printf "\r  Progress: %d/%d completed, %d active, %d pending" "$completed" "$TOTAL_JOBS" "$active" "$pending"
    prev_completed=$completed
  else
    dots="$dots."
    printf "\r  Progress: %d/%d completed, %d active, %d pending%s" "$completed" "$TOTAL_JOBS" "$active" "$pending" "$dots"
  fi

  # Check if all jobs are done
  if [ "$completed" -ge "$TOTAL_JOBS" ] && [ "$active" -eq 0 ] && [ "$pending" -eq 0 ]; then
    printf "\n"
    break
  fi

  # Timeout check
  if [ "$elapsed" -ge "$timeout" ]; then
    printf "\n"
    echo "⚠ Timeout after 5 minutes - some jobs may still be running"
    break
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    EXECUTION COMPLETE                          "
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Fetch final metrics
metrics=$(curl -sf "$JOB_SERVICE_URL/metrics" 2>/dev/null || echo '{}')

total=$(echo "$metrics" | jq -r '.total // 0')
succeeded=$(echo "$metrics" | jq -r '.succeeded // 0')
failed=$(echo "$metrics" | jq -r '.failed // 0')
avg_total_ms=$(echo "$metrics" | jq -r '.avg_total_ms // 0')
avg_exec_ms=$(echo "$metrics" | jq -r '.avg_exec_ms // 0')
embed_cache=$(echo "$metrics" | jq -r '.embed_cache // 0')
embed_local=$(echo "$metrics" | jq -r '.embed_local // 0')
intent_dmr=$(echo "$metrics" | jq -r '.intent_dmr // 0')
intent_regex=$(echo "$metrics" | jq -r '.intent_regex // 0')

# Calculate cache hit ratio
if [ "$total" -gt 0 ]; then
  cache_hit_ratio=$(echo "scale=1; $embed_cache * 100 / $total" | bc)
else
  cache_hit_ratio=0
fi

# Calculate success rate
if [ "$total" -gt 0 ]; then
  success_rate=$(echo "scale=1; $succeeded * 100 / $total" | bc)
else
  success_rate=0
fi

# Convert milliseconds to seconds
avg_total_sec=$(echo "scale=2; $avg_total_ms / 1000" | bc)
avg_exec_sec=$(echo "scale=3; $avg_exec_ms / 1000" | bc)

echo "AGGREGATE METRICS"
echo "─────────────────────────────────────────────────────────────"
echo "  Total Jobs:           $total"
echo "  Succeeded:            $succeeded (${success_rate}%)"
echo "  Failed:               $failed"
echo ""
echo "TIMING & THROUGHPUT"
echo "─────────────────────────────────────────────────────────────"
echo "  Enqueue Duration:     ${enqueue_duration}s"
echo "  Avg Total Time:       ${avg_total_sec}s"
echo "  Avg Execution Time:   ${avg_exec_sec}s"
echo "  Concurrency:          $CONCURRENCY workers"
echo ""
echo "SEMANTIC CACHE PERFORMANCE"
echo "─────────────────────────────────────────────────────────────"
echo "  Cache Hits:           $embed_cache"
echo "  Cache Misses:         $embed_local"
echo "  Cache Hit Ratio:      ${cache_hit_ratio}%"
echo ""
echo "  Semantic Insight: Understanding once, executing many times"
echo ""

# Fetch all jobs and analyze outcomes
jobs_data=$(curl -sf "$JOB_SERVICE_URL/jobs" 2>/dev/null || echo '{"jobs":[]}')

# Count outcome dimensions
nav_success=$(echo "$jobs_data" | jq '[.jobs[] | select(.summary.outcome.navigation_status == "success")] | length')
extract_success=$(echo "$jobs_data" | jq '[.jobs[] | select(.summary.outcome.extraction_status == "success")] | length')
plan_reused=$(echo "$jobs_data" | jq '[.jobs[] | select(.summary.outcome.execution_integrity == "plan_reused")] | length')
plan_generated=$(echo "$jobs_data" | jq '[.jobs[] | select(.summary.outcome.execution_integrity == "plan_generated")] | length')

echo "EXECUTION OUTCOME"
echo "─────────────────────────────────────────────────────────────"
echo "  Navigation Success:   $nav_success / $total"
echo "  Extraction Success:   $extract_success / $total"
echo ""
echo "  Plan Reused:          $plan_reused / $total (cached understanding)"
echo "  Plan Generated:       $plan_generated / $total (new understanding)"
echo ""

# Fetch all jobs and analyze
jobs=$(curl -sf "$JOB_SERVICE_URL/jobs" 2>/dev/null || echo '{"jobs":[]}')

# Find fastest and slowest jobs
fastest=$(echo "$jobs" | jq -r '[.jobs[] | select(.status == "succeeded")] | min_by(.summary.timings.exec_ms // 999999) | .summary.timings.exec_ms // 0')
slowest=$(echo "$jobs" | jq -r '[.jobs[] | select(.status == "succeeded")] | max_by(.summary.timings.exec_ms // 0) | .summary.timings.exec_ms // 0')

fastest_sec=$(echo "scale=3; $fastest / 1000" | bc)
slowest_sec=$(echo "scale=3; $slowest / 1000" | bc)

# Count unique plans
unique_plans=$(echo "$jobs" | jq '[.jobs[].summary.plan.source] | unique | length')

echo "PERFORMANCE ANALYSIS"
echo "─────────────────────────────────────────────────────────────"
echo "  Fastest Job:          ${fastest_sec}s"
echo "  Slowest Job:          ${slowest_sec}s"
echo "  Unique Plan Types:    $unique_plans"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✓ Multi-job execution complete"
echo ""
echo "What This Demo Demonstrates:"
echo "  ✓ Semantic plan reuse: Similar tasks share conceptual plans"
echo "  ✓ Parallel execution: $CONCURRENCY concurrent workers"
echo "  ✓ Deterministic automation: Explicit navigation anchors"
echo "  ✓ Infrastructure performance: Lightpanda-powered execution"
echo ""
echo "SAL as Infrastructure:"
echo "  • Bounded automation context (known sites, stable structure)"
echo "  • Natural language describes intent"
echo "  • Explicit anchors guarantee correctness"
echo "  • Semantic layer optimizes understanding reuse"
echo ""
echo "Next steps:"
echo "  • View detailed results: $JOB_SERVICE_URL/ui"
echo "  • Inspect job outcomes: curl $JOB_SERVICE_URL/jobs | jq"
echo "  • Verify plan reuse: Check 'execution_integrity' field"
echo "  • Re-run for improved cache: $0"
echo ""
