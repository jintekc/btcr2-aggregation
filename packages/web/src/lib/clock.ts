// Monotonic millisecond clock anchored at module load. Used for log/event
// ordering and relative timestamps so the UI never depends on wall-clock time.
const origin = performance.now();

/** Milliseconds elapsed since the app loaded. */
export function elapsed(): number {
  return Math.round(performance.now() - origin);
}

/**
 * Render a SERVER wall-clock ms stamp as a local `HH:MM:SS` time (D-22).
 *
 * The operator-side logs (a cohort's activity ring, the service-level operator actions) and the
 * submission times carry server wall-clock stamps, not the participant-side elapsed offset, so
 * they must render as a real clock time rather than a `mm:ss.mmm` duration. It lives here beside
 * {@link fmtElapsed} so both operator surfaces that need it share ONE definition: two copies of a
 * timestamp format are two things that can drift on one screen.
 */
export function fmtWallClock(t: number): string {
  return new Date(t).toLocaleTimeString();
}

/** Format an elapsed-ms value as `mm:ss.mmm` for the log gutter. */
export function fmtElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  const mmm = String(ms % 1000).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}
