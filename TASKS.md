# Build Tasks

Each task is self-contained and shippable on its own. Work top-to-bottom — later tasks depend on earlier ones within each phase.

---

## Phase 1 — Database Foundation

### 1.1 Add new tables to DB schema and queries
**Files:** `packages/agent/src/db/schema.ts`, `packages/agent/src/db/queries.ts`

Add three new tables:
- `tailored_resumes` — stores every generated resume (markdown, PDF blob, job info, critic score)
- `master_resume` — single-row table holding the master resume JSON (replaces hardcoded file)
- `applied_jobs` — application log (company, role, location, URL, status, applied_at, resume FK, sheets row number)

Write typed query functions for all CRUD operations on each table.

---

### 1.2 Migrate master resume from file to database
**Files:** `packages/agent/src/ai/master-resume.ts`, `packages/agent/src/db/queries.ts`

Seed the `master_resume` table with the current hardcoded `MASTER_RESUME` object. Update `master-resume.ts` to export an async `getMasterResume()` that reads from the DB instead of the file. Update all callers (`tailor.ts`, `chain.ts`) to await it.

---

## Phase 2 — API Endpoints

### 2.1 POST /api/tailor — run the tailoring pipeline
**Files:** new `packages/agent/src/api/routes/tailor.ts`

Accepts: `{ jdText?: string, jobUrl?: string, jobTitle?: string, company?: string }`

- If `jobUrl` provided and no `jdText`: auto-fetch the JD (see task 2.2)
- Run `generateBestResume(jd, { jobTitle, company })`
- Insert row into `tailored_resumes` with markdown + critic score + job metadata
- Trigger PDF render (task 2.3) and store result
- Return `{ id, markdown, criticScore }`

---

### 2.2 JD auto-fetch utility
**Files:** new `packages/agent/src/scraper/fetch-jd.ts`

Given a job URL:
1. Try Cheerio (fast, static) — extract the largest text block that looks like a job description
2. Fall back to Playwright if Cheerio returns < 200 chars
3. Return `{ text: string, method: 'cheerio' | 'playwright' | 'failed' }`

Used by task 2.1. Returns `failed` if the page blocks scraping — the API caller should prompt the user to paste the JD manually.

---

### 2.3 PDF generation utility
**Files:** new `packages/agent/src/ai/render-pdf.ts`

Takes the resume Markdown string, renders it to HTML using a clean CSS template, then generates a PDF buffer via Puppeteer. Returns `Buffer`.

Style: single-column, standard resume fonts, ATS-safe (no tables, columns, or icons). PDF design can be swapped out later by changing the HTML template.

---

### 2.4 GET /api/resumes — list all tailored resumes
**Files:** `packages/agent/src/api/routes/resumes.ts`

Returns all rows from `tailored_resumes` ordered by `created_at DESC`:
`[{ id, jobTitle, company, jobUrl, criticScore, createdAt, updatedAt }]`

Used by the history dashboard (`/`).

---

### 2.5 GET /api/resume/:id — fetch a single tailored resume
**Files:** `packages/agent/src/api/routes/resumes.ts`

Returns `{ id, jobTitle, company, jobUrl, jdText, markdown, criticScore, createdAt, updatedAt }`.

Does NOT return the PDF blob — PDF is served separately.

---

### 2.6 PATCH /api/resume/:id — save edits
**Files:** `packages/agent/src/api/routes/resumes.ts`

Accepts `{ markdown: string }`. Updates `tailored_resumes.markdown` and `updated_at`. Re-renders the PDF and stores it. Returns `{ updatedAt }`.

Called on every auto-save from the editor.

---

### 2.7 GET /api/resume/:id/pdf — serve the PDF
**Files:** `packages/agent/src/api/routes/resumes.ts`

Streams the stored PDF blob as `application/pdf`. Used for the Download button and the Email attachment.

---

### 2.8 POST /api/resume/:id/email — email the PDF to Christopher
**Files:** `packages/agent/src/api/routes/resumes.ts`

Fetches the resume row, attaches the PDF, sends via Resend to `YOUR_EMAIL`. Subject: `"[company] — [jobTitle] resume"`.

---

### 2.9 GET/PUT /api/master-resume — read and update master resume
**Files:** `packages/agent/src/api/routes/master-resume.ts`

- `GET` returns the full `MasterResume` JSON from the DB
- `PUT` accepts a full `MasterResume` JSON, validates with Zod, and overwrites the DB row

---

### 2.10 POST /api/applied — log a job application
**Files:** new `packages/agent/src/api/routes/applied.ts`

Accepts `{ resumeId, company, jobTitle, location, jobUrl, status, appliedAt }`. Inserts into `applied_jobs`. Triggers Google Sheets sync (task 2.11). Returns the new row.

---

### 2.11 PATCH /api/applied/:id — update application status
**Files:** `packages/agent/src/api/routes/applied.ts`

Accepts `{ status }`. Updates `applied_jobs.status`. Re-syncs the row to Google Sheets. Returns the updated row.

---

### 2.12 GET /api/applied — list all applications
**Files:** `packages/agent/src/api/routes/applied.ts`

Returns all `applied_jobs` rows ordered by `applied_at DESC`, joined with resume link.

---

### 2.13 Wire all routes into the Express server
**Files:** `packages/agent/src/index.ts` or new `packages/agent/src/api/index.ts`

Mount all route files under `/api`. Add `express.json()` and CORS middleware (allow Next.js dev origin). Confirm all routes respond correctly.

---

## Phase 3 — Google Sheets Integration

### 3.1 Google Sheets sync function
**Files:** new `packages/agent/src/integrations/sheets.ts`

Set up `googleapis` with a service account. Implement:
- `appendRow(data)` — appends a new row: date applied, company, location, job URL, status, resume link
- `updateRow(sheetsRow, data)` — updates an existing row by row number when status changes

Store the spreadsheet ID in `GOOGLE_SHEETS_SPREADSHEET_ID` env var. Store the service account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON` env var.

Called by tasks 2.10 and 2.11.

---

## Phase 4 — Update Alert Emails

### 4.1 Add "Tailor resume" link to job alert emails
**Files:** `packages/agent/src/notifications/email.ts`

Update `buildEmailHtml()` so each job row includes a "Tailor resume →" link below the job title:

```
https://[APP_URL]/tailor?jobUrl=[encoded url]&title=[encoded title]&company=[encoded company]
```

Add `APP_URL` to env vars / config.

---

## Phase 5 — Web App Pages

### 5.1 Set up API client
**Files:** `packages/web/lib/api.ts`

Typed fetch wrapper functions that call the Express API (`NEXT_PUBLIC_API_URL`). One function per endpoint from Phase 2. Handle errors uniformly.

---

### 5.2 /tailor — job description input page
**Files:** `packages/web/app/tailor/page.tsx`

Fields:
- Job URL input (optional) — on blur or submit, calls `/api/tailor` with the URL to auto-fetch the JD, then populates the JD textarea
- JD textarea — editable, shows auto-fetched text or allows manual paste
- Job title + company inputs (optional)
- Generate button — POST to `/api/tailor`, shows a loading spinner, redirects to `/resume/[id]` on success

Pre-fill all fields from URL query params (`?jobUrl=...&title=...&company=...`) so email links drop the user right into a ready-to-generate state.

If auto-fetch returns `failed`, show a message: "Couldn't fetch this page — paste the job description below."

---

### 5.3 /resume/[id] — Google Doc-style resume editor
**Files:** `packages/web/app/resume/[id]/page.tsx`, `packages/web/components/ResumeEditor.tsx`

- Loads resume markdown via `GET /api/resume/:id`
- Displays in a full-width `<textarea>` styled to look like a document (monospace or serif font, generous padding, no border chrome)
- Auto-saves on change with 1s debounce → `PATCH /api/resume/:id`
- Toolbar buttons:
  - **Download PDF** — fetches `/api/resume/:id/pdf` and triggers browser download
  - **Email to me** — POST `/api/resume/:id/email`, shows "Sent!" confirmation
  - **Mark as Applied** — opens a small form (status, applied date) → POST `/api/applied`
- Shows job title + company in the page header
- Shows last-saved timestamp

---

### 5.4 / — resume history dashboard
**Files:** `packages/web/app/page.tsx`, `packages/web/components/ResumeCard.tsx`

Lists all tailored resumes from `GET /api/resumes`. Each card shows:
- Company + job title
- Date generated
- Critic score badge
- "Edit" link → `/resume/[id]`
- "Download PDF" link → `/api/resume/:id/pdf`

Newest first. No pagination needed for now.

---

### 5.5 /resume/master — master resume editor
**Files:** `packages/web/app/resume/master/page.tsx`

Loads the master resume JSON via `GET /api/master-resume`. Renders it as a structured form:
- Basics section (name, email, phone, github, linkedin, portfolio, location, summary)
- Experience section — list of roles, each with editable bullets (add/remove/reorder bullets)
- Projects section — same structure
- Skills section — editable comma-separated lists per category (languages, frameworks, tools)
- Extracurriculars section

Save button → `PUT /api/master-resume` with Zod validation. Show success/error toast.

---

### 5.6 /applied — application log
**Files:** `packages/web/app/applied/page.tsx`, `packages/web/components/AppliedTable.tsx`

Table loaded from `GET /api/applied`. Columns:
- Date applied
- Company
- Job title
- Location
- Job URL (linked)
- Status (inline dropdown — clicking updates via `PATCH /api/applied/:id`)
- Tailored resume (link to `/resume/[id]`)

Newest first. No filtering/sorting needed for v1.

---

## Phase 6 — Polish & Wiring

### 6.1 Nav bar
**Files:** `packages/web/components/Nav.tsx`, `packages/web/app/layout.tsx`

Simple top nav with links to: Dashboard (`/`), Tailor (`/tailor`), Master Resume (`/resume/master`), Applied (`/applied`).

---

### 6.2 Add APP_URL to config and .env.example
**Files:** `packages/agent/src/config.ts`, `.env.example`

Add `APP_URL` (used in email links) and `GOOGLE_SHEETS_SPREADSHEET_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON` to `.env.example` with placeholder values and comments.

---

### 6.3 End-to-end smoke test
Manually walk through both flows end-to-end:

1. **Alert flow:** Run the scraper on one company → receive email → click "Tailor resume" → page loads pre-filled → click Generate → editor opens → download PDF → mark as applied → check Google Sheet
2. **Manual flow:** Go to `/tailor` → paste a job URL → auto-fetch fills JD → Generate → editor → email to self → check `/` dashboard shows the new entry → check `/applied` after marking

Fix anything broken before deploying.

---

### 6.4 Deploy to Railway
Update Railway environment variables with all new vars. Confirm both the agent (Express API + cron) and the Next.js web app are running. Verify the live URL works end-to-end with one real job.
