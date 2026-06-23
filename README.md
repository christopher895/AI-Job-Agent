# AI Job Hunting Agent

An autonomous agent that monitors 20+ company career pages around the clock, detects new job postings the moment they drop, scores how well each role fits your profile, rewrites your resume bullets to match — then texts and emails you within 15 minutes. No manual searching, no missed deadlines.

---

## How It Works

```
Every 15 minutes
  ↓
Playwright / Cheerio scrapes each career page
  ↓
Snapshot diffing (hash sets) detects new postings
  ↓
RAG pipeline retrieves relevant resume chunks via pgvector cosine similarity
  ↓
GPT-4o scores role fit 1–100 with reasoning
  ↓
GPT-4o rewrites your resume bullets to match the job description
  ↓
Twilio SMS  +  Resend email (PDF resume attached)
```

---

## Tech Stack

| Layer         | Tools                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Frontend      | Next.js 14, TypeScript, Tailwind CSS, Shadcn/ui                           |
| Backend       | Node.js, Express, PostgreSQL, pgvector, Redis, BullMQ, node-cron          |
| Scraping      | Playwright (dynamic pages), Cheerio (static pages), custom diff algorithm |
| AI / RAG      | OpenAI GPT-4o, text-embedding-3-small, LangChain JS, Zod                  |
| Notifications | Twilio (SMS), Resend (email + PDF)                                        |
| Auth          | Clerk                                                                     |
| Infra         | Railway (24/7 deployment), Docker Compose (local dev)                     |

---

## Architecture

### Monorepo Structure

```
job-hunting-agent/
├── packages/
│   ├── web/          # Next.js dashboard
│   └── agent/        # Autonomous scraper + AI pipeline
├── prisma/           # Database schema
├── docker-compose.yml
└── .env.example
```

### Agent Package

The core of the system — runs headlessly, no human in the loop.

```
agent/
├── scraper/
│   ├── playwright.ts   # Scrapes JS-rendered career pages
│   ├── cheerio.ts      # Scrapes static HTML pages
│   └── diff.ts         # Compares snapshots to find new postings
├── rag/
│   ├── embed.ts        # Chunks + embeds your resume into pgvector
│   └── retrieve.ts     # Cosine similarity search over resume chunks
├── ai/
│   ├── scorer.ts       # Fits score 1–100 via GPT-4o
│   ├── tailor.ts       # Rewrites resume bullets per role
│   └── chain.ts        # LangChain orchestration
├── notifications/
│   ├── sms.ts          # Twilio SMS
│   └── email.ts        # Resend email with PDF resume
├── queue/              # BullMQ workers + producers
└── cron/               # node-cron scheduler (every 15 min)
```

### Dashboard (web package)

A Next.js app for viewing and managing the agent.

- **Dashboard** — detected jobs table sorted by fit score
- **Companies** — add/remove tracked career pages
- **History** — every job ever detected, filterable by company/score/date
- **Settings** — upload a new resume, set score threshold, toggle SMS/email

---

## Database Schema

```sql
companies     (id, name, careers_url, scrape_type, active, created_at)
jobs          (id, company_id, title, url, description, detected_at, is_new)
snapshots     (id, company_id, raw_html, job_hashes[], scraped_at)
resume_chunks (id, content, embedding vector(1536), chunk_type, created_at)
```

Resume chunks are stored by type — `experience`, `project`, `skill`, `summary` — so retrieval can pull the most relevant sections for any given job description.

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for local Postgres + Redis)
- OpenAI API key
- Twilio account
- Resend account
- Clerk account

### Local Setup

```bash
# Install dependencies
npm install

# Start Postgres + Redis
docker-compose up -d

# Copy env vars
cp .env.example .env
# Fill in your keys

# Run the agent
npm run dev --workspace=packages/agent

# Run the dashboard
npm run dev --workspace=packages/web
```

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/job_agent
REDIS_URL=redis://localhost:6379

# AI
OPENAI_API_KEY=sk-...

# Notifications
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
YOUR_PHONE_NUMBER=+1...
RESEND_API_KEY=re_...
YOUR_EMAIL=you@example.com

# Auth
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
```

---

## Key Design Decisions

**pgvector over Pinecone** — At the scale of a few hundred resume chunks, pgvector inside the existing Postgres instance keeps the stack simple and costs nothing extra. Pinecone would only make sense at millions of vectors or sub-10ms latency requirements.

**BullMQ over direct async calls** — Multiple jobs dropping simultaneously need concurrent processing without race conditions or duplicate alerts. BullMQ's Redis-backed queue handles concurrency limits per domain cleanly.

**Snapshot diffing via hash sets** — O(n) comparison of job URL hashes between scrape runs. Simple, fast, and easy to reason about in an interview.

**Zod on all LLM outputs** — GPT-4o occasionally returns malformed JSON. Zod catches schema violations before they propagate through the pipeline, with retry logic on failure.

---

## Deployment

The app runs on Railway with both the `web` and `agent` packages deployed as separate services. Railway natively supports cron jobs and background workers, so node-cron keeps running without any extra configuration.

**Stack:** Next.js · TypeScript · PostgreSQL · pgvector · Playwright · LangChain · OpenAI · Redis · Twilio
