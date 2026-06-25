import cron from "node-cron";
import { runAllCompanyScrapes } from "../scraper/index";

export function startScheduler() {
  // Run immediately on startup, then every 15 minutes
  runAllCompanyScrapes().catch((err) => console.error("[scheduler] Initial run failed:", err));

  cron.schedule("*/15 * * * *", () => {
    console.log(`[scheduler] Tick — ${new Date().toLocaleTimeString()}`);
    runAllCompanyScrapes().catch((err) => console.error("[scheduler] Run failed:", err));
  });

  console.log("[scheduler] Started — scanning companies every 15 minutes");
}
