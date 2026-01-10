import { chromium } from "playwright";

const defaultSize = parseInt(process.env.CDP_POOL_SIZE || "1", 10) || 1;
const slots = [];
const waiters = [];
let initialized = false;
let poolUrl = null;

async function connectWithRetry(cdpUrl, attempts = 3, delayMs = 300) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chromium.connectOverCDP(cdpUrl);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

function borrow() {
  return new Promise((resolve, reject) => {
    const free = slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return resolve(free);
    }
    waiters.push({ resolve, reject });
  });
}

function release(slot) {
  slot.busy = false;
  const next = waiters.shift();
  if (next) {
    slot.busy = true;
    next.resolve(slot);
  }
}

export async function initCDPPool({ size = defaultSize, cdpUrl }) {
  if (initialized) {
    console.log(`[CDP-POOL] Already initialized with ${slots.length} slots`);
    return;
  }
  console.log(`[CDP-POOL] Initializing pool with ${size} slots connecting to ${cdpUrl}`);
  poolUrl = cdpUrl;
  for (let i = 0; i < size; i++) {
    const browser = await connectWithRetry(cdpUrl);
    slots.push({ id: i, browser, busy: false });
    console.log(`[CDP-POOL] Slot ${i} connected`);
  }
  initialized = true;
  console.log(`[CDP-POOL] Pool initialized successfully with ${slots.length} slots`);
}

export async function withPage(fn) {
  if (!initialized || !poolUrl) {
    throw new Error("CDP pool not initialized");
  }
  const slot = await borrow();
  let context;
  let page;
  const recreateBrowser = async () => {
    if (slot.browser) {
      try {
        await slot.browser.close();
      } catch {
        // ignore close errors
      }
    }
    slot.browser = await connectWithRetry(poolUrl);
  };

  try {
    if (!slot.browser || (typeof slot.browser.isConnected === "function" && !slot.browser.isConnected())) {
      await recreateBrowser();
    }

    let created = false;
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      try {
        context = await slot.browser.newContext({ ignoreHTTPSErrors: true });
        page = await context.newPage();
        created = true;
      } catch (err) {
        const msg = (err && err.message) || String(err);
        const isClosed =
          msg.includes("has been closed") ||
          msg.includes("Target closed") ||
          msg.includes("Session closed");
        if (!isClosed || attempt === 1) {
          throw err;
        }
        // Browser in pool is dead; recreate and retry once.
        await recreateBrowser();
      }
    }
    if (!created) {
      throw new Error("Failed to create browser context");
    }
    return await fn({ slotId: slot.id, browser: slot.browser, context, page });
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
    release(slot);
  }
}

export async function shutdownCDPPool() {
  const closers = slots.map(async (s) => {
    try {
      await s.browser.close();
    } catch {
      // ignore
    }
  });
  await Promise.all(closers);
  slots.length = 0;
  waiters.length = 0;
  initialized = false;
  poolUrl = null;
}

export function isClosedError(err) {
  const msg = (err && err.message) || String(err);
  return (
    msg.includes("has been closed") ||
    msg.includes("Target closed") ||
    msg.includes("Session closed")
  );
}
