"use client";
import { useMemo, useState } from "react";
import { api, Suggestion } from "../lib/api";

type Item = Suggestion & { accepted: boolean };

type DiffToken = { text: string; type: "same" | "removed" | "added" };

/**
 * Word-level LCS diff between the master's original bullet and the current
 * (possibly hand-edited) proposed text — lets the checklist show exactly
 * what changed instead of two separate blobs of text to compare by eye.
 * Whitespace runs are kept as their own tokens (via the capturing split) so
 * spacing survives round-tripping through the diff unchanged.
 */
function wordDiff(before: string, after: string): DiffToken[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ text: a[i], type: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: a[i], type: "removed" });
      i++;
    } else {
      tokens.push({ text: b[j], type: "added" });
      j++;
    }
  }
  while (i < n) {
    tokens.push({ text: a[i], type: "removed" });
    i++;
  }
  while (j < m) {
    tokens.push({ text: b[j], type: "added" });
    j++;
  }
  return tokens;
}

function WordDiff({ before, after }: { before: string; after: string }) {
  const tokens = useMemo(() => wordDiff(before, after), [before, after]);
  if (before === after) return null;
  return (
    <p className="text-xs leading-relaxed mb-1.5 whitespace-pre-wrap">
      {tokens.map((t, i) =>
        t.type === "removed" ? (
          <span key={i} className="text-red-500 line-through">
            {t.text}
          </span>
        ) : t.type === "added" ? (
          <span key={i} className="text-green-700 underline decoration-green-400">
            {t.text}
          </span>
        ) : (
          <span key={i} className="text-paper-muted">
            {t.text}
          </span>
        )
      )}
    </p>
  );
}

export default function SuggestionChecklist({
  resumeId,
  suggestions,
  onApplied,
}: {
  resumeId: string;
  suggestions: Suggestion[];
  onApplied: () => void;
}) {
  const [items, setItems] = useState<Item[]>(suggestions.map((s) => ({ ...s, accepted: false })));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, accepted: !it.accepted } : it)));
  }

  function editText(id: string, text: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, suggestedText: text } : it)));
  }

  async function apply() {
    setSubmitting(true);
    setError(null);
    try {
      const accepted = items.filter((it) => it.accepted);
      await api.applySuggestions(resumeId, accepted);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply suggestions.");
      setSubmitting(false);
    }
  }

  const acceptedCount = items.filter((it) => it.accepted).length;

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-paper-muted max-w-sm">
          No keyword suggestions found for this job description — your resume already covers it well.
        </p>
        <button
          onClick={apply}
          disabled={submitting}
          className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? "Continuing…" : "Continue with resume as-is"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-6 pt-6 pb-2 flex-shrink-0">
        <p className="text-sm text-paper-muted">
          Review each suggested change before it&apos;s applied. Nothing here is final — uncheck
          anything you don&apos;t want, or edit the wording directly.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="flex flex-col gap-3">
          {items.map((it) => (
            <label
              key={it.id}
              className="flex gap-3 border border-paper-border rounded-xl p-3 bg-paper hover:border-violet-300 transition-colors cursor-pointer"
            >
              <input type="checkbox" checked={it.accepted} onChange={() => toggle(it.id)} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-paper-ink">{it.keyword}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      it.groundedness === "grounded"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {it.groundedness}
                  </span>
                </div>
                {it.kind === "bullet-rewrite" ? (
                  <>
                    {it.originalText && <WordDiff before={it.originalText} after={it.suggestedText} />}
                    <textarea
                      value={it.suggestedText}
                      onChange={(e) => editText(it.id, e.target.value)}
                      rows={2}
                      onClick={(e) => e.preventDefault()}
                      className="w-full text-sm font-mono border border-paper-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                    />
                  </>
                ) : (
                  <p className="text-sm font-medium text-paper-ink">
                    Add &quot;{it.suggestedText}&quot; to {it.targetId}
                  </p>
                )}
                <p className="text-xs text-paper-muted mt-1">{it.rationale}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 py-4 border-t border-paper-border flex-shrink-0">
        <button
          onClick={apply}
          disabled={submitting}
          className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? "Applying…" : `Apply ${acceptedCount} selected`}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
