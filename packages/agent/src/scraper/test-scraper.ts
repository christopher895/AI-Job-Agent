import { scrapeJobright } from "./playwright";

async function main() {
  console.log("Scraping Jobright...");
  const jobs = await scrapeJobright();
  console.log(`Found ${jobs.length} jobs:\n`);
  jobs.slice(0, 10).forEach((j, i) => {
    console.log(`${i + 1}. ${j.title}`);
    console.log(`   ${j.company} — ${j.location}`);
    console.log(`   ${j.url}\n`);
  });
}

main().catch(console.error);
