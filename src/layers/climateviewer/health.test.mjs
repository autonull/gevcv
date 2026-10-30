import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyLocalAsset,
  classifyProbe,
  healthStatusMap,
  summarizeHealth,
} from './health.js';
import {
  buildHealth,
  mapConcurrent,
  probeEndpoint,
  probeUrl,
} from '../../../scripts/sync-cv-health.mjs';

test('classifyProbe maps HTTP outcomes to health statuses', () => {
  assert.equal(classifyProbe({ status: 200 }), 'ok');
  assert.equal(classifyProbe({ status: 204 }), 'ok');
  assert.equal(classifyProbe({ status: 200, redirected: true }), 'redirect');
  assert.equal(classifyProbe({ status: 301 }), 'redirect');
  assert.equal(classifyProbe({ status: 403 }), 'cors');
  assert.equal(classifyProbe({ status: 404 }), 'dead');
  assert.equal(classifyProbe({ status: 503 }), 'dead');
  assert.equal(classifyProbe({ error: new TypeError('fetch failed') }), 'cors');
  assert.equal(
    classifyProbe({ status: 200, keyRequired: true }),
    'key-required',
  );
});

test('classifyLocalAsset distinguishes missing local files', () => {
  assert.equal(classifyLocalAsset('/cv/layers/a.geojson', true), 'ok');
  assert.equal(
    classifyLocalAsset('/cv/layers/a.geojson', false),
    'assets-missing',
  );
  assert.equal(
    classifyLocalAsset('https://example.com/a.geojson', false),
    null,
  );
});

test('summarizeHealth counts every status and defaults to untested', () => {
  const summary = summarizeHealth({
    a: { status: 'ok' },
    b: { status: 'ok' },
    c: { status: 'dead' },
    d: { status: 'nonsense' },
    e: {},
  });
  assert.equal(summary.ok, 2);
  assert.equal(summary.dead, 1);
  assert.equal(summary.untested, 2);
  assert.equal(summary.total, 5);
});

test('healthStatusMap defaults absent rows to untested', () => {
  const map = healthStatusMap({ results: { a: { status: 'ok' } } });
  assert.equal(map.get('a'), 'ok');
  assert.equal(map.get('b'), undefined);
  assert.equal(healthStatusMap(null).size, 0);
});

test('probeUrl expands tile templates', () => {
  assert.equal(
    probeUrl('http://{s}.tiles/{z}/{x}/{y}.png'),
    'http://a.tiles/0/0/0.png',
  );
});

test('probeEndpoint retries 403 and 405 with a ranged GET', async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(init.method);
    if (init.method === 'HEAD') return { status: 405, redirected: false };
    return { status: 200, redirected: false };
  };
  assert.deepEqual(
    await probeEndpoint('https://example.com/a', { fetchImpl }),
    {
      status: 'ok',
      http: 200,
    },
  );
  assert.deepEqual(calls, ['HEAD', 'GET']);
});

test('mapConcurrent preserves order and respects the ceiling', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8, 10]);
  assert.ok(peak <= 2);
});

test('buildHealth checks local assets and keys before probing', async () => {
  const probes = [];
  const fetchImpl = async (url) => {
    probes.push(url);
    return { status: 200, redirected: false };
  };
  const health = await buildHealth(
    {
      hash: 'deadbeef',
      generatedFromSha: 'a'.repeat(40),
      layers: {
        local: { id: 'local', url: '/cv/layers/missing.kml' },
        bing: { id: 'bing', family: 'bing', url: 'AERIAL' },
        remote: {
          id: 'remote',
          family: 'kml',
          url: 'https://example.com/a.kml',
          provider: { url: 'https://example.com/a.kml' },
        },
      },
    },
    { fetchImpl, publicDir: '/nonexistent-cv-assets' },
  );
  assert.equal(health.results.local.status, 'assets-missing');
  assert.equal(health.results.bing.status, 'key-required');
  assert.equal(health.results.remote.status, 'ok');
  assert.deepEqual(probes, ['https://example.com/a.kml']);
  assert.equal(health.catalogHash, 'deadbeef');
});
