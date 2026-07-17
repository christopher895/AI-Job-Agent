import type { Browser } from "playwright";

const CLOSE_TIMEOUT_MS = 10_000;

// browser.close() has no built-in timeout. If the underlying Chromium process
// has already crashed (e.g. after a "Page crashed" / "Target crashed" error —
// the OS has typically already killed the renderer by that point), close()
// can hang forever waiting on an acknowledgment that will never come,
// wedging whatever awaited it. In the scheduler's case that's permanent:
// every tick after that blocks on the same in-flight mutex forever.
// Race close() against a timeout instead of awaiting it unconditionally, so
// cleanup always completes even if the underlying process never responds.
export async function closeBrowserSafely(browser: Browser): Promise<void> {
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, CLOSE_TIMEOUT_MS);
  });

  await Promise.race([browser.close().catch(() => {}), timeout]);

  if (timedOut) {
    // `Browser` (from chromium.launch()) doesn't expose the underlying OS process
    // in this Playwright version — only BrowserServer (launchServer()) does — so
    // there's no supported way to force-kill it from here. This just stops
    // waiting on it; the process may still be running.
    console.warn("[browser-utils] browser.close() did not resolve within " + CLOSE_TIMEOUT_MS + "ms — abandoning it");
  }
}
