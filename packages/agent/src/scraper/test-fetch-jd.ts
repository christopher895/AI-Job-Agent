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

// Case 6: real Responsibilities/Requirements content alongside headed Benefits,
// Equal Employment Opportunity, About [Company], and How to Apply boilerplate.
// This JD text gets sent to the LLM up to 6x per /tailor request (once per
// tailorResume + evaluate call, across up to 3 generate-critique-revise
// iterations in chain.ts), so every token of boilerplate that survives
// extraction is billed repeatedly for zero tailoring value.
{
  const html = `
<html>
<head><title>Software Engineer - Acme Corp</title></head>
<body>
<article>
<h1>Software Engineer</h1>
<h2>Responsibilities</h2>
<p>${"Build and maintain scalable backend services using Python and Kubernetes. ".repeat(6)}</p>
<h2>Requirements</h2>
<ul>
<li>5+ years of experience with distributed systems and cloud infrastructure.</li>
<li>Must be able to pass a background check for site access.</li>
</ul>
<h2>Benefits</h2>
<ul>
<li>Comprehensive health, dental, and vision insurance for you and your family.</li>
<li>Generous 401k match and unlimited PTO policy for all full-time employees.</li>
</ul>
<h2>About Acme Corp</h2>
<p>${"Acme Corp is a leading provider of cloud infrastructure solutions trusted by Fortune 500 companies worldwide. ".repeat(3)}</p>
<h2>How to Apply</h2>
<p>Submit your resume and cover letter through our careers portal to be considered for this position.</p>
<h2>Equal Employment Opportunity</h2>
<p>Acme Corp is proud to be an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, religion, color, sex, national origin, or veteran status.</p>
</article>
</body>
</html>`;
  const url = "https://acmecorp.com/careers/software-engineer";
  const result = extractFromHtml(html, url);

  console.log("[boilerplate-strip] text length:", result.text.length);

  check("boilerplate-strip", result.text.includes("Python and Kubernetes"), "Responsibilities content was stripped");
  check(
    "boilerplate-strip",
    result.text.includes("Must be able to pass a background check"),
    "short in-list requirement bullet was wrongly stripped alongside its longer sibling"
  );
  check("boilerplate-strip", !result.text.includes("401k"), "Benefits section leaked into extracted JD");
  check("boilerplate-strip", !result.text.includes("Fortune 500"), "About [Company] section leaked into extracted JD");
  check("boilerplate-strip", !result.text.includes("cover letter"), "How to Apply section leaked into extracted JD");
  check(
    "boilerplate-strip",
    !result.text.includes("equal opportunity employer"),
    "Equal Employment Opportunity section leaked into extracted JD"
  );
}

// Case 7: pseudo-heading — many ATS templates render section titles as
// <p><strong>Benefits</strong></p> instead of a real <h2>. Must still be
// recognized and dropped.
{
  const html = `
<html><head><title>Backend Engineer - Acme</title></head>
<body><article>
<h1>Backend Engineer</h1>
<p>${"Design and operate backend services at scale for millions of users. ".repeat(6)}</p>
<p><strong>Benefits</strong></p>
<p>${"We offer health insurance, a 401k match, unlimited PTO, and remote-first work. ".repeat(3)}</p>
</article></body></html>`;
  const url = "https://acme.com/careers/backend-engineer";
  const result = extractFromHtml(html, url);

  check(
    "pseudo-heading",
    result.text.includes("Design and operate backend"),
    "real job content was stripped alongside the pseudo-heading section"
  );
  check("pseudo-heading", !result.text.includes("401k"), "pseudo-heading Benefits section was not recognized/dropped");
}

// Case 8: "About the Role" is real job content (team mission, what you'll
// work on), not a company blurb — must NOT be caught by the "About ..."
// boilerplate match. Only "About [Company]" (using the company name already
// resolved by extractTitleCompany) should be stripped.
{
  const html = `
<html><head><title>Engineer - Acme Corp</title></head>
<body><article>
<h1>Engineer</h1>
<h2>About the Role</h2>
<p>${"You will own the payments infrastructure team and drive reliability improvements across our checkout stack. ".repeat(4)}</p>
<h2>About Acme Corp</h2>
<p>${"Acme Corp is a leading provider of cloud infrastructure solutions trusted by Fortune 500 companies worldwide. ".repeat(3)}</p>
</article></body></html>`;
  const url = "https://acmecorp.com/careers/engineer";
  const result = extractFromHtml(html, url);

  check(
    "about-the-role",
    result.text.includes("payments infrastructure team"),
    "'About the Role' content was wrongly treated as company-blurb boilerplate"
  );
  check("about-the-role", !result.text.includes("Fortune 500"), "'About Acme Corp' company blurb was not stripped");
}

// Case 9: headerless boilerplate paragraph — the EEO statement is often
// appended with no heading at all. Must still be stripped by content
// signature, independent of the heading-based removal state machine.
{
  const html = `
<html><head><title>Engineer - Acme Corp</title></head>
<body><article>
<h1>Engineer</h1>
<h2>Requirements</h2>
<p>${"Own the reliability of our payment processing pipeline end to end. ".repeat(5)}</p>
<p>Acme Corp is proud to be an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, religion, color, sex, national origin, or veteran status.</p>
</article></body></html>`;
  const url = "https://acmecorp.com/careers/engineer-2";
  const result = extractFromHtml(html, url);

  check("headerless-eeo", result.text.includes("payment processing pipeline"), "Requirements content was stripped");
  check(
    "headerless-eeo",
    !result.text.includes("equal opportunity employer"),
    "headerless EEO paragraph was not stripped"
  );
}

console.log(allPass ? "\n✓ fetch-jd extraction test PASSED" : "\n✗ fetch-jd extraction test FAILED");
process.exit(allPass ? 0 : 1);
