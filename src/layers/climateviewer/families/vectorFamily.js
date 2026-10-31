import * as Cesium from 'cesium';
import { describeLoadFailure } from '../imagery.js';
import {
  applyTerrainOcclusion,
  createMarkerPopup,
  loadVectorDataSource,
  PROGRESSIVE_ENTITY_THRESHOLD,
  readAnalystRecords,
} from '../vector.js';
import { registerPickOwner, unregisterPickOwner } from '../../../data/pickRegistry.js';

const PROGRESSIVE_CHUNK = 500;

const nextFrame = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Build a pick-ownership predicate for the ClimateViewer data source.
 * Entities in the data source carry string ids; we check membership by id.
 */
function makePickPredicate(dataSource) {
  return (pickedId) => {
    if (!dataSource || !pickedId) return false;
    const entity = dataSource.entities.getById(pickedId);
    return entity !== undefined;
  };
}

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
    health = null,
    metadata = {},
  } = {},
) {
  let viewer = null;
  let dataSource = null;
  let markerPopup = null;
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
  let clusterShowHandler = null;
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
      // Some loaders return a data source without readyPromise; DataSourceDisplay
      // and downstream tooling treat that as "not ready". Keep the contract.
      if (!source.readyPromise) source.readyPromise = Promise.resolve(source);
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
      // Ensure EntityCluster's primitive collections are added to the scene's primitives
      // so they participate in rendering and picking. DataSourceDisplay adds the entityCluster
      // (a non-Primitive) to the data source's primitives, which breaks pick recursion.
      // Instead, add the cluster's billboard/label/point collections directly to the
      // scene's primitives where they can be properly rendered and picked.
      // Keep their show state in sync with the data source.
      if (source.clustering) {
        const cluster = source.clustering;
        const scenePrimitives = viewer.scene.primitives;
        const syncShow = () => {
          const show = source.show;
          if (cluster._billboardCollection) cluster._billboardCollection.show = show;
          if (cluster._labelCollection) cluster._labelCollection.show = show;
          if (cluster._pointCollection) cluster._pointCollection.show = show;
        };
        const checkAndAdd = () => {
          if (!enabled || dataSource !== source || !source.show) return;
          let added = false;
          if (cluster._billboardCollection && !scenePrimitives.contains(cluster._billboardCollection)) {
            scenePrimitives.add(cluster._billboardCollection);
            added = true;
          }
          if (cluster._labelCollection && !scenePrimitives.contains(cluster._labelCollection)) {
            scenePrimitives.add(cluster._labelCollection);
            added = true;
          }
          if (cluster._pointCollection && !scenePrimitives.contains(cluster._pointCollection)) {
            scenePrimitives.add(cluster._pointCollection);
            added = true;
          }
          if (added) syncShow();
          else if (!cluster._billboardCollection && !cluster._labelCollection && !cluster._pointCollection) {
            // Collections are created lazily on the first visualizer update.
            viewer.scene?.requestRender?.();
            requestAnimationFrame(checkAndAdd);
          }
        };
        requestAnimationFrame(checkAndAdd);
        clusterShowHandler = syncShow;
        source.addEventListener?.('changed', clusterShowHandler);
      }
      if (epoch !== generation || !enabled) {
        viewer.dataSources.remove(source, true);
        return false;
      }
      dataSource = source;
      // Register pick ownership so sibling layers don't steal CV picks.
      registerPickOwner(definition.id, makePickPredicate(dataSource));
      // Merge definition with health/metadata for popup
      const layerForPopup = {
        ...definition,
        metadata: { ...definition.metadata, ...metadata, health },
      };
      markerPopup = createMarkerPopup(viewer, {
        layer: layerForPopup,
        dataSource,
      });
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
    // Unregister pick ownership before removing data source.
    unregisterPickOwner(definition.id);
    markerPopup?.destroy();
    markerPopup = null;
    if (dataSource && viewer) {
      // The cluster's billboard/label/point collections are owned by the data
      // source's EntityCluster, which destroys them with the data source.
      // Detach them from scene.primitives first, without destroying, or a
      // stale destroyed primitive stays in the scene and throws on next render.
      const cluster = dataSource.clustering;
      const scenePrimitives = viewer.scene?.primitives;
      if (cluster && scenePrimitives) {
        const destroyPrimitives = scenePrimitives.destroyPrimitives;
        scenePrimitives.destroyPrimitives = false;
        for (const collection of [
          cluster._billboardCollection,
          cluster._labelCollection,
          cluster._pointCollection,
        ]) {
          if (collection && scenePrimitives.contains(collection))
            scenePrimitives.remove(collection);
        }
        scenePrimitives.destroyPrimitives = destroyPrimitives;
      }
      dataSource.removeEventListener?.('changed', clusterShowHandler);
      clusterShowHandler = null;
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
