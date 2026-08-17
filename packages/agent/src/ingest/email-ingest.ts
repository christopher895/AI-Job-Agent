import {
  AppliedJobRow, StatusEventRow,
  getGmailSyncState, setGmailSyncState, isMessageProcessed, markMessageProcessed,
  listAppliedJobs, getAppliedJob, updateAppliedJob, createStatusEvent, enqueueReview,
} from "../db/queries";
import { matchApplication, MatchCandidate } from "./match";
import { isCandidateEmail, isAllowlistedSender } from "./prefilter";
import { canAdvance } from "./status-order";
import { classifyEmail } from "../ai/classify-email";
import { getGmailClient, fetchNewMessages } from "../integrations/gmail";
import { sendStatusChangeEmail } from "../notifications/email";
import { syncStatusToSheet } from "../integrations/sheets";
import { EmailMessage, ClassifiedEmail } from "./types";

export const NOTIFY_STATUSES = new Set(["assessment", "interviewing", "offer"]);
const TERMINAL_STATUSES = new Set(["rejected", "no_response"]);

export function gmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

export type IngestDeps = {
  fetch: (sinceHistoryId: string | null) => Promise<{ messages: EmailMessage[]; newHistoryId: string | null }>;
  classify: (email: EmailMessage) => Promise<ClassifiedEmail>;
  now?: () => Date;
  notify?: (app: AppliedJobRow, event: StatusEventRow) => Promise<void>;
};

function defaultDeps(): IngestDeps {
  return {
    fetch: async (sinceHistoryId) => {
      const gmail = getGmailClient();
      if (!gmail) throw new Error("Gmail client not configured (GMAIL_OAUTH_* env missing)");
      return fetchNewMessages(gmail, sinceHistoryId);
    },
    classify: classifyEmail,
    notify: (app, event) =>
      sendStatusChangeEmail(
        { company: app.company, job_title: app.job_title, id: app.id },
        { status: event.status, deadline_at: event.deadline_at, email_link: event.email_link, email_snippet: event.email_snippet }
      ),
  };
}

/** Applies a classified email to a matched application (forward-only), logs the event, syncs Sheets, notifies. */
export async function applyStatusEvent(
  app: AppliedJobRow,
  classified: ClassifiedEmail,
  email: EmailMessage,
  deps: Pick<IngestDeps, "notify">
): Promise<void> {
  const deadlineAt = classified.deadlineAt ? new Date(classified.deadlineAt) : null;
  const advance = canAdvance(app.status, classified.status);

  const event = await createStatusEvent({
    applicationId: app.id,
    status: classified.status,
    source: "email",
    deadlineAt,
    emailMessageId: email.id,
    emailSubject: email.subject,
    emailSnippet: email.snippet,
    emailLink: gmailLink(email.id),
  });

  if (!advance) return; // audit-only: out-of-order email, leave applied_jobs.status untouched

  await updateAppliedJob(app.id, { status: classified.status });
  if (app.sheets_row) {
    await syncStatusToSheet(app.sheets_row, classified.status).catch((err) =>
      console.error("[ingest] sheets sync failed:", err)
    );
  }
  if (NOTIFY_STATUSES.has(classified.status) && deps.notify) {
    await deps.notify(app, event).catch((err) => console.error("[ingest] notify failed:", err));
  }
}

export async function runEmailIngest(
  partial: Partial<IngestDeps> = {}
): Promise<{ processed: number; applied: number; queued: number }> {
  const deps: IngestDeps = { ...defaultDeps(), ...partial };
  const { history_id } = await getGmailSyncState();
  const { messages, newHistoryId } = await deps.fetch(history_id);

  let processed = 0, applied = 0, queued = 0;
  let hadError = false;

  for (const email of messages) {
    if (await isMessageProcessed(email.id)) continue;
    processed++;

    try {
      if (!isCandidateEmail(email)) { await markMessageProcessed(email.id); continue; }

      const classified = await deps.classify(email);
      if (!classified.isJobRelated || classified.status === "none") {
        await markMessageProcessed(email.id);
        continue;
      }

      // Terminal applications (rejected/no_response) are never live match candidates — a
      // later email about them must fall through to the review queue for a human decision,
      // not silently resurrect a dead application (status-order.ts guards this too).
      const candidates: MatchCandidate[] = (await listAppliedJobs())
        .filter((a) => a.status !== "rejected" && a.status !== "no_response")
        .map((a) => ({ id: a.id, company: a.company, role: a.job_title }));
      const match = matchApplication(candidates, { company: classified.company, role: classified.role });

      const app = match ? await getAppliedJob(match.applicationId) : null;
      if (app && TERMINAL_STATUSES.has(classified.status) && !isAllowlistedSender(email.fromDomain)) {
        // A random inbox message that mentions "unfortunately" must not mark an
        // application rejected. ATS/recruiting senders on the allowlist still auto-apply.
        await enqueueReview({
          emailMessageId: email.id,
          emailFrom: email.from,
          emailSubject: email.subject,
          emailSnippet: email.snippet,
          emailLink: gmailLink(email.id),
          detectedStatus: classified.status,
          detectedDeadlineAt: classified.deadlineAt ? new Date(classified.deadlineAt) : null,
          suggestedApplicationId: app.id,
          matchScore: match?.score ?? null,
        });
        queued++;
      } else if (app) {
        await applyStatusEvent(app, classified, email, deps);
        applied++;
      } else {
        // No confident match — or the matched row vanished mid-tick (deleted). Either
        // way route to the review queue rather than silently dropping the email.
        await enqueueReview({
          emailMessageId: email.id,
          emailFrom: email.from,
          emailSubject: email.subject,
          emailSnippet: email.snippet,
          emailLink: gmailLink(email.id),
          detectedStatus: classified.status,
          detectedDeadlineAt: classified.deadlineAt ? new Date(classified.deadlineAt) : null,
          suggestedApplicationId: null,
          matchScore: null,
        });
        queued++;
      }
      await markMessageProcessed(email.id);
    } catch (err) {
      hadError = true;
      console.error(`[ingest] message ${email.id} failed, leaving unprocessed for retry:`, err);
      // do NOT mark processed — a transient failure should retry next tick
    }
  }

  // The Gmail history cursor is an all-or-nothing high-water mark: advancing it past a
  // failed message would mean that message is never re-fetched. Only advance on a clean tick.
  if (newHistoryId && !hadError) {
    await setGmailSyncState(newHistoryId);
  } else if (hadError) {
    console.warn("[ingest] one or more messages failed this tick — not advancing history cursor so they retry next tick");
  }
  return { processed, applied, queued };
}
