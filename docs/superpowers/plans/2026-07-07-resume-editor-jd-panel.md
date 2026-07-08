# Resume Editor JD Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable "View JD" panel to the resume editor so the job description used to generate the résumé is visible while editing/reviewing it.

**Architecture:** A new `JdPanel` component inside `ResumeEditor.tsx`, rendered as a fixed-position overlay drawer (not a third flex column), toggled by a new header button and closable via an `✕` button or `Escape`. Pure client-side render of `resume.jd_text`, which is already fetched — no backend or API changes.

**Tech Stack:** React (client component, `"use client"`), Tailwind CSS — matches the rest of `ResumeEditor.tsx` exactly, no new dependencies.

## Global Constraints

- No backend/API changes — `resume.jd_text: string | null` is already returned by `api.getResume(id)` (`packages/web/lib/api.ts:16`).
- No test framework exists in `packages/web` — verification is manual via the dev server, not automated tests.
- Follow the existing `PdfPane` component's visual conventions in the same file (bordered panel, `bg-gray-50`, header row with title + control, scrollable content) for consistency.
- `jd_text` is raw plain text, not markdown — render with `whitespace-pre-wrap`, no markdown parsing.

---

### Task 1: Add the JD panel to ResumeEditor

**Files:**
- Modify: `packages/web/components/ResumeEditor.tsx`

**Interfaces:**
- Consumes: `resume.jd_text: string | null` (already on the `Resume` type passed into `ResumeEditor`, no changes needed to `packages/web/lib/api.ts`).
- Produces: nothing consumed by other files — this is a self-contained UI addition within `ResumeEditor.tsx`.

This is a single cohesive UI change (component + state + trigger + close behavior all serve one visible feature), so it's one task rather than split further — a reviewer would approve or reject the whole panel together, not piece by piece.

- [ ] **Step 1: Add the `JdPanel` component**

In `packages/web/components/ResumeEditor.tsx`, add this new function directly after the existing `PdfPane` component (which ends at line 94, right before `export default function ResumeEditor({`):

```tsx
function JdPanel({ jdText, onClose }: { jdText: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md border-l border-gray-200 bg-gray-50 shadow-xl z-20 flex flex-col">
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-gray-600">Job Description</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {jdText ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{jdText}</p>
        ) : (
          <p className="text-sm text-gray-400">No job description saved for this resume.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the `showJdPanel` state**

In `ResumeEditor`, find this line (currently line 112):

```tsx
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
```

Add a new state line directly after it:

```tsx
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [showJdPanel, setShowJdPanel] = useState(false);
```

- [ ] **Step 3: Close the panel on Escape**

Find the existing "Revoke blob URL on unmount" `useEffect` (currently lines 189–193):

```tsx
  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);
    };
  }, []);
```

Add a new `useEffect` directly after it:

```tsx
  // Close the JD panel on Escape
  useEffect(() => {
    if (!showJdPanel) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowJdPanel(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showJdPanel]);
```

- [ ] **Step 4: Add the "View JD" button**

Find the action-button row in the header (currently starts at line 329, the `handleDownload` button). Add a new button directly **before** the existing `Download PDF` button:

```tsx
          <button
            onClick={() => setShowJdPanel(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M16 13H8" />
              <path d="M16 17H8" />
            </svg>
            View JD
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
          >
```

(The second `<button onClick={handleDownload}...>` line above is the existing line — this step only adds the new "View JD" button immediately before it, the `handleDownload` button itself is unchanged.)

- [ ] **Step 5: Render the panel conditionally**

Find the closing `</div>` of the component's root element (currently the very last line before the final `);`  and `}`  — the root `<div className="flex flex-col h-full bg-white">` from line 256). Add the conditional render of `JdPanel` directly before that root div's closing tag, i.e. as the last child inside it. Locate the end of the component's JSX (currently ends with the footer `</div>` at line 469, followed by the closing root `</div>` at line 470):

```tsx
      )}
    </div>
  );
}
```

Change it to:

```tsx
      )}

      {showJdPanel && <JdPanel jdText={resume.jd_text} onClose={() => setShowJdPanel(false)} />}
    </div>
  );
}
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev:web` (from the repo root, or `packages/web` directly)
Navigate to any existing `/resume/[id]` URL.

Check:
1. A "View JD" button appears in the header next to "Download PDF".
2. Clicking it slides in a right-side panel titled "Job Description" showing the JD text with preserved line breaks.
3. Clicking the `✕` closes it.
4. Opening it again and pressing `Escape` closes it.
5. The panel works identically in all three of Edit / Split / Preview view modes (switch between them with the panel open).
6. If you have (or can create via a direct DB check) a resume row with `jd_text` set to `null`, opening the panel for that resume shows "No job description saved for this resume." instead of erroring or rendering blank.

Expected: all six checks pass, no console errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/components/ResumeEditor.tsx
git commit -m "feat: add job description panel to resume editor"
```

---

## Self-Review Notes

- **Spec coverage:** component (Step 1), trigger state (Step 2), close via button (Step 1's `onClose`) and Escape (Step 3), header button (Step 4), conditional render (Step 5), null-JD edge case (Step 1's ternary) — every spec section has a corresponding step.
- **Type consistency:** `JdPanel`'s `jdText: string | null` matches `resume.jd_text: string | null` from `packages/web/lib/api.ts:16` exactly; `showJdPanel`/`setShowJdPanel` names are introduced once (Step 2) and reused consistently in Steps 3–5.
- **Scope:** confined entirely to `ResumeEditor.tsx`, matching the spec's stated scope — no other files touched.
