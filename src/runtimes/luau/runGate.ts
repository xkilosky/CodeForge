/**
 * One-at-a-time access to the shared Lua worker.
 *
 * `LuaWorker` accepts exactly one operation at a time. A second concurrent call
 * is **rejected** with `another Lua execute operation is already active`; it is
 * not queued. That contract is easy to violate from the outside: the simulation
 * loop schedules a script tick from `requestAnimationFrame` whenever its
 * interval has elapsed, which is deliberately not synchronised with how long an
 * execution takes.
 *
 * The consequences of letting that rejection through were worse than a lost
 * tick. The loop's failure counter treated it as a broken script, so three slow
 * ticks in a row stopped the whole simulation with a message blaming the user's
 * code — and until they did, the error was printed on every tick.
 *
 * So: queue, do not drop. Tasks run in the order they were requested, one at a
 * time, and a failing task does not poison the queue (otherwise every later
 * tick would reject with the first error, forever).
 *
 * The gate is a module singleton because the worker it guards is one.
 */

type Task<T> = () => Promise<T>;

export function createRunGate(): <T>(task: Task<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();

  return function serializeRuns<T>(task: Task<T>): Promise<T> {
    // `.then(task, task)` runs the task whether or not the previous one
    // settled — a rejected predecessor must not cancel the queue.
    const result = chain.then(task, task);
    // The chain itself swallows errors so it can never become permanently
    // rejected; the caller still sees the rejection through `result`.
    chain = result.catch(() => undefined);
    return result;
  };
}

export const serializeRuns = createRunGate();
