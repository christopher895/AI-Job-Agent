import {
  normalizeKeywords,
  parseBaseResumeChoice,
  parseProfileId,
  pickProfile,
  titleHasKeyword,
  type ProfileSummary,
} from "./resume-profiles";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const profiles: ProfileSummary[] = [
  { id: 1, name: "Main", keywords: ["software"] }, // default's keywords never steer the pick
  { id: 4, name: "Data", keywords: ["data scientist", "analytics"] },
  { id: 2, name: "ML", keywords: ["ML", "machine learning", "AI"] },
];

// titleHasKeyword — whole words, any case
check("ML matches 'ML Engineer Intern'", titleHasKeyword("ML Engineer Intern", "ML"));
check("ML matches 'Software Engineer, ML Infrastructure'", titleHasKeyword("Software Engineer, ML Infrastructure", "ML"));
check("ML does not match 'HTML Developer'", !titleHasKeyword("HTML Developer", "ML"));
check("AI does not match 'Maintenance'", !titleHasKeyword("Maintenance Engineer", "AI"));
check("AI matches 'AI/ML Intern'", titleHasKeyword("AI/ML Intern", "AI"));
check("multi-word keyword matches, case-insensitive", titleHasKeyword("Machine Learning Intern", "machine learning"));
check("regex characters in a keyword are literal", titleHasKeyword("C++ Engineer", "C++") && !titleHasKeyword("C Engineer", "C++"));
check("blank keyword never matches", !titleHasKeyword("Anything", "  "));

// pickProfile
check("ML title picks the ML profile", pickProfile("Machine Learning Engineer Intern", profiles) === 2);
check("plain SWE title picks the default", pickProfile("Software Engineer Intern", profiles) === 1);
check("no title picks the default", pickProfile(undefined, profiles) === 1 && pickProfile("  ", profiles) === 1);
check("lowest id wins when two profiles match", pickProfile("Data Scientist, AI", profiles) === 2);
check("only one profile → default", pickProfile("ML Intern", [{ id: 1, name: "Main", keywords: ["ML"] }]) === 1);

// normalizeKeywords
check("splits comma strings and trims", JSON.stringify(normalizeKeywords(" ML, machine learning ,,")) === '["ML","machine learning"]');
check("drops case-insensitive duplicates", JSON.stringify(normalizeKeywords(["AI", "ai", "Ai "])) === '["AI"]');
check("ignores non-strings and junk input", normalizeKeywords([1, null, "x"]).length === 1 && normalizeKeywords(42).length === 0);

// parseProfileId / parseBaseResumeChoice
check("parseProfileId accepts 2 and '2'", parseProfileId(2) === 2 && parseProfileId("2") === 2);
check("parseProfileId rejects 0, -1, 1.5, 'x'", [0, -1, 1.5, "x", "2a", null].every((v) => parseProfileId(v) === null));
const auto = parseBaseResumeChoice(undefined);
check("missing choice is auto", auto.ok && auto.value === "auto");
const explicit = parseBaseResumeChoice(3);
check("number choice is that id", explicit.ok && explicit.value === 3);
check("junk choice rejected", !parseBaseResumeChoice("ml").ok);

console.log(pass ? "\n✓ resume-profiles test PASSED" : "\n✗ resume-profiles test FAILED");
process.exit(pass ? 0 : 1);
