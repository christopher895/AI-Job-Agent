"use client";
import { useEffect, useState } from "react";
import type { Grade } from "../lib/api";
import { SPECIALIST_STEPS, pendingActions } from "../lib/grade";

export default function GradeProgress({ grade, onCancel, onRerun, busy }: {
  grade: Grade; onCancel: () => void; onRerun: () => void; busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.round((now - new Date(grade.created_at).getTime()) / 1000));
  const { canRerun: stale } = pendingActions(grade, now);

  return (
    <div className="border border-paper-border rounded-xl bg-white p-6 max-w-xl">
      <p className="text-sm text-gray-500 mb-4">
        Five reviewers are reading your resume — usually two to three minutes. {elapsed}s elapsed.
      </p>
      <ul className="space-y-3">
        {SPECIALIST_STEPS.map((s) => {
          const status = grade.specialists[s.name]?.status ?? "pending";
          return (
            <li key={s.name} className="flex items-center gap-3">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                  status === "done" ? "bg-green-100 text-green-700"
                  : status === "failed" ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-400 animate-pulse"
                }`}
              >
                {status === "done" ? "✓" : status === "failed" ? "!" : "•"}
              </span>
              <span className="text-sm text-paper-ink font-medium">{s.label}</span>
              <span className="text-sm text-gray-500">{s.detail}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex gap-2">
        {stale && (
          <>
            <p className="text-sm text-gray-500 self-center mr-2">This grade looks stuck (the server may have restarted).</p>
            <button onClick={onRerun} disabled={busy}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              Re-run
            </button>
          </>
        )}
        <button onClick={onCancel} disabled={busy}
          className="text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] disabled:opacity-50 text-paper-ink">
          {busy ? "Working…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
