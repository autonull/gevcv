import { createImageryFamily } from './imageryFamily.js';

/** `baseLayer` family: Cesium imagery provider. */
export function createFamily(definition, dependencies = {}) {
  return createImageryFamily(definition, dependencies);
}
