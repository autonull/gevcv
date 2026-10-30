import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from './catalog.json' with { type: 'json' };
import { hashLayerEntries } from '../../../scripts/sync-cv-catalog.mjs';

const layers = Object.values(catalog.layers);

test('catalog v2 exposes a stable hash and source revision', () => {
  assert.equal(catalog.version, 2);
  assert.match(catalog.hash, /^[a-f0-9]{8}$/);
  assert.equal(hashLayerEntries(catalog.layers).slice(0, 8), catalog.hash);
  assert.match(catalog.generatedFromSha, /^[a-f0-9]{40}$/);
});

test('every catalog layer has a valid id and a unique tree entry', () => {
  const treeIds = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'layer') treeIds.push(node.id);
      else visit(node.children);
    }
  };
  visit(catalog.tree);
  assert.equal(treeIds.length, layers.length);
  assert.equal(new Set(treeIds).size, treeIds.length);
  for (const layer of layers) {
    assert.match(layer.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(treeIds.includes(layer.id));
  }
});

test('every catalog layer carries traits and a provider', () => {
  for (const layer of layers) {
    assert.deepEqual(layer.traits, { nameIsData: true, voice: 'off' });
    assert.ok(layer.provider, layer.id);
    assert.ok(layer.category.length > 0, layer.id);
    assert.ok(['overlay', 'basemap'].includes(layer.role), layer.id);
    assert.ok(
      [
        'kml',
        'geojson',
        'arcgis',
        'wms',
        'gibs',
        'cartodb',
        'baseLayer',
        'bing',
      ].includes(layer.family),
      layer.id,
    );
  }
});

test('local layers reference the synced asset prefix', () => {
  const local = layers.filter((layer) => layer.url.startsWith('/cv/'));
  assert.ok(local.length >= 76);
  for (const layer of local) assert.match(layer.url, /^\/cv\//);
});
