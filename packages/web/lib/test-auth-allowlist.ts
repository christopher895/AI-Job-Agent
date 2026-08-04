import { isAllowedEmail } from "./auth-allowlist";

process.env.AUTH_ALLOWED_EMAIL = "me@example.com";

const cases: [string | null | undefined, boolean][] = [
  ["me@example.com", true],
  ["ME@EXAMPLE.COM", true],
  ["someoneelse@example.com", false],
  [null, false],
  [undefined, false],
  ["", false],
];

let pass = true;
for (const [input, expected] of cases) {
  const actual = isAllowedEmail(input);
  const ok = actual === expected;
  if (!ok) pass = false;
  console.log(`${ok ? "✓" : "✗"} isAllowedEmail(${JSON.stringify(input)}) = ${actual} (expected ${expected})`);
}

console.log(pass ? "\n✓ auth-allowlist test PASSED" : "\n✗ auth-allowlist test FAILED");
process.exit(pass ? 0 : 1);
