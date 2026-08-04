import type { Request, Response, NextFunction } from "express";

export function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_API_SECRET;
  const provided = req.headers["x-internal-secret"];
  if (!expected || provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
