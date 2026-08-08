import { pool } from "./pool";

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      careers_url TEXT NOT NULL,
      scrape_type TEXT NOT NULL DEFAULT 'playwright',
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true
  `);

  // Add unique constraint if it doesn't exist yet
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'companies_name_key'
      ) THEN
        ALTER TABLE companies ADD CONSTRAINT companies_name_key UNIQUE (name);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           SERIAL PRIMARY KEY,
      company_id   INTEGER NOT NULL REFERENCES companies(id),
      title        TEXT NOT NULL,
      company_name TEXT,
      url          TEXT NOT NULL UNIQUE,
      description  TEXT,
      detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_new       BOOLEAN NOT NULL DEFAULT true
    )
  `);

  // Safe migration for existing tables
  await pool.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_name TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id),
      raw_html    TEXT,
      job_hashes  TEXT[] NOT NULL DEFAULT '{}',
      scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tailored_resumes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_title    TEXT,
      company      TEXT,
      location     TEXT,
      job_url      TEXT,
      jd_text      TEXT,
      markdown     TEXT NOT NULL DEFAULT '',
      pdf          BYTEA,
      critic_score INT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS master_resume (
      id         INT PRIMARY KEY DEFAULT 1,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preferences (
      id         INT PRIMARY KEY DEFAULT 1,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS applied_jobs (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company    TEXT NOT NULL,
      job_title  TEXT NOT NULL,
      location   TEXT,
      job_url    TEXT,
      status     TEXT NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied','interviewing','rejected','offer','assessment','no_response')),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resume_id  UUID REFERENCES tailored_resumes(id) ON DELETE SET NULL,
      sheets_row INT
    )
  `);

  // Widen the status CHECK constraint on existing tables to include assessment + no_response
  await pool.query(`
    ALTER TABLE applied_jobs DROP CONSTRAINT IF EXISTS applied_jobs_status_check;
    ALTER TABLE applied_jobs ADD CONSTRAINT applied_jobs_status_check
      CHECK (status IN ('applied','interviewing','rejected','offer','assessment','no_response'));
  `);

  // Newly logged applications should start with no status rather than defaulting to
  // 'applied' — the user picks a status explicitly.
  await pool.query(`
    ALTER TABLE applied_jobs ALTER COLUMN status DROP NOT NULL;
    ALTER TABLE applied_jobs ALTER COLUMN status DROP DEFAULT;
  `);

  // Tracks the error from the most recent PDF render attempt, if any, so a failed
  // re-render after an edit doesn't silently leave a stale PDF with no indication.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS pdf_error TEXT;
  `);

  // Job location — captured alongside title/company but was missing from the original
  // table, so it never made it into the Google Sheets applied-jobs row.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS location TEXT;
  `);

  // Tailoring runs as a background job (POST /api/tailor returns immediately with a
  // pending row) because the generate->critique->revise loop routinely runs past
  // Railway's ~300s edge-proxy timeout, which otherwise kills the request outright
  // and surfaces to the browser as a generic "Failed to fetch".
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS error TEXT;
  `);
  // The status CHECK constraint itself is defined once, further down (see the
  // 'awaiting_review' migration below) — NOT here. An intermediate narrower
  // constraint used to be added at this point and widened later; that meant
  // every server restart briefly re-validated ALL existing rows against the
  // narrower set first, which threw (and crashed startup) the instant any row
  // legitimately held a newer status value added downstream — e.g. any resume
  // sitting in 'awaiting_review' would fail this ADD CONSTRAINT on every
  // restart. Postgres validates existing rows against a CHECK constraint at
  // ADD time regardless of DROP CONSTRAINT IF EXISTS just having removed the
  // (wider) previous version, so the fix is to never (re)assert a narrower
  // constraint than the app currently allows — define it exactly once.

  // The general resume: a JD-less, one-page resume synced from Master, reusing
  // this same table/pipeline/editor as job-tailored resumes rather than a
  // parallel stack. 'kind' distinguishes the (at most one) general row from
  // ordinary tailored ones; the partial unique index makes "at most one"
  // a DB-level guarantee, not just application discipline.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tailored';
  `);
  await pool.query(`
    ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_kind_check;
    ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_kind_check
      CHECK (kind IN ('tailored', 'general'));
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tailored_resumes_one_general
      ON tailored_resumes ((true)) WHERE kind = 'general';
  `);

  // Tracks which real step of the generate->critique->revise pipeline a
  // pending row is on (e.g. "Drafting resume (pass 1)", "Critiquing draft"),
  // so the pending-state UI can show real progress instead of a generic
  // spinner. Only meaningful transiently while status = 'pending'.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS stage TEXT;
  `);

  // Timestamp of the most recent `stage` transition above — lets the
  // pending-state UI show an elapsed-time-vs-typical progress estimate
  // instead of a plain spinner. Set alongside `stage` in updateResumeStage()
  // and nulled out alongside it in setSuggestions()/beginApplyingSuggestions()
  // so the two columns never disagree about whether a stage is in flight.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ;
  `);

  // The suggestion-based tailoring flow (POST /api/tailor -> awaiting_review ->
  // POST /api/resume/:id/apply-suggestions -> ready) stores its proposed keyword
  // insertions here so the checklist can be re-rendered on reload and so accepted
  // suggestions stay auditable after they're applied.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS suggestions JSONB;
  `);
  await pool.query(`
    ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_status_check;
    ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_status_check
      CHECK (status IN ('pending','awaiting_review','ready','failed'));
  `);

  // ── Gmail application-status ingestion ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_sync_state (
      id             INT PRIMARY KEY DEFAULT 1,
      history_id     TEXT,
      last_synced_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_processed_messages (
      message_id   TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS status_events (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id   UUID NOT NULL REFERENCES applied_jobs(id) ON DELETE CASCADE,
      status           TEXT NOT NULL,
      source           TEXT NOT NULL CHECK (source IN ('manual','email')),
      deadline_at      TIMESTAMPTZ,
      email_message_id TEXT,
      email_subject    TEXT,
      email_snippet    TEXT,
      email_link       TEXT,
      occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_review_queue (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_message_id         TEXT NOT NULL UNIQUE,
      email_from               TEXT,
      email_subject            TEXT,
      email_snippet            TEXT,
      email_link               TEXT,
      detected_status          TEXT,
      detected_deadline_at     TIMESTAMPTZ,
      suggested_application_id  UUID REFERENCES applied_jobs(id) ON DELETE SET NULL,
      match_score              REAL,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at              TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_status_events_application ON status_events(application_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_review_queue_unresolved ON email_review_queue(created_at) WHERE resolved_at IS NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tailored_resumes_created ON tailored_resumes(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_company_scraped ON snapshots(company_id, scraped_at DESC);
    CREATE INDEX IF NOT EXISTS idx_applied_jobs_applied ON applied_jobs(applied_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS playground_usage (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ip_hash    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_playground_usage_ip_hash_created
      ON playground_usage (ip_hash, created_at)
  `);

  await seedMasterResume();
  await seedPreferences();

  console.log("Schema initialized.");
}

async function seedMasterResume() {
  const { MASTER_RESUME } = await import("../ai/master-resume");
  await pool.query(
    `INSERT INTO master_resume (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(MASTER_RESUME)]
  );
}

async function seedPreferences() {
  const { FILTERS } = await import("../config");
  await pool.query(
    `INSERT INTO preferences (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(FILTERS)]
  );
}
