import { Queue } from "bullmq";
import "dotenv/config";

export const scrapeQueue = new Queue("scrape", {
  connection: { url: process.env.REDIS_URL },
});

export async function enqueueScrape(companyId: number) {
  await scrapeQueue.add("scrape-company", { companyId });
}
