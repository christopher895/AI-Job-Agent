import {
  assertSafeUrl,
  isBlockedHostname,
  isBlockedIp,
  normalizeHostname,
  redirectUrl,
} from "./ssrf";

let pass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    pass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

function blocked(ip: string): boolean {
  return isBlockedIp(ip);
}

check("ipv4 loopback", blocked("127.0.0.1"));
check("ipv4 0.0.0.0", blocked("0.0.0.0"));
check("ipv4 10/8", blocked("10.1.2.3"));
check("ipv4 192.168/16", blocked("192.168.1.1"));
check("ipv4 172.16/12", blocked("172.16.0.1") && blocked("172.31.255.255") && !blocked("172.15.0.1") && !blocked("172.32.0.1"));
check("ipv4 link-local / metadata", blocked("169.254.169.254"));
check("ipv4 cgnat", blocked("100.64.0.1"));
check("ipv4 public allowed", !blocked("8.8.8.8") && !blocked("1.1.1.1"));
check("ipv6 loopback", blocked("::1"));
check("ipv6 unspecified", blocked("::"));
check("ipv6 ula", blocked("fc00::1") && blocked("fd12:3456::1"));
check("ipv6 link-local", blocked("fe80::1"));
check("ipv6-mapped loopback", blocked("::ffff:127.0.0.1") && blocked("::ffff:7f00:1"));
check("ipv6-mapped metadata", blocked("::ffff:169.254.169.254") && blocked("::ffff:a9fe:a9fe"));
check("ipv6-mapped public allowed", !blocked("::ffff:8.8.8.8"));
check("ipv6 public allowed", !blocked("2001:4860:4860::8888"));

check("normalize strips brackets", normalizeHostname("[::1]") === "::1");
check("normalize strips trailing dots", normalizeHostname("localhost.") === "localhost");

check("hostname localhost", isBlockedHostname("localhost") && isBlockedHostname("localhost."));
check("hostname .local / .internal", isBlockedHostname("foo.local") && isBlockedHostname("metadata.google.internal"));
check("hostname literal ::1", isBlockedHostname("[::1]") && isBlockedHostname("::1"));
check("hostname public", !isBlockedHostname("jobs.example.com"));

check(
  "redirect resolves relative Location",
  redirectUrl("https://jobs.example.com/a/b", "/x") === "https://jobs.example.com/x"
);

const publicResolve = async () => ["8.8.8.8"];
const loopbackResolve = async () => ["127.0.0.1"];
const mixedResolve = async () => ["8.8.8.8", "10.0.0.1"];

async function expectThrow(label: string, fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
    check(label, false, "expected throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(label, re.test(msg), `got: ${msg}`);
  }
}

async function expectOk(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, true);
  } catch (err) {
    check(label, false, err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  await expectThrow("file protocol", () => assertSafeUrl("file:///etc/passwd", publicResolve), /http or https/);
  await expectThrow("javascript protocol", () => assertSafeUrl("javascript:alert(1)", publicResolve), /http or https/);
  await expectThrow("credentials in url", () => assertSafeUrl("https://user:pass@example.com/", publicResolve), /credentials/);
  await expectThrow("ipv6 loopback url", () => assertSafeUrl("http://[::1]/", publicResolve), /private or internal/);
  await expectThrow("mapped metadata url", () => assertSafeUrl("http://[::ffff:169.254.169.254]/", publicResolve), /private or internal/);
  await expectThrow("0.0.0.0 url", () => assertSafeUrl("http://0.0.0.0/", publicResolve), /private or internal/);
  await expectThrow("localhost trailing dot", () => assertSafeUrl("http://localhost./", publicResolve), /private or internal/);
  await expectThrow("dns rebinding to loopback", () => assertSafeUrl("https://evil.example/", loopbackResolve), /private or internal/);
  await expectThrow("any private A/AAAA record", () => assertSafeUrl("https://evil.example/", mixedResolve), /private or internal/);
  await expectOk("public host with public A", () => assertSafeUrl("https://jobs.example.com/role", publicResolve));

  console.log(pass ? "\n✓ ssrf test PASSED" : "\n✗ ssrf test FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
