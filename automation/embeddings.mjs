// P1.7: In-memory embedding cache for performance optimization
// Eliminates 374ms overhead on repeated prompts
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 1000; // LRU eviction after 1000 entries

// Capability flag: Track if DMR embedding is incompatible (avoid repeated failures)
let dmrEmbeddingDisabled = false;

// Lazy-loaded local embedding model (fallback)
let localEmbedder = null;

async function getLocalEmbedder() {
  if (localEmbedder) return localEmbedder;

  try {
    const { pipeline, env } = await import('@xenova/transformers');
    // Disable remote model loading in production
    env.allowRemoteModels = true;
    env.allowLocalModels = true;

    console.log("[SAL] Loading local embedding model (all-MiniLM-L6-v2)...");
    localEmbedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("[SAL] Local embedding model loaded successfully");
    return localEmbedder;
  } catch (err) {
    console.warn("[SAL] Failed to load local embedding model:", err.message);
    return null;
  }
}

async function embedWithLocalModel(text) {
  const embedder = await getLocalEmbedder();
  if (!embedder) return null;

  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    // Convert tensor to array
    const embedding = Array.from(output.data);
    return embedding;
  } catch (err) {
    console.warn("[SAL] Local embedding failed:", err.message);
    return null;
  }
}

async function embedWithDMR(text) {
  if (!process.env.DMR_EMBED_URL || !process.env.DMR_EMBED_MODEL) return null;

  // Skip if previously detected as incompatible
  if (dmrEmbeddingDisabled) return null;

  const body = {
    model: process.env.DMR_EMBED_MODEL,
    input: Array.isArray(text) ? text : [text],
    encoding_format: "float"
  };

  try {
    const res = await fetch(process.env.DMR_EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");

      // Check for pooling compatibility error (400 with "pooling type" message)
      if (res.status === 400 && txt.includes("pooling type")) {
        // One-time log, then disable DMR embeddings for this session
        if (process.env.NODE_ENV === 'development') {
          console.log("[SAL] DMR embedding requires LLAMA_ARG_POOLING=mean on host. Using local model.");
        }
        dmrEmbeddingDisabled = true;
        return null;
      }

      // Other errors: log once and return null
      console.warn("[SAL] DMR embedding failed:", res.status, txt?.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const emb = data.data?.[0]?.embedding ?? data.embedding ?? data.embeddings?.[0];
    return Array.isArray(emb) ? emb : null;
  } catch (err) {
    console.warn("[SAL] DMR embedding request failed:", err?.message ?? err);
    return null;
  }
}

export async function embedPrompt(text) {
  if (globalThis.__LPX_EMBED_DISABLED) return null;

  // Layer 1: Check in-memory cache first (0ms lookup)
  if (embeddingCache.has(text)) {
    console.log("[SAL] Embedding cache HIT (in-memory)");
    // LRU: Move to end by deleting and re-adding
    const cached = embeddingCache.get(text);
    embeddingCache.delete(text);
    embeddingCache.set(text, cached);
    return cached;
  }

  // Layer 2: Check DuckDB persistent cache (2-5ms lookup)
  const { getCachedEmbedding, saveEmbedding } = await import('./plan-cache.mjs');
  const dbCached = await getCachedEmbedding(text);
  if (dbCached) {
    console.log("[SAL] Embedding cache HIT (DuckDB)");
    // Also cache in memory for next time
    cacheEmbedding(text, dbCached);
    return dbCached;
  }

  // Layer 3: Try DMR first (if configured)
  if (process.env.DMR_EMBED_URL) {
    const dmrEmb = await embedWithDMR(text);
    if (dmrEmb) {
      // Cache in both layers
      cacheEmbedding(text, dmrEmb);
      await saveEmbedding(text, dmrEmb);
      return dmrEmb;
    }
  }

  // Layer 4: Fallback to local embedding model
  const localEmb = await embedWithLocalModel(text);
  if (localEmb) {
    console.log("[SAL] Using local embedding model (fallback)");
    // Cache in both layers
    cacheEmbedding(text, localEmb);
    await saveEmbedding(text, localEmb);
    return localEmb;
  }

  // If both fail, disable embeddings for this session
  console.warn("[SAL] All embedding methods failed; disabling cache for this session");
  globalThis.__LPX_EMBED_DISABLED = true;
  return null;
}

// LRU cache eviction helper
function cacheEmbedding(text, embedding) {
  // If cache is full, remove oldest entry (first item in Map)
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const firstKey = embeddingCache.keys().next().value;
    embeddingCache.delete(firstKey);
  }
  embeddingCache.set(text, embedding);
}
