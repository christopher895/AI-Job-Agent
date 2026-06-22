import { pool } from "./pool";

export async function initSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

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
    CREATE TABLE IF NOT EXISTS resume_chunks (
      id         SERIAL PRIMARY KEY,
      content    TEXT NOT NULL,
      embedding  vector(1536),
      chunk_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("Schema initialized.");
}
