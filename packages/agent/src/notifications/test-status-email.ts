import { statusChangeSubject } from "./email";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const withDate = statusChangeSubject("Bank of America", "assessment", new Date("2026-08-08T00:00:00Z"));
check("OA subject leads with deadline", /OA due/i.test(withDate) && /Aug 8/.test(withDate));
check("OA subject names company", /Bank of America/.test(withDate));

const noDate = statusChangeSubject("Stripe", "interviewing", null);
check("interview subject without date", /Interview/i.test(noDate) && /Stripe/.test(noDate));
check("no 'due' when no date", !/due/i.test(noDate));

const offer = statusChangeSubject("Google", "offer", null);
check("offer subject", /Offer/i.test(offer) && /Google/.test(offer));

console.log(pass ? "\n✓ status-email test PASSED" : "\n✗ status-email test FAILED");
process.exit(pass ? 0 : 1);
