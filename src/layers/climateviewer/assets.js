/**
 * Local ClimateViewer asset manifest helpers. The sync script writes
 * `public/cv/manifest.json`; a checkout without the sibling `cv/` clone has no
 * manifest, so every local layer is honestly reported as missing.
 */

export const CLIMATEVIEWER_ASSET_MANIFEST_PATH = '/cv/manifest.json';

export function catalogAssetStatus(manifest, catalogHash) {
  if (!manifest) return 'assets-missing';
  if (manifest.catalogHash && manifest.catalogHash !== catalogHash)
    return 'stale';
  return 'ok';
}

/** Status for one layer URL; null when the layer is not a local asset. */
export function layerAssetStatus(layer, manifest) {
  const url = String(layer?.url ?? '');
  if (!url.startsWith('/cv/')) return null;
  if (!manifest) return 'assets-missing';
  return Object.hasOwn(manifest.files ?? {}, url) ? 'ok' : 'assets-missing';
}

/** Fetch the manifest once; a missing or malformed file is not fatal. */
export async function loadClimateViewerAssetManifest({
  fetchImpl = fetch,
  url = CLIMATEVIEWER_ASSET_MANIFEST_PATH,
} = {}) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const manifest = await response.json();
    return manifest?.version === 1 ? manifest : null;
  } catch {
    return null;
  }
}
