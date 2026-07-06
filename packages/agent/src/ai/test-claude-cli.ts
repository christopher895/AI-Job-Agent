import { z } from "zod";
import { buildClaudeCliArgs, parseClaudeCliOutput } from "./claude-cli";

let allPass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    allPass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

// --- buildClaudeCliArgs ---
{
  const schema = z.object({ foo: z.string() });
  const args = buildClaudeCliArgs(schema, { system: "be helpful" });
  check(
    "args-system-prompt",
    args.includes("--system-prompt") && args[args.indexOf("--system-prompt") + 1] === "be helpful",
    `got: ${JSON.stringify(args)}`
  );
  check(
    "args-output-format",
    args.includes("--output-format") && args[args.indexOf("--output-format") + 1] === "json"
  );
  check("args-json-schema-present", args.includes("--json-schema"));
  check("args-no-model-flag-when-unset", !args.includes("--model"), "should omit --model when opts.model is undefined");
}
{
  const schema = z.object({ foo: z.string() });
  const args = buildClaudeCliArgs(schema, { system: "be helpful", model: "claude-sonnet-5" });
  check(
    "args-model-flag-when-set",
    args.includes("--model") && args[args.indexOf("--model") + 1] === "claude-sonnet-5"
  );
}

// --- parseClaudeCliOutput ---
{
  const out = parseClaudeCliOutput(JSON.stringify({ is_error: false, structured_output: { foo: "bar" } }));
  check("parse-success", JSON.stringify(out) === JSON.stringify({ foo: "bar" }), `got: ${JSON.stringify(out)}`);
}
{
  let threw = false;
  try {
    parseClaudeCliOutput(JSON.stringify({ is_error: true, result: "auth failed" }));
  } catch (e) {
    threw = e instanceof Error && e.message.includes("auth failed");
  }
  check("parse-is-error-throws", threw, "expected a throw mentioning the error result");
}
{
  let threw = false;
  try {
    parseClaudeCliOutput(JSON.stringify({ is_error: false }));
  } catch (e) {
    threw = e instanceof Error && e.message.includes("structured_output");
  }
  check("parse-missing-structured-output-throws", threw);
}
{
  let threw = false;
  try {
    parseClaudeCliOutput("not json");
  } catch (e) {
    threw = e instanceof Error;
  }
  check("parse-malformed-json-throws", threw);
}

console.log(allPass ? "\n✓ claude-cli test PASSED" : "\n✗ claude-cli test FAILED");
process.exit(allPass ? 0 : 1);
