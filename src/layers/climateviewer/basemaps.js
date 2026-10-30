import * as Cesium from 'cesium';
import catalog from './catalog.json' with { type: 'json' };
import { createImageryProvider } from './imagery.js';

const BING_STYLES = Object.freeze({
  AERIAL: Cesium.IonWorldImageryStyle.AERIAL,
  AERIAL_WITH_LABELS: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
  ROADS: Cesium.IonWorldImageryStyle.ROAD,
});

/** Catalog layers whose role is the map background, not an overlay. */
export const CLIMATEVIEWER_BASEMAPS = Object.freeze(
  Object.values(catalog.layers).filter(({ role }) => role === 'basemap'),
);

const BASEMAP_IDS = new Set(CLIMATEVIEWER_BASEMAPS.map(({ id }) => id));

export function isClimateViewerBasemapId(id) {
  return BASEMAP_IDS.has(id);
}

/**
 * Map-stack sources for every ClimateViewer basemap. The map controller owns
 * exclusivity, so these never enter `viewer.imageryLayers` directly.
 *
 * Bing catalog entries name an Ion world-imagery style, not a URL. They are
 * available only when the caller supplies an Ion-backed provider factory.
 */
export function createClimateViewerBasemapSources({
  providerFor = createImageryProvider,
  ionImagery = null,
} = {}) {
  return CLIMATEVIEWER_BASEMAPS.map((definition) => {
    const bing = definition.family === 'bing';
    const style = bing
      ? (BING_STYLES[definition.provider?.imagerySet] ?? null)
      : null;
    const available =
      !bing || (style !== null && typeof ionImagery === 'function');
    return {
      descriptor: {
        id: definition.id,
        label: definition.name,
        shortLabel: definition.name,
        kind: 'climateviewer',
        requiresIon: bing,
      },
      available,
      unavailableReason: available
        ? null
        : 'Bing basemaps need a Cesium Ion token; add it in Provider Settings',
      credit: `${definition.name} — ${definition.sourceUrl}`,
      imagery: () => (bing ? ionImagery(style) : providerFor(definition)),
    };
  });
}
