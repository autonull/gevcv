import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_MAX_LAYERS,
  buildClimateViewerSnapshotModel,
} from './snapshotCard.js';

const layers = [
  {
    id: 'cv-a',
    name: 'Earthquakes',
    metadata: { sourceUrl: 'https://earthquake.usgs.gov/feed' },
  },
  {
    id: 'cv-b',
    name: 'NEXRAD Radar',
    metadata: { provider: { url: 'https://mesonet.agron.iastate.edu/wms' } },
  },
  {
    id: 'cv-c',
    name: 'Local baseline',
    metadata: { sourceUrl: 'https://earthquake.usgs.gov/other' },
  },
];

test('the snapshot model counts layers, dedupes sources, and fixes the timestamp', () => {
  const model = buildClimateViewerSnapshotModel(layers, {
    now: new Date('2026-10-30T12:34:56Z'),
  });
  assert.equal(model.layerCount, 3);
  assert.equal(model.timestamp, '2026-10-30 12:34:56 UTC');
  assert.deepEqual(model.attribution, [
    'earthquake.usgs.gov',
    'mesonet.agron.iastate.edu',
  ]);
  assert.equal(model.layers[0].name, 'Earthquakes');
  assert.match(model.credit, /ClimateViewer/);
});

test('the snapshot card caps the visible layer list', () => {
  const many = Array.from({ length: SNAPSHOT_MAX_LAYERS + 3 }, (_, index) => ({
    id: `cv-${index}`,
    name: `Layer ${index}`,
  }));
  const model = buildClimateViewerSnapshotModel(many);
  assert.equal(model.layerCount, SNAPSHOT_MAX_LAYERS + 3);
  assert.equal(model.layers.length, SNAPSHOT_MAX_LAYERS);
  assert.equal(model.omitted, 3);
});
