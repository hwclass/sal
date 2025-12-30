/**
 * Plan Templates
 * Pre-defined automation plan templates for common workflows
 * Eliminates reliance on LLM for structured plan generation
 */

/**
 * Generates automation plan from classified intent
 * @param {Object} intent - Classified intent from intent-classifier
 * @param {Object} options - Additional options (limitFromPrompt, etc.)
 * @returns {Array} Array of conceptual steps
 */
export function generatePlanFromIntent(intent, options = {}) {
  const { requires_login, action, target, limit } = intent;
  const { limitFromPrompt } = options;

  // Use prompt limit if specified, otherwise use intent limit
  const finalLimit = typeof limitFromPrompt === "number" ? limitFromPrompt : limit;

  // Select appropriate template
  if (requires_login && action === "extract") {
    return loginAndExtractTemplate(target, finalLimit);
  }

  if (!requires_login && action === "extract") {
    return extractOnlyTemplate(target, finalLimit);
  }

  if (requires_login && action === "navigate") {
    return loginAndNavigateTemplate(target);
  }

  if (requires_login && action === "click") {
    return loginAndClickTemplate(target);
  }

  if (action === "navigate") {
    return navigateOnlyTemplate(target);
  }

  // Default: login and extract (most common case)
  return loginAndExtractTemplate(target, finalLimit);
}

/**
 * Template: Login → Navigate to page → Extract items
 */
function loginAndExtractTemplate(target, limit = 0) {
  const steps = [
    {
      id: 1,
      action: "go",
      target: "login page"
    },
    {
      id: 2,
      action: "fill_field",
      field_role: "email"
    },
    {
      id: 3,
      action: "fill_field",
      field_role: "password"
    },
    {
      id: 4,
      action: "click",
      button_role: "submit"
    },
    {
      id: 5,
      action: "go",
      target: `${target} page`
    },
    {
      id: 6,
      action: "extract_list",
      list_role: target
    }
  ];

  // Add limit if specified
  if (limit > 0) {
    steps[steps.length - 1].limit = limit;
  }

  return steps;
}

/**
 * Template: Navigate to page → Extract items (no login)
 */
function extractOnlyTemplate(target, limit = 0) {
  const steps = [
    {
      id: 1,
      action: "go",
      target: `${target} page`
    },
    {
      id: 2,
      action: "extract_list",
      list_role: target
    }
  ];

  if (limit > 0) {
    steps[steps.length - 1].limit = limit;
  }

  return steps;
}

/**
 * Template: Login → Navigate to page
 */
function loginAndNavigateTemplate(target) {
  return [
    {
      id: 1,
      action: "go",
      target: "login page"
    },
    {
      id: 2,
      action: "fill_field",
      field_role: "email"
    },
    {
      id: 3,
      action: "fill_field",
      field_role: "password"
    },
    {
      id: 4,
      action: "click",
      button_role: "submit"
    },
    {
      id: 5,
      action: "go",
      target: `${target} page`
    }
  ];
}

/**
 * Template: Login → Click element
 */
function loginAndClickTemplate(target) {
  return [
    {
      id: 1,
      action: "go",
      target: "login page"
    },
    {
      id: 2,
      action: "fill_field",
      field_role: "email"
    },
    {
      id: 3,
      action: "fill_field",
      field_role: "password"
    },
    {
      id: 4,
      action: "click",
      button_role: "submit"
    },
    {
      id: 5,
      action: "click",
      button_role: target
    }
  ];
}

/**
 * Template: Navigate to page only
 */
function navigateOnlyTemplate(target) {
  return [
    {
      id: 1,
      action: "go",
      target: `${target} page`
    }
  ];
}

/**
 * Validates that generated plan has valid structure
 * @param {Array} steps
 * @returns {boolean}
 */
export function validatePlan(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return false;
  }

  const validActions = ["go", "fill_field", "click", "extract_list", "wait"];

  for (const step of steps) {
    if (!step.id || !step.action) {
      return false;
    }
    if (!validActions.includes(step.action)) {
      return false;
    }
  }

  return true;
}

/**
 * Merges multiple plans into a single sequential plan
 * @param {Array<Array>} plans - Array of step arrays
 * @returns {Array} Merged steps with renumbered IDs
 */
export function mergePlans(...plans) {
  let merged = [];
  let currentId = 1;

  for (const plan of plans) {
    if (!Array.isArray(plan)) continue;

    for (const step of plan) {
      merged.push({
        ...step,
        id: currentId++
      });
    }
  }

  return merged;
}

/**
 * Adds a wait step after a specific action
 * @param {Array} steps
 * @param {number} afterStepId - ID of step to wait after
 * @param {number} duration - Wait duration in milliseconds
 * @returns {Array} Updated steps
 */
export function addWaitAfterStep(steps, afterStepId, duration = 1000) {
  const index = steps.findIndex(s => s.id === afterStepId);
  if (index === -1) return steps;

  const newSteps = [...steps];
  newSteps.splice(index + 1, 0, {
    id: afterStepId + 0.5, // Fractional ID to avoid conflicts
    action: "wait",
    duration
  });

  // Renumber all steps
  return newSteps.map((s, i) => ({ ...s, id: i + 1 }));
}
