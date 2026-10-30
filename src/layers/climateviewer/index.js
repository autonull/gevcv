import * as Cesium from 'cesium';
import catalog from './catalog.json' with { type: 'json' };
import health from './health.json' with { type: 'json' };
import { createImageryProvider } from './imagery.js';
import { loadVectorDataSource, readAnalystRecords } from './vector.js';
import { createFamily } from './families/index.js';
import { isClimateViewerBasemapId } from './basemaps.js';

export { createClimateViewerClock } from './clock.js';
export {
  applyMarkerOverrides,
  PROGRESSIVE_ENTITY_THRESHOLD,
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
export { auditClimateViewerHealth } from './healthAudit.js';

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

/** Dynamic vector feeds worth a background refetch. Offline files stay put. */
const LIVE_REFRESH_INTERVAL_MS = 60_000;
const LIVE_PROVIDER = /\b(USGS|NOAA|NWS|EMSC|PDC)\b/i;

export function climateViewerRefreshInterval(definition) {
  if (definition?.role !== 'overlay') return 0;
  if (!['kml', 'geojson'].includes(definition.family)) return 0;
  const haystack = [
    definition.name,
    definition.cvId,
    definition.category?.join(' '),
  ].join(' ');
  return LIVE_PROVIDER.test(haystack) ? LIVE_REFRESH_INTERVAL_MS : 0;
}

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

/** True when the layer has local assets (GeoJSON/KML data or marker icons) cached under /cv/. */
export function climateViewerHasLocalAssets(id) {
  const layer = catalog.layers[id];
  if (!layer) return false;
  return (
    (layer.url && layer.url.startsWith('/cv/')) ||
    (layer.markerIcon && layer.markerIcon.startsWith('/cv/')) ||
    (layer.sourceUrl && layer.sourceUrl.startsWith('/cv/'))
  );
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
  const refreshInterval = climateViewerRefreshInterval(definition);
  const isBasemap = definition.role === 'basemap';
  let viewer = null;
  let enabled = false;
  let destroyed = false;
  let mapStack = null;
  let dataManager = null;
  let unsubscribeMapStack = null;
  let previousStackId = null;
  let basemapStatus = 'idle';
  let basemapError = null;
  let basemapRemedy = null;
  let basemapLastUpdate = null;

  function rememberPreviousStack() {
    const active = mapStack?.getActiveId?.() ?? null;
    previousStackId =
      active && !isClimateViewerBasemapId(active) ? active : null;
  }

  async function enableBasemap() {
    if (!mapStack?.setStack) {
      basemapStatus = 'error';
      basemapError = 'The map stack is unavailable';
      return false;
    }
    rememberPreviousStack();
    enabled = true;
    basemapStatus = 'loading';
    const state = await mapStack.setStack(definition.id);
    if (destroyed) return false;
    if (state?.activeId === definition.id && !state.lastError) {
      basemapStatus = 'ok';
      basemapError = null;
      basemapRemedy = null;
      basemapLastUpdate = Date.now();
      return true;
    }
    enabled = false;
    basemapStatus = 'error';
    basemapError =
      state?.lastError || 'The map stack did not activate this basemap';
    basemapRemedy =
      'Choose a different map source, or remove this basemap from settings.';
    return false;
  }

  function disableBasemap() {
    enabled = false;
    basemapStatus = 'idle';
    if (!mapStack) return;
    if (mapStack.getActiveId?.() !== definition.id) return;
    const target = previousStackId || mapStack.getDefaultId?.() || null;
    previousStackId = null;
    if (!target || target === definition.id) return;
    void mapStack.setStack(target).catch(() => {});
  }

  function syncWithMapStack(state) {
    if (!isBasemap || !enabled || destroyed) return;
    if (state?.activeId === definition.id) return;
    enabled = false;
    basemapStatus = 'idle';
    previousStackId = null;
    void dataManager
      ?.setEnabled(definition.id, false, { origin: 'programmatic' })
      .catch(() => {});
  }

  const layer = {
    id: definition.id,
    name: definition.name,
    icon: ICONS[definition.family] ?? '🗺️',
    source: 'ClimateViewer',
    updateInterval: 0,
    refreshInterval,
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
      if (isBasemap) return enableBasemap();
      if (!viewer) throw new Error('ClimateViewer layer needs a viewer');
      enabled = true;
      const attached = await family.attach(viewer);
      if (attached && definition.flags.zoomTo) family.zoomTo?.();
      return true;
    },

    disable() {
      if (isBasemap) return disableBasemap();
      enabled = false;
      family.detach();
    },

    async update() {
      if (isBasemap)
        return !destroyed && mapStack?.getActiveId?.() === definition.id;
      if (!enabled || !viewer) return false;
      const { status } = family.stats();
      if (status === 'ok' || status === 'empty') {
        if (refreshInterval > 0) return family.refresh?.() ?? true;
        return true;
      }
      if (status === 'loading') return true;
      return family.attach(viewer);
    },

    destroy(target = viewer) {
      enabled = false;
      destroyed = true;
      unsubscribeMapStack?.();
      unsubscribeMapStack = null;
      mapStack = null;
      dataManager = null;
      if (target && target !== viewer) viewer = target;
      family.detach();
      viewer = null;
    },

    attachMapStackController(controller) {
      mapStack = controller ?? null;
      unsubscribeMapStack?.();
      unsubscribeMapStack =
        typeof controller?.subscribe === 'function'
          ? controller.subscribe(syncWithMapStack)
          : null;
    },

    attachDataManager(manager) {
      dataManager = manager ?? null;
    },

    getAnalystRecords(maxCount = 2000) {
      return isBasemap ? [] : family.records(maxCount);
    },

    zoomTo() {
      if (isBasemap || !viewer) return false;
      return family.zoomTo?.() ?? false;
    },

    getStats() {
      if (isBasemap) {
        const status = destroyed ? 'destroyed' : basemapStatus;
        return {
          count: status === 'ok' ? 1 : 0,
          status,
          available:
            status === 'ok' || status === 'idle' || status === 'loading',
          error: basemapError,
          remedy: basemapRemedy,
          lastUpdate: basemapLastUpdate,
        };
      }
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
      health: health.results[definition.id] ?? null,
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
