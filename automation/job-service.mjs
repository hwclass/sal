import http from "http";
import { runSal } from "./sal-cli.mjs";

const PORT = parseInt(process.env.JOB_SERVICE_PORT || "8787", 10);
const AUTH_TOKEN = process.env.JOB_SERVICE_TOKEN || "";

const jobs = new Map();
const queue = [];
let processing = false;
const concurrency = parseInt(process.env.JOB_CONCURRENCY || process.env.CDP_POOL_SIZE || "1", 10) || 1;
let active = 0;

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
  queue.push(job);
  drain();
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
  jobs.set(job.id, { ...job, status: "running", startedAt: new Date().toISOString() });
  try {
    const result = await runSal(job.prompt, { envOverrides: job.env || {}, runId: job.id });
    jobs.set(job.id, {
      ...job,
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      summary: result
    });
  } catch (err) {
    jobs.set(job.id, {
      ...job,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: err?.message || String(err)
    });
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
  const rows = [...jobs.values()]
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .map(
      (j) =>
        `<tr>
          <td>${j.id}</td>
          <td>${j.prompt}</td>
          <td>${j.status}</td>
          <td>${j.createdAt || ""}</td>
          <td>${j.startedAt || ""}</td>
          <td>${j.finishedAt || ""}</td>
          <td>${j.summary?.timings?.total_ms || ""}</td>
          <td>${j.summary?.result_count ?? ""}</td>
          <td>${j.error || ""}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html><head><title>SAL Jobs</title>
<style>body{font-family:Arial,sans-serif;margin:20px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ddd;padding:6px;}th{background:#f5f5f5;}</style>
</head><body>
<h1>SAL Job Queue</h1>
<p>Active: ${active}/${concurrency} | Pending: ${queue.length} | Total jobs: ${jobs.size}</p>
<table>
<tr><th>ID</th><th>Prompt</th><th>Status</th><th>Created</th><th>Started</th><th>Finished</th><th>Total ms</th><th>Count</th><th>Error</th></tr>
${rows || "<tr><td colspan='9'>No jobs yet</td></tr>"}
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

server.listen(PORT, () => {
  console.log(`[JOB] Service listening on ${PORT}, concurrency=${concurrency}`);
});
