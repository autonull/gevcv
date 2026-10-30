import * as Cesium from 'cesium';
import { describeLoadFailure } from '../imagery.js';
import {
  loadVectorDataSource,
  PROGRESSIVE_ENTITY_THRESHOLD,
  readAnalystRecords,
} from '../vector.js';

const PROGRESSIVE_CHUNK = 500;

const nextFrame = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Shared lifecycle for KML and GeoJSON families. Downloads are generation-
 * guarded so a late response after disable cannot resurrect the layer.
 */
export function createVectorFamily(
  definition,
  {
    resolveAsset = null,
    proxyUrl = null,
    loadVector = loadVectorDataSource,
    progressiveThreshold = PROGRESSIVE_ENTITY_THRESHOLD,
    progressiveChunk = PROGRESSIVE_CHUNK,
  } = {},
) {
  let viewer = null;
  let dataSource = null;
  let controller = null;
  let enabled = false;
  let generation = 0;
  let status = 'idle';
  let error = null;
  let remedy = null;
  let count = 0;
  let rendered = 0;
  let progressive = false;
  let lastUpdate = null;
  let spotlightAlpha = 1;
  const spotlightColors = new WeakMap();

  function applySpotlight(source = dataSource) {
    if (!source?.entities?.values) return;
    const now = Cesium.JulianDate.now();
    for (const entity of source.entities.values) {
      for (const key of ['billboard', 'point', 'label']) {
        const graphic = entity[key];
        if (!graphic) continue;
        const property = key === 'label' ? graphic.fillColor : graphic.color;
        if (!property) continue;
        const current = property.getValue?.(now) ?? property;
        if (typeof current?.withAlpha !== 'function') continue;
        let original = spotlightColors.get(graphic);
        if (!original) {
          original = current.clone?.() ?? current;
          spotlightColors.set(graphic, original);
        }
        const color = original.withAlpha(original.alpha * spotlightAlpha);
        if (key === 'label') graphic.fillColor = color;
        else graphic.color = color;
      }
    }
  }

  function setSpotlightOpacity(alpha) {
    spotlightAlpha = Math.min(Math.max(Number(alpha) || 1, 0), 1);
    applySpotlight();
  }

  async function attach(target) {
    viewer = target;
    enabled = true;
    const epoch = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    try {
      const source = await loadVector(definition, viewer, {
        resolveAsset,
        proxyUrl,
        signal,
      });
      if (signal.aborted || epoch !== generation || !enabled) {
        source.show = false;
        return false;
      }
      const total = source.entities.values.length;
      const useProgressive = total > progressiveThreshold;
      let pending = null;
      if (useProgressive) {
        pending = [...source.entities.values];
        source.entities.removeAll();
        status = 'loading';
        count = total;
        rendered = 0;
      }
      source.show = true;
      applySpotlight(source);
      await viewer.dataSources.add(source);
      if (epoch !== generation || !enabled) {
        viewer.dataSources.remove(source, true);
        return false;
      }
      dataSource = source;
      if (useProgressive) {
        progressive = true;
        const step = Math.max(1, Math.floor(progressiveChunk));
        for (let index = 0; index < pending.length; index += step) {
          if (epoch !== generation || !enabled) return false;
          for (const entity of pending.slice(index, index + step))
            source.entities.add(entity);
          rendered = source.entities.values.length;
          lastUpdate = Date.now();
          viewer.scene?.requestRender?.();
          await nextFrame();
        }
        progressive = false;
      }
      applySpotlight(source);
      count = total;
      rendered = source.entities.values.length;
      lastUpdate = Date.now();
      status = count > 0 ? 'ok' : 'empty';
      error = null;
      remedy = null;
      return true;
    } catch (failure) {
      if (signal.aborted || epoch !== generation) return false;
      const described = describeLoadFailure(failure);
      status = described.status;
      error = described.message;
      remedy = described.remedy ?? null;
      console.warn(`[ClimateViewer] ${definition.id}: ${described.message}`);
      return false;
    }
  }

  function detach() {
    enabled = false;
    generation += 1;
    controller?.abort();
    controller = null;
    if (dataSource && viewer) {
      viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    }
    count = 0;
    rendered = 0;
    progressive = false;
    lastUpdate = null;
    status = 'idle';
    error = null;
    remedy = null;
  }

  async function refresh() {
    if (!viewer || !enabled) return false;
    return attach(viewer);
  }

  function zoomTo() {
    if (!viewer || !dataSource) return false;
    const now = Cesium.JulianDate.now();
    const positions = [];
    for (const entity of dataSource.entities.values) {
      if (positions.length >= 5000) break;
      const position = entity.position?.getValue?.(now);
      if (position) positions.push(position);
    }
    if (positions.length < 2) return false;
    const rectangle = Cesium.Rectangle.fromCartesianArray(positions);
    if (!rectangle) return false;
    viewer.camera.flyTo({ destination: rectangle, duration: 1.2 });
    return true;
  }

  return {
    kind: 'vector',
    attach,
    detach,
    refresh,
    zoomTo,
    setSpotlightOpacity,
    records: (max) => (dataSource ? readAnalystRecords(dataSource, max) : []),
    stats: () => ({
      count,
      rendered,
      progressive,
      lastUpdate,
      error,
      remedy,
      status,
    }),
  };
}
