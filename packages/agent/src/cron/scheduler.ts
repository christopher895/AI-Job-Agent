import cron from "node-cron";
import { runAllCompanyScrapes } from "../scraper/index";

// Guards against a slow/hung run still being in flight when the next 15-min
// tick fires — without this, an overlapping tick launches a second batch of
// 52 concurrent company fetches on top of the first, compounding load
// instead of replacing it.
let tickInFlight = false;

async function runTick() {
  if (tickInFlight) {
    console.warn("[scheduler] Previous tick still running — skipping this tick");
    return;
  }
  tickInFlight = true;
  try {
    await runAllCompanyScrapes().catch((err) => console.error("[scheduler] Run failed:", err));
  } finally {
    tickInFlight = false;
  }
}

export function startScheduler() {
  // Run immediately on startup, then every 15 minutes
  runTick();

  cron.schedule("*/15 * * * *", () => {
    console.log(`[scheduler] Tick — ${new Date().toLocaleTimeString()}`);
    runTick();
  });

  console.log("[scheduler] Started — scanning companies every 15 minutes");
}
