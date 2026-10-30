const DAY_MS = 86_400_000;

/** Day-granularity clock shared by time-enabled ClimateViewer imagery. */
export function createClimateViewerClock({ now = () => new Date() } = {}) {
  let day = startOfDay(now().getTime());
  const listeners = new Set();

  function startOfDay(time) {
    const date = new Date(time);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  const getDate = () => new Date(day);
  const isoDate = () => new Date(day).toISOString().slice(0, 10);

  function setDate(value) {
    const next = startOfDay(new Date(value).getTime());
    if (next === day) return getDate();
    day = next;
    for (const listener of listeners) listener(getDate());
    return getDate();
  }

  function step(days) {
    return setDate(day + days * DAY_MS);
  }

  return {
    getDate,
    isoDate,
    setDate,
    step,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
    },
  };
}
