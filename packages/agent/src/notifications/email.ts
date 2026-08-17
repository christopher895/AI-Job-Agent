import { Resend } from "resend";
import { JobListing } from "../scraper/types";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildEmailHtml(jobs: JobListing[], source: string): string {
  const appUrl = process.env.WEB_URL ?? process.env.APP_URL ?? "http://localhost:3000";

  const rows = jobs
    .map((j) => {
      const tailorUrl = `${appUrl}/tailor?jobUrl=${encodeURIComponent(j.url)}&title=${encodeURIComponent(j.title)}&company=${encodeURIComponent(j.company)}`;
      return `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #eee;">
          <a href="${escapeHtml(j.url)}" style="font-size:15px; font-weight:600; color:#1a1a1a; text-decoration:none;">
            ${escapeHtml(j.title)}
          </a>
          <div style="font-size:13px; color:#555; margin-top:4px;">${escapeHtml(j.company)}</div>
          <div style="margin-top:8px;">
            <a href="${escapeHtml(j.url)}" style="font-size:12px; color:#0066cc; margin-right:16px;">
              View job →
            </a>
            <a href="${escapeHtml(tailorUrl)}" style="font-size:12px; color:#ffffff; background:#0066cc; padding:4px 10px; border-radius:4px; text-decoration:none;">
              Tailor resume →
            </a>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:24px;">
      <h2 style="font-size:20px; margin-bottom:4px;">
        ${jobs.length} new internship${jobs.length > 1 ? "s" : ""} detected
      </h2>
      <p style="color:#666; font-size:13px; margin-top:0;">
        Found via ${escapeHtml(source)} · ${new Date().toLocaleString()}
      </p>
      <table style="width:100%; border-collapse:collapse;">
        ${rows}
      </table>
    </div>
  `;
}

/**
 * Every agent instance runs the same unconditional 15-min scrape cron, so a
 * second environment (staging, a preview deploy, a long-lived local `tsx watch`)
 * mails the *same* inbox as production. The duplicate copy is built from that
 * environment's own WEB_URL, so its "Tailor resume" link points at a web app
 * that is stale, down, or localhost — which reads as "the email link is wrong".
 *
 * Default on, so production needs no new variable; set JOB_ALERTS_ENABLED=false
 * on every environment that is not the one whose inbox you actually read.
 */
export function jobAlertsEnabled(): boolean {
  return process.env.JOB_ALERTS_ENABLED !== "false";
}

export async function sendJobEmail(jobs: JobListing[], source: string) {
  if (jobs.length === 0) return;

  if (!jobAlertsEnabled()) {
    console.log(`[email] JOB_ALERTS_ENABLED=false — skipping alert for ${jobs.length} job(s) from ${source}`);
    return;
  }

  const toEmail = process.env.YOUR_EMAIL;
  if (!toEmail) throw new Error("YOUR_EMAIL is not set");

  const subject =
    jobs.length === 1
      ? `New internship: ${jobs[0].title} at ${jobs[0].company}`
      : `${jobs.length} new internships detected`;

  const from = process.env.EMAIL_FROM ?? "Job Agent <onboarding@resend.dev>";
  await getResend().emails.send({
    from,
    to: toEmail,
    subject,
    html: buildEmailHtml(jobs, source),
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const STATUS_LABEL: Record<string, string> = {
  assessment: "OA", interviewing: "Interview", offer: "Offer",
};

/** High-signal subject that leads with the deadline when one exists. */
export function statusChangeSubject(company: string, status: string, deadlineAt: Date | null): string {
  const label = STATUS_LABEL[status] ?? status;
  if (status === "assessment" && deadlineAt) return `⚠️ OA due ${fmtDate(deadlineAt)} — ${company}`;
  if (deadlineAt) return `${label} ${fmtDate(deadlineAt)} — ${company}`;
  return `${label} — ${company}`;
}

export async function sendStatusChangeEmail(
  app: { company: string; job_title: string; id: string },
  event: { status: string; deadline_at: Date | null; email_link: string | null; email_snippet: string | null }
): Promise<void> {
  const toEmail = process.env.YOUR_EMAIL;
  if (!toEmail) throw new Error("YOUR_EMAIL is not set");
  const appUrl = process.env.WEB_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const from = process.env.EMAIL_FROM ?? "Job Agent <onboarding@resend.dev>";

  const subject = statusChangeSubject(app.company, event.status, event.deadline_at);
  const deadlineLine = event.deadline_at
    ? `<p style="font-size:14px;"><strong>Deadline:</strong> ${escapeHtml(fmtDate(event.deadline_at))}</p>` : "";
  const gmailLink = event.email_link
    ? `<a href="${escapeHtml(event.email_link)}" style="color:#0066cc;">Open email →</a>` : "";

  const html = `
    <div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:24px;">
      <h2 style="font-size:18px;">${escapeHtml(app.company)} — ${escapeHtml(app.job_title)}</h2>
      <p style="font-size:14px;">New status: <strong>${escapeHtml(event.status)}</strong></p>
      ${deadlineLine}
      ${event.email_snippet ? `<p style="color:#555; font-size:13px;">${escapeHtml(event.email_snippet)}</p>` : ""}
      <p style="margin-top:16px;">
        ${gmailLink}
        <a href="${escapeHtml(appUrl)}/applied" style="color:#0066cc; margin-left:16px;">View in tracker →</a>
      </p>
    </div>`;

  await getResend().emails.send({ from, to: toEmail, subject, html });
}
