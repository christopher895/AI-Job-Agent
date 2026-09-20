import { buildResumeFilename } from "./filename";

let pass = true;
function check(label: string, actual: string, expected: string) {
  if (actual !== expected) {
    pass = false;
    console.error("✗", label, `\n    expected: ${expected}\n    actual:   ${actual}`);
  } else {
    console.log("✓", label);
  }
}

const NAME = "Christopher Zhang";
const fn = (company: string | null, title: string | null) => buildResumeFilename(NAME, company, title);

// --- the shapes that motivated this: trailing location after a dash ---
check(
  "drops the location tail, the parenthetical and the roman-numeral level",
  fn("Capital One", "Software Engineer Data & AI I (Intern) - United States"),
  "Christopher_Zhang_CapitalOne_SoftwareEngineerDataAI_Resume.pdf",
);
check(
  "drops a city/state tail and the Intern token",
  fn("Amazon", "Software Development Engineer Intern - Seattle, WA"),
  "Christopher_Zhang_Amazon_SoftwareDevelopmentEngineer_Resume.pdf",
);
check(
  "drops a pipe-separated location tail",
  fn("Ramp", "Data Scientist | New York, NY"),
  "Christopher_Zhang_Ramp_DataScientist_Resume.pdf",
);
check(
  "drops an em-dash separated tail",
  fn("Datadog", "Software Engineer — Remote"),
  "Christopher_Zhang_Datadog_SoftwareEngineer_Resume.pdf",
);

// --- the role is not always in the first chunk: a noise-only lead-in must be skipped ---
check(
  "skips a leading season/year internship prefix",
  fn("JPMorgan", "2026 Summer Internship - Software Engineer"),
  "Christopher_Zhang_JPMorgan_SoftwareEngineer_Resume.pdf",
);
check(
  "skips a leading Intern chunk and still drops the trailing location",
  fn("Uber", "Intern - Software Engineer - Bengaluru"),
  "Christopher_Zhang_Uber_SoftwareEngineer_Resume.pdf",
);
check(
  "prefers the chunk naming the role over a longer location chunk",
  fn("Ramp", "Data Scientist | Greater New York City Area"),
  "Christopher_Zhang_Ramp_DataScientist_Resume.pdf",
);
check(
  "skips an org/division lead-in to reach the role",
  fn("Amazon", "Amazon Web Services - Software Development Engineer"),
  "Christopher_Zhang_Amazon_SoftwareDevelopmentEngineer_Resume.pdf",
);
check(
  "skips a desk name and stops at the role, not the trailing rank",
  fn("Goldman Sachs", "Global Markets - Software Engineer - Analyst"),
  "Christopher_Zhang_GoldmanSachs_SoftwareEngineer_Resume.pdf",
);
check(
  "keeps a season that names the programme rather than dating it",
  fn("Goldman Sachs", "Technology Summer Analyst Program - 2026 - Americas"),
  "Christopher_Zhang_GoldmanSachs_TechnologySummerAnalystProgram_Resume.pdf",
);

// --- specialty after a comma is signal, not noise: it must survive ---
check(
  "keeps the specialty that follows a comma",
  fn("Stripe", "Backend Engineer, Payments (Summer 2026)"),
  "Christopher_Zhang_Stripe_BackendEngineerPayments_Resume.pdf",
);

// --- seniority is signal; level markers and work-arrangement words are noise ---
check(
  "keeps Senior",
  fn("Figma", "Senior Software Engineer"),
  "Christopher_Zhang_Figma_SeniorSoftwareEngineer_Resume.pdf",
);
check(
  "drops a trailing numeric level",
  fn("Google", "Software Engineer III"),
  "Christopher_Zhang_Google_SoftwareEngineer_Resume.pdf",
);
check(
  "drops Co-op and Hybrid",
  fn("Shopify", "Software Engineer Co-op Hybrid"),
  "Christopher_Zhang_Shopify_SoftwareEngineer_Resume.pdf",
);
check(
  "drops a season only when it is paired with a year",
  fn("Nvidia", "Software Engineer Intern Summer 2026"),
  "Christopher_Zhang_Nvidia_SoftwareEngineer_Resume.pdf",
);
check(
  "keeps a season word that is part of the role",
  fn("Netflix", "Spring Boot Engineer"),
  "Christopher_Zhang_Netflix_SpringBootEngineer_Resume.pdf",
);

// --- a stray opening bracket must not swallow the rest of the title ---
check(
  "survives an unclosed paren mid-title",
  fn("Stripe", "Software Engineer (Backend - Payments Platform"),
  "Christopher_Zhang_Stripe_SoftwareEngineerBackend_Resume.pdf",
);
check(
  "survives an unclosed paren that hides the role behind it",
  fn("Stripe", "Intern (2026 - Software Engineer, Backend"),
  "Christopher_Zhang_Stripe_SoftwareEngineerBackend_Resume.pdf",
);

// --- level markers, single and double digit, and the word "Level" itself ---
check(
  "drops a two-digit level like a single-digit one",
  fn("Google", "Sr. Software Engineer 10"),
  "Christopher_Zhang_Google_SrSoftwareEngineer_Resume.pdf",
);
check(
  "drops the word Level along with its numeral",
  fn("Google", "Engineer Level II"),
  "Christopher_Zhang_Google_Engineer_Resume.pdf",
);

// --- a plain title is left alone ---
check(
  "leaves an already-short title untouched",
  fn("OpenAI", "Software Engineer"),
  "Christopher_Zhang_OpenAI_SoftwareEngineer_Resume.pdf",
);

// --- length backstop ---
check(
  "caps a long title at a word boundary",
  fn("Meta", "Software Engineer Machine Learning Infrastructure Platform"),
  "Christopher_Zhang_Meta_SoftwareEngineerMachineLearning_Resume.pdf",
);
check(
  "cuts between words, never mid-word",
  fn("Meta", "Internationalization Engineering Specialist"),
  "Christopher_Zhang_Meta_InternationalizationEngineering_Resume.pdf",
);
// Synthetic single token longer than the cap: the first word is always kept,
// so the title segment can never come back empty.
check(
  "keeps the first word even when it alone exceeds the cap",
  fn("Meta", "Internationalizationandlocalizationengineer"),
  "Christopher_Zhang_Meta_Internationalizationandlocalizationengineer_Resume.pdf",
);

// --- fallbacks: never lose the segment entirely ---
check(
  "falls back to the pre-noise title when every word is noise",
  fn("Tesla", "Intern - United States"),
  "Christopher_Zhang_Tesla_Intern_Resume.pdf",
);
check(
  "falls back to the raw title when the separator cut empties it",
  fn("Tesla", "- United States"),
  "Christopher_Zhang_Tesla_UnitedStates_Resume.pdf",
);

// --- missing pieces are omitted, as before ---
check("omits a null title", fn("Stripe", null), "Christopher_Zhang_Stripe_Resume.pdf");
check("omits a null company", fn(null, "Software Engineer"), "Christopher_Zhang_SoftwareEngineer_Resume.pdf");
check("omits both", fn(null, null), "Christopher_Zhang_Resume.pdf");

console.log(pass ? "\n✓ filename test PASSED" : "\n✗ filename test FAILED");
process.exit(pass ? 0 : 1);
