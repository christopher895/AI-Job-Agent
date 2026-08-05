"use client";
import { useEffect, useState } from "react";
import { api, ReviewItem, AppliedJob } from "../lib/api";

export default function ReviewPanel({ applications }: { applications: AppliedJob[] }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listReviews().then(setItems).catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  async function confirm(id: string, applicationId: string) {
    if (!applicationId) return;
    setBusy(id);
    try {
      await api.confirmReview(id, applicationId);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  }
  async function dismiss(id: string) {
    setBusy(id);
    try {
      await api.dismissReview(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-8 rounded-xl border border-amber-300/70 bg-amber-50 p-4">
      <h2 className="font-serif text-lg text-amber-900 mb-3">Needs review ({items.length})</h2>
      <ul className="space-y-3">
        {items.map((it) => (
          <ReviewRow
            key={it.id}
            item={it}
            applications={applications}
            busy={busy === it.id}
            onConfirm={confirm}
            onDismiss={dismiss}
          />
        ))}
      </ul>
    </div>
  );
}

function ReviewRow({
  item,
  applications,
  busy,
  onConfirm,
  onDismiss,
}: {
  item: ReviewItem;
  applications: AppliedJob[];
  busy: boolean;
  onConfirm: (id: string, applicationId: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [selected, setSelected] = useState(item.suggested_application_id ?? "");
  return (
    <li className="rounded-lg border border-amber-200 bg-paper p-3 text-sm">
      <div className="font-medium text-paper-ink">{item.email_subject || "(no subject)"}</div>
      <div className="text-xs text-paper-muted">{item.email_from}</div>
      {item.email_snippet && <p className="mt-1 text-paper-muted">{item.email_snippet}</p>}
      <div className="mt-1 text-xs text-paper-muted">
        Detected: <strong className="text-paper-ink">{item.detected_status ?? "?"}</strong>
        {item.detected_deadline_at
          ? ` · deadline ${new Date(item.detected_deadline_at).toLocaleDateString()}`
          : ""}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border border-paper-border bg-paper px-2 py-1 text-sm text-paper-ink"
        >
          <option value="">Match to application…</option>
          {applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.company} — {a.job_title}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !selected}
          onClick={() => onConfirm(item.id, selected)}
          className="rounded bg-violet-600 px-3 py-1 text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          disabled={busy}
          onClick={() => onDismiss(item.id)}
          className="px-3 py-1 text-paper-muted hover:text-paper-ink"
        >
          Dismiss
        </button>
        {item.email_link && (
          <a
            href={item.email_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-700 hover:text-violet-900"
          >
            Open email →
          </a>
        )}
      </div>
    </li>
  );
}
