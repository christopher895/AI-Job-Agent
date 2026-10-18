import { CancelledError } from "../cancellation";

/**
 * A tiny promise pool. Every grader specialist is its own `claude -p`
 * subprocess, and the agent has hit Railway's memory ceiling before (see the
 * Jobright removal), so all grades share one pool rather than each spawning five.
 */

export type Limiter = {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  readonly active: number;
  readonly queued: number;
};

export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  function pump() {
    while (active < max && queue.length > 0) queue.shift()!();
  }

  return {
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) { reject(new CancelledError()); return; }

        // A cancel while queued leaves the queue right away instead of waiting
        // for a slot another grade might hold for a minute.
        const onAbort = () => {
          const i = queue.indexOf(start);
          if (i >= 0) { queue.splice(i, 1); reject(new CancelledError()); }
        };
        const start = () => {
          signal?.removeEventListener("abort", onAbort);
          active++;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => { active--; pump(); });
        };

        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(start);
        pump();
      });
    },
    get active() { return active; },
    get queued() { return queue.length; },
  };
}

/** Shared by every grade run. Tailoring does not go through this. */
export const graderLimit = createLimiter(2);
