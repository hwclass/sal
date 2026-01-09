/**
 * LPX Planner v2
 * Hybrid approach: Intent Classification (LLM) + Template-Based Generation (Rules)
 * Optimized for small LLMs with robust fallback handling
 */

import yaml from "js-yaml";
import { classifyIntent } from "./intent-classifier.mjs";
import { generatePlanFromIntent, validatePlan } from "./plan-templates.mjs";

/**
 * Main planning function
 * @param {string} prompt - Natural language automation request
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} { yaml, steps }
 */
export async function planConceptual(prompt, options = {}) {
  const mode = process.env.PLANNING_MODE || "hybrid";

  console.log(`[SAL] Planning mode: ${mode}`);

  switch (mode) {
    case "intent":
      return await planWithIntent(prompt, options);

    case "llm":
      return await planWithLLM(prompt, options);

    case "heuristic":
      return planWithHeuristic(prompt, options);

    case "hybrid":
    default:
      return await planHybrid(prompt, options);
  }
}

/**
 * Hybrid mode: Try intent classification → templates → LLM → heuristic
 */
async function planHybrid(prompt, options) {
  // Step 1: Try intent classification + templates
  try {
    const result = await planWithIntent(prompt, options);
    if (result.steps.length > 0) {
      console.log("[SAL] ✓ Plan generated via intent classification + templates");
      return result;
    }
  } catch (err) {
    console.warn("[SAL] Intent classification failed:", err.message);
  }

  // Step 2: Try direct LLM generation (with grammar constraints)
  try {
    const result = await planWithLLM(prompt, options);
    if (result.steps.length > 0) {
      console.log("[SAL] ✓ Plan generated via constrained LLM");
      return result;
    }
  } catch (err) {
    console.warn("[SAL] LLM planning failed:", err.message);
  }

  // Step 3: Fallback to heuristics
  console.log("[SAL] ⚠ Falling back to heuristic planning");
  return planWithHeuristic(prompt, options);
}

/**
 * Intent + Templates mode (RECOMMENDED for small LLMs)
 */
async function planWithIntent(prompt, options) {
  console.log("[SAL] Classifying intent...");
  const { intent, meta } = await classifyIntent(prompt);

  console.log("[SAL] Intent:", JSON.stringify(intent), "meta:", JSON.stringify(meta));

  const steps = generatePlanFromIntent(intent, options);

  if (!validatePlan(steps)) {
    throw new Error("Generated plan failed validation");
  }

  const yamlPlan = yaml.dump({ steps });

  console.log("\n=== CONCEPTUAL PLAN (Intent + Templates) ===");
  console.log(yamlPlan);
  console.log("=== End Conceptual Plan ===\n");

  return { yaml: yamlPlan, steps };
}

/**
 * Direct LLM planning with grammar constraints
 */
async function planWithLLM(prompt, options) {
  const url = process.env.DMR_URL;
  const model = process.env.DMR_MODEL;

  if (!url || !model) {
    throw new Error("DMR not configured");
  }

  console.log("[SAL] Generating plan via LLM with JSON schema...");

  // Define strict JSON schema
  const planSchema = {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            action: {
              type: "string",
              enum: ["go", "fill_field", "click", "extract_list"]
            },
            target: { type: "string" },
            field_role: { type: "string" },
            button_role: { type: "string" },
            list_role: { type: "string" },
            limit: { type: "integer" }
          },
          required: ["id", "action"]
        }
      }
    },
    required: ["steps"]
  };

  const systemPrompt = `Generate automation plan as JSON. Use actions: go, fill_field, click, extract_list.`;

  const userPrompt = `Task: ${prompt}

Example:
{"steps":[{"id":1,"action":"go","target":"login page"},{"id":2,"action":"fill_field","field_role":"email"},{"id":3,"action":"fill_field","field_role":"password"},{"id":4,"action":"click","button_role":"submit"},{"id":5,"action":"go","target":"items page"},{"id":6,"action":"extract_list","list_role":"items"}]}

Generate JSON plan:`;

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.0,
    max_tokens: 500,
    stop: ["\n\nTask:", "Example:"]
  };

  // Add JSON schema if supported
  if (process.env.DMR_SUPPORTS_JSON_SCHEMA === "true") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "automation_plan",
        strict: true,
        schema: planSchema
      }
    };
  } else {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`DMR error: ${res.status}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? data.response ?? "";

  // Clean up response
  content = content.trim();
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    content = jsonMatch[1];
  }

  const parsed = JSON.parse(content);
  const steps = normalizeSteps(parsed);

  if (!validatePlan(steps)) {
    throw new Error("LLM-generated plan failed validation");
  }

  const yamlPlan = yaml.dump({ steps });

  console.log("\n=== CONCEPTUAL PLAN (LLM) ===");
  console.log(yamlPlan);
  console.log("=== End Conceptual Plan ===\n");

  return { yaml: yamlPlan, steps };
}

/**
 * Heuristic planning (regex-based, no LLM)
 */
function planWithHeuristic(prompt, options) {
  const text = prompt.toLowerCase();
  const wantsLogin = /login|sign\s?in|auth/.test(text);
  const wantsExtract = /extract|get|fetch|list|items|products/.test(text);

  const steps = [];

  // Detect target
  let target = "items";
  if (/product/i.test(text)) target = "products";
  else if (/user/i.test(text)) target = "users";
  else if (/order/i.test(text)) target = "orders";

  // Detect limit
  let limit = 0;
  const limitMatch = text.match(/(?:first|only)\s+(\d+)/);
  if (limitMatch) {
    limit = parseInt(limitMatch[1], 10);
  }

  // Build plan
  if (wantsLogin) {
    steps.push(
      { id: 1, action: "go", target: "login page" },
      { id: 2, action: "fill_field", field_role: "email" },
      { id: 3, action: "fill_field", field_role: "password" },
      { id: 4, action: "click", button_role: "submit" }
    );
  }

  if (wantsExtract) {
    const extractStep = {
      id: steps.length + 1,
      action: "go",
      target: `${target} page`
    };
    steps.push(extractStep);

    const listStep = {
      id: steps.length + 1,
      action: "extract_list",
      list_role: target
    };
    if (limit > 0) {
      listStep.limit = limit;
    }
    steps.push(listStep);
  }

  if (steps.length === 0) {
    // Default: just navigate
    steps.push({ id: 1, action: "go", target: "home page" });
  }

  const yamlPlan = yaml.dump({ steps });

  console.log("\n=== CONCEPTUAL PLAN (Heuristic) ===");
  console.log(yamlPlan);
  console.log("=== End Conceptual Plan ===\n");

  return { yaml: yamlPlan, steps };
}

/**
 * Normalize steps from various formats
 */
function normalizeSteps(parsed) {
  const raw =
    (Array.isArray(parsed?.steps) && parsed.steps) ||
    (Array.isArray(parsed) && parsed) ||
    [];

  const steps = [];
  const validActions = ["go", "fill_field", "click", "extract_list"];

  for (const s of raw) {
    if (!s || typeof s !== "object") continue;

    let action = String(s.action || "").toLowerCase().trim();

    // Normalize action names
    if (action === "goto" || action === "navigate") action = "go";
    if (action.startsWith("fill")) action = "fill_field";
    if (action.startsWith("click")) action = "click";
    if (action.startsWith("extract")) action = "extract_list";

    if (!validActions.includes(action)) continue;

    const normalized = {
      id: s.id ?? steps.length + 1,
      action,
      target: s.target || s.page || "",
      field_role: s.field_role || s.role || s.field || "",
      button_role: s.button_role || s.role || s.button || "",
      list_role: s.list_role || s.role || s.list || ""
    };

    // Preserve limit if specified
    if (typeof s.limit === "number" && s.limit > 0) {
      normalized.limit = s.limit;
    }

    steps.push(normalized);
  }

  return steps;
}
