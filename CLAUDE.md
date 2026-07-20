# AI Job Hunting Agent — Claude Context

## What This Is

An autonomous AI agent that monitors 20+ company career pages 24/7, detects new job postings via Cheerio scraping and snapshot diffing, auto-tailors Christopher's resume per role using a generate → critique → revise AI loop, and delivers email alerts with a one-click link to generate a tailored resume in a web editor. The web app lets Christopher paste a job description or URL, edit the tailored output like a Google Doc, download a PDF, and log applications to Google Sheets — all without auth (private URL, single user).

Owner: **Christopher Zhang** (Summer 2026 build)

## What's Already Built

Everything below is implemented and running in production, not aspirational — this used to be a "what's being built" roadmap; it has since shipped.

- **Scraper pipeline** — Greenhouse, Ashby, Lever, Amazon adapters (20+ companies); snapshot diffing; location filtering; keyword scoring; user-editable filter preferences
- **Alert emails** — Resend email listing new jobs (title, company, link) with a "Tailor resume" link per job → `/tailor?jobUrl=...&title=...&company=...`
- **AI tailoring pipeline** — `generateBestResume(jd)` in `packages/agent/src/ai/chain.ts`: generate → critique → revise loop (up to 3 passes), scored against a resume-worded-style rubric, outputs ATS-safe Markdown
- **LLM provider** — Claude by default, via the headless `claude -p` CLI (`packages/agent/src/ai/claude-cli.ts`), authenticated with `CLAUDE_CODE_OAUTH_TOKEN` (subscription usage, not metered API billing). OpenAI/GPT-4o is a manual fallback (`LLM_PROVIDER=openai`)
- **Master resume** — source facts live in `packages/agent/src/ai/master-resume.ts`, seeded once into the `master_resume` DB table; `/resume/master` reads and writes the DB copy directly (see Deployment below — always edit on production, not locally)
- **PDF generation** — Markdown → LaTeX → PDF via Tectonic + the custom `Resume_Template/czresume.cls` template, for both tailored resumes and the master resume preview
- **Web app** — `/`, `/tailor`, `/resume/[id]`, `/resume/master`, `/applied`, `/preferences` all built (see table below)
- **Cron scheduler** — scraper runs every 15 min, in-process (no queue layer), guarded against overlapping ticks

## Core Flows

### Email alert flow
1. Scraper detects new jobs → sends alert email
2. Each job in the email has a **"Tailor resume"** link → `https://[app]/tailor?jobUrl=...&title=...&company=...`
3. Clicking opens `/tailor` in the web app with fields pre-filled

### Web app flows

| Page | Purpose |
|---|---|
| `/` | History dashboard — all generated resumes, listed by company/role/date, with download + edit links |
| `/tailor` | Paste a JD or a job URL (auto-fetched); optional title/company; Generate button |
| `/resume/[id]` | Google Doc-style inline text editor — auto-saves, Download PDF, Email to me |
| `/resume/master` | Edit master resume fields directly (basics, experience, projects, skills, drag-to-reorder sections) |
| `/applied` | Application log table — mirrors Google Sheet (date applied, company, location, URL, status, resume link) |
| `/preferences` | Edit scraper filters (title/required keywords, target locations, priority companies, max alerts per email) — backed by the `preferences` DB table and `/api/preferences` |

### JD auto-fetch
When a job URL is submitted, the backend fetches the page with Playwright (JS-heavy) or Cheerio (static) and extracts the job description text. Falls back to a paste box if the page is blocked or returns no useful content.

### PDF generation
Every tailored or edited resume, and the master resume preview, is rendered to PDF via Tectonic (LaTeX) using `Resume_Template/czresume.cls`, and stored in the database alongside the resume record. Downloadable from the editor and the dashboard. Attached when "Email to me" is clicked.

### Google Sheets sync
When Christopher marks a job as "applied" (from `/applied` or the resume editor), a row is written/updated in his Google Sheet:
- Date applied, company, location, job URL, status, link to tailored resume

## Repository Structure

```
job-hunting-agent/
├── packages/
│   ├── web/          # Next.js 14 app (App Router)
│   └── agent/        # Scraper, AI pipeline, API server
├── docker-compose.yml
└── .env.example
```

### `packages/agent/src/` layout

```
agent/src/
├── scraper/
│   ├── index.ts            # Orchestrator — scrapes all companies, emails new jobs
│   ├── types.ts            # Shared JobListing type
│   ├── cheerio.ts          # Static HTML pages
│   ├── fetch-jd.ts         # Auto-fetch JD text from a job URL (Cheerio → Playwright fallback)
│   ├── diff.ts             # Snapshot diffing (hash sets)
│   ├── filters.ts          # Location + keyword scoring (reads `preferences` table)
│   ├── companies.ts        # Hardcoded company list (Greenhouse/Ashby/Lever/Amazon)
│   └── adapters/           # greenhouse.ts, ashby.ts, lever.ts, amazon.ts
├── ai/
│   ├── chain.ts             # generate → critique → revise loop (ENTRY POINT)
│   ├── tailor.ts            # Single-pass tailoring (LLM call)
│   ├── critic.ts            # Scores a draft against the resume-worded-style rubric
│   ├── grounding.ts         # Checks no invented facts
│   ├── format.ts            # Deterministic ATS checks + Markdown renderer
│   ├── fit-page.ts          # Trims tailored output to fit one page
│   ├── render-pdf.ts        # Markdown/MasterResume → LaTeX → PDF via tectonic
│   ├── master-resume.ts     # Hardcoded facts, seeded once into the `master_resume` DB row
│   ├── types.ts             # Zod schemas for MasterResume, TailoredResume
│   ├── llm.ts               # completeJSON() — dispatches to Claude CLI or OpenAI per LLM_PROVIDER
│   ├── claude-cli.ts        # Headless `claude -p` backend (default provider)
│   └── knowledge/
│       └── best-practices.ts
├── api/
│   ├── index.ts             # Express router mount
│   └── routes/              # tailor.ts, resumes.ts, master-resume.ts, applied.ts, preferences.ts, places.ts
├── integrations/
│   └── sheets.ts            # Google Sheets API — append/update application rows
├── notifications/
│   └── email.ts             # Resend — job alert emails
├── cron/
│   └── scheduler.ts         # node-cron — every 15 min, guarded against overlapping ticks
├── db/
│   ├── pool.ts               # pg Pool
│   ├── schema.ts             # CREATE TABLE statements
│   └── queries.ts            # All DB access functions
└── config.ts                # FILTERS/Preferences type, thresholds
```

### `packages/web/` layout

```
web/
├── app/
│   ├── page.tsx              # / — resume history dashboard
│   ├── tailor/
│   │   └── page.tsx          # /tailor — paste JD or URL, generate
│   ├── resume/
│   │   ├── [id]/page.tsx     # /resume/[id] — Google Doc editor
│   │   └── master/page.tsx   # /resume/master — edit master resume
│   ├── applied/
│   │   └── page.tsx          # /applied — application log
│   └── preferences/
│       └── page.tsx          # /preferences — edit scraper filters
├── components/
│   ├── ResumeEditor.tsx      # Inline text editor with Download/Email buttons
│   ├── ResumeCard.tsx        # Card used in history dashboard
│   ├── DashboardClient.tsx   # Client-side dashboard wrapper
│   ├── AppliedTable.tsx      # Application log table
│   ├── MasterResumeForm.tsx  # Form for editing master resume fields
│   ├── SortableSection.tsx   # Drag-to-reorder for master resume sections/bullets
│   ├── TailorForm.tsx        # JD input + generate button
│   ├── PreferencesForm.tsx   # Scraper filter settings form
│   └── Nav.tsx                # Top navigation bar
└── lib/
    └── api.ts                # Typed fetch wrappers for agent API
```

## Tech Stack

### Frontend
- Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/ui

### Backend
- Node.js + Express (API server in `packages/agent`), PostgreSQL, node-cron

### Scraping
- Playwright (JS-rendered pages), Cheerio (static HTML), custom snapshot diffing via hash sets

### AI
- Claude (default) — headless `claude -p` CLI, authenticated via `CLAUDE_CODE_OAUTH_TOKEN` (subscription usage, not metered API billing); set `LLM_PROVIDER=openai` to fall back to OpenAI/GPT-4o
- Zod (LLM output validation)
- No RAG pipeline / pgvector — master resume is the direct source of truth

### PDF
- Tectonic (LaTeX compiler) rendering `Resume_Template/czresume.cls` — used for both tailored resumes and the master resume preview

### Notifications
- Resend (job alert emails + "Email to me" from editor)

### Google Sheets
- Google Sheets API v4 (googleapis npm package) — append/update rows on apply

### Auth
- None — private URL, single user (Christopher only)

### Infra
- Railway (deployment), Docker Compose (local Postgres)

## Deployment

Railway project `AI-Job-Agent`, two environments, each with its own Postgres (separate from local docker-compose):

| Environment | Web app | Agent API |
|---|---|---|
| production | https://web-production-d867c.up.railway.app | https://job-agentagent-production.up.railway.app |
| staging | https://web-staging-f1cd.up.railway.app | https://job-agentagent-staging.up.railway.app |

**Master resume is edited on production, not locally.** `/resume/master` writes straight to whatever `DATABASE_URL` the running app has — local (`docker-compose`) and Railway are independent databases with no sync between them. To keep one source of truth, always edit master resume at:

https://web-production-d867c.up.railway.app/resume/master

Local `docker-compose` Postgres is for scraper/tailoring dev work, not for master resume edits.

## Database Schema

```sql
-- Existing
companies       (id, name, careers_url, scrape_type, active, created_at)
jobs            (id, company_id, title, url, detected_at, is_new)
snapshots       (id, company_id, job_hashes[], scraped_at)

-- New
tailored_resumes (
  id            uuid primary key,
  job_title     text,
  company       text,
  location      text,
  job_url       text,
  jd_text       text,           -- full job description used for tailoring
  markdown      text,           -- current editor content (editable)
  pdf           bytea,          -- rendered PDF blob
  critic_score  int,            -- final score from the critique loop
  created_at    timestamptz,
  updated_at    timestamptz
)

master_resume (
  id            int primary key default 1,   -- single row
  data          jsonb,                        -- MasterResume JSON
  updated_at    timestamptz
)

applied_jobs (
  id            uuid primary key,
  company       text,
  job_title     text,
  location      text,
  job_url       text,
  status        text,           -- 'applied' | 'interviewing' | 'rejected' | 'offer' | 'assessment' | 'no_response'
  applied_at    timestamptz,
  resume_id     uuid references tailored_resumes(id),
  sheets_row    int             -- row number in Google Sheet for updates
)

preferences (
  id            int primary key default 1,   -- single row
  data          jsonb,          -- Preferences JSON: titleKeywords, requiredKeywords, targetLocations, priorityCompanies, maxPerEmail
  updated_at    timestamptz
)
```

## Core Pipelines

### Scraping → Alert
```
cron (every 15 min, in-process, guarded against overlapping ticks)
  → Cheerio scrape per company
    → diff.ts (new job hashes)
      → filter by location + keyword score (reads `preferences` table)
        → Resend email (job list + "Tailor resume" link per job)
```

### Tailoring (triggered from web app)
```
POST /api/tailor (jd text or job URL)
  → if URL: auto-fetch JD via Playwright/Cheerio
    → generateBestResume(jd) — up to 3 passes via Claude CLI (or OpenAI if LLM_PROVIDER=openai)
      → save tailored_resumes row (markdown, critic_score)
        → render PDF via Tectonic/czresume.cls → store in tailored_resumes.pdf
          → return resume ID → redirect to /resume/[id]
```

### Apply → Google Sheets
```
POST /api/applied (resume_id, status, applied_at)
  → upsert applied_jobs row
    → Google Sheets API: append or update row
      (date, company, location, job_url, status, resume link)
```

## Environment Variables

```
DATABASE_URL

LLM_PROVIDER                  # "claude" (default) or "openai"
CLAUDE_CODE_OAUTH_TOKEN       # required when LLM_PROVIDER=claude — minted via `claude setup-token`
CLAUDE_MODEL                  # optional — pins a model for the claude path
OPENAI_API_KEY                # required when LLM_PROVIDER=openai, or as a manual fallback
OPENAI_MODEL                  # defaults to gpt-4o

RESEND_API_KEY
YOUR_EMAIL
WEB_URL                       # web app URL — CORS + "Tailor resume" email links
APP_URL

GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_JSON   # stringified service account credentials

TECTONIC_PATH                 # path to the tectonic binary (PDF generation)
```

See `.env.example` for the authoritative, commented list.

## Security

- `.env` is gitignored — never commit it. `.env.example` has placeholder values only.
- Husky pre-commit hook blocks `.env` files and common API key patterns from being staged.
- If keys are ever exposed: rotate immediately in the provider dashboard, then run `git filter-repo --invert-paths --path .env --force` + force push.
- `auth.json` (Playwright session cookies) is gitignored.
- No auth on the web app — keep the Railway URL private.

## Available Claude Code Skills

Use these proactively:

- `/code-review` — run before any PR or push
- `/security-review` — run when touching env vars, API integrations, or scraping logic
- `/verify` — run after any feature to confirm it works end-to-end
- `/run` — launch the agent or dashboard to test changes live
- `/investigate` — systematic root-cause debugging for scraper flakiness or tailoring failures
- `/ship` — land a branch: tests, review, changelog, commit, push, PR in one flow

## Dev Notes

- Local infra: `docker-compose up` (Postgres)
- Scraper uses 2–5s random delays; respects robots.txt
- All LLM outputs validated with Zod; retry on failed calls
- Master resume is the single source of truth — the AI may only select/rephrase facts that exist in it, never invent
- Alert score threshold: top-ranked jobs by keyword score, capped at `FILTERS.maxPerEmail`
- PDF design: plain text / ATS-safe for now; will match a specific template in a later pass
