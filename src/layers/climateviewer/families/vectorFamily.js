import * as Cesium from 'cesium';
import { describeLoadFailure } from '../imagery.js';
import { loadVectorDataSource, readAnalystRecords } from '../vector.js';

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
  let lastUpdate = null;

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
      source.show = true;
      await viewer.dataSources.add(source);
      if (epoch !== generation || !enabled) {
        viewer.dataSources.remove(source, true);
        return false;
      }
      dataSource = source;
      count = source.entities.values.length;
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
    records: (max) => (dataSource ? readAnalystRecords(dataSource, max) : []),
    stats: () => ({ count, lastUpdate, error, remedy, status }),
  };
}
