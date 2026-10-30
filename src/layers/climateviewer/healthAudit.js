const STATUSES = [
  'ok',
  'redirect',
  'cors',
  'dead',
  'key-required',
  'assets-missing',
  'untested',
];

/** Compare the generated health report with the committed catalogue. */
export function auditClimateViewerHealth(catalog, report) {
  const layerIds = Object.keys(catalog.layers ?? {});
  const results = report?.results ?? {};
  const resultIds = Object.keys(results);
  const missing = layerIds.filter((id) => !(id in results));
  const extra = resultIds.filter((id) => !(id in catalog.layers));
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const result of Object.values(results)) {
    const status = result?.status;
    if (status in counts) counts[status] += 1;
    else counts.untested += 1;
  }
  const summaryMismatch =
    Boolean(report?.summary) &&
    STATUSES.some((status) => (report.summary[status] ?? 0) !== counts[status]);
  const catalogHashMismatch =
    Boolean(report?.catalogHash) && report.catalogHash !== catalog.hash;
  return {
    ok:
      missing.length === 0 &&
      extra.length === 0 &&
      !summaryMismatch &&
      !catalogHashMismatch,
    checkedAt: report?.checkedAt ?? null,
    generatedFromSha: report?.generatedFromSha ?? null,
    catalogHashMismatch,
    summaryMismatch,
    missing,
    extra,
    counts,
  };
}
