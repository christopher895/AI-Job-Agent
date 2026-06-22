import { initSchema } from "../db/schema";
import { runJobrightScrape } from "./index";

async function main() {
  await initSchema();
  console.log("Running scrape + diff...");
  const newJobs = await runJobrightScrape();

  if (newJobs.length === 0) {
    console.log("No new jobs since last scrape.");
  } else {
    console.log(`${newJobs.length} new job(s) detected:\n`);
    newJobs.forEach((j, i) => {
      console.log(`${i + 1}. ${j.title}`);
      console.log(`   ${j.company}`);
      console.log(`   ${j.url}\n`);
    });
  }
}

main().catch(console.error);
