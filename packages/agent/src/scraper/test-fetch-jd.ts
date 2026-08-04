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

// Case 10: title's trailing segment is a cohort/program label ("2027
// Summer"), not a company — happens on pages with no <h1> at all (common on
// client-rendered career microsites) so the h1-based branch never applies.
// Must not mistake the cohort label for the company; must fall back to the
// URL's registrable domain instead.
{
  const html = `<html><head><title>Software Engineer Intern (Acme - Widgets Team) - 2027 Summer</title></head>
    <body><main>${"Build widget rendering pipelines used by millions of people. ".repeat(20)}</main></body></html>`;
  const url = "https://lifeatacme.com/jobs/123";
  const result = extractFromHtml(html, url);

  console.log("[cohort-label] title:", result.title);
  console.log("[cohort-label] company:", result.company);

  check(
    "cohort-label",
    result.title === "Software Engineer Intern (Acme - Widgets Team)",
    `title mismatch: got ${JSON.stringify(result.title)}`
  );
  check("cohort-label", result.company === "Acme", `company mismatch: got ${JSON.stringify(result.company)}`);
}

// Case 11: no schema.org JobPosting block, so location must come from a bare
// "Location:" label/value pair in the DOM — the common pattern on
// custom-built career microsites that don't emit structured data.
{
  const html = `<html><head><title>Engineer - Acme</title></head>
    <body><article>
    <div class="flex"><p class="font-bold">Location:</p><p>Austin</p></div>
    <main>${"Build widget rendering pipelines used by millions of people. ".repeat(20)}</main>
    </article></body></html>`;
  const url = "https://acme.com/careers/engineer";
  const result = extractFromHtml(html, url);

  console.log("[label-location] location:", result.location);
  check("label-location", result.location === "Austin", `location mismatch: got ${JSON.stringify(result.location)}`);
}

// Case 12: flat, non-semantic div layout (no <article>, no heading tags) —
// the pattern on custom-built React/Next.js career microsites. Readability's
// content-scoring can pick the wrong container and exclude the real JD
// section (single giant <p> scores lower than a company-blurb block with
// many short <p>s); the page's nav menu also isn't wrapped in <nav> so
// NOISE_SELECTORS can't remove it structurally. Both must still be handled:
// full JD content recovered, nav link text excluded, boilerplate stripped.
{
  const navLinks = Array.from({ length: 40 }, (_, i) => `<a href="/l${i}">Link${i}</a>`).join("");
  const html = `
<html><head><title>Software Engineer Intern (Acme - Widgets Team) - 2027 Summer</title></head>
<body>
<div>${navLinks}</div>
<div>
  <p class="font-bold">Location:</p><p>Austin</p>
  <p style="font-weight:700">Responsibilities</p>
  <p style="white-space:pre-line">${"Design and build the widget rendering pipeline used by millions of users every day. ".repeat(
    8
  )}Minimum Qualifications: currently pursuing a degree in CS.</p>
</div>
<div>
  <p>About Acme</p>
  <p>${"Acme is a leading provider of enterprise widgets trusted by Fortune 500 companies worldwide. ".repeat(4)}</p>
  <p>Why Join Us</p>
  <p>${"We offer a fun and inclusive culture where everyone can do their best work every day. ".repeat(4)}</p>
</div>
</body></html>`;
  const url = "https://lifeatacme.com/jobs/123";
  const result = extractFromHtml(html, url);

  console.log("[flat-spa] company:", result.company, "location:", result.location, "text length:", result.text.length);

  check("flat-spa", result.company === "Acme", `company mismatch: got ${JSON.stringify(result.company)}`);
  check("flat-spa", result.location === "Austin", `location mismatch: got ${JSON.stringify(result.location)}`);
  check("flat-spa", result.text.includes("widget rendering pipeline"), "real JD content was excluded");
  check("flat-spa", result.text.includes("Minimum Qualifications"), "Minimum Qualifications content was excluded");
  check("flat-spa", !result.text.includes("Fortune 500"), "About [Company] blurb leaked into extracted JD");
  check("flat-spa", !result.text.includes("Link0"), "nav link text leaked into extracted JD");
}

// Case 13: a short, bare (non-bold) mid-section lead-in label — e.g. "For Los
// Angeles County (unincorporated) Candidates:" ahead of a Fair Chance Act
// disclosure — must NOT be mistaken for a new section heading. It matches
// neither the boilerplate blacklist nor a known JD heading, so treating it
// as heading-like would reset the active "Job Information" boilerplate drop
// and let the disclosure text right after it leak through.
{
  const html = `
<html><head><title>Engineer - Acme</title></head>
<body><article>
<h1>Engineer</h1>
<h2>Responsibilities</h2>
<p>${"Own the reliability of our payment processing pipeline end to end. ".repeat(5)}</p>
<p>Job Information</p>
<p>${"Compensation for this role varies by location and experience level and is reviewed annually. ".repeat(
    3
  )}</p>
<p>For Los Angeles County (unincorporated) Candidates:</p>
<p>Qualified applicants with arrest or conviction records will be considered for employment in accordance with the Los Angeles County Fair Chance Ordinance for Employers and the California Fair Chance Act.</p>
</article></body></html>`;
  const url = "https://acmecorp.com/careers/engineer-3";
  const result = extractFromHtml(html, url);

  check("mid-section-label", result.text.includes("payment processing pipeline"), "Responsibilities content was stripped");
  check(
    "mid-section-label",
    !result.text.includes("Compensation for this role"),
    "Job Information/compensation section was not stripped"
  );
  check(
    "mid-section-label",
    !result.text.includes("Fair Chance"),
    "Fair Chance Act disclosure leaked through after the mid-section label reset the drop"
  );
}

console.log(allPass ? "\n✓ fetch-jd extraction test PASSED" : "\n✗ fetch-jd extraction test FAILED");
process.exit(allPass ? 0 : 1);
