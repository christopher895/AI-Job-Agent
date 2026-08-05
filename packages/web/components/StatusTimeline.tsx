import { StatusEvent } from "../lib/api";

export default function StatusTimeline({ events }: { events: StatusEvent[] }) {
  if (!events || events.length === 0) {
    return <div className="text-xs text-paper-muted/70">No history yet.</div>;
  }
  return (
    <ol className="space-y-1">
      {events.map((e) => (
        <li key={e.id} className="flex items-center gap-2 text-xs text-paper-muted">
          <span className="font-medium capitalize text-paper-ink">{e.status}</span>
          <span className="text-paper-muted/70">{new Date(e.occurred_at).toLocaleDateString()}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              e.source === "email" ? "bg-violet-100 text-violet-700" : "bg-black/[0.05] text-paper-muted"
            }`}
          >
            {e.source}
          </span>
          {e.deadline_at && (
            <span className="text-amber-700">due {new Date(e.deadline_at).toLocaleDateString()}</span>
          )}
          {e.email_link && (
            <a
              href={e.email_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-700 hover:text-violet-900"
            >
              email →
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
