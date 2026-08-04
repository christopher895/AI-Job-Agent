# General Resume UI Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Master/General mode toggle, the General Resume tab, and the "Sync to General ⟳" button from `/resume/master`, so the page is master-only.

**Architecture:** Pure frontend change to `MasterResumeForm.tsx` — delete the `mode` state and everything gated on it. No backend, schema, or route changes: `general-resume.ts`, `routes/general-resume.ts`, the `queries.ts` general-resume functions, and `api.ts`'s `getGeneralResume`/`generateGeneralResume` client methods are left in place, unreferenced by any UI — a fast re-enable later if wanted, per Christopher's explicit call in the design spec.

**Tech Stack:** Next.js 16 (App Router), TypeScript, React 19.

## Global Constraints

- Do not touch `packages/agent/src/ai/general-resume.ts`, `packages/agent/src/api/routes/general-resume.ts`, or any `queries.ts`/`schema.ts` general-resume code — dormant, not deleted.
- Do not delete `packages/web/components/GeneralResumeTab.tsx` — it becomes an orphaned, unimported file (no build impact) rather than a deleted one.
- No test runner exists for `packages/web` — verification is `npx tsc --noEmit` (typecheck) plus manual QA via the dev server, not an automated test suite.

---

### Task 1: Remove the Master/General toggle from MasterResumeForm.tsx

**Files:**
- Modify: `packages/web/components/MasterResumeForm.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MasterResumeForm` renders only the master-editing UI it already had before the General tab existed — no new exports, no prop changes.

- [ ] **Step 1: Remove the `GeneralResumeTab` import and mode/sync state**

In `packages/web/components/MasterResumeForm.tsx`, delete the import and the state/refs that only exist to support the General tab. `dirty`/`isFirstRenderRef` are included here too — once the "Sync to General" button (their only reader, via `disabled={dirty || syncing}`/its `title`) is gone in Step 4, they become dead code with no other caller:

```diff
- import GeneralResumeTab from "./GeneralResumeTab";
```

```diff
-  const [mode, setMode] = useState<"master" | "general">("master");
-  const [dirty, setDirty] = useState(false);
-  const isFirstRenderRef = useRef(true);
-  const [syncing, setSyncing] = useState(false);
-  const [syncError, setSyncError] = useState<string | null>(null);
```

- [ ] **Step 2: Remove the `syncToGeneral` function and the now-dead `dirty`-tracking effect**

Delete `syncToGeneral` (it's only called from the button removed in Step 4):

```diff
-  async function syncToGeneral() {
-    setSyncing(true);
-    setSyncError(null);
-    try {
-      await api.generateGeneralResume();
-      setMode("general");
-    } catch (e) {
-      setSyncError(e instanceof Error ? e.message : "Sync failed");
-    } finally {
-      setSyncing(false);
-    }
-  }
```

Delete the effect that tracked `dirty` (its only reader was the now-removed "Sync to General" button's `disabled`/`title`):

```diff
-  // Any edit to the Master form marks it dirty; "Sync to General" is
-  // disabled while dirty because syncing always reads the DB-persisted
-  // master resume (same source getMasterResume() uses everywhere else),
-  // so unsaved form edits would silently not be reflected in a sync.
-  useEffect(() => {
-    if (isFirstRenderRef.current) {
-      isFirstRenderRef.current = false;
-      return;
-    }
-    setDirty(true);
-  }, [resume]);
-
```

- [ ] **Step 3: Remove the mode toggle buttons and unwrap the Sections list**

Replace the sidebar's mode-toggle block. Before:

```tsx
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Resume</p>
        {(["master", "general"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              mode === m
                ? "bg-violet-50 text-violet-700 font-medium"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {m === "master" ? "Master Resume" : "General Resume"}
          </button>
        ))}

        {mode === "master" && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2 mt-6">
              Sections
            </p>
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                  activeSection === s
                    ? "bg-violet-50 text-violet-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {s}
              </button>
            ))}
          </>
        )}
```

After:

```tsx
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Sections</p>
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              activeSection === s
                ? "bg-violet-50 text-violet-700 font-medium"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {s}
          </button>
        ))}
```

- [ ] **Step 4: Remove the General-mode branch and the "Sync to General ⟳" button**

Before:

```tsx
      {/* Content + optional preview panel */}
      {mode === "general" ? (
        <div className="flex-1 min-w-0">
          <GeneralResumeTab />
        </div>
      ) : (
      <PanelGroup direction="horizontal" className="flex-1 min-w-0">
```

After:

```tsx
      {/* Content + preview panel */}
      <PanelGroup direction="horizontal" className="flex-1 min-w-0">
```

And at the end of that same `PanelGroup` block, remove the closing `)` that paired with the ternary:

```diff
         </>
         )}
       </PanelGroup>
-      )}
     </div>
   );
 }
```

Then remove the "Sync to General ⟳" button and its error span from the header actions:

```diff
-            {syncError && <span className="text-xs text-red-600">{syncError}</span>}
-            <button
-              onClick={syncToGeneral}
-              disabled={dirty || syncing}
-              title={dirty ? "Save changes first" : "Regenerate the General Resume from this Master Resume"}
-              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
-            >
-              {syncing ? "Syncing…" : "Sync to General ⟳"}
-            </button>
             <button
               onClick={save}
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. `useEffect` remains imported and used elsewhere in this file (the PDF-preview-on-mount effect), so removing the `dirty`-tracking effect doesn't leave an unused import.

- [ ] **Step 6: Manual verification**

Use the `/run` skill (or `cd packages/web && npm run dev`) to start the web app, then:
1. Open `/resume/master`.
2. Confirm the left sidebar shows only "Sections" (Basics/Experience/Projects/Skills/Education/Extracurriculars) with no "Master Resume" / "General Resume" toggle above it.
3. Confirm there is no "Sync to General ⟳" button in the header.
4. Confirm "Preview PDF" and "Save Changes" still work as before (edit a field, see the PDF preview refresh, save, see "Saved ✓").

- [ ] **Step 7: Commit**

```bash
git add packages/web/components/MasterResumeForm.tsx
git commit -m "$(cat <<'EOF'
feat: remove general-resume UI from the master resume page

The Master/General toggle, General tab, and "Sync to General" button
are removed from MasterResumeForm.tsx; the general-resume backend
(ai/general-resume.ts, routes/general-resume.ts, its DB rows) is left
in place, just unreachable from the UI, per the source-of-truth pivot
design (docs/superpowers/specs/2026-08-03-master-resume-source-of-truth-design.md).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Self-Review Notes

- Spec coverage: this plan implements design spec section B in full ("Remove from `MasterResumeForm.tsx`... Leave `general-resume.ts`... dormant").
- No placeholders — every step shows the exact diff.
- Only one task, since this is a single cohesive, small removal with one reviewable deliverable (the page renders correctly with no General mode).
