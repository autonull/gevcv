import { createImageryFamily } from './imageryFamily.js';

/** `gibs` family: Cesium imagery provider. */
export function createFamily(definition, dependencies = {}) {
  return createImageryFamily(definition, dependencies);
}
