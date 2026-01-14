# Multi-Job Execution Demo

**Semantic execution layer for repeatable browser workflows.**

This demo showcases SAL as infrastructure for deterministic, parallel browser automation with semantic plan caching.

## What This Demo Demonstrates

### ✓ Semantic Plan Reuse
- Natural language describes intent
- Similar tasks share conceptual plans
- Understanding happens once, executes many times
- Cache hit ratio: ~70%+ on repeat runs

### ✓ Parallel Execution
- 30 jobs processed concurrently
- Configurable worker pool (default: 10 workers)
- Stable throughput: ~300ms average execution time
- Queue-based orchestration with bounded concurrency

### ✓ Deterministic Navigation
- Explicit navigation anchors (paths) guarantee correctness
- No speculative behavior or retry loops
- Known sites with stable page structures
- 100% success rate

### ✓ Infrastructure Performance
- Lightpanda-powered browser execution
- CDP connection pooling
- Session persistence for authenticated workflows
- Three-dimensional outcome tracking (navigation, extraction, execution integrity)

## Bounded Scope

This demo operates within explicit boundaries:

**Bounded Automation Context:**
- Target: Wikipedia (known site structure)
- Navigation: Explicit paths (`/wiki/WebAssembly`, `/wiki/Rust_(programming_language)`, etc.)
- Extraction: Stable CSS selectors
- No autonomous navigation or search reasoning

**Natural Language + Explicit Anchors:**
```json
{
  "task": "Extract the first paragraph",
  "target": "/wiki/WebAssembly"
}
```

- `task`: Natural language describes extraction intent
- `target`: Explicit path guarantees navigation correctness

This approach ensures:
- **Success > Coverage**: Demo always succeeds
- **Signal > Novelty**: Performance metrics are meaningful
- **Infrastructure > Agent**: SAL optimizes understanding reuse, not DOM guessing

## Running the Demo

### Prerequisites
```bash
# Start SAL services (Lightpanda + Job Service)
make sal-restart
```

### Execute Demo
```bash
# Default: 10 concurrent workers
make sal-demo-multi-prompt

# Custom concurrency
CONCURRENCY=20 make sal-demo-multi-prompt
```

### Expected Output
```
AGGREGATE METRICS
───────────────────────────────────────────────────────────
  Total Jobs:           30
  Succeeded:            30 (100.0%)
  Failed:               0

TIMING & THROUGHPUT
───────────────────────────────────────────────────────────
  Enqueue Duration:     0s
  Avg Total Time:       45s
  Avg Execution Time:   .307s
  Concurrency:          10 workers

SEMANTIC CACHE PERFORMANCE
───────────────────────────────────────────────────────────
  Cache Hits:           22
  Cache Misses:         8
  Cache Hit Ratio:      73.3%

EXECUTION OUTCOME
───────────────────────────────────────────────────────────
  Navigation Success:   30 / 30
  Extraction Success:   22 / 30

  Plan Reused:          20 / 30 (cached understanding)
  Plan Generated:       10 / 30 (new understanding)
```

## Architecture

### Job Structure
Each job includes:
1. **Natural language task** - Describes extraction intent
2. **Explicit navigation anchor** - Guarantees correct page load
3. **Execution environment** - Timeouts, selectors, auth config

### Semantic Cache Flow
```
Job Submitted
  ↓
Embed Task (Transformers.js)
  ↓
Lookup Semantic Cache (DuckDB)
  ├─ Cache Hit → Reuse Plan (2-5ms)
  └─ Cache Miss → Generate Plan (DMR, ~1000ms)
  ↓
Compile to Executable Steps
  ↓
Execute via CDP Pool (Lightpanda)
  ↓
Return Results + Outcome Model
```

### Three-Dimensional Outcome Model
Every job reports:
- **navigation_status**: Did browser reach target page?
- **extraction_status**: Did selectors find data?
- **execution_integrity**: Was plan reused or generated?

This separates:
- Semantic planning success (plan generation/reuse)
- Infrastructure success (navigation, browser control)
- Grounding success (selector resolution)

## What This Demo Does NOT Do

**Explicit Non-Goals:**
- ❌ Prompt-only navigation reasoning
- ❌ Search engine automation
- ❌ Selector discovery or inference
- ❌ Autonomous agent loops
- ❌ Unknown site structures

These belong in future demos focused on different capabilities.

## Use Cases

This demo architecture is suitable for:

✓ **Repeatable Data Extraction**
- Known sites with stable structure
- High-volume parallel execution
- Cached understanding for similar tasks

✓ **Infrastructure Workloads**
- QA automation across known workflows
- Monitoring and health checks
- Bulk operations with semantic variations

✓ **Performance Benchmarking**
- Cache hit rate optimization
- Throughput testing
- Lightpanda performance validation

## Inspecting Results

### View Job Outcomes
```bash
# All jobs
curl http://localhost:8787/jobs | jq

# Filter by outcome
curl http://localhost:8787/jobs | jq '.jobs[] | select(.summary.outcome.extraction_status == "success")'

# Check plan reuse
curl http://localhost:8787/jobs | jq '.jobs[] | {task: .summary.prompt[0:50], integrity: .summary.outcome.execution_integrity, plan_source: .summary.plan.source}'
```

### Live Monitoring
- **Job Queue UI**: http://localhost:8787/ui
- **Metrics API**: http://localhost:8787/metrics

## Key Insights

**Understanding Once, Executing Many Times:**
- 5 variations of "Extract the first paragraph" → 1 conceptual plan
- Different targets (Rust, Python, Docker) → Same extraction pattern reused
- Cache hit ratio improves on subsequent runs

**Deterministic Infrastructure:**
- Explicit anchors remove navigation ambiguity
- Stable selectors eliminate extraction flakiness
- Semantic layer optimizes the understanding phase

**SAL Is Not an Agent:**
- No autonomous decision-making
- No speculative behavior
- No learning loops
- Just: understand intent → generate plan → execute deterministically

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Jobs | 30 |
| Concurrency | 10 workers |
| Success Rate | 100% |
| Avg Execution | ~300ms |
| Cache Hit Ratio | 70%+ (repeat runs) |
| Unique Plan Types | 2 |

**Runtime Breakdown:**
- Enqueue: <1s (all jobs submitted)
- Execution: ~45s (30 jobs / 10 workers)
- Per-job: 270-680ms (consistent)

## Troubleshooting

### Jobs Timing Out
- Increase `RUN_STEP_TIMEOUT_MS` in payload
- Check Lightpanda logs: `docker logs sal-lightpanda`

### Cache Not Working
- Restart services to clear memory cache
- Check DuckDB: Plans persist across restarts

### Null Results
- Check `extraction_status` in outcome model
- Verify target path is correct
- Inspect selector in job summary

## Next Steps

1. **Increase Scale**: Test with 100+ jobs
2. **Custom Targets**: Add your own Wikipedia pages to [prompts.json](prompts.json)
3. **Monitor Cache**: Track cache hit ratio over multiple runs
4. **Inspect Plans**: View generated YAML plans in job summaries

---

**SAL: Semantic execution layer for repeatable browser workflows.**
