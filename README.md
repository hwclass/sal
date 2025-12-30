# SAL Documentation

**SAL (Semantic Automation Layer)** - Semantic browser automation that caches understanding, not scripts.

---

## Documentation Overview

This directory contains comprehensive documentation for the SAL browser automation framework.

### 📄 Available Documents

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical Reference
   - Complete architectural analysis
   - Four key optimizations explained in detail
   - Comparative performance benchmarks (Puppeteer, Playwright, LPX)
   - Implementation patterns and trade-offs
   - Future optimization opportunities
   - **Audience:** Software architects, senior engineers

2. **[PERFORMANCE.md](PERFORMANCE.md)** - Optimization Plan & Results
   - Performance budget tracking
   - Detailed optimization implementations
   - Baseline vs current metrics (2.61s → 0.75s)
   - Measurement protocols
   - Success criteria and production results
   - **Audience:** Performance engineers, implementers

3. **[ROADMAP.md](ROADMAP.md)** - Project Roadmap & TODOs
   - Short-term priorities
   - Mid-term improvements
   - Long-term vision
   - Known issues and planned fixes
   - **Audience:** Contributors, project planners

4. **[DMR-STATUS.md](DMR-STATUS.md)** - Docker Model Runner Configuration
   - Current DMR setup and usage
   - Known pooling compatibility issue
   - Performance impact analysis
   - Fallback behavior explanation
   - **Audience:** Operators, troubleshooters

5. **[EXECUTION-FLOW.md](EXECUTION-FLOW.md)** - Technical Execution Deep-Dive
   - Step-by-step execution flow from prompt to result
   - Phase-by-phase breakdown with timing
   - Data transformations at each stage
   - Error handling and circuit breakers
   - Debugging tips and profiling guidance
   - **Audience:** Contributors, implementers, advanced users

6. **[USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)** - Natural Language Prompt Guide
   - Basic and advanced prompt examples
   - Prompt patterns and variations
   - Real-world use cases (e-commerce, SaaS, internal tools)
   - Cache behavior examples
   - Customization guide for your own apps
   - Troubleshooting tips
   - **Audience:** End users, integration developers

---

## Quick Start

### What is LPX?

SAL is a semantic browser automation framework that sits between script-based tools (Playwright, Puppeteer) and AI agents. Instead of:
- **Scripting every step** (brittle, hard to reuse)
- **Re-reasoning every task** (slow, expensive)

SAL introduces **semantic planning with cached intent**:

```
Natural Language → Conceptual Plan → Semantic Cache → Fast Execution
```

### Core Concept

**Understanding happens once. Execution happens fast.**

1. User provides natural language task
2. System produces conceptual plan (not raw steps)
3. Plan stored semantically (DuckDB + embeddings)
4. Future runs reuse plan instantly (~0.75s end-to-end)
5. Execution delegates to fast, machine-first browser

---

## Performance Highlights

### Comparative Benchmarks

| Framework | Time | Relative Performance |
|-----------|------|---------------------|
| **Puppeteer** | 16.0s | 21× slower |
| **Playwright** | 1.0s | 1.3× slower |
| **LPX (optimized)** | **0.75s** | **Baseline** |

### Key Metrics

- **Total Time:** 2.61s → 0.75s (**71% improvement**)
- **Execution Time:** 2238ms → 693ms (**69% reduction**)
- **Embedding Cache:** 350ms → 2ms (**175× speedup**)
- **Plan Cache Hit Rate:** 100% (after warm-up)

---

## Technical Stack

**Storage & Caching:**
- DuckDB (embedded analytics database)
- 4-layer embedding cache hierarchy

**AI/ML:**
- Docker Model Runner (DMR) - Primary LLM backend (SmolLM2-360M)
- Transformers.js (local embedding fallback - all-MiniLM-L6-v2, 384-dim)
- Graceful degradation: DMR → Local model

**Browser Control:**
- Lightpanda (Zig-based headless browser)
- Playwright API (automation interface)
- Chrome DevTools Protocol (CDP)

**Runtime:**
- Node.js 22 (ESM modules)
- Docker Compose (containerized deployment)

---

## Four Architectural Optimizations

### 1. Four-Layer Embedding Cache
- **In-Memory Map** → 0.001ms (process scope)
- **DuckDB** → 2-5ms (persistent, cross-process)
- **DMR (Docker Model Runner)** → 10-20ms (if available, currently has pooling compatibility issue)
- **Local Model (Transformers.js)** → 350ms (fallback, currently active)

**Result:** 1983× speedup for repeated operations

**Note:** Current setup uses local Transformers.js for embeddings due to DMR pooling configuration requirement. See [ROADMAP.md](ROADMAP.md) for DMR embedding fix status.

### 2. Context-Aware Wait Strategies
- Traditional: `networkidle` (waits for all resources)
- SAL: `domcontentloaded` (DOM structure only)

**Result:** 69% reduction in execution time (-1555ms)

### 3. Compile-Time DOM Batching
- Detect consecutive operations at plan compilation
- Execute in single CDP call to reduce round-trips

**Result:** 50% reduction in form submission overhead

### 4. Circuit Breaker Pattern
- Capability detection prevents retry storms
- Graceful degradation (remote → local model)

**Result:** Eliminates 15-20ms overhead after detection

---

## Use Cases

### ✅ Ideal For

- **Headless data extraction** - Fast, repeatable workflows
- **Semantic automation** - Natural language → browser actions
- **CI/CD pipelines** - Sub-second execution for cached flows
- **Team collaboration** - Shared semantic plan cache
- **AI + web interaction** - Infrastructure layer for agents

### ❌ Not Designed For

- **Visual regression testing** - Use Playwright/Puppeteer
- **Screenshot capture** - Requires full page rendering
- **Cross-browser compatibility** - Single engine focus
- **One-off exploratory tasks** - Use AI agents directly

---

## At Scale Impact

**For 1000 daily runs:**
- Puppeteer: 4.4 hours/day
- Playwright: 17 minutes/day
- **SAL: 12.5 minutes/day** (28% faster than Playwright)

**Annual savings:** 25.7 hours of compute time - pure architectural optimization with zero infrastructure cost.

---

## Philosophy

**The mistake isn't choosing Playwright or agents—it's using them for problems they weren't designed to solve.**

Different jobs deserve different tools:
- **Scripts (Playwright/Puppeteer):** Known flows, stable selectors, deterministic assertions
- **SAL:** Semantic workflows, repeatable patterns, cached intent
- **Agents (Claude/GPT):** Discovery, reasoning, ambiguous environments, one-off tasks

SAL is not a replacement for either—it's a **middle layer** optimized for semantic automation.

---

## Getting Started

### Running the Demo

```bash
# Start services
docker compose up -d

# Run automation (natural language)
docker compose exec automation node sal-cli.mjs "Log into the app and extract the first 2 items"

# Expected output (cached):
# TIMING: total=0.75s embed=2ms lookup=4ms plan=0ms compile=0ms connect=18ms exec=693ms
```

### Benchmarking

```bash
# Puppeteer benchmark
docker compose exec automation npm run puppeteer

# Playwright benchmark
docker compose exec automation npm run playwright

# SAL (optimized)
docker compose exec automation node sal-cli.mjs "Log into the app and extract the items list"
```

---

## Project Structure

```
sal-demo/
├── automation/           # Core automation engine
│   ├── sal-cli.mjs      # Main execution engine
│   ├── embeddings.mjs   # 4-layer embedding cache
│   ├── plan-cache.mjs   # DuckDB semantic cache
│   ├── planner.mjs      # Natural language → plan
│   ├── plan-compiler.mjs # Plan → executable steps
│   └── intent-classifier.mjs # Intent detection
├── demo/                # Demo web server
│   └── server.mjs       # Express.js test app
├── docs/                # Documentation
│   ├── ARCHITECTURE.md  # Technical reference
│   ├── PERFORMANCE.md   # Optimization details
│   └── ROADMAP.md       # Project roadmap & TODOs
└── docker-compose.yml   # Container orchestration
```

---

## Contributing

This is currently an experimental project demonstrating architectural patterns for semantic browser automation. The techniques are general-purpose and applicable to similar automation frameworks.

See [ROADMAP.md](ROADMAP.md) for planned improvements and contribution opportunities.

---

## License

[License information to be added]

---

## Further Reading

- [Architecture Reference](ARCHITECTURE.md) - Deep dive into system design
- [Performance Optimization](PERFORMANCE.md) - Detailed implementation guide
- [Project Roadmap](ROADMAP.md) - Future plans and TODOs

---

*SAL (Semantic Automation Layer) - Infrastructure for AI + web interaction*
