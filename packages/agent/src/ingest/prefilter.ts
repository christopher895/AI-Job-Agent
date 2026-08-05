import { GMAIL_SENDER_ALLOWLIST, RECRUITING_KEYWORDS } from "../config";
import { EmailMessage } from "./types";

/** Cheap gate so the LLM only ever sees a handful of emails/week. */
export function isCandidateEmail(
  email: EmailMessage,
  opts: { allowlist?: string[]; keywords?: string[] } = {}
): boolean {
  const allowlist = opts.allowlist ?? GMAIL_SENDER_ALLOWLIST;
  const keywords = opts.keywords ?? RECRUITING_KEYWORDS;

  const domain = email.fromDomain.toLowerCase();
  if (allowlist.some((d) => domain === d || domain.endsWith("." + d))) return true;

  const haystack = `${email.subject}\n${email.snippet}\n${email.body}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
