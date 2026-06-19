import { pool } from "./pool";

export async function getActiveCompanies() {
  const { rows } = await pool.query(
    "SELECT * FROM companies WHERE active = true ORDER BY name"
  );
  return rows;
}

export async function upsertJob(
  companyId: number,
  title: string,
  url: string,
  description?: string
) {
  const { rows } = await pool.query(
    `INSERT INTO jobs (company_id, title, url, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (url) DO NOTHING
     RETURNING *`,
    [companyId, title, url, description ?? null]
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

export async function saveSnapshot(
  companyId: number,
  rawHtml: string,
  jobHashes: string[]
) {
  await pool.query(
    "INSERT INTO snapshots (company_id, raw_html, job_hashes) VALUES ($1, $2, $3)",
    [companyId, rawHtml, jobHashes]
  );
}
