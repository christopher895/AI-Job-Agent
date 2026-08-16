"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApplicationAnswer, ApplicationAnswersState } from "../lib/api";

export default function ApplicationAnswers({
  resumeId,
  initial,
  hasJd,
  company,
}: {
  resumeId: string;
  initial: ApplicationAnswersState | null;
  hasJd: boolean;
  company: string;
}) {
  const [open, setOpen] = useState(() => Boolean(initial?.items.length || initial?.status === "failed"));
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [state, setState] = useState<ApplicationAnswersState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generating = state?.status === "generating";

  useEffect(() => {
    if (!generating) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await api.getResume(resumeId);
        if (cancelled) return;
        const next = fresh.application_answers ?? null;
        if (!next || next.status === "generating") return;
        setState(next);
        if (next.prompt) setPrompt(next.prompt);
        if (next.status === "failed") setError(next.error);
      } catch {
        // transient — keep polling
      }
    };
    const interval = setInterval(tick, 4000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [generating, resumeId]);

  async function handleGenerate() {
    const text = prompt.trim();
    if (!text || generating) return;
    setError(null);
    setOpen(true);
    try {
      await api.generateAnswers(resumeId, text);
      setState((prev) => ({
        status: "generating",
        prompt: text,
        items: prev?.items ?? [],
        error: null,
        generated_at: prev?.generated_at ?? null,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start generation.");
    }
  }

  const persistItems = useCallback(
    (items: ApplicationAnswer[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        api.patchApplicationAnswers(resumeId, items).catch(() => {
          // leave the local edit; they can still copy
        });
      }, 600);
    },
    [resumeId]
  );

  function updateAnswer(id: string, answer: string) {
    setState((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) => (item.id === id ? { ...item, answer } : item));
      persistItems(items);
      return { ...prev, items };
    });
  }

  async function copyAnswer(item: ApplicationAnswer) {
    try {
      await navigator.clipboard.writeText(item.answer);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    } catch {
      setError("Could not copy — select the text and copy manually.");
    }
  }

  const label = company ? `Application answers for ${company}` : "Application answers";

  return (
    <div className="border-b border-paper-border flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-2.5 flex items-center justify-between text-left hover:bg-black/[0.02] transition-colors"
      >
        <span className="text-xs font-medium text-paper-ink">{label}</span>
        <span className="text-[11px] text-paper-muted">
          {generating
            ? "Drafting…"
            : state?.items.length
              ? `${state.items.length} draft${state.items.length === 1 ? "" : "s"}`
              : "Paste questions"}
          <span className="ml-2">{open ? "▴" : "▾"}</span>
        </span>
      </button>

      {open && (
        <div className="px-6 pb-4 flex flex-col gap-3">
          <p className="text-[11px] text-paper-muted">
            Paste the questions from the application form. Drafts use this job&apos;s description and
            your master resume. Edit anything that sounds off, then copy into the form.
          </p>

          {!hasJd && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              This resume has no stored job description, so answers would be generic. Generate it from
              /tailor with a JD first.
            </p>
          )}

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            rows={5}
            placeholder={"Tell us about a project you built on your own initiative…\n\nWhy are you interested in this role?"}
            className="w-full resize-y min-h-[6rem] text-sm leading-relaxed text-paper-ink bg-paper border border-paper-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-60"
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!hasJd || generating || !prompt.trim()}
              className="text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {generating ? "Drafting…" : state?.items.length ? "Regenerate drafts" : "Generate drafts"}
            </button>
            {generating && (
              <span className="text-[11px] text-paper-muted">Usually under a minute. This updates on its own.</span>
            )}
          </div>

          {error && <p className="text-[11px] text-red-600">{error}</p>}

          {state?.items.map((item) => (
            <div key={item.id} className="border border-paper-border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium text-paper-ink leading-relaxed">{item.question}</p>
                <button
                  type="button"
                  onClick={() => copyAnswer(item)}
                  className="flex-shrink-0 text-[11px] text-violet-700 hover:text-violet-900 border border-violet-200 hover:border-violet-400 px-2 py-1 rounded-md transition-colors"
                >
                  {copiedId === item.id ? "Copied" : "Copy"}
                </button>
              </div>
              <textarea
                value={item.answer}
                onChange={(e) => updateAnswer(item.id, e.target.value)}
                disabled={generating}
                rows={5}
                className="w-full resize-y text-sm leading-relaxed text-paper-ink bg-paper border border-transparent hover:border-paper-border focus:border-paper-border rounded px-1 -mx-1 focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-60"
              />
              <span className="text-[10px] text-paper-muted">
                {item.answer.trim() ? item.answer.trim().split(/\s+/).length : 0} words
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
