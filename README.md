# AI Job Hunting Agent

An autonomous agent that monitors 20+ company career pages 24/7, detects new job postings via snapshot diffing, auto-tailors Christopher's resume per role using a generate → critique → revise AI loop, and sends email alerts with a one-click link to generate a tailored resume. A web app lets you paste a job description or URL, edit the tailored output, download a PDF, and log applications to Google Sheets — no auth required.

---

## How It Works

```
Every 15 minutes
  ↓
Playwright / Cheerio scrapes each career page
  ↓
Snapshot diffing (hash sets) detects new postings
  ↓
Location + keyword scoring filters relevant roles
  ↓
Resend alert email (job list + "Tailor Resume" link per job)
  ↓
Click link → /tailor opens with job pre-filled
  ↓
GPT-4o: generate → critique → revise (up to 3 passes)
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
| Backend       | Node.js, Express, PostgreSQL, Redis, BullMQ, node-cron               |
| Scraping      | Playwright (JS-rendered pages), Cheerio (static HTML), snapshot diff |
| AI            | OpenAI GPT-4o, Zod (LLM output validation)                           |
| PDF           | Tectonic (LaTeX compiler), custom `czresume.cls` template            |
| Notifications | Resend (job alert emails + "Email to me" from editor)                |
| Sheets        | Google Sheets API v4 (application log)                               |
| Auth          | None — private Railway URL, single user                              |
| Infra         | Railway (deployment), Docker Compose (local Postgres + Redis)        |

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
├── docker-compose.yml    # Local Postgres + Redis
└── .env.example
```

### Agent Package

```
agent/src/
├── scraper/
│   ├── index.ts          # Orchestrator — scrapes all companies, emails new jobs
│   ├── playwright.ts     # JS-rendered pages
│   ├── cheerio.ts        # Static HTML pages
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
│   ├── master-resume.ts  # Structured JSON source of truth
│   ├── render-pdf.ts     # Markdown → LaTeX → PDF via tectonic
│   ├── types.ts          # Zod schemas for MasterResume, TailoredResume
│   └── llm.ts            # OpenAI wrapper
├── notifications/
│   ├── email.ts          # Resend — job alert emails
│   └── sms.ts            # Twilio (wired up, not in main flow)
├── queue/
│   ├── worker.ts         # BullMQ worker
│   └── producer.ts       # BullMQ producer
├── cron/
│   └── scheduler.ts      # node-cron — every 15 min
└── db/
    ├── pool.ts           # pg Pool
    ├── schema.ts         # CREATE TABLE statements
    └── queries.ts        # All DB access functions
```

### Web App (in progress)

```
web/app/
├── page.tsx              # / — resume history dashboard
├── tailor/page.tsx       # /tailor — paste JD or URL, generate
├── resume/
│   ├── [id]/page.tsx     # /resume/[id] — inline editor, Download PDF
│   └── master/page.tsx   # /resume/master — edit master resume
└── applied/page.tsx      # /applied — application log table
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
```

---

## AI Tailoring Pipeline

The master resume is the single source of truth — GPT-4o may only select or rephrase facts that exist in it, never invent new ones.

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
- Docker (for local Postgres + Redis)
- [Tectonic](https://tectonic-typesetting.github.io/) — `brew install tectonic`
- OpenAI API key
- Resend API key
- Google service account with Sheets API access

### Local Setup

```bash
# Install dependencies
npm install

# Start Postgres + Redis
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
REDIS_URL=redis://localhost:6379

OPENAI_API_KEY=sk-...

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

Both services share the same Railway Postgres and Redis instances. Set `WEB_URL` on the agent service to the web service's Railway URL, and `NEXT_PUBLIC_AGENT_URL` on the web service to the agent's Railway URL.

---

## Key Design Decisions

**No RAG / pgvector** — The master resume is small enough to fit entirely in a single GPT-4o prompt. Embedding chunks and doing cosine retrieval adds complexity with no benefit at this scale.

**generate → critique → revise loop** — A single tailoring pass produces inconsistent quality. Running a separate critic model that scores the draft and returns a fix list, then revising, reliably pushes output quality above a useful threshold.


**BullMQ over direct async calls** — Multiple jobs dropping simultaneously need concurrent processing without race conditions. BullMQ's Redis-backed queue handles per-domain concurrency limits cleanly.

**No auth** — Single user, private Railway URL. Adding auth would add overhead with zero security benefit in this setup.
