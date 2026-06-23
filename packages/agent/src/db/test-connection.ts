import { pool } from "./pool";
import { initSchema } from "./schema";

async function main() {
  console.log("Connecting to database...");
  const { rows } = await pool.query("SELECT NOW() AS time");
  console.log("Connected:", rows[0].time);

  await initSchema();

  // Seed a test company if the table is empty
  const { rows: existing } = await pool.query("SELECT COUNT(*) FROM companies");
  if (existing[0].count === "0") {
    await pool.query(`INSERT INTO companies (name, careers_url, scrape_type) VALUES ($1, $2, $3)`, [
      "Stripe",
      "https://stripe.com/jobs",
      "playwright",
    ]);
    console.log("Seeded test company: Stripe");
  }

  const { rows: companies } = await pool.query("SELECT * FROM companies");
  console.log("Companies:", companies);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
