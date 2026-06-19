import { Worker } from "bullmq";
import "dotenv/config";

export function startWorker() {
  const worker = new Worker(
    "scrape",
    async (job) => {
      console.log(`Processing scrape job for company ${job.data.companyId}`);
      // Day 2: wire in playwright/cheerio scraper here
    },
    { connection: { url: process.env.REDIS_URL }, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
