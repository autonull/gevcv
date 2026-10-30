import { createImageryFamily } from './imageryFamily.js';

/** `bing` family: Cesium imagery provider. */
export function createFamily(definition, dependencies = {}) {
  return createImageryFamily(definition, dependencies);
}
