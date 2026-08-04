# AI Job Hunting Agent — Claude Context

## What This Is

An autonomous AI agent that monitors 80+ company career pages 24/7, detects new job postings via each company's ATS API (Greenhouse/Ashby/Lever/Amazon) and snapshot diffing, auto-tailors Christopher's resume per role by suggesting JD keyword insertions against his fixed master resume for Christopher to review and approve, and delivers email alerts with a one-click link to generate a tailored resume in a web editor. The web app lets Christopher paste a job description or URL, review/approve suggested edits, edit the tailored output like a Google Doc, download a PDF, and log applications to Google Sheets — all without auth (private URL, single user).

Owner: **Christopher Zhang** (Summer 2026 build)

## What's Already Built

Everything below is implemented and running in production, not aspirational — this used to be a "what's being built" roadmap; it has since shipped.

- **Scraper pipeline** — Greenhouse, Ashby, Lever, Amazon adapters (80+ companies); snapshot diffing; location filtering; keyword scoring; user-editable filter preferences
- **Alert emails** — Resend email listing new jobs (title, company, link) with a "Tailor resume" link per job → `/tailor?jobUrl=...&title=...&company=...`
- **AI tailoring pipeline** — `suggestKeywords(jd, master)` in `packages/agent/src/ai/suggest-keywords.ts`: a single pass proposes keyword-insertion suggestions (bullet rewrites and skill additions) against the fixed, one-page master resume, which is never reordered or cut. Christopher reviews, edits, and checks off suggestions in a checklist; `POST /api/resume/:id/apply-suggestions` applies only the accepted ones and renders the final one-page Markdown. The old 3-pass generate→critique→revise loop (`chain.ts`) still exists but now only backs the dormant, UI-removed general-resume feature
- **LLM provider** — Claude by default, via the headless `claude -p` CLI (`packages/agent/src/ai/claude-cli.ts`), authenticated with `CLAUDE_CODE_OAUTH_TOKEN` (subscription usage, not metered API billing). OpenAI/GPT-4o is a manual fallback (`LLM_PROVIDER=openai`)
- **Master resume** — source facts live in `packages/agent/src/ai/master-resume.ts`, seeded once into the `master_resume` DB table; `/resume/master` reads and writes the DB copy directly (see Deployment below — always edit on production, not locally)
- **Master resume import** — `/resume/master` can parse pasted text or an uploaded PDF into a `MasterResume` via `importMasterResume()` (LLM-parsed, ids deduplicated deterministically after the fact); the result loads into the existing form as unsaved state for review before saving, never written to the DB directly
- **One-page overflow warning** — `/resume/master` shows a warning banner when the rendered preview PDF exceeds one page, since the master resume is meant to stay a fixed one-page source of truth for suggestion-based tailoring
- **PDF generation** — Markdown → LaTeX → PDF via Tectonic + the custom `Resume_Template/czresume.cls` template, for both tailored resumes and the master resume preview
- **Web app** — `/`, `/tailor`, `/resume/[id]`, `/resume/master`, `/applied`, `/preferences` all built (see table below)
- **Cron scheduler** — scraper runs every 15 min, in-process (no queue layer), guarded against overlapping ticks
- **Async tailoring** — `POST /api/tailor` returns immediately (202) with a `pending` row; the background job runs `suggestKeywords(jd, master)` and lands the row at `awaiting_review` with proposed suggestions attached (not `ready`). After Christopher reviews and approves suggestions in the checklist, `POST /api/resume/:id/apply-suggestions` runs the rest of the pipeline (apply, render, fit-to-page, PDF) in the background and takes the row to `ready`. The editor polls `GET /api/resumes/:id` until status leaves `pending`

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
When a job URL is submitted, the backend fetches the page with Playwright (JS-heavy) or Cheerio (static), extracts the article body with Mozilla Readability (`@mozilla/readability` + `jsdom`), and validates the URL against SSRF (blocks localhost/private IPs/cloud metadata endpoints) — see `fetch-jd.ts`. Falls back to a paste box if the page is blocked or returns no useful content.

### PDF generation
Every tailored or edited resume, and the master resume preview, is rendered to PDF via Tectonic (LaTeX) using `Resume_Template/czresume.cls`, and stored in the database alongside the resume record. Downloadable from the editor and the dashboard. Attached when "Email to me" is clicked.

### Google Sheets sync
When Christopher marks a job as "applied" (from `/applied` or the resume editor), a row is written/updated in his Google Sheet:
- Date applied, company, location, job URL, status, link to tailored resume

## Repository Structure

```
job-hunting-agent/
├── packages/
│   ├── web/          # Next.js 16 app (App Router)
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
│   ├── fetch-jd.ts         # Auto-fetch JD text from a job URL (Cheerio → Playwright fallback, Readability extraction)
│   ├── browser-utils.ts    # Shared Playwright browser lifecycle helpers
│   ├── diff.ts             # Snapshot diffing (hash sets)
│   ├── filters.ts          # Location + keyword scoring (reads `preferences` table)
│   ├── companies.ts        # Hardcoded company list (Greenhouse/Ashby/Lever/Amazon, 80+ companies)
│   ├── run-companies.ts    # CLI entry — `npm run scrape:companies`
│   └── adapters/           # greenhouse.ts, ashby.ts, lever.ts, amazon.ts
├── ai/
│   ├── suggest-keywords.ts    # Single-pass JD keyword-suggestion call (current tailoring ENTRY POINT)
│   ├── apply-suggestions.ts   # Deterministic groundedness labeling + applies only accepted suggestions
│   ├── import-master-resume.ts # Parses pasted/PDF resume text into MasterResume (LLM call + id dedup)
│   ├── general-resume.ts    # Dormant (UI removed) — JD-less resume generation via the old 3-pass loop
│   ├── chain.ts             # generate → critique → revise loop — now only backs the dormant general-resume path
│   ├── tailor.ts            # Single-pass tailoring (LLM call) — used by chain.ts, general-resume path only
│   ├── critic.ts            # Scores a draft against the resume-worded-style rubric — general-resume path only
│   ├── grounding.ts         # Checks no invented facts; numbers() also reused by apply-suggestions.ts's groundedness labeling
│   ├── format.ts            # Deterministic ATS checks + Markdown renderer; renderMarkdown() reused by apply-suggestions.ts
│   ├── fit-page.ts          # Trims tailored output to fit one page (skipWidowFix option for the suggestion-based flow)
│   ├── render-pdf.ts        # Markdown/MasterResume → LaTeX → PDF via tectonic
│   ├── master-resume.ts     # Hardcoded seed facts — obsolete after the first master-resume import; the DB row is the real source of truth thereafter
│   ├── types.ts             # Zod schemas for MasterResume, TailoredResume, Suggestion
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
│   ├── ResumeEditor.tsx      # Inline text editor with Download/Email buttons; renders the awaiting_review checklist via SuggestionChecklist
│   ├── SuggestionChecklist.tsx # Review UI for a suggestion batch — checkbox, grounded/extrapolated badge, editable text, rationale
│   ├── ResumeCard.tsx        # Card used in history dashboard
│   ├── DashboardClient.tsx   # Client-side dashboard wrapper
│   ├── AppliedTable.tsx      # Application log table
│   ├── MasterResumeForm.tsx  # Form for editing master resume fields; Import panel (paste/PDF) and one-page warning banner
│   ├── SortableSection.tsx   # Drag-to-reorder for master resume sections/bullets
│   ├── TailorForm.tsx        # JD input + generate button
│   ├── PreferencesForm.tsx   # Scraper filter settings form
│   └── Nav.tsx                # Top navigation bar
└── lib/
    ├── api.ts                # Typed fetch wrappers for agent API
    └── resumeStage.ts        # Maps a raw backend stage string to the 3-segment pending-screen stepper
```

## Tech Stack

### Frontend
- Next.js 16 (App Router), TypeScript, Tailwind CSS

### Backend
- Node.js + Express (API server in `packages/agent`), PostgreSQL, node-cron

### Scraping
- Direct ATS API calls per company (Greenhouse/Ashby/Lever/Amazon adapters), custom snapshot diffing via hash sets
- Playwright + Cheerio + Mozilla Readability — used only for JD auto-fetch from a pasted job URL, not for company scraping

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
- Google OAuth (Auth.js), restricted to Christopher's email via a single-email allowlist. The Next.js server is the only caller of the agent API — a BFF proxy (`/api/proxy/*`) attaches a private shared secret (`INTERNAL_API_SECRET`) that the agent API requires on every `/api` request. See `docs/superpowers/specs/2026-08-03-private-auth-design.md`.

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
jobs            (id, company_id, title, company_name, url, description, detected_at, is_new)
snapshots       (id, company_id, raw_html, job_hashes[], scraped_at)

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
  pdf_error     text,           -- error from the most recent PDF render attempt, if any
  critic_score  int,            -- final score from the critique loop (general-resume path only)
  status        text,           -- 'pending' | 'awaiting_review' | 'ready' | 'failed' — tailoring runs as a background job
  error         text,           -- error message if status = 'failed'
  stage         text,           -- current pipeline step while status = 'pending' (e.g. "Analyzing job description"); null otherwise
  suggestions   jsonb,          -- proposed keyword-insertion suggestions; accepted/rejected state stored per item after review
  kind          text,           -- 'tailored' | 'general' — distinguishes the (at most one) dormant general-resume row
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
  → fetch each company's ATS API/page (greenhouse/ashby/lever/amazon adapters)
    → diff.ts (new job hashes)
      → filter by location + keyword score (reads `preferences` table)
        → Resend email (job list + "Tailor resume" link per job)
```

### Tailoring (triggered from web app)
```
POST /api/tailor (jd text or job URL)
  → if URL: auto-fetch JD synchronously via Playwright/Cheerio + Readability (capped at 15s)
    → create tailored_resumes row with status='pending', respond 202 immediately
      → [background] suggestKeywords(jd, master) via Claude CLI (or OpenAI if LLM_PROVIDER=openai)
        → update row: suggestions, status='awaiting_review' (or 'failed' + error message)
  → frontend polls GET /api/resumes/:id until status leaves 'pending', shows suggestion checklist
    → user reviews/edits/checks off suggestions
      → POST /api/resume/:id/apply-suggestions (accepted suggestions)
        → row back to status='pending', respond 202 immediately
          → [background] applySuggestions(master, accepted) + renderMarkdown + fitToOnePage(skipWidowFix)
            → update row: markdown, suggestions (full accepted+rejected set), status='ready' (or 'failed')
              → [background] render PDF via Tectonic/czresume.cls → store in tailored_resumes.pdf (or pdf_error)
        → frontend polls GET /api/resumes/:id again until status leaves 'pending'
```

Async because even a single LLM call can exceed Railway's ~300s edge-proxy timeout, which would otherwise kill the request and surface as a generic "Failed to fetch" in the browser.

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
WEB_URL                       # web app URL — "Tailor resume" email links
APP_URL
AGENT_API_URL                  # agent API URL the web app's server proxies to — private, server-only, not exposed to the browser
AUTH_SECRET                    # session cookie signing secret for Auth.js
AUTH_TRUST_HOST                # set to "true" on Railway (behind a reverse proxy)
GOOGLE_CLIENT_ID               # Google OAuth client, from console.cloud.google.com
GOOGLE_CLIENT_SECRET
AUTH_ALLOWED_EMAIL             # the only Google account allowed to sign in
INTERNAL_API_SECRET            # shared secret between the web app's proxy and the agent API

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
- The web app is gated behind Google sign-in restricted to Christopher's email (`AUTH_ALLOWED_EMAIL`); the agent API rejects any request without the correct `INTERNAL_API_SECRET` header, so it isn't reachable directly even if its URL leaks.

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
- PDF design: renders via the custom `Resume_Template/czresume.cls` LaTeX template, ATS-safe
