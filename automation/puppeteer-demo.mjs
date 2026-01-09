import puppeteer from "puppeteer";
import { chromium as pwChromium } from "playwright";

const resolveBase = () => {
  const url = new URL(process.env.TARGET_BASE_URL);
  if (["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.hostname = "host.docker.internal";
  }
  return url.toString().replace(/\/$/, "");
};

const BASE = resolveBase();
const LOGIN_URL = `${BASE}${process.env.LOGIN_PATH}`;
const ITEMS_URL = `${BASE}${process.env.ITEMS_PATH}`;
const EMAIL_SEL = process.env.LOGIN_EMAIL_SELECTOR;
const PASS_SEL = process.env.LOGIN_PASSWORD_SELECTOR;
const SUBMIT_SEL = process.env.LOGIN_SUBMIT_SELECTOR;
const ITEMS_SEL = process.env.ITEMS_SELECTOR;

async function run() {
  console.log("=== Puppeteer Benchmark ===");
  console.log(`Using base URL: ${BASE}`);

  const start = Date.now();
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: pwChromium.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ignoreHTTPSErrors: true
  });
  const page = await browser.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "networkidle0" });
  await page.type(EMAIL_SEL, process.env.USER_EMAIL);
  await page.type(PASS_SEL, process.env.USER_PASS);

  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
  await Promise.all([
    nav,
    page.click(SUBMIT_SEL)
  ]);

  if (!nav) {
    await page.goto(ITEMS_URL, { waitUntil: "domcontentloaded" });
  } else if (!page.url().includes(ITEMS_URL)) {
    await page.goto(ITEMS_URL, { waitUntil: "domcontentloaded" });
  }

  const items = await page.$$eval(ITEMS_SEL, nodes =>
    nodes.map(n => ({
      text: n.textContent.trim(),
      attrs: Object.fromEntries([...n.attributes].map(a => [a.name, a.value]))
    }))
  );

  console.log({ count: items.length, items });
  const elapsed = Date.now() - start;
  const durationLabel = (() => {
    if (elapsed >= 60000) {
      const m = Math.floor(elapsed / 60000);
      const s = Math.round((elapsed % 60000) / 1000);
      return `${m}min.${s}sec`;
    }
    return `${Math.round(elapsed / 1000)}sec`;
  })();

  console.log(`\n==== Puppeteer duration: ${durationLabel} ====\n`);
  await browser.close();
}

run();
