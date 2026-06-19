import crypto from "crypto";

export function hashJob(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

export function diffSnapshots(
  previousHashes: string[],
  currentHashes: string[]
): string[] {
  const prev = new Set(previousHashes);
  return currentHashes.filter((h) => !prev.has(h));
}
