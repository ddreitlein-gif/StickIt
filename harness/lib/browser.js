/**
 * Playwright layer (FR-21) — client-only behavior (PIN tiles, device role
 * memory, seat picker, reboot-return, check-in freeze screens) cannot be
 * verified by an HTTP driver. Established in Step 0 as a foundation; used by
 * Step 3 acceptance and the crash tests.
 */

const { chromium } = require('playwright');

let browserSingleton = null;

async function getBrowser() {
  if (!browserSingleton) {
    browserSingleton = await chromium.launch({ headless: true });
  }
  return browserSingleton;
}

/**
 * Run fn(page, context) in a fresh browser context (fresh localStorage —
 * i.e. a "new tablet"). Context persists only within the callback unless
 * you keep it via withContext below.
 */
async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    return await fn(page, context);
  } finally {
    await context.close();
  }
}

/**
 * Create a persistent context ("one physical tablet"). The caller may close
 * and reopen pages inside it to simulate reboots while keeping localStorage.
 * Returns { context, newPage, close }.
 */
async function newTablet() {
  const browser = await getBrowser();
  const context = await browser.newContext();
  return {
    context,
    newPage: () => context.newPage(),
    close: () => context.close(),
  };
}

async function shutdownBrowser() {
  if (browserSingleton) {
    await browserSingleton.close();
    browserSingleton = null;
  }
}

module.exports = { withPage, newTablet, shutdownBrowser };
