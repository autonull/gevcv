import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIMATEVIEWER_PACKS,
  STARTER_PACK_ID,
  activeClimateViewerPackId,
  getClimateViewerPack,
  starterClimateViewerLayerIds,
} from './packs.js';
import {
  climateViewerDeepLinkLayerId,
  climateViewerLayerDeepLink,
  climateViewerMarkdownTable,
} from './atlasLinks.js';
import { CLIMATEVIEWER_LAYER_ORDER } from './shareState.js';

test('all four packs are non-empty and reference catalog layers', () => {
  assert.equal(CLIMATEVIEWER_PACKS.length, 4);
  assert.deepEqual(
    CLIMATEVIEWER_PACKS.map(({ id }) => id),
    ['disaster-watch', 'energy-grid', 'surveillance-atlas', 'climate-baseline'],
  );
  const order = new Set(CLIMATEVIEWER_LAYER_ORDER);
  for (const pack of CLIMATEVIEWER_PACKS) {
    assert.ok(pack.layers.length >= 7, `${pack.id} is too small`);
    assert.equal(new Set(pack.layers).size, pack.layers.length);
    for (const id of pack.layers)
      assert.equal(order.has(id), true, `${pack.id} -> ${id}`);
  }
  assert.equal(STARTER_PACK_ID, 'disaster-watch');
  assert.deepEqual(
    starterClimateViewerLayerIds(),
    [],
    'startup must not auto-enable a CV pack',
  );
});

test('the active pack is the one whose layer set exactly matches', () => {
  const pack = getClimateViewerPack('energy-grid');
  assert.equal(activeClimateViewerPackId(pack.layers), 'energy-grid');
  assert.equal(activeClimateViewerPackId([]), null);
  assert.equal(activeClimateViewerPackId(pack.layers.slice(1)), null);
  assert.equal(activeClimateViewerPackId([...pack.layers, 'cv-extra']), null);
});

test('deep links carry a layer id and drop stale hash state', () => {
  const href = climateViewerLayerDeepLink(
    'cv-live-usgs-all-today',
    'https://example.test/app/?x=1#v=3&cv=AAA',
  );
  const url = new URL(href);
  assert.equal(url.searchParams.get('layer'), 'cv-live-usgs-all-today');
  assert.equal(url.hash, '');
  assert.equal(
    climateViewerDeepLinkLayerId(url.search),
    'cv-live-usgs-all-today',
  );
  assert.equal(climateViewerDeepLinkLayerId('?layer=not-cv'), null);
});

test('Markdown atlas cells escape pipes and newlines', () => {
  const table = climateViewerMarkdownTable([
    {
      name: 'Pipes | Layers',
      family: 'kml',
      metadata: {
        category: ['Live', 'Earthquake'],
        role: 'overlay',
        sourceUrl: 'https://example.test/a|b\nc',
      },
    },
  ]);
  assert.match(table, /^\| Layer \| Category \| Family \| Role \| Source \|/);
  assert.match(table, /Pipes \\\| Layers/);
  assert.match(table, /Live \/ Earthquake/);
  assert.match(table, /https:\/\/example\.test\/a\\\|b c/);
});
