import cron from "node-cron";
import { runAllCompanyScrapes, runJobrightScrape } from "../scraper/index";

function runJobright() {
  runJobrightScrape().catch((err) => console.error("[scheduler] Jobright run failed:", err));
}

export function startScheduler() {
  // Run immediately on startup, then every 15 minutes
  runAllCompanyScrapes().catch((err) => console.error("[scheduler] Initial run failed:", err));
  runJobright();

  cron.schedule("*/15 * * * *", () => {
    console.log(`[scheduler] Tick — ${new Date().toLocaleTimeString()}`);
    runAllCompanyScrapes().catch((err) => console.error("[scheduler] Run failed:", err));
    runJobright();
  });

  console.log("[scheduler] Started — scanning companies + Jobright every 15 minutes");
}
