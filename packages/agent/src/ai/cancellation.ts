/**
 * Cancellation registry for the background tailoring pipelines.
 *
 * Both pipelines (POST /api/tailor's suggestion run and POST
 * /api/resume/:id/apply-suggestions) execute in this process — there is no
 * queue layer — so a plain in-memory Map keyed by resume id is enough to reach
 * an in-flight run from a later HTTP request and abort it. The signal is
 * threaded down to the spawned `claude` subprocess, so cancelling actually
 * kills the model call rather than just discarding its result.
 *
 * A process restart drops the map. Any row still marked 'pending' at that
 * point was already orphaned by the restart itself, so nothing is lost.
 */

/** Thrown when a run is aborted by the user; distinguishes cancel from failure. */
export class CancelledError extends Error {
  constructor(message = "Generation was cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function isCancelledError(err: unknown): boolean {
  return err instanceof CancelledError || (err instanceof Error && err.name === "CancelledError");
}

const inFlight = new Map<string, AbortController>();

/**
 * Registers a run and returns its signal. Aborts any previous run for the same
 * id first — a duplicate registration means the earlier one was orphaned.
 */
export function registerRun(id: string): AbortSignal {
  inFlight.get(id)?.abort();
  const controller = new AbortController();
  inFlight.set(id, controller);
  return controller.signal;
}

/** Aborts the in-flight run for `id`. Returns false if there was nothing running. */
export function abortRun(id: string): boolean {
  const controller = inFlight.get(id);
  if (!controller) return false;
  controller.abort();
  inFlight.delete(id);
  return true;
}

/** Clears the registration once a run settles. Safe to call for an unknown id. */
export function clearRun(id: string): void {
  inFlight.delete(id);
}

/** Test/introspection helper — is a run currently registered for `id`? */
export function isRunning(id: string): boolean {
  return inFlight.has(id);
}
