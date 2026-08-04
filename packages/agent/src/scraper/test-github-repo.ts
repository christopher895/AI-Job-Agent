import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseListingsJson, parseRepoUrl } from "./adapters/github-repo";

let failed = false;

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failed = true;
  } else {
    console.log(`✓ ${label}`);
  }
}

assertEqual(
  parseRepoUrl("https://github.com/vanshb03/Summer2027-Internships"),
  { owner: "vanshb03", repo: "Summer2027-Internships" },
  "parseRepoUrl: full https URL"
);
assertEqual(
  parseRepoUrl("https://github.com/vanshb03/Summer2027-Internships/"),
  { owner: "vanshb03", repo: "Summer2027-Internships" },
  "parseRepoUrl: trailing slash"
);
assertEqual(
  parseRepoUrl("vanshb03/Summer2027-Internships"),
  { owner: "vanshb03", repo: "Summer2027-Internships" },
  "parseRepoUrl: owner/repo shorthand"
);
assertEqual(parseRepoUrl("not a url"), null, "parseRepoUrl: malformed input returns null");

const fixture = readFileSync(join(__dirname, "test-fixtures", "listings-sample.json"), "utf-8");
const jobs = parseListingsJson(fixture);

assertEqual(jobs.length, 2, "parseListingsJson: keeps only active + visible entries");
assertEqual(
  jobs[0],
  {
    title: "Software Engineer Intern",
    company: "Rippling",
    location: "New York, NY, San Francisco, CA",
    url: "https://ats.rippling.com/jobs/abc123",
  },
  "parseListingsJson: maps fields correctly, joins multiple locations"
);
assertEqual(
  jobs[1],
  {
    title: "Backend Intern",
    company: "Acme Corp",
    location: "Remote",
    url: "https://acme.example.com/jobs/xyz",
  },
  "parseListingsJson: is_visible defaults to visible when the field is missing"
);
assertEqual(parseListingsJson("not json"), [], "parseListingsJson: malformed JSON returns empty array");
assertEqual(parseListingsJson("{}"), [], "parseListingsJson: non-array JSON returns empty array");

if (failed) {
  console.error("\n✗ github-repo adapter test FAILED");
  process.exit(1);
} else {
  console.log("\n✓ github-repo adapter test PASSED");
}
