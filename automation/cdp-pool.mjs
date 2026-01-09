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
  if (initialized) return;
  poolUrl = cdpUrl;
  for (let i = 0; i < size; i++) {
    const browser = await connectWithRetry(cdpUrl);
    slots.push({ id: i, browser, busy: false });
  }
  initialized = true;
}

export async function withPage(fn) {
  if (!initialized || !poolUrl) {
    throw new Error("CDP pool not initialized");
  }
  const slot = await borrow();
  let context;
  let page;
  try {
    context = await slot.browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
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
