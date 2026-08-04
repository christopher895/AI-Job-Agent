# Master Resume Import Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Christopher paste resume text or upload a PDF on `/resume/master` and have it parsed into the `MasterResume` structure, pre-filling the existing form for review before he explicitly saves — plus a non-blocking warning when the master resume renders to more than one page.

**Architecture:** One new agent-side module (`import-master-resume.ts`) wraps a single `completeJSON` call that maps raw text into the existing `MasterResumeSchema`. One new route (`POST /api/master-resume/import`) accepts either JSON `{ text }` or a multipart PDF upload (via `multer`, text extracted with `pdf-parse`) and returns the parsed `MasterResume` — it never writes to the DB; the existing `PUT /api/master-resume` (already wired to `MasterResumeForm`'s Save button) is still the only save path. The one-page warning reuses `fit-page.ts`'s existing `countPdfPages` helper, surfaced via a new response header on the already-existing preview-pdf route.

**Tech Stack:** Express, Zod, `multer` (new), `pdf-parse` (new), Next.js/React on the frontend.

## Global Constraints

- The import endpoint never persists to `master_resume` — it only returns parsed JSON for the frontend to hold as unsaved form state, exactly like any other in-form edit. (Design spec section A.)
- One-page enforcement is a **warning, not a block** — Save must still work when the resume is >1 page. (Design spec section B.)
- No test runner exists for `packages/web`; frontend steps are verified by `npx tsc --noEmit` + manual QA. Agent-side logic gets a real test script following this repo's existing convention (see `packages/agent/src/ai/test-grounding.ts`): a `tsx`-run script with manual assertions and `process.exit(pass ? 0 : 1)`, registered as an `npm run test:*` script.

---

### Task 1: Add `pdf-parse` and `multer` dependencies

**Files:**
- Modify: `packages/agent/package.json`

**Interfaces:**
- Produces: `pdf-parse` (default export, `(buffer: Buffer) => Promise<{ text: string }>`) and `multer` (default export, Express middleware factory) available to later tasks.

- [ ] **Step 1: Install the packages**

Run:
```bash
cd packages/agent && npm install pdf-parse multer && npm install -D @types/pdf-parse
```
Expected: `package.json` gains `pdf-parse` and `multer` under `dependencies`, `@types/pdf-parse` under `devDependencies` (`multer`'s own types ship in the package since v1.4.4-lts.1, no separate `@types/multer` needed).

- [ ] **Step 2: Verify the install**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors (nothing imports these packages yet, so this just confirms the install didn't break the existing build).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/package.json packages/agent/package-lock.json
git commit -m "$(cat <<'EOF'
chore: add pdf-parse and multer for master resume import

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Expose one-page warning via a page-count header on the preview-pdf route

**Files:**
- Modify: `packages/agent/src/ai/fit-page.ts:19` (export `countPdfPages`)
- Modify: `packages/agent/src/api/routes/master-resume.ts` (preview-pdf route)
- Modify: `packages/agent/src/index.ts:16` (CORS expose-headers)
- Modify: `packages/web/lib/api.ts` (`previewMasterResumePdf` return shape)
- Modify: `packages/web/components/MasterResumeForm.tsx` (warning banner)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `countPdfPages(pdf: Buffer): Promise<number>` exported from `fit-page.ts` for Task 4 onward if ever needed; `api.previewMasterResumePdf(data): Promise<{ blob: Blob; pageCount: number | null }>` for any future master-resume UI work.

- [ ] **Step 1: Export `countPdfPages`**

In `packages/agent/src/ai/fit-page.ts:19`, change:
```diff
-async function countPdfPages(pdf: Buffer): Promise<number> {
+export async function countPdfPages(pdf: Buffer): Promise<number> {
```

- [ ] **Step 2: Add `X-Page-Count` to the preview-pdf response**

In `packages/agent/src/api/routes/master-resume.ts`, add the import and set the header:
```diff
 import { renderMasterResumePdf } from "../../ai/render-pdf";
+import { countPdfPages } from "../../ai/fit-page";
```
```diff
   try {
     const pdf = await renderMasterResumePdf(parsed.data);
+    const pages = await countPdfPages(pdf);
     res.setHeader("Content-Type", "application/pdf");
     res.setHeader("Content-Disposition", 'inline; filename="master-resume.pdf"');
+    res.setHeader("X-Page-Count", String(pages));
     res.send(pdf);
   } catch (err) {
```

- [ ] **Step 3: Expose the header through CORS**

Custom response headers are invisible to browser `fetch()` across origins unless explicitly exposed — `Content-Disposition` already is (used by `filenameFromContentDisposition` in `lib/api.ts`); add the new one alongside it. In `packages/agent/src/index.ts:16`:
```diff
-  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
+  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Page-Count");
```

- [ ] **Step 4: Read the header on the frontend**

In `packages/web/lib/api.ts`, add a header-reading helper next to `filenameFromContentDisposition` and change `previewMasterResumePdf`'s return shape:
```ts
function pageCountFromHeaders(res: Response): number | null {
  const header = res.headers.get("X-Page-Count");
  const n = header ? parseInt(header, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}
```
Replace the `requestBlob`-based `previewMasterResumePdf` with a dedicated implementation (it's the only caller of the page-count header, so no shared helper is needed):
```diff
-  previewMasterResumePdf: (data: MasterResume) =>
-    requestBlob("POST", "/master-resume/preview-pdf", data),
+  previewMasterResumePdf: async (data: MasterResume): Promise<{ blob: Blob; pageCount: number | null }> => {
+    const res = await fetch(`${API}/master-resume/preview-pdf`, {
+      method: "POST",
+      headers: { "Content-Type": "application/json" },
+      body: JSON.stringify(data),
+    });
+    if (!res.ok) {
+      const err = await res.json().catch(() => ({ error: res.statusText }));
+      throw new Error((err as { error?: string }).error ?? res.statusText);
+    }
+    return { blob: await res.blob(), pageCount: pageCountFromHeaders(res) };
+  },
```

- [ ] **Step 5: Show the warning banner**

In `packages/web/components/MasterResumeForm.tsx`, add a `pageCount` state and set it in `generatePreview`, then render a banner when it's `> 1`:
```diff
   const [previewError, setPreviewError] = useState<string | null>(null);
+  const [pageCount, setPageCount] = useState<number | null>(null);
```
```diff
   async function generatePreview() {
     setPreviewLoading(true);
     setPreviewError(null);
     setShowPreview(true);
     try {
-      const blob = await api.previewMasterResumePdf(resume);
+      const { blob, pageCount: pages } = await api.previewMasterResumePdf(resume);
       const url = URL.createObjectURL(blob);
       if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
       prevBlobRef.current = url;
       setPreviewBlobUrl(url);
+      setPageCount(pages);
     } catch (e) {
       setPreviewError(e instanceof Error ? e.message : "PDF generation failed.");
     } finally {
       setPreviewLoading(false);
     }
   }
```
Add the banner just above the closing `</div>` of the header block (right after the existing `{error && ...}` line inside the header's left column, so it's visible regardless of which section tab is active):
```diff
           <div>
             <h1 className="text-2xl font-semibold text-gray-900">Master Resume</h1>
             <p className="text-sm text-gray-500 mt-1">
               This is the source of truth used to generate all tailored resumes.
             </p>
+            {pageCount != null && pageCount > 1 && (
+              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-block">
+                This master resume is {pageCount} pages — trim a bullet or shorten wording before saving.
+              </p>
+            )}
           </div>
```

- [ ] **Step 6: Typecheck**

Run:
```bash
cd packages/agent && npx tsc --noEmit
cd packages/web && npx tsc --noEmit -p tsconfig.json
```
Expected: no errors in either package.

- [ ] **Step 7: Manual verification**

Via `/run`, open `/resume/master`. The PDF preview loads on mount as it does today; confirm no warning banner appears (the current seed content should still fit or be close). Temporarily add a long throwaway bullet to Experience, click "Refresh PDF", confirm the amber banner appears once it renders to 2 pages, then undo the edit (don't save) and confirm the banner disappears after the next refresh.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/ai/fit-page.ts packages/agent/src/api/routes/master-resume.ts packages/agent/src/index.ts packages/web/lib/api.ts packages/web/components/MasterResumeForm.tsx
git commit -m "$(cat <<'EOF'
feat: warn when the master resume PDF exceeds one page

Non-blocking: Save still works over 1 page, since Christopher edits
the master resume directly as his real resume rather than having it
auto-trimmed the way tailored, per-job resumes are.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `import-master-resume.ts` — LLM extraction into `MasterResumeSchema`

**Files:**
- Create: `packages/agent/src/ai/import-master-resume.ts`
- Create: `packages/agent/src/ai/test-import-master-resume.ts`
- Modify: `packages/agent/package.json` (add `test:import-master-resume` script)

**Interfaces:**
- Consumes: `completeJSON` from `./llm` (signature: `completeJSON<T>(schema, { system, user, model?, temperature?, maxRetries? }): Promise<T>`, already used identically by `tailor.ts`/`critic.ts`); `MasterResumeSchema`/`MasterResume` from `./types`.
- Produces: `importMasterResume(rawText: string): Promise<MasterResume>`, consumed by Task 4's route.

- [ ] **Step 1: Write the test script (fails until Step 2 exists)**

Create `packages/agent/src/ai/test-import-master-resume.ts`:
```ts
import { importMasterResume } from "./import-master-resume";
import { MasterResumeSchema } from "./types";

// A small, deliberately plain-text fixture — the kind of thing pasted straight
// from a Google Doc or extracted from a PDF, with no markdown/LaTeX structure.
const FIXTURE = `
Jordan Lee
Boston, MA · jordan.lee@example.com · (555) 123-4567
github.com/jordanlee

EXPERIENCE

Acme Corp — Backend Engineer · Boston, MA · June 2023 - Present
- Rebuilt the checkout service in Go, cutting p99 latency from 800ms to 210ms
- Migrated 40+ cron jobs off a legacy scheduler onto Kubernetes CronJobs

PROJECTS

Recipe Finder · React, Node.js, PostgreSQL · Jan 2023 - Mar 2023
- Built a full-text search feature over 10,000+ recipes using PostgreSQL tsvector

SKILLS
Languages: Go, TypeScript, SQL
Frameworks: React, Express
Tools: Docker, Kubernetes, PostgreSQL

EDUCATION
Boston University — B.S. Computer Science · Boston, MA · May 2023
`.trim();

async function main() {
  const result = await importMasterResume(FIXTURE);
  const parsed = MasterResumeSchema.safeParse(result);

  const allBulletText = [
    ...result.experience.flatMap((e) => e.bullets.map((b) => b.text)),
    ...result.projects.flatMap((p) => p.bullets.map((b) => b.text)),
  ].join(" | ");

  // Wording must be preserved verbatim — this is an import, not a rewrite.
  const preservesWording =
    allBulletText.includes("cutting p99 latency from 800ms to 210ms") &&
    allBulletText.includes("10,000+ recipes");

  const hasStableIds =
    result.experience.every((e) => e.id && e.bullets.every((b) => b.id)) &&
    result.projects.every((p) => p.id && p.bullets.every((b) => b.id));

  console.log("Schema valid:", parsed.success);
  if (!parsed.success) console.log(parsed.error.flatten());
  console.log("Preserves wording verbatim:", preservesWording);
  console.log("Has stable ids:", hasStableIds);
  console.log("Name:", result.basics.name, "| Email:", result.basics.email);

  const pass = parsed.success && preservesWording && hasStableIds;
  console.log(pass ? "\n✓ import-master-resume test PASSED" : "\n✗ import-master-resume test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ai/test-import-master-resume.ts`
Expected: fails to compile/run with `Cannot find module './import-master-resume'`.

- [ ] **Step 3: Implement `import-master-resume.ts`**

Create `packages/agent/src/ai/import-master-resume.ts`:
```ts
import { completeJSON } from "./llm";
import { MasterResume, MasterResumeSchema } from "./types";

const SYSTEM_PROMPT = `You extract structured résumé data from raw text — pasted from a Google Doc,
LaTeX source, or text extracted from a PDF — into a fixed JSON schema.

HARD RULES:
- This is an IMPORT, not a rewrite: copy bullet wording, dates, titles, and company
  names EXACTLY as they appear in the input. Do not improve, shorten, or rephrase
  anything, even if it reads awkwardly.
- Invent a stable "id" for every experience entry, project, and bullet, following
  the pattern "exp-<slug>-<n>" / "proj-<slug>-<n>" for entries (e.g. "exp-acme",
  "proj-recipe-finder") and "<entry-id>-<n>" for that entry's bullets in order
  (e.g. "exp-acme-1", "exp-acme-2").
- If a field isn't present in the input (LinkedIn URL, GPA, a project's repo link,
  etc.), leave it as an empty string or empty array — never guess or invent a value.
- Per bullet: "tech" is tools/technologies literally named in that bullet's own
  text; "metrics" is any number/percentage/dollar amount already in that bullet's
  text (never invent one that isn't there); "tags" may be left as an empty array.
- Classify every skill mentioned anywhere in the input into exactly one of
  skills.languages / skills.frameworks / skills.tools — never invent a skill not
  present in the input. skills.interests is usually absent from a resume; leave
  it as an empty array unless the input has an explicit interests/hobbies section.

OUTPUT: a single JSON object matching this exact shape:
{
  "basics": { "name": string, "location": string, "email": string, "phone": string,
              "github": string, "linkedin": string, "portfolio": string, "summary": string },
  "education": [{ "school": string, "degrees": string[], "location": string,
                   "gpa": string, "graduation": string, "coursework": string[], "notes": string[] }],
  "experience": [{ "id": string, "company": string, "title": string, "location": string,
                    "start": string, "end": string,
                    "bullets": [{ "id": string, "text": string, "tech": string[], "metrics": string[], "tags": string[] }] }],
  "projects": [{ "id": string, "name": string, "tech": string[], "start": string, "end": string,
                  "link": string, "repo": string, "bullets": [ /* same bullet shape as above */ ] }],
  "extracurriculars": [ /* same shape as experience entries */ ],
  "skills": { "languages": string[], "frameworks": string[], "tools": string[], "interests": string[] }
}
Return ONLY the JSON object.`;

export async function importMasterResume(rawText: string): Promise<MasterResume> {
  return completeJSON(MasterResumeSchema, {
    system: SYSTEM_PROMPT,
    user: rawText,
    temperature: 0.1,
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ai/test-import-master-resume.ts`
Expected: `Schema valid: true`, `Preserves wording verbatim: true`, `Has stable ids: true`, ending in `✓ import-master-resume test PASSED`. (This calls the real LLM via `CLAUDE_CODE_OAUTH_TOKEN`/`OPENAI_API_KEY`, same as `test-critic.ts` — if it fails validation, `completeJSON`'s built-in retry already re-prompts once before giving up.)

- [ ] **Step 5: Register the npm script**

In `packages/agent/package.json`, add next to the other `test:*` scripts:
```diff
     "test:general-resume": "tsx src/db/test-general-resume.ts",
+    "test:import-master-resume": "tsx src/ai/test-import-master-resume.ts",
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/ai/import-master-resume.ts packages/agent/src/ai/test-import-master-resume.ts packages/agent/package.json
git commit -m "$(cat <<'EOF'
feat: add importMasterResume() to extract MasterResume JSON from raw text

Single completeJSON call — preserves wording verbatim (import, not
rewrite) and invents stable bullet/entry ids since raw resume text has
none.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `POST /api/master-resume/import` route (text or PDF upload)

**Files:**
- Modify: `packages/agent/src/api/routes/master-resume.ts`

**Interfaces:**
- Consumes: `importMasterResume` from `../../ai/import-master-resume` (Task 3).
- Produces: `POST /api/master-resume/import` — request body either `{ text: string }` (JSON) or multipart form-data with a `file` field (PDF); response `200` with a `MasterResume` JSON body (unsaved), or `400`/`500` with `{ error: string }`.

- [ ] **Step 1: Add the route**

In `packages/agent/src/api/routes/master-resume.ts`:
```diff
 import { Router } from "express";
+import multer from "multer";
 import { getMasterResume, updateMasterResume } from "../../db/queries";
 import { MasterResumeSchema } from "../../ai/types";
 import { renderMasterResumePdf } from "../../ai/render-pdf";
 import { countPdfPages } from "../../ai/fit-page";
+import { importMasterResume } from "../../ai/import-master-resume";

 const router = Router();
+const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
```
Add the route after the existing `preview-pdf` route:
```ts
// POST /api/master-resume/import — parses pasted text or an uploaded PDF into a
// MasterResume. Never writes to the DB; the frontend holds the result as unsaved
// form state, same as any other in-form edit, until PUT /api/master-resume is called.
router.post("/import", upload.single("file"), async (req, res) => {
  let rawText: string;

  if (req.file) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(req.file.buffer);
      rawText = parsed.text;
    } catch (err) {
      console.error("[master-resume] pdf text extraction failed:", err);
      res.status(400).json({ error: "Could not read text from the uploaded PDF." });
      return;
    }
  } else if (typeof req.body?.text === "string" && req.body.text.trim()) {
    rawText = req.body.text;
  } else {
    res.status(400).json({ error: "Provide resume text or upload a PDF file." });
    return;
  }

  if (!rawText.trim()) {
    res.status(400).json({ error: "No text could be extracted — try pasting plain text instead." });
    return;
  }

  try {
    const master = await importMasterResume(rawText);
    res.json(master);
  } catch (err) {
    console.error("[master-resume] import failed:", err);
    res.status(500).json({ error: "Could not parse the resume — try pasting plain text instead." });
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

With the agent server running (`/run` or `cd packages/agent && npm run dev`):
```bash
curl -s -X POST http://localhost:3001/api/master-resume/import \
  -H "Content-Type: application/json" \
  -d '{"text": "Jane Doe\nBoston, MA\n\nEXPERIENCE\nAcme — Engineer · Boston, MA · 2023-Present\n- Shipped a thing"}' \
  | head -c 500
```
Expected: a `200` JSON response with a `MasterResume`-shaped object whose `experience[0].bullets[0].text` is `"Shipped a thing"` verbatim.

Also verify the no-input case:
```bash
curl -s -X POST http://localhost:3001/api/master-resume/import -H "Content-Type: application/json" -d '{}'
```
Expected: `400 {"error":"Provide resume text or upload a PDF file."}`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/api/routes/master-resume.ts
git commit -m "$(cat <<'EOF'
feat: add POST /api/master-resume/import (paste text or upload a PDF)

Returns the parsed MasterResume JSON without saving it — the frontend
holds it as unsaved form state until the existing Save button
(PUT /api/master-resume) is clicked, same as any other in-form edit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — Import panel on `/resume/master`

**Files:**
- Modify: `packages/web/lib/api.ts`
- Modify: `packages/web/components/MasterResumeForm.tsx`

**Interfaces:**
- Consumes: `POST /api/master-resume/import` (Task 4).
- Produces: an "Import" button that opens a small panel with a paste textarea and a PDF file input; on success, calls the form's existing `setResume(...)` so the rest of the form (dirty-tracking, Save, PDF preview) works unchanged.

- [ ] **Step 1: Add API client methods**

In `packages/web/lib/api.ts`, add a `FormData`-posting helper next to `requestBlob`:
```ts
async function requestFormData<T>(method: string, path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
```
Add two methods to the `api` object, next to `putMasterResume`:
```diff
   putMasterResume: (data: MasterResume) =>
     request<{ updated: boolean }>("PUT", "/master-resume", data),
+  importMasterResumeText: (text: string) =>
+    request<MasterResume>("POST", "/master-resume/import", { text }),
+  importMasterResumePdf: (file: File) => {
+    const fd = new FormData();
+    fd.append("file", file);
+    return requestFormData<MasterResume>("POST", "/master-resume/import", fd);
+  },
```

- [ ] **Step 2: Add the Import panel to `MasterResumeForm.tsx`**

Add state near the other preview state:
```diff
   const [pageCount, setPageCount] = useState<number | null>(null);
+  const [showImport, setShowImport] = useState(false);
+  const [importText, setImportText] = useState("");
+  const [importing, setImporting] = useState(false);
+  const [importError, setImportError] = useState<string | null>(null);
```
Add the two handlers, near `syncToGeneral`'s old position (now removed — place these after `save()`):
```ts
  async function importFromText() {
    if (!importText.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const parsed = await api.importMasterResumeText(importText);
      setResume(parsed);
      setShowImport(false);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function importFromPdf(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      const parsed = await api.importMasterResumePdf(file);
      setResume(parsed);
      setShowImport(false);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }
```
Add the "Import" button to the header actions, before "Save Changes":
```diff
             <button
               onClick={save}
               disabled={saving}
```
becomes:
```tsx
            <button
              onClick={() => setShowImport((v) => !v)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors font-medium"
            >
              Import…
            </button>
            <button
              onClick={save}
              disabled={saving}
```
Add the panel itself right after the header `</div>` that closes the `flex items-start justify-between mb-8` block:
```tsx
        {showImport && (
          <div className="mb-8 border border-gray-200 rounded-xl p-4 bg-gray-50">
            <p className="text-sm text-gray-600 mb-3">
              Paste your resume text below, or upload a PDF. This pre-fills the form for you to
              review — nothing is saved until you click Save Changes.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder="Paste resume text here…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white resize-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={importFromText}
                disabled={importing || !importText.trim()}
                className="text-sm px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {importing ? "Parsing…" : "Parse pasted text"}
              </button>
              <span className="text-xs text-gray-400">or</span>
              <label className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 cursor-pointer transition-colors">
                Upload PDF
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importFromPdf(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {importError && <span className="text-xs text-red-600">{importError}</span>}
            </div>
          </div>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Via `/run`:
1. Open `/resume/master`, click "Import…", paste a short plain-text resume, click "Parse pasted text".
2. Confirm the form's Basics/Experience/etc. fields update to the parsed content, the import panel closes, and the Save button is now enabled (dirty).
3. Click "Preview PDF" to confirm it renders, then click "Save Changes" and confirm `GET /api/master-resume` (or reloading the page) reflects the saved import.
4. Repeat with a small PDF file via "Upload PDF" instead of pasting.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/api.ts packages/web/components/MasterResumeForm.tsx
git commit -m "$(cat <<'EOF'
feat: add master resume import (paste text or upload PDF) to the form

Parsed content pre-fills the existing form as unsaved state — Save
Changes is still the only thing that persists it, so nothing is
silently overwritten.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Self-Review Notes

- Spec coverage: Task 1–4 implement design spec section A's extraction/route/no-silent-overwrite requirements; Task 2 implements section B's one-page warning; Task 5 implements section A's frontend review flow.
- Type consistency checked: `api.previewMasterResumePdf`'s new return shape (`{ blob, pageCount }`) is used consistently in Task 2 Step 5's `generatePreview`; `importMasterResumeText`/`importMasterResumePdf` both resolve to `MasterResume`, matching `setResume`'s expected type.
- No placeholders — every step shows the exact code or diff.
