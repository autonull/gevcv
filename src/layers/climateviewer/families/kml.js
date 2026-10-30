import { createVectorFamily } from './vectorFamily.js';

/** `kml` family: Cesium data source. */
export function createFamily(definition, dependencies = {}) {
  return createVectorFamily(definition, dependencies);
}
