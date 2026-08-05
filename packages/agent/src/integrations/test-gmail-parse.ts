import { parseMessage } from "./gmail";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

const raw = {
  id: "msg-1",
  snippet: "Please complete your assessment",
  internalDate: String(Date.parse("2026-08-04T12:00:00Z")),
  payload: {
    headers: [
      { name: "From", value: "Greenhouse <no-reply@greenhouse.io>" },
      { name: "Subject", value: "Online assessment" },
    ],
    mimeType: "text/plain",
    body: { data: b64("Complete your OA by Aug 8.") },
  },
};

const m = parseMessage(raw as never);
check("id parsed", m.id === "msg-1");
check("subject parsed", m.subject === "Online assessment");
check("from parsed", m.from.includes("greenhouse.io"));
check("fromDomain parsed", m.fromDomain === "greenhouse.io");
check("body decoded", m.body.includes("Complete your OA"));
check("receivedAt parsed", m.receivedAt.getUTCFullYear() === 2026);

// multipart: prefer text/plain part
const multipart = {
  id: "msg-2", snippet: "hi", internalDate: "0",
  payload: { headers: [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "s" }],
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
      { mimeType: "text/plain", body: { data: b64("plain body") } },
    ] },
};
const m2 = parseMessage(multipart as never);
check("multipart prefers text/plain", m2.body.includes("plain body"));
check("bare address domain parsed", m2.fromDomain === "b.com");

console.log(pass ? "\n✓ gmail-parse test PASSED" : "\n✗ gmail-parse test FAILED");
process.exit(pass ? 0 : 1);
