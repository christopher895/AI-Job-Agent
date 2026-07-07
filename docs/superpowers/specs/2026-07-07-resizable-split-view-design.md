# Resizable Split View — Resume Editor

## Problem

On `/resume/[id]`, Split mode shows the Markdown editor and PDF preview side by side with a hardcoded 50/50 width split (`ResumeEditor.tsx`, textarea `w-1/2` vs `PdfPane` `flex-1`). There's no way to drag the divider to resize either pane. Additionally, opening a resume defaults to Edit mode; the user wants Split mode as the default landing view.

## Design

### 1. Default view mode

`packages/web/app/resume/[id]/page.tsx:23-25` currently falls back to `"edit"` when no `?view=` query param is present or the param is invalid. Change the fallback to `"split"`. The `?view=edit` / `?view=preview` / `?view=split` params and the in-app Edit/Split/Preview toggle continue to work unchanged.

### 2. Draggable resize handle

Add `react-resizable-panels` as a dependency of `packages/web/package.json`. Pinned to `^3.0.6` — the package's v4 line rewrote the public API (`Group`/`Separator`/`orientation` instead of `PanelGroup`/`PanelResizeHandle`/`direction`), so 3.0.6 is the last release with the classic `PanelGroup` / `Panel` / `PanelResizeHandle` API this design uses.

In `ResumeEditor.tsx`, the content block (previously lines 435–457) is restructured so that **only when `viewMode === "split"`** the editor and preview panes are wrapped in `PanelGroup` / `Panel` / `PanelResizeHandle`:

```tsx
<PanelGroup direction="horizontal" className="flex-1 min-h-0">
  <Panel defaultSize={50} minSize={20}>
    <textarea className="w-full h-full resize-none font-mono text-sm leading-relaxed text-gray-800 bg-white px-10 py-8 focus:outline-none" ... />
  </Panel>
  <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-violet-400 active:bg-violet-500 transition-colors cursor-col-resize" />
  <Panel defaultSize={50} minSize={20}>
    <PdfPane className="h-full" ... />
  </Panel>
</PanelGroup>
```

`minSize={20}` (20% of the row) on each `Panel` prevents either pane from being dragged to zero width.

`PdfPane` needs a `className` prop threaded through to its root div so it can be told `h-full` when rendered inside a `Panel` (a `Panel` is a block-level container with an explicit height/width, not a flex item that a bare `flex-1` child could stretch into).

### 3. Edit-only / Preview-only modes

When `viewMode` is `"edit"` or `"preview"`, only one pane is visible, so there is nothing to resize. These modes keep the current plain layout: a single full-width/flex-1 element, no `PanelGroup`, no resize handle.

### 4. Persistence

The split ratio is not persisted. `PanelGroup` keeps its own internal state; every fresh page load (or switching away from and back to Split mode by remounting) resets to the `defaultSize={50}` 50/50 split. No localStorage or other storage layer is introduced.

## Files touched

- `packages/web/package.json` — add `react-resizable-panels` (`^3.0.6`) dependency
- `packages/web/app/resume/[id]/page.tsx` — change default view fallback from `"edit"` to `"split"` (line 25)
- `packages/web/components/ResumeEditor.tsx` — import `Panel`, `PanelGroup`, `PanelResizeHandle`; restructure the content block to conditionally use panels in split mode; thread a `className` prop into `PdfPane`

## Out of scope

- Persisting the split ratio across reloads/sessions
- Vertical (stacked) resizing or a vertical divider
- Changing Edit-only or Preview-only layouts
