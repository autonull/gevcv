import * as Cesium from 'cesium';
import { t } from '../../i18n/index.js';

/** ClimateViewer marker images are large PNGs; cap them to a readable pixel size. */
export const MARKER_PIXELS = 32;

/** Above this entity count the family attaches the source and fills it in chunks. */
export const PROGRESSIVE_ENTITY_THRESHOLD = 5_000;

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

/**
 * Re-enable depth testing for every screen-space graphic. KML styles can
 * request always-on-top labels/billboards; that is wrong on a globe.
 */
export function applyTerrainOcclusion(dataSource) {
  for (const entity of dataSource?.entities?.values ?? []) {
    for (const key of ['billboard', 'label', 'point']) {
      const graphic = entity[key];
      if (graphic) graphic.disableDepthTestDistance = 0;
    }
  }
}

function plainText(html) {
  const value = String(html ?? '');
  if (!value) return '';
  try {
    return (
      new DOMParser().parseFromString(value, 'text/html').body.textContent ?? ''
    ).trim();
  } catch {
    return value.replace(/<[^>]+>/g, ' ').trim();
  }
}

/**
 * Click a CV marker to read its name and description in a compact anchor card.
 * One handler per data source; a click that is not ours is left untouched.
 */
export function createMarkerPopup(viewer, { layer, dataSource }) {
  const documentRef = viewer?.container?.ownerDocument ?? globalThis.document;
  if (!documentRef || !viewer?.scene?.canvas) return null;
  const popup = documentRef.createElement('div');
  popup.className = 'cv-marker-popup';
  popup.hidden = true;
  popup.setAttribute('role', 'dialog');
  
  const title = documentRef.createElement('strong');
  const source = documentRef.createElement('span');
  source.className = 'cv-marker-source';
  const body = documentRef.createElement('p');
  const attribution = documentRef.createElement('span');
  attribution.className = 'cv-marker-attribution';
  const health = documentRef.createElement('span');
  health.className = 'cv-marker-health';
  
  // Action buttons
  const copyCoords = documentRef.createElement('button');
  copyCoords.type = 'button';
  copyCoords.className = 'cv-marker-copy-coords';
  copyCoords.textContent = t('Copy coordinates');
  copyCoords.setAttribute('aria-label', t('Copy coordinates'));
  
  const zoomTo = documentRef.createElement('button');
  zoomTo.type = 'button';
  zoomTo.className = 'cv-marker-zoom-to';
  zoomTo.textContent = t('Zoom to');
  zoomTo.setAttribute('aria-label', t('Zoom to'));
  
  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'cv-marker-close';
  close.textContent = t('Close');
  close.setAttribute('aria-label', t('Close'));
  
  const actions = documentRef.createElement('div');
  actions.className = 'cv-marker-actions';
  actions.append(copyCoords, zoomTo, close);
  
  popup.append(title, source, body, attribution, health, actions);
  viewer.container.appendChild(popup);

  const hide = () => {
    popup.hidden = true;
  };
  
  const getEntityPosition = (entity) => {
    const now = Cesium.JulianDate.now();
    return entity.position?.getValue?.(now);
  };
  
  const formatCoords = (position) => {
    if (!position) return '';
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    const lat = Cesium.Math.toDegrees(cartographic.latitude).toFixed(6);
    const lon = Cesium.Math.toDegrees(cartographic.longitude).toFixed(6);
    const height = cartographic.height >= 0 ? `, ${Math.round(cartographic.height)}m` : '';
    return `${lat}, ${lon}${height}`;
  };
  
  const show = (entity, position) => {
    const now = Cesium.JulianDate.now();
    title.textContent = String(entity.name ?? entity.id ?? '');
    
    // Source as clickable link if URL
    const sourceUrl = layer?.sourceUrl ?? layer?.provider?.url ?? '';
    if (sourceUrl && sourceUrl.startsWith('http')) {
      source.innerHTML = `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceUrl}</a>`;
    } else {
      source.textContent = sourceUrl;
    }
    
    body.textContent =
      plainText(entity.description?.getValue?.(now)) ||
      String(entity.properties?.description?.getValue?.(now) ?? '').trim() ||
      t('No description');
    
    // Attribution
    const attr = layer?.attribution ?? layer?.provider?.attribution ?? '';
    if (attr) {
      attribution.textContent = attr;
      attribution.hidden = false;
    } else {
      attribution.hidden = true;
    }
    
    // Health status from catalog
    const healthStatus = layer?.metadata?.health?.status;
    if (healthStatus && healthStatus !== 'ok') {
      health.textContent = `Health: ${healthStatus}`;
      health.hidden = false;
    } else {
      health.hidden = true;
    }
    
    // Copy coordinates action
    const entityPos = getEntityPosition(entity);
    copyCoords.onclick = async () => {
      const coords = formatCoords(entityPos);
      if (coords) {
        try {
          await navigator.clipboard.writeText(coords);
          copyCoords.textContent = t('Copied!');
          setTimeout(() => { copyCoords.textContent = t('Copy coordinates'); }, 1500);
        } catch {
          copyCoords.textContent = t('Copy failed');
          setTimeout(() => { copyCoords.textContent = t('Copy coordinates'); }, 1500);
        }
      }
    };
    
    // Zoom to action
    zoomTo.onclick = () => {
      if (entityPos) {
        viewer.camera.flyTo({
          destination: entityPos,
          duration: 1.2,
        });
      }
      hide();
    };
    
    popup.hidden = false;
    const width = 340;
    const height = popup.offsetHeight || 180;
    const left = Math.max(
      8,
      Math.min(position.x + 14, viewer.container.clientWidth - width - 8),
    );
    const top = Math.max(
      8,
      Math.min(position.y - 12, viewer.container.clientHeight - height - 8),
    );
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    const entity = picked?.id;
    if (
      !entity ||
      dataSource.entities.getById(entity.id) !== entity ||
      !entity.position
    ) {
      hide();
      return;
    }
    show(entity, movement.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  close.addEventListener('click', hide);
  const hideOnMove = () => hide();
  viewer.camera.moveStart.addEventListener(hideOnMove);

  return {
    hide,
    destroy() {
      close.removeEventListener('click', hide);
      viewer.camera.moveStart.removeEventListener(hideOnMove);
      handler.destroy();
      popup.remove();
    },
  };
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
    applyTerrainOcclusion(dataSource);
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
    applyTerrainOcclusion(dataSource);
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
