import { joinSafeAgentPath, playgroundAgentPath, isSafePathSegment } from "./proxy-path";

let pass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    pass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

check("uuid segment ok", isSafePathSegment("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
check("dotdot rejected", !isSafePathSegment(".."));
check("dot rejected", !isSafePathSegment("."));
check("encoded dots rejected", !isSafePathSegment("%2e%2e"));
check("slash rejected", !isSafePathSegment("foo/bar"));
check("backslash rejected", !isSafePathSegment("foo\\bar"));

check("private proxy resume path", joinSafeAgentPath(["resume", "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "pdf"]) === "resume/a1b2c3d4-e5f6-7890-abcd-ef1234567890/pdf");
check("private proxy rejects traversal", joinSafeAgentPath(["playground", "..", "applied"]) === null);
check("empty path rejected", joinSafeAgentPath([]) === null);

check("playground fetch-jd allowed", playgroundAgentPath(["fetch-jd"]) === "fetch-jd");
check("playground unknown rejected", playgroundAgentPath(["tailor"]) === null);
check("playground traversal rejected", playgroundAgentPath(["..", "applied"]) === null);
check("playground nested rejected", playgroundAgentPath(["fetch-jd", "extra"]) === null);

console.log(pass ? "\n✓ proxy-path test PASSED" : "\n✗ proxy-path test FAILED");
process.exit(pass ? 0 : 1);
