import http from "http";
import { runSal } from "./sal-cli.mjs";
import { initCDPPool } from "./cdp-pool.mjs";
import { initPlanCache } from "./plan-cache.mjs";

const PORT = parseInt(process.env.JOB_SERVICE_PORT || "8787", 10);
const AUTH_TOKEN = process.env.JOB_SERVICE_TOKEN || "";
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || "60000", 10) || 60000;

const jobs = new Map();
const queue = [];
let processing = false;
const concurrency = parseInt(process.env.JOB_CONCURRENCY || process.env.CDP_POOL_SIZE || "1", 10) || 1;
let active = 0;
let shuttingDown = false;

const metrics = {
  total: 0,
  succeeded: 0,
  failed: 0,
  avg_total_ms: 0,
  avg_exec_ms: 0,
  intent_dmr: 0,
  intent_regex: 0,
  embed_dmr: 0,
  embed_local: 0,
  embed_cache: 0
};

function authOk(req) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers["authorization"] || "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === AUTH_TOKEN;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(body);
}

function enqueue(job) {
  if (shuttingDown) return;
  queue.push(job);
  drain();
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function drain() {
  if (processing) return;
  processing = true;
  while (active < concurrency && queue.length > 0) {
    const job = queue.shift();
    active++;
    runJob(job).finally(() => {
      active--;
      drain();
    });
  }
  processing = false;
}

async function runJob(job) {
  const startedAt = new Date().toISOString();
  jobs.set(job.id, { ...job, status: "running", startedAt });
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`job_timeout_${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS);
    });
    const result = await Promise.race([
      runSal(job.prompt, { envOverrides: job.env || {}, runId: job.id }),
      timeoutPromise
    ]);
    metrics.total += 1;
    metrics.succeeded += 1;
    const t = result?.timings?.total_ms || 0;
    const e = result?.timings?.exec_ms || 0;
    metrics.avg_total_ms = metrics.avg_total_ms === 0 ? t : (metrics.avg_total_ms + t) / 2;
    metrics.avg_exec_ms = metrics.avg_exec_ms === 0 ? e : (metrics.avg_exec_ms + e) / 2;
    const intentSource = result?.intent?.source;
    if (intentSource === "dmr") metrics.intent_dmr += 1;
    if (intentSource === "regex") metrics.intent_regex += 1;
    const embSource = result?.embedding?.source;
    if (embSource === "dmr") metrics.embed_dmr += 1;
    if (embSource === "local") metrics.embed_local += 1;
    if (embSource === "duckdb" || embSource === "memory") metrics.embed_cache += 1;
    jobs.set(job.id, {
      ...job,
      status: "succeeded",
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: result
    });
  } catch (err) {
    metrics.total += 1;
    metrics.failed += 1;
    jobs.set(job.id, {
      ...job,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: err?.message || String(err)
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function renderUi() {
  const jobList = [...jobs.values()];
  const rows = jobList
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .map(
      (j) =>
        (() => {
          const summary = j.summary || {};
          const timings = summary.timings || {};
          const totalMs =
            timings.total_ms ??
            (j.startedAt && j.finishedAt
              ? Math.max(
                  0,
                  new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()
                )
              : "");
          const hasResultsArray = Array.isArray(summary.results);
          const resultCount = typeof summary.result_count === "number"
            ? summary.result_count
            : (hasResultsArray ? summary.results.length : "");

          // Create collapsible result cell
          const resultId = `result-${j.id}`;
          const resultDetails = hasResultsArray && summary.results.length > 0
            ? `<details id="${resultId}">
                <summary style="cursor:pointer;user-select:none;">View results</summary>
                <pre style="margin-top:8px;max-height:300px;overflow:auto;font-size:11px;">${escapeHtml(JSON.stringify(summary.results, null, 2))}</pre>
              </details>`
            : "";

          // Determine row color based on status
          const statusColors = {
            queued: "#f0f0f0",
            running: "#fff3cd",
            succeeded: "#d4edda",
            failed: "#f8d7da"
          };
          const rowColor = statusColors[j.status] || "#ffffff";

          return `<tr style="background-color:${rowColor};">
            <td>${escapeHtml(j.id)}</td>
            <td>${escapeHtml(j.prompt || "")}</td>
            <td>${escapeHtml(j.status || "")}</td>
            <td>${escapeHtml(j.createdAt || "")}</td>
            <td>${escapeHtml(j.startedAt || "")}</td>
            <td>${escapeHtml(j.finishedAt || "")}</td>
            <td>${totalMs}</td>
            <td>${resultCount}</td>
            <td>${resultDetails}</td>
            <td>${escapeHtml(j.error || "")}</td>
          </tr>`;
        })()
    )
    .join("");

  let totalSeconds = null;
  if (jobList.length > 0) {
    const now = Date.now();
    const starts = jobList
      .map((j) => new Date(j.createdAt || "").getTime())
      .filter((t) => Number.isFinite(t));
    if (starts.length > 0) {
      const earliest = Math.min(...starts);
      const finishes = jobList.map((j) => {
        const t = new Date(j.finishedAt || "").getTime();
        return Number.isFinite(t) ? t : now;
      });
      const latest = Math.max(...finishes);
      totalSeconds = Math.max(0, Math.round((latest - earliest) / 1000));
    }
  }

  return `<!doctype html>
<html><head><title>SAL Jobs</title>
<style>
body{font-family:Arial,sans-serif;margin:20px;}
table{border-collapse:collapse;width:100%;}
td,th{border:1px solid #ddd;padding:8px;}
th{background:#2c3e50;color:white;font-weight:600;}
details summary{font-weight:600;color:#0066cc;}
details summary:hover{color:#004499;}
.legend{margin:10px 0;display:flex;gap:20px;font-size:14px;}
.legend-item{display:flex;align-items:center;gap:6px;}
.legend-box{width:20px;height:20px;border:1px solid #999;}
</style>
</head><body>
<h1>SAL Job Queue</h1>
<p>Active: ${active}/${concurrency} | Pending: ${queue.length} | Total jobs: ${jobs.size}<br>
Total time: ${totalSeconds !== null ? totalSeconds + "s" : "-"}</p>
<div class="legend">
  <div class="legend-item"><div class="legend-box" style="background:#f0f0f0;"></div><span>Queued</span></div>
  <div class="legend-item"><div class="legend-box" style="background:#fff3cd;"></div><span>Running</span></div>
  <div class="legend-item"><div class="legend-box" style="background:#d4edda;"></div><span>Succeeded</span></div>
  <div class="legend-item"><div class="legend-box" style="background:#f8d7da;"></div><span>Failed</span></div>
</div>
<table>
<tr><th>ID</th><th>Prompt</th><th>Status</th><th>Created</th><th>Started</th><th>Finished</th><th>Total ms</th><th>Count</th><th>Result</th><th>Error</th></tr>
${rows || "<tr><td colspan='10'>No jobs yet</td></tr>"}
</table>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  if (!authOk(req)) {
    res.writeHead(401);
    res.end("unauthorized");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && path === "/ui") {
    return html(res, renderUi());
  }

  if (req.method === "GET" && path === "/metrics") {
    return json(res, 200, {
      ...metrics,
      active,
      pending: queue.length,
      jobs: jobs.size,
      shuttingDown
    });
  }

  if (req.method === "GET" && path === "/jobs") {
    return json(res, 200, { jobs: [...jobs.values()] });
  }

  if (req.method === "GET" && path.startsWith("/jobs/")) {
    const id = path.split("/")[2];
    const job = jobs.get(id);
    if (!job) return json(res, 404, { error: "not_found" });
    return json(res, 200, job);
  }

  if (req.method === "POST" && path === "/jobs") {
    try {
      const body = await parseBody(req);
      const prompt = (body.prompt || "").toString();
      if (!prompt.trim()) return json(res, 400, { error: "prompt_required" });

      const id = body.runId || `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const job = {
        id,
        prompt,
        env: body.env || {},
        status: "queued",
        createdAt: new Date().toISOString()
      };
      jobs.set(id, job);
      enqueue(job);
      return json(res, 202, { id, status: "queued" });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  res.writeHead(404);
  res.end("not found");
});

// Initialize shared resources before starting server
async function initializeServices() {
  try {
    console.log("[JOB] Initializing services...");

    // Initialize plan cache once
    await initPlanCache();
    console.log("[JOB] Plan cache initialized");

    // Initialize CDP pool once with configured size
    const cdpPoolSize = parseInt(process.env.CDP_POOL_SIZE || "5", 10);
    const cdpUrl = process.env.LIGHTPANDA_CDP_URL || "ws://lightpanda:9222";

    console.log(`[JOB] Initializing CDP pool with ${cdpPoolSize} connections to ${cdpUrl}`);
    await initCDPPool({ size: cdpPoolSize, cdpUrl });
    console.log("[JOB] CDP pool initialized successfully");

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`[JOB] Service listening on ${PORT}, concurrency=${concurrency}`);
      console.log(`[JOB] CDP Pool: ${cdpPoolSize} slots`);
      console.log(`[JOB] Ready to process jobs`);
    });
  } catch (err) {
    console.error("[JOB] Failed to initialize services:", err);
    process.exit(1);
  }
}

async function shutdown() {
  shuttingDown = true;
  console.log("[JOB] Shutting down, waiting for active jobs to finish...");
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start the service
initializeServices();
