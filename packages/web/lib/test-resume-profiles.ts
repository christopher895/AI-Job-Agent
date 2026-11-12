import { parseKeywordInput, pickProfile, titleHasKeyword } from "./resumeProfiles";

// Same cases as packages/agent/src/ai/test-resume-profiles.ts — the hint on
// /tailor must agree with the server's choice. Not imported from the agent:
// the web package builds on its own.

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const profiles = [
  { id: 1, keywords: ["software"] },
  { id: 4, keywords: ["data scientist", "analytics"] },
  { id: 2, keywords: ["ML", "machine learning", "AI"] },
];

check("ML matches 'ML Engineer Intern'", titleHasKeyword("ML Engineer Intern", "ML"));
check("ML does not match 'HTML Developer'", !titleHasKeyword("HTML Developer", "ML"));
check("AI does not match 'Maintenance'", !titleHasKeyword("Maintenance Engineer", "AI"));
check("AI matches 'AI/ML Intern'", titleHasKeyword("AI/ML Intern", "AI"));
check("regex characters are literal", titleHasKeyword("C++ Engineer", "C++") && !titleHasKeyword("C Engineer", "C++"));
check("ML title picks the ML profile", pickProfile("Machine Learning Engineer Intern", profiles) === 2);
check("plain SWE title picks the default", pickProfile("Software Engineer Intern", profiles) === 1);
check("no title picks the default", pickProfile(undefined, profiles) === 1 && pickProfile("  ", profiles) === 1);
check("lowest id wins when two profiles match", pickProfile("Data Scientist, AI", profiles) === 2);
check("parseKeywordInput splits and trims", JSON.stringify(parseKeywordInput(" ML, machine learning ,, ")) === '["ML","machine learning"]');

console.log(pass ? "\n✓ resume-profiles mirror test PASSED" : "\n✗ resume-profiles mirror test FAILED");
process.exit(pass ? 0 : 1);
