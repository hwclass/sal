# SAL Execution Flow - Technical Deep Dive

This document provides a detailed, step-by-step breakdown of how SAL executes browser automation from natural language prompt to final result.

**Audience:** Contributors, implementers, advanced users who want to understand internals.

---

## High-Level Overview

```
Natural Language Prompt
    ↓
Embedding Generation (4-layer cache)
    ↓
Semantic Plan Lookup (DuckDB similarity search)
    ↓
Plan Generation (if cache miss)
    ↓
Plan Compilation (roles → selectors)
    ↓
Browser Execution (Lightpanda via CDP)
    ↓
Result Extraction & Return
```

**Typical Execution Time:**
- **Cache HIT:** 0.75s (embed=2ms, lookup=4ms, exec=693ms)
- **Cache MISS:** 1.5-2s (embed=350ms, plan=800ms, exec=693ms)

---

## Detailed Execution Flow

### Phase 1: Initialization & Setup (20-30ms)

**Entry Point:** `automation/sal-cli.mjs` main execution

```javascript
// 1. Parse command line arguments
const userPrompt = process.argv[2];
// Example: "Log into the app and extract the first 2 items"

// 2. Initialize plan cache (DuckDB connection)
await initPlanCache();
// Creates/opens plan-cache.duckdb
// Tables: plans, sessions, embeddings

// 3. Load environment configuration
const config = {
  baseUrl: process.env.TARGET_BASE_URL,
  selectors: {
    email: process.env.LOGIN_EMAIL_SELECTOR,
    password: process.env.LOGIN_PASSWORD_SELECTOR,
    // ... etc
  }
};
```

**File:** `automation/sal-cli.mjs:1-50`
**Duration:** ~20ms (DuckDB file open + env parsing)

---

### Phase 2: Prompt Embedding (2ms cached, 350ms cold)

**Goal:** Convert natural language prompt to 384-dimensional vector for semantic search.

#### 2.1 Layer 1: In-Memory Cache Check
```javascript
// automation/embeddings.mjs:93-102
if (embeddingCache.has(text)) {
  console.log("[SAL] Embedding cache HIT (in-memory)");
  return embeddingCache.get(text); // 0.001ms
}
```

**Hit Rate:** ~80% for repeated prompts in same process
**Duration:** 0.001ms

#### 2.2 Layer 2: DuckDB Persistent Cache Check
```javascript
// automation/embeddings.mjs:103-110
const dbCached = await getCachedEmbedding(text);
if (dbCached) {
  console.log("[SAL] Embedding cache HIT (DuckDB)");
  cacheEmbedding(text, dbCached); // Warm L1
  return dbCached; // 2-5ms
}
```

**SQL Query:**
```sql
SELECT embedding FROM embeddings
WHERE prompt_hash = ?
LIMIT 1;
```

**Hash Function:** Simple 32-bit hash → base36 (collision rate: 0.0000036% for 10k prompts)
**Hit Rate:** ~95% for CLI runs (persists across processes)
**Duration:** 2-5ms

#### 2.3 Layer 3: DMR Remote Embeddings (Currently Disabled)
```javascript
// automation/embeddings.mjs:113-121
if (process.env.DMR_EMBED_URL) {
  const dmrEmb = await embedWithDMR(text);
  if (dmrEmb) {
    // Cache in both L1 and L2
    cacheEmbedding(text, dmrEmb);
    await saveEmbedding(text, dmrEmb);
    return dmrEmb;
  }
}
```

**Current Status:** Circuit breaker opens on first pooling error
**If Enabled:** 10-20ms network call to DMR
**Actual Behavior:** Skips due to `dmrEmbeddingDisabled = true`

#### 2.4 Layer 4: Local Transformers.js (Fallback)
```javascript
// automation/embeddings.mjs:124-131
const localEmb = await embedWithLocalModel(text);
// Uses: all-MiniLM-L6-v2 (384 dimensions)
console.log("[SAL] Using local embedding model (fallback)");

// Cache for future use
cacheEmbedding(text, localEmb);      // L1: In-memory
await saveEmbedding(text, localEmb); // L2: DuckDB
return localEmb;
```

**First Load:** 7.6s (model download + initialization)
**Warm Model:** 350-400ms (inference only)
**Output:** `[0.123, -0.456, ..., 0.789]` (384 floats)

**File:** `automation/embeddings.mjs:1-137`
**Duration:** 2ms (cached) or 350ms (cold)

---

### Phase 3: Semantic Plan Lookup (4ms)

**Goal:** Find existing plan with similar intent using cosine similarity.

```javascript
// automation/plan-cache.mjs:150-166
export async function findBestPlanByEmbedding(embedding, threshold = 0.9) {
  const rows = await getAllPlans();
  // Loads all cached plans from DuckDB

  let best = null;
  let bestSim = 0;

  for (const row of rows) {
    const cachedEmb = JSON.parse(row.embedding);
    const sim = cosineSimilarity(embedding, cachedEmb);

    if (sim > bestSim) {
      bestSim = sim;
      best = row;
    }
  }

  if (best && bestSim >= threshold) {
    return { ...best, similarity: bestSim };
  }

  return null; // Cache miss
}
```

**Cosine Similarity Formula:**
```javascript
similarity = dot(A, B) / (||A|| * ||B||)
// Range: -1 to 1 (1 = identical, 0 = orthogonal, -1 = opposite)
```

**Threshold:** 0.9 (90% similar to match)
**Performance:** O(n) where n = number of cached plans (typically 5-20)
**Optimization Opportunity:** DuckDB vector extension for SQL-based similarity

**File:** `automation/plan-cache.mjs:150-166`
**Duration:** 4ms (10 plans), scales linearly

---

### Phase 4: Plan Generation (0ms cached, 800-900ms cold)

#### 4A: Cache Hit Path (Most Common)
```javascript
if (cachedPlan) {
  console.log(`[SAL] Plan cache HIT (similarity: ${cachedPlan.similarity})`);
  await incrementHits(cachedPlan.id); // Update usage stats

  // Skip directly to Phase 5
  return cachedPlan.yaml;
}
```

**Duration:** 0ms (YAML already available)
**Hit Rate:** 100% after first run for same workflow

#### 4B: Cache Miss Path (First Run)

**Step 4B.1: Intent Classification**
```javascript
// automation/intent-classifier.mjs:15-60
const intent = await classifyIntent(prompt);

// Prompt to SmolLM2-360M:
// "Extract these fields from the user prompt as JSON:
//  - requires_login: boolean
//  - action: string (extract/navigate/click/fill)
//  - target: string (items/users/page name)
//  - limit: number (optional)"

// Response:
{
  requires_login: true,
  action: "extract",
  target: "items",
  limit: 2
}
```

**LLM Backend:** DMR (if available) → Heuristic regex (fallback)
**Duration:** 200-300ms (DMR) or 5ms (heuristic)

**Step 4B.2: Template Selection**
```javascript
// automation/planner.mjs:80-120
function selectTemplate(intent) {
  if (intent.requires_login && intent.action === "extract") {
    return loginAndExtractTemplate;
  }
  if (intent.action === "extract") {
    return extractOnlyTemplate;
  }
  // ... etc
}

const template = selectTemplate(intent);
```

**Templates:** Pre-defined YAML structures in `automation/plan-templates.mjs`
**Duration:** <1ms (pure JavaScript lookup)

**Step 4B.3: Plan Generation from Template**
```javascript
// automation/planner.mjs:45-75
const yamlPlan = template({
  target: intent.target,
  limit: intent.limit,
  requiresLogin: intent.requires_login
});

// Generates:
// steps:
//   - id: 1
//     action: go
//     target: login page
//   - id: 2
//     action: fill_field
//     field_role: email
//   - id: 3
//     action: fill_field
//     field_role: password
//   - id: 4
//     action: click_button
//     button_role: submit
//   - id: 5
//     action: go
//     target: items page
//   - id: 6
//     action: extract_list
//     list_role: items
//     limit: 2
```

**Duration:** <1ms (template rendering)

**Step 4B.4: Cache New Plan**
```javascript
// automation/plan-cache.mjs:77-97
await savePlan({
  prompt: userPrompt,
  yaml: yamlPlan,
  embedding: embedding,
  backend: 'intent',
  success: true
});
```

**SQL:**
```sql
INSERT INTO plans (id, prompt, normalized_prompt, yaml, embedding, backend, success_rate)
VALUES (?, ?, ?, ?, ?, ?, ?);
```

**Duration:** 5-10ms (DuckDB insert)

**Total Phase 4 (Cache Miss):** 800-900ms

---

### Phase 5: Plan Compilation (2-5ms)

**Goal:** Transform semantic YAML plan into executable steps with concrete selectors.

```javascript
// automation/plan-compiler.mjs:15-80
export function compilePlan(yamlPlan, config) {
  const parsed = YAML.parse(yamlPlan);
  const executableSteps = [];

  for (const step of parsed.steps) {
    switch (step.action) {
      case "fill_field":
        // Map role → selector from config
        const selector = config.selectors[step.field_role];
        const value = config.values[step.field_role];

        executableSteps.push({
          action: "fill",
          selector: selector,
          value: value
        });
        break;

      case "go":
        // Map semantic target → actual URL
        const url = resolveUrl(step.target, config);

        executableSteps.push({
          action: "goto",
          url: url,
          waitUntil: "domcontentloaded"
        });
        break;

      // ... etc
    }
  }

  // Apply optimizations
  return batchDOMOperations(executableSteps);
}
```

**Optimizations Applied:**

1. **DOM Operation Batching** (plan-compiler.mjs:119-164)
   ```javascript
   // Detect consecutive fills + click
   // Before:
   [
     { action: "fill", selector: "input[name='email']", value: "user@example.com" },
     { action: "fill", selector: "input[name='password']", value: "pass123" },
     { action: "click", selector: "button[type='submit']" }
   ]

   // After:
   [
     {
       action: "batch",
       operations: [
         { type: "fill", selector: "input[name='email']", value: "user@example.com" },
         { type: "fill", selector: "input[name='password']", value: "pass123" },
         { type: "click", selector: "button[type='submit']" }
       ]
     }
   ]
   ```

   **Benefit:** 3 CDP round-trips → 1 round-trip (~100ms savings)

2. **Wait Strategy Selection**
   ```javascript
   // All navigation steps use domcontentloaded
   { action: "goto", url: "...", waitUntil: "domcontentloaded" }
   ```

   **Benefit:** 500ms per navigation vs networkidle

**File:** `automation/plan-compiler.mjs:1-164`
**Duration:** 2-5ms (YAML parse + transformation)

---

### Phase 6: Browser Connection (18ms)

```javascript
// automation/sal-cli.mjs:60-70
const browser = await chromium.connectOverCDP(
  process.env.LIGHTPANDA_CDP_URL
);
// ws://lightpanda:9222

const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();
```

**Protocol:** Chrome DevTools Protocol (CDP) over WebSocket
**Handshake:** TCP connection + CDP session initialization
**Persistent:** Could be pooled (ROADMAP item P1.8)

**File:** `automation/sal-cli.mjs:60-70`
**Duration:** 18ms (includes Docker bridge network latency)

---

### Phase 7: Step Execution (693ms average)

**Goal:** Execute compiled steps against live browser.

#### Step Type: `goto` (Navigation)
```javascript
// automation/sal-cli.mjs:88-95
case "goto": {
  const url = envReplace(step.url);
  console.log(`[${stepNum}/${totalSteps}] goto → ${url}`);

  await page.goto(url, {
    waitUntil: "domcontentloaded"  // Key optimization
  });

  console.log(`  → Current URL: ${page.url()}`);
  break;
}
```

**Wait Strategy Comparison:**
- `networkidle`: Waits for 500ms idle + all resources (~800ms per navigation)
- `domcontentloaded`: Waits for DOM ready (~250ms per navigation)

**Typical Flow:** 2 navigations (login page + items page) = 500ms total

#### Step Type: `batch` (Optimized Form Fill)
```javascript
// automation/sal-cli.mjs:106-157
case "batch": {
  const fills = step.operations.filter(op => op.type === "fill");
  const clicks = step.operations.filter(op => op.type === "click");

  console.log(`[${stepNum}/${totalSteps}] batch → ${fills.length} fills + ${clicks.length} clicks`);

  // Execute all fills in single evaluate() call
  if (fills.length > 0) {
    await page.evaluate((ops) => {
      for (const op of ops) {
        const el = document.querySelector(op.selector);
        if (el) el.value = op.value;
      }
    }, fills);
  }

  // Execute clicks (trigger proper events)
  for (const click of clicks) {
    await page.click(click.selector);
    await page.waitForLoadState("domcontentloaded");
  }

  break;
}
```

**Benefit:** Eliminates CDP round-trip overhead
**Before:** 50ms (fill) + 50ms (fill) + 100ms (click) = 200ms
**After:** 50ms (evaluate) + 100ms (click) = 150ms
**Savings:** 50ms per form submission

#### Step Type: `extract_list` (Data Extraction)
```javascript
// automation/sal-cli.mjs:165-190
case "extract_list": {
  const selector = envReplace(step.selector);
  const limit = step.limit || Infinity;

  console.log(`[${stepNum}/${totalSteps}] extract_list → ${selector} (limit: ${limit})`);

  const items = await page.evaluate(({ sel, lim }) => {
    const elements = Array.from(document.querySelectorAll(sel));
    return elements.slice(0, lim).map(el => ({
      text: el.textContent.trim(),
      attrs: Object.fromEntries(
        Array.from(el.attributes).map(a => [a.name, a.value])
      )
    }));
  }, { sel: selector, lim: limit });

  console.log(`  → Extracted ${items.length} items`);
  return items;
}
```

**Duration:** 20-50ms (DOM query + serialization)

**Total Execution Breakdown (Typical Login + Extract):**
```
goto /login           → 250ms (domcontentloaded)
batch (fill + click)  → 150ms (batched + click navigation)
goto /items           → 250ms (domcontentloaded)
extract_list          → 43ms  (DOM query)
────────────────────────────
Total:                  693ms
```

**File:** `automation/sal-cli.mjs:70-200`
**Duration:** 693ms (average, varies by network/DOM complexity)

---

### Phase 8: Result Return & Cleanup (5-10ms)

```javascript
// automation/sal-cli.mjs:250-270
console.log("\n[SAL] Results:");
console.log(JSON.stringify(results, null, 2));

console.log(`\nTIMING: total=${totalTime}s embed=${embedTime}ms lookup=${lookupTime}ms plan=${planTime}ms compile=${compileTime}ms connect=${connectTime}ms exec=${execTime}ms`);

await browser.close(); // Close CDP connection
process.exit(0);
```

**Output Format:**
```json
{
  "count": 2,
  "items": [
    { "text": "Pixel Bladenew", "attrs": { "data-sku": "PX-001" } },
    { "text": "Retro Shieldhot", "attrs": { "data-sku": "RS-002" } }
  ]
}
```

**Timing Breakdown:**
```
TIMING: total=0.75s embed=2ms lookup=4ms plan=0ms compile=0ms connect=18ms exec=693ms
```

**Duration:** 5-10ms (JSON serialization + browser cleanup)

---

## Performance Critical Paths

### Hot Path (Cache Hit - 0.75s)
```
Embed (L2 cache)     →    2ms  (0.3%)
Lookup (DuckDB)      →    4ms  (0.5%)
Plan (cached)        →    0ms  (0.0%)
Compile              →    2ms  (0.3%)
Connect              →   18ms  (2.4%)
Execute              →  693ms  (92.4%)  ← PRIMARY BOTTLENECK
────────────────────────────────────
Total                →  750ms  (100%)
```

**Optimization Opportunity:** Execution phase (693ms) dominates
**Already Optimized:** domcontentloaded (-1555ms), batching (-100ms)
**Future Optimizations:** Resource blocking (-300ms), CDP pooling (-10ms)

### Cold Path (Cache Miss - 1.5-2s)
```
Embed (local model)  →  350ms  (23%)
Lookup (DuckDB)      →    4ms  (0.3%)
Plan (generate)      →  800ms  (53%)  ← SECONDARY BOTTLENECK
Compile              →    2ms  (0.1%)
Connect              →   18ms  (1.2%)
Execute              →  693ms  (46%)
────────────────────────────────────
Total                → 1500ms  (100%)
```

**Occurs:** First run for new workflow type
**Frequency:** Low (5% of runs in production)
**After First Run:** Cached forever (until DB cleared)

---

## Error Handling & Circuit Breakers

### Embedding Fallback Chain
```
DMR Embeddings (pooling error)
    ↓ (circuit breaker opens)
Local Transformers.js (works)
    ↓ (model load failure)
Disable embeddings, skip plan cache
    ↓
Use heuristic planning only
```

### Plan Generation Fallback
```
LLM Intent Classification
    ↓ (DMR unavailable)
Heuristic Regex Patterns
    ↓ (no pattern match)
Return error with suggestion
```

### Browser Connection Fallback
```
Connect to Lightpanda
    ↓ (connection refused)
Retry 3 times with backoff
    ↓ (still failing)
Exit with error
```

---

## Data Flow Summary

```
┌──────────────────────────────────────────────────────────────┐
│ Input: "Log into the app and extract the first 2 items"     │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Embedding: [0.123, -0.456, ..., 0.789] (384 floats)         │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Cached Plan (YAML):                                          │
│   steps:                                                     │
│     - action: go                                             │
│       target: login page                                     │
│     - action: fill_field                                     │
│       field_role: email                                      │
│     ...                                                      │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Compiled Steps:                                              │
│   [                                                          │
│     { action: "goto", url: "http://demo:3000/login" },      │
│     { action: "batch", operations: [...] },                 │
│     { action: "goto", url: "http://demo:3000/items" },      │
│     { action: "extract_list", selector: "#items-list li" }  │
│   ]                                                          │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Browser Actions:                                             │
│   → Navigate to login page                                   │
│   → Fill email + password, click submit (batched)           │
│   → Navigate to items page                                   │
│   → Query DOM for items                                      │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Output (JSON):                                               │
│ {                                                            │
│   "count": 2,                                                │
│   "items": [                                                 │
│     { "text": "Pixel Bladenew", ... },                       │
│     { "text": "Retro Shieldhot", ... }                       │
│   ]                                                          │
│ }                                                            │
└──────────────────────────────────────────────────────────────┘
```

---

## Files & Responsibilities

| File | Responsibility | Key Functions |
|------|----------------|---------------|
| `sal-cli.mjs` | Main orchestrator | `main()`, `executeStep()` |
| `embeddings.mjs` | 4-layer embedding cache | `embedPrompt()`, `embedWithDMR()`, `embedWithLocalModel()` |
| `plan-cache.mjs` | DuckDB persistence | `savePlan()`, `findBestPlanByEmbedding()`, `getCachedEmbedding()` |
| `intent-classifier.mjs` | LLM intent extraction | `classifyIntent()` |
| `planner.mjs` | Template selection | `generatePlan()`, `selectTemplate()` |
| `plan-templates.mjs` | YAML templates | `loginAndExtractTemplate()`, etc. |
| `plan-compiler.mjs` | YAML → executable | `compilePlan()`, `batchDOMOperations()` |

---

## Debugging Tips

### Enable Verbose Logging
```bash
# Set in .env
NODE_ENV=development

# You'll see:
[SAL] Embedding cache HIT (DuckDB)
[SAL] Plan cache HIT (similarity: 1.000)
[1/6] goto → http://demo:3000/login
  → Current URL: http://demo:3000/login
[2/6] batch → 2 fills + 1 clicks
...
```

### Profile Performance
```bash
# Add timing instrumentation
docker compose exec automation node --inspect sal-cli.mjs "..."

# Or use built-in TIMING output:
TIMING: total=0.75s embed=2ms lookup=4ms plan=0ms compile=0ms connect=18ms exec=693ms
```

### Clear Caches
```bash
# Clear all caches (force cold start)
docker compose exec automation rm -f plan-cache.duckdb

# Next run will regenerate all embeddings and plans
```

### Inspect Cached Plans
```bash
docker compose exec automation node -e "
const { initPlanCache, getAllPlans } = require('./plan-cache.mjs');
await initPlanCache();
const plans = await getAllPlans();
console.log(JSON.stringify(plans, null, 2));
"
```

---

## Next Steps for Contributors

1. **Read:** [ARCHITECTURE.md](ARCHITECTURE.md) for design rationale
2. **Review:** [PERFORMANCE.md](PERFORMANCE.md) for optimization details
3. **Check:** [ROADMAP.md](ROADMAP.md) for contribution opportunities
4. **Test:** Run `npm test` to see execution flow in action

---

*Last Updated: 2025-12-30*
