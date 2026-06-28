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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tailored_resumes_created ON tailored_resumes(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_company_scraped ON snapshots(company_id, scraped_at DESC);
    CREATE INDEX IF NOT EXISTS idx_applied_jobs_applied ON applied_jobs(applied_at DESC);
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
