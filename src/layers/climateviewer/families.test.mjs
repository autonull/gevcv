import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Cesium from 'cesium';
import { createClimateViewerLayer } from './index.js';
import { createImageryFamily } from './families/imageryFamily.js';
import { createVectorFamily } from './families/vectorFamily.js';
import { createFamily, familyFactory } from './families/index.js';
import {
  CLIMATEVIEWER_BASEMAPS,
  createClimateViewerBasemapSources,
  isClimateViewerBasemapId,
} from './basemaps.js';

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

function fakeProgressiveSource(count = 2) {
  let values = Array.from({ length: count }, (_, id) => ({ id }));
  return {
    show: false,
    entities: {
      get values() {
        return values;
      },
      removeAll() {
        values = [];
      },
      add(entity) {
        values.push(entity);
      },
    },
  };
}

test('every catalog basemap becomes one exclusive map-stack source', () => {
  const sources = createClimateViewerBasemapSources();
  assert.equal(sources.length, 11);
  assert.equal(sources.length, CLIMATEVIEWER_BASEMAPS.length);
  assert.equal(new Set(sources.map(({ descriptor }) => descriptor.id)).size, 11);
  for (const source of sources) {
    assert.equal(isClimateViewerBasemapId(source.descriptor.id), true);
    assert.equal(source.descriptor.kind, 'climateviewer');
  }
  const bing = sources.filter(({ descriptor }) => descriptor.requiresIon);
  assert.equal(bing.length, 3);
  assert.ok(bing.every((source) => source.available === false));
  assert.ok(
    sources
      .filter(({ descriptor }) => !descriptor.requiresIon)
      .every((source) => source.available === true),
  );
});

test('an Ion factory makes the Bing basemap sources available', () => {
  const styles = [];
  const sources = createClimateViewerBasemapSources({
    ionImagery: (style) => {
      styles.push(style);
      return { style };
    },
  });
  const bing = sources.filter(({ descriptor }) => descriptor.requiresIon);
  assert.ok(bing.every((source) => source.available === true));
  bing[0].imagery();
  assert.equal(styles.length, 1);
});

test('a basemap layer selects the map stack instead of the overlay rail', async () => {
  const stack = {
    activeId: 'esri-imagery',
    calls: [],
    listeners: new Set(),
    getActiveId() {
      return this.activeId;
    },
    getDefaultId() {
      return 'esri-imagery';
    },
    async setStack(id) {
      this.calls.push(id);
      this.activeId = id;
      for (const listener of this.listeners) listener({ activeId: id });
      return { activeId: id, lastError: null };
    },
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };
  const attached = [];
  const family = {
    attach: async () => {
      attached.push('attach');
      return true;
    },
    detach: () => attached.push('detach'),
    records: () => [],
    stats: () => ({ count: 0, status: 'idle', error: null, lastUpdate: null }),
  };
  const layer = createClimateViewerLayer(
    {
      ...definition,
      id: 'cv-basemaps-test',
      family: 'cartodb',
      role: 'basemap',
    },
    { familyFor: () => family },
  );
  layer.attachMapStackController(stack);
  assert.equal(await layer.enable(), true);
  assert.deepEqual(stack.calls, ['cv-basemaps-test']);
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().status, 'ok');
  assert.deepEqual(attached, []);
  layer.disable();
  assert.deepEqual(stack.calls, ['cv-basemaps-test', 'esri-imagery']);
  assert.equal(layer.getStats().status, 'idle');
});

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

test('large vector payloads attach empty and fill progressively without truncation', async () => {
  const viewer = fakeViewer();
  const source = fakeProgressiveSource(7);
  const family = createVectorFamily(definition, {
    loadVector: async () => source,
    progressiveThreshold: 3,
    progressiveChunk: 2,
  });
  const attaching = family.attach(viewer);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const mid = family.stats();
  assert.equal(mid.count, 7);
  assert.equal(mid.progressive, true);
  assert.ok(mid.rendered < 7);
  assert.equal(await attaching, true);
  const done = family.stats();
  assert.equal(done.count, 7);
  assert.equal(done.rendered, 7);
  assert.equal(done.progressive, false);
  assert.equal(source.entities.values.length, 7);
  family.detach();
  assert.deepEqual(
    {
      count: family.stats().count,
      rendered: family.stats().rendered,
      progressive: family.stats().progressive,
      status: family.stats().status,
    },
    { count: 0, rendered: 0, progressive: false, status: 'idle' },
  );
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

test('spotlight opacity dims imagery layers and restores them', async () => {
  const viewer = fakeViewer();
  const layer = { alpha: 1 };
  const family = createImageryFamily(
    { ...definition, family: 'gibs', flags: { ...definition.flags } },
    { providerFor: () => ({}), createImagery: () => layer },
  );
  await family.attach(viewer);
  family.setSpotlightOpacity(0.35);
  assert.equal(layer.alpha, 0.35);
  family.setSpotlightOpacity(1);
  assert.equal(layer.alpha, 1);
});

test('spotlight opacity dims vector billboards and restores their colour', async () => {
  const viewer = fakeViewer();
  const source = fakeSource(1);
  source.entities.values = [
    { id: 'a', billboard: { color: Cesium.Color.RED.withAlpha(0.8) } },
  ];
  const family = createVectorFamily(definition, {
    loadVector: async () => source,
  });
  await family.attach(viewer);
  family.setSpotlightOpacity(0.35);
  assert.ok(Math.abs(source.entities.values[0].billboard.color.alpha - 0.28) < 1e-9);
  family.setSpotlightOpacity(1);
  assert.ok(Math.abs(source.entities.values[0].billboard.color.alpha - 0.8) < 1e-9);
});
