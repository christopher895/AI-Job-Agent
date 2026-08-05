import { matchApplication, MatchCandidate } from "./match";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const candidates: MatchCandidate[] = [
  { id: "a", company: "Bank of America", role: "Software Engineer Intern" },
  { id: "b", company: "Google", role: "STEP Intern" },
  { id: "c", company: "Stripe", role: "Backend Engineer Intern" },
];

// exact-ish company + role → confident match to a
const exact = matchApplication(candidates, { company: "Bank of America", role: "Software Engineer Intern" });
check("exact match picks a", exact?.applicationId === "a");
check("exact match high score", (exact?.score ?? 0) >= 0.6);

// fuzzy company (ATS wording) still matches a
const fuzzy = matchApplication(candidates, { company: "BofA", role: "Buildings and Systems Engineering Summer Intern" });
// "BofA" is a hard alias; expect this to fall through to review (null) rather than mis-match to Google/Stripe
check("unrelated fuzzy does not mis-match", fuzzy === null || fuzzy.applicationId === "a");

// two applications with identical company+role → scores tie → ambiguous → null
const ambiguous = matchApplication(
  [{ id: "x", company: "Acme Inc", role: "Software Engineer Intern" },
   { id: "y", company: "Acme Inc", role: "Software Engineer Intern" }],
  { company: "Acme Inc", role: "Software Engineer Intern" }
);
check("ambiguous top-2 returns null", ambiguous === null);

// gap 0.10 (< 0.15) → genuinely ambiguous → null
const nearTie = matchApplication(
  [{ id: "p", company: "Acme Inc", role: "Software Engineer Intern" },   // score 1.0
   { id: "q", company: "Acme Inc", role: "Software Engineer" }],          // 0.7 + 0.3*(2/3) = 0.9
  { company: "Acme Inc", role: "Software Engineer Intern" }
);
check("near-tie within margin returns null", nearTie === null);

// gap 0.225 (> 0.15) → NOT ambiguous → returns the top candidate.
// This is the case that would FAIL if the margin regressed to 0.4 (0.225 < 0.4 → wrongly null).
const clearWinner = matchApplication(
  [{ id: "p", company: "Acme Inc", role: "Software Engineer Intern" },   // score 1.0
   { id: "s", company: "Acme Inc", role: "Backend Engineer" }],          // 0.7 + 0.3*(1/4) = 0.775
  { company: "Acme Inc", role: "Software Engineer Intern" }
);
check("gap beyond margin picks the top candidate", clearWinner?.applicationId === "p");

// no candidates → null
check("no candidates returns null", matchApplication([], { company: "X", role: "Y" }) === null);

// clearly-below-threshold → null
const weak = matchApplication(candidates, { company: "Netflix", role: "Data Scientist" });
check("below-threshold returns null", weak === null);

console.log(pass ? "\n✓ match test PASSED" : "\n✗ match test FAILED");
process.exit(pass ? 0 : 1);
