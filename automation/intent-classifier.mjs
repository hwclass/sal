/**
 * Intent Classifier
 * Uses small LLM to extract structured intent from natural language prompts
 * Returns semantic intent that can be mapped to plan templates
 */

/**
 * Extracts intent from prompt using small LLM with constrained output
 * @param {string} prompt - Natural language automation request
 * @returns {Promise<Object>} Structured intent object
 */
export async function classifyIntent(prompt) {
  const url = process.env.DMR_URL;
  const model = process.env.DMR_MODEL;

  if (!url || !model) {
    console.warn("[Intent] No DMR configured, falling back to regex extraction");
    return extractIntentRegex(prompt);
  }

  // Define strict JSON schema for intent
  const intentSchema = {
    type: "object",
    properties: {
      requires_login: {
        type: "boolean",
        description: "Does the task require logging in?"
      },
      action: {
        type: "string",
        enum: ["extract", "navigate", "click", "fill", "wait"],
        description: "Primary action to perform"
      },
      target: {
        type: "string",
        description: "Target page or element (e.g., 'items', 'products', 'users')"
      },
      limit: {
        type: "integer",
        minimum: 0,
        description: "Number of items to extract (0 = all)"
      }
    },
    required: ["requires_login", "action", "target", "limit"]
  };

  // Ultra-minimal prompt optimized for small models
  const systemPrompt = `You extract structured intent from test automation requests. Return only valid JSON.`;

  const userPrompt = `Request: "${prompt}"

Extract intent as JSON:
{
  "requires_login": boolean,
  "action": "extract" | "navigate" | "click" | "fill" | "wait",
  "target": "exact word from request",
  "limit": number (0 if not specified)
}

Rules:
1. Copy target word exactly as written in request
2. Action detection:
   - "extract" for: extract, get, fetch, scrape, collect, list
   - "navigate" for: go to, navigate to, visit
   - "click" for: click, press, tap
   - "fill" for: fill, type, enter
3. Limit detection:
   - Look for "first N", "only N", "exactly N", "top N"
   - If found, use that number
   - If "all" or no limit mentioned, use 0

Examples:
Request: "Log into app and get first 5 products"
{"requires_login":true,"action":"extract","target":"products","limit":5}

Request: "Extract the items list"
{"requires_login":false,"action":"extract","target":"items","limit":0}

Request: "Login and click the submit button"
{"requires_login":true,"action":"click","target":"submit","limit":0}

Request: "Get first 2 items"
{"requires_login":false,"action":"extract","target":"items","limit":2}

Request: "Log in and get the first 1 item"
{"requires_login":true,"action":"extract","target":"item","limit":1}

Now extract from the request above.
JSON:`;

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.0,
    max_tokens: 150,
    stop: ["\n\n", "Request:", "Example:"]
  };

  // Try JSON schema mode if supported
  if (process.env.DMR_SUPPORTS_JSON_SCHEMA === "true") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "automation_intent",
        strict: true,
        schema: intentSchema
      }
    };
  } else {
    // Fallback: request JSON mode without schema
    body.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.warn(`[Intent] DMR error (${res.status}), falling back to regex`);
      return extractIntentRegex(prompt);
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content ?? data.response ?? "";

    // Clean up response
    content = content.trim();

    // Extract JSON if wrapped in markdown
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      content = jsonMatch[1];
    }

    // Parse JSON
    const intent = JSON.parse(content);

    // Validate and normalize with prompt for synonym correction
    return normalizeIntent(intent, prompt);
  } catch (err) {
    console.warn(`[Intent] Classification failed: ${err.message}, falling back to regex`);
    return extractIntentRegex(prompt);
  }
}

/**
 * Regex-based intent extraction (fallback)
 * @param {string} prompt
 * @returns {Object} Intent object
 */
function extractIntentRegex(prompt) {
  const lower = prompt.toLowerCase();

  // Detect login requirement
  const requires_login = /log\s?in|sign\s?in|auth|login/.test(lower);

  // Detect primary action
  let action = "navigate";
  if (/extract|get|fetch|scrape|collect|list/.test(lower)) {
    action = "extract";
  } else if (/click|press|tap/.test(lower)) {
    action = "click";
  } else if (/fill|type|enter|input/.test(lower)) {
    action = "fill";
  } else if (/wait|pause|delay/.test(lower)) {
    action = "wait";
  }

  // Detect target
  let target = "items"; // default
  if (/product/i.test(lower)) target = "products";
  else if (/item/i.test(lower)) target = "items";
  else if (/user/i.test(lower)) target = "users";
  else if (/order/i.test(lower)) target = "orders";
  else if (/catalog/i.test(lower)) target = "catalog";

  // Detect limit
  let limit = 0; // 0 = all
  const limitMatch = lower.match(/(?:first|only|exactly|just)\s+(\d+)/);
  if (limitMatch) {
    limit = parseInt(limitMatch[1], 10);
  }

  return { requires_login, action, target, limit };
}

/**
 * Parse entity synonym mappings from environment variable
 * @returns {Map<string, string[]>} Map of canonical -> [synonyms]
 */
function parseEntitySynonyms() {
  const synonymsEnv = process.env.INTENT_ENTITY_SYNONYMS || "";
  if (!synonymsEnv) return new Map();

  const map = new Map();

  // Format: canonical1:syn1,syn2;canonical2:syn3,syn4
  const pairs = synonymsEnv.split(';').filter(Boolean);

  for (const pair of pairs) {
    const [canonical, synsStr] = pair.split(':');
    if (!canonical || !synsStr) continue;

    const synonyms = synsStr.split(',').map(s => s.trim()).filter(Boolean);
    map.set(canonical.trim(), synonyms);
  }

  return map;
}

/**
 * Normalize and validate intent object
 * @param {Object} intent
 * @param {string} originalPrompt - Original user prompt for validation
 * @returns {Object} Normalized intent
 */
function normalizeIntent(intent, originalPrompt = "") {
  const normalized = {
    requires_login: Boolean(intent.requires_login ?? false),
    action: String(intent.action || "navigate").toLowerCase(),
    target: String(intent.target || "items").toLowerCase(),
    limit: typeof intent.limit === "number" ? Math.max(0, intent.limit) : 0
  };

  // Validate action
  const validActions = ["extract", "navigate", "click", "fill", "wait"];
  if (!validActions.includes(normalized.action)) {
    normalized.action = "navigate";
  }

  // Post-process target using configurable synonym mappings
  // This corrects LLM mistakes when using synonyms instead of exact words from prompt
  if (originalPrompt) {
    const promptLower = originalPrompt.toLowerCase();
    const synonymMap = parseEntitySynonyms();

    // Check if any canonical word appears in the prompt
    for (const [canonical, synonyms] of synonymMap.entries()) {
      const canonicalRegex = new RegExp(`\\b${canonical}\\b`, 'i');

      if (canonicalRegex.test(promptLower)) {
        // If LLM returned a synonym instead of the canonical word, correct it
        if (synonyms.includes(normalized.target)) {
          console.log(`[Intent] Corrected target "${normalized.target}" → "${canonical}" (found in prompt: "${originalPrompt}")`);
          normalized.target = canonical;
          break;
        }
      }
    }
  }

  return normalized;
}
