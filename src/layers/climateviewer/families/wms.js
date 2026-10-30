import { createImageryFamily } from './imageryFamily.js';

/** `wms` family: Cesium imagery provider. */
export function createFamily(definition, dependencies = {}) {
  return createImageryFamily(definition, dependencies);
}
