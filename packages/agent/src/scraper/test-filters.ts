import { applyPreferences, matchesFilters } from "./filters";
import { FILTERS } from "../config";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

applyPreferences(FILTERS); // requiredKeywords: ["intern"], titleKeywords: software/engineer/...

// Plain internship titles
check("'Software Engineer Intern' matches", matchesFilters("Software Engineer Intern"));
check("'2027 Internship - Software Engineer' matches", matchesFilters("2027 Internship - Software Engineer"));
check("'Software Engineering Co-Op' matches", matchesFilters("Software Engineering Co-Op"));

// Bank/quant phrasing that never contains the word "intern"
check("Goldman 'Engineering | Summer Analyst' matches",
  matchesFilters("2027 | Americas | New York City Area | Engineering | Summer Analyst"));

// "intern" as a prefix of an unrelated word must NOT match
check("'Internal Audit Analyst' rejected", !matchesFilters("Global Internal Auditor, Software"));
check("'Internal Controls Engineer' rejected", !matchesFilters("Internal Controls Engineer"));
check("'International Software Engineer' rejected", !matchesFilters("International Software Engineer"));

// The other gates still apply
check("full-time SWE rejected (no intern signal)", !matchesFilters("Senior Software Engineer"));
check("non-eng internship rejected (no title keyword)", !matchesFilters("Legal Intern - Summer 2027"));

// User-editable keywords must not blow up the RegExp constructor
applyPreferences({ ...FILTERS, requiredKeywords: ["c++"], titleKeywords: ["engineer"] });
check("regex-special keyword is escaped", matchesFilters("C++ Engineer, Low Latency"));
check("regex-special keyword still filters", !matchesFilters("Python Engineer"));

console.log(pass ? "\n✓ filters test PASSED" : "\n✗ filters test FAILED");
process.exit(pass ? 0 : 1);
