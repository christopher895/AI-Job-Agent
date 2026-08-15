import { registerRun, abortRun, clearRun, isRunning, CancelledError, isCancelledError } from "./cancellation";
import { runClaudeCliProcess } from "./claude-cli";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

// ── Registry ──────────────────────────────────────────────────────────────────

const sigA = registerRun("a");
check("registerRun returns a live (un-aborted) signal", !sigA.aborted && isRunning("a"));

check("abortRun reports it found a run", abortRun("a") === true);
check("abortRun fires the signal", sigA.aborted);
check("abortRun deregisters the run", !isRunning("a"));
check("abortRun on an unknown id is a no-op", abortRun("nope") === false);

// A second register for the same id must abort the first — a duplicate means
// the earlier run was orphaned and would otherwise leak an un-killable process.
const sigB1 = registerRun("b");
const sigB2 = registerRun("b");
check("re-registering aborts the previous run", sigB1.aborted);
check("re-registering leaves the new run live", !sigB2.aborted);
clearRun("b");
check("clearRun deregisters", !isRunning("b"));
check("clearRun on an unknown id is safe", (clearRun("nope"), true));

// clearRun must NOT abort — it runs in a `finally` after a successful run, and
// aborting there would fire the signal on every completed generation.
const sigC = registerRun("c");
clearRun("c");
check("clearRun does not abort the signal", !sigC.aborted);

// ── Error identification ──────────────────────────────────────────────────────

check("isCancelledError accepts a CancelledError", isCancelledError(new CancelledError()));
check("isCancelledError rejects an ordinary Error", !isCancelledError(new Error("boom")));
check("isCancelledError rejects a non-error", !isCancelledError("cancelled"));
// The pipelines compare across module instances, so name-matching is the fallback.
const lookalike = new Error("x");
lookalike.name = "CancelledError";
check("isCancelledError matches by name across realms", isCancelledError(lookalike));

// ── Subprocess actually dies ──────────────────────────────────────────────────
// The whole point of the hard cancel: aborting must kill the spawned child, not
// just discard its output. Uses `sleep` as a stand-in for the claude binary.

async function testSubprocessKill() {
  const controller = new AbortController();
  const started = Date.now();
  const promise = runClaudeCliProcess(["30"], process.cwd(), "", 60_000, controller.signal, "sleep");

  // Give the child a moment to actually spawn before pulling the plug.
  await new Promise((r) => setTimeout(r, 100));
  controller.abort();

  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  const elapsed = Date.now() - started;

  check("aborting rejects with a CancelledError", isCancelledError(caught));
  check(`abort rejects promptly, not after the timeout (${elapsed}ms)`, elapsed < 5_000);

  // A signal already aborted before the call must never spawn anything.
  const preAborted = AbortSignal.abort();
  let preCaught: unknown;
  try {
    await runClaudeCliProcess(["30"], process.cwd(), "", 60_000, preAborted, "sleep");
  } catch (err) {
    preCaught = err;
  }
  check("an already-aborted signal rejects without spawning", isCancelledError(preCaught));
}

testSubprocessKill()
  .catch((err) => {
    pass = false;
    console.error("✗ subprocess kill test threw:", err);
  })
  .then(() => {
    console.log(pass ? "\n✓ cancellation test PASSED" : "\n✗ cancellation test FAILED");
    process.exit(pass ? 0 : 1);
  });
