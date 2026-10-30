import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKER_PIXELS, applyMarkerOverrides } from './vector.js';

function billboardSource() {
  return {
    entities: {
      values: [{ billboard: {} }, { billboard: {} }, {}],
    },
  };
}

test('marker overrides use a fixed 32px box and clamp scale to 0.25–4', () => {
  const source = billboardSource();
  applyMarkerOverrides(
    source,
    { markerIcon: '/cv/img/icons/volcano.png', markerScale: 0.1 },
    (path) => `/assets${path}`,
  );
  for (const entity of source.entities.values.slice(0, 2)) {
    assert.equal(entity.billboard.image, '/assets/cv/img/icons/volcano.png');
    assert.equal(entity.billboard.width, MARKER_PIXELS);
    assert.equal(entity.billboard.height, MARKER_PIXELS);
    assert.equal(entity.billboard.scale, 0.25);
  }
  assert.equal(MARKER_PIXELS, 32);

  applyMarkerOverrides(source, {
    markerIcon: '/cv/img/icons/volcano.png',
    markerScale: 9,
  });
  assert.equal(source.entities.values[0].billboard.scale, 4);
});

test('layers without a marker icon keep their billboard styling', () => {
  const source = billboardSource();
  applyMarkerOverrides(source, { markerIcon: '', markerScale: 2 });
  assert.deepEqual(source.entities.values[0].billboard, {});
});
