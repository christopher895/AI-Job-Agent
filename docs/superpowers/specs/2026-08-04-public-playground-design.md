# Public playground (bring-your-own-key demo)

## Problem

The app is now gated behind Google sign-in restricted to Christopher's
email (see `2026-08-03-private-auth-design.md`). Christopher wants a
second, public-facing surface he can link from his personal
site/portfolio: a stranger pastes their own resume and a job
description, pastes their own Anthropic API key, and gets a real
tailored resume PDF back — a live demo of the actual product, at zero
LLM cost to Christopher. This was explicitly deferred as phase 2 during
the private-auth work and is now being designed.

## Scope

- New public route `/playground` (and its API routes) added to
  `packages/web/middleware.ts`'s public-page allowlist — reachable
  without signing in, alongside `/login`.
- New Next.js route handlers under `packages/web/app/api/playground/`
  that do **not** call `auth()`, but still attach
  `X-Internal-Secret` when calling the agent — the same protection the
  authenticated proxy gives, minus the session check.
- New agent-side routes under `packages/agent/src/api/routes/playground.ts`,
  mounted behind the existing `requireInternalSecret` middleware like
  every other agent route.
- A new LLM-calling path that uses a visitor-supplied Anthropic API key
  directly against Anthropic's Messages API, additive to
  `packages/agent/src/ai/llm.ts`'s `completeJSON()` — the existing
  CLI-OAuth and OpenAI paths are untouched.
- A new DB table for rate-limiting + anonymous usage counting only
  (timestamp + hashed IP — no resume/JD/key content ever written to it).
- New web components: a playground landing/intro, a 3-step flow (input →
  review suggestions → result), reusing the existing design tokens
  (`bg-paper`, `text-paper-ink`, Fraunces headings) from the app redesign.

Out of scope:
- Any persistence of a visitor's resume, JD, suggestions, or output.
  Every playground request is stateless server-side; the browser holds
  and resends whatever context each step needs.
- OpenAI key support — Anthropic only, per Christopher's own provider
  preference for this app.
- Job URL auto-fetch is IN scope (reusing `fetch-jd.ts`), confirmed
  despite the added Playwright/compute cost on a public route.
- Any visitor-facing account system, history, or persistent identity.
  Nothing to sign up for.
- Reusing `master_resume`/`tailored_resumes` tables in any way — a
  playground visitor's data must never be able to collide with or leak
  into Christopher's own private data model.

## Design

### Why this mirrors the real pipeline instead of a simplified one-shot

Initially considered a single-pass "paste resume + JD, get output in one
LLM call" design (mirroring the old `chain.ts`/`tailor.ts` single-pass
path). Rejected per Christopher's explicit direction: the playground
should mirror the real suggest-and-approve flow closely, since that's
the actual product being demonstrated, not a stripped-down toy version
of it.

### Why fully stateless instead of an ephemeral/expiring DB table

The real app's review flow (generate suggestions → visitor
reviews/edits → apply accepted ones) spans two separate requests, and
today that gap is bridged by persisting to `tailored_resumes`
(`status='awaiting_review'`). For the playground, an ephemeral table
serving the same purpose was considered and rejected in favor of having
each step return its full result directly to the browser, which resends
it (unmodified or edited) on the next step. This was chosen because:
(a) it fully satisfies the "nothing about a stranger's resume touches
the database" requirement without needing a cleanup/expiry job, and
(b) the pipeline's core functions are already pure data-in/data-out
(confirmed by reading them — see Data flow below), so no DB coupling
needs to be introduced to make this work.

### Why three synchronous endpoints instead of async+polling

The main app's tailoring endpoint (`POST /api/tailor`) is async
(202 + poll) specifically because a single request could run a 3-pass
generate→critique→revise loop plus PDF rendering, risking Railway's
~300s edge-proxy timeout. The playground's pipeline is split into three
separate HTTP requests instead of one, and each individual request does
at most 1–3 LLM calls (parse: 1 call; suggest: 1 call; apply+render: 0
calls for `applySuggestions` itself, which is deterministic, plus up to
2 more for `fitToOnePage`'s trim-retry loop if the rendered PDF
overflows one page, plus the Tectonic render). This keeps each
individual request comfortably under the timeout without needing
async/polling infrastructure. If real-world latency proves this wrong,
revisit — but start synchronous.

### Data flow

Confirmed by reading the actual pipeline functions that all three are
pure — they take data in, return data out, no DB reads/writes inside
them:
- `importMasterResume(rawText: string): Promise<MasterResume>`
  (`packages/agent/src/ai/import-master-resume.ts`)
- `suggestKeywords(jd: string, master: MasterResume): Promise<RawSuggestion[]>`
  (`packages/agent/src/ai/suggest-keywords.ts`)
- `applySuggestions(master: MasterResume, accepted: Suggestion[]): { master: MasterResume; tailored: TailoredResume }`
  (`packages/agent/src/ai/apply-suggestions.ts`, deterministic, no LLM
  call — labels groundedness by string-matching against the master
  resume, not by asking the model)
- `renderMarkdown(master: MasterResume, tailored: TailoredResume): string`
  and `fitToOnePage(markdown: string): Promise<{ markdown: string; pdf: Buffer }>`
  (`packages/agent/src/ai/format.ts`, `fit-page.ts`)

```
POST /api/playground/parse-resume   { resumeText, apiKey } OR multipart { resumeFile, apiKey }
  → rate-limit check (reject 429 if this IP hash has 5+ rows in the last hour)
  → log one row to playground_usage (hashed IP, timestamp)
  → importMasterResume(text) [uses visitor's key]
  → 200 { masterResume }                                    (not saved)

POST /api/playground/fetch-jd       { url }
  → reuses existing fetch-jd.ts (no key needed, no LLM call)
  → 200 { text, title?, company?, location? }                (not saved)

POST /api/playground/suggest        { masterResume, jd, apiKey }
  → suggestKeywords(jd, masterResume) [uses visitor's key]
  → 200 { suggestions }                                      (not saved)

POST /api/playground/apply          { masterResume, acceptedSuggestions, apiKey }
  → applySuggestions(masterResume, accepted)                 (deterministic)
  → renderMarkdown(...) → fitToOnePage(markdown) [may use visitor's key, 0-2 calls]
  → 200 { markdown, pdfBase64 }                               (not saved)
```

The visitor's API key is read from the request body on each call, used
only for that call's LLM invocation(s), and never written to a log,
file, or database row. `parse-resume` and `suggest` each make exactly
one LLM call; `apply` makes zero to two (only if `fitToOnePage`'s trim
loop fires).

### LLM calling: new path, additive to `llm.ts`

`completeJSON()` gains an optional field on its `opts`:
`anthropicApiKey?: string`. When present, it takes precedence over the
`LLM_PROVIDER` env-var dispatch and calls Anthropic's Messages API
directly (via `@anthropic-ai/sdk` or a plain `fetch`) using that key,
through a new sibling function next to `callClaudeCli` (e.g.
`callAnthropicWithKey`). `importMasterResume()` and `suggestKeywords()`
each gain an optional trailing `apiKey?: string` parameter that they
forward into `completeJSON`'s `opts.anthropicApiKey`. `fitToOnePage()`
and its internal `trimToOnePage()` need the same optional parameter
threaded through, since the trim pass also calls `completeJSON`.
Existing callers (the real app's `/api/tailor`, `/api/master-resume/import`,
etc.) omit the new parameter entirely — behavior for Christopher's own
usage is unchanged.

If the visitor's key is invalid, expired, or rate-limited by Anthropic,
the underlying call throws; the route handler catches it and returns a
clear error ("Your Anthropic API key was rejected — check that it's
valid and has available credit") rather than a generic 500.

### Routes and security

`packages/web/middleware.ts` adds `/playground` (and its own
`/api/playground/*`) to the existing public-page/API branches — same
treatment as `/login`/`/api/auth`, no session required.

`packages/web/app/api/playground/*/route.ts` handlers do NOT call
`auth()` (there's no session to check), but DO attach
`X-Internal-Secret: process.env.INTERNAL_API_SECRET` when forwarding to
the agent, identical to how the authenticated proxy protects the agent
API today. This means the agent's shared-secret gate is unchanged and
uniform across both the private and public paths — the agent doesn't
need to know or care which Next.js route called it, only that the
secret is present.

`packages/agent/src/api/routes/playground.ts` is mounted in
`packages/agent/src/api/index.ts` alongside the existing routers,
inheriting the same `requireInternalSecret` gate every other agent
route already has (mounted in `packages/agent/src/index.ts`). No new
agent-side auth concept is introduced.

### Rate limiting + usage log

One new table, `playground_usage`:
```sql
CREATE TABLE playground_usage (
  id         uuid primary key default gen_random_uuid(),
  ip_hash    text NOT NULL,   -- sha256(ip + a server-only pepper), never the raw IP
  created_at timestamptz NOT NULL default now()
);
CREATE INDEX idx_playground_usage_ip_hash_created_at ON playground_usage (ip_hash, created_at);
```
- Written once per `parse-resume` call (the entry point of a run), not
  once per step. Logging at the start rather than only on completion is
  deliberate: `parse-resume` and `suggest` are exactly where the real
  compute/LLM cost is, so the rate limit has to see every attempt, not
  just the ones a visitor finishes end-to-end. As a usage signal, "runs
  started" is arguably more useful to Christopher anyway, since it
  captures drop-off, not just completions.
- The rate-limit check happens at the start of `parse-resume`: count
  rows for this IP's hash in the last hour; if 5 or more, reject with
  429 before doing any work. Storing the hash instead of the raw IP
  means even Christopher
  reading the table directly can't reverse it to a specific visitor's
  IP, while still being able to group repeat usage.
- No resume text, JD text, suggestions, output, or API key ever goes
  into this or any other table.

### Frontend

`packages/web/app/playground/page.tsx` — public landing page in the
same design language as `/login` (dark ink backdrop, paper card,
Fraunces heading) explaining what this is and linking to
`console.anthropic.com` for visitors who don't have a key yet, with a
"Try it" entry into the flow.

`packages/web/components/PlaygroundFlow.tsx` — client component driving
the 3-step flow via local React state (no URL/route change between
steps, no `resumeId` — the whole flow lives in one page's state):
1. **Inputs**: resume paste-or-upload (reusing the same UI pattern as
   `MasterResumeForm`'s import feature), a password-masked Anthropic API
   key field with a visible "never stored, used only for this request"
   note, and a JD field (paste or URL-fetch, reusing `TailorForm`'s
   pattern) → calls `parse-resume` (and `fetch-jd` if a URL was given)
   then `suggest`.
2. **Review**: reuses the existing `SuggestionChecklist` UI pattern,
   adapted to operate on suggestions held in component state instead of
   fetched via `resumeId` → calls `apply` with the accepted subset.
3. **Result**: PDF preview (same pane style as `ResumeEditor`'s
   `PdfPane`) + a download button. No "email to me" or "mark as
   applied" — those are tied to Christopher's own email and application
   log, meaningless for a visitor.

Design tokens are reused as-is from the app redesign
(`docs/superpowers/specs` — see the private-auth design doc's
follow-up work): `bg-paper`, `text-paper-ink`, `text-paper-muted`,
`border-paper-border`, `font-serif` for headings, `font-mono` for
meta/status text, violet as the single accent.

### Testing

- Unit: `labelGroundedness`/`applySuggestions` already have coverage
  and are unchanged. New coverage needed for the Anthropic-key-path
  addition to `completeJSON` (mock the Anthropic SDK call, verify the
  key is passed through and that omitting `anthropicApiKey` preserves
  today's `LLM_PROVIDER` dispatch behavior unchanged).
- Manual, via `/run`: full playground flow end-to-end with a real
  (personal/test) Anthropic key — paste a resume, fetch a JD via URL,
  review and accept a subset of suggestions, download the PDF, confirm
  it matches the accepted edits. Confirm an invalid key produces a
  clear error, not a 500. Confirm hitting the rate limit (the first 5
  `parse-resume` calls in an hour from one IP succeed, the 6th returns
  429) works as expected. Confirm nothing appears in
  `tailored_resumes`, `master_resume`, or any other table Christopher's
  own data lives in after a playground run — only one row in
  `playground_usage`.
