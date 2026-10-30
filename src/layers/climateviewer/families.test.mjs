import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Cesium from 'cesium';
import { createClimateViewerLayer } from './index.js';
import { createImageryFamily } from './families/imageryFamily.js';
import { createVectorFamily } from './families/vectorFamily.js';
import { createFamily, familyFactory } from './families/index.js';

const definition = {
  id: 'cv-test-layer',
  cvId: 'test',
  name: 'Test layer',
  family: 'geojson',
  role: 'overlay',
  category: ['Live'],
  provider: { kind: 'geojson', url: '/cv/a.geojson' },
  flags: { timeline: false, large: false, noFeatures: false },
  traits: { nameIsData: true, voice: 'off' },
};

function fakeViewer() {
  const imagery = [];
  const sources = [];
  const flights = [];
  return {
    canvas: {},
    camera: { flyTo: (options) => flights.push(options) },
    flights,
    imageryLayers: {
      add: (layer) => imagery.push(layer),
      remove: (layer) => {
        const index = imagery.indexOf(layer);
        if (index >= 0) imagery.splice(index, 1);
      },
    },
    dataSources: {
      add: async (source) => sources.push(source),
      remove: (source) => {
        const index = sources.indexOf(source);
        if (index >= 0) sources.splice(index, 1);
      },
    },
    imagery,
    sources,
  };
}

function fakeSource(count = 2) {
  return {
    show: false,
    entities: { values: Array.from({ length: count }, (_, id) => ({ id })) },
  };
}

test('family registry resolves every catalog family and rejects unknown ids', () => {
  for (const family of [
    'kml',
    'geojson',
    'arcgis',
    'wms',
    'gibs',
    'cartodb',
    'baseLayer',
    'bing',
  ]) {
    assert.equal(typeof familyFactory(family), 'function', family);
    assert.equal(
      createFamily({ ...definition, family }).kind,
      family === 'kml' || family === 'geojson' ? 'vector' : 'imagery',
    );
  }
  assert.throws(
    () => createFamily({ ...definition, family: 'nope' }),
    /Unsupported ClimateViewer family/,
  );
});

test('the layer shell delegates lifecycle to its family', async () => {
  const calls = [];
  const family = {
    attach: async () => {
      calls.push('attach');
      return true;
    },
    detach: () => calls.push('detach'),
    records: () => [{ id: 'one' }],
    stats: () => ({ count: 1, status: 'ok', error: null, lastUpdate: 1 }),
  };
  const layer = createClimateViewerLayer(definition, {
    familyFor: () => family,
  });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(await layer.enable(), true);
  assert.equal(await layer.update(), true);
  assert.deepEqual(layer.getAnalystRecords(), [{ id: 'one' }]);
  assert.equal(layer.getStats().available, true);
  layer.disable();
  layer.destroy();
  assert.deepEqual(calls, ['attach', 'detach', 'detach']);
  assert.equal(layer.getStats().status, 'destroyed');
});

test('a late vector response is ignored after disable', async () => {
  const viewer = fakeViewer();
  let resolveLoad;
  const loadVector = () =>
    new Promise((resolve) => {
      resolveLoad = resolve;
    });
  const family = createVectorFamily(definition, { loadVector });
  const attach = family.attach(viewer);
  family.detach();
  const source = fakeSource();
  resolveLoad(source);
  assert.equal(await attach, false);
  assert.equal(source.show, false);
  assert.equal(viewer.sources.length, 0);
  assert.equal(family.stats().status, 'idle');
});

test('a vector layer reports loaded entity count', async () => {
  const viewer = fakeViewer();
  const family = createVectorFamily(definition, {
    loadVector: async () => fakeSource(3),
  });
  assert.equal(await family.attach(viewer), true);
  assert.equal(viewer.sources.length, 1);
  assert.equal(viewer.sources[0].show, true);
  assert.equal(family.stats().status, 'ok');
  assert.equal(family.stats().count, 3);
  family.detach();
  assert.equal(viewer.sources.length, 0);
});

test('zoomTo flies to the vector data bounds', async () => {
  const viewer = fakeViewer();
  const source = fakeSource(2);
  source.entities.values = [
    {
      id: 'a',
      position: { getValue: () => Cesium.Cartesian3.fromDegrees(-10, 40) },
    },
    {
      id: 'b',
      position: { getValue: () => Cesium.Cartesian3.fromDegrees(10, 50) },
    },
  ];
  const family = createVectorFamily(definition, {
    loadVector: async () => source,
  });
  await family.attach(viewer);
  assert.equal(family.zoomTo(), true);
  assert.equal(viewer.flights.length, 1);
  assert.equal(viewer.flights[0].duration, 1.2);
});

test('a time-enabled imagery layer rebuilds when the clock advances', () => {
  const viewer = fakeViewer();
  const listeners = new Set();
  const clock = {
    isoDate: () => '2026-01-01',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const times = [];
  const family = createImageryFamily(
    { ...definition, family: 'gibs', provider: { time: true } },
    {
      clock,
      providerFor: (_definition, { time }) => {
        times.push(time);
        return {};
      },
      createImagery: (provider) => ({ provider }),
    },
  );
  assert.equal(family.attach(viewer), true);
  assert.equal(viewer.imagery.length, 1);
  for (const listener of listeners) listener(clock);
  assert.equal(viewer.imagery.length, 1);
  assert.deepEqual(times, ['2026-01-01', '2026-01-01']);
  family.detach();
  assert.equal(viewer.imagery.length, 0);
  assert.equal(listeners.size, 0);
});
