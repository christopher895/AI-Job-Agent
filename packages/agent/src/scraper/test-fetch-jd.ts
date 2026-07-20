import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromHtml } from "./fetch-jd";

let allPass = true;

function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    allPass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

// Case 1: Bank of America tal.net page — title tag contains "<h1 text> - <company>",
// company must come from the title heuristic, not the tal.net ATS domain.
{
  const html = readFileSync(join(__dirname, "test-fixtures", "bofa-job.html"), "utf-8");
  const url =
    "https://bankcampuscareers.tal.net/vx/lang-en-GB/mobile-0/brand-4/user-5282441/candidate/so/pm/1/pl/1/opp/14418-Global-Technology-Summer-Analyst-2027-Software-Engineer-and-Mainframe-Analyst/en-GB";
  const result = extractFromHtml(html, url);

  console.log("[bofa] title:", result.title);
  console.log("[bofa] company:", result.company);
  console.log("[bofa] text length:", result.text.length);

  check("bofa", !result.text.includes("Strictly Necessary cookies"), "cookie banner text leaked into extracted JD");
  check("bofa", !result.text.toLowerCase().includes("googletagmanager"), "GTM/analytics noise leaked into extracted JD");
  check("bofa", result.text.includes("mainframe environment is the third largest"), "missing expected job description content");
  check(
    "bofa",
    result.title === "Global Technology Summer Analyst 2027 - Software Engineer and Mainframe Analyst",
    `title mismatch: got ${JSON.stringify(result.title)}`
  );
  check("bofa", result.company === "Bank of America", `company mismatch: got ${JSON.stringify(result.company)}`);
}

// Case 2: Optiver page — <title> has no separator/company at all, so company
// must fall back to the URL's registrable domain ("optiver.com" -> "Optiver").
{
  const html = readFileSync(join(__dirname, "test-fixtures", "optiver-job.html"), "utf-8");
  const url =
    "https://www.optiver.com/join-us/jobs/technology/chicago/software-engineer-intern-summer-2027-chicago/";
  const result = extractFromHtml(html, url);

  console.log("[optiver] title:", result.title);
  console.log("[optiver] company:", result.company);
  console.log("[optiver] text length:", result.text.length);

  check(
    "optiver",
    result.title === "Software Engineer Intern (Summer 2027 - Chicago)",
    `title mismatch: got ${JSON.stringify(result.title)}`
  );
  check("optiver", result.company === "Optiver", `company mismatch: got ${JSON.stringify(result.company)}`);
  check("optiver", result.text.length > 200, "extracted text too short");
}

// Case 3: synthetic ATS-hosted page with no title separator — must NOT guess
// a company from the ATS vendor's own domain (e.g. "greenhouse.io" -> "Greenhouse").
{
  const html = `<html><head><title>Backend Engineer</title></head>
    <body><h1>Backend Engineer</h1><main>${"Build backend systems at scale. ".repeat(20)}</main></body></html>`;
  const url = "https://boards.greenhouse.io/somecompany/jobs/12345";
  const result = extractFromHtml(html, url);

  console.log("[ats-host] title:", result.title);
  console.log("[ats-host] company:", result.company);

  check("ats-host", result.company === undefined, `expected no company guess, got ${JSON.stringify(result.company)}`);
}

// Case 4: Jobright.ai job detail page — real <title> format is
// "{Job Title} @ {Employer} | Jobright.ai". Jobright is a job discovery
// platform a user might paste a link from, not the employer, so its brand
// must never end up in `title` or `company`.
{
  const html = `<html><head><title>Artificial Intelligence Specialist @ RTX | Jobright.ai</title></head>
    <body><main>${"Design and build AI systems for aerospace applications. ".repeat(20)}</main></body></html>`;
  const url = "https://jobright.ai/jobs/info/6924d9adc0cefa13343e2b06";
  const result = extractFromHtml(html, url);

  console.log("[jobright-with-company] title:", result.title);
  console.log("[jobright-with-company] company:", result.company);

  check(
    "jobright-with-company",
    result.title === "Artificial Intelligence Specialist",
    `title mismatch: got ${JSON.stringify(result.title)}`
  );
  check("jobright-with-company", result.company === "RTX", `company mismatch: got ${JSON.stringify(result.company)}`);
}

// Case 5: Jobright.ai listing with no "@ Employer" segment in the title —
// must not fall back to "Jobright.ai" as the company.
{
  const html = `<html><head><title>Junior Software Engineer | Jobright.ai</title></head>
    <body><main>${"Build and ship product features end to end. ".repeat(20)}</main></body></html>`;
  const url = "https://jobright.ai/jobs/info/b2b_1770936109040_2";
  const result = extractFromHtml(html, url);

  console.log("[jobright-no-company] title:", result.title);
  console.log("[jobright-no-company] company:", result.company);

  check(
    "jobright-no-company",
    result.title === "Junior Software Engineer",
    `title mismatch: got ${JSON.stringify(result.title)}`
  );
  check(
    "jobright-no-company",
    result.company === undefined,
    `expected no company guess, got ${JSON.stringify(result.company)}`
  );
}

console.log(allPass ? "\n✓ fetch-jd extraction test PASSED" : "\n✗ fetch-jd extraction test FAILED");
process.exit(allPass ? 0 : 1);
