/** City-level camera heights can hide a global raster outside the viewport. */
export const CITY_ZOOM_HEIGHT_METERS = 250_000;

const GLOBAL_CATEGORIES = new Set(['Live', 'Weather', 'Satellites']);

/** Whether a CV layer covers the world rather than a city or region. */
export function isGlobalClimateViewerLayer(layer) {
  const metadata = layer?.metadata ?? layer ?? {};
  if (metadata.role === 'basemap') return false;
  if (metadata.flags?.large) return true;
  const top = Array.isArray(metadata.category) ? metadata.category[0] : '';
  return GLOBAL_CATEGORIES.has(top);
}

/** Offer a zoom-out only when an enabled global layer is off-screen zoomed in. */
export function shouldOfferClimateViewerZoomOut(layer, cameraHeight) {
  if (!Number.isFinite(cameraHeight)) return false;
  if (cameraHeight >= CITY_ZOOM_HEIGHT_METERS) return false;
  return isGlobalClimateViewerLayer(layer);
}
