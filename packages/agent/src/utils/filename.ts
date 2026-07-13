function sanitizeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("");
}

/**
 * Builds a filesystem-safe resume filename like "FirstName_LastName_Company_JobTitle_Resume.pdf".
 * Spaces and punctuation are stripped from each segment; missing company/job title are omitted.
 */
export function buildResumeFilename(
  fullName: string,
  company: string | null | undefined,
  jobTitle: string | null | undefined,
): string {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean).map(sanitizeSegment);
  const segments = [
    ...nameParts,
    company ? sanitizeSegment(company) : null,
    jobTitle ? sanitizeSegment(jobTitle) : null,
    "Resume",
  ].filter((s): s is string => Boolean(s));

  return `${segments.join("_")}.pdf`;
}
