import * as Cesium from 'cesium';
import catalog from './catalog.json' with { type: 'json' };
import health from './health.json' with { type: 'json' };
import { createImageryProvider } from './imagery.js';
import { loadVectorDataSource, readAnalystRecords } from './vector.js';
import { createFamily } from './families/index.js';

export { createClimateViewerClock } from './clock.js';
export {
  applyMarkerOverrides,
  LARGE_LAYER_ENTITY_CAP,
  loadVectorDataSource,
  readAnalystRecords,
} from './vector.js';
export { createImageryProvider, describeLoadFailure } from './imagery.js';
export {
  HEALTH_STATUSES,
  classifyLocalAsset,
  classifyProbe,
  healthStatusMap,
  isHealthStatus,
  summarizeHealth,
} from './health.js';

export const CLIMATEVIEWER_CATALOG = Object.freeze(catalog);
export const CLIMATEVIEWER_CATALOG_VERSION = catalog.version;
export const CLIMATEVIEWER_CATALOG_HASH = catalog.hash;
export const CLIMATEVIEWER_HEALTH = Object.freeze(health);
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

/** Probe result for one layer, or null when the layer is unknown. */
export function climateViewerHealth(id) {
  return health.results[id] ?? null;
}

/** Derived traits; older catalogs fall back to the current defaults. */
export function climateViewerTraits(id) {
  const layer = catalog.layers[id];
  if (!layer) return null;
  return layer.traits ?? { nameIsData: false, voice: 'toggle' };
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
 * One ClimateViewer layer over a catalog definition. The shell owns identity,
 * enable/disable, and the public layer shape; the family module owns Cesium
 * resources and provider-specific retry semantics.
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
    familyFor = createFamily,
  } = {},
) {
  if (!definition?.id)
    throw new TypeError('A ClimateViewer definition is required');
  const family = familyFor(definition, {
    clock,
    resolveAsset,
    proxyUrl,
    loadVector,
    providerFor,
    createImagery,
  });
  let viewer = null;
  let enabled = false;
  let destroyed = false;

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
      if (!viewer) throw new Error('ClimateViewer layer needs a viewer');
      enabled = true;
      const attached = await family.attach(viewer);
      if (attached && definition.flags.zoomTo) family.zoomTo?.();
      return true;
    },

    disable() {
      enabled = false;
      family.detach();
    },

    async update() {
      if (!enabled || !viewer) return false;
      const { status } = family.stats();
      if (status === 'ok' || status === 'empty' || status === 'loading')
        return true;
      return family.attach(viewer);
    },

    destroy(target = viewer) {
      enabled = false;
      destroyed = true;
      if (target && target !== viewer) viewer = target;
      family.detach();
      viewer = null;
    },

    getAnalystRecords(maxCount = 2000) {
      return family.records(maxCount);
    },

    getStats() {
      const stats = family.stats();
      const status = destroyed ? 'destroyed' : stats.status;
      return {
        ...stats,
        status,
        available:
          status === 'ok' ||
          status === 'empty' ||
          status === 'loading' ||
          status === 'idle',
      };
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
      traits: definition.traits,
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
