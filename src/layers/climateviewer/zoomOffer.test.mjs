import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_ZOOM_HEIGHT_METERS,
  isGlobalClimateViewerLayer,
  shouldOfferClimateViewerZoomOut,
} from './zoomOffer.js';

test('global layers are recognised by category or large flag', () => {
  assert.equal(
    isGlobalClimateViewerLayer({ metadata: { category: ['Weather', 'rain'] } }),
    true,
  );
  assert.equal(
    isGlobalClimateViewerLayer({ metadata: { flags: { large: true } } }),
    true,
  );
  assert.equal(
    isGlobalClimateViewerLayer({ metadata: { category: ['Other', 'x'] } }),
    false,
  );
  assert.equal(
    isGlobalClimateViewerLayer({
      metadata: { role: 'basemap', flags: { large: true } },
    }),
    false,
  );
});

test('the zoom-out offer needs a global layer and a city-level camera', () => {
  const global = { metadata: { category: ['Live'] } };
  assert.equal(
    shouldOfferClimateViewerZoomOut(global, CITY_ZOOM_HEIGHT_METERS - 1),
    true,
  );
  assert.equal(
    shouldOfferClimateViewerZoomOut(global, CITY_ZOOM_HEIGHT_METERS),
    false,
  );
  assert.equal(shouldOfferClimateViewerZoomOut(global, null), false);
  assert.equal(
    shouldOfferClimateViewerZoomOut({ metadata: { category: ['Other'] } }, 600),
    false,
  );
});
