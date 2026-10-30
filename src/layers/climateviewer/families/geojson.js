import { createVectorFamily } from './vectorFamily.js';

/** `geojson` family: Cesium data source. */
export function createFamily(definition, dependencies = {}) {
  return createVectorFamily(definition, dependencies);
}
