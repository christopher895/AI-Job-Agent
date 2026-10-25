import { filterForAlert, companyKey } from "./alert-filter";
import { buildEmailHtml } from "../notifications/email";
import { JobListing } from "./types";
import { Verdict } from "../ai/judge-jobs";

let pass = true;
function check(label: string, cond: boolean, detail?: string) {
  if (!cond) { pass = false; console.error("✗", label, detail ?? ""); } else { console.log("✓", label); }
}

const j = (url: string, extra: Partial<JobListing> = {}): JobListing =>
  ({ title: "SWE Intern", company: "Co", location: "NYC", url, ...extra });
const noneApplied = async () => [] as string[];
const prefs = { targetSeason: "Summer 2027", alertBar: "Better than Wells Fargo in Charlotte" };

async function main() {
  // Season runs first; the judge never sees dropped jobs
  {
    let judged: string[] = [];
    const out = await filterForAlert(
      [j("a", { terms: ["Summer 2027"] }), j("b", { terms: ["Fall 2026"] }), j("c", { title: "Fall Co-op" }), j("d")],
      prefs,
      {
        appliedCompanies: noneApplied,
        judge: async (jobs) => {
          judged = jobs.map((x) => x.url);
          return new Map<string, Verdict>([
            ["a", { send: true, reason: "Top AI lab, SF" }],
            ["d", { send: false, reason: "Weaker than the bar" }],
          ]);
        },
      }
    );
    check("judge only sees season-passing jobs", judged.join() === "a,d", judged.join());
    check("kept = judge 'send'", out.kept.map((x) => x.url).join() === "a");
    check("reasons kept for sent jobs", out.reasons.get("a") === "Top AI lab, SF");
    check("skipped counts season drops + judge skips", out.skipped === 3, String(out.skipped));
  }

  // Everything skipped → nothing kept
  {
    const out = await filterForAlert([j("a")], prefs, {
      appliedCompanies: noneApplied,
      judge: async () => new Map([["a", { send: false, reason: "no" }]]),
    });
    check("all skipped → kept empty", out.kept.length === 0 && out.skipped === 1);
  }

  // Nothing left after season → judge not called
  {
    let called = false;
    const out = await filterForAlert([j("a", { terms: ["Fall 2026"] })], prefs, {
      appliedCompanies: noneApplied,
      judge: async () => { called = true; return new Map(); },
    });
    check("no judge call when season drops everything", !called && out.kept.length === 0);
  }

  // The filter must never swallow a tick's alerts
  {
    const out = await filterForAlert([j("a"), j("b")], prefs, { appliedCompanies: noneApplied, judge: async () => { throw new Error("unexpected"); } });
    check("unexpected error → everything kept", out.kept.length === 2 && out.skipped === 0);
  }

  // Companies already applied to are dropped before the season rule and the judge
  {
    let judged: string[] = [];
    const out = await filterForAlert(
      [j("a", { company: "Snap" }), j("b", { company: "Stripe" }), j("c", { company: "Jane Street" })],
      prefs,
      {
        appliedCompanies: async () => ["Snap Inc.", "jane street"],
        judge: async (jobs) => { judged = jobs.map((x) => x.url); return new Map(); },
      }
    );
    check("applied companies never reach the judge", judged.join() === "b", judged.join());
    check("applied companies dropped", out.kept.map((x) => x.url).join() === "b");
    check("applied drops counted as skipped", out.skipped === 2, String(out.skipped));
  }

  // A failed applied-jobs lookup filters nothing but keeps the other stages
  {
    let judged = 0;
    const out = await filterForAlert([j("a", { company: "Snap" }), j("b", { terms: ["Fall 2026"] })], prefs, {
      appliedCompanies: async () => { throw new Error("db down"); },
      judge: async (jobs) => { judged = jobs.length; return new Map(); },
    });
    check("lookup failure → nothing dropped as applied", out.kept.map((x) => x.url).join() === "a");
    check("lookup failure → season + judge still run", judged === 1 && out.skipped === 1);
  }

  check("companyKey ignores case, punctuation, legal suffixes",
    companyKey("Snap Inc.") === companyKey("snap") &&
    companyKey("Two Sigma, LLC") === companyKey("Two Sigma") &&
    companyKey("AT&T") === companyKey("at and t"));
  check("companyKey keeps distinct names distinct", companyKey("Snap") !== companyKey("Snapdragon"));

  // Email rendering
  const html = buildEmailHtml([j("https://x/1", { title: "AI Intern" })], "SimplifyJobs", {
    reasons: new Map([["https://x/1", "Top <AI> lab & SF"]]),
    skipped: 4,
  });
  check("reason line rendered and escaped", html.includes("Top &lt;AI&gt; lab &amp; SF"));
  check("skipped footer rendered", /4 more didn.t clear your bar/.test(html));
  const plain = buildEmailHtml([j("https://x/1")], "src");
  check("no footer when nothing skipped", !/clear your bar/.test(plain));

  console.log(pass ? "\n✓ alert-filter test PASSED" : "\n✗ alert-filter test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
