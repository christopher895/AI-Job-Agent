import { FILTERS, isValidPreferences } from "../config";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const { targetSeason: _s, alertBar: _b, ...oldShape } = FILTERS;
void _s; void _b;

check("defaults are valid", isValidPreferences(FILTERS));
check("a row saved before the new fields existed is still valid", isValidPreferences(oldShape));
check("null season (rule off) is valid", isValidPreferences({ ...FILTERS, targetSeason: null }));
check("empty bar (judge off) is valid", isValidPreferences({ ...FILTERS, alertBar: "" }));
check("numeric season rejected", !isValidPreferences({ ...FILTERS, targetSeason: 5 }));
check("null bar rejected", !isValidPreferences({ ...FILTERS, alertBar: null }));
check("missing arrays rejected", !isValidPreferences({ ...FILTERS, watchedRepos: undefined }));
check("defaults watch Simplify", FILTERS.watchedRepos.includes("https://github.com/SimplifyJobs/Summer2027-Internships"));
check("default season is Summer 2027", FILTERS.targetSeason === "Summer 2027");
check("default bar mentions Wells Fargo in Charlotte", /wells fargo/i.test(FILTERS.alertBar) && /charlotte/i.test(FILTERS.alertBar));

console.log(pass ? "\n✓ preferences-shape test PASSED" : "\n✗ preferences-shape test FAILED");
process.exit(pass ? 0 : 1);
