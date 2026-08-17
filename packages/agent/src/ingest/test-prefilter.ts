import { isCandidateEmail, isAllowlistedSender } from "./prefilter";
import { EmailMessage } from "./types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}
function mk(over: Partial<EmailMessage>): EmailMessage {
  return { id: "1", from: "x <a@b.com>", fromDomain: "b.com", subject: "", snippet: "", body: "", receivedAt: new Date(), ...over };
}

check("allowlisted sender passes", isCandidateEmail(mk({ fromDomain: "greenhouse.io" })));
check("allowlist subdomain match passes", isCandidateEmail(mk({ fromDomain: "boards.greenhouse.io" })));
check("keyword in subject passes", isCandidateEmail(mk({ fromDomain: "randomstartup.com", subject: "Your online assessment is ready" })));
check("keyword in body passes", isCandidateEmail(mk({ fromDomain: "randomstartup.com", body: "We received your application and will be in touch." })));
check("plain newsletter is rejected", !isCandidateEmail(mk({ fromDomain: "news.substack.com", subject: "This week in AI", body: "Top stories" })));
check("allowlisted sender helper: ATS domain", isAllowlistedSender("greenhouse.io"));
check("allowlisted sender helper: ATS subdomain", isAllowlistedSender("boards.greenhouse.io"));
check("allowlisted sender helper: gmail is not ATS", !isAllowlistedSender("gmail.com"));

console.log(pass ? "\n✓ prefilter test PASSED" : "\n✗ prefilter test FAILED");
process.exit(pass ? 0 : 1);
