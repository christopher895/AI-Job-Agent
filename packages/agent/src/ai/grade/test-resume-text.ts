import { MASTER_RESUME } from "../master-resume";
import { masterToText } from "./resume-text";
import { MasterResume } from "../types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const master: MasterResume = { ...MASTER_RESUME, aboutMe: "SECRET-ABOUT-ME-NOTES" };
const text = masterToText(master);

check("includes the candidate name", text.includes(master.basics.name));
check("never includes About me notes", !text.includes("SECRET-ABOUT-ME-NOTES"));

const headings = ["Education", "Experience", "Projects", "Extracurriculars", "Skills & Interests"];
const present = headings.filter((h) => text.split("\n").includes(h));
const positions = present.map((h) => text.split("\n").indexOf(h));
check("section headings match the PDF and appear in PDF order",
  positions.every((p, i) => i === 0 || p > positions[i - 1]));

const sections = [...master.experience, ...master.projects, ...master.extracurriculars];
const allBullets = sections.flatMap((s) => s.bullets.map((b) => b.text));
check("every bullet appears", allBullets.every((b) => text.includes(b)));
let last = -1, ordered = true;
for (const b of allBullets) {
  const at = text.indexOf(b, last + 1);
  if (at <= last) { ordered = false; break; }
  last = at;
}
check("bullets keep master order", ordered);
check("every experience company appears", master.experience.every((e) => text.includes(e.company)));
check("every project name appears", master.projects.every((p) => text.includes(p.name)));
check("skills appear", master.skills.languages.every((l) => text.includes(l)));

const noProjects = masterToText({ ...master, projects: [] });
check("empty section emits no heading", !noProjects.split("\n").includes("Projects"));

console.log(pass ? "\n✓ resume-text test PASSED" : "\n✗ resume-text test FAILED");
process.exit(pass ? 0 : 1);
