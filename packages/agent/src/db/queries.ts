import { pool } from "./pool";
import { MasterResume, MasterResumeSchema } from "../ai/types";
import { Preferences, FILTERS } from "../config";

export type TailoredResumeRow = {
  id: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  job_url: string | null;
  jd_text: string | null;
  markdown: string;
  critic_score: number | null;
  /** Error from the most recent PDF render attempt; null if the last attempt succeeded. */
  pdf_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ResumeListItem = Omit<TailoredResumeRow, "jd_text" | "markdown">;

export type AppliedJobRow = {
  id: string;
  company: string;
  job_title: string;
  location: string | null;
  job_url: string | null;
  status: string;
  applied_at: Date;
  resume_id: string | null;
  sheets_row: number | null;
};

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

// ── Master resume ──────────────────────────────────────────────────────────────

export async function getMasterResume(): Promise<MasterResume> {
  const { rows } = await pool.query("SELECT data FROM master_resume WHERE id = 1");
  if (rows.length === 0) {
    // Table exists but was never seeded — seed now and return the default.
    const { MASTER_RESUME } = await import("../ai/master-resume");
    await pool.query(
      "INSERT INTO master_resume (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
      [JSON.stringify(MASTER_RESUME)]
    );
    return MASTER_RESUME;
  }
  return MasterResumeSchema.parse(rows[0].data);
}

export async function updateMasterResume(data: MasterResume): Promise<void> {
  await pool.query(
    "UPDATE master_resume SET data = $1, updated_at = NOW() WHERE id = 1",
    [JSON.stringify(data)]
  );
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function getPreferences(): Promise<Preferences> {
  const { rows } = await pool.query("SELECT data FROM preferences WHERE id = 1");
  if (rows.length === 0) {
    await pool.query(
      "INSERT INTO preferences (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
      [JSON.stringify(FILTERS)]
    );
    return FILTERS;
  }
  return rows[0].data as Preferences;
}

export async function updatePreferences(data: Preferences): Promise<void> {
  await pool.query(
    "UPDATE preferences SET data = $1, updated_at = NOW() WHERE id = 1",
    [JSON.stringify(data)]
  );
}

// ── Tailored resumes ───────────────────────────────────────────────────────────

export async function createTailoredResume(fields: {
  jobTitle?: string;
  company?: string;
  location?: string;
  jobUrl?: string;
  jdText?: string;
  markdown: string;
  criticScore?: number;
}): Promise<TailoredResumeRow> {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resumes (job_title, company, location, job_url, jd_text, markdown, critic_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, created_at, updated_at`,
    [fields.jobTitle ?? null, fields.company ?? null, fields.location ?? null, fields.jobUrl ?? null,
     fields.jdText ?? null, fields.markdown, fields.criticScore ?? null]
  );
  return rows[0];
}

export async function getTailoredResume(id: string): Promise<TailoredResumeRow | null> {
  const { rows } = await pool.query(
    `SELECT id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, created_at, updated_at
     FROM tailored_resumes WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listTailoredResumes(): Promise<ResumeListItem[]> {
  const { rows } = await pool.query(
    `SELECT id, job_title, company, location, job_url, critic_score, pdf_error, created_at, updated_at
     FROM tailored_resumes ORDER BY created_at DESC`
  );
  return rows;
}

export async function updateTailoredResume(id: string, markdown: string): Promise<TailoredResumeRow | null> {
  const { rows } = await pool.query(
    `UPDATE tailored_resumes SET markdown = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, created_at, updated_at`,
    [markdown, id]
  );
  return rows[0] ?? null;
}

export async function storePdf(id: string, pdf: Buffer): Promise<void> {
  await pool.query(
    "UPDATE tailored_resumes SET pdf = $1, pdf_error = NULL, updated_at = NOW() WHERE id = $2",
    [pdf, id]
  );
}

export async function getPdf(id: string): Promise<Buffer | null> {
  const { rows } = await pool.query("SELECT pdf FROM tailored_resumes WHERE id = $1", [id]);
  return rows[0]?.pdf ?? null;
}

/** Records why the most recent PDF render attempt failed, without touching the last-good PDF. */
export async function setPdfError(id: string, message: string): Promise<void> {
  await pool.query("UPDATE tailored_resumes SET pdf_error = $1 WHERE id = $2", [message, id]);
}

/** Deletes a tailored resume. Any applied_jobs row referencing it keeps its row with resume_id set to NULL. */
export async function deleteTailoredResume(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM tailored_resumes WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

// ── Applied jobs ───────────────────────────────────────────────────────────────

export async function createAppliedJob(fields: {
  company: string;
  jobTitle: string;
  location?: string;
  jobUrl?: string;
  status?: string;
  appliedAt?: Date;
  resumeId?: string;
}): Promise<AppliedJobRow> {
  const { rows } = await pool.query(
    `INSERT INTO applied_jobs (company, job_title, location, job_url, status, applied_at, resume_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      fields.company, fields.jobTitle, fields.location ?? null, fields.jobUrl ?? null,
      fields.status ?? "applied", fields.appliedAt ?? new Date(), fields.resumeId ?? null,
    ]
  );
  return rows[0];
}

export async function listAppliedJobs(): Promise<AppliedJobRow[]> {
  const { rows } = await pool.query("SELECT * FROM applied_jobs ORDER BY applied_at DESC");
  return rows;
}

export async function updateAppliedJob(
  id: string,
  fields: { status?: string; sheetsRow?: number }
): Promise<AppliedJobRow | null> {
  const { rows } = await pool.query(
    `UPDATE applied_jobs
     SET status     = COALESCE($1, status),
         sheets_row = COALESCE($2, sheets_row)
     WHERE id = $3
     RETURNING *`,
    [fields.status ?? null, fields.sheetsRow ?? null, id]
  );
  return rows[0] ?? null;
}
