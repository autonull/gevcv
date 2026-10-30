import * as Cesium from 'cesium';

/** A layer that cannot render without a key the browser does not own. */
export class ClimateViewerKeyRequiredError extends Error {
  constructor(layer) {
    super(
      `${layer.name}: imagery set "${layer.provider.imagerySet}" needs a Bing key`,
    );
    this.name = 'ClimateViewerKeyRequiredError';
  }
}

/** CartoDB templates use Leaflet's `{s}` subdomain placeholder. */
function templateUrl(url) {
  return String(url)
    .replace('{s}', 'a')
    .replace(/^http:\/\//i, 'https://');
}

/**
 * Build the Cesium provider for one catalog layer.
 * Mirrors the ClimateViewer 3D runtime: both ArcGIS types are imagery layers.
 */
export async function createImageryProvider(layer, { time = null } = {}) {
  const { provider } = layer;
  const sublayers = provider.sublayers?.join(',') || undefined;
  switch (provider.kind) {
    case 'arcgis':
      // Cesium 1.138 constructs ArcGIS providers through fromUrl so the
      // provider receives its Resource before any tile request.
      return Cesium.ArcGisMapServerImageryProvider.fromUrl(provider.url, {
        ...(sublayers ? { layers: sublayers } : {}),
        enablePickFeatures: layer.flags.noFeatures !== true,
      });
    case 'wms':
      return new Cesium.WebMapServiceImageryProvider({
        url: provider.url,
        layers: provider.layers.join(','),
        enablePickFeatures: layer.flags.noFeatures !== true,
        parameters: {
          transparent: true,
          format: 'image/png',
          ...(time ? { time } : {}),
        },
      });
    case 'wmts':
      return new Cesium.WebMapTileServiceImageryProvider({
        url: provider.url,
        layer: provider.layer,
        style: '',
        format: provider.format,
        tileMatrixSetID: provider.tileMatrixSetID,
        maximumLevel: provider.maximumLevel,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        ...(time ? { dimensions: { Time: time } } : {}),
      });
    case 'urlTemplate':
      return new Cesium.UrlTemplateImageryProvider({
        url: templateUrl(provider.url),
      });
    case 'osm':
      return new Cesium.OpenStreetMapImageryProvider({
        url: String(provider.url).replace(/\/?$/, '/'),
      });
    default:
      throw new ClimateViewerKeyRequiredError(layer);
  }
}

/** Classify a failed provider/data-source load for the UI and health report. */
export function describeLoadFailure(error) {
  if (error instanceof ClimateViewerKeyRequiredError)
    return {
      status: 'key-required',
      message: error.message,
      remedy: 'Add a Cesium Ion token to use this Bing imagery set.',
    };
  const message = String(error?.message || error || 'load failed');
  if (/fetch|network|cors|failed to load|blocked/i.test(message))
    return {
      status: 'cors',
      message,
      remedy:
        'The provider blocks browser requests. Set a ClimateViewer proxy URL in settings to route it.',
    };
  if (/40[34]/i.test(message)) return { status: 'dead', message };
  return { status: 'error', message };
}
