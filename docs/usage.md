# SAL Usage Examples

This guide provides natural language prompt examples for common browser automation tasks with SAL.

**Key Principle:** Write prompts as if instructing a human, not a computer. SAL understands intent, not syntax.

---

## Basic Examples

### Login & Extract
```bash
# Extract items after login
docker compose exec automation node sal-cli.mjs \
  "Log into the app and extract the first 2 items"

# Extract all items (no limit)
docker compose exec automation node sal-cli.mjs \
  "Log into the app and extract the items list"

# Extract specific count
docker compose exec automation node sal-cli.mjs \
  "Log into the app and get 5 items"
```

**Output:**
```json
{
  "count": 2,
  "items": [
    { "text": "Pixel Bladenew", "attrs": { "data-sku": "PX-001" } },
    { "text": "Retro Shieldhot", "attrs": { "data-sku": "RS-002" } }
  ]
}
```

---

## Prompt Patterns

### Pattern 1: Login Required
```bash
"Log into the app and [action]"
"Sign in and [action]"
"Authenticate and [action]"
```

**Examples:**
- `"Log into the app and extract the first 10 items"`
- `"Sign in and get all products"`
- `"Authenticate and extract user list"`

**Behind the Scenes:**
```javascript
// Intent classification extracts:
{
  requires_login: true,
  action: "extract",
  target: "items",
  limit: 10
}
```

---

### Pattern 2: Direct Extraction (No Login)
```bash
"Extract [target]"
"Get [target]"
"Retrieve [target]"
```

**Examples:**
- `"Extract the items list"`
- `"Get all products"`
- `"Retrieve first 3 entries"`

**Behind the Scenes:**
```javascript
{
  requires_login: false,
  action: "extract",
  target: "items",
  limit: 3
}
```

---

### Pattern 3: With Quantity Limits
```bash
"... the first N [items]"
"... N [items]"
"... [items] (limit N)"
```

**Examples:**
- `"Extract the first 5 items"`
- `"Get 10 products"`
- `"Retrieve items (limit 20)"`

**Synonyms Recognized:**
- Numbers: `1`, `2`, `first`, `second`, `one`, `two`
- Items: `items`, `products`, `entries`, `goods`, `results`

---

## Advanced Examples

### Multi-Step Workflows

#### Example 1: Login → Navigate → Extract
```bash
docker compose exec automation node sal-cli.mjs \
  "Log into the dashboard, go to the items page, and extract all entries"
```

**What Happens:**
1. Navigates to login page
2. Fills credentials
3. Submits login form
4. Navigates to items page
5. Extracts data

---

#### Example 2: Conditional Extraction
```bash
docker compose exec automation node sal-cli.mjs \
  "If logged out, sign in, then extract the first 20 items"
```

**Smart Detection:** SAL checks for existing session before attempting login.

---

### Entity Synonyms

SAL understands common variations. Configure in `.env`:

```bash
# .env
INTENT_ENTITY_SYNONYMS=items:products,goods,entries;users:members,accounts;orders:purchases,transactions
```

**Example Prompts:**
```bash
# All equivalent (map to "items"):
"Extract products"
"Get goods"
"Retrieve entries"
"Fetch items"

# All equivalent (map to "users"):
"Extract members"
"Get accounts"
"Retrieve users"
```

---

## Real-World Use Cases

### E-Commerce

#### Product Catalog Scraping
```bash
"Log into the admin panel and extract the first 50 products"
```

**Use Case:** Regular catalog sync for pricing comparison

#### Inventory Check
```bash
"Sign in and get all out-of-stock items"
```

**Use Case:** Inventory monitoring (requires custom selectors for stock status)

---

### SaaS Dashboards

#### User List Export
```bash
"Log into the platform and extract all active users"
```

**Use Case:** User audit and analytics

#### Metrics Extraction
```bash
"Authenticate and retrieve dashboard metrics"
```

**Use Case:** Automated reporting

---

### Internal Tools

#### Test Data Generation
```bash
"Log into staging and extract 10 sample orders"
```

**Use Case:** QA data seeding

#### Configuration Audit
```bash
"Sign in and get all enabled features"
```

**Use Case:** Configuration validation across environments

---

## Batch Processing

### Run Multiple Prompts
```bash
#!/bin/bash
# batch-extract.sh

prompts=(
  "Log into the app and extract the first 10 items"
  "Log into the app and extract users"
  "Log into the app and extract orders"
)

for prompt in "${prompts[@]}"; do
  echo "Running: $prompt"
  docker compose exec automation node sal-cli.mjs "$prompt"
done
```

**Performance:**
- First run: ~1.5s (cache miss)
- Subsequent runs: ~0.75s (cache hit)

---

## Testing Prompts

### Test Framework Examples
```javascript
// automation/test-suite.mjs
{
  name: "Extract small batch",
  prompt: "Log into the app and extract the first 2 items",
  expectedItems: { count: 2 },
  timeout: 5000
},
{
  name: "Extract larger batch",
  prompt: "Log into the app and get 5 products",
  expectedItems: { count: 5 },
  timeout: 5000
},
{
  name: "Extract without limit",
  prompt: "Sign in and retrieve all items",
  expectedItems: { count: 5 }, // Demo app has 5 items
  timeout: 5000
}
```

**Run Tests:**
```bash
docker compose exec automation npm test
```

---

## Understanding Cache Behavior

### First Run (Cache Miss)
```bash
$ docker compose exec automation node sal-cli.mjs \
  "Log into the app and extract the first 3 items"

[SAL] Embedding cache MISS (generating embedding...)
[SAL] Plan cache MISS (generating plan...)
TIMING: total=1.50s embed=350ms plan=800ms exec=693ms
```

**What Happens:**
1. Generates embedding (350ms - local model)
2. No similar plan found in cache
3. Generates new plan via intent classification
4. Caches plan for future runs
5. Executes and returns results

---

### Second Run (Cache Hit)
```bash
$ docker compose exec automation node sal-cli.mjs \
  "Log into the app and extract the first 3 items"

[SAL] Embedding cache HIT (DuckDB)
[SAL] Plan cache HIT (similarity: 1.000)
TIMING: total=0.75s embed=2ms plan=0ms exec=693ms
```

**What Happens:**
1. Loads embedding from DuckDB (2ms)
2. Finds exact match in plan cache (similarity: 1.0)
3. Reuses cached plan (0ms planning)
4. Executes and returns results

**71% faster!**

---

### Similar Prompt (Semantic Match)
```bash
$ docker compose exec automation node sal-cli.mjs \
  "Sign in and get the first three entries"

[SAL] Embedding cache HIT (DuckDB)
[SAL] Plan cache HIT (similarity: 0.945)
TIMING: total=0.75s embed=2ms plan=0ms exec=693ms
```

**Semantic Matching:**
- "Log into" ≈ "Sign in" (login synonyms)
- "extract" ≈ "get" (action synonyms)
- "3" ≈ "three" (number equivalence)
- "items" ≈ "entries" (entity synonyms)

**Result:** 94.5% similar → Uses cached plan!

---

## Customizing for Your App

### 1. Update Environment Variables

```bash
# .env
TARGET_BASE_URL=https://your-app.example.com
LOGIN_PATH=/auth/login
ITEMS_PATH=/dashboard/items

EMAIL_SELECTOR=input[name="username"]
PASSWORD_SELECTOR=input[name="password"]
LOGIN_SUBMIT_SELECTOR=button#login-btn
ITEMS_SELECTOR=.product-card

USER_EMAIL=admin@example.com
USER_PASS=your-secure-password
```

---

### 2. Use Custom Prompts

```bash
# Your custom workflow
docker compose exec automation node sal-cli.mjs \
  "Log into the admin panel and extract product inventory"
```

**LPX automatically:**
- Uses `TARGET_BASE_URL` + `LOGIN_PATH` for login
- Fills `EMAIL_SELECTOR` with `USER_EMAIL`
- Fills `PASSWORD_SELECTOR` with `USER_PASS`
- Clicks `LOGIN_SUBMIT_SELECTOR`
- Navigates to `ITEMS_PATH`
- Extracts using `ITEMS_SELECTOR`

---

### 3. Add Entity Synonyms

```bash
# .env
INTENT_ENTITY_SYNONYMS=inventory:products,stock,catalog;admins:users,staff,members
```

**Now these work:**
```bash
"Extract inventory"  # Maps to "inventory"
"Get products"       # Maps to "inventory"
"Retrieve stock"     # Maps to "inventory"
```

---

## Troubleshooting Prompts

### Prompt Too Vague
```bash
# ❌ Too vague
"Get data"

# ✅ Better
"Extract items"

# ✅ Best
"Log into the app and extract the first 10 items"
```

---

### Unsupported Actions
```bash
# ❌ Not supported yet
"Click the settings button and change language to Spanish"

# ✅ Currently supported
"Extract items"
"Log into app and extract items"
```

**Current Actions:** `extract`, `navigate`, `fill`, `click` (combined in templates)

---

### Check What Was Understood

Enable verbose logging:
```bash
# .env
NODE_ENV=development
```

**Output shows:**
```
[SAL] Intent: { requires_login: true, action: "extract", target: "items", limit: 10 }
[SAL] Selected template: loginAndExtractTemplate
```

---

## Performance Tips

### 1. Use Consistent Phrasing
```bash
# First run
"Log into the app and extract the first 5 items"

# Subsequent runs - use EXACT same prompt for 100% cache hit
"Log into the app and extract the first 5 items"

# Or similar (90%+ similarity still cached)
"Sign in and get the first 5 products"
```

---

### 2. Clear Cache for Testing
```bash
# Remove all cached plans and embeddings
docker compose exec automation rm -f plan-cache.duckdb

# Next run will regenerate everything
docker compose exec automation node sal-cli.mjs "Log into app and extract items"
```

---

### 3. Monitor Performance
```bash
# Watch TIMING output
docker compose exec automation node sal-cli.mjs "..." | grep TIMING

# Example output:
TIMING: total=0.75s embed=2ms lookup=4ms plan=0ms compile=0ms connect=18ms exec=693ms
```

**What to watch:**
- `embed`: Should be ~2ms (cached) or ~350ms (cold)
- `plan`: Should be 0ms (cached) or ~800ms (cold)
- `exec`: Should be <1s for simple workflows

---

## Next Steps

- **See More:** [EXECUTION-FLOW.md](EXECUTION-FLOW.md) - Understand what happens behind the scenes
- **Optimize:** [PERFORMANCE.md](PERFORMANCE.md) - Performance tuning guide
- **Customize:** [ARCHITECTURE.md](ARCHITECTURE.md) - Extend SAL for your use case
- **Contribute:** [ROADMAP.md](ROADMAP.md) - Help improve SAL

---

## Quick Reference

### Supported Prompt Templates

| Pattern | Example | Action |
|---------|---------|--------|
| Login + Extract | `"Log into app and extract items"` | Full workflow |
| Direct Extract | `"Extract items"` | Skip login |
| With Limit | `"Extract first 5 items"` | Limit results |
| Synonyms | `"Get products"` (items), `"Retrieve members"` (users) | Entity mapping |

### Common Variations

**Login:**
- "Log into"
- "Sign in"
- "Authenticate"
- "Login to"

**Extract:**
- "Extract"
- "Get"
- "Retrieve"
- "Fetch"
- "Pull"

**Targets:**
- "items" → products, goods, entries
- "users" → members, accounts
- "orders" → purchases, transactions

**Limits:**
- "first 5" → `limit: 5`
- "10" → `limit: 10`
- "all" → no limit

---

*Last Updated: 2025-12-30*
