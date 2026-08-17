import { GMAIL_SENDER_ALLOWLIST, RECRUITING_KEYWORDS } from "../config";
import { EmailMessage } from "./types";

/** Cheap gate so the LLM only ever sees a handful of emails/week. */
export function isAllowlistedSender(
  domain: string,
  allowlist: string[] = GMAIL_SENDER_ALLOWLIST
): boolean {
  const d = domain.toLowerCase();
  return allowlist.some((entry) => d === entry || d.endsWith("." + entry));
}

export function isCandidateEmail(
  email: EmailMessage,
  opts: { allowlist?: string[]; keywords?: string[] } = {}
): boolean {
  const allowlist = opts.allowlist ?? GMAIL_SENDER_ALLOWLIST;
  const keywords = opts.keywords ?? RECRUITING_KEYWORDS;

  if (isAllowlistedSender(email.fromDomain, allowlist)) return true;

  const haystack = `${email.subject}\n${email.snippet}\n${email.body}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
