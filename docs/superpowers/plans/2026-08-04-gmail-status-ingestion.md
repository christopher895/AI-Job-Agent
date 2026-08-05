# Gmail Application-Status Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read job-related Gmail on a schedule, advance the matching `applied_jobs` row's status, keep a dated status history, alert on action-needed states, and route ambiguous emails to a review panel on `/applied`.

**Architecture:** A guarded cron tick fetches new Gmail via an OAuth2 refresh-token client, a prefilter narrows to recruiting mail, an LLM classifies each candidate (status + deadline + the company/role it names), a deterministic matcher ties it to one existing `applied_jobs` row, and the orchestrator either applies a `status_events` record (advancing the row + syncing Sheets + alerting) or enqueues a review item. Ingestion updates existing rows only; it never creates or deletes application rows.

**Tech Stack:** TypeScript, Node + Express, PostgreSQL (`pg`), `googleapis` (Gmail API), Zod, `completeJSON` (Claude CLI / OpenAI), Resend, node-cron, Next.js 16 (App Router).

## Global Constraints

- **Update existing rows only.** Ingestion never creates or deletes `applied_jobs` rows; unmatched/ambiguous mail goes to the review queue.
- **Status values are exactly:** `applied`, `assessment`, `interviewing`, `offer`, `rejected`, `no_response` (the existing `applied_jobs` CHECK constraint — do not add new values).
- **Notify only on:** `assessment`, `interviewing`, `offer`.
- **Deterministic matching only.** The LLM classifies and extracts; it never chooses the row. The matcher returns `null` when the top-2 candidates are within `MATCH_AMBIGUITY_MARGIN = 0.15`.
- **Match acceptance threshold:** `MATCH_MIN_SCORE = 0.6`. Below it → review queue.
- **Forward-only status guard:** never regress to an earlier state; `rejected`/`no_response` accepted from any state; `offer` is highest rank so the rank rule covers it.
- **Idempotent per message:** every Gmail message id is recorded in `gmail_processed_messages` and acted on at most once (the 7-day fallback re-reads).
- **Never advance `gmail_sync_state.history_id`** until a tick fully succeeds.
- **DB schema is additive/non-destructive** — `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, matching the existing `db/schema.ts` style.
- **Tests follow the repo convention:** ad-hoc `tsx` scripts ending in `process.exit(pass ? 0 : 1)`, wired into `npm test` (self-contained: no DB/LLM/network) or `npm run test:integration` (needs Postgres/LLM). Never put a DB/LLM/network test in the default `test` chain.
- **Gmail auth:** consumer Gmail needs its own OAuth2 client + refresh token with `gmail.readonly` — the Sheets service account cannot read consumer Gmail. Env: `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`.
- **Cron is opt-in:** guarded by `GMAIL_INGEST_ENABLED === "true"` so it stays off until classification quality is verified.

---

## File Structure

**Create:**
- `packages/agent/src/ingest/types.ts` — shared types (`EmailMessage`, `ClassifiedEmail`, `MatchResult`, `IngestDeps`).
- `packages/agent/src/ingest/match.ts` — deterministic company+role matcher.
- `packages/agent/src/ingest/prefilter.ts` — sender-allowlist + keyword gate.
- `packages/agent/src/ingest/status-order.ts` — `canAdvance()` forward-only guard.
- `packages/agent/src/ingest/email-ingest.ts` — orchestrator + `applyStatusEvent()`.
- `packages/agent/src/integrations/gmail.ts` — OAuth2 client + `fetchNewMessages()` + `parseMessage()`.
- `packages/agent/src/api/routes/review.ts` — review-queue endpoints.
- `packages/agent/src/ingest/test-match.ts` — unit (self-contained).
- `packages/agent/src/ingest/test-prefilter.ts` — unit (self-contained).
- `packages/agent/src/ingest/test-status-order.ts` — unit (self-contained).
- `packages/agent/src/integrations/test-gmail-parse.ts` — unit (self-contained).
- `packages/agent/src/ai/test-classify-email.ts` — integration (LLM).
- `packages/agent/src/ingest/test-email-ingest.ts` — integration (DB + fakes).
- `packages/agent/src/ai/classify-email.ts` — LLM classifier.
- `scripts/mint-gmail-token.ts` — one-time refresh-token minting helper.
- `packages/web/components/ReviewPanel.tsx` — needs-review UI.
- `packages/web/components/StatusTimeline.tsx` — per-row event history.

**Modify:**
- `packages/agent/src/db/schema.ts` — add 4 tables.
- `packages/agent/src/db/queries.ts` — sync-state, processed-messages, status-events, review-queue queries; record manual status events.
- `packages/agent/src/config.ts` — `GMAIL_SENDER_ALLOWLIST`, `RECRUITING_KEYWORDS`, matcher constants.
- `packages/agent/src/notifications/email.ts` — `sendStatusChangeEmail()`.
- `packages/agent/src/cron/scheduler.ts` — guarded ingest tick.
- `packages/agent/src/api/index.ts` — mount `/review`.
- `packages/agent/src/api/routes/applied.ts` — include `status_events` timeline in the list response; write a manual `status_events` row on PATCH.
- `packages/web/lib/api.ts` — review + timeline types and wrappers.
- `packages/web/app/applied/page.tsx` — render `ReviewPanel`.
- `packages/web/components/AppliedTable.tsx` — expandable `StatusTimeline` per row.
- `packages/agent/package.json` — new `test:*` scripts + additions to the `test` / `test:integration` chains.
- `.env.example` — the 4 new env vars.
- `CLAUDE.md` — document the pipeline.

---

## Task 1: Database schema — four new tables

**Files:**
- Modify: `packages/agent/src/db/schema.ts` (inside `initSchema()`, before the final index block)
- Test: exercised via Task 2's integration test (schema is verified by the queries that use it).

**Interfaces:**
- Produces: tables `gmail_sync_state`, `gmail_processed_messages`, `status_events`, `email_review_queue`.

- [ ] **Step 1: Add the tables**

In `packages/agent/src/db/schema.ts`, immediately before the `CREATE INDEX ... idx_tailored_resumes_created` block near the end of `initSchema()`, insert:

```ts
  // ── Gmail application-status ingestion ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_sync_state (
      id             INT PRIMARY KEY DEFAULT 1,
      history_id     TEXT,
      last_synced_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_processed_messages (
      message_id   TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS status_events (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id   UUID NOT NULL REFERENCES applied_jobs(id) ON DELETE CASCADE,
      status           TEXT NOT NULL,
      source           TEXT NOT NULL CHECK (source IN ('manual','email')),
      deadline_at      TIMESTAMPTZ,
      email_message_id TEXT,
      email_subject    TEXT,
      email_snippet    TEXT,
      email_link       TEXT,
      occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_review_queue (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_message_id         TEXT NOT NULL UNIQUE,
      email_from               TEXT,
      email_subject            TEXT,
      email_snippet            TEXT,
      email_link               TEXT,
      detected_status          TEXT,
      detected_deadline_at     TIMESTAMPTZ,
      suggested_application_id  UUID REFERENCES applied_jobs(id) ON DELETE SET NULL,
      match_score              REAL,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at              TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_status_events_application ON status_events(application_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_review_queue_unresolved ON email_review_queue(created_at) WHERE resolved_at IS NULL;
  `);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/agent && npx tsc --noEmit 2>&1 | grep -v "multer\|pdf-parse" | head`
Expected: no new errors (the pre-existing `multer`/`pdf-parse` lines are unrelated).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/db/schema.ts
git commit -m "feat(ingest): add gmail sync-state, processed-messages, status_events, review-queue tables"
```

---

## Task 2: DB queries — sync state, processed messages, status events, review queue

**Files:**
- Modify: `packages/agent/src/db/queries.ts` (append a new section at the end)
- Test: `packages/agent/src/db/test-ingest-queries.ts` (integration — needs Postgres)

**Interfaces:**
- Consumes: `pool` from `./pool`; `applied_jobs` rows.
- Produces:
  - `getGmailSyncState(): Promise<{ history_id: string | null; last_synced_at: Date | null }>`
  - `setGmailSyncState(historyId: string): Promise<void>`
  - `isMessageProcessed(messageId: string): Promise<boolean>`
  - `markMessageProcessed(messageId: string): Promise<void>`
  - `type StatusEventRow = { id: string; application_id: string; status: string; source: "manual" | "email"; deadline_at: Date | null; email_message_id: string | null; email_subject: string | null; email_snippet: string | null; email_link: string | null; occurred_at: Date }`
  - `createStatusEvent(fields: { applicationId: string; status: string; source: "manual" | "email"; deadlineAt?: Date | null; emailMessageId?: string | null; emailSubject?: string | null; emailSnippet?: string | null; emailLink?: string | null }): Promise<StatusEventRow>`
  - `listStatusEventsByApplication(): Promise<Record<string, StatusEventRow[]>>` (all events grouped by `application_id`, ascending `occurred_at`)
  - `type ReviewQueueRow = { id: string; email_message_id: string; email_from: string | null; email_subject: string | null; email_snippet: string | null; email_link: string | null; detected_status: string | null; detected_deadline_at: Date | null; suggested_application_id: string | null; match_score: number | null; created_at: Date; resolved_at: Date | null }`
  - `enqueueReview(fields: { emailMessageId: string; emailFrom?: string; emailSubject?: string; emailSnippet?: string; emailLink?: string; detectedStatus?: string; detectedDeadlineAt?: Date | null; suggestedApplicationId?: string | null; matchScore?: number | null }): Promise<ReviewQueueRow>`
  - `listPendingReviews(): Promise<ReviewQueueRow[]>`
  - `getReview(id: string): Promise<ReviewQueueRow | null>`
  - `resolveReview(id: string): Promise<void>`
  - `getAppliedJob(id: string): Promise<AppliedJobRow | null>`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/db/test-ingest-queries.ts`:

```ts
import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  getGmailSyncState, setGmailSyncState,
  isMessageProcessed, markMessageProcessed,
  createStatusEvent, listStatusEventsByApplication,
  enqueueReview, listPendingReviews, getReview, resolveReview,
  createAppliedJob, getAppliedJob,
} from "./queries";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

async function main() {
  await initSchema();

  // sync state
  const empty = await getGmailSyncState();
  check("sync state starts null", empty.history_id === null);
  await setGmailSyncState("hist-123");
  check("sync state persists", (await getGmailSyncState()).history_id === "hist-123");
  await setGmailSyncState("hist-456");
  check("sync state upserts", (await getGmailSyncState()).history_id === "hist-456");

  // processed messages
  check("unseen message not processed", (await isMessageProcessed("m-1")) === false);
  await markMessageProcessed("m-1");
  check("seen message processed", (await isMessageProcessed("m-1")) === true);
  await markMessageProcessed("m-1"); // idempotent, no throw

  // status events tied to a real application
  const app = await createAppliedJob({ company: "TestCo", jobTitle: "SWE Intern" });
  const ev = await createStatusEvent({
    applicationId: app.id, status: "assessment", source: "email",
    deadlineAt: new Date("2026-08-08T00:00:00Z"), emailMessageId: "m-2",
    emailSubject: "OA", emailSnippet: "complete by", emailLink: "https://mail.google.com/x",
  });
  check("status event created", ev.status === "assessment" && ev.source === "email");
  const grouped = await listStatusEventsByApplication();
  check("events grouped by application", (grouped[app.id]?.length ?? 0) >= 1);

  // review queue
  const r = await enqueueReview({ emailMessageId: "m-3", emailFrom: "recruiter@x.com", detectedStatus: "interviewing", matchScore: 0.4 });
  check("review enqueued", r.email_message_id === "m-3");
  check("pending review listed", (await listPendingReviews()).some((x) => x.id === r.id));
  check("getReview works", (await getReview(r.id))?.id === r.id);
  await resolveReview(r.id);
  check("resolved review not pending", !(await listPendingReviews()).some((x) => x.id === r.id));

  check("getAppliedJob works", (await getAppliedJob(app.id))?.id === app.id);

  await pool.end();
  console.log(pass ? "\n✓ ingest-queries test PASSED" : "\n✗ ingest-queries test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/db/test-ingest-queries.ts`
Expected: FAIL — imports like `getGmailSyncState` are not exported yet (compile error).

- [ ] **Step 3: Implement the queries**

Append to `packages/agent/src/db/queries.ts`:

```ts
// ── Gmail ingestion: sync state + processed messages ─────────────────────────

export async function getGmailSyncState(): Promise<{ history_id: string | null; last_synced_at: Date | null }> {
  const { rows } = await pool.query("SELECT history_id, last_synced_at FROM gmail_sync_state WHERE id = 1");
  return rows[0] ?? { history_id: null, last_synced_at: null };
}

export async function setGmailSyncState(historyId: string): Promise<void> {
  await pool.query(
    `INSERT INTO gmail_sync_state (id, history_id, last_synced_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET history_id = EXCLUDED.history_id, last_synced_at = NOW()`,
    [historyId]
  );
}

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM gmail_processed_messages WHERE message_id = $1", [messageId]);
  return (rowCount ?? 0) > 0;
}

export async function markMessageProcessed(messageId: string): Promise<void> {
  await pool.query(
    "INSERT INTO gmail_processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING",
    [messageId]
  );
}

// ── Gmail ingestion: status events ───────────────────────────────────────────

export type StatusEventRow = {
  id: string;
  application_id: string;
  status: string;
  source: "manual" | "email";
  deadline_at: Date | null;
  email_message_id: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  occurred_at: Date;
};

export async function createStatusEvent(fields: {
  applicationId: string;
  status: string;
  source: "manual" | "email";
  deadlineAt?: Date | null;
  emailMessageId?: string | null;
  emailSubject?: string | null;
  emailSnippet?: string | null;
  emailLink?: string | null;
}): Promise<StatusEventRow> {
  const { rows } = await pool.query(
    `INSERT INTO status_events
       (application_id, status, source, deadline_at, email_message_id, email_subject, email_snippet, email_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      fields.applicationId, fields.status, fields.source, fields.deadlineAt ?? null,
      fields.emailMessageId ?? null, fields.emailSubject ?? null,
      fields.emailSnippet ?? null, fields.emailLink ?? null,
    ]
  );
  return rows[0];
}

/** All status events, grouped by application_id, each list ascending by occurred_at. */
export async function listStatusEventsByApplication(): Promise<Record<string, StatusEventRow[]>> {
  const { rows } = await pool.query<StatusEventRow>(
    "SELECT * FROM status_events ORDER BY occurred_at ASC"
  );
  const out: Record<string, StatusEventRow[]> = {};
  for (const r of rows) (out[r.application_id] ??= []).push(r);
  return out;
}

// ── Gmail ingestion: review queue ────────────────────────────────────────────

export type ReviewQueueRow = {
  id: string;
  email_message_id: string;
  email_from: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  detected_status: string | null;
  detected_deadline_at: Date | null;
  suggested_application_id: string | null;
  match_score: number | null;
  created_at: Date;
  resolved_at: Date | null;
};

export async function enqueueReview(fields: {
  emailMessageId: string;
  emailFrom?: string;
  emailSubject?: string;
  emailSnippet?: string;
  emailLink?: string;
  detectedStatus?: string;
  detectedDeadlineAt?: Date | null;
  suggestedApplicationId?: string | null;
  matchScore?: number | null;
}): Promise<ReviewQueueRow> {
  const { rows } = await pool.query(
    `INSERT INTO email_review_queue
       (email_message_id, email_from, email_subject, email_snippet, email_link,
        detected_status, detected_deadline_at, suggested_application_id, match_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (email_message_id) DO NOTHING
     RETURNING *`,
    [
      fields.emailMessageId, fields.emailFrom ?? null, fields.emailSubject ?? null,
      fields.emailSnippet ?? null, fields.emailLink ?? null, fields.detectedStatus ?? null,
      fields.detectedDeadlineAt ?? null, fields.suggestedApplicationId ?? null, fields.matchScore ?? null,
    ]
  );
  // ON CONFLICT DO NOTHING returns no row when the message is already queued — read it back.
  if (rows[0]) return rows[0];
  const existing = await pool.query("SELECT * FROM email_review_queue WHERE email_message_id = $1", [fields.emailMessageId]);
  return existing.rows[0];
}

export async function listPendingReviews(): Promise<ReviewQueueRow[]> {
  const { rows } = await pool.query(
    "SELECT * FROM email_review_queue WHERE resolved_at IS NULL ORDER BY created_at DESC"
  );
  return rows;
}

export async function getReview(id: string): Promise<ReviewQueueRow | null> {
  const { rows } = await pool.query("SELECT * FROM email_review_queue WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function resolveReview(id: string): Promise<void> {
  await pool.query("UPDATE email_review_queue SET resolved_at = NOW() WHERE id = $1", [id]);
}

export async function getAppliedJob(id: string): Promise<AppliedJobRow | null> {
  const { rows } = await pool.query("SELECT * FROM applied_jobs WHERE id = $1", [id]);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/db/test-ingest-queries.ts`
Expected: PASS — `✓ ingest-queries test PASSED` (requires local Postgres via `docker-compose up`).

- [ ] **Step 5: Wire the test into the integration chain**

In `packages/agent/package.json`, add the script and append it to `test:integration`:

```json
    "test:ingest-queries": "tsx src/db/test-ingest-queries.ts",
```
and change the `test:integration` value to end with ` && npm run test:ingest-queries`.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/db/queries.ts packages/agent/src/db/test-ingest-queries.ts packages/agent/package.json
git commit -m "feat(ingest): add sync-state, processed-message, status-event, and review-queue queries"
```

---

## Task 3: Deterministic matcher

**Files:**
- Create: `packages/agent/src/ingest/types.ts`
- Create: `packages/agent/src/ingest/match.ts`
- Create: `packages/agent/src/config.ts` additions (matcher constants)
- Test: `packages/agent/src/ingest/test-match.ts` (self-contained)

**Interfaces:**
- Produces:
  - `type MatchCandidate = { id: string; company: string; role: string }`
  - `type MatchResult = { applicationId: string; score: number } | null`
  - `matchApplication(candidates: MatchCandidate[], target: { company: string; role: string }, opts?: { minScore?: number; margin?: number }): MatchResult`
  - Constants in `config.ts`: `MATCH_MIN_SCORE = 0.6`, `MATCH_AMBIGUITY_MARGIN = 0.15`.

- [ ] **Step 1: Add constants to config**

Append to `packages/agent/src/config.ts`:

```ts
// ── Gmail ingestion tuning ───────────────────────────────────────────────────
export const MATCH_MIN_SCORE = 0.6;      // below this → review queue
export const MATCH_AMBIGUITY_MARGIN = 0.15; // top-2 within this → ambiguous → review queue
```

- [ ] **Step 2: Write the failing test**

Create `packages/agent/src/ingest/test-match.ts`:

```ts
import { matchApplication, MatchCandidate } from "./match";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const candidates: MatchCandidate[] = [
  { id: "a", company: "Bank of America", role: "Software Engineer Intern" },
  { id: "b", company: "Google", role: "STEP Intern" },
  { id: "c", company: "Stripe", role: "Backend Engineer Intern" },
];

// exact-ish company + role → confident match to a
const exact = matchApplication(candidates, { company: "Bank of America", role: "Software Engineer Intern" });
check("exact match picks a", exact?.applicationId === "a");
check("exact match high score", (exact?.score ?? 0) >= 0.6);

// fuzzy company (ATS wording) still matches a
const fuzzy = matchApplication(candidates, { company: "BofA", role: "Buildings and Systems Engineering Summer Intern" });
// "BofA" is a hard alias; expect this to fall through to review (null) rather than mis-match to Google/Stripe
check("unrelated fuzzy does not mis-match", fuzzy === null || fuzzy.applicationId === "a");

// close-but-wrong: two similar companies → ambiguous → null
const ambiguous = matchApplication(
  [{ id: "x", company: "Acme", role: "Software Engineer" }, { id: "y", company: "Acme Corp", role: "Software Engineer" }],
  { company: "Acme", role: "Software Engineer" }
);
check("ambiguous top-2 returns null", ambiguous === null);

// no candidates → null
check("no candidates returns null", matchApplication([], { company: "X", role: "Y" }) === null);

// clearly-below-threshold → null
const weak = matchApplication(candidates, { company: "Netflix", role: "Data Scientist" });
check("below-threshold returns null", weak === null);

console.log(pass ? "\n✓ match test PASSED" : "\n✗ match test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ingest/test-match.ts`
Expected: FAIL — `Cannot find module './match'`.

- [ ] **Step 4: Implement types + matcher**

Create `packages/agent/src/ingest/types.ts`:

```ts
export type EmailMessage = {
  id: string;
  from: string;      // full "Name <addr@host>" header
  fromDomain: string; // lowercased host of the sender address
  subject: string;
  snippet: string;   // Gmail's short preview
  body: string;      // best-effort plain text
  receivedAt: Date;
};

export type ClassifiedEmail = {
  isJobRelated: boolean;
  status: "applied" | "assessment" | "interviewing" | "offer" | "rejected" | "no_response" | "none";
  company: string;
  role: string;
  deadlineAt: string | null; // ISO date or null
};
```

Create `packages/agent/src/ingest/match.ts`:

```ts
import { MATCH_MIN_SCORE, MATCH_AMBIGUITY_MARGIN } from "../config";

export type MatchCandidate = { id: string; company: string; role: string };
export type MatchResult = { applicationId: string; score: number } | null;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Token Jaccard similarity of two strings, 0..1. */
function jaccard(a: string, b: string): number {
  const sa = new Set(norm(a).split(" ").filter(Boolean));
  const sb = new Set(norm(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Company weighted more than role — a right-company/wrong-role email is usually still the right application. */
function score(candidate: MatchCandidate, target: { company: string; role: string }): number {
  const companySim = jaccard(candidate.company, target.company);
  const roleSim = jaccard(candidate.role, target.role);
  return 0.7 * companySim + 0.3 * roleSim;
}

export function matchApplication(
  candidates: MatchCandidate[],
  target: { company: string; role: string },
  opts: { minScore?: number; margin?: number } = {}
): MatchResult {
  const minScore = opts.minScore ?? MATCH_MIN_SCORE;
  const margin = opts.margin ?? MATCH_AMBIGUITY_MARGIN;
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((c) => ({ id: c.id, score: score(c, target) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (top.score < minScore) return null;                       // nothing confident
  if (ranked[1] && top.score - ranked[1].score < margin) return null; // ambiguous
  return { applicationId: top.id, score: top.score };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ingest/test-match.ts`
Expected: PASS — `✓ match test PASSED`.

- [ ] **Step 6: Wire into the self-contained chain + commit**

In `packages/agent/package.json` add `"test:match": "tsx src/ingest/test-match.ts",` and append ` && npm run test:match` to the `test` script.

```bash
git add packages/agent/src/ingest/types.ts packages/agent/src/ingest/match.ts packages/agent/src/ingest/test-match.ts packages/agent/src/config.ts packages/agent/package.json
git commit -m "feat(ingest): deterministic company+role application matcher"
```

---

## Task 4: Prefilter (sender allowlist + recruiting keywords)

**Files:**
- Modify: `packages/agent/src/config.ts` (allowlist + keywords)
- Create: `packages/agent/src/ingest/prefilter.ts`
- Test: `packages/agent/src/ingest/test-prefilter.ts` (self-contained)

**Interfaces:**
- Consumes: `EmailMessage` from `./types`.
- Produces: `isCandidateEmail(email: EmailMessage, opts?: { allowlist?: string[]; keywords?: string[] }): boolean`
- `config.ts`: `GMAIL_SENDER_ALLOWLIST: string[]`, `RECRUITING_KEYWORDS: string[]`.

- [ ] **Step 1: Add config lists**

Append to `packages/agent/src/config.ts`:

```ts
// Sender domains that are almost always application-related (ATS + common recruiting infra).
export const GMAIL_SENDER_ALLOWLIST: string[] = [
  "greenhouse.io", "us.greenhouse-mail.io", "lever.co", "hire.lever.co",
  "ashbyhq.com", "myworkday.com", "workday.com", "icims.com", "smartrecruiters.com",
  "successfactors.com", "taleo.net", "brassring.com", "hackerrank.com", "codesignal.com",
  "hackerearth.com", "calendly.com",
];

// Subject/body signals for recruiting mail from senders NOT on the allowlist.
export const RECRUITING_KEYWORDS: string[] = [
  "application", "assessment", "online assessment", "coding challenge", "interview",
  "phone screen", "recruiter", "your candidacy", "next steps", "we received your application",
  "unfortunately", "move forward", "offer", "hiring team", "talent",
];
```

- [ ] **Step 2: Write the failing test**

Create `packages/agent/src/ingest/test-prefilter.ts`:

```ts
import { isCandidateEmail } from "./prefilter";
import { EmailMessage } from "./types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}
function mk(over: Partial<EmailMessage>): EmailMessage {
  return { id: "1", from: "x <a@b.com>", fromDomain: "b.com", subject: "", snippet: "", body: "", receivedAt: new Date(), ...over };
}

check("allowlisted sender passes", isCandidateEmail(mk({ fromDomain: "greenhouse.io" })));
check("allowlist subdomain match passes", isCandidateEmail(mk({ fromDomain: "boards.greenhouse.io" })));
check("keyword in subject passes", isCandidateEmail(mk({ fromDomain: "randomstartup.com", subject: "Your online assessment is ready" })));
check("keyword in body passes", isCandidateEmail(mk({ fromDomain: "randomstartup.com", body: "We received your application and will be in touch." })));
check("plain newsletter is rejected", !isCandidateEmail(mk({ fromDomain: "news.substack.com", subject: "This week in AI", body: "Top stories" })));

console.log(pass ? "\n✓ prefilter test PASSED" : "\n✗ prefilter test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ingest/test-prefilter.ts`
Expected: FAIL — `Cannot find module './prefilter'`.

- [ ] **Step 4: Implement the prefilter**

Create `packages/agent/src/ingest/prefilter.ts`:

```ts
import { GMAIL_SENDER_ALLOWLIST, RECRUITING_KEYWORDS } from "../config";
import { EmailMessage } from "./types";

/** Cheap gate so the LLM only ever sees a handful of emails/week. */
export function isCandidateEmail(
  email: EmailMessage,
  opts: { allowlist?: string[]; keywords?: string[] } = {}
): boolean {
  const allowlist = opts.allowlist ?? GMAIL_SENDER_ALLOWLIST;
  const keywords = opts.keywords ?? RECRUITING_KEYWORDS;

  const domain = email.fromDomain.toLowerCase();
  if (allowlist.some((d) => domain === d || domain.endsWith("." + d))) return true;

  const haystack = `${email.subject}\n${email.snippet}\n${email.body}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ingest/test-prefilter.ts`
Expected: PASS — `✓ prefilter test PASSED`.

- [ ] **Step 6: Wire into the self-contained chain + commit**

Add `"test:prefilter": "tsx src/ingest/test-prefilter.ts",` and append ` && npm run test:prefilter` to `test`.

```bash
git add packages/agent/src/ingest/prefilter.ts packages/agent/src/ingest/test-prefilter.ts packages/agent/src/config.ts packages/agent/package.json
git commit -m "feat(ingest): sender-allowlist + keyword prefilter to gate the LLM"
```

---

## Task 5: Forward-only status guard

**Files:**
- Create: `packages/agent/src/ingest/status-order.ts`
- Test: `packages/agent/src/ingest/test-status-order.ts` (self-contained)

**Interfaces:**
- Produces: `canAdvance(current: string | null, next: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/ingest/test-status-order.ts`:

```ts
import { canAdvance } from "./status-order";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

check("null -> applied", canAdvance(null, "applied"));
check("applied -> assessment", canAdvance("applied", "assessment"));
check("assessment -> interviewing", canAdvance("assessment", "interviewing"));
check("interviewing -> offer", canAdvance("interviewing", "offer"));
check("applied -> offer (skip)", canAdvance("applied", "offer"));
check("no regress interviewing -> applied", !canAdvance("interviewing", "applied"));
check("no regress interviewing -> assessment", !canAdvance("interviewing", "assessment"));
check("same status is no-op", !canAdvance("assessment", "assessment"));
check("rejected from any state", canAdvance("interviewing", "rejected"));
check("no_response from any state", canAdvance("assessment", "no_response"));

console.log(pass ? "\n✓ status-order test PASSED" : "\n✗ status-order test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ingest/test-status-order.ts`
Expected: FAIL — `Cannot find module './status-order'`.

- [ ] **Step 3: Implement the guard**

Create `packages/agent/src/ingest/status-order.ts`:

```ts
// Forward-only ladder for the "in progress" states. rejected/no_response are
// terminal outcomes accepted from any state; offer sits at the top of the ladder.
const RANK: Record<string, number> = { applied: 0, assessment: 1, interviewing: 2, offer: 3 };

export function canAdvance(current: string | null, next: string): boolean {
  if (next === current) return false;
  if (next === "rejected" || next === "no_response") return true;
  const c = current == null ? -1 : (RANK[current] ?? -1);
  const n = RANK[next] ?? -1;
  return n > c;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ingest/test-status-order.ts`
Expected: PASS — `✓ status-order test PASSED`.

- [ ] **Step 5: Wire into the self-contained chain + commit**

Add `"test:status-order": "tsx src/ingest/test-status-order.ts",` and append ` && npm run test:status-order` to `test`.

```bash
git add packages/agent/src/ingest/status-order.ts packages/agent/src/ingest/test-status-order.ts packages/agent/package.json
git commit -m "feat(ingest): forward-only status transition guard"
```

---

## Task 6: Email classifier (LLM)

**Files:**
- Create: `packages/agent/src/ai/classify-email.ts`
- Test: `packages/agent/src/ai/test-classify-email.ts` (integration — LLM)

**Interfaces:**
- Consumes: `completeJSON` from `./llm`; `EmailMessage`, `ClassifiedEmail` from `../ingest/types`.
- Produces: `classifyEmail(email: EmailMessage): Promise<ClassifiedEmail>`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/ai/test-classify-email.ts`:

```ts
import { classifyEmail } from "./classify-email";
import { EmailMessage } from "../ingest/types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}
function mk(over: Partial<EmailMessage>): EmailMessage {
  return { id: "1", from: "x <a@b.com>", fromDomain: "b.com", subject: "", snippet: "", body: "", receivedAt: new Date(), ...over };
}

async function main() {
  const oa = await classifyEmail(mk({
    from: "no-reply <no-reply@greenhouse.io>", fromDomain: "greenhouse.io",
    subject: "Your online assessment for Bank of America",
    body: "Please complete your HackerRank online assessment by August 8, 2026 for the Software Engineer Intern role at Bank of America.",
  }));
  check("OA is job related", oa.isJobRelated === true);
  check("OA status is assessment", oa.status === "assessment");
  check("OA extracts company", /bank of america/i.test(oa.company));
  check("OA extracts a deadline", oa.deadlineAt !== null);

  const reject = await classifyEmail(mk({
    subject: "Update on your application", fromDomain: "lever.co",
    body: "Thank you for your interest. Unfortunately we will not be moving forward with your application at this time.",
  }));
  check("rejection status is rejected", reject.status === "rejected");

  const newsletter = await classifyEmail(mk({
    subject: "This week in tech", fromDomain: "substack.com",
    body: "Here are the top 10 stories in AI this week.",
  }));
  check("newsletter is not job related", newsletter.isJobRelated === false);

  console.log(pass ? "\n✓ classify-email test PASSED" : "\n✗ classify-email test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ai/test-classify-email.ts`
Expected: FAIL — `Cannot find module './classify-email'`.

- [ ] **Step 3: Implement the classifier**

Create `packages/agent/src/ai/classify-email.ts`:

```ts
import { z } from "zod";
import { completeJSON } from "./llm";
import { EmailMessage, ClassifiedEmail } from "../ingest/types";

const SYSTEM_PROMPT = `You classify a single email about a job application. Decide whether it
relates to the candidate's own job application, and if so, what stage it represents.

Return JSON matching:
{
  "isJobRelated": boolean,   // true only if this is about the candidate's own application/candidacy
  "status": "applied" | "assessment" | "interviewing" | "offer" | "rejected" | "no_response" | "none",
  "company": string,         // the hiring company, "" if unknown
  "role": string,            // the job title/role, "" if unknown
  "deadlineAt": string | null // ISO 8601 date (YYYY-MM-DD) of any deadline/scheduled time, else null
}

Rules:
- "assessment" = an online assessment / coding challenge / take-home to complete.
- "interviewing" = an interview invite or scheduling (phone screen, onsite, technical).
- "offer" = an offer extended.
- "rejected" = not moving forward / position filled.
- "applied" = a bare application-received confirmation with no next step.
- "no_response" = generic acknowledgement with no state change.
- If not about the candidate's own application (newsletters, job alerts, marketing), set
  isJobRelated=false and status="none".
- Extract deadlineAt only when the email states a concrete date/time. Otherwise null.
Return ONLY the JSON object.`;

const ResponseSchema = z.object({
  isJobRelated: z.boolean(),
  status: z.enum(["applied", "assessment", "interviewing", "offer", "rejected", "no_response", "none"]),
  company: z.string().default(""),
  role: z.string().default(""),
  deadlineAt: z.string().nullable().default(null),
});

export async function classifyEmail(email: EmailMessage): Promise<ClassifiedEmail> {
  return completeJSON(ResponseSchema, {
    system: SYSTEM_PROMPT,
    user: [
      `From: ${email.from}`,
      `Subject: ${email.subject}`,
      "",
      email.body.slice(0, 6000),
    ].join("\n"),
    temperature: 0.1,
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ai/test-classify-email.ts`
Expected: PASS (requires `CLAUDE_CODE_OAUTH_TOKEN` or `OPENAI_API_KEY`).

- [ ] **Step 5: Wire into the integration chain + commit**

Add `"test:classify-email": "tsx src/ai/test-classify-email.ts",` and append ` && npm run test:classify-email` to `test:integration`.

```bash
git add packages/agent/src/ai/classify-email.ts packages/agent/src/ai/test-classify-email.ts packages/agent/package.json
git commit -m "feat(ingest): LLM email classifier (status + company/role + deadline)"
```

---

## Task 7: Gmail integration client

**Files:**
- Create: `packages/agent/src/integrations/gmail.ts`
- Test: `packages/agent/src/integrations/test-gmail-parse.ts` (self-contained — tests the pure `parseMessage` on a fixture)

**Interfaces:**
- Consumes: `google` from `googleapis`; `EmailMessage` from `../ingest/types`.
- Produces:
  - `getGmailClient(): gmail_v1.Gmail | null` (null when env vars unset)
  - `parseMessage(raw: gmail_v1.Schema$Message): EmailMessage`
  - `fetchNewMessages(gmail: gmail_v1.Gmail, sinceHistoryId: string | null): Promise<{ messages: EmailMessage[]; newHistoryId: string | null }>`

- [ ] **Step 1: Write the failing test (pure parser)**

Create `packages/agent/src/integrations/test-gmail-parse.ts`:

```ts
import { parseMessage } from "./gmail";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

const raw = {
  id: "msg-1",
  snippet: "Please complete your assessment",
  internalDate: String(Date.parse("2026-08-04T12:00:00Z")),
  payload: {
    headers: [
      { name: "From", value: "Greenhouse <no-reply@greenhouse.io>" },
      { name: "Subject", value: "Online assessment" },
    ],
    mimeType: "text/plain",
    body: { data: b64("Complete your OA by Aug 8.") },
  },
};

const m = parseMessage(raw as never);
check("id parsed", m.id === "msg-1");
check("subject parsed", m.subject === "Online assessment");
check("from parsed", m.from.includes("greenhouse.io"));
check("fromDomain parsed", m.fromDomain === "greenhouse.io");
check("body decoded", m.body.includes("Complete your OA"));
check("receivedAt parsed", m.receivedAt.getUTCFullYear() === 2026);

// multipart: prefer text/plain part
const multipart = {
  id: "msg-2", snippet: "hi", internalDate: "0",
  payload: { headers: [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "s" }],
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
      { mimeType: "text/plain", body: { data: b64("plain body") } },
    ] },
};
const m2 = parseMessage(multipart as never);
check("multipart prefers text/plain", m2.body.includes("plain body"));
check("bare address domain parsed", m2.fromDomain === "b.com");

console.log(pass ? "\n✓ gmail-parse test PASSED" : "\n✗ gmail-parse test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/integrations/test-gmail-parse.ts`
Expected: FAIL — `Cannot find module './gmail'`.

- [ ] **Step 3: Implement the Gmail client + parser**

Create `packages/agent/src/integrations/gmail.ts`:

```ts
import { google, gmail_v1 } from "googleapis";
import { EmailMessage } from "../ingest/types";

/** OAuth2 Gmail client from a stored refresh token, or null if env is not configured. */
export function getGmailClient(): gmail_v1.Gmail | null {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

function header(raw: gmail_v1.Schema$Message, name: string): string {
  const h = raw.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function domainOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const addr = (m ? m[1] : from).trim();
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : "";
}

/** Depth-first search for the first text/plain part; falls back to text/html or the top-level body. */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const decode = (data?: string | null) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

  const findPart = (part: gmail_v1.Schema$MessagePart, mime: string): string | null => {
    if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) {
      const found = findPart(child, mime);
      if (found) return found;
    }
    return null;
  };

  const plain = findPart(payload, "text/plain");
  if (plain) return plain;
  const html = findPart(payload, "text/html");
  if (html) return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decode(payload.body?.data);
}

export function parseMessage(raw: gmail_v1.Schema$Message): EmailMessage {
  const from = header(raw, "From");
  return {
    id: raw.id ?? "",
    from,
    fromDomain: domainOf(from),
    subject: header(raw, "Subject"),
    snippet: raw.snippet ?? "",
    body: extractBody(raw.payload),
    receivedAt: new Date(Number(raw.internalDate ?? 0)),
  };
}

/**
 * Returns new messages since the given historyId. Falls back to a 7-day query
 * when the cursor is missing or expired (Gmail drops history cursors after ~1 week).
 * newHistoryId is the mailbox's current historyId, to persist only after success.
 */
export async function fetchNewMessages(
  gmail: gmail_v1.Gmail,
  sinceHistoryId: string | null
): Promise<{ messages: EmailMessage[]; newHistoryId: string | null }> {
  const profile = await gmail.users.getProfile({ userId: "me" });
  const currentHistoryId = profile.data.historyId ?? null;

  let messageIds: string[] = [];
  let usedFallback = !sinceHistoryId;

  if (sinceHistoryId) {
    try {
      const ids = new Set<string>();
      let pageToken: string | undefined;
      do {
        const hist = await gmail.users.history.list({
          userId: "me", startHistoryId: sinceHistoryId, historyTypes: ["messageAdded"], pageToken,
        });
        for (const h of hist.data.history ?? [])
          for (const m of h.messagesAdded ?? [])
            if (m.message?.id) ids.add(m.message.id);
        pageToken = hist.data.nextPageToken ?? undefined;
      } while (pageToken);
      messageIds = [...ids];
    } catch {
      usedFallback = true; // 404 = expired cursor
    }
  }

  if (usedFallback) {
    const list = await gmail.users.messages.list({ userId: "me", q: "newer_than:7d", maxResults: 100 });
    messageIds = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  }

  const messages: EmailMessage[] = [];
  for (const id of messageIds) {
    const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    messages.push(parseMessage(full.data));
  }

  return { messages, newHistoryId: currentHistoryId };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/integrations/test-gmail-parse.ts`
Expected: PASS — `✓ gmail-parse test PASSED`.

- [ ] **Step 5: Wire into the self-contained chain + commit**

Add `"test:gmail-parse": "tsx src/integrations/test-gmail-parse.ts",` and append ` && npm run test:gmail-parse` to `test`.

```bash
git add packages/agent/src/integrations/gmail.ts packages/agent/src/integrations/test-gmail-parse.ts packages/agent/package.json
git commit -m "feat(ingest): Gmail OAuth2 client, message parser, incremental fetch"
```

---

## Task 8: Notification email for status changes

**Files:**
- Modify: `packages/agent/src/notifications/email.ts` (add `sendStatusChangeEmail` + a pure `statusChangeSubject` helper)
- Test: `packages/agent/src/notifications/test-status-email.ts` (self-contained — tests the subject builder only)

**Interfaces:**
- Consumes: `AppliedJobRow` from `../db/queries`; `StatusEventRow` from `../db/queries`.
- Produces:
  - `statusChangeSubject(company: string, status: string, deadlineAt: Date | null): string`
  - `sendStatusChangeEmail(app: { company: string; job_title: string; id: string }, event: { status: string; deadline_at: Date | null; email_link: string | null; email_snippet: string | null }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/notifications/test-status-email.ts`:

```ts
import { statusChangeSubject } from "./email";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const withDate = statusChangeSubject("Bank of America", "assessment", new Date("2026-08-08T00:00:00Z"));
check("OA subject leads with deadline", /OA due/i.test(withDate) && /Aug 8/.test(withDate));
check("OA subject names company", /Bank of America/.test(withDate));

const noDate = statusChangeSubject("Stripe", "interviewing", null);
check("interview subject without date", /Interview/i.test(noDate) && /Stripe/.test(noDate));
check("no 'due' when no date", !/due/i.test(noDate));

const offer = statusChangeSubject("Google", "offer", null);
check("offer subject", /Offer/i.test(offer) && /Google/.test(offer));

console.log(pass ? "\n✓ status-email test PASSED" : "\n✗ status-email test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/notifications/test-status-email.ts`
Expected: FAIL — `statusChangeSubject` is not exported.

- [ ] **Step 3: Implement subject builder + sender**

Append to `packages/agent/src/notifications/email.ts`:

```ts
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const STATUS_LABEL: Record<string, string> = {
  assessment: "OA", interviewing: "Interview", offer: "Offer",
};

/** High-signal subject that leads with the deadline when one exists. */
export function statusChangeSubject(company: string, status: string, deadlineAt: Date | null): string {
  const label = STATUS_LABEL[status] ?? status;
  if (status === "assessment" && deadlineAt) return `⚠️ OA due ${fmtDate(deadlineAt)} — ${company}`;
  if (deadlineAt) return `${label} ${fmtDate(deadlineAt)} — ${company}`;
  return `${label} — ${company}`;
}

export async function sendStatusChangeEmail(
  app: { company: string; job_title: string; id: string },
  event: { status: string; deadline_at: Date | null; email_link: string | null; email_snippet: string | null }
): Promise<void> {
  const toEmail = process.env.YOUR_EMAIL;
  if (!toEmail) throw new Error("YOUR_EMAIL is not set");
  const appUrl = process.env.WEB_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const from = process.env.EMAIL_FROM ?? "Job Agent <onboarding@resend.dev>";

  const subject = statusChangeSubject(app.company, event.status, event.deadline_at);
  const deadlineLine = event.deadline_at
    ? `<p style="font-size:14px;"><strong>Deadline:</strong> ${esc(fmtDate(event.deadline_at))}</p>` : "";
  const gmailLink = event.email_link
    ? `<a href="${esc(event.email_link)}" style="color:#0066cc;">Open email →</a>` : "";

  const html = `
    <div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:24px;">
      <h2 style="font-size:18px;">${esc(app.company)} — ${esc(app.job_title)}</h2>
      <p style="font-size:14px;">New status: <strong>${esc(event.status)}</strong></p>
      ${deadlineLine}
      ${event.email_snippet ? `<p style="color:#555; font-size:13px;">${esc(event.email_snippet)}</p>` : ""}
      <p style="margin-top:16px;">
        ${gmailLink}
        <a href="${esc(appUrl)}/applied" style="color:#0066cc; margin-left:16px;">View in tracker →</a>
      </p>
    </div>`;

  await getResend().emails.send({ from, to: toEmail, subject, html });
}
```

> Note: `esc` and `getResend` already exist in this file. If `esc` is not exported/visible at the new code's scope, reuse the existing module-level `esc` const (it is module-scoped, so it is in scope).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/notifications/test-status-email.ts`
Expected: PASS — `✓ status-email test PASSED`.

- [ ] **Step 5: Wire into the self-contained chain + commit**

Add `"test:status-email": "tsx src/notifications/test-status-email.ts",` and append ` && npm run test:status-email` to `test`.

```bash
git add packages/agent/src/notifications/email.ts packages/agent/src/notifications/test-status-email.ts packages/agent/package.json
git commit -m "feat(ingest): status-change alert email with deadline-first subject"
```

---

## Task 9: Ingest orchestrator + applyStatusEvent

**Files:**
- Create: `packages/agent/src/ingest/email-ingest.ts`
- Test: `packages/agent/src/ingest/test-email-ingest.ts` (integration — DB + injected fakes)

**Interfaces:**
- Consumes: queries from Task 2; `matchApplication` (Task 3); `isCandidateEmail` (Task 4); `canAdvance` (Task 5); `classifyEmail` (Task 6); `fetchNewMessages`/`getGmailClient` (Task 7); `sendStatusChangeEmail` (Task 8); `syncStatusToSheet` from `../integrations/sheets`; `updateAppliedJob`, `listAppliedJobs`.
- Produces:
  - `type IngestDeps = { fetch: (sinceHistoryId: string | null) => Promise<{ messages: EmailMessage[]; newHistoryId: string | null }>; classify: (email: EmailMessage) => Promise<ClassifiedEmail>; now?: () => Date; notify?: (app: AppliedJobRow, event: StatusEventRow) => Promise<void> }`
  - `applyStatusEvent(app: AppliedJobRow, classified: ClassifiedEmail, email: EmailMessage, deps: Pick<IngestDeps, "notify">): Promise<void>`
  - `runEmailIngest(deps?: Partial<IngestDeps>): Promise<{ processed: number; applied: number; queued: number }>`
  - `NOTIFY_STATUSES = new Set(["assessment", "interviewing", "offer"])`
  - `gmailLink(messageId: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/ingest/test-email-ingest.ts`:

```ts
import { pool } from "../db/pool";
import { initSchema } from "../db/schema";
import {
  createAppliedJob, getAppliedJob, listStatusEventsByApplication,
  listPendingReviews, isMessageProcessed,
} from "../db/queries";
import { runEmailIngest } from "./email-ingest";
import { EmailMessage, ClassifiedEmail } from "./types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}
function mk(over: Partial<EmailMessage>): EmailMessage {
  return { id: "e1", from: "r <r@greenhouse.io>", fromDomain: "greenhouse.io", subject: "", snippet: "", body: "", receivedAt: new Date(), ...over };
}

async function main() {
  await initSchema();
  const app = await createAppliedJob({ company: "Bank of America", jobTitle: "Software Engineer Intern", status: "applied" });

  const emails: EmailMessage[] = [
    mk({ id: "e-match", subject: "OA", body: "assessment for Bank of America Software Engineer Intern" }),
    mk({ id: "e-newsletter", fromDomain: "substack.com", subject: "news", body: "top stories" }),
    mk({ id: "e-nomatch", subject: "Interview", body: "interview for Netflix Data Scientist role" }),
  ];
  const classifyMap: Record<string, ClassifiedEmail> = {
    "e-match": { isJobRelated: true, status: "assessment", company: "Bank of America", role: "Software Engineer Intern", deadlineAt: "2026-08-08" },
    "e-newsletter": { isJobRelated: false, status: "none", company: "", role: "", deadlineAt: null },
    "e-nomatch": { isJobRelated: true, status: "interviewing", company: "Netflix", role: "Data Scientist", deadlineAt: null },
  };
  let notified = 0;

  const result = await runEmailIngest({
    fetch: async () => ({ messages: emails, newHistoryId: "h-1" }),
    classify: async (e) => classifyMap[e.id],
    notify: async () => { notified++; },
  });

  check("all messages processed", result.processed === 3);
  check("one applied", result.applied === 1);
  check("one queued for review", result.queued === 1);

  const app2 = await getAppliedJob(app.id);
  check("matched app advanced to assessment", app2?.status === "assessment");
  const events = await listStatusEventsByApplication();
  check("status event recorded", (events[app.id] ?? []).some((e) => e.status === "assessment" && e.source === "email"));
  check("assessment triggered a notification", notified === 1);
  check("unmatched interview went to review", (await listPendingReviews()).some((r) => r.email_message_id === "e-nomatch"));
  check("newsletter marked processed, not queued", (await isMessageProcessed("e-newsletter")) === true &&
    !(await listPendingReviews()).some((r) => r.email_message_id === "e-newsletter"));

  // idempotency: re-running the same batch changes nothing
  const rerun = await runEmailIngest({
    fetch: async () => ({ messages: emails, newHistoryId: "h-1" }),
    classify: async (e) => classifyMap[e.id],
    notify: async () => { notified++; },
  });
  check("rerun applies nothing (idempotent)", rerun.applied === 0 && rerun.queued === 0);
  check("rerun sends no new notifications", notified === 1);

  await pool.end();
  console.log(pass ? "\n✓ email-ingest test PASSED" : "\n✗ email-ingest test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ingest/test-email-ingest.ts`
Expected: FAIL — `Cannot find module './email-ingest'`.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/agent/src/ingest/email-ingest.ts`:

```ts
import {
  AppliedJobRow, StatusEventRow,
  getGmailSyncState, setGmailSyncState, isMessageProcessed, markMessageProcessed,
  listAppliedJobs, getAppliedJob, updateAppliedJob, createStatusEvent, enqueueReview,
} from "../db/queries";
import { matchApplication, MatchCandidate } from "./match";
import { isCandidateEmail } from "./prefilter";
import { canAdvance } from "./status-order";
import { classifyEmail } from "../ai/classify-email";
import { getGmailClient, fetchNewMessages } from "../integrations/gmail";
import { sendStatusChangeEmail } from "../notifications/email";
import { syncStatusToSheet } from "../integrations/sheets";
import { EmailMessage, ClassifiedEmail } from "./types";

export const NOTIFY_STATUSES = new Set(["assessment", "interviewing", "offer"]);

export function gmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

export type IngestDeps = {
  fetch: (sinceHistoryId: string | null) => Promise<{ messages: EmailMessage[]; newHistoryId: string | null }>;
  classify: (email: EmailMessage) => Promise<ClassifiedEmail>;
  notify: (app: AppliedJobRow, event: StatusEventRow) => Promise<void>;
};

function defaultDeps(): IngestDeps {
  return {
    fetch: async (sinceHistoryId) => {
      const gmail = getGmailClient();
      if (!gmail) throw new Error("Gmail client not configured (GMAIL_OAUTH_* env missing)");
      return fetchNewMessages(gmail, sinceHistoryId);
    },
    classify: classifyEmail,
    notify: (app, event) =>
      sendStatusChangeEmail(
        { company: app.company, job_title: app.job_title, id: app.id },
        { status: event.status, deadline_at: event.deadline_at, email_link: event.email_link, email_snippet: event.email_snippet }
      ),
  };
}

/** Applies a classified email to a matched application (forward-only), logs the event, syncs Sheets, notifies. */
export async function applyStatusEvent(
  app: AppliedJobRow,
  classified: ClassifiedEmail,
  email: EmailMessage,
  deps: Pick<IngestDeps, "notify">
): Promise<void> {
  const deadlineAt = classified.deadlineAt ? new Date(classified.deadlineAt) : null;
  const advance = canAdvance(app.status, classified.status);

  const event = await createStatusEvent({
    applicationId: app.id,
    status: classified.status,
    source: "email",
    deadlineAt,
    emailMessageId: email.id,
    emailSubject: email.subject,
    emailSnippet: email.snippet,
    emailLink: gmailLink(email.id),
  });

  if (!advance) return; // audit-only: out-of-order email, leave applied_jobs.status untouched

  await updateAppliedJob(app.id, { status: classified.status });
  if (app.sheets_row) {
    await syncStatusToSheet(app.sheets_row, classified.status).catch((err) =>
      console.error("[ingest] sheets sync failed:", err)
    );
  }
  if (NOTIFY_STATUSES.has(classified.status)) {
    await deps.notify(app, event).catch((err) => console.error("[ingest] notify failed:", err));
  }
}

export async function runEmailIngest(
  partial: Partial<IngestDeps> = {}
): Promise<{ processed: number; applied: number; queued: number }> {
  const deps: IngestDeps = { ...defaultDeps(), ...partial };
  const { history_id } = await getGmailSyncState();
  const { messages, newHistoryId } = await deps.fetch(history_id);

  let processed = 0, applied = 0, queued = 0;

  for (const email of messages) {
    if (await isMessageProcessed(email.id)) continue;
    processed++;

    try {
      if (!isCandidateEmail(email)) { await markMessageProcessed(email.id); continue; }

      const classified = await deps.classify(email);
      if (!classified.isJobRelated || classified.status === "none") {
        await markMessageProcessed(email.id);
        continue;
      }

      const candidates: MatchCandidate[] = (await listAppliedJobs()).map((a) => ({
        id: a.id, company: a.company, role: a.job_title,
      }));
      const match = matchApplication(candidates, { company: classified.company, role: classified.role });

      if (match) {
        const app = await getAppliedJob(match.applicationId);
        if (app) { await applyStatusEvent(app, classified, email, deps); applied++; }
      } else {
        await enqueueReview({
          emailMessageId: email.id,
          emailFrom: email.from,
          emailSubject: email.subject,
          emailSnippet: email.snippet,
          emailLink: gmailLink(email.id),
          detectedStatus: classified.status,
          detectedDeadlineAt: classified.deadlineAt ? new Date(classified.deadlineAt) : null,
          suggestedApplicationId: null,
          matchScore: null,
        });
        queued++;
      }
      await markMessageProcessed(email.id);
    } catch (err) {
      console.error(`[ingest] message ${email.id} failed, leaving unprocessed for retry:`, err);
      // do NOT mark processed — a transient failure should retry next tick
    }
  }

  if (newHistoryId) await setGmailSyncState(newHistoryId);
  return { processed, applied, queued };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ingest/test-email-ingest.ts`
Expected: PASS — `✓ email-ingest test PASSED` (requires local Postgres).

- [ ] **Step 5: Wire into the integration chain + commit**

Add `"test:email-ingest": "tsx src/ingest/test-email-ingest.ts",` and append ` && npm run test:email-ingest` to `test:integration`.

```bash
git add packages/agent/src/ingest/email-ingest.ts packages/agent/src/ingest/test-email-ingest.ts packages/agent/package.json
git commit -m "feat(ingest): email-ingest orchestrator with forward-only apply + review queue"
```

---

## Task 10: Cron wiring (opt-in)

**Files:**
- Modify: `packages/agent/src/cron/scheduler.ts`

**Interfaces:**
- Consumes: `runEmailIngest` from `../ingest/email-ingest`.

- [ ] **Step 1: Add a guarded ingest tick**

Replace the body of `packages/agent/src/cron/scheduler.ts` with:

```ts
import cron from "node-cron";
import { runAllCompanyScrapes } from "../scraper/index";
import { runEmailIngest } from "../ingest/email-ingest";

let tickInFlight = false;
async function runTick() {
  if (tickInFlight) { console.warn("[scheduler] Previous scrape tick still running — skipping"); return; }
  tickInFlight = true;
  try {
    await runAllCompanyScrapes().catch((err) => console.error("[scheduler] Scrape run failed:", err));
  } finally {
    tickInFlight = false;
  }
}

let ingestInFlight = false;
async function runIngestTick() {
  if (process.env.GMAIL_INGEST_ENABLED !== "true") return;
  if (ingestInFlight) { console.warn("[scheduler] Previous ingest tick still running — skipping"); return; }
  ingestInFlight = true;
  try {
    const r = await runEmailIngest();
    console.log(`[scheduler] Gmail ingest: processed=${r.processed} applied=${r.applied} queued=${r.queued}`);
  } catch (err) {
    console.error("[scheduler] Gmail ingest failed:", err);
  } finally {
    ingestInFlight = false;
  }
}

export function startScheduler() {
  runTick();
  runIngestTick();

  cron.schedule("*/15 * * * *", () => {
    console.log(`[scheduler] Tick — ${new Date().toLocaleTimeString()}`);
    runTick();
    runIngestTick();
  });

  console.log("[scheduler] Started — scanning companies every 15 minutes" +
    (process.env.GMAIL_INGEST_ENABLED === "true" ? " (+ Gmail ingest)" : ""));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/agent && npx tsc --noEmit 2>&1 | grep -v "multer\|pdf-parse" | head`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/cron/scheduler.ts
git commit -m "feat(ingest): run Gmail ingest on the cron tick behind GMAIL_INGEST_ENABLED"
```

---

## Task 11: API — review routes + applied timeline + manual events

**Files:**
- Create: `packages/agent/src/api/routes/review.ts`
- Modify: `packages/agent/src/api/index.ts` (mount `/review`)
- Modify: `packages/agent/src/api/routes/applied.ts` (attach timeline to GET; write a manual event on PATCH)

**Interfaces:**
- Consumes: `listPendingReviews`, `getReview`, `resolveReview`, `getAppliedJob`, `createStatusEvent`, `updateAppliedJob`, `listStatusEventsByApplication`, `listAppliedJobs`; `applyStatusEvent`, `gmailLink` from `../../ingest/email-ingest`; `classifyEmail`-shaped `ClassifiedEmail`.
- Produces HTTP: `GET /api/review`, `POST /api/review/:id/confirm`, `POST /api/review/:id/dismiss`; `GET /api/applied` now returns `{ ...row, status_events: StatusEventRow[] }[]`.

- [ ] **Step 1: Implement the review router**

Create `packages/agent/src/api/routes/review.ts`:

```ts
import { Router } from "express";
import {
  listPendingReviews, getReview, resolveReview, getAppliedJob, createStatusEvent, updateAppliedJob,
} from "../../db/queries";
import { canAdvance } from "../../ingest/status-order";
import { NOTIFY_STATUSES } from "../../ingest/email-ingest";
import { sendStatusChangeEmail } from "../../notifications/email";
import { syncStatusToSheet } from "../../integrations/sheets";

const router = Router();

// GET /api/review — unresolved items
router.get("/", async (_req, res) => {
  res.json(await listPendingReviews());
});

// POST /api/review/:id/confirm { applicationId }
router.post("/:id/confirm", async (req, res) => {
  const { applicationId } = req.body as { applicationId?: string };
  if (!applicationId) { res.status(400).json({ error: "applicationId is required" }); return; }

  const review = await getReview(req.params.id);
  if (!review || review.resolved_at) { res.status(404).json({ error: "Review not found or already resolved" }); return; }
  const app = await getAppliedJob(applicationId);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  const status = review.detected_status ?? "applied";
  const event = await createStatusEvent({
    applicationId: app.id, status, source: "email",
    deadlineAt: review.detected_deadline_at,
    emailMessageId: review.email_message_id, emailSubject: review.email_subject,
    emailSnippet: review.email_snippet, emailLink: review.email_link,
  });

  if (canAdvance(app.status, status)) {
    await updateAppliedJob(app.id, { status });
    if (app.sheets_row) await syncStatusToSheet(app.sheets_row, status).catch((e) => console.error("[review] sheets:", e));
    if (NOTIFY_STATUSES.has(status)) {
      await sendStatusChangeEmail(
        { company: app.company, job_title: app.job_title, id: app.id },
        { status, deadline_at: event.deadline_at, email_link: event.email_link, email_snippet: event.email_snippet }
      ).catch((e) => console.error("[review] notify:", e));
    }
  }
  await resolveReview(review.id);
  res.json({ ok: true });
});

// POST /api/review/:id/dismiss
router.post("/:id/dismiss", async (req, res) => {
  const review = await getReview(req.params.id);
  if (!review) { res.status(404).json({ error: "Review not found" }); return; }
  await resolveReview(review.id);
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Mount the router**

In `packages/agent/src/api/index.ts`, add the import and mount alongside the others:

```ts
import reviewRouter from "./routes/review";
// ...
router.use("/review", reviewRouter);
```

- [ ] **Step 3: Attach timeline to GET /applied and write manual events on PATCH**

In `packages/agent/src/api/routes/applied.ts`:

Add imports:
```ts
import { createStatusEvent, listStatusEventsByApplication } from "../../db/queries";
```

Replace the `GET /` handler with:
```ts
// GET /api/applied  (each row carries its status_events timeline)
router.get("/", async (_req, res) => {
  const [rows, eventsByApp] = await Promise.all([listAppliedJobs(), listStatusEventsByApplication()]);
  res.json(rows.map((r) => ({ ...r, status_events: eventsByApp[r.id] ?? [] })));
});
```

In the `POST /` handler, after `res.status(201).json(row);`, add a manual initial event (fire-and-forget):
```ts
  if (row.status) {
    createStatusEvent({ applicationId: row.id, status: row.status, source: "manual" })
      .catch((err) => console.error("[applied] status event failed:", err));
  }
```

In the `PATCH /:id` handler, after `res.json(row);` and inside the `if (status ...)` region, also record a manual event:
```ts
  if (status) {
    createStatusEvent({ applicationId: row.id, status, source: "manual" })
      .catch((err) => console.error("[applied] status event failed:", err));
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `cd packages/agent && npx tsc --noEmit 2>&1 | grep -v "multer\|pdf-parse" | head`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/api/routes/review.ts packages/agent/src/api/index.ts packages/agent/src/api/routes/applied.ts
git commit -m "feat(ingest): review API + status_events timeline on /applied + manual event logging"
```

---

## Task 12: Web API client — types + wrappers

**Files:**
- Modify: `packages/web/lib/api.ts`

**Interfaces:**
- Produces:
  - `type StatusEvent = { id: string; application_id: string; status: string; source: "manual" | "email"; deadline_at: string | null; email_subject: string | null; email_snippet: string | null; email_link: string | null; occurred_at: string }`
  - `AppliedJob` gains `status_events?: StatusEvent[]`
  - `type ReviewItem = { id: string; email_message_id: string; email_from: string | null; email_subject: string | null; email_snippet: string | null; email_link: string | null; detected_status: string | null; detected_deadline_at: string | null; suggested_application_id: string | null; match_score: number | null; created_at: string }`
  - `api.listReviews()`, `api.confirmReview(id, applicationId)`, `api.dismissReview(id)`

- [ ] **Step 1: Add types**

In `packages/web/lib/api.ts`, add after the `AppliedJob` type:

```ts
export type StatusEvent = {
  id: string;
  application_id: string;
  status: string;
  source: "manual" | "email";
  deadline_at: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  occurred_at: string;
};

export type ReviewItem = {
  id: string;
  email_message_id: string;
  email_from: string | null;
  email_subject: string | null;
  email_snippet: string | null;
  email_link: string | null;
  detected_status: string | null;
  detected_deadline_at: string | null;
  suggested_application_id: string | null;
  match_score: number | null;
  created_at: string;
};
```

And extend `AppliedJob` with:
```ts
  status_events?: StatusEvent[];
```

- [ ] **Step 2: Add wrappers**

In the `api` object (near `listApplied`), add:

```ts
  listReviews: () => request<ReviewItem[]>("GET", "/review"),
  confirmReview: (id: string, applicationId: string) =>
    request<{ ok: true }>("POST", `/review/${id}/confirm`, { applicationId }),
  dismissReview: (id: string) => request<{ ok: true }>("POST", `/review/${id}/dismiss`),
```

- [ ] **Step 3: Verify web typechecks**

Run: `cd packages/web && npx tsc --noEmit | head`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/lib/api.ts
git commit -m "feat(ingest): web api types + wrappers for reviews and status timeline"
```

---

## Task 13: Web UI — review panel + status timeline

**Files:**
- Create: `packages/web/components/ReviewPanel.tsx`
- Create: `packages/web/components/StatusTimeline.tsx`
- Modify: `packages/web/app/applied/page.tsx` (render `ReviewPanel`)
- Modify: `packages/web/components/AppliedTable.tsx` (expandable timeline row)

**Interfaces:**
- Consumes: `api.listReviews/confirmReview/dismissReview`, `AppliedJob`, `ReviewItem`, `StatusEvent`.

- [ ] **Step 1: Build the review panel (client component)**

Create `packages/web/components/ReviewPanel.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { api, ReviewItem, AppliedJob } from "../lib/api";

export default function ReviewPanel({ applications }: { applications: AppliedJob[] }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.listReviews().then(setItems).catch(() => setItems([])); }, []);

  if (items.length === 0) return null;

  async function confirm(id: string, applicationId: string) {
    if (!applicationId) return;
    setBusy(id);
    try { await api.confirmReview(id, applicationId); setItems((xs) => xs.filter((x) => x.id !== id)); }
    finally { setBusy(null); }
  }
  async function dismiss(id: string) {
    setBusy(id);
    try { await api.dismissReview(id); setItems((xs) => xs.filter((x) => x.id !== id)); }
    finally { setBusy(null); }
  }

  return (
    <div className="mb-8 border border-amber-300 bg-amber-50 rounded-lg p-4">
      <h2 className="font-serif text-lg text-amber-900 mb-3">Needs review ({items.length})</h2>
      <ul className="space-y-3">
        {items.map((it) => (
          <ReviewRow key={it.id} item={it} applications={applications} busy={busy === it.id}
            onConfirm={confirm} onDismiss={dismiss} />
        ))}
      </ul>
    </div>
  );
}

function ReviewRow({ item, applications, busy, onConfirm, onDismiss }: {
  item: ReviewItem; applications: AppliedJob[]; busy: boolean;
  onConfirm: (id: string, applicationId: string) => void; onDismiss: (id: string) => void;
}) {
  const [selected, setSelected] = useState(item.suggested_application_id ?? "");
  return (
    <li className="bg-white border border-amber-200 rounded-md p-3 text-sm">
      <div className="font-medium">{item.email_subject || "(no subject)"}</div>
      <div className="text-gray-500 text-xs">{item.email_from}</div>
      {item.email_snippet && <p className="text-gray-600 mt-1">{item.email_snippet}</p>}
      <div className="text-xs text-gray-500 mt-1">
        Detected: <strong>{item.detected_status ?? "?"}</strong>
        {item.detected_deadline_at ? ` · deadline ${new Date(item.detected_deadline_at).toLocaleDateString()}` : ""}
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="border rounded px-2 py-1 text-sm">
          <option value="">Match to application…</option>
          {applications.map((a) => (
            <option key={a.id} value={a.id}>{a.company} — {a.job_title}</option>
          ))}
        </select>
        <button disabled={busy || !selected} onClick={() => onConfirm(item.id, selected)}
          className="bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-3 py-1 rounded">
          Confirm
        </button>
        <button disabled={busy} onClick={() => onDismiss(item.id)}
          className="text-gray-600 hover:text-gray-900 px-3 py-1">Dismiss</button>
        {item.email_link && (
          <a href={item.email_link} target="_blank" rel="noopener noreferrer"
            className="text-blue-600 text-xs">Open email →</a>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Build the timeline component**

Create `packages/web/components/StatusTimeline.tsx`:

```tsx
import { StatusEvent } from "../lib/api";

export default function StatusTimeline({ events }: { events: StatusEvent[] }) {
  if (!events || events.length === 0) return <div className="text-xs text-gray-400">No history yet.</div>;
  return (
    <ol className="space-y-1">
      {events.map((e) => (
        <li key={e.id} className="text-xs text-gray-600 flex items-center gap-2">
          <span className="font-medium capitalize">{e.status}</span>
          <span className="text-gray-400">{new Date(e.occurred_at).toLocaleDateString()}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${e.source === "email" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
            {e.source}
          </span>
          {e.deadline_at && <span className="text-amber-700">due {new Date(e.deadline_at).toLocaleDateString()}</span>}
          {e.email_link && <a href={e.email_link} target="_blank" rel="noopener noreferrer" className="text-blue-600">email →</a>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Render ReviewPanel on /applied**

In `packages/web/app/applied/page.tsx`, import and render above `<AppliedTable>`:
```tsx
import ReviewPanel from "../../components/ReviewPanel";
// ...inside the returned JSX, before <AppliedTable ... />:
<ReviewPanel applications={jobs} />
```

- [ ] **Step 4: Add expandable timeline in AppliedTable**

In `packages/web/components/AppliedTable.tsx`, add a details toggle per row that renders `<StatusTimeline events={job.status_events ?? []} />`. Minimal approach — add a new cell with a `<details>`:
```tsx
import StatusTimeline from "./StatusTimeline";
// ...in the row, add a trailing cell:
<td className="px-3 py-2">
  <details>
    <summary className="text-xs text-gray-500 cursor-pointer">History</summary>
    <div className="mt-2"><StatusTimeline events={job.status_events ?? []} /></div>
  </details>
</td>
```
Add a matching `<th></th>` (e.g. "History") to the header row so columns line up.

- [ ] **Step 5: Verify web typechecks + builds**

Run: `cd packages/web && npx tsc --noEmit | head`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/ReviewPanel.tsx packages/web/components/StatusTimeline.tsx packages/web/app/applied/page.tsx packages/web/components/AppliedTable.tsx
git commit -m "feat(ingest): needs-review panel + per-application status timeline on /applied"
```

---

## Task 14: Token-minting script, env, and docs

**Files:**
- Create: `scripts/mint-gmail-token.ts`
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Interfaces:** none (operational tooling + docs).

- [ ] **Step 1: Write the mint script**

Create `scripts/mint-gmail-token.ts`:

```ts
/**
 * One-time helper to mint a Gmail refresh token for ingestion.
 *
 * Prereqs: create an OAuth 2.0 "Desktop app" client in Google Cloud Console,
 * enable the Gmail API, and add your Google account as a test user on the
 * OAuth consent screen. Then:
 *
 *   GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... npx tsx scripts/mint-gmail-token.ts
 *
 * Open the printed URL, approve, paste the code back, and copy the refresh
 * token into GMAIL_OAUTH_REFRESH_TOKEN on Railway.
 */
import { google } from "googleapis";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function main() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET first.");
    process.exit(1);
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
  console.log("\n1. Open this URL and approve:\n\n" + url + "\n");

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question("2. Paste the authorization code here: ")).trim();
  rl.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error("No refresh token returned. Revoke prior access at https://myaccount.google.com/permissions and retry.");
    process.exit(1);
  }
  console.log("\n✅ GMAIL_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
}
main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add env vars to .env.example**

Append to `.env.example`:

```
# ── Gmail application-status ingestion ─────────────────────────────
# Consumer Gmail can't be read by the Sheets service account — this needs its
# own OAuth2 client + refresh token (scope: gmail.readonly). Mint the token
# with `npx tsx scripts/mint-gmail-token.ts`.
GMAIL_OAUTH_CLIENT_ID=
GMAIL_OAUTH_CLIENT_SECRET=
GMAIL_OAUTH_REFRESH_TOKEN=
# Set to "true" to enable the ingest cron tick (leave unset/false until verified).
GMAIL_INGEST_ENABLED=
```

- [ ] **Step 3: Document in CLAUDE.md**

Add a "Gmail status ingestion" bullet under **What's Already Built** and a short pipeline block under **Core Pipelines** describing: cron → `getGmailClient`/`fetchNewMessages` → prefilter → `classifyEmail` → `matchApplication` → `applyStatusEvent` (forward-only) or `enqueueReview`; the `status_events`/`email_review_queue`/`gmail_sync_state`/`gmail_processed_messages` tables; the notify-on-{assessment,interviewing,offer} rule; and the `GMAIL_*` env vars. Add the 4 new env vars to the Environment Variables list.

- [ ] **Step 4: Verify the full self-contained suite is green**

Run: `cd "$HOME/Projects/AI-Job-Agent" && npm test`
Expected: exit 0 — includes the new `test:match`, `test:prefilter`, `test:status-order`, `test:gmail-parse`, `test:status-email`.

- [ ] **Step 5: Commit**

```bash
git add scripts/mint-gmail-token.ts .env.example CLAUDE.md
git commit -m "feat(ingest): gmail token-mint script, env vars, and docs"
```

---

## Rollout (post-merge, manual)

1. Create the OAuth2 desktop client in Google Cloud Console; enable Gmail API; add yourself as a test user.
2. Run `npx tsx scripts/mint-gmail-token.ts`; set `GMAIL_OAUTH_*` on staging (cron still off).
3. Run one-shot on staging: a tiny script calling `runEmailIngest()` (or temporarily flip `GMAIL_INGEST_ENABLED=true`); eyeball `status_events` + review queue against real recruiter mail.
4. Once classification/matching quality looks right, set `GMAIL_INGEST_ENABLED=true` on staging, then production.

## Self-Review Notes

- **Spec coverage:** auth (Task 7/14), 4 tables (Task 1), status_events history + dates (Tasks 2/9/11), review queue (Tasks 2/9/11/13), deterministic match w/ ambiguity margin (Task 3), prefilter (Task 4), forward-only guard (Task 5), classifier + deadline extraction (Task 6), Gmail fetch w/ 7-day fallback + idempotency (Tasks 7/9), notify on assessment/interviewing/offer w/ deadline-first subject (Task 8), cron opt-in (Task 10), API + UI (Tasks 11–13), manual events for complete history (Task 11), env + docs + rollout (Task 14). Schema left non-destructive per spec.
- **Type consistency:** `ClassifiedEmail`/`EmailMessage` defined once in `ingest/types.ts` and consumed everywhere; `StatusEventRow`/`ReviewQueueRow` defined in `queries.ts`, mirrored as `StatusEvent`/`ReviewItem` (ISO-string dates) in web `api.ts`; `matchApplication`, `canAdvance`, `isCandidateEmail`, `classifyEmail`, `applyStatusEvent`, `runEmailIngest`, `NOTIFY_STATUSES`, `gmailLink` signatures are consistent across producer and consumer tasks.
