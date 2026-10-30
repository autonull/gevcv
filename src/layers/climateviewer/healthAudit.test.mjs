import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from './catalog.json' with { type: 'json' };
import health from './health.json' with { type: 'json' };
import { auditClimateViewerHealth } from './healthAudit.js';

test('the committed health report matches the committed catalogue', () => {
  const audit = auditClimateViewerHealth(catalog, health);
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.missing, []);
  assert.deepEqual(audit.extra, []);
  assert.equal(audit.catalogHashMismatch, false);
  assert.equal(audit.summaryMismatch, false);
  assert.equal(audit.checkedAt, health.checkedAt);
  assert.equal(
    Object.values(audit.counts).reduce((sum, count) => sum + count, 0),
    Object.keys(catalog.layers).length,
  );
});

test('the audit reports hash drift, missing layers, and summary drift', () => {
  const audit = auditClimateViewerHealth(catalog, {
    ...health,
    catalogHash: 'deadbeef',
    results: { 'cv-live-usgs-all-hour': health.results['cv-live-usgs-all-hour'] },
    summary: { ...health.summary, ok: 999 },
  });
  assert.equal(audit.ok, false);
  assert.equal(audit.catalogHashMismatch, true);
  assert.equal(audit.summaryMismatch, true);
  assert.ok(audit.missing.length > 0);
});
