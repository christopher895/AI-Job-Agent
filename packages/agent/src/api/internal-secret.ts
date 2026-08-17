import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

function secretsEqual(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_API_SECRET;
  const provided = req.headers["x-internal-secret"];
  if (!expected || !secretsEqual(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
