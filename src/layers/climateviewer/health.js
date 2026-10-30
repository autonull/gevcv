/**
 * Health vocabulary for ClimateViewer layers. Pure data and classification:
 * the probe script does the network work, the panel reads the result file.
 */

export const HEALTH_STATUSES = Object.freeze([
  'ok',
  'redirect',
  'cors',
  'dead',
  'key-required',
  'assets-missing',
  'untested',
]);

const HEALTH_STATUS_SET = new Set(HEALTH_STATUSES);

export function isHealthStatus(value) {
  return HEALTH_STATUS_SET.has(value);
}

/**
 * Map one probe outcome to a health status.
 * @param {{status?: number, redirected?: boolean, error?: unknown, keyRequired?: boolean}} probe
 */
export function classifyProbe({
  status = 0,
  redirected = false,
  error = null,
  keyRequired = false,
} = {}) {
  if (keyRequired) return 'key-required';
  if (error || !Number.isFinite(status) || status === 0) return 'cors';
  if (status >= 200 && status < 300) return redirected ? 'redirect' : 'ok';
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 401 || status === 403 || status === 407) return 'cors';
  if (status === 404 || status === 410 || status >= 500) return 'dead';
  return 'dead';
}

/** Health for a local asset reference, or null when the URL is remote. */
export function classifyLocalAsset(url, exists) {
  if (!String(url ?? '').startsWith('/cv/')) return null;
  return exists ? 'ok' : 'assets-missing';
}

/** Count statuses in a `health.json` results table. */
export function summarizeHealth(results = {}) {
  const summary = Object.fromEntries(
    HEALTH_STATUSES.map((status) => [status, 0]),
  );
  for (const result of Object.values(results)) {
    const status = result?.status;
    if (isHealthStatus(status)) summary[status] += 1;
    else summary.untested += 1;
  }
  summary.total = Object.keys(results).length;
  return summary;
}

/** Map layer id → status, with `untested` for absent entries. */
export function healthStatusMap(health) {
  return new Map(
    Object.entries(health?.results ?? {}).map(([id, result]) => [
      id,
      isHealthStatus(result?.status) ? result.status : 'untested',
    ]),
  );
}
