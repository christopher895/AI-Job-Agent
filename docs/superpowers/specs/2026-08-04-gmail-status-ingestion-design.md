# Gmail → Application Status Ingestion — Design

**Date:** 2026-08-04
**Owner:** Christopher Zhang
**Status:** Approved design, pending implementation plan

## Problem

The agent finds jobs and logs applications, but everything after "applied" is manual.
Recruiter/ATS emails (online assessments, interview invites, rejections, offers) land in
Gmail and never make it back into `applied_jobs` unless Christopher updates each row by
hand. Deadlines get missed (the motivating case: a Bank of America OA due in a few days,
buried in the inbox).

This feature closes the loop: read job-related Gmail, advance the matching application's
status, keep a dated history of every transition, and fire a high-signal alert when an
email needs action.

## Scope

**In scope (this build):**
- Read new Gmail on a schedule (consumer `@gmail.com`, OAuth2 refresh token).
- Classify job-related emails and extract status + any deadline/scheduled date.
- Match each email to an **existing** `applied_jobs` row (deterministic fuzzy match).
- Advance the matched row's status, append a dated `status_events` record, sync to Sheets.
- Alert via Resend when a row moves to **assessment**, **interviewing**, or **offer**,
  leading with the extracted deadline.
- Route ambiguous / unmatched emails to a **"Needs review"** panel on `/applied`.
- Record every **manual** status change as a `status_events` row too, so the timeline is
  complete from day one.

**Explicitly out of scope (deferred, YAGNI — easy to add on this spine later):**
- Creating new `applied_jobs` rows from applications that were never logged.
- The 30-day "silent rejection" staleness sweep.
- Google Calendar event creation for deadlines.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| What ingestion may do | **Update existing rows only** | Never invents rows; ambiguous → review. Lowest blast radius. |
| History storage | **New `status_events` append-only table** | Dated funnel (`Applied → OA → Rejected`) + audit of which email caused each change. `applied_jobs.status` stays the "current" value so `/applied` + Sheets are unchanged. |
| Notify on | **assessment / interviewing / offer** | The states that need action; rejections/no-response update silently to stay high-signal. |
| Deadlines | **Extract date into the alert**, store on the event | The whole value of the alert is not missing the deadline. No date found → alert still sends. |
| Ambiguous matches | **"Needs review" panel on `/applied`** | Reuses the page already checked; no new page/nav to remember. |
| Matching | **Deterministic** (LLM classifies only) | Testable, cheap, no silent fuzzy overwrites. Returns null when top-2 candidates are within a margin. |

## Auth

The existing Sheets writer uses a **service account**, which **cannot** read a consumer
`@gmail.com` inbox — domain-wide delegation only exists for Workspace domains. Gmail
ingestion therefore needs its **own** credential: an OAuth2 client with a stored
**refresh token** and the `gmail.readonly` scope.

- New env vars: `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`,
  `GMAIL_OAUTH_REFRESH_TOKEN`.
- One-time helper `scripts/mint-gmail-token.ts` runs the local consent flow and prints the
  refresh token to paste into Railway. Read-only scope — the agent never sends or deletes
  mail.
- Added to `.env.example` with the existing commented style.

## Data model

```sql
-- Incremental sync checkpoint (singleton, like preferences/master_resume)
gmail_sync_state (
  id           INT PRIMARY KEY DEFAULT 1,
  history_id   TEXT,                 -- last processed Gmail historyId
  last_synced_at TIMESTAMPTZ
)

-- Idempotency guard: never process the same message twice (the 7-day fallback re-reads)
gmail_processed_messages (
  message_id   TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

-- Append-only status history / audit trail
status_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applied_jobs(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,     -- one of the applied_jobs status enum values
  source          TEXT NOT NULL CHECK (source IN ('manual','email')),
  deadline_at     TIMESTAMPTZ,       -- extracted OA/interview date, nullable
  email_message_id TEXT,
  email_subject   TEXT,
  email_snippet   TEXT,
  email_link      TEXT,              -- https://mail.google.com/mail/u/0/#all/<id>
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

-- Low-confidence items awaiting human resolution on /applied
email_review_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id TEXT NOT NULL UNIQUE,
  email_from       TEXT,
  email_subject    TEXT,
  email_snippet    TEXT,
  email_link       TEXT,
  detected_status  TEXT,             -- classifier's guessed status
  detected_deadline_at TIMESTAMPTZ,
  suggested_application_id UUID REFERENCES applied_jobs(id) ON DELETE SET NULL,
  match_score      REAL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ       -- set on confirm/dismiss
)
```

All tables created via idempotent `CREATE TABLE IF NOT EXISTS` migrations in
`db/schema.ts`, consistent with the existing pattern.

## Pipeline

New directory `packages/agent/src/ingest/`.

```
cron tick (guarded flag, runs alongside the scraper tick in scheduler.ts)
 → gmail.ts fetchNewMessages():
     history.list from gmail_sync_state.history_id
       (fallback: messages.list q="newer_than:7d" when the cursor is expired/absent —
        Gmail drops history cursors after ~1 week)
     skip ids already in gmail_processed_messages
 → prefilter (config-driven):
     candidate if sender domain ∈ allowlist (greenhouse.io, lever.co, ashbyhq.com,
     myworkday.com, …) OR subject/body matches recruiting keywords.
     Keeps the LLM to ~a handful of emails/week.
 → classify-email.ts (completeJSON + Zod, mirrors suggest-keywords.ts):
     input: email from/subject/body + candidate applications (id, company, role)
     output: { isJobRelated, status, company, role, deadlineAt, reasoning }
     LLM classifies + extracts ONLY — it does not choose the row.
 → match.ts (deterministic):
     fuzzy company+role similarity (and job_url host when present) vs applied_jobs.
     Returns null when the top-2 candidates are within a fixed margin (ambiguous).
 → decision:
     confident match  → applyStatusEvent()
     null / no match  → enqueue email_review_queue
 → mark message_id in gmail_processed_messages (regardless of branch)
 → advance gmail_sync_state.history_id only after a fully successful tick
```

### `applyStatusEvent()`
1. **Forward-only guard.** Status order: `applied < assessment < interviewing < offer`.
   Don't regress to an earlier state from an out-of-order email. `rejected` and
   `no_response` are terminal-ish and accepted from any non-terminal state; `offer`
   accepted from any state. If the guard rejects the transition, still log the
   `status_events` row (audit) but leave `applied_jobs.status` untouched.
2. Insert `status_events` (source `email`, with deadline + email metadata).
3. Update `applied_jobs.status` and, if `sheets_row` is set, `syncStatusToSheet()`.
4. If new status ∈ {assessment, interviewing, offer} → `sendStatusChangeEmail()`.

## Notifications

New `sendStatusChangeEmail(app, event)` in `notifications/email.ts` (reuses the Resend
client + escaping helpers already there).
- Fires only for **assessment / interviewing / offer**.
- Subject leads with the deadline and is hard to skim past:
  `⚠️ OA due Aug 8 — Bank of America` (falls back to
  `Interview — Bank of America` when no date parsed).
- Body: status, extracted deadline, email snippet, a link to the Gmail thread, and a link
  to the `/applied` row.

## API (all behind the existing BFF proxy + `INTERNAL_API_SECRET`)

- `GET  /api/review` — list unresolved `email_review_queue` items (+ suggested match).
- `POST /api/review/:id/confirm { applicationId }` — run `applyStatusEvent()` for the
  chosen row, mark the queue item resolved.
- `POST /api/review/:id/dismiss` — mark resolved with no change.
- `GET  /api/applied` — extend the existing response so each row carries its
  `status_events` timeline (for the expandable row view).

Typed fetch wrappers added to `packages/web/lib/api.ts`.

## Web UI (`/applied`)

- **"Needs review" panel** at the top: per item — sender, subject, snippet, Gmail link,
  best-guess match — with **confirm** / **pick another application** / **dismiss**.
  Hidden when the queue is empty.
- **Row timeline:** each application row expands to show its `status_events`
  (status, date, source badge manual/email, deadline if any, link to the source email).

## Cron

Second guarded entry in `cron/scheduler.ts` (its own in-flight flag, mirroring the scraper
guard) calling `runEmailIngest()` every 15 minutes. In-process, no queue layer (consistent
with the rest of the agent).

## Error handling & idempotency

- **Idempotent per message:** `gmail_processed_messages` guarantees a message is acted on
  once even though the 7-day fallback re-reads it.
- **Checkpoint safety:** `history_id` advances only after a fully successful tick; a failed
  tick reprocesses (dedup makes that safe).
- **Gmail API errors:** log, abort the tick, don't advance the checkpoint.
- **LLM output:** validated with Zod + retry via the existing `completeJSON` behavior; a
  non-job email (`isJobRelated=false`) is marked processed and skipped.
- **No silent overwrites:** ambiguous match → review queue, never a guessed write.
- **Forward-only guard** prevents out-of-order emails from regressing a status.

## Testing

**Unit**
- `match.ts`: exact match, fuzzy match above threshold, ambiguous top-2 → null,
  no-candidate → null.
- `classify-email.ts`: Zod parse of representative fixtures (OA invite, interview invite,
  rejection, offer, unrelated newsletter).
- Forward-only transition guard: each ordered pair.
- Deadline → subject formatting (with and without a parsed date).

**Integration**
- Mock Gmail messages → `runEmailIngest()` → assert `status_events` rows,
  `applied_jobs.status`, review-queue entries, and `gmail_processed_messages` dedup
  (re-running the same batch is a no-op).

## New files / touch points

```
packages/agent/src/
  integrations/gmail.ts          # OAuth2 client (refresh token), fetchNewMessages()
  ai/classify-email.ts           # completeJSON + Zod classifier
  ingest/
    match.ts                     # deterministic company+role matcher
    email-ingest.ts              # orchestrator: fetch → classify → match → apply/enqueue
  notifications/email.ts         # + sendStatusChangeEmail()
  cron/scheduler.ts              # + guarded email-ingest tick
  db/schema.ts                   # + 4 tables
  db/queries.ts                  # status_events, review-queue, sync-state, processed CRUD
  api/routes/                    # review.ts; extend applied.ts
  config.ts                      # sender allowlist + recruiting keywords
scripts/mint-gmail-token.ts      # one-time refresh-token minting helper
packages/web/
  lib/api.ts                     # review + timeline wrappers
  app/applied/page.tsx           # needs-review panel + row timeline
  components/                    # ReviewPanel, StatusTimeline
.env.example                     # GMAIL_OAUTH_* vars
CLAUDE.md                        # document the new pipeline
```

## Rollout

1. Ship schema + backend pipeline with the cron **disabled** (env flag) — verify via the
   integration test and a manual one-shot run.
2. Mint the refresh token, set env vars on staging, run one-shot against a real inbox,
   confirm classification/matching quality on real recruiter mail.
3. Enable the cron on staging, then production.
