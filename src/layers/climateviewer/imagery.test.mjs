import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageryProvider } from './imagery.js';

test('ArcGIS providers use the async fromUrl factory', async () => {
  const calls = [];
  const expected = { id: 'provider' };
  const cesium = {
    ArcGisMapServerImageryProvider: {
      fromUrl: async (url, options) => {
        calls.push({ url, options });
        return expected;
      },
    },
  };
  const layer = {
    provider: { kind: 'arcgis', url: 'https://example.test/MapServer' },
    flags: {},
  };
  const provider = await createImageryProvider(layer, { cesium });
  assert.equal(provider, expected);
  assert.deepEqual(calls, [
    {
      url: 'https://example.test/MapServer',
      options: { enablePickFeatures: true },
    },
  ]);
});

test('a provider failure rejects instead of returning a half-built layer', async () => {
  const cesium = {
    ArcGisMapServerImageryProvider: {
      fromUrl: async () => {
        throw new Error('metadata unavailable');
      },
    },
  };
  await assert.rejects(
    createImageryProvider(
      { provider: { kind: 'arcgis', url: 'https://example.test' }, flags: {} },
      { cesium },
    ),
    /metadata unavailable/,
  );
});
