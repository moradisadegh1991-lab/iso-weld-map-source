/** A counting limiter for the extraction route: at most `max` readings run at once in this process; `acquire()` returns a release function, or null when full. */
export function createLimiter(max) {
  let active = 0;
  return { acquire() { if (active >= max) return null; active++; let done = false; return () => { if (!done) { done = true; active--; } }; }, get active() { return active; }, max };
}
