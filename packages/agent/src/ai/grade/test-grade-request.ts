import { isUuid, parseGradeRequest } from "./request";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
check("isUuid accepts a uuid", isUuid(ID));
check("isUuid rejects junk", !isUuid("abc") && !isUuid(`${ID}x`) && !isUuid(undefined));

const ok = (b: Record<string, unknown>) => parseGradeRequest(b);
const master = ok({ source: "master", targetRole: "ml", level: "intern" });
check("master request parses", master.ok && master.value.source === "master" && master.value.jdText === "");
check("unknown source rejected", !ok({ source: "linkedin", targetRole: "ml", level: "intern" }).ok);
check("unknown role rejected", !ok({ source: "master", targetRole: "pm", level: "intern" }).ok);
check("unknown level rejected", !ok({ source: "master", targetRole: "ml", level: "junior" }).ok);
check("tailored needs a uuid resumeId", !ok({ source: "tailored", resumeId: "abc", targetRole: "ml", level: "intern" }).ok);
const tailored = ok({ source: "tailored", resumeId: ID, targetRole: "swe", level: "entry", jdText: "  JD  " });
check("tailored parses and trims the JD", tailored.ok && tailored.value.resumeId === ID && tailored.value.jdText === "JD");
check("upload without text or file rejected", !ok({ source: "upload", targetRole: "ml", level: "intern" }).ok);
const pasted = ok({ source: "upload", text: "resume", label: "  Old resume  ", targetRole: "ml", level: "intern" });
check("pasted upload keeps text and trims label", pasted.ok && pasted.value.text === "resume" && pasted.value.label === "Old resume");
check("upload with a file flag parses without text",
  ok({ source: "upload", hasFile: true, targetRole: "ml", level: "intern" }).ok);
check("JD over 30,000 chars rejected",
  !ok({ source: "master", targetRole: "ml", level: "intern", jdText: "x".repeat(30_001) }).ok);
check("non-string JD rejected", !ok({ source: "master", targetRole: "ml", level: "intern", jdText: 5 }).ok);

console.log(pass ? "\n✓ grade-request test PASSED" : "\n✗ grade-request test FAILED");
process.exit(pass ? 0 : 1);
