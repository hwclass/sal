import duckdb from "duckdb";

let db;
let conn;

// Normalize prompt for better cache reuse
// Remove variable tokens (numbers, emails) and normalize whitespace
function normalizePrompt(prompt) {
  return prompt
    .toLowerCase()
    .trim()
    // Remove specific numbers (e.g., "first 5" → "first N")
    .replace(/\b\d+\b/g, "N")
    // Remove email-like patterns
    .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, "EMAIL")
    // Normalize whitespace
    .replace(/\s+/g, " ");
}

export async function initPlanCache() {
  if (db) return;
  db = new duckdb.Database("plan-cache.duckdb");
  conn = db.connect();

  // Create plans table
  await new Promise((resolve, reject) => {
    conn.run(
      `CREATE TABLE IF NOT EXISTS plans (
         id INTEGER,
         prompt TEXT NOT NULL,
         normalized_prompt TEXT NOT NULL,
         yaml TEXT NOT NULL,
         embedding JSON NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         hits INTEGER DEFAULT 0,
         success_rate REAL DEFAULT 1.0,
         last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         backend TEXT DEFAULT 'intent',
         PRIMARY KEY (id)
       );`,
      (err) => {
        if (err) return reject(err);

        // Create sessions table
        conn.run(
          `CREATE TABLE IF NOT EXISTS sessions (
             id INTEGER,
             base_url TEXT NOT NULL,
             cookies JSON NOT NULL,
             storage JSON,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             expires_at TIMESTAMP NOT NULL,
             last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             PRIMARY KEY (id)
           );`,
          (err) => {
            if (err) return reject(err);

            // Create embeddings table
            conn.run(
              `CREATE TABLE IF NOT EXISTS embeddings (
                 prompt_hash TEXT PRIMARY KEY,
                 prompt_text TEXT NOT NULL,
                 embedding JSON NOT NULL,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
               );`,
              (err) => (err ? reject(err) : resolve())
            );
          }
        );
      }
    );
  });
}

export async function savePlan({ prompt, yaml, embedding, backend = 'intent', success = true }) {
  const embJson = JSON.stringify(embedding);
  const normalized = normalizePrompt(prompt);
  const successRate = success ? 1.0 : 0.0;

  // Get next ID
  const rows = await new Promise((resolve, reject) => {
    conn.all(
      "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM plans;",
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
  const nextId = rows[0].next_id;

  return new Promise((resolve, reject) => {
    conn.run(
      "INSERT INTO plans (id, prompt, normalized_prompt, yaml, embedding, backend, success_rate) VALUES (?, ?, ?, ?, ?, ?, ?);",
      nextId, prompt, normalized, yaml, embJson, backend, successRate,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export async function getAllPlans() {
  return await new Promise((resolve, reject) => {
    conn.all(
      "SELECT id, prompt, normalized_prompt, yaml, embedding, hits, success_rate, last_used, backend FROM plans;",
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export async function incrementHits(id) {
  await new Promise((resolve, reject) => {
    conn.run(
      "UPDATE plans SET hits = hits + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?;",
      id,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export async function updateSuccessRate(id, success) {
  await new Promise((resolve, reject) => {
    // Simple moving average: new_rate = (old_rate * hits + new_result) / (hits + 1)
    conn.run(
      `UPDATE plans
       SET success_rate = (success_rate * hits + ?) / (hits + 1)
       WHERE id = ?;`,
      success ? 1.0 : 0.0, id,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function findBestPlanByEmbedding(embedding, threshold = 0.9) {
  const rows = await getAllPlans();
  let best = null;
  let bestSim = 0;
  for (const row of rows) {
    const emb = JSON.parse(row.embedding || "[]");
    const sim = cosineSimilarity(embedding, emb);
    if (sim > bestSim) {
      bestSim = sim;
      best = row;
    }
  }
  if (best && bestSim >= threshold) {
    return { ...best, similarity: bestSim };
  }
  return null;
}

// ============================================================================
// Session Management
// ============================================================================

export async function saveSession({ baseUrl, cookies, storage = null, ttlSeconds = 3600 }) {
  const cookiesJson = JSON.stringify(cookies);
  const storageJson = storage ? JSON.stringify(storage) : null;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Get next ID
  const rows = await new Promise((resolve, reject) => {
    conn.all(
      "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sessions;",
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
  const nextId = rows[0].next_id;

  return new Promise((resolve, reject) => {
    conn.run(
      "INSERT INTO sessions (id, base_url, cookies, storage, expires_at) VALUES (?, ?, ?, ?, ?);",
      nextId, baseUrl, cookiesJson, storageJson, expiresAt,
      (err) => (err ? reject(err) : resolve(nextId))
    );
  });
}

export async function getValidSession(baseUrl) {
  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    conn.all(
      `SELECT id, base_url, cookies, storage, expires_at, last_used
       FROM sessions
       WHERE base_url = ? AND expires_at > ?
       ORDER BY last_used DESC
       LIMIT 1;`,
      baseUrl, now,
      (err, rows) => {
        if (err) return reject(err);
        if (!rows || rows.length === 0) return resolve(null);

        const session = rows[0];
        resolve({
          id: session.id,
          baseUrl: session.base_url,
          cookies: JSON.parse(session.cookies),
          storage: session.storage ? JSON.parse(session.storage) : null,
          expiresAt: session.expires_at
        });
      }
    );
  });
}

export async function updateSessionLastUsed(sessionId) {
  return new Promise((resolve, reject) => {
    conn.run(
      "UPDATE sessions SET last_used = CURRENT_TIMESTAMP WHERE id = ?;",
      sessionId,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

export async function deleteExpiredSessions() {
  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    conn.run(
      "DELETE FROM sessions WHERE expires_at < ?;",
      now,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

// ============================================================================
// Embedding Cache Management
// ============================================================================

function hashPrompt(text) {
  // Simple hash function for prompt text
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

export async function getCachedEmbedding(promptText) {
  const hash = hashPrompt(promptText);

  return new Promise((resolve, reject) => {
    conn.all(
      `SELECT embedding, last_used
       FROM embeddings
       WHERE prompt_hash = ?
       LIMIT 1;`,
      hash,
      (err, rows) => {
        if (err) return reject(err);
        if (!rows || rows.length === 0) return resolve(null);

        const row = rows[0];
        const embedding = JSON.parse(row.embedding);

        // Update last_used timestamp asynchronously (don't wait)
        conn.run(
          "UPDATE embeddings SET last_used = CURRENT_TIMESTAMP WHERE prompt_hash = ?;",
          hash,
          () => {} // Fire and forget
        );

        resolve(embedding);
      }
    );
  });
}

export async function saveEmbedding(promptText, embedding) {
  const hash = hashPrompt(promptText);
  const embJson = JSON.stringify(embedding);

  return new Promise((resolve, reject) => {
    // Use INSERT OR REPLACE to handle duplicates
    conn.run(
      `INSERT OR REPLACE INTO embeddings (prompt_hash, prompt_text, embedding, created_at, last_used)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      hash, promptText, embJson,
      (err) => (err ? reject(err) : resolve())
    );
  });
}
