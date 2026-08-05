import "../db/pool"; // load .env (CLAUDE_CODE_OAUTH_TOKEN) before any LLM call
import { classifyEmail } from "./classify-email";
import { EmailMessage } from "../ingest/types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}
function mk(over: Partial<EmailMessage>): EmailMessage {
  return { id: "1", from: "x <a@b.com>", fromDomain: "b.com", subject: "", snippet: "", body: "", receivedAt: new Date(), ...over };
}

async function main() {
  const oa = await classifyEmail(mk({
    from: "no-reply <no-reply@greenhouse.io>", fromDomain: "greenhouse.io",
    subject: "Your online assessment for Bank of America",
    body: "Please complete your HackerRank online assessment by August 8, 2026 for the Software Engineer Intern role at Bank of America.",
  }));
  check("OA is job related", oa.isJobRelated === true);
  check("OA status is assessment", oa.status === "assessment");
  check("OA extracts company", /bank of america/i.test(oa.company));
  check("OA extracts a deadline", oa.deadlineAt !== null);

  const reject = await classifyEmail(mk({
    subject: "Update on your application", fromDomain: "lever.co",
    body: "Thank you for your interest. Unfortunately we will not be moving forward with your application at this time.",
  }));
  check("rejection status is rejected", reject.status === "rejected");

  const newsletter = await classifyEmail(mk({
    subject: "This week in tech", fromDomain: "substack.com",
    body: "Here are the top 10 stories in AI this week.",
  }));
  check("newsletter is not job related", newsletter.isJobRelated === false);

  console.log(pass ? "\n✓ classify-email test PASSED" : "\n✗ classify-email test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
