import { findDuplicateInList, isSameAppliedJob, normalizeJobLabel, normalizeJobUrl } from "./duplicate";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const existing = {
  company: "Vercel",
  job_title: "Software Engineer Intern",
  job_url: "https://boards.greenhouse.io/vercel/jobs/1234567",
  resume_id: "resume-1",
};

check("collapses extra spaces and case", normalizeJobLabel("  SWE   Intern ") === "swe intern");
check("strips tracking query and trailing slash",
  normalizeJobUrl("https://www.boards.greenhouse.io/vercel/jobs/1234567/?utm_source=email") ===
    "boards.greenhouse.io/vercel/jobs/1234567");
check("http vs https is the same posting",
  normalizeJobUrl("http://boards.greenhouse.io/vercel/jobs/1234567") ===
    normalizeJobUrl("https://boards.greenhouse.io/vercel/jobs/1234567/"));

check("same company + title is a duplicate",
  isSameAppliedJob(existing, { company: "vercel", jobTitle: "software engineer intern" }));
check("same URL with different title is still a duplicate",
  isSameAppliedJob(existing, {
    company: "Vercel",
    jobTitle: "SWE Intern",
    jobUrl: "https://boards.greenhouse.io/vercel/jobs/1234567?gh_jid=1234567",
  }));
check("same resume id is a duplicate",
  isSameAppliedJob(existing, { company: "Other", jobTitle: "Other", resumeId: "resume-1" }));
check("different company is not a duplicate",
  !isSameAppliedJob(existing, { company: "Stripe", jobTitle: "Software Engineer Intern" }));
check("different title at the same company is not a duplicate",
  !isSameAppliedJob(existing, { company: "Vercel", jobTitle: "Product Designer Intern" }));
check("empty incoming URL does not match on URL alone",
  !isSameAppliedJob(
    { ...existing, company: "Other Co", job_title: "Other Role" },
    { company: "Stripe", jobTitle: "SWE Intern" }
  ));

const hit = findDuplicateInList(
  [
    { company: "Stripe", job_title: "SWE Intern", job_url: null, resume_id: null },
    existing,
  ],
  { company: "Vercel", jobTitle: "Software Engineer Intern" }
);
check("finds the matching row in a list", hit === existing);

const miss = findDuplicateInList(
  [existing],
  { company: "Notion", jobTitle: "Software Engineer Intern" }
);
check("returns undefined when nothing matches", miss === undefined);

console.log(pass ? "\n✓ duplicate test PASSED" : "\n✗ duplicate test FAILED");
process.exit(pass ? 0 : 1);
