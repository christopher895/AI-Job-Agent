import cron from "node-cron";
import { runAllCompanyScrapes } from "../scraper/index";
import { runWatchedRepoScrapes } from "../scraper/github-repos";
import { runEmailIngest } from "../ingest/email-ingest";

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
    await runAllCompanyScrapes().catch((err) => console.error("[scheduler] Company scrape run failed:", err));
    await runWatchedRepoScrapes().catch((err) => console.error("[scheduler] Watched repo scrape run failed:", err));
  } finally {
    tickInFlight = false;
  }
}

let ingestInFlight = false;
async function runIngestTick() {
  if (process.env.GMAIL_INGEST_ENABLED !== "true") return;
  if (ingestInFlight) { console.warn("[scheduler] Previous ingest tick still running — skipping"); return; }
  ingestInFlight = true;
  try {
    const r = await runEmailIngest();
    console.log(`[scheduler] Gmail ingest: processed=${r.processed} applied=${r.applied} queued=${r.queued}`);
  } catch (err) {
    console.error("[scheduler] Gmail ingest failed:", err);
  } finally {
    ingestInFlight = false;
  }
}

export function startScheduler() {
  runTick();
  runIngestTick();

  cron.schedule("*/15 * * * *", () => {
    console.log(`[scheduler] Tick — ${new Date().toLocaleTimeString()}`);
    runTick();
    runIngestTick();
  });

  console.log("[scheduler] Started — scanning companies every 15 minutes" +
    (process.env.GMAIL_INGEST_ENABLED === "true" ? " (+ Gmail ingest)" : ""));
}
