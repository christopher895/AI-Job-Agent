import { createLimiter } from "./limit";
import { isCancelledError } from "../cancellation";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

async function main() {
  // Never more than max in flight
  {
    const lim = createLimiter(2);
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const runs = gates.map((g, i) =>
      lim.run(async () => { peak = Math.max(peak, lim.active); await g.promise; return i; })
    );
    await tick();
    check("only 2 start immediately", lim.active === 2 && lim.queued === 3);
    gates.forEach((g) => g.resolve());
    const out = await Promise.all(runs);
    check("peak concurrency is 2", peak === 2);
    check("all tasks resolve with their own values", out.join(",") === "0,1,2,3,4");
    check("limiter drains", lim.active === 0 && lim.queued === 0);
  }

  // A failing task frees its slot
  {
    const lim = createLimiter(1);
    const first = lim.run(async () => { throw new Error("boom"); });
    const second = lim.run(async () => "ok");
    const r1 = await first.catch((e) => (e as Error).message);
    check("failing task rejects with its error", r1 === "boom");
    check("next task still runs after a failure", (await second) === "ok");
  }

  // Abort while queued rejects immediately and never runs the task
  {
    const lim = createLimiter(1);
    const hold = deferred();
    const blocker = lim.run(() => hold.promise);
    const ctl = new AbortController();
    let ran = false;
    const queued = lim.run(async () => { ran = true; }, ctl.signal);
    await tick();
    ctl.abort();
    const err = await queued.catch((e) => e);
    check("queued task rejects with CancelledError on abort", isCancelledError(err));
    check("aborted queued task never ran", !ran);
    check("aborted task left the queue", lim.queued === 0);
    hold.resolve();
    await blocker;
  }

  // Already-aborted signal rejects without queueing
  {
    const lim = createLimiter(2);
    const ctl = new AbortController();
    ctl.abort();
    let ran = false;
    const err = await lim.run(async () => { ran = true; }, ctl.signal).catch((e) => e);
    check("pre-aborted signal rejects with CancelledError", isCancelledError(err) && !ran);
  }

  console.log(pass ? "\n✓ grade-limit test PASSED" : "\n✗ grade-limit test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
