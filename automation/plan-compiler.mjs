// Pure generic plan compiler
// Maps conceptual semantic roles to concrete selectors/URLs via environment config
// NO hardcoded UI-specific logic - everything driven by env

function pickUrlFromTarget(target = "", env) {
  const baseUrl = env.TARGET_BASE_URL || env.APP_URL || "";

  if (!target) return baseUrl;

  // Normalize target: "items page" → "items", "login page" → "login"
  const normalized = target.toLowerCase().replace(/\s+page\s*$/i, "").trim().replace(/\s+/g, "_");

  // Try direct env lookup: <TARGET>_URL (full URL)
  const urlKey = `${normalized.toUpperCase()}_URL`;
  if (env[urlKey]) return env[urlKey];

  // Try path-based lookup: <TARGET>_PATH + base URL
  const pathKey = `${normalized.toUpperCase()}_PATH`;
  if (env[pathKey]) {
    const path = env[pathKey];
    return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  // Fallback to base URL
  return baseUrl;
}

function pickFieldSelector(fieldRole = "", env) {
  if (!fieldRole) return "input";

  const r = fieldRole.toLowerCase().replace(/\s+/g, "_");

  // Try direct env lookup: <ROLE>_SELECTOR
  const envKey = `${r.toUpperCase()}_SELECTOR`;
  if (env[envKey]) return env[envKey];

  // Fallback: construct a name-based selector
  return `input[name="${r}"]`;
}

function pickFieldValue(fieldRole = "", env) {
  if (!fieldRole) return "";

  const r = fieldRole.toLowerCase().replace(/\s+/g, "_");

  // Try direct env lookup: <ROLE>_VALUE
  const envKey = `${r.toUpperCase()}_VALUE`;
  if (env[envKey]) return env[envKey];

  return "";
}

function pickButtonSelector(buttonRole = "", env) {
  if (!buttonRole) return "button";

  const r = buttonRole.toLowerCase().replace(/\s+/g, "_");

  // Try direct env lookup
  const envKey = `${r.toUpperCase()}_SELECTOR`;
  if (env[envKey]) return env[envKey];

  return "button";
}

function pickListSelector(listRole = "", env) {
  if (!listRole) return "ul li, ol li";

  const r = listRole.toLowerCase().replace(/\s+/g, "_");

  // Try direct env lookup
  const envKey = `${r.toUpperCase()}_SELECTOR`;
  if (env[envKey]) return env[envKey];

  return "ul li, ol li";
}

export function compilePlan(conceptualSteps, env, opts = {}) {
  const limitFromPrompt = opts.limitFromPrompt;
  const execSteps = [];

  for (const step of conceptualSteps) {
    const id = step.id ?? execSteps.length + 1;

    switch (step.action) {
      case "go": {
        const url = pickUrlFromTarget(step.target, env);
        execSteps.push({ id, action: "goto", url });
        break;
      }

      case "fill_field": {
        const selector = pickFieldSelector(step.field_role || step.target, env);
        const value = step.value || pickFieldValue(step.field_role || step.target, env);
        execSteps.push({ id, action: "fill", selector, value });
        break;
      }

      case "click": {
        const selector = pickButtonSelector(step.button_role || step.target, env);
        execSteps.push({ id, action: "click", selector });
        break;
      }

      case "extract_list": {
        const selector = pickListSelector(step.list_role || step.target, env);
        const exec = { id, action: "extract", selector };
        if (typeof limitFromPrompt === "number" && limitFromPrompt > 0) {
          exec.limit = limitFromPrompt;
        }
        execSteps.push(exec);
        break;
      }

      default:
        break;
    }
  }

  // Performance optimization: batch consecutive fill/click operations
  return batchDOMOperations(execSteps);
}

// Batch consecutive fill and click operations into single "batch" step
// This reduces CDP round-trips from N operations to 1
function batchDOMOperations(steps) {
  const batched = [];
  let i = 0;

  while (i < steps.length) {
    const current = steps[i];

    // Check if we can start a batch (fill or click without navigation dependency)
    if (current.action === 'fill' || current.action === 'click') {
      const batch = [current];
      let j = i + 1;

      // Collect consecutive fill/click operations
      while (j < steps.length && (steps[j].action === 'fill' || steps[j].action === 'click')) {
        batch.push(steps[j]);
        j++;
      }

      // If we have multiple operations, create a batch step
      if (batch.length > 1) {
        batched.push({
          id: current.id,
          action: 'batch',
          operations: batch
        });
        i = j;
      } else {
        // Single operation, keep as-is
        batched.push(current);
        i++;
      }
    } else {
      // Non-batchable step (goto, extract), keep as-is
      batched.push(current);
      i++;
    }
  }

  return batched;
}
