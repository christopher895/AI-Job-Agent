function sanitizeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("");
}

/** Longest a sanitized job-title segment may be before it is cut at a word boundary. */
const TITLE_MAX_CHARS = 40;

/**
 * Splits a title into chunks. ATS titles hang location, req ids and programme lead-ins off
 * a dash or pipe ("Software Engineer - Seattle, WA", "2026 Summer Internship - Software
 * Engineer"). Commas are NOT separators — a comma usually introduces the specialty
 * ("Backend Engineer, Payments").
 */
const CHUNK_SEPARATOR = /\s+[-–—|]\s+/;

/** Work arrangement, internship and country words that say nothing about the role. */
const NOISE_WORDS = new Set([
  "intern", "interns", "internship", "internships", "coop",
  "remote", "hybrid", "onsite",
  "us", "usa", "united", "states", "canada",
  "level",
]);

const SEASONS = new Set(["spring", "summer", "fall", "autumn", "winter"]);

/** A bare level marker: "II", "3", "10", "L4". Not a word anyone needs in a filename. */
const LEVEL = /^(?:[ivx]+|l?\d{1,2})$/;

const YEAR = /^\d{4}$/;

/**
 * Words that mark a chunk as naming the job rather than the org, desk or location.
 * Titles like "Amazon Web Services - Software Development Engineer" and "Global Markets -
 * Software Engineer" lead with a division that survives noise removal, so "first chunk with
 * a real word" would keep the org and throw the role away.
 */
const ROLE_NOUNS = new Set([
  "engineer", "engineering", "developer", "development", "scientist", "analyst",
  "manager", "designer", "architect", "researcher", "programmer", "consultant",
  "administrator", "technician", "swe", "sde",
]);

const namesARole = (words: string[]) => words.some((word) => ROLE_NOUNS.has(key(word)));

/** Lowercased, punctuation-free form used for noise matching ("Co-op" -> "coop"). */
const key = (word: string) => word.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

function dropNoiseWords(words: string[]): string[] {
  return words.filter((word, i) => {
    const k = key(word);
    if (!k) return false;
    if (NOISE_WORDS.has(k) || LEVEL.test(k) || YEAR.test(k)) return false;
    // A season is only noise when it dates the posting ("Summer 2026", "2026 Summer");
    // standing on its own it may well be the role ("Spring Boot Engineer") or the
    // programme ("Technology Summer Analyst Program").
    if (SEASONS.has(k) && [words[i - 1], words[i + 1]].some((w) => YEAR.test(key(w ?? "")))) {
      return false;
    }
    return true;
  });
}

/** Keeps whole words while the sanitized segment stays within the cap; always keeps the first. */
function capWords(words: string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = length + sanitizeSegment(word).length;
    if (kept.length > 0 && next > TITLE_MAX_CHARS) break;
    kept.push(word);
    length = next;
  }
  return kept;
}

/**
 * Trims a raw ATS job title down to the part worth putting in a filename:
 * "Software Engineer Data & AI I (Intern) - United States" -> "Software Engineer Data & AI".
 *
 * Falls back to a less-trimmed form rather than ever returning nothing, so a title made
 * entirely of noise still leaves something recognisable in the filename.
 */
export function condenseJobTitle(title: string): string {
  // The closing bracket is required: an unbalanced "(" would otherwise swallow the rest of
  // the title, role and chunk separators included. A stray opener is left for sanitizeSegment.
  const withoutBrackets = title.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  const chunks = (withoutBrackets.trim() || title)
    .split(CHUNK_SEPARATOR)
    .map((chunk) => chunk.split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0);

  // The role is usually the first chunk, but not always: "2026 Summer Internship - Software
  // Engineer" leads with noise and "Amazon Web Services - Software Development Engineer"
  // leads with an org. Prefer the first chunk that names a role; failing that, the first
  // with any real word left. Deliberately not "the longest chunk" — that would pick the
  // location out of "Data Scientist | Greater New York City Area".
  const candidates = chunks
    .map(dropNoiseWords)
    .filter((words) => words.length > 0);
  const chosen = candidates.find(namesARole) ?? candidates[0];
  if (chosen) return capWords(chosen).join(" ");

  // Every chunk was noise — keep the first one as-is rather than lose the segment.
  return capWords(chunks[0] ?? title.split(/\s+/).filter(Boolean)).join(" ");
}

/**
 * Builds a filesystem-safe resume filename like "FirstName_LastName_Company_JobTitle_Resume.pdf".
 * The job title is condensed first (see condenseJobTitle); spaces and punctuation are then
 * stripped from each segment, and a missing company/job title is omitted.
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
    jobTitle ? sanitizeSegment(condenseJobTitle(jobTitle)) : null,
    "Resume",
  ].filter((s): s is string => Boolean(s));

  return `${segments.join("_")}.pdf`;
}
