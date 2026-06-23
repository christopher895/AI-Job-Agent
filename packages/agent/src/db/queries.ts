import { pool } from "./pool";

export async function getOrCreateCompany(name: string, careersUrl: string, scrapeType: string) {
  const { rows } = await pool.query(
    `INSERT INTO companies (name, careers_url, scrape_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET careers_url = EXCLUDED.careers_url
     RETURNING *`,
    [name, careersUrl, scrapeType]
  );
  return rows[0];
}

export async function getActiveCompanies() {
  const { rows } = await pool.query("SELECT * FROM companies WHERE active = true ORDER BY name");
  return rows;
}

export async function upsertJob(
  companyId: number,
  title: string,
  companyName: string,
  url: string
) {
  const { rows } = await pool.query(
    `INSERT INTO jobs (company_id, title, company_name, url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (url) DO NOTHING
     RETURNING *`,
    [companyId, title, companyName, url]
  );
  return rows[0] ?? null;
}

export async function getLatestSnapshot(companyId: number) {
  const { rows } = await pool.query(
    "SELECT * FROM snapshots WHERE company_id = $1 ORDER BY scraped_at DESC LIMIT 1",
    [companyId]
  );
  return rows[0] ?? null;
}

export async function saveSnapshot(companyId: number, jobHashes: string[]) {
  await pool.query("INSERT INTO snapshots (company_id, job_hashes) VALUES ($1, $2)", [
    companyId,
    jobHashes,
  ]);
}
