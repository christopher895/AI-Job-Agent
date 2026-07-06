# AI Job Hunting Agent — Claude Context

## What This Is

An autonomous AI agent that monitors 20+ company career pages 24/7, detects new job postings via Playwright scraping and snapshot diffing, auto-tailors Christopher's resume per role using a generate → critique → revise AI loop, and delivers email alerts with a one-click link to generate a tailored resume in a web editor. The web app lets Christopher paste a job description or URL, edit the tailored output like a Google Doc, download a PDF, and log applications to Google Sheets — all without auth (private URL, single user).

Owner: **Christopher Zhang** (Summer 2026 build)

## What's Already Built

- **Scraper pipeline** — Greenhouse, Ashby, Lever, Amazon adapters; snapshot diffing; location filtering; keyword scoring
- **Alert emails** — Resend email listing new jobs (title, company, link) — needs "Tailor resume" link added per job
- **AI tailoring pipeline** — `generateBestResume(jd)` in `packages/agent/src/ai/chain.ts`: generate → critique → revise loop (up to 3 passes), outputs ATS-safe Markdown
- **Master resume** — structured JSON in `packages/agent/src/ai/master-resume.ts` — to be moved to DB so web app can edit it
- **Cron scheduler** — scraper runs every 15 min, in-process (no queue layer)

## What's Being Built (full scope)

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
| `/resume/master` | Edit master resume fields directly (basics, experience, projects, skills) |
| `/applied` | Application log table — mirrors Google Sheet (date applied, company, location, URL, status, resume link) |

### JD auto-fetch
When a job URL is submitted, the backend fetches the page with Playwright (JS-heavy) or Cheerio (static) and extracts the job description text. Falls back to a paste box if the page is blocked or returns no useful content.

### PDF generation
Every tailored or edited resume is rendered to PDF and stored in the database alongside the resume record. Downloadable from the editor and the dashboard. Attached when "Email to me" is clicked. Design: clean plain text for now; will match a specific template later.

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
│   ├── playwright.ts       # JS-rendered pages (Jobright)
│   ├── cheerio.ts          # Static HTML pages
│   ├── diff.ts             # Snapshot diffing (hash sets)
│   ├── filters.ts          # Location + keyword scoring
│   ├── companies.ts        # Hardcoded company list
│   └── adapters/           # greenhouse.ts, ashby.ts, lever.ts, amazon.ts
├── ai/
│   ├── chain.ts            # generate → critique → revise loop (ENTRY POINT)
│   ├── tailor.ts           # Single-pass tailoring (LLM call)
│   ├── critic.ts           # Scores a draft, returns fixes
│   ├── grounding.ts        # Checks no invented facts
│   ├── format.ts           # Deterministic ATS checks + Markdown renderer
│   ├── master-resume.ts    # SOURCE OF TRUTH — move to DB
│   ├── types.ts            # Zod schemas for MasterResume, TailoredResume
│   ├── llm.ts              # OpenAI wrapper
│   └── knowledge/
│       └── best-practices.ts
├── notifications/
│   └── email.ts            # Resend — job alert emails
├── cron/
│   └── scheduler.ts        # node-cron — every 15 min
├── db/
│   ├── pool.ts             # pg Pool
│   ├── schema.ts           # CREATE TABLE statements
│   └── queries.ts          # All DB access functions
└── config.ts               # FILTERS, thresholds
```

### `packages/web/` target layout

```
web/
├── app/
│   ├── page.tsx              # / — resume history dashboard
│   ├── tailor/
│   │   └── page.tsx          # /tailor — paste JD or URL, generate
│   ├── resume/
│   │   ├── [id]/page.tsx     # /resume/[id] — Google Doc editor
│   │   └── master/page.tsx   # /resume/master — edit master resume
│   └── applied/
│       └── page.tsx          # /applied — application log
├── components/
│   ├── ResumeEditor.tsx      # Inline text editor with Download/Email buttons
│   ├── ResumeCard.tsx        # Card used in history dashboard
│   └── AppliedTable.tsx      # Application log table
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
- OpenAI API (GPT-4o for tailoring + critique), Zod (LLM output validation)
- No RAG pipeline / pgvector — master resume is the direct source of truth

### PDF
- Puppeteer (render Markdown → HTML → PDF) or `pdf-lib` — decision deferred; plain text style for now

### Notifications
- Resend (job alert emails + "Email to me" from editor)

### Google Sheets
- Google Sheets API v4 (googleapis npm package) — append/update rows on apply

### Auth
- None — private URL, single user (Christopher only)

### Infra
- Railway (deployment), Docker Compose (local Postgres)

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
  status        text,           -- 'applied' | 'interviewing' | 'rejected' | 'offer'
  applied_at    timestamptz,
  resume_id     uuid references tailored_resumes(id),
  sheets_row    int             -- row number in Google Sheet for updates
)
```

## Core Pipelines

### Scraping → Alert
```
cron (every 15 min, in-process)
  → Playwright/Cheerio scrape per company
    → diff.ts (new job hashes)
      → filter by location + keyword score
        → Resend email (job list + "Tailor resume" link per job)
```

### Tailoring (triggered from web app)
```
POST /api/tailor (jd text or job URL)
  → if URL: auto-fetch JD via Playwright/Cheerio
    → generateBestResume(jd) — up to 3 passes
      → save tailored_resumes row (markdown, critic_score)
        → render PDF → store in tailored_resumes.pdf
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
OPENAI_API_KEY
RESEND_API_KEY
YOUR_EMAIL
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_JSON   # stringified service account credentials
```

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

## Dev Notes

- Local infra: `docker-compose up` (Postgres)
- Scraper uses 2–5s random delays; respects robots.txt
- All LLM outputs validated with Zod; retry on failed calls
- Master resume is the single source of truth — the AI may only select/rephrase facts that exist in it, never invent
- Alert score threshold: top-ranked jobs by keyword score, capped at `FILTERS.maxPerEmail`
- PDF design: plain text / ATS-safe for now; will match a specific template in a later pass
