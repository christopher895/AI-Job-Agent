# Job description panel in the resume editor

## Problem

`resume.jd_text` (the full job description used to generate a tailored résumé) is already stored and sent to the frontend, but there's nowhere in `/resume/[id]` to see it — once you've navigated away from `/tailor`, the JD is invisible while editing or reviewing the tailored output.

## Scope

Frontend-only. No backend changes — `jd_text` is already on the `Resume` type returned by `api.getResume(id)` (`packages/web/lib/api.ts:16`).

Changes confined to:
- `packages/web/components/ResumeEditor.tsx`

## Design

### Component

A new `JdPanel` component in `ResumeEditor.tsx`, following the existing `PdfPane`'s visual pattern (bordered, `bg-gray-50` background, header row with a title and close control, scrollable content area) for consistency with the pane already in this file.

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

Positioned `fixed inset-y-0 right-0` so it overlays as a drawer rather than adding a third flex column to the existing edit/split/preview layout — avoids cramping that layout further when combined with `split` mode's two panes already side by side.

### Trigger

New `showJdPanel` boolean state in `ResumeEditor`, independent of `viewMode` — a "View JD" button added to the header's action-button row (next to Download PDF / Email to me) toggles it. Works identically regardless of which of edit/split/preview is active, since it's an overlay, not a layout mode.

### Closing

- Click the `✕` button in the panel header (`onClose` sets `showJdPanel` to `false`).
- `Escape` key while the panel is open — a `useEffect` with a `keydown` listener scoped to when `showJdPanel` is true, matching the common drawer-close pattern.

### Rendering

`jd_text` is stored as raw plain text (not markdown), so it's rendered directly with `whitespace-pre-wrap` to preserve the original line breaks — no markdown parsing needed.

### Edge case

`resume.jd_text` is nullable (`string | null`) — older resumes generated via the paste-text-only flow, or predating this field, may not have one. The panel shows "No job description saved for this resume." instead of rendering an empty panel or crashing on `null`.

## Testing

No test framework exists for `packages/web` currently (no existing test files under `packages/web/components/`). Verification is manual: load `/resume/[id]` for a resume with a JD, toggle the panel open/closed via button and Escape, confirm text displays with preserved line breaks; then check a resume with `jd_text: null` (or a DB row with it unset) shows the empty-state message instead of erroring.

## Error handling

No new error states — this is a pure client-side render of already-loaded data, no network calls, so there's nothing that can fail beyond a `null` value, which is handled by the empty-state branch above.
