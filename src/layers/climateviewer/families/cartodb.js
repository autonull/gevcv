import { createImageryFamily } from './imageryFamily.js';

/** `cartodb` family: Cesium imagery provider. */
export function createFamily(definition, dependencies = {}) {
  return createImageryFamily(definition, dependencies);
}
