import type { MasterResume } from "./api";
import { masterToMarkdown, parseMasterMarkdown } from "./masterMarkdown";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const b = (id: string, text: string) => ({ id, text, tech: ["Go"], metrics: ["75%"], tags: ["t"] });

const master: MasterResume = {
  basics: {
    name: "Christopher Zhang",
    location: "Providence, RI",
    email: "me@example.edu",
    phone: "(704)-555-0100",
    github: "https://github.com/someone",
    linkedin: "",
    portfolio: "christopherzhang.dev",
    summary: "",
  },
  education: [{
    school: "Brown University",
    degrees: ["Sc.B. Computer Science", "A.B. Business Economics"],
    location: "Providence, RI",
    gpa: "3.93/4.00",
    graduation: "Expected May 2028",
    coursework: ["Data Structures", "Deep Learning"],
    notes: ["Varsity Student-Athlete"],
  }],
  experience: [
    { id: "exp-scout", company: "Scout Motors", title: "AI Engineer", location: "Charlotte, NC", start: "May 2026", end: "Present",
      bullets: [b("exp-scout-1", "Launched an AI assistant, cutting costs by $800K"), b("exp-scout-2", "Architected a platform")] },
    { id: "exp-mandy", company: "Mandy", title: "Software Engineering Intern", location: "Remote", start: "June 2025", end: "August 2025",
      bullets: [b("exp-mandy-1", "Built things")] },
  ],
  projects: [
    { id: "proj-dv", name: "DiveVolt", tech: ["Swift", "Next.js"], start: "", end: "", link: "divevolt.com", repo: "https://github.com/x/dv",
      bullets: [b("proj-dv-1", "Shipped an iOS coach app")] },
  ],
  extracurriculars: [
    { id: "extra-swim", company: "Brown Swimming", title: "Varsity Athlete", location: "Providence, RI", start: "2024", end: "Present",
      bullets: [b("extra-swim-1", "Trained 20 hrs/week")] },
  ],
  skills: { languages: ["Python", "Go"], frameworks: ["React"], tools: ["AWS (EKS, Lambda, Bedrock)", "Docker"], interests: ["Swimming"] },
  aboutMe: "private notes",
};

const md = masterToMarkdown(master);
check("renders tailored-style headings", md.includes("## Experience") && md.includes("**Scout Motors** — AI Engineer · Charlotte, NC · May 2026–Present"));
check("renders skills like tailored", md.includes("**Languages:** Python, Go"));
check("never renders aboutMe", !md.includes("private notes"));

const rt = parseMasterMarkdown(md, master);
check("round trip parses", rt.ok);
if (rt.ok) { const a = JSON.stringify(rt.resume), m = JSON.stringify(master); if (a !== m) { let i = 0; while (a[i] === m[i]) i++; console.error("diff at", a.slice(i - 60, i + 60), "\nvs", m.slice(i - 60, i + 60)); } check("round trip is lossless", a === m); }

check("parenthesized commas stay one skill", md.includes("AWS (EKS, Lambda, Bedrock), Docker"));

// Editing a bullet keeps its id and metadata; adding one gets a fresh id.
const edited = md
  .replace("- Architected a platform", "- Architected a serverless platform")
  .replace("- Built things", "- Built things\n- Wrote tests");
const e = parseMasterMarkdown(edited, master);
check("edited text parses", e.ok);
if (e.ok) {
  const scout = e.resume.experience[0];
  check("edited bullet keeps id", scout.bullets[1].id === "exp-scout-2" && scout.bullets[1].text === "Architected a serverless platform");
  check("edited bullet keeps tech/metrics", scout.bullets[1].metrics[0] === "75%");
  const mandy = e.resume.experience[1];
  check("new bullet gets a new id", mandy.bullets.length === 2 && !["exp-mandy-1", ""].includes(mandy.bullets[1].id));
  check("project repo survives (not shown in text)", e.resume.projects[0].repo === "https://github.com/x/dv");
  check("aboutMe survives", e.resume.aboutMe === "private notes");
}

// Reordering entries keeps ids matched by name.
const swapped = parseMasterMarkdown(
  md.replace(/(\*\*Scout Motors\*\*[\s\S]*?)(\*\*Mandy\*\*[\s\S]*?)(\n## Projects)/, "$2\n$1$3"),
  master,
);
check("reordered entries parse", swapped.ok);
if (swapped.ok) check("reordered entries keep ids by name", swapped.resume.experience[0].id === "exp-mandy" && swapped.resume.experience[1].id === "exp-scout");

// Plain hyphen dates and a missing location.
const loose = parseMasterMarkdown(md.replace("**Mandy** — Software Engineering Intern · Remote · June 2025–August 2025", "**Mandy** — SWE Intern · June 2025 - Aug 2025"), master);
check("loose header parses", loose.ok);
if (loose.ok) {
  const m = loose.resume.experience[1];
  check("hyphen dates split", m.start === "June 2025" && m.end === "Aug 2025" && m.location === "" && m.title === "SWE Intern");
}

// Errors point at the line instead of guessing.
const bad = parseMasterMarkdown(md.replace("- Built things", "Built things"), master);
check("non-bullet line is an error", !bad.ok && bad.errors[0].line === md.split("\n").findIndex((l) => l === "- Built things") + 1);
const badSection = parseMasterMarkdown(md + "\n\n## Awards\n- Thing", master);
check("unknown section is an error", !badSection.ok && /Unknown section/.test(badSection.errors[0].message));
const orphan = parseMasterMarkdown("# Name\n\n## Experience\n- floating bullet", master);
check("bullet without an entry is an error", !orphan.ok);

// Contact fields are recognized regardless of order.
const contact = parseMasterMarkdown("# A\nme@x.com · https://linkedin.com/in/a · Boston, MA · 617-555-0100", master);
check("contact parses in any order", contact.ok && contact.resume.basics.email === "me@x.com" && contact.resume.basics.linkedin.includes("linkedin")
  && contact.resume.basics.location === "Boston, MA" && contact.resume.basics.phone === "617-555-0100");

console.log(pass ? "\n✓ master-markdown test PASSED" : "\n✗ master-markdown test FAILED");
process.exit(pass ? 0 : 1);
