import { jobAlertsEnabled, sendJobEmail } from "./email";
import { JobListing } from "../scraper/types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.JOB_ALERTS_ENABLED;
  if (value === undefined) delete process.env.JOB_ALERTS_ENABLED;
  else process.env.JOB_ALERTS_ENABLED = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.JOB_ALERTS_ENABLED;
    else process.env.JOB_ALERTS_ENABLED = prev;
  }
}

// Production sets no such variable — alerts must stay on by default.
withEnv(undefined, () => check("unset → enabled", jobAlertsEnabled() === true));
withEnv("false", () => check("\"false\" → disabled", jobAlertsEnabled() === false));
withEnv("true", () => check("\"true\" → enabled", jobAlertsEnabled() === true));
// Only the exact string disables; a typo must not silently mute production.
withEnv("0", () => check("\"0\" → enabled (only \"false\" mutes)", jobAlertsEnabled() === true));

const job: JobListing = {
  title: "Software Engineer Intern",
  company: "Notion",
  url: "https://jobs.ashbyhq.com/notion/abc",
} as JobListing;

// The gate must short-circuit before the env-var checks — a muted environment
// should return quietly, not throw "RESEND_API_KEY is not set".
const prevKey = process.env.RESEND_API_KEY;
const prevTo = process.env.YOUR_EMAIL;
delete process.env.RESEND_API_KEY;
delete process.env.YOUR_EMAIL;
process.env.JOB_ALERTS_ENABLED = "false";

sendJobEmail([job], "test")
  .then(() => check("disabled → returns without sending or throwing", true))
  .catch((err) => check(`disabled → returns without sending or throwing (threw: ${err.message})`, false))
  .finally(() => {
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    if (prevTo !== undefined) process.env.YOUR_EMAIL = prevTo;
    delete process.env.JOB_ALERTS_ENABLED;
    console.log(pass ? "\n✓ job-alerts-gate test PASSED" : "\n✗ job-alerts-gate test FAILED");
    process.exit(pass ? 0 : 1);
  });
