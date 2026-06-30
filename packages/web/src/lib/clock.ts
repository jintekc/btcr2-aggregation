// Monotonic millisecond clock anchored at module load. Used for log/event
// ordering and relative timestamps so the UI never depends on wall-clock time.
const origin = performance.now();

/** Milliseconds elapsed since the app loaded. */
export function elapsed(): number {
  return Math.round(performance.now() - origin);
}

/** Format an elapsed-ms value as `mm:ss.mmm` for the log gutter. */
export function fmtElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  const mmm = String(ms % 1000).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}
