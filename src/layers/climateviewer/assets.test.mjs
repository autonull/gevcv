import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogAssetStatus,
  layerAssetStatus,
  loadClimateViewerAssetManifest,
} from './assets.js';

const manifest = {
  version: 1,
  catalogHash: 'deadbeef',
  files: { '/cv/layers/a.geojson': { bytes: 1 } },
};

test('catalogAssetStatus distinguishes missing and stale manifests', () => {
  assert.equal(catalogAssetStatus(null, 'deadbeef'), 'assets-missing');
  assert.equal(catalogAssetStatus(manifest, 'deadbeef'), 'ok');
  assert.equal(catalogAssetStatus(manifest, 'cafebabe'), 'stale');
});

test('layerAssetStatus only judges local layers', () => {
  assert.equal(
    layerAssetStatus({ url: '/cv/layers/a.geojson' }, manifest),
    'ok',
  );
  assert.equal(
    layerAssetStatus({ url: '/cv/layers/b.geojson' }, manifest),
    'assets-missing',
  );
  assert.equal(
    layerAssetStatus({ url: '/cv/layers/a.geojson' }, null),
    'assets-missing',
  );
  assert.equal(
    layerAssetStatus({ url: 'https://example.com/a.geojson' }, manifest),
    null,
  );
});

test('loadClimateViewerAssetManifest tolerates absence and bad payloads', async () => {
  assert.equal(
    await loadClimateViewerAssetManifest({
      fetchImpl: async () => ({ ok: false }),
    }),
    null,
  );
  assert.equal(
    await loadClimateViewerAssetManifest({
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }),
    null,
  );
  assert.deepEqual(
    await loadClimateViewerAssetManifest({
      fetchImpl: async () => ({ ok: true, json: async () => manifest }),
    }),
    manifest,
  );
});
