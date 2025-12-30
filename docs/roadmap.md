# SAL Roadmap & TODOs

This document outlines planned improvements, known issues, and future direction for SAL (Semantic Automation Layer).

---

## Current Status (v0.1)

**Achievement:** 71% performance improvement (2.61s → 0.75s)

**Key Features:**
- ✅ 4-layer embedding cache (DuckDB persistence)
- ✅ Semantic plan caching (0.9 similarity threshold)
- ✅ Context-aware wait strategies (domcontentloaded)
- ✅ DOM operation batching
- ✅ Circuit breaker for external services
- ⏳ Session persistence (infrastructure ready, not tested)

**LLM Backend Configuration:**
- **Primary:** Docker Model Runner (DMR) configured at `http://host.docker.internal:12434`
- **Intent Classification:** Uses DMR (SmolLM2-360M) when available, falls back to heuristic
- **Embeddings:** Currently using local Transformers.js fallback (all-MiniLM-L6-v2)
  - DMR embeddings have pooling compatibility issue (see Short-Term Priorities)
  - Circuit breaker automatically falls back to local model
  - System works correctly with fallback (350ms → 2ms via DuckDB cache)

---

## Short-Term Priorities (Next 2-4 weeks)

### 🔴 Critical Fixes

#### Fix DMR Embedding Compatibility
**Status:** Known issue
**Impact:** High (external embedding service unusable)

**Problem:**
```
[SAL] Embedding request failed: 400 {"error":{"code":400,"message":"Pooling type 'none' is not OAI compatible"}}
```

**Root Cause:** DMR/Lightpanda embedding endpoint requires specific pooling configuration that current client doesn't support.

**Action Items:**
1. Contact Lightpanda or DMR host for exact embeddings payload schema
   - Confirm pooling field name and accepted values
   - Verify whether arrays vs strings are expected
   - Document supported embedding models and configurations
2. Add environment variable to cleanly bypass embeddings until fixed
   - Currently skips with warning, but should have explicit flag
   - Add `LPX_DISABLE_DMR_EMBEDDINGS=true` env var
   - Surface clear log message when DMR is disabled
3. Update embeddings.mjs to handle pooling parameter correctly
4. Add integration test for DMR embedding endpoint

**Files to Modify:**
- `automation/embeddings.mjs:43-87` - embedWithDMR function
- `automation/.env.example` - Document DMR configuration

---

### 🟡 Testing & Validation

#### Add Specific Item Extraction Test
**Status:** Planned
**Impact:** Medium (test coverage)

**Goal:** Verify extracted item titles match expected values from demo server.

**Implementation:**
```javascript
// In test-suite.mjs
{
  name: "Extract specific item title",
  prompt: "Log into the app and extract the first item's title",
  expectedItems: {
    count: 1,
    titles: ["Pixel Bladenew"] // Expected from demo server
  },
  timeout: 5000
}
```

**Action Items:**
1. Add title extraction to sal-cli.mjs output
2. Create new test case in test-suite.mjs
3. Validate against demo/server.mjs item data
4. Document expected vs actual comparison logic

**Files to Modify:**
- `automation/test-suite.mjs` - Add new test case
- `automation/sal-test.mjs` - Add title comparison logic

---

#### Performance Deep-Dive: Steps Execution Time
**Status:** Investigation needed
**Impact:** High (performance bottleneck)

**Problem:**
Steps execution takes 2+ seconds of a 3-second total runtime:
```
Process duration: 3sec
TIMING: total=3.00s plan=0.93s connect=0.04s steps=2.03s

Process duration: 3sec
TIMING: total=3.18s plan=0.89s connect=0.04s steps=2.25s
```

**Investigation Goals:**
1. Profile individual step execution times
   - Navigation steps (goto, click with navigation)
   - Form filling steps (fill, type)
   - Extraction steps (querySelector, evaluate)
2. Identify longest-running operation types
3. Measure CDP round-trip overhead per step
4. Compare domcontentloaded vs networkidle impact on steps

**Action Items:**
1. Add per-step timing instrumentation to sal-cli.mjs
2. Create performance profiling mode (`LPX_PROFILE=true`)
3. Log step-by-step breakdown in verbose mode
4. Identify optimization opportunities based on data
5. Document findings in PERFORMANCE.md

**Expected Findings:**
- Navigation waits (even with domcontentloaded)
- CDP protocol overhead
- DOM query latency
- Network conditions (Docker bridge)

**Potential Optimizations:**
- Parallel step execution (when safe)
- Preemptive page preloading
- CDP connection pooling (already planned)
- Resource blocking (already planned)

**Files to Modify:**
- `automation/sal-cli.mjs:70-200` - Add step timing
- `automation/sal-test.mjs` - Profile mode support

---

### 🔵 Strategic Analysis

#### Lightpanda vs Chromium: AI-Powered E2E Decision
**Status:** Analysis phase
**Impact:** High (architectural direction)

**Goal:** Evaluate whether Lightpanda is the right choice for AI-powered E2E testing or if we should switch to Chromium.

**Analysis Framework:**

**Pros of Lightpanda:**
- ✅ Fast startup (~20ms vs 5s for Chromium)
- ✅ Low memory footprint (50MB vs 200MB)
- ✅ Zig implementation (no GC pauses)
- ✅ Minimal resource usage (headless-first)
- ✅ CDP-native design

**Cons of Lightpanda:**
- ❌ Limited browser compatibility (not multi-engine)
- ❌ Smaller community and ecosystem
- ❌ Potential rendering differences vs real browsers
- ❌ Missing some CDP features (newCDPSession)
- ❌ Less mature than Chromium

**Evaluation Criteria:**
1. **Performance:** Measure actual speed difference for AI workflows
2. **Compatibility:** Test against real-world web apps
3. **Maintainability:** Assess ecosystem maturity
4. **Feature Completeness:** Document missing CDP features
5. **User Experience:** Can users trust results from non-standard engine?

**Action Items:**
1. Run same automation tests on Chromium via Playwright
2. Compare performance metrics (startup, execution, memory)
3. Document rendering differences (if any)
4. Survey AI testing use cases (what matters most?)
5. Create decision matrix with weighted criteria
6. Write vision document: "LPX Browser Engine Strategy"

**Deliverable:** `docs/BROWSER-ENGINE-DECISION.md` with recommendation

---

### 🔵 Documentation

#### Create TEST-FRAMEWORK.md
**Status:** Planned
**Impact:** Medium (community adoption)

**Goal:** Document minimal contract for SAL test framework extraction as standalone tool.

**Contents:**
1. **Framework Contract**
   - Prompt format requirements
   - Expected output schema
   - Environment variable requirements
   - Error handling contract

2. **Usage Examples**
   ```javascript
   {
     prompt: "Log in and verify dashboard",
     expectedItems: { count: 5 },
     timeout: 3000
   }
   ```

3. **Pricing Tiers** (future monetization)
   - **Free:** 100 test runs/month, community support
   - **Starter ($29/month):** 1000 runs/month, email support
   - **Enterprise ($299/month):** Unlimited runs, SLA, dedicated support

4. **Integration Guide**
   - How to embed SAL in existing test suites
   - CI/CD integration examples
   - Docker deployment patterns

**Action Items:**
1. Extract core testing logic into `sal-test-framework` package
2. Define stable API contract
3. Document integration points
4. Create pricing calculator
5. Write TEST-FRAMEWORK.md

**Files to Create:**
- `docs/TEST-FRAMEWORK.md` - Framework documentation
- `automation/framework/` - Extracted framework code

---

### 🔵 Architecture Investigation

#### CDP Dependency Analysis
**Status:** Investigation needed
**Impact:** High (architectural flexibility)

**Question:** Can we eliminate CDP dependency and run without Chromium/Playwright?

**Current Architecture:**
```
SAL → Playwright API → CDP → Browser Engine
```

**Potential Alternative:**
```
SAL → Native Browser API → Lightpanda
```

**Investigation Goals:**
1. Identify which CDP features we actually use
   - Page.navigate
   - Runtime.evaluate
   - DOM.querySelector
   - Input.dispatchMouseEvent
2. Check if Lightpanda has native API without CDP
3. Evaluate performance impact of removing CDP layer
4. Assess Playwright API value (retry logic, wait strategies, etc.)

**Trade-offs:**
- **Remove CDP:** Faster, simpler, less dependency
- **Keep CDP:** Standard protocol, more tools, ecosystem

**Action Items:**
1. Audit all CDP usage in sal-cli.mjs
2. Research Lightpanda native API capabilities
3. Prototype direct Lightpanda integration
4. Measure performance difference
5. Document findings and recommendation

**Deliverable:** `docs/CDP-ANALYSIS.md`

---

## Mid-Term Improvements (1-3 months)

### Planner Robustness
**Status:** Improvement needed
**Impact:** Medium (plan quality)

**Current Issue:** Planner sometimes generates HTML selectors instead of conceptual steps.

**Improvements:**
1. **Tighten Conceptual Prompt**
   - Add strict YAML example to system prompt
   - Add forbidden words list (HTML tags, "selector", "querySelector")
   - Emphasize semantic vs technical language

2. **Better Validation**
   - Detect and reject plans with HTML selectors
   - Add plan quality scoring
   - Log prominently when heuristic fallback is triggered

3. **Feedback Loop**
   - Track plan success rate
   - Automatically refine prompts based on failures
   - A/B test different prompt variations

**Action Items:**
1. Update planner.mjs system prompt
2. Add plan validation in plan-compiler.mjs
3. Implement quality scoring
4. Add telemetry for plan success tracking

**Files to Modify:**
- `automation/planner.mjs:15-45` - System prompt
- `automation/plan-compiler.mjs:1-50` - Validation logic

---

### Session Persistence Testing
**Status:** Infrastructure ready, needs validation
**Impact:** High (-500ms potential improvement)

**Current Status:**
- ✅ DuckDB sessions table created
- ✅ Session save/restore functions implemented
- ✅ Login skip logic in sal-cli.mjs
- ⏳ Never tested with real cookie-based auth

**Action Items:**
1. Update demo/server.mjs to use actual cookie sessions
2. Test session save after login
3. Verify session restore on subsequent runs
4. Measure actual performance improvement
5. Add session TTL testing
6. Document session lifecycle

**Expected Impact:** -500ms (eliminates auth flow)

**Files to Test:**
- `automation/plan-cache.mjs:172-243` - Session functions
- `automation/sal-cli.mjs:313-400` - Session restoration

---

## Long-Term Vision (3-6 months)

### Test Framework Hardening
**Goal:** Production-ready testing infrastructure

**Features:**
1. **CI/CD Integration**
   - GitHub Actions workflow
   - Headless execution mode
   - Timing artifact publishing
   - Performance regression detection

2. **Real-Time Test UI**
   - WebSocket-based test runner
   - Live test execution display
   - Per-step timing visualization
   - Error surface in browser UI

3. **Advanced Metrics**
   - Per-step timing breakdown
   - Memory usage tracking
   - Network waterfall visualization
   - Plan cache hit/miss rates

**Implementation:**
```
sal-test-ui/
├── server.mjs          # WebSocket server
├── client/             # React dashboard
│   ├── TestRunner.tsx  # Real-time test execution
│   ├── Metrics.tsx     # Performance charts
│   └── PlanCache.tsx   # Cache visualization
└── ci/                 # CI/CD configurations
    ├── github-actions.yml
    └── performance-regression.mjs
```

**Action Items:**
1. Design WebSocket protocol for test streaming
2. Build React dashboard for live monitoring
3. Create GitHub Actions workflow
4. Implement performance regression alerts
5. Document CI/CD integration patterns

---

### Community & Commercialization

#### Open Source Framework
**Goal:** Extract SAL as standalone testing framework

**Packaging:**
- `@lpx/core` - Core execution engine
- `@lpx/test` - Testing framework
- `@lpx/cli` - Command-line interface
- `@lpx/embeddings` - Embedding cache utilities

**Documentation:**
- Getting Started Guide
- API Reference
- Migration from Playwright/Puppeteer
- Best Practices

**Community Building:**
- GitHub Discussions
- Discord server
- Monthly office hours
- Case studies

#### Pricing Strategy
**Free Tier:**
- 100 test runs/month
- Community support
- Public plan cache

**Starter ($29/month):**
- 1000 test runs/month
- Email support
- Private plan cache
- Priority bug fixes

**Enterprise ($299/month):**
- Unlimited test runs
- Dedicated support
- SLA guarantees
- Custom integrations
- On-premise deployment

---

## Success Metrics

### Short-Term (Month 1-2)
- ✅ Fix DMR embedding compatibility
- ✅ Add item title extraction test
- ✅ Identify steps execution bottleneck
- ✅ Complete Lightpanda vs Chromium analysis
- ✅ Document TEST-FRAMEWORK.md contract

### Mid-Term (Month 3-6)
- ✅ Session persistence tested and validated
- ✅ Planner robustness improvements deployed
- ✅ CDP dependency decision finalized
- ✅ Community testing framework extracted
- ✅ 10+ external contributors

### Long-Term (Month 6-12)
- ✅ Real-time test UI in production
- ✅ CI/CD integration with 5+ teams
- ✅ 100+ GitHub stars
- ✅ 10+ paying customers (if commercialized)
- ✅ Sub-500ms execution time achieved

---

## Contributing

See issues tagged with:
- `good-first-issue` - Beginner-friendly tasks
- `help-wanted` - Community contributions needed
- `performance` - Performance optimization work
- `documentation` - Docs improvements

---

## Feedback & Requests

Have ideas or found issues? Please:
1. Check existing issues on GitHub
2. Join community discussions
3. Submit detailed bug reports
4. Propose feature requests with use cases

---

*Last updated: 2025-12-30*
