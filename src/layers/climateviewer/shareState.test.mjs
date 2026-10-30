import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIMATEVIEWER_BITSET_CHARS,
  CLIMATEVIEWER_CATALOG_HASH,
  CLIMATEVIEWER_LAYER_ORDER,
  CLIMATEVIEWER_STATE_STORAGE_KEY,
  ClimateViewerStateSync,
  decodeClimateViewerLayerIds,
  decodeClimateViewerShareParams,
  decodeClimateViewerStorageState,
  encodeClimateViewerLayerIds,
  encodeClimateViewerStorageState,
} from './shareState.js';

function paramsOf(entries) {
  return new URLSearchParams(entries);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('catalog order is stable and unique', () => {
  assert.equal(CLIMATEVIEWER_LAYER_ORDER.length, 405);
  assert.equal(new Set(CLIMATEVIEWER_LAYER_ORDER).size, 405);
  assert.match(CLIMATEVIEWER_CATALOG_HASH, /^[a-f0-9]{8}$/);
});

test('empty bitset is canonical and every subset round-trips', () => {
  const empty = encodeClimateViewerLayerIds([]);
  assert.equal(empty.length, CLIMATEVIEWER_BITSET_CHARS);
  assert.equal(empty, 'A'.repeat(CLIMATEVIEWER_BITSET_CHARS));
  assert.deepEqual(decodeClimateViewerLayerIds(empty), { ok: true, ids: [] });
  const mixed = [
    CLIMATEVIEWER_LAYER_ORDER[0],
    CLIMATEVIEWER_LAYER_ORDER[7],
    CLIMATEVIEWER_LAYER_ORDER[8],
    CLIMATEVIEWER_LAYER_ORDER[404],
  ];
  const decoded = decodeClimateViewerLayerIds(
    encodeClimateViewerLayerIds(mixed),
  );
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.ids, mixed);
  assert.equal(encodeClimateViewerLayerIds(decoded.ids), encodeClimateViewerLayerIds(mixed));
});

test('unknown ids are ignored instead of shifting other bits', () => {
  const encoded = encodeClimateViewerLayerIds([
    'not-a-cv-layer',
    CLIMATEVIEWER_LAYER_ORDER[2],
  ]);
  assert.deepEqual(decodeClimateViewerLayerIds(encoded).ids, [
    CLIMATEVIEWER_LAYER_ORDER[2],
  ]);
});

test('strict decode rejects length, alphabet, trailing bits, and duplicates', () => {
  const canonical = encodeClimateViewerLayerIds([CLIMATEVIEWER_LAYER_ORDER[0]]);
  assert.equal(decodeClimateViewerLayerIds(canonical.slice(1)).reason, 'length');
  assert.equal(
    decodeClimateViewerLayerIds(`${canonical.slice(0, -1)}+`).reason,
    'base64',
  );
  const trailing = `${canonical.slice(0, -1)}g`;
  assert.equal(decodeClimateViewerLayerIds(trailing).reason, 'trailing-bits');
  assert.equal(
    decodeClimateViewerShareParams(
      paramsOf([
        ['v', '3'],
        ['c', CLIMATEVIEWER_CATALOG_HASH],
        ['cv', encodeClimateViewerLayerIds([])],
        ['cv', encodeClimateViewerLayerIds([])],
      ]),
    ).reason,
    'duplicate',
  );
});

test('v3 params apply on hash match and ignore cv on catalog mismatch', () => {
  const cv = encodeClimateViewerLayerIds([CLIMATEVIEWER_LAYER_ORDER[3]]);
  const applied = decodeClimateViewerShareParams(
    paramsOf([
      ['v', '3'],
      ['c', CLIMATEVIEWER_CATALOG_HASH],
      ['cv', cv],
    ]),
  );
  assert.equal(applied.status, 'applied');
  assert.deepEqual(applied.ids, [CLIMATEVIEWER_LAYER_ORDER[3]]);
  const mismatch = decodeClimateViewerShareParams(
    paramsOf([
      ['v', '3'],
      ['c', 'deadbeef'],
      ['cv', cv],
    ]),
  );
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.status, 'mismatch');
  assert.deepEqual(mismatch.ids, []);
  assert.equal(mismatch.notice, 'catalog-mismatch');
  assert.equal(
    decodeClimateViewerShareParams(paramsOf([['v', '3'], ['c', 'deadbeef']]))
      .reason,
    'incomplete',
  );
  assert.equal(
    decodeClimateViewerShareParams(
      paramsOf([['v', '2'], ['c', CLIMATEVIEWER_CATALOG_HASH], ['cv', cv]]),
    ).reason,
    'version',
  );
  assert.equal(decodeClimateViewerShareParams(paramsOf([])).status, 'absent');
});

test('stored state uses the v3 schema and rejects another catalog', () => {
  const ids = [CLIMATEVIEWER_LAYER_ORDER[1], CLIMATEVIEWER_LAYER_ORDER[9]];
  const raw = encodeClimateViewerStorageState({ enabledLayerIds: ids });
  assert.deepEqual(decodeClimateViewerStorageState(raw), ids);
  assert.equal(
    decodeClimateViewerStorageState(raw, { expectedHash: 'deadbeef' }),
    null,
  );
  assert.equal(decodeClimateViewerStorageState('{}'), null);
});

function createManager(initial = []) {
  const enabled = new Set(initial);
  const listeners = new Set();
  const calls = [];
  return {
    enabled,
    calls,
    isEnabled: (id) => enabled.has(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(id, on, { origin = 'user' } = {}) {
      calls.push({ id, on, origin });
      const was = enabled.has(id);
      if (on) enabled.add(id);
      else enabled.delete(id);
      for (const listener of listeners)
        listener({ type: 'visibility', layerId: id, enabled: on, origin });
      return Promise.resolve(was !== on);
    },
    toggle(id, origin = 'user') {
      return this.setEnabled(id, !enabled.has(id), { origin });
    },
  };
}

test('share restore is exclusive, and user toggles persist the bitset', async () => {
  const a = CLIMATEVIEWER_LAYER_ORDER[0];
  const b = CLIMATEVIEWER_LAYER_ORDER[1];
  const manager = createManager([a, b]);
  const storage = memoryStorage();
  const provider = { fn: null };
  const share = {
    setClimateViewerStateProvider(fn) {
      provider.fn = fn;
    },
    onLayerStateChange() {},
  };
  const sync = new ClimateViewerStateSync(manager, share, { storage });
  await sync.start({ shareEnabledLayerIds: [b] });
  assert.equal(manager.isEnabled(a), false);
  assert.equal(manager.isEnabled(b), true);
  assert.equal(storage.getItem(CLIMATEVIEWER_STATE_STORAGE_KEY), null);
  assert.deepEqual(provider.fn().enabledLayerIds, [b]);
  await manager.toggle(a, 'user');
  const raw = storage.getItem(CLIMATEVIEWER_STATE_STORAGE_KEY);
  assert.deepEqual(decodeClimateViewerStorageState(raw), [a, b]);
  assert.deepEqual(provider.fn().enabledLayerIds, [a, b]);
  sync.destroy();
});
