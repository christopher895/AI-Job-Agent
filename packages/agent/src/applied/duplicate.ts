export const DUPLICATE_APPLIED_JOB_ERROR = "This job is already in your applied log.";

/** Normalize company / title so "  SWE  Intern " matches "swe intern". */
export function normalizeJobLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Collapse a job URL to host + path so tracking params, trailing slashes,
 * www, and http vs https don't create a second log row for the same posting.
 */
export function normalizeJobUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

export type AppliedJobIdentity = {
  company: string;
  jobTitle: string;
  jobUrl?: string | null;
  resumeId?: string | null;
};

export type ExistingAppliedJob = {
  company: string;
  job_title: string;
  job_url: string | null;
  resume_id: string | null;
};

/** True when the incoming log request is the same posting as an existing row. */
export function isSameAppliedJob(existing: ExistingAppliedJob, incoming: AppliedJobIdentity): boolean {
  if (incoming.resumeId && existing.resume_id && incoming.resumeId === existing.resume_id) {
    return true;
  }

  if (incoming.jobUrl && existing.job_url) {
    const incomingUrl = normalizeJobUrl(incoming.jobUrl);
    const existingUrl = normalizeJobUrl(existing.job_url);
    if (incomingUrl && existingUrl && incomingUrl === existingUrl) return true;
  }

  return (
    normalizeJobLabel(existing.company) === normalizeJobLabel(incoming.company) &&
    normalizeJobLabel(existing.job_title) === normalizeJobLabel(incoming.jobTitle)
  );
}

export function findDuplicateInList<T extends ExistingAppliedJob>(
  rows: T[],
  incoming: AppliedJobIdentity
): T | undefined {
  return rows.find((row) => isSameAppliedJob(row, incoming));
}
