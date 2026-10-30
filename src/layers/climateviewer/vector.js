import * as Cesium from 'cesium';

/** ClimateViewer marker images are large PNGs; cap them to a readable pixel size. */
export const MARKER_PIXELS = 32;

/** Ceiling for layers ClimateViewer marks as large. */
export const LARGE_LAYER_ENTITY_CAP = 20_000;

function markerImage(layer, resolveAsset) {
  if (!layer.markerIcon) return null;
  return resolveAsset?.(layer.markerIcon) ?? layer.markerIcon;
}

/** Apply ClimateViewer's marker overrides (MI/MS/ML) to every billboard. */
export function applyMarkerOverrides(dataSource, layer, resolveAsset) {
  const image = markerImage(layer, resolveAsset);
  if (!image) return;
  const scale = Math.min(Math.max(layer.markerScale || 1, 0.25), 4);
  for (const entity of dataSource.entities.values) {
    if (!entity.billboard) continue;
    entity.billboard.image = image;
    entity.billboard.width = MARKER_PIXELS;
    entity.billboard.height = MARKER_PIXELS;
    entity.billboard.scale = scale;
  }
}

function trimEntities(dataSource, cap) {
  const values = dataSource.entities.values;
  if (values.length <= cap) return values.length;
  for (const entity of values.slice(cap)) dataSource.entities.remove(entity);
  return cap;
}

/** Cluster dense point layers; line and polygon layers keep their geometry. */
function applyDensePointClustering(dataSource, layer) {
  if (!dataSource.clustering) return;
  const dense = layer.flags.large || dataSource.entities.values.length > 2_000;
  if (!dense) return;
  dataSource.clustering.enabled = true;
  dataSource.clustering.pixelRange = 32;
  dataSource.clustering.minimumClusterSize = 2;
}

/**
 * Load one KML/KMZ or GeoJSON layer through Cesium's own loaders, which cover
 * KMZ inflation, geometry types, styles and NetworkLinks.
 */
export async function loadVectorDataSource(
  layer,
  viewer,
  { resolveAsset = null, proxyUrl = null, signal = null } = {},
) {
  if (layer.family === 'kml') {
    const dataSource = await Cesium.KmlDataSource.load(layer.url, {
      camera: viewer.camera,
      canvas: viewer.canvas,
      clampToGround: true,
      ...(layer.provider.proxy && proxyUrl
        ? { proxy: new Cesium.DefaultProxy(proxyUrl) }
        : {}),
    });
    signal?.throwIfAborted();
    applyMarkerOverrides(dataSource, layer, resolveAsset);
    if (layer.flags.large) trimEntities(dataSource, LARGE_LAYER_ENTITY_CAP);
    applyDensePointClustering(dataSource, layer);
    return dataSource;
  }

  if (layer.family === 'geojson') {
    const source =
      proxyUrl && !layer.url.startsWith('/cv/')
        ? new Cesium.Resource({
            url: layer.url,
            proxy: new Cesium.DefaultProxy(proxyUrl),
          })
        : layer.url;
    const dataSource = await Cesium.GeoJsonDataSource.load(source, {
      clampToGround: true,
      ...(layer.markerIcon && markerImage(layer, resolveAsset)
        ? { markerSymbol: markerImage(layer, resolveAsset) }
        : {}),
    });
    signal?.throwIfAborted();
    applyMarkerOverrides(dataSource, layer, resolveAsset);
    if (layer.flags.large) trimEntities(dataSource, LARGE_LAYER_ENTITY_CAP);
    applyDensePointClustering(dataSource, layer);
    return dataSource;
  }

  throw new Error(`Unsupported vector family: ${layer.family}`);
}

/** Map a loaded data source onto the analyst record shape used by GEV. */
export function readAnalystRecords(dataSource, maxCount = 2000) {
  if (!dataSource?.show) return [];
  const limit = Math.max(1, Math.floor(maxCount));
  const records = [];
  for (const entity of dataSource.entities.values) {
    if (records.length >= limit) break;
    const position = entity.position?.getValue?.(Cesium.JulianDate.now());
    const description =
      entity.description?.getValue?.(Cesium.JulianDate.now()) ??
      entity.properties?.S?.getValue?.() ??
      '';
    records.push({
      id: entity.id ?? null,
      name: String(entity.name ?? entity.properties?.N?.getValue?.() ?? ''),
      description: String(description).slice(0, 600),
      geometry: position
        ? {
            lat: Cesium.Math.toDegrees(
              Cesium.Cartographic.fromCartesian(position).latitude,
            ),
            lon: Cesium.Math.toDegrees(
              Cesium.Cartographic.fromCartesian(position).longitude,
            ),
          }
        : null,
    });
  }
  return records;
}
