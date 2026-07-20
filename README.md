# AI Job Hunting Agent

An autonomous agent that monitors 20+ company career pages 24/7, detects new job postings via snapshot diffing, auto-tailors Christopher's resume per role using a generate → critique → revise AI loop, and sends email alerts with a one-click link to generate a tailored resume. A web app lets you paste a job description or URL, edit the tailored output, download a PDF, and log applications to Google Sheets — no auth required.

---

## How It Works

```
Every 15 minutes
  ↓
Cheerio scrapes each career page
  ↓
Snapshot diffing (hash sets) detects new postings
  ↓
Location + keyword scoring filters relevant roles (user-editable in /preferences)
  ↓
Resend alert email (job list + "Tailor Resume" link per job)
  ↓
Click link → /tailor opens with job pre-filled
  ↓
Claude (headless CLI, OpenAI fallback): generate → critique → revise (up to 3 passes)
  ↓
LaTeX PDF rendered via tectonic + czresume.cls
  ↓
Edit inline → Download PDF → Log to Google Sheets
```

---

## Tech Stack

| Layer         | Tools                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Frontend      | Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/ui         |
| Backend       | Node.js, Express, PostgreSQL, node-cron                               |
| Scraping      | Cheerio (static HTML), snapshot diff; Playwright reserved for on-demand JD auto-fetch |
| AI            | Claude (default, headless `claude -p` CLI, subscription usage), OpenAI/GPT-4o fallback, Zod (LLM output validation) |
| PDF           | Tectonic (LaTeX compiler), custom `czresume.cls` template            |
| Notifications | Resend (job alert emails + "Email to me" from editor)                |
| Sheets        | Google Sheets API v4 (application log)                               |
| Auth          | None — private Railway URL, single user                              |
| Infra         | Railway (deployment), Docker Compose (local Postgres)        |

---

## Repository Structure

```
job-hunting-agent/
├── packages/
│   ├── web/              # Next.js 14 app (App Router)
│   └── agent/            # Scraper, AI pipeline, API server
├── Resume_Template/
│   ├── czresume.cls      # Custom LaTeX class (Times Roman, rSection format)
│   └── resume.tex        # Master resume source
├── Dockerfile            # Agent service (Railway)
├── Dockerfile.web        # Web app service (Railway)
├── docker-compose.yml    # Local Postgres
└── .env.example
```

### Agent Package

```
agent/src/
├── scraper/
│   ├── index.ts          # Orchestrator — scrapes all companies, emails new jobs
│   ├── playwright.ts     # JS-rendered pages
│   ├── cheerio.ts        # Static HTML pages
│   ├── fetch-jd.ts       # Auto-fetch JD text from a job URL (Cheerio → Playwright fallback)
│   ├── diff.ts           # Snapshot diffing (hash sets)
│   ├── filters.ts        # Location + keyword scoring
│   ├── companies.ts      # Tracked company list
│   └── adapters/         # greenhouse.ts, ashby.ts, lever.ts, amazon.ts
├── ai/
│   ├── chain.ts          # generate → critique → revise loop (entry point)
│   ├── tailor.ts         # Single-pass tailoring (LLM call)
│   ├── critic.ts         # Scores a draft, returns fixes
│   ├── grounding.ts      # Checks no invented facts
│   ├── format.ts         # ATS checks + Markdown renderer
│   ├── render-pdf.ts     # Markdown/MasterResume → LaTeX → PDF via tectonic
│   ├── master-resume.ts  # Hardcoded facts, seeded once into the `master_resume` DB row
│   ├── types.ts          # Zod schemas for MasterResume, TailoredResume
│   ├── llm.ts            # completeJSON() — dispatches to Claude CLI or OpenAI per LLM_PROVIDER
│   ├── claude-cli.ts     # Headless `claude -p` backend (default provider)
│   └── knowledge/
│       └── best-practices.ts  # Resume rubric + prompt blocks used by tailor/critic/format
├── api/
│   ├── index.ts          # Express router mount
│   └── routes/
│       ├── tailor.ts        # POST /api/tailor
│       ├── resumes.ts       # GET /api/resumes, GET /api/resumes/:id, PATCH /api/resumes/:id
│       ├── applied.ts       # GET/POST /api/applied
│       ├── master-resume.ts # GET/PUT /api/master-resume, POST /api/master-resume/preview-pdf
│       ├── preferences.ts   # GET/PUT /api/preferences — scraper filter settings
│       └── places.ts        # GET /api/places — static US city list for location autocomplete
├── integrations/
│   └── sheets.ts         # Google Sheets API — append/update application rows
├── notifications/
│   └── email.ts          # Resend — job alert emails
├── cron/
│   └── scheduler.ts      # node-cron — every 15 min, guarded against overlapping ticks
└── db/
    ├── pool.ts           # pg Pool
    ├── schema.ts         # CREATE TABLE statements
    └── queries.ts        # All DB access functions
```

### Web App

```
web/
├── app/
│   ├── page.tsx              # / — resume history dashboard
│   ├── tailor/page.tsx       # /tailor — paste JD or URL, generate
│   ├── resume/
│   │   ├── [id]/page.tsx     # /resume/[id] — inline editor, Download PDF
│   │   └── master/page.tsx   # /resume/master — edit master resume
│   ├── applied/page.tsx      # /applied — application log table
│   └── preferences/page.tsx  # /preferences — edit scraper filter settings
├── components/
│   ├── ResumeEditor.tsx      # Inline text editor with Download/Email buttons
│   ├── ResumeCard.tsx        # Card used in history dashboard
│   ├── DashboardClient.tsx   # Client-side dashboard wrapper
│   ├── AppliedTable.tsx      # Application log table
│   ├── MasterResumeForm.tsx  # Form for editing master resume fields
│   ├── SortableSection.tsx   # Drag-to-reorder for master resume sections/bullets
│   ├── TailorForm.tsx        # JD input + generate button
│   ├── PreferencesForm.tsx   # Scraper filter settings form
│   └── Nav.tsx               # Top navigation bar
└── lib/
    └── api.ts                # Typed fetch wrappers for agent API
```

---

## Database Schema

```sql
-- Scraper
companies        (id, name, careers_url, scrape_type, active, created_at)
jobs             (id, company_id, title, url, detected_at, is_new)
snapshots        (id, company_id, job_hashes[], scraped_at)

-- Resume / applications
tailored_resumes (id uuid, job_title, company, job_url, jd_text,
                  markdown, pdf bytea, critic_score int,
                  created_at, updated_at)

master_resume    (id int default 1, data jsonb, updated_at)

applied_jobs     (id uuid, company, job_title, location, job_url,
                  status, applied_at, resume_id uuid, sheets_row int)

preferences      (id int default 1, data jsonb, updated_at)
                 -- titleKeywords, requiredKeywords, targetLocations,
                 -- priorityCompanies, maxPerEmail
```

---

## AI Tailoring Pipeline

The master resume is the single source of truth — the LLM may only select or rephrase facts that exist in it, never invent new ones.

```
POST /api/tailor  (JD text or job URL)
  → auto-fetch JD if URL (Playwright/Cheerio)
    → generateBestResume(jd) — up to 3 passes:
        pass 1: tailor.ts    — rewrite bullets to match JD
        pass 2: critic.ts    — score draft, return fix list
        pass 3: tailor.ts    — revise based on fixes
      → grounding.ts         — verify no invented facts
    → save tailored_resumes row
    → render PDF via tectonic + czresume.cls
    → redirect to /resume/[id]
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for local Postgres)
- [Tectonic](https://tectonic-typesetting.github.io/) — `brew install tectonic`
- Poppler (`pdfinfo`) — `brew install poppler` — used to detect résumé page overflow
- A `claude` CLI subscription token (`claude setup-token`) — default LLM provider; or an OpenAI API key to run with `LLM_PROVIDER=openai`
- Resend API key
- Google service account with Sheets API access

### Local Setup

```bash
# Install dependencies
npm install

# Start Postgres
docker-compose up -d

# Copy env vars
cp .env.example .env
# Fill in your keys

# Run the agent (Express API + cron scheduler → localhost:3001)
npm run dev --workspace=packages/agent

# Run the web app (→ localhost:3000)
npm run dev --workspace=packages/web
```

---

## Environment Variables

```bash
DATABASE_URL=postgresql://jobagent:jobagent@localhost:5432/job_agent

LLM_PROVIDER=claude   # "claude" (default) or "openai"
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...   # required when LLM_PROVIDER=claude — minted via `claude setup-token`
CLAUDE_MODEL=                              # optional — pins a model for the claude path
OPENAI_API_KEY=sk-...                      # required when LLM_PROVIDER=openai, or as a manual fallback
OPENAI_MODEL=gpt-4o

RESEND_API_KEY=re_...
YOUR_EMAIL=you@example.com

GOOGLE_SHEETS_SPREADSHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON='{...}'

# Local: /opt/homebrew/bin/tectonic
# Railway: set automatically via Dockerfile
TECTONIC_PATH=/opt/homebrew/bin/tectonic

WEB_URL=http://localhost:3000   # agent uses this for CORS + email links
APP_URL=http://localhost:3001
```

---

## Deployment (Railway)

Two separate Railway services, same GitHub repo, different Dockerfiles:

| Service | Dockerfile | Purpose |
|---|---|---|
| `agent` | `Dockerfile` | Scraper + AI pipeline + Express API |
| `web` | `Dockerfile.web` | Next.js web app |

Both services share the same Railway Postgres instance. Set `WEB_URL` on the agent service to the web service's Railway URL, and `NEXT_PUBLIC_AGENT_URL` on the web service to the agent's Railway URL.

---

## Key Design Decisions

**No RAG / pgvector** — The master resume is small enough to fit entirely in a single LLM prompt. Embedding chunks and doing cosine retrieval adds complexity with no benefit at this scale.

**Claude by default, OpenAI as a manual fallback** — Tailoring runs through the headless `claude -p` CLI, billed against Christopher's Claude subscription rather than metered API usage. Setting `LLM_PROVIDER=openai` swaps to GPT-4o with no code changes, since both paths go through the same `completeJSON()` interface in `llm.ts`.

**generate → critique → revise loop** — A single tailoring pass produces inconsistent quality. Running a separate critic model that scores the draft and returns a fix list, then revising, reliably pushes output quality above a useful threshold.

**Resume-Worded-style critic rubric** — `critic_score` is a blend of an LLM holistic score (60%, graded against a Weak-roles/Brevity-&-Style rubric), a deterministic format score (25%, quantified-impact ratio, weak/repeated verbs, verb tenses, buzzwords/filler/pronouns, passive voice, spelling, readability/ATS-glyph safety), and JD keyword coverage (15%), with a hard grounding gate that caps the score at 25 on any fabricated claim. It intentionally does not score candidate credentials (open-source contributions, prior employers, portfolio links) — those can't be changed by rewriting a bullet, so scoring them just adds noise the tailoring loop can't act on. Only signals a rewrite can actually move are scored.

**No auth** — Single user, private Railway URL. Adding auth would add overhead with zero security benefit in this setup.
