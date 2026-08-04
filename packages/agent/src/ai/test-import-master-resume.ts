import { importMasterResume, dedupeIds } from "./import-master-resume";
import { MasterResumeSchema, MasterResume } from "./types";

// A small, deliberately plain-text fixture — the kind of thing pasted straight
// from a Google Doc or extracted from a PDF, with no markdown/LaTeX structure.
const FIXTURE = `
Jordan Lee
Boston, MA · jordan.lee@example.com · (555) 123-4567
github.com/jordanlee

EXPERIENCE

Acme Corp — Backend Engineer · Boston, MA · June 2023 - Present
- Rebuilt the checkout service in Go, cutting p99 latency from 800ms to 210ms
- Migrated 40+ cron jobs off a legacy scheduler onto Kubernetes CronJobs

PROJECTS

Recipe Finder · React, Node.js, PostgreSQL · Jan 2023 - Mar 2023
- Built a full-text search feature over 10,000+ recipes using PostgreSQL tsvector

SKILLS
Languages: Go, TypeScript, SQL
Frameworks: React, Express
Tools: Docker, Kubernetes, PostgreSQL

EDUCATION
Boston University — B.S. Computer Science · Boston, MA · May 2023
`.trim();

async function main() {
  const result = await importMasterResume(FIXTURE);
  const parsed = MasterResumeSchema.safeParse(result);

  const allBulletText = [
    ...result.experience.flatMap((e) => e.bullets.map((b) => b.text)),
    ...result.projects.flatMap((p) => p.bullets.map((b) => b.text)),
  ].join(" | ");

  // Wording must be preserved verbatim — this is an import, not a rewrite.
  const preservesWording =
    allBulletText.includes("cutting p99 latency from 800ms to 210ms") &&
    allBulletText.includes("10,000+ recipes");

  const hasStableIds =
    result.experience.every((e) => e.id && e.bullets.every((b) => b.id)) &&
    result.projects.every((p) => p.id && p.bullets.every((b) => b.id));

  console.log("Schema valid:", parsed.success);
  if (!parsed.success) console.log(parsed.error.flatten());
  console.log("Preserves wording verbatim:", preservesWording);
  console.log("Has stable ids:", hasStableIds);
  console.log("Name:", result.basics.name, "| Email:", result.basics.email);

  // --- Offline check: dedupeIds() must resolve colliding ids without any LLM call ---
  // Simulates what an LLM might produce: two experience entries that both got
  // slugged to "exp-engineer" (e.g. two different companies, same job title).
  const collidingFixture: MasterResume = {
    basics: { name: "Test User", location: "", email: "", phone: "", github: "", linkedin: "", portfolio: "", summary: "" },
    education: [],
    experience: [
      {
        id: "exp-engineer",
        company: "Acme Corp",
        title: "Engineer",
        location: "",
        start: "",
        end: "",
        bullets: [
          { id: "exp-engineer-1", text: "Did thing A", tech: [], metrics: [], tags: [] },
          { id: "exp-engineer-2", text: "Did thing B", tech: [], metrics: [], tags: [] },
        ],
      },
      {
        id: "exp-engineer",
        company: "Widget Inc",
        title: "Engineer",
        location: "",
        start: "",
        end: "",
        bullets: [
          { id: "exp-engineer-1", text: "Did thing C", tech: [], metrics: [], tags: [] },
        ],
      },
    ],
    projects: [],
    extracurriculars: [],
    skills: { languages: [], frameworks: [], tools: [], interests: [] },
  };

  const deduped = dedupeIds(collidingFixture);
  const [first, second] = deduped.experience;

  const idsAreUnique = first.id !== second.id;
  const firstIdUnchanged = first.id === "exp-engineer";
  const secondIdRenumbered = second.id === "exp-engineer-2";
  const firstBulletsRenumbered =
    first.bullets[0].id === `${first.id}-1` && first.bullets[1].id === `${first.id}-2`;
  const secondBulletsRenumbered = second.bullets[0].id === `${second.id}-1`;
  const bulletTextPreserved =
    first.bullets[0].text === "Did thing A" &&
    first.bullets[1].text === "Did thing B" &&
    second.bullets[0].text === "Did thing C";

  const dedupePass =
    idsAreUnique &&
    firstIdUnchanged &&
    secondIdRenumbered &&
    firstBulletsRenumbered &&
    secondBulletsRenumbered &&
    bulletTextPreserved;

  console.log("\n--- dedupeIds() offline check ---");
  console.log("Entry ids are unique:", idsAreUnique, `(${first.id}, ${second.id})`);
  console.log("Bullets renumbered under new entry ids:", firstBulletsRenumbered && secondBulletsRenumbered);
  console.log("Bullet text preserved verbatim:", bulletTextPreserved);
  console.log("dedupeIds offline check:", dedupePass ? "PASSED" : "FAILED");

  const pass = parsed.success && preservesWording && hasStableIds && dedupePass;
  console.log(pass ? "\n✓ import-master-resume test PASSED" : "\n✗ import-master-resume test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
