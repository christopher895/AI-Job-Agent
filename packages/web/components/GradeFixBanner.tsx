"use client";
import { useState } from "react";
import type { Handoff } from "../lib/gradeFixes";

/** Shown on /resume/master after "Apply N to master resume" on a grade. */
export default function GradeFixBanner({
  appliedCount,
  sections,
  skipped,
  todos,
  saved,
  onDiscard,
  onRegrade,
  onClose,
  regrading,
  regradeError,
}: {
  appliedCount: number;
  /** Sections holding the applied bullets — the editor shows one section at a time. */
  sections: string[];
  skipped: number;
  todos: Handoff["todos"];
  saved: boolean;
  onDiscard: () => void;
  onRegrade: () => void;
  onClose: () => void;
  regrading: boolean;
  regradeError: string | null;
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const openTodos = todos.map((t, i) => ({ t, i })).filter(({ i }) => !dismissed.has(i));

  return (
    <div className="mx-8 mb-4 border border-violet-200 bg-violet-50/60 rounded-xl px-4 py-3 text-sm text-paper-ink">
      <div className="flex flex-wrap items-center gap-3">
        {saved ? (
          <>
            <span><strong>Saved.</strong> See how the score moved:</span>
            <button
              onClick={onRegrade}
              disabled={regrading}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
            >
              {regrading ? "Starting…" : "Re-grade"}
            </button>
            <button onClick={onClose} className="ml-auto text-paper-muted hover:text-paper-ink" title="Close">×</button>
          </>
        ) : (
          <>
            <span>
              <strong>{appliedCount} fix{appliedCount === 1 ? "" : "es"} from your grade applied</strong>
              {appliedCount > 0
                ? ` — review the highlighted bullets in ${sections.join(", ")}, then Save Changes.`
                : "."}
            </span>
            <button
              onClick={onDiscard}
              className="text-xs px-3 py-1.5 rounded-lg border border-paper-border bg-white hover:bg-black/5"
            >
              Discard
            </button>
          </>
        )}
      </div>
      {!saved && skipped > 0 && (
        <p className="text-xs text-amber-800 mt-1">
          {skipped} skipped because that bullet had already changed — re-open the grade to redo {skipped === 1 ? "it" : "them"}.
        </p>
      )}
      {regradeError && <p className="text-xs text-red-700 mt-1">{regradeError}</p>}
      {openTodos.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-paper-muted mb-1.5">To do by hand</p>
          <ul className="space-y-2">
            {openTodos.map(({ t, i }) => (
              <li key={i} className="flex items-start gap-2 bg-white border border-paper-border rounded-lg px-3 py-2">
                <div className="flex-1">
                  <p className="font-medium">
                    {t.title} <span className="text-xs font-normal text-paper-muted">· {t.category}</span>
                  </p>
                  <p className="text-xs text-paper-muted mt-0.5">{t.problem}</p>
                  {t.rewrite && <p className="text-xs mt-1"><span className="text-paper-muted">Suggestion:</span> {t.rewrite}</p>}
                </div>
                <button
                  onClick={() => setDismissed((prev) => new Set(prev).add(i))}
                  className="text-paper-muted hover:text-paper-ink"
                  title="Done"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
