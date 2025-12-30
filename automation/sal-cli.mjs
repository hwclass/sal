import { chromium } from "playwright";
import yaml from "js-yaml";

import { planConceptual } from "./planner.mjs";
import {
  initPlanCache,
  savePlan,
  findBestPlanByEmbedding,
  incrementHits,
  updateSuccessRate,
  saveSession,
  getValidSession,
  updateSessionLastUsed,
  deleteExpiredSessions
} from "./plan-cache.mjs";
import { embedPrompt } from "./embeddings.mjs";
import { compilePlan } from "./plan-compiler.mjs";

const resolveBase = () => {
  const url = new URL(process.env.TARGET_BASE_URL);
  if (["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.hostname = "host.docker.internal";
  }
  return url.toString().replace(/\/$/, "");
};

const APP_URL = resolveBase();
const LOGIN_URL = `${APP_URL}${process.env.LOGIN_PATH}`;
const ITEMS_URL = `${APP_URL}${process.env.ITEMS_PATH}`;
const UI_URL = "http://sal-ui:4000";
const PLAN_SIM_THRESHOLD = parseFloat(process.env.PLAN_SIM_THRESHOLD || "0.9");

// Build envConfig by passing through ALL env vars that match selector/value/url patterns
const envConfig = {
  APP_URL,
  LOGIN_URL,
  ITEMS_URL
};

// Add all *_SELECTOR, *_VALUE, and *_URL env vars
for (const [key, value] of Object.entries(process.env)) {
  if (key.endsWith("_SELECTOR") || key.endsWith("_VALUE") || key.endsWith("_URL")) {
    envConfig[key] = value;
  }
}

const envSnapshot = {
  TARGET_BASE_URL: process.env.TARGET_BASE_URL,
  LOGIN_PATH: process.env.LOGIN_PATH,
  ITEMS_PATH: process.env.ITEMS_PATH,
  LOGIN_EMAIL_SELECTOR: process.env.LOGIN_EMAIL_SELECTOR,
  LOGIN_PASSWORD_SELECTOR: process.env.LOGIN_PASSWORD_SELECTOR,
  LOGIN_SUBMIT_SELECTOR: process.env.LOGIN_SUBMIT_SELECTOR,
  ITEMS_SELECTOR: process.env.ITEMS_SELECTOR,
  USER_EMAIL: process.env.USER_EMAIL,
  USER_PASS: process.env.USER_PASS
};

async function postEvent(type, payload) {
  await fetch(`${UI_URL}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload })
  }).catch(() => {});
}

async function log(msg) {
  console.log(msg);
  await postEvent("log", { message: msg });
}

const envReplace = (input) => {
  if (typeof input !== "string") return input;
  return input.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
};

function detectExtractLimit(prompt = "") {
  const m = prompt.match(/first\s+(\d+)/i);
  if (!m) return undefined;
  const num = parseInt(m[1], 10);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

async function executeStep(page, step) {
  await log(`Step ${step.id}: ${step.action}`);

  switch (step.action) {
    case "goto":
      // P0.2 Faster Navigation: Use domcontentloaded instead of networkidle
      // This is much faster as it doesn't wait for all resources (images, fonts, etc.)
      await page.goto(envReplace(step.url || ""), { waitUntil: "domcontentloaded" });
      console.log(`  → Current URL: ${page.url()}`);
      return;

    case "fill":
      await page.fill(
        envReplace(step.selector || ""),
        envReplace(step.value || "")
      );
      return;

    case "click":
      await page.click(envReplace(step.selector || ""));
      await page.waitForLoadState("domcontentloaded");
      console.log(`  → Current URL after click: ${page.url()}`);
      return;

    case "batch": {
      // Performance optimization: Execute multiple DOM operations in single CDP call
      console.log(`  → Batching ${step.operations.length} operations`);

      // Check if batch contains a click that might navigate
      const hasClick = step.operations.some(op => op.action === 'click');

      if (hasClick) {
        // For batches with clicks, we need to use Playwright's click() to properly trigger events
        // Fill operations can still be done in batch via evaluate
        const fillOps = step.operations.filter(op => op.action === 'fill');
        const clickOps = step.operations.filter(op => op.action === 'click');

        // Batch all fills first
        if (fillOps.length > 0) {
          await page.evaluate((ops) => {
            for (const op of ops) {
              const el = document.querySelector(op.selector);
              if (el) el.value = op.value;
            }
          }, fillOps.map(op => ({
            selector: envReplace(op.selector || ""),
            value: envReplace(op.value || "")
          })));
        }

        // Then execute clicks sequentially using Playwright's click (to trigger proper events)
        for (const clickOp of clickOps) {
          await page.click(envReplace(clickOp.selector || ""));
        }

        // Wait for any navigation
        await page.waitForLoadState("domcontentloaded");
      } else {
        // No navigation expected, batch all operations
        await page.evaluate((ops) => {
          for (const op of ops) {
            if (op.action === 'fill') {
              const el = document.querySelector(op.selector);
              if (el) el.value = op.value;
            }
          }
        }, step.operations.map(op => ({
          action: op.action,
          selector: envReplace(op.selector || ""),
          value: op.value ? envReplace(op.value) : undefined
        })));
      }

      console.log(`  → Current URL after batch: ${page.url()}`);
      return;
    }

    case "extract": {
      console.log(`  → Current URL before extract: ${page.url()}`);
      let sel = envReplace(step.selector || "");
      if (typeof sel !== "string" || !sel.trim()) {
        console.log("Selector missing or invalid; defaulting to ITEMS_SELECTOR");
        sel = process.env.ITEMS_SELECTOR;
      }
      const maxItems = Number.isFinite(step.limit) && step.limit > 0 ? step.limit : undefined;
      const items = await page.$$eval(sel, (nodes, lim) =>
        nodes.map((n) => ({
          text: n.textContent.trim(),
          attrs: Object.fromEntries(
            [...n.attributes].map((a) => [a.name, a.value])
          )
        })).slice(0, typeof lim === "number" ? Math.max(0, lim) : undefined),
        maxItems
      );
      console.log({ count: items.length, items });
      await postEvent("data", { label: "items", data: items });
      return;
    }
  }
}

async function main() {
  await initPlanCache();
  const start = Date.now();

  console.log("Env snapshot:", envSnapshot);
  const prompt = process.argv.slice(2).join(" ") || "Log into the app and extract the items list.";
  const limitFromPrompt = detectExtractLimit(prompt);

  // Performance tracking
  const perf = {
    embed_start: Date.now(),
    embed_end: 0,
    lookup_start: 0,
    lookup_end: 0,
    plan_start: 0,
    plan_end: 0,
    compile_start: 0,
    compile_end: 0,
    connect_start: 0,
    connect_end: 0,
    exec_start: 0,
    exec_end: 0
  };

  // 1) Try semantic cache (if embeddings configured)
  let planMeta = { source: "dmr" };
  let conceptualYaml;
  let conceptualSteps = [];
  let embedding = null;
  let shouldSavePlan = false;
  let planningMode = process.env.PLANNING_MODE || "hybrid";

  try {
    embedding = await embedPrompt(prompt);
    perf.embed_end = Date.now();
  } catch {
    embedding = null;
    perf.embed_end = Date.now();
  }

  perf.lookup_start = Date.now();
  if (embedding && embedding.length > 0) {
    const cached = await findBestPlanByEmbedding(
      embedding,
      PLAN_SIM_THRESHOLD
    );
    perf.lookup_end = Date.now();

    if (cached) {
      console.log(
        `[SAL] Plan cache HIT (id=${cached.id}, sim=${cached.similarity?.toFixed?.(3) ?? cached.similarity})`
      );
      await incrementHits(cached.id);
      conceptualYaml = cached.yaml;
      const parsed = yaml.load(cached.yaml);
      conceptualSteps = (Array.isArray(parsed?.steps) && parsed.steps) || [];
      planMeta = { source: "cache", cacheId: cached.id, similarity: cached.similarity };
      await postEvent("plan", {
        yaml: cached.yaml,
        source: "cache",
        similarity: cached.similarity
      });
    }
  } else {
    perf.lookup_end = Date.now();
  }

  // 2) Call planner if no cache hit
  if (!conceptualSteps.length) {
    console.log("[SAL] Plan cache MISS → calling planner");
    perf.plan_start = Date.now();
    const conceptual = await planConceptual(prompt, { limitFromPrompt });
    perf.plan_end = Date.now();

    conceptualYaml = conceptual.yaml;
    conceptualSteps = conceptual.steps || [];
    planMeta = { source: "dmr" };
    shouldSavePlan = true; // Only save new plans after successful execution

    await postEvent("plan", {
      yaml: conceptualYaml,
      source: "dmr"
    });
  } else {
    perf.plan_start = perf.plan_end = Date.now();
  }

  perf.compile_start = Date.now();

  // 3) Compile conceptual → executable plan
  let execSteps = compilePlan(conceptualSteps, envConfig, { limitFromPrompt });
  perf.compile_end = Date.now();

  await postEvent("meta", {
    source: planMeta.source,
    prompt,
    ts: new Date().toISOString(),
    cache_id: planMeta.cacheId ?? null,
    similarity: planMeta.similarity ?? null
  });

  await postEvent("exec_plan", {
    yaml: yaml.dump({ steps: execSteps })
  });

  if (
    !execSteps.length ||
    execSteps.some((s) =>
      (s.action === "goto" && !s.url) ||
      (["fill", "click", "extract"].includes(s.action) && (!s.selector || !String(s.selector).trim()))
    )
  ) {
    console.error("[SAL] Executable plan invalid/empty; aborting without fallback.");
    // Update success rate for cached plans on failure
    if (planMeta.cacheId) {
      await updateSuccessRate(planMeta.cacheId, false);
    }
    return;
  }

  // 4) Session persistence - check for valid session
  await deleteExpiredSessions(); // Clean up expired sessions
  const existingSession = await getValidSession(APP_URL);
  let sessionId = existingSession?.id;
  let sessionUsed = false;

  // 5) Execute via Lightpanda CDP
  let executionSuccess = false;
  try {
    console.log("[SAL] Connecting to Lightpanda CDP:", process.env.LIGHTPANDA_CDP_URL);
    perf.connect_start = Date.now();
    const browser = await chromium.connectOverCDP(process.env.LIGHTPANDA_CDP_URL);
    let context = browser.contexts()[0];
    if (!context) {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
    }
    const page = await context.newPage();

    // Restore session cookies if available
    if (existingSession) {
      console.log(`[SAL] Restoring session (id=${existingSession.id}, expires=${existingSession.expiresAt})`);
      await context.addCookies(existingSession.cookies);
      sessionUsed = true;
      await updateSessionLastUsed(sessionId);
    }

    perf.connect_end = Date.now();

    perf.exec_start = Date.now();

    // Filter out login steps if we have a valid session
    let stepsToExecute = execSteps;
    if (existingSession) {
      // Skip steps that are part of authentication flow
      // Heuristic: skip goto login, fill email/password, click submit
      const authStepIds = new Set();
      for (let i = 0; i < execSteps.length; i++) {
        const step = execSteps[i];
        // Detect login flow: goto /login, fill credentials, submit
        if (step.action === 'goto' && step.url?.includes(process.env.LOGIN_PATH)) {
          authStepIds.add(step.id);
          // Skip next few steps (fill email, password, submit)
          for (let j = i + 1; j < Math.min(i + 4, execSteps.length); j++) {
            if (['fill', 'click'].includes(execSteps[j].action)) {
              authStepIds.add(execSteps[j].id);
            } else {
              break; // Stop at first non-auth action
            }
          }
          break;
        }
      }

      if (authStepIds.size > 0) {
        stepsToExecute = execSteps.filter(s => !authStepIds.has(s.id));
        console.log(`[SAL] Session valid - skipping ${authStepIds.size} authentication steps`);
      }
    }

    for (const step of stepsToExecute) {
      await executeStep(page, step);
    }
    perf.exec_end = Date.now();

    executionSuccess = true;

    // Performance metrics
    const elapsed = perf.exec_end - start;
    const durationLabel =
      elapsed >= 60000
        ? `${Math.floor(elapsed / 60000)}min.${Math.round(
            (elapsed % 60000) / 1000
          )}sec`
        : `${Math.round(elapsed / 1000)}sec`;

    await log(`==== Process duration: ${durationLabel} ====`);

    const embed_ms = perf.embed_end - perf.embed_start;
    const lookup_ms = perf.lookup_end - perf.lookup_start;
    const plan_ms = perf.plan_end - perf.plan_start;
    const compile_ms = perf.compile_end - perf.compile_start;
    const connect_ms = perf.connect_end - perf.connect_start;
    const exec_ms = perf.exec_end - perf.exec_start;

    await log(
      `TIMING: total=${(elapsed / 1000).toFixed(2)}s ` +
        `embed=${embed_ms}ms lookup=${lookup_ms}ms plan=${plan_ms}ms ` +
        `compile=${compile_ms}ms connect=${connect_ms}ms exec=${exec_ms}ms`
    );

    // Save session after successful execution (if we authenticated)
    if (!sessionUsed && executionSuccess) {
      // We just authenticated - save the session
      const cookies = await context.cookies();
      if (cookies && cookies.length > 0) {
        const newSessionId = await saveSession({
          baseUrl: APP_URL,
          cookies,
          ttlSeconds: 3600 // 1 hour session TTL
        });
        console.log(`[SAL] Session saved (id=${newSessionId}, ttl=1h)`);
        sessionId = newSessionId;
      }
    }

    await context.close();

    // Cache policy: Save plan only on successful execution
    if (shouldSavePlan && embedding && embedding.length > 0 && conceptualYaml) {
      await savePlan({
        prompt,
        yaml: conceptualYaml,
        embedding,
        backend: planningMode,
        success: true
      });
      console.log("[SAL] Plan saved to cache (execution succeeded)");
    }

    // Update success rate for cached plans
    if (planMeta.cacheId) {
      await updateSuccessRate(planMeta.cacheId, true);
    }
  } catch (err) {
    console.error("[SAL] Execution failed:", err.message);

    // Update success rate for cached plans on failure
    if (planMeta.cacheId) {
      await updateSuccessRate(planMeta.cacheId, false);
    }

    throw err;
  }
}

main();
