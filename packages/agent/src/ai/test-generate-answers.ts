import { MASTER_RESUME } from "./master-resume";
import { RawApplicationAnswersSchema } from "./types";
import { answerContext, assignAnswerIds, MAX_ANSWERS } from "./generate-answers";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) {
    pass = false;
    console.error("✗", label);
  } else {
    console.log("✓", label);
  }
}

const ctx = answerContext(MASTER_RESUME);

check("context includes the candidate name", ctx.name === MASTER_RESUME.basics.name);
check("context includes education", ctx.education.length === MASTER_RESUME.education.length);
check("experience bullets are plain strings", typeof ctx.experience[0]?.bullets[0] === "string");
check("project names survive", ctx.projects.some((p) => p.name === "Dating Profile Analyzer"));
check("context has no bullet ids (essays don't need them)", !JSON.stringify(ctx).includes("exp-scout-1"));

const raw = RawApplicationAnswersSchema.parse({
  answers: [
    { question: "Why this role?", answer: "I built the job agent because rewriting the same resume was stupid." },
    { question: "Tell us about a project.", answer: "I shipped a dating-profile analyzer that scores photos and writes bios." },
  ],
});
const items = assignAnswerIds(raw);
check("assigns stable ans-N ids", items[0].id === "ans-1" && items[1].id === "ans-2");
check("trims question/answer text", items[0].question === "Why this role?");

check(
  "rejects an empty answers array",
  RawApplicationAnswersSchema.safeParse({ answers: [] }).success === false
);
check(
  "rejects a blank answer",
  RawApplicationAnswersSchema.safeParse({ answers: [{ question: "Why?", answer: "" }] }).success === false
);

const tooMany = {
  answers: Array.from({ length: MAX_ANSWERS + 1 }, (_, i) => ({
    question: `Q${i + 1}?`,
    answer: `A${i + 1}`,
  })),
};
check(
  `rejects more than ${MAX_ANSWERS} answers`,
  RawApplicationAnswersSchema.safeParse(tooMany).success === false
);

const capped = assignAnswerIds({
  answers: tooMany.answers.slice(0, MAX_ANSWERS),
});
check("assignAnswerIds keeps at most MAX_ANSWERS", capped.length === MAX_ANSWERS);

console.log(pass ? "\n✓ generate-answers test PASSED" : "\n✗ generate-answers test FAILED");
process.exit(pass ? 0 : 1);
