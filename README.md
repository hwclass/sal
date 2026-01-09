# SAL - Semantic Automation Layer

> Understanding happens once. Execution happens fast.

**SAL** is a semantic browser automation framework that caches understanding, not scripts. It sits between rigid script-based tools and AI agents, optimized for repeatable workflows with natural language interfaces.

```
Natural Language → Semantic Planning → Cached Intent → Fast Execution
```

[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/node.js-22-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🚀 Quick Start

```bash
# 1. Start all services
docker compose up -d

# 2. Run your first automation
docker compose exec automation npm run sal -- "Log into the app and extract the first 2 items"

# Expected output (with cache):
# TIMING: total=0.75s embed=2ms lookup=4ms exec=693ms
```

That's it! SAL just:
1. Understood your intent ("log in and extract")
2. Generated a semantic plan
3. Cached it for future runs
4. Executed in **0.75 seconds**

### Runtime Defaults (so you know what is and isn’t bundled)
- Control layer: Playwright API connecting over CDP to Lightpanda (`LIGHTPANDA_CDP_URL`); no bundled Chromium launch.
- LLMs: DMR is optional; if absent or unhealthy, intent falls back to regex rules. Embeddings try DMR if configured, otherwise use local Transformers.js.
- Cache: DuckDB on disk (default `plan-cache.duckdb`, override with `PLAN_CACHE_PATH`); selectors/URLs come from `.env`.
- Sessions: cookies cached for 1 hour by default to skip repeated logins.

---

## 💡 The Problem

Most browser automation today forces you to choose:

| Approach | Good For | Problem |
|----------|----------|---------|
| **Scripts** (Playwright/Puppeteer) | Known flows, stable selectors | Brittle, hard to reuse, no semantic understanding |
| **AI Agents** (GPT/Claude) | Discovery, reasoning | Slow, expensive, re-reasons every time |

**SAL bridges the gap:** Semantic understanding + cached execution = fast, reusable automation.

---

## 🎯 How It Works: Prompt → Execution

### The Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  "Log into the app and extract the first 2 items"              │
│  Natural Language Input                                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Intent Classification (SmolLM2-360M via DMR, regex fallback)   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ { requires_login: true, action: "extract",               │  │
│  │   target: "items", limit: 2 }                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Time: ~100-300ms (DMR) | ~0ms (regex fallback)                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Semantic Planning (Template-Based)                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ steps:                                                    │  │
│  │   - go: login page                                        │  │
│  │   - fill: email, password                                 │  │
│  │   - click: submit                                         │  │
│  │   - go: items page                                        │  │
│  │   - extract: items (limit: 2)                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Time: ~1000ms (first run) | 0ms (cached)                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  4-Layer Semantic Cache (DuckDB + Transformers.js)              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 1: In-Memory Map      →  0.001ms                   │  │
│  │ Layer 2: DuckDB Persistent  →  2-5ms    ✓ HIT           │  │
│  │ Layer 3: DMR Remote         →  10-20ms                   │  │
│  │ Layer 4: Local Transformers →  350ms                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Embedding: all-MiniLM-L6-v2 (384-dim)                          │
│  Similarity threshold: 0.9 (cosine)                             │
│  Time: 2ms (cached) | 350ms (cold)                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Fast Browser Execution (Playwright API → Lightpanda via CDP)   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. goto /login              → 250ms (domcontentloaded)   │  │
│  │ 2. batch(fill email+pass)   → 50ms  (optimized)          │  │
│  │ 3. click submit             → 100ms (navigation)          │  │
│  │ 4. goto /items              → 250ms (domcontentloaded)   │  │
│  │ 5. extract items            → 43ms  (DOM query)          │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Time: ~693ms                                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Result                                                          │
│  [                                                               │
│    { text: "Pixel Blade", sku: "PX-001" },                     │
│    { text: "Retro Shield", sku: "RS-002" }                     │
│  ]                                                               │
│  Total: 0.75s (71% faster than baseline)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Key Insight

**Traditional automation:** Re-script for every variation
**AI agents:** Re-reason for every execution
**SAL:** Understand once, cache semantically, execute fast

---

## 📊 Performance Benchmarks

### Head-to-Head Comparison

| Framework | Execution Time | vs SAL | Use Case |
|-----------|---------------|---------|----------|
| **Puppeteer** | 16.0s | 21× slower | Legacy automation |
| **Playwright** | 1.0s | 1.3× slower | E2E testing |
| **SAL (cached)** | **0.75s** | **Baseline** | Semantic workflows |

### Optimization Breakdown

| Component | Before | After | Improvement |
|-----------|--------|-------|-------------|
| **Total Time** | 2.61s | 0.75s | **71% faster** |
| **Embedding Cache** | 350ms | 2ms | **175× speedup** |
| **Execution** | 2238ms | 693ms | **69% reduction** |
| **Plan Lookup** | N/A | 4ms | **Instant reuse** |

### At Scale (1000 daily runs)

- **Puppeteer:** 4.4 hours/day → 1606 hours/year
- **Playwright:** 17 minutes/day → 103 hours/year
- **SAL:** 12.5 minutes/day → **76 hours/year** ✨

**Savings:** 25.7 hours annually vs baseline, pure architectural optimization.

---

## 🏗️ Architecture

### Four Core Optimizations

#### 1. **Four-Layer Embedding Cache**
```
In-Memory (0.001ms) → DuckDB (2-5ms) → DMR (10-20ms) → Local (350ms)
```
- **DuckDB:** ACID-compliant persistent cache
- **Transformers.js:** Local embeddings (all-MiniLM-L6-v2, 384-dim)
- **Circuit breaker:** Automatic fallback on remote failure
- **Result:** 1983× speedup for repeated operations

#### 2. **Context-Aware Wait Strategies**
```
Traditional: networkidle (wait for ALL resources)
SAL:         domcontentloaded (DOM structure only)
```
- Skips CSS, images, fonts for headless extraction
- **Result:** 69% reduction in execution time (-1555ms)

#### 3. **Compile-Time DOM Batching**
```
Before: fill(email) → CDP call → fill(password) → CDP call
After:  batch([fill(email), fill(password)]) → single CDP call
```
- **Result:** 50% reduction in form submission overhead

#### 4. **Circuit Breaker Pattern**
```
DMR available? → Use DMR
DMR down?      → Fall back to local model (Transformers.js)
```
- Capability detection prevents retry storms
- **Result:** Eliminates 15-20ms overhead after detection

---

## 🛠️ Tech Stack

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│  Natural Language Interface                             │
├─────────────────────────────────────────────────────────┤
│  ⚡ Intent Classifier: SmolLM2-360M (DMR, regex fallback) │
│  📋 Plan Templates: YAML-based conceptual steps          │
│  🧠 Embeddings: Transformers.js (all-MiniLM-L6-v2, DMR optional) │
├─────────────────────────────────────────────────────────┤
│  💾 Semantic Cache: DuckDB (embedded OLAP)             │
│  🔄 Persistence: ACID-compliant SQL + embeddings       │
├─────────────────────────────────────────────────────────┤
│  🌐 Browser: Lightpanda (Zig-based, CDP endpoint)      │
│  🎭 Automation API: Playwright (CDP control layer)     │
├─────────────────────────────────────────────────────────┤
│  🐳 Runtime: Node.js 22 + Docker Compose               │
└─────────────────────────────────────────────────────────┘
```

### Dependencies

- **DuckDB** (v1.1.0) - Embedded analytics database
- **Transformers.js** (v2.17.2) - Local ML inference
- **Playwright** (v1.49.0) - Browser automation API
- **Lightpanda** - Zig-based headless browser
- **Docker Model Runner** - LLM inference (optional)

---

## 📚 Usage Examples

### Basic Automation

```bash
# Login and extract
docker compose exec automation npm run sal -- \
  "Log into the app and extract the first 2 items"

# Extract without login
docker compose exec automation npm run sal -- \
  "Extract all items from the items page"

# With limit
docker compose exec automation npm run sal -- \
  "Get the first 5 products"
```

### Benchmarking

```bash
# Compare against Puppeteer
docker compose exec automation npm run puppeteer
# Result: ~16 seconds

# Compare against Playwright
docker compose exec automation npm run playwright
# Result: ~1 second

# Run SAL
docker compose exec automation npm run sal -- "Log into app and extract items"
# Result: ~0.75 seconds (cached)
```

### Understanding Cache Behavior

**First run (cold cache):**
```
TIMING: total=1.50s embed=350ms plan=800ms exec=693ms
[SAL] Plan saved to cache
```

**Second run (cache hit):**
```
TIMING: total=0.75s embed=2ms plan=0ms exec=693ms
[SAL] Plan cache HIT (similarity: 0.987)
```

**Similar prompt (semantic match):**
```
Prompt: "Sign in and get the first three entries"
[SAL] Plan cache HIT (similarity: 0.945)
```

---

## 🗂️ Project Structure

```
sal-demo/
├── automation/              # Core automation engine
│   ├── sal-cli.mjs         # Main CLI entry point
│   ├── intent-classifier.mjs  # Intent detection (SmolLM2)
│   ├── planner.mjs         # Natural language → conceptual plan
│   ├── plan-templates.mjs  # YAML template library
│   ├── plan-compiler.mjs   # Conceptual → executable steps
│   ├── embeddings.mjs      # 4-layer embedding cache
│   ├── plan-cache.mjs      # DuckDB semantic cache
│   ├── benchmarks.mjs      # Performance benchmarks
│   ├── puppeteer-demo.mjs  # Puppeteer comparison
│   └── playwright-demo.mjs # Playwright comparison
│
├── demo/                    # Demo web application
│   ├── server.mjs          # Express.js test server
│   └── public/             # Static assets
│
├── ui/                      # Real-time monitoring UI
│   ├── server.mjs          # Hono + SSE server
│   └── components/         # Enhance SSR components
│
├── docs/                    # Documentation
│   ├── ARCHITECTURE.md     # Technical deep-dive
│   ├── PERFORMANCE.md      # Optimization guide
│   ├── EXECUTION-FLOW.md   # Step-by-step execution
│   ├── USAGE-EXAMPLES.md   # Prompt patterns
│   ├── ROADMAP.md          # Future plans
│   └── README.md           # Documentation hub
│
├── docker-compose.yml       # Service orchestration
├── .env                     # Environment configuration
└── README.md               # This file
```

---

## 🎯 Use Cases

### ✅ Ideal For

- **Headless data extraction** - Fast, repeatable workflows
- **Semantic automation** - Natural language interfaces
- **CI/CD pipelines** - Sub-second execution for cached flows
- **Team collaboration** - Shared semantic plan cache
- **AI agent infrastructure** - Fast execution layer for agents

### ❌ Not Designed For

- **Visual regression testing** - Use Playwright/Puppeteer
- **Screenshot capture** - Requires full rendering
- **Cross-browser compatibility** - Single engine focus
- **One-off exploratory tasks** - Use AI agents directly
- **Complex multi-page flows** - Currently optimized for 2-3 page workflows

---

## 🔧 Configuration

### Environment Variables

```bash
# Application URLs
TARGET_BASE_URL=http://demo:3000
LOGIN_PATH=/login
ITEMS_PATH=/items

# Selectors
LOGIN_EMAIL_SELECTOR=input[name="email"]
LOGIN_PASSWORD_SELECTOR=input[name="password"]
LOGIN_SUBMIT_SELECTOR=button[type="submit"]
ITEMS_SELECTOR=#items-list li

# Credentials (demo only)
USER_EMAIL=dummy@example.com
USER_PASS=password123

# LLM Configuration
DMR_URL=http://host.docker.internal:12434/engines/llama.cpp/v1/chat/completions
DMR_MODEL=ai/smollm2
PLANNING_MODE=intent  # Options: intent, hybrid, llm, heuristic

# Cache Configuration
PLAN_SIM_THRESHOLD=0.9  # Semantic similarity threshold (0-1)
PLAN_CACHE_PATH=/automation/plan-cache.duckdb  # Optional: external DuckDB path for shared/persistent cache

# Browser Configuration
LIGHTPANDA_CDP_URL=ws://lightpanda:9222
CDP_POOL_SIZE=1  # Size of Playwright-over-CDP connection pool (for parallel runs)

# Job Service (optional)
JOB_SERVICE_PORT=8787
JOB_SERVICE_TOKEN= # set to require Bearer token auth
JOB_CONCURRENCY=1  # defaults to CDP_POOL_SIZE
```

### Customizing for Your App

See [docs/USAGE-EXAMPLES.md](docs/USAGE-EXAMPLES.md#customization-guide) for detailed setup instructions.

---

## 📖 Documentation

### Quick Links

- **[Architecture Reference](docs/ARCHITECTURE.md)** - Technical deep-dive and design decisions
- **[Performance Guide](docs/PERFORMANCE.md)** - Optimization strategies and benchmarks
- **[Execution Flow](docs/EXECUTION-FLOW.md)** - Step-by-step breakdown with timing
- **[Usage Examples](docs/USAGE-EXAMPLES.md)** - Prompt patterns and real-world use cases
- **[Roadmap](docs/ROADMAP.md)** - Future plans and contribution opportunities

### By Audience

| Role | Start Here |
|------|------------|
| **End User** | [USAGE-EXAMPLES.md](docs/USAGE-EXAMPLES.md) |
| **Contributor** | [EXECUTION-FLOW.md](docs/EXECUTION-FLOW.md) |
| **Architect** | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **Performance Engineer** | [PERFORMANCE.md](docs/PERFORMANCE.md) |

---

## 🚢 Deployment

### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/sal-demo.git
cd sal-demo

# Start all services
docker compose up -d

# Optional: run the job service (queue + basic UI)
docker compose exec automation npm run service
# UI: http://localhost:8787/ui  | API: GET/POST http://localhost:8787/jobs
# Metrics: http://localhost:8787/metrics
# Or start via compose profile:
# docker compose --profile jobs up -d job-service

# Check status
docker compose ps

# View logs
docker compose logs -f automation
```

### Production Considerations

- **Cache Persistence:** DuckDB files are stored in the container. Mount a volume for persistence.
- **DMR Configuration (optional):** Requires `LLAMA_ARG_POOLING=mean` on host; if absent, intent extraction falls back to regex and embeddings use local Transformers.js.
- **Session Management:** Sessions expire after 1 hour by default (configurable).
- **Monitoring:** Access real-time UI at `http://localhost:4000`
- **Job Service:** Simple queue + UI at `http://localhost:8787/ui` (API at `/jobs`, metrics at `/metrics`). Set `JOB_SERVICE_TOKEN` to require Bearer auth. Respects `PLAN_CACHE_PATH` for shared cache across runs.

### Real-Site Demo Checklist
- Define per-site selectors/URLs in environment (LOGIN_*_SELECTOR, ITEMS_SELECTOR, *_URL/PATH).
- Warm the plan/embedding cache with a first run; then rerun to show cache hit timings.
- Use job service to queue multiple prompts and observe metrics (cache hits, timing) for Lightpanda showcase.
- Capture before/after timings (cold vs warm, DMR vs local) for stakeholders.

#### Per-Site Selector Config Example
```
TARGET_BASE_URL=https://example.com
LOGIN_PATH=/auth/login
ITEMS_PATH=/products
LOGIN_EMAIL_SELECTOR=input[name="email"]
LOGIN_PASSWORD_SELECTOR=input[name="password"]
LOGIN_SUBMIT_SELECTOR=button[type="submit"]
ITEMS_SELECTOR=.product-list .product-card
```
Set these in `.env` or pass as overrides to the job service (`env` field in POST /jobs).

---

## 🤝 Contributing

This is an experimental project demonstrating architectural patterns for semantic browser automation. Contributions are welcome!

### Areas for Contribution

1. **Performance:** Further optimization of execution layer
2. **Caching:** Improved semantic similarity algorithms
3. **Templates:** Additional plan templates for common workflows
4. **Testing:** Comprehensive test suite
5. **Documentation:** Tutorials, guides, and examples

See [ROADMAP.md](docs/ROADMAP.md) for planned improvements.

---

## 📝 Philosophy

> The mistake isn't choosing Playwright or agents—it's using them for problems they weren't designed to solve.

**Different jobs deserve different tools:**

- **Scripts** (Playwright/Puppeteer): Known flows, stable selectors, deterministic assertions
- **SAL**: Semantic workflows, repeatable patterns, cached intent
- **Agents** (Claude/GPT): Discovery, reasoning, ambiguous environments

SAL is not a replacement—it's a **middle layer** optimized for the gap between scripts and agents.

---

## 📜 License

[License information to be added]

---

## 🔗 Links

- **Blog Post:** [SAL: Rethinking Browser Automation](https://www.linkedin.com/pulse/sal-rethinking-browser-automation-cache-scripts-bar%C4%B1%C5%9F-g%C3%BCler-bkiof)
- **Documentation:** [docs/README.md](docs/README.md)
- **Issues:** [GitHub Issues](https://github.com/yourusername/sal-demo/issues)

---

<p align="center">
  <b>SAL (Semantic Automation Layer)</b><br>
  Understanding happens once. Execution happens fast.
</p>

<p align="center">
  Built with ❤️ for the automation community
</p>
