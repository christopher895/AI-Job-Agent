import { z } from "zod";
import { buildClaudeCliArgs } from "./claude-cli";

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

console.log(allPass ? "\n✓ claude-cli test PASSED" : "\n✗ claude-cli test FAILED");
process.exit(allPass ? 0 : 1);
