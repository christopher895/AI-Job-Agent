import crypto from "crypto";
import { pool } from "./pool";
import { MasterResume, MasterResumeSchema, Suggestion } from "../ai/types";
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
  /** 'pending' while the generate->critique->revise pipeline is still running in the background. */
  status: "pending" | "awaiting_review" | "ready" | "failed";
  /** Error from the tailoring pipeline itself, set when status = 'failed'. */
  error: string | null;
  /** Current pipeline step while status = 'pending' (e.g. "Drafting resume (pass 1)"); null otherwise. */
  stage: string | null;
  /** When the current `stage` began — used to estimate progress; null whenever `stage` is null. */
  stage_started_at: Date | null;
  suggestions: Suggestion[] | null;
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
  status: string | null;
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
  return { ...FILTERS, ...(rows[0].data as Partial<Preferences>) };
}

export async function updatePreferences(data: Preferences): Promise<void> {
  await pool.query(
    "UPDATE preferences SET data = $1, updated_at = NOW() WHERE id = 1",
    [JSON.stringify(data)]
  );
}

// ── Tailored resumes ───────────────────────────────────────────────────────────

const TAILORED_RESUME_COLUMNS =
  "id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, status, error, stage, stage_started_at, suggestions, created_at, updated_at";

/** Inserts a placeholder row immediately so POST /api/tailor can respond before the pipeline runs. */
export async function createPendingResume(fields: {
  jobTitle?: string;
  company?: string;
  location?: string;
  jobUrl?: string;
  jdText?: string;
}): Promise<TailoredResumeRow> {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resumes (job_title, company, location, job_url, jd_text, markdown, status)
     VALUES ($1, $2, $3, $4, $5, '', 'pending')
     RETURNING ${TAILORED_RESUME_COLUMNS}`,
    [fields.jobTitle ?? null, fields.company ?? null, fields.location ?? null, fields.jobUrl ?? null,
     fields.jdText ?? null]
  );
  return rows[0];
}

/** Marks a pending resume as ready once the tailoring pipeline finishes successfully. */
export async function completeTailoredResume(
  id: string,
  fields: { markdown: string; criticScore?: number; suggestions?: Suggestion[] }
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE tailored_resumes
     SET markdown     = $1,
         critic_score = $2,
         suggestions  = COALESCE($3, suggestions),
         status       = 'ready',
         error        = NULL,
         updated_at   = NOW()
     WHERE id = $4`,
    [fields.markdown, fields.criticScore ?? null, fields.suggestions ? JSON.stringify(fields.suggestions) : null, id]
  );
  if (rowCount === 0) {
    console.warn(`[queries] completeTailoredResume: row ${id} no longer exists (deleted mid-generation?)`);
  }
}

/** Marks a pending resume as failed when the background pipeline throws. */
export async function failTailoredResume(id: string, message: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE tailored_resumes SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
    [message, id]
  );
  if (rowCount === 0) {
    console.warn(`[queries] failTailoredResume: row ${id} no longer exists (deleted mid-generation?)`);
  }
}

export async function getTailoredResume(id: string): Promise<TailoredResumeRow | null> {
  const { rows } = await pool.query(
    `SELECT ${TAILORED_RESUME_COLUMNS} FROM tailored_resumes WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listTailoredResumes(): Promise<ResumeListItem[]> {
  const { rows } = await pool.query(
    `SELECT id, job_title, company, location, job_url, critic_score, pdf_error, status, error, created_at, updated_at
     FROM tailored_resumes WHERE kind = 'tailored' ORDER BY created_at DESC`
  );
  return rows;
}

export async function updateTailoredResume(
  id: string,
  fields: { markdown?: string; jobTitle?: string; company?: string }
): Promise<TailoredResumeRow | null> {
  const { rows } = await pool.query(
    `UPDATE tailored_resumes
     SET markdown   = COALESCE($1, markdown),
         job_title  = COALESCE($2, job_title),
         company    = COALESCE($3, company),
         updated_at = NOW()
     WHERE id = $4
     RETURNING ${TAILORED_RESUME_COLUMNS}`,
    [fields.markdown ?? null, fields.jobTitle ?? null, fields.company ?? null, id]
  );
  return rows[0] ?? null;
}

/** Records the pipeline's current step for a pending row. Fire-and-forget by callers — a failed write must never abort generation. */
export async function updateResumeStage(id: string, stage: string): Promise<void> {
  await pool.query("UPDATE tailored_resumes SET stage = $1, stage_started_at = NOW() WHERE id = $2", [stage, id]);
}

/** Stores the freshly generated suggestions and moves the row into human review. */
export async function setSuggestions(id: string, suggestions: Suggestion[]): Promise<void> {
  await pool.query(
    `UPDATE tailored_resumes SET suggestions = $1, status = 'awaiting_review', stage = NULL, stage_started_at = NULL, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(suggestions), id]
  );
}

/** Moves an awaiting_review row back into 'pending' right as POST /apply-suggestions starts its background work — reuses the same pending/polling UI the rest of the app already has. */
export async function beginApplyingSuggestions(id: string): Promise<void> {
  await pool.query(`UPDATE tailored_resumes SET status = 'pending', stage = NULL, stage_started_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
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
  // status is nullable, so an explicit "" (clear status) must be distinguished from
  // "field omitted" (leave status untouched) — a plain COALESCE can't tell those apart.
  const { rows } = await pool.query(
    `UPDATE applied_jobs
     SET status     = CASE WHEN $1::boolean THEN $2 ELSE status END,
         sheets_row = COALESCE($3, sheets_row)
     WHERE id = $4
     RETURNING *`,
    [fields.status !== undefined, fields.status || null, fields.sheetsRow ?? null, id]
  );
  return rows[0] ?? null;
}

const PLAYGROUND_IP_PEPPER = process.env.PLAYGROUND_IP_PEPPER ?? "dev-only-pepper-set-a-real-one-in-prod";

/** Hashes an IP with a server-only pepper so raw IPs never sit in the DB. */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(`${PLAYGROUND_IP_PEPPER}:${ip}`).digest("hex");
}

export async function logPlaygroundUsage(ipHash: string): Promise<void> {
  await pool.query(`INSERT INTO playground_usage (ip_hash) VALUES ($1)`, [ipHash]);
}

export async function countRecentPlaygroundUsage(ipHash: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM playground_usage WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [ipHash]
  );
  return rows[0].count;
}

// ── Gmail ingestion: sync state + processed messages ─────────────────────────

export async function getGmailSyncState(): Promise<{ history_id: string | null; last_synced_at: Date | null }> {
  const { rows } = await pool.query("SELECT history_id, last_synced_at FROM gmail_sync_state WHERE id = 1");
  return rows[0] ?? { history_id: null, last_synced_at: null };
}

export async function setGmailSyncState(historyId: string): Promise<void> {
  await pool.query(
    `INSERT INTO gmail_sync_state (id, history_id, last_synced_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET history_id = EXCLUDED.history_id, last_synced_at = NOW()`,
    [historyId]
  );
}

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM gmail_processed_messages WHERE message_id = $1", [messageId]);
  return (rowCount ?? 0) > 0;
}

export async function markMessageProcessed(messageId: string): Promise<void> {
  await pool.query(
    "INSERT INTO gmail_processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING",
    [messageId]
  );
}

// ── Gmail ingestion: status events ───────────────────────────────────────────

export type StatusEventRow = {
  id: string;
  application_id: string;
  status: string;
  source: "manual" | "email";
  deadline_at: Date | null;
  email_message_id: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  occurred_at: Date;
};

export async function createStatusEvent(fields: {
  applicationId: string;
  status: string;
  source: "manual" | "email";
  deadlineAt?: Date | null;
  emailMessageId?: string | null;
  emailSubject?: string | null;
  emailSnippet?: string | null;
  emailLink?: string | null;
}): Promise<StatusEventRow> {
  const { rows } = await pool.query(
    `INSERT INTO status_events
       (application_id, status, source, deadline_at, email_message_id, email_subject, email_snippet, email_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      fields.applicationId, fields.status, fields.source, fields.deadlineAt ?? null,
      fields.emailMessageId ?? null, fields.emailSubject ?? null,
      fields.emailSnippet ?? null, fields.emailLink ?? null,
    ]
  );
  return rows[0];
}

/** All status events, grouped by application_id, each list ascending by occurred_at. */
export async function listStatusEventsByApplication(): Promise<Record<string, StatusEventRow[]>> {
  const { rows } = await pool.query<StatusEventRow>(
    "SELECT * FROM status_events ORDER BY occurred_at ASC"
  );
  const out: Record<string, StatusEventRow[]> = {};
  for (const r of rows) (out[r.application_id] ??= []).push(r);
  return out;
}

// ── Gmail ingestion: review queue ────────────────────────────────────────────

export type ReviewQueueRow = {
  id: string;
  email_message_id: string;
  email_from: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  detected_status: string | null;
  detected_deadline_at: Date | null;
  suggested_application_id: string | null;
  match_score: number | null;
  created_at: Date;
  resolved_at: Date | null;
};

export async function enqueueReview(fields: {
  emailMessageId: string;
  emailFrom?: string;
  emailSubject?: string;
  emailSnippet?: string;
  emailLink?: string;
  detectedStatus?: string;
  detectedDeadlineAt?: Date | null;
  suggestedApplicationId?: string | null;
  matchScore?: number | null;
}): Promise<ReviewQueueRow> {
  const { rows } = await pool.query(
    `INSERT INTO email_review_queue
       (email_message_id, email_from, email_subject, email_snippet, email_link,
        detected_status, detected_deadline_at, suggested_application_id, match_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (email_message_id) DO NOTHING
     RETURNING *`,
    [
      fields.emailMessageId, fields.emailFrom ?? null, fields.emailSubject ?? null,
      fields.emailSnippet ?? null, fields.emailLink ?? null, fields.detectedStatus ?? null,
      fields.detectedDeadlineAt ?? null, fields.suggestedApplicationId ?? null, fields.matchScore ?? null,
    ]
  );
  // ON CONFLICT DO NOTHING returns no row when the message is already queued — read it back.
  if (rows[0]) return rows[0];
  const existing = await pool.query("SELECT * FROM email_review_queue WHERE email_message_id = $1", [fields.emailMessageId]);
  return existing.rows[0];
}

export async function listPendingReviews(): Promise<ReviewQueueRow[]> {
  const { rows } = await pool.query(
    "SELECT * FROM email_review_queue WHERE resolved_at IS NULL ORDER BY created_at DESC"
  );
  return rows;
}

export async function getReview(id: string): Promise<ReviewQueueRow | null> {
  const { rows } = await pool.query("SELECT * FROM email_review_queue WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function resolveReview(id: string): Promise<void> {
  await pool.query("UPDATE email_review_queue SET resolved_at = NOW() WHERE id = $1", [id]);
}

export async function getAppliedJob(id: string): Promise<AppliedJobRow | null> {
  const { rows } = await pool.query("SELECT * FROM applied_jobs WHERE id = $1", [id]);
  return rows[0] ?? null;
}
