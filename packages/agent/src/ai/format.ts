import { MasterResume, TailoredResume } from "./types";
import {
  WEAK_PHRASES,
  ACRONYM_EXPANSIONS,
  BULLET_GUIDELINES,
  KEYWORD_REPEAT_CAP,
  BUZZWORDS_CLICHES,
  FILLER_WORDS,
  PERSONAL_PRONOUNS,
  ATS_UNSAFE_GLYPHS,
  QUANTIFICATION_TARGET_RATIO,
  VERB_REPEAT_CAP,
  COMMON_MISSPELLINGS,
} from "./knowledge/best-practices";

/**
 * Deterministic formatting layer. The LLM emits STRUCTURE (sections + bullets);
 * format correctness is produced here, not trusted to the model:
 *   - renderMarkdown(): an ATS-safe single-column document (no tables/columns/icons).
 *   - lintFormat(): computable checks the renderer can't enforce.
 *   - masterVocabulary() + keywordCoverage(): the deterministic JD-match signal.
 *
 * All pure functions — no I/O, fully testable offline.
 */

type SectionMeta = { header: string; link: string };

function buildMeta(master: MasterResume): Map<string, SectionMeta> {
  const meta = new Map<string, SectionMeta>();
  for (const e of [...master.experience, ...master.extracurriculars]) {
    meta.set(e.id, {
      header: `**${e.company}** — ${e.title} · ${e.location} · ${e.start}–${e.end}`,
      link: "",
    });
  }
  for (const p of master.projects) {
    meta.set(p.id, {
      header: `**${p.name}** · ${p.tech.join(", ")} · ${p.start}–${p.end}`,
      link: p.link,
    });
  }
  return meta;
}

/** ATS-safe single-column Markdown. Standard headings; tech inline; links surfaced. */
export function renderMarkdown(master: MasterResume, tailored: TailoredResume): string {
  const meta = buildMeta(master);
  const lines: string[] = [];

  const b = master.basics;
  lines.push(`# ${b.name}`);
  const contact = [b.location, b.email, b.phone, b.github, b.portfolio, b.linkedin].filter(Boolean);
  if (contact.length) lines.push(contact.join(" · "));

  const renderSections = (heading: string, sections: TailoredResume["experience"]) => {
    if (!sections.length) return;
    lines.push("", `## ${heading}`);
    for (const s of sections) {
      const m = meta.get(s.id);
      lines.push("", m ? m.header : `**${s.id}**`);
      if (m?.link) lines.push(m.link);
      for (const bullet of s.bullets) lines.push(`- ${bullet.text}`);
    }
  };

  renderSections("Experience", tailored.experience);
  renderSections("Projects", tailored.projects);

  // Skills: 4 fixed categories, never flattened together. Within each category,
  // front-load whichever items the tailoring pass ranked as JD-relevant — but
  // never mix languages/frameworks/tools across category lines, and never let
  // tailoring touch interests (rendered verbatim from master, unconditionally).
  const orderWithinCategory = (category: string[]) => [
    ...tailored.skillsOrder.filter((o) => category.some((c) => c.toLowerCase() === o.toLowerCase())),
    ...category.filter((c) => !tailored.skillsOrder.some((o) => o.toLowerCase() === c.toLowerCase())),
  ];
  lines.push("", "## Skills");
  if (master.skills.languages.length)
    lines.push(`**Languages:** ${orderWithinCategory(master.skills.languages).join(", ")}`);
  if (master.skills.frameworks.length)
    lines.push(`**Frameworks & Libraries:** ${orderWithinCategory(master.skills.frameworks).join(", ")}`);
  if (master.skills.tools.length)
    lines.push(`**Tools & Technologies:** ${orderWithinCategory(master.skills.tools).join(", ")}`);
  if (master.skills.interests.length)
    lines.push(`**Interests:** ${master.skills.interests.join(", ")}`);

  // Education (untailored — facts are fixed, never seen by the tailorer).
  if (master.education.length) {
    lines.push("", "## Education");
    for (const ed of master.education) {
      lines.push("", `**${ed.school}** — ${ed.degrees.join(", ")} · ${ed.location} · ${ed.graduation}`);
      if (ed.gpa) lines.push(`GPA: ${ed.gpa}`);
      if (ed.notes.length) lines.push(`Notes: ${ed.notes.join(", ")}`);
      if (ed.coursework.length) lines.push(`Coursework: ${ed.coursework.join(", ")}`);
    }
  }

  // Extracurriculars (untailored — copied verbatim, never seen by the tailorer).
  if (master.extracurriculars.length) {
    lines.push("", "## Extracurriculars");
    for (const ex of master.extracurriculars) {
      lines.push("", `**${ex.company}** — ${ex.title} · ${ex.location} · ${ex.start}–${ex.end}`);
      for (const bullet of ex.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  return lines.join("\n");
}

export type FormatIssue = { level: "error" | "warning"; rule: string; detail: string };
export type FormatReport = { score: number; issues: FormatIssue[] };

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** First word of a bullet, lowercased — used as the "leading verb" for repetition/tense checks. */
function leadingVerb(text: string): string {
  const match = text.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toLowerCase() : "";
}

const IRREGULAR_PAST_VERBS = new Set([
  "built", "led", "sold", "shown", "given", "driven", "spent", "sent", "kept",
  "met", "held", "ran", "grew", "wrote", "spoke", "chose", "taught", "brought",
  "caught", "sought", "won", "cut", "set", "began",
]);

function isPastTense(verb: string): boolean {
  return verb.endsWith("ed") || IRREGULAR_PAST_VERBS.has(verb);
}

type TailoredSections = TailoredResume["experience"];

function allBullets(sections: TailoredSections) {
  return sections.flatMap((s) => s.bullets);
}

/** Bucket: quantify impact — 30% weight. Resume-wide bullet quantification ratio vs. a 75% target. */
function quantificationScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const bullets = allBullets(sections);
  const quantified = bullets.filter((b) => /\d/.test(b.text));
  const ratio = bullets.length ? quantified.length / bullets.length : 1;
  if (ratio < QUANTIFICATION_TARGET_RATIO) {
    issues.push({
      level: "warning",
      rule: "quantification-low",
      detail: `${quantified.length} of ${bullets.length} bullets quantified (target ${Math.round(QUANTIFICATION_TARGET_RATIO * 100)}%) — add a number where one truthfully exists`,
    });
  }
  const score = Math.min(100, Math.round((ratio / QUANTIFICATION_TARGET_RATIO) * 100));
  return { score, issues };
}

/** Bucket: weak verbs & repetition — 15% weight. Duty-language openers + same-verb-opens->cap. */
function weakVerbsAndRepetitionScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const bullets = allBullets(sections);
  let weakCount = 0;
  for (const { text } of bullets) {
    const lower = text.toLowerCase();
    const weak = WEAK_PHRASES.find((p) => lower.startsWith(p));
    if (weak) {
      weakCount++;
      issues.push({ level: "error", rule: "weak-opener", detail: `bullet starts with "${weak}": "${text}"` });
    }
  }
  const verbCounts = new Map<string, number>();
  for (const { text } of bullets) {
    const verb = leadingVerb(text);
    if (verb) verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1);
  }
  let repeatedVerbs = 0;
  for (const [verb, count] of verbCounts) {
    if (count > VERB_REPEAT_CAP) {
      repeatedVerbs++;
      issues.push({
        level: "warning",
        rule: "verb-repetition",
        detail: `"${verb}" opens ${count} bullets (cap ${VERB_REPEAT_CAP}) — vary the action verb`,
      });
    }
  }
  const score = Math.max(0, 100 - weakCount * 25 - repeatedVerbs * 20);
  return { score, issues };
}

/** Bucket: verb tenses — 10% weight. Flags bullets whose leading-verb tense disagrees with the majority within the same section. */
function verbTenseScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  let mismatches = 0;
  for (const s of sections) {
    const verbs = s.bullets.map((b) => leadingVerb(b.text)).filter(Boolean);
    if (verbs.length < 2) continue;
    const pastCount = verbs.filter(isPastTense).length;
    const majorityPast = pastCount >= verbs.length / 2;
    for (const b of s.bullets) {
      const verb = leadingVerb(b.text);
      if (!verb) continue;
      if (isPastTense(verb) !== majorityPast) {
        mismatches++;
        issues.push({
          level: "warning",
          rule: "wrong-tense",
          detail: `section "${s.id}" bullet opens with "${verb}", inconsistent with the section's ${majorityPast ? "past" : "non-past"}-tense majority: "${b.text}"`,
        });
      }
    }
  }
  const score = Math.max(0, 100 - mismatches * 25);
  return { score, issues };
}

/** Bucket: buzzwords, filler & pronouns — 15% weight. Three related word-choice-hygiene word-lists, one bucket. */
function wordChoiceScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const allText = allBullets(sections).map((b) => b.text).join("\n").toLowerCase();

  let buzzwordHits = 0;
  for (const phrase of BUZZWORDS_CLICHES) {
    if (allText.includes(phrase)) {
      buzzwordHits++;
      issues.push({ level: "warning", rule: "buzzword", detail: `contains cliché phrase "${phrase}"` });
    }
  }

  let fillerHits = 0;
  for (const word of FILLER_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(allText)) {
      fillerHits++;
      issues.push({ level: "warning", rule: "filler-word", detail: `contains filler word/phrase "${word}"` });
    }
  }

  let pronounHits = 0;
  for (const pattern of PERSONAL_PRONOUNS) {
    if (new RegExp(pattern, "i").test(allText)) {
      pronounHits++;
      issues.push({ level: "error", rule: "personal-pronoun", detail: `contains a first-person pronoun (pattern /${pattern}/)` });
    }
  }

  const score = Math.max(0, 100 - buzzwordHits * 10 - fillerHits * 5 - pronounHits * 15);
  return { score, issues };
}

/** Bucket: passive voice — 10% weight. Regex heuristic over be-verb + past participle. */
const PASSIVE_VOICE_RE = /\b(was|were|is|are|been|being)\s+\w+ed\b/i;
const IRREGULAR_PAST_PARTICIPLES = ["built", "written", "shown", "given", "driven", "spoken", "chosen", "taught", "brought", "sold", "held", "run", "grown"];

function passiveVoiceScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  let hits = 0;
  for (const { text } of allBullets(sections)) {
    const regexHit = PASSIVE_VOICE_RE.test(text);
    const irregularHit = IRREGULAR_PAST_PARTICIPLES.some((p) => new RegExp(`\\b(was|were|is|are|been|being)\\s+${p}\\b`, "i").test(text));
    if (regexHit || irregularHit) {
      hits++;
      issues.push({ level: "warning", rule: "passive-voice", detail: `passive construction: "${text}"` });
    }
  }
  const score = Math.max(0, 100 - hits * 20);
  return { score, issues };
}

/** Bucket: spelling — 10% weight. Curated misspelling list, no spellchecking dependency. */
function spellingScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const allText = allBullets(sections).map((b) => b.text).join(" ").toLowerCase();
  let hits = 0;
  for (const [misspelling, correction] of Object.entries(COMMON_MISSPELLINGS)) {
    if (new RegExp(`\\b${misspelling}\\b`, "i").test(allText)) {
      hits++;
      issues.push({ level: "error", rule: "spelling", detail: `"${misspelling}" should be "${correction}"` });
    }
  }
  const score = Math.max(0, 100 - hits * 25);
  return { score, issues };
}

/** Bucket: readability & ATS glyphs — 10% weight. Bullet length + non-standard glyphs + acronym expansion + keyword-stuffing cap + one-page budget. */
function readabilityAtsScore(master: MasterResume, sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  let severe = 0;
  let minor = 0;
  const bullets = allBullets(sections);
  const allText = bullets.map((b) => b.text).join("\n");

  for (const { text } of bullets) {
    const words = wordCount(text);
    if (words > 45) {
      severe++;
      issues.push({ level: "error", rule: "bullet-too-long", detail: `${words} words (>2 lines): "${text}"` });
    } else if (words > BULLET_GUIDELINES.idealWordRange[1] + 14) {
      minor++;
      issues.push({ level: "warning", rule: "bullet-long", detail: `${words} words: "${text}"` });
    }
    if (ATS_UNSAFE_GLYPHS.test(text)) {
      minor++;
      issues.push({ level: "warning", rule: "ats-glyph", detail: `non-standard glyph/emoji in: "${text}"` });
    }
  }

  for (const [acr, expansion] of Object.entries(ACRONYM_EXPANSIONS)) {
    const re = new RegExp(`\\b${acr.replace("/", "\\/")}\\b`, "i");
    if (re.test(allText) && !allText.toLowerCase().includes(expansion.toLowerCase())) {
      minor++;
      issues.push({ level: "warning", rule: "acronym-unexpanded", detail: `"${acr}" used without spelling out "${expansion}" once` });
    }
  }

  const haystack = allText.toLowerCase();
  for (const term of masterVocabulary(master)) {
    if (term.length < 3) continue;
    const count = haystack.split(term).length - 1;
    if (count > KEYWORD_REPEAT_CAP) {
      minor++;
      issues.push({ level: "warning", rule: "keyword-overuse", detail: `"${term}" repeated ${count}× (cap ${KEYWORD_REPEAT_CAP}) — reads as stuffing, not signal` });
    }
  }

  if (bullets.length > 18) {
    minor++;
    issues.push({ level: "warning", rule: "length-budget", detail: `${bullets.length} bullets — likely exceeds one page` });
  }

  const score = Math.max(0, 100 - severe * 20 - minor * 8);
  return { score, issues };
}

const BUCKET_WEIGHTS = {
  quantification: 0.30,
  weakVerbs: 0.15,
  tenses: 0.10,
  wordChoice: 0.15,
  passive: 0.10,
  spelling: 0.10,
  readability: 0.10,
} as const;

/** Deterministic ATS/format checks over the tailored bullets — weighted bucket sum. */
export function lintFormat(master: MasterResume, tailored: TailoredResume): FormatReport {
  const sections = [...tailored.experience, ...tailored.projects];

  const quantification = quantificationScore(sections);
  const weakVerbs = weakVerbsAndRepetitionScore(sections);
  const tenses = verbTenseScore(sections);
  const wordChoice = wordChoiceScore(sections);
  const passive = passiveVoiceScore(sections);
  const spelling = spellingScore(sections);
  const readability = readabilityAtsScore(master, sections);

  const score = Math.round(
    quantification.score * BUCKET_WEIGHTS.quantification +
    weakVerbs.score * BUCKET_WEIGHTS.weakVerbs +
    tenses.score * BUCKET_WEIGHTS.tenses +
    wordChoice.score * BUCKET_WEIGHTS.wordChoice +
    passive.score * BUCKET_WEIGHTS.passive +
    spelling.score * BUCKET_WEIGHTS.spelling +
    readability.score * BUCKET_WEIGHTS.readability
  );

  const issues = [
    ...quantification.issues,
    ...weakVerbs.issues,
    ...tenses.issues,
    ...wordChoice.issues,
    ...passive.issues,
    ...spelling.issues,
    ...readability.issues,
  ];

  return { score, issues };
}

/** Lowercased set of every tool/skill the candidate truthfully has. */
export function masterVocabulary(master: MasterResume): Set<string> {
  const vocab = new Set<string>();
  const add = (s: string) => s && vocab.add(s.toLowerCase());
  [...master.skills.languages, ...master.skills.frameworks, ...master.skills.tools].forEach(add);
  for (const e of [...master.experience, ...master.projects, ...master.extracurriculars])
    for (const bl of e.bullets) bl.tech.forEach(add);
  for (const p of master.projects) p.tech.forEach(add);
  return vocab;
}

export type KeywordCoverage = {
  /** Skills the candidate has that the JD also asks for. */
  relevant: string[];
  /** Of those, the ones surfaced in the tailored résumé. */
  covered: string[];
  /** Relevant skills NOT surfaced — actionable gaps for the critic/loop. */
  missing: string[];
  /** covered / relevant, 0–1. */
  ratio: number;
};

/** Deterministic JD-match: which truthful, JD-relevant skills did we surface? */
export function keywordCoverage(master: MasterResume, tailored: TailoredResume, jd: string): KeywordCoverage {
  const vocab = masterVocabulary(master);
  const jdLower = jd.toLowerCase();
  // Only count what the TAILORING surfaced (ordered skills + selected bullets),
  // not renderMarkdown's full fallback skills dump — otherwise coverage is trivially 100%.
  const surfaced = [
    tailored.skillsOrder.join(" "),
    tailored.keywordsCovered.join(" "),
    ...[...tailored.experience, ...tailored.projects].flatMap((s) => s.bullets.map((b) => b.text)),
  ].join(" ").toLowerCase();
  const resumeText = surfaced;

  const relevant = [...vocab].filter((term) => jdLower.includes(term));
  const covered = relevant.filter((term) => resumeText.includes(term));
  const missing = relevant.filter((term) => !resumeText.includes(term));
  return {
    relevant,
    covered,
    missing,
    ratio: relevant.length ? covered.length / relevant.length : 1,
  };
}
