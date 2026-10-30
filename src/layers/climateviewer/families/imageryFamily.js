import * as Cesium from 'cesium';
import { createImageryProvider, describeLoadFailure } from '../imagery.js';

/**
 * Shared lifecycle for every imagery-backed ClimateViewer family. One instance
 * owns one Cesium imagery layer and, for time-enabled definitions, one clock
 * subscription.
 */
export function createImageryFamily(
  definition,
  {
    clock = null,
    providerFor = createImageryProvider,
    createImagery = (provider) => new Cesium.ImageryLayer(provider),
  } = {},
) {
  const timeEnabled = Boolean(
    definition.provider?.time || definition.flags.timeline,
  );
  let viewer = null;
  let imageryLayer = null;
  let unsubscribeClock = null;
  let status = 'idle';
  let error = null;
  let lastUpdate = null;

  const timeParameter = () => (timeEnabled && clock ? clock.isoDate() : null);

  function removeLayer() {
    if (imageryLayer && viewer) viewer.imageryLayers.remove(imageryLayer, true);
    imageryLayer = null;
  }

  function subscribeClock() {
    if (!timeEnabled || !clock || unsubscribeClock) return;
    unsubscribeClock = clock.subscribe(() => {
      if (!imageryLayer) return;
      refresh();
    });
  }

  function attach(target) {
    viewer = target;
    try {
      const provider = providerFor(definition, { time: timeParameter() });
      imageryLayer = createImagery(provider);
      viewer.imageryLayers.add(imageryLayer);
      status = 'ok';
      error = null;
      lastUpdate = Date.now();
      subscribeClock();
      return true;
    } catch (failure) {
      const described = describeLoadFailure(failure);
      status = described.status;
      error = described.message;
      console.warn(`[ClimateViewer] ${definition.id}: ${described.message}`);
      return false;
    }
  }

  function detach() {
    unsubscribeClock?.();
    unsubscribeClock = null;
    removeLayer();
    status = 'idle';
    error = null;
    lastUpdate = null;
  }

  /** Rebuild the provider, e.g. when the shared day changes. */
  function refresh() {
    if (!viewer || !imageryLayer) return false;
    removeLayer();
    return attach(viewer);
  }

  function zoomTo() {
    const rectangle = imageryLayer?.imageryProvider?.rectangle;
    if (!viewer || !rectangle) return false;
    viewer.camera.flyTo({ destination: rectangle, duration: 1.2 });
    return true;
  }

  return {
    kind: 'imagery',
    attach,
    detach,
    refresh,
    zoomTo,
    records: () => [],
    stats: () => ({
      count: imageryLayer ? 1 : 0,
      lastUpdate,
      error,
      status,
    }),
  };
}
