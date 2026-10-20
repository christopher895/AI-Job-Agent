import { passesSeason } from "./season";
import { JobListing } from "./types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const repo = (terms: string[]): JobListing => ({ title: "SWE Intern", company: "C", location: "", url: "u", terms });
const board = (title: string): JobListing => ({ title, company: "C", location: "", url: "u" });
const T = "Summer 2027";

// Repo listings carry season tags
check("repo tag matches case-insensitively", passesSeason(repo(["summer 2027"]), T));
check("repo with any matching tag passes", passesSeason(repo(["Fall 2026", "Summer 2027"]), T));
check("repo other season fails", !passesSeason(repo(["Fall 2026"]), T));
// No season tag at all (empty, or Simplify's "N/A") is unknown, not a mismatch:
// fall through to the title rule so an untagged SWE posting still reaches the judge
check("repo untagged falls through to title (passes)", passesSeason(repo([]), T));
check("repo N/A falls through to title (passes)", passesSeason(repo(["N/A"]), T));
check("repo N/A with an off-season title fails",
  !passesSeason({ title: "Software Co-op (Fall 2026)", company: "C", location: "", url: "u", terms: ["N/A"] }, T));

// vanshb03-style feeds: a season word, no year (the repo itself is the year)
const vansh = (season: string): JobListing => ({ title: "SWE Intern", company: "C", location: "", url: "u", season });
check("feed season Summer passes", passesSeason(vansh("Summer"), T));
check("feed season Spring/Summer passes", passesSeason(vansh("Spring/Summer"), T));
check("feed season Fall fails", !passesSeason(vansh("Fall"), T));
check("feed season Winter fails", !passesSeason(vansh("Winter"), T));

// User-typed season text never throws
let threw = false;
try { passesSeason(board("SWE Intern"), "(Summer 2027"); } catch { threw = true; }
check("regex characters in the season don't throw", !threw);

// Rule off
check("null target passes anything", passesSeason(repo(["Fall 2026"]), null));
check("blank target passes anything", passesSeason(board("Fall Co-op"), "  "));

// Board postings: only drop clear mismatches
check("plain intern title passes", passesSeason(board("Software Engineer Intern"), T));
check("fall co-op fails", !passesSeason(board("Fall 2026 Co-op"), T));
check("co-op without season fails", !passesSeason(board("Software Co-op"), T));
check("spring fails", !passesSeason(board("Spring Intern"), T));
check("autumn fails", !passesSeason(board("Autumn Analyst"), T));
check("summer 2027 passes", passesSeason(board("Summer 2027 SWE Intern"), T));
check("other year fails", !passesSeason(board("SWE Intern 2026"), T));
check("target year passes", passesSeason(board("SWE Intern 2027"), T));
check("names summer alongside another season passes", passesSeason(board("Winter/Summer Intern"), T));
check("word containing 'spring' (Springfield) passes", passesSeason(board("SWE Intern - Springfield"), T));

console.log(pass ? "\n✓ season test PASSED" : "\n✗ season test FAILED");
process.exit(pass ? 0 : 1);
