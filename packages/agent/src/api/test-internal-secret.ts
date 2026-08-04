import type { Request, Response } from "express";
import { requireInternalSecret } from "./internal-secret";

process.env.INTERNAL_API_SECRET = "test-secret";

function run(headerValue: string | undefined): { calledNext: boolean; status: number | null } {
  let calledNext = false;
  let status: number | null = null;
  const req = {
    headers: headerValue !== undefined ? { "x-internal-secret": headerValue } : {},
  } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  requireInternalSecret(req, res, () => {
    calledNext = true;
  });
  return { calledNext, status };
}

const correct = run("test-secret");
const wrong = run("nope");
const missing = run(undefined);

console.log("correct secret:", correct, "| wrong secret:", wrong, "| missing secret:", missing);

const pass =
  correct.calledNext === true &&
  correct.status === null &&
  wrong.calledNext === false &&
  wrong.status === 401 &&
  missing.calledNext === false &&
  missing.status === 401;

console.log(pass ? "\n✓ internal-secret test PASSED" : "\n✗ internal-secret test FAILED");
process.exit(pass ? 0 : 1);
