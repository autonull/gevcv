import * as Cesium from 'cesium';
import catalog from './catalog.json' with { type: 'json' };
import { CLIMATEVIEWER_LAYER_STATE_REGISTRY } from './layerState.generated.js';
import { createImageryProvider, describeLoadFailure } from './imagery.js';
import { loadVectorDataSource, readAnalystRecords } from './vector.js';

export { createClimateViewerClock } from './clock.js';
export { CLIMATEVIEWER_LAYER_STATE_REGISTRY } from './layerState.generated.js';
export {
  applyMarkerOverrides,
  LARGE_LAYER_ENTITY_CAP,
  loadVectorDataSource,
  readAnalystRecords,
} from './vector.js';
export { createImageryProvider, describeLoadFailure } from './imagery.js';

export const CLIMATEVIEWER_CATALOG = Object.freeze(catalog);
export const CLIMATEVIEWER_LAYERS = Object.freeze(
  Object.values(catalog.layers),
);
export const CLIMATEVIEWER_TREE = Object.freeze(catalog.tree);

const ICONS = Object.freeze({
  kml: '🗺️',
  geojson: '📍',
  arcgis: '🛰️',
  wms: '🌐',
  gibs: '🛰️',
  cartodb: '🎨',
  baseLayer: '🧭',
  bing: '🛰️',
});

const IMAGERY_FAMILIES = new Set([
  'arcgis',
  'wms',
  'gibs',
  'cartodb',
  'baseLayer',
  'bing',
]);

export function getClimateViewerLayer(id) {
  return catalog.layers[id] ?? null;
}

/** Definitions for one catalog category, in catalog order. */
export function climateViewerLayersIn(categoryKey) {
  return CLIMATEVIEWER_LAYERS.filter(
    (layer) => layer.categoryKey === categoryKey,
  );
}

/** True when the layer renders through the imagery stack, not a data source. */
export function isImageryLayer(definition) {
  return IMAGERY_FAMILIES.has(definition.family);
}

/**
 * One ClimateViewer layer over a catalog definition. Imagery layers attach a
 * provider; KML and GeoJSON layers attach a Cesium data source. Nothing
 * touches the viewer before `init`, and `disable` releases everything.
 */
export function createClimateViewerLayer(
  definition,
  {
    clock = null,
    resolveAsset = null,
    proxyUrl = null,
    loadVector = loadVectorDataSource,
    providerFor = createImageryProvider,
    createImagery = (provider) => new Cesium.ImageryLayer(provider),
  } = {},
) {
  if (!definition?.id) throw new TypeError('A ClimateViewer definition is required');
  const imageryKind = isImageryLayer(definition);
  const timeEnabled = Boolean(
    definition.provider?.time || definition.flags.timeline,
  );

  let viewer = null;
  let enabled = false;
  let imageryLayer = null;
  let dataSource = null;
  let unsubscribeClock = null;
  let status = 'idle';
  let error = null;
  let count = 0;
  let lastUpdate = null;
  let generation = 0;

  const timeParameter = () =>
    timeEnabled && clock ? clock.isoDate() : null;

  function detach() {
    unsubscribeClock?.();
    unsubscribeClock = null;
    if (imageryLayer && viewer) {
      viewer.imageryLayers.remove(imageryLayer, true);
      imageryLayer = null;
    }
    if (dataSource && viewer) {
      viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    }
    count = 0;
  }

  function attachImagery() {
    const provider = providerFor(definition, {
      time: timeParameter(),
    });
    const layer = createImagery(provider);
    viewer.imageryLayers.add(layer);
    imageryLayer = layer;
    count = 0;
    status = 'ok';
    error = null;
    lastUpdate = Date.now();
    if (timeEnabled && clock) {
      unsubscribeClock = clock.subscribe(() => {
        if (!enabled || !imageryLayer) return;
        const current = imageryLayer;
        viewer.imageryLayers.remove(current, true);
        imageryLayer = null;
        try {
          attachImagery();
        } catch (failure) {
          recordFailure(failure);
        }
      });
    }
  }

  async function attachVector(signal = null) {
    const epoch = ++generation;
    const source = await loadVector(definition, viewer, {
      resolveAsset,
      proxyUrl,
      signal,
    });
    if (signal?.aborted || epoch !== generation || !enabled) {
      source.show = false;
      return;
    }
    source.show = true;
    await viewer.dataSources.add(source);
    dataSource = source;
    count = source.entities.values.length;
    lastUpdate = Date.now();
    status = count > 0 ? 'ok' : 'empty';
    error = null;
  }

  function recordFailure(failure) {
    const described = describeLoadFailure(failure);
    status = described.status;
    error = described.message;
    console.warn(`[ClimateViewer] ${definition.id}: ${described.message}`);
  }

  const layer = {
    id: definition.id,
    name: definition.name,
    icon: ICONS[definition.family] ?? '🗺️',
    source: 'ClimateViewer',
    updateInterval: 0,
    showInTogglePanel: true,
    panelGroup: 'ClimateViewer',
    category: definition.category.join(' › '),
    family: definition.family,
    role: definition.role,
    keyRequired: definition.family === 'bing',

    init(target) {
      if (viewer) throw new Error('ClimateViewer layer is already initialized');
      viewer = target;
    },

    async enable(target) {
      if (target) viewer = target;
      enabled = true;
      status = 'loading';
      try {
        if (imageryKind) attachImagery();
        else await attachVector();
      } catch (failure) {
        recordFailure(failure);
      }
      return true;
    },

    disable() {
      enabled = false;
      generation += 1;
      detach();
      status = 'idle';
    },

    async update() {
      if (!enabled || !viewer) return false;
      if (imageryKind) return status !== 'error';
      if (dataSource) return status !== 'error';
      try {
        await attachVector();
        return status !== 'error';
      } catch (failure) {
        recordFailure(failure);
        return false;
      }
    },

    destroy(target = viewer) {
      enabled = false;
      generation += 1;
      if (target && target !== viewer) viewer = target;
      detach();
      viewer = null;
      status = 'destroyed';
    },

    getAnalystRecords(maxCount = 2000) {
      return dataSource ? readAnalystRecords(dataSource, maxCount) : [];
    },

    getStats() {
      return { count, lastUpdate, error, status, available: status === 'ok' || status === 'empty' || status === 'loading' || status === 'idle' };
    },

    metadata: Object.freeze({
      cvId: definition.cvId,
      description: definition.description,
      sourceUrl: definition.sourceUrl,
      category: definition.category.join(' › '),
      sublayers: definition.sublayers,
      flags: definition.flags,
      family: definition.family,
      role: definition.role,
      providerUrl: definition.url,
    }),
  };

  return layer;
}

/** Build every catalog layer; construction is cheap and touches no viewer. */
export function createClimateViewerLayers(options = {}) {
  return CLIMATEVIEWER_LAYERS.map((definition) =>
    createClimateViewerLayer(definition, options),
  );
}
