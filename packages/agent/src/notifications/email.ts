import { Resend } from "resend";
import { JobListing } from "../scraper/playwright";

const resend = new Resend(process.env.RESEND_API_KEY);

function buildEmailHtml(jobs: JobListing[]): string {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const rows = jobs
    .map((j) => {
      const tailorUrl = `${appUrl}/tailor?jobUrl=${encodeURIComponent(j.url)}&title=${encodeURIComponent(j.title)}&company=${encodeURIComponent(j.company)}`;
      return `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #eee;">
          <a href="${j.url}" style="font-size:15px; font-weight:600; color:#1a1a1a; text-decoration:none;">
            ${j.title}
          </a>
          <div style="font-size:13px; color:#555; margin-top:4px;">${j.company}</div>
          <div style="margin-top:8px;">
            <a href="${j.url}" style="font-size:12px; color:#0066cc; margin-right:16px;">
              View job →
            </a>
            <a href="${tailorUrl}" style="font-size:12px; color:#ffffff; background:#0066cc; padding:4px 10px; border-radius:4px; text-decoration:none;">
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
        Found via Jobright · ${new Date().toLocaleString()}
      </p>
      <table style="width:100%; border-collapse:collapse;">
        ${rows}
      </table>
    </div>
  `;
}

export async function sendJobEmail(jobs: JobListing[]) {
  if (jobs.length === 0) return;

  const subject =
    jobs.length === 1
      ? `New internship: ${jobs[0].title} at ${jobs[0].company}`
      : `${jobs.length} new internships detected`;

  await resend.emails.send({
    from: "Job Agent <onboarding@resend.dev>",
    to: process.env.YOUR_EMAIL!,
    subject,
    html: buildEmailHtml(jobs),
  });
}
