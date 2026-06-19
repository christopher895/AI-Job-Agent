import cron from "node-cron";
import { getActiveCompanies } from "../db/queries";
import { enqueueScrape } from "../queue/producer";

export function startScheduler() {
  cron.schedule("*/15 * * * *", async () => {
    console.log("Cron tick — enqueuing scrapes");
    const companies = await getActiveCompanies();
    for (const company of companies) {
      await enqueueScrape(company.id);
    }
  });

  console.log("Scheduler started — scrapes run every 15 minutes");
}
