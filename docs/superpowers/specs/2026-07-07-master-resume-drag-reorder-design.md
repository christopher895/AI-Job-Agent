# Drag-to-reorder entries on the Master Resume form

## Problem

`MasterResumeForm.tsx` renders Projects, Experience, and Extracurriculars as
lists of cards, each with add/remove controls but no way to change order.
The array order in `MasterResume` (`projects`, `experience`,
`extracurriculars`) directly determines the order entries appear in on the
generated PDF, so today the only way to reorder is to delete and re-add
entries from scratch, retyping everything. Christopher wants to drag a card
up or down within its section to reorder it.

## Scope

- `packages/web/components/MasterResumeForm.tsx` — add drag-to-reorder to
  the Projects, Experience, and Extracurriculars sections.
- `packages/web/package.json` — new dependencies: `@dnd-kit/core`,
  `@dnd-kit/sortable`, `@dnd-kit/utilities`.

Out of scope:
- Education section — it has no add/remove controls today and reordering
  wasn't requested for it; left untouched.
- Bullets within a card — only card-level (entry-level) reordering is in
  scope, not reordering bullets within an entry.
- Persisting order to the backend on every drag — reordering only updates
  local `resume` state, exactly like every other field edit in this form;
  it's persisted by the existing "Save Changes" button, not automatically.

## Design

### Library choice

`@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/utilities` for the
`CSS.Transform` helper). Actively maintained, React 19-compatible, built
specifically for sortable-list use cases, and includes keyboard support
(focus a handle, use arrow keys to move) for free.

Alternatives considered and rejected:
- `react-beautiful-dnd` — archived by Atlassian, unmaintained, doesn't
  officially support React 18+/19.
- Native HTML5 drag-and-drop API — no new dependency, but requires hand-
  rolling drop-position calculation, drag-image styling, and touch-device
  support (HTML5 DnD has no native touch support), which `@dnd-kit` already
  solves.

### Shared reorder logic

A single `SortableSection` wrapper component (new, defined in
`MasterResumeForm.tsx` or extracted to `components/SortableSection.tsx` if it
grows) wraps a `DndContext` + `SortableContext` around each of the three
lists. It takes the array of items (each already has a stable `id`, e.g.
`proj.id`, `exp.id`), the field name to reorder in `resume` state, and a
render-prop for each card. On `onDragEnd`, it computes the new order with
`arrayMove(items, oldIndex, newIndex)` and calls a single generic
`reorder(field, newOrder)` setter, mirroring the existing pattern of
`setProjField`/`setExpField`/etc. — one `reorder` function parameterized by
section, not three copy-pasted ones.

### Per-card drag handle

Each card (Project, Experience, Extracurricular) gets a small grip icon
(`⠿` or a six-dot SVG icon) added to the top-left of its header row, next to
the existing top-right "Remove ×" button. `useSortable()` provides
`attributes`/`listeners` that are spread **only** onto this handle element —
not the whole card — so dragging only starts when the user grabs the handle.
All existing text inputs, textareas, and buttons inside the card keep normal
click/focus behavior, unaffected by the drag wiring.

### Visual feedback

Using `@dnd-kit`'s built-in transform/transition: the dragged card gets
reduced opacity and a subtle shadow while dragging; other cards animate to
their new position as the drop target changes. No custom animation code —
this is `@dnd-kit`'s default `CSS.Transform.toString(transform)` +
`transition` styling pattern.

### State flow

1. User grabs handle on a card, drags up/down within the same section list.
2. `DndContext.onDragEnd` fires with `active.id` / `over.id`.
3. Wrapper resolves both ids to indices in the current array, calls
   `arrayMove`, and updates `resume` state via the existing `setResume`
   pattern (spread + replace the one array field).
4. Order is visually reflected immediately (React re-render); nothing is
   sent to the backend until "Save Changes" is clicked, same as any other
   field edit.

### Testing

- Manual verification via `/run`: drag reorder within Projects, Experience,
  and Extracurriculars; confirm order persists after Save + page reload;
  confirm dragging by the handle doesn't get triggered by clicks on text
  inputs/textareas/remove buttons; confirm keyboard reorder (Tab to handle,
  Space to pick up, Arrow keys to move, Space to drop) works as a bonus
  accessibility check.
- No new automated test infra exists for this form today (no existing
  `MasterResumeForm` test file); introducing one is out of scope for this
  change, matching how add/remove entries was shipped previously.
