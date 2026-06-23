# AI Job Hunting Agent — Claude Context

## What This Is

An autonomous AI agent that monitors 20+ company career pages 24/7, detects new job postings via Playwright scraping and snapshot diffing, scores role fit using a RAG pipeline over embedded resume data, auto-tailors resume bullets per role, and delivers real-time SMS/email alerts — all without human input.

Owner: **Christopher Zhang** (Summer 2026 build)

## Repository Structure

Monorepo using npm workspaces with two main packages:

```
job-hunting-agent/
├── packages/
│   ├── web/          # Next.js 14 dashboard
│   └── agent/        # Autonomous scraper + AI pipeline
├── prisma/           # DB schema (optional ORM)
├── docker-compose.yml
└── .env.example
```

### `packages/agent/` layout

```
agent/
├── scraper/
│   ├── index.ts        # Orchestrator
│   ├── playwright.ts   # JS-rendered pages
│   ├── cheerio.ts      # Static HTML pages
│   └── diff.ts         # Snapshot diffing algorithm (core logic)
├── rag/
│   ├── embed.ts        # Embeds resume into pgvector
│   ├── retrieve.ts     # Cosine similarity retrieval
│   └── index.ts        # RAG pipeline entry
├── ai/
│   ├── scorer.ts       # Fit score 1–100 via GPT-4o
│   ├── tailor.ts       # Resume bullet rewriter
│   ├── cover.ts        # Cover note generator
│   └── chain.ts        # LangChain orchestration
├── notifications/
│   ├── sms.ts          # Twilio
│   └── email.ts        # Resend (with PDF resume attachment)
├── queue/
│   ├── worker.ts       # BullMQ worker
│   └── producer.ts     # BullMQ producer
├── cron/
│   └── scheduler.ts    # node-cron — runs every 15 min
└── db/
    ├── schema.ts
    └── queries.ts
```

### `packages/web/` layout

```
web/
├── app/
│   ├── page.tsx         # Dashboard — detected jobs table
│   ├── companies/       # Manage tracked companies
│   ├── history/         # All jobs ever detected
│   └── settings/        # Alert prefs, resume upload
├── components/
│   ├── JobCard.tsx
│   ├── ScoreBadge.tsx
│   └── CompanyList.tsx
└── lib/
    └── api.ts
```

## Tech Stack

### Frontend

- Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/ui

### Backend

- Node.js + Express, PostgreSQL, pgvector (RAG embeddings), Redis + BullMQ (queue), node-cron

### Scraping

- Playwright (JS-rendered pages), Cheerio (static HTML), custom snapshot diffing via hash sets

### AI / RAG

- OpenAI API (GPT-4o for scoring/tailoring), OpenAI text-embedding-3-small, LangChain JS, Zod (LLM output validation)

### Notifications + Auth + Infra

- Twilio (SMS), Resend (email + PDF), Clerk (auth), Railway (deployment), Supabase (managed Postgres option)

## Database Schema

```sql
companies    (id, name, careers_url, scrape_type, active, created_at)
jobs         (id, company_id, title, url, description, detected_at, is_new)
snapshots    (id, company_id, raw_html, job_hashes[], scraped_at)
resume_chunks(id, content, embedding vector(1536), chunk_type, created_at)
-- chunk_type: 'experience' | 'project' | 'skill' | 'summary'
```

## Core Agent Pipeline

```
cron (every 15 min)
  → BullMQ producer (adds scrape tasks)
    → BullMQ worker
      → Playwright/Cheerio scrape
        → diff.ts (hash set comparison → new jobs)
          → RAG retrieve (cosine similarity over pgvector)
            → GPT-4o scorer (1–100 + reasoning)
              → GPT-4o tailor (rewrite resume bullets)
                → Twilio SMS + Resend email (with PDF resume)
```

## Environment Variables

```
DATABASE_URL
REDIS_URL
OPENAI_API_KEY
RESEND_API_KEY
YOUR_EMAIL
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
```

## MVP Scope (Week 4 deadline)

- Scraper for 10–20 hardcoded company career pages
- Snapshot diffing to detect new postings
- RAG pipeline with resume embedded in pgvector
- Job fit scorer (1–100 with reasoning)
- Auto-tailored resume bullets per role
- SMS alert via Twilio + email via Resend
- Next.js dashboard for detected jobs
- Deployed on Railway running 24/7

## Security

- `.env` is gitignored — never commit it. `.env.example` has placeholder values only.
- Husky pre-commit hook blocks `.env` files and common API key patterns from being staged.
- If keys are ever exposed: rotate them immediately in the provider dashboard, then run `git filter-repo --invert-paths --path .env --force` + force push.
- `auth.json` (Playwright session cookies) is also gitignored.

## Available Claude Code Skills

Use these proactively — don't wait to be asked:

- `/code-review` — run before any PR or push to catch bugs and simplification opportunities
- `/security-review` — run when touching auth, env vars, API integrations, or scraping logic
- `/verify` — run after any feature to confirm it works end-to-end in the real app
- `/run` — launch the agent or dashboard to test changes live

Automate with hooks (via `/update-config`):

- Pre-commit: Husky already handles `.env` blocking and TypeScript checks
- Pre-push: good candidate for `/security-review` on branches touching credentials

## Dev Notes

- Local infra runs via `docker-compose` (Postgres + Redis)
- Scraper uses 2–5s random delays between requests; respects robots.txt
- BullMQ concurrency limits prevent hammering individual domains
- All LLM outputs validated with Zod; retry logic on failed calls
- Resume chunked by role: experience (per role), projects (per project), skills, summary
- Score threshold for alerts: > 60 by default (configurable in settings)
- PDF generation uses pdf-lib or Puppeteer for the resume attachment
