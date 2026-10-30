import { createImageryFamily } from './imageryFamily.js';

/** `arcgis` family: Cesium imagery provider. */
export function createFamily(definition, dependencies = {}) {
  return createImageryFamily(definition, dependencies);
}
