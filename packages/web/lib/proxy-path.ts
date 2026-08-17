const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export const PLAYGROUND_PATHS = new Set(["parse-resume", "fetch-jd", "suggest", "apply"]);

/** Rejects `.`, `..`, slashes, encodings, or any other path-escape trick. */
export function isSafePathSegment(segment: string): boolean {
  return SAFE_SEGMENT.test(segment);
}

/**
 * Join catch-all route segments into an agent path, or null if any segment
 * could escape the intended prefix (e.g. `..` → `/api/applied`).
 */
export function joinSafeAgentPath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  if (!segments.every(isSafePathSegment)) return null;
  return segments.join("/");
}

export function playgroundAgentPath(segments: string[] | undefined): string | null {
  const joined = joinSafeAgentPath(segments);
  if (!joined || segments?.length !== 1 || !PLAYGROUND_PATHS.has(segments[0])) return null;
  return joined;
}

/** First hop of X-Forwarded-For, or x-real-ip — the edge-set client address. */
export function forwardedClientIp(req: { headers: { get(name: string): string | null } }): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded?.trim()) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  return realIp?.trim() || null;
}
