import { createFamily as arcgis } from './arcgis.js';
import { createFamily as baseLayer } from './baseLayer.js';

import { createFamily as bing } from './bing.js';
import { createFamily as cartodb } from './cartodb.js';
import { createFamily as geojson } from './geojson.js';
import { createFamily as gibs } from './gibs.js';
import { createFamily as kml } from './kml.js';
import { createFamily as wms } from './wms.js';

const FAMILIES = Object.freeze({
  arcgis,
  baseLayer,
  bing,
  cartodb,
  geojson,
  gibs,
  kml,
  wms,
});

/** Resolve a catalog family id to its lifecycle factory. */
export function familyFactory(family) {
  return FAMILIES[family] ?? null;
}

export function createFamily(definition, dependencies = {}) {
  const factory = familyFactory(definition?.family);
  if (!factory)
    throw new Error(
      `Unsupported ClimateViewer family: ${definition?.family ?? 'unknown'}`,
    );
  return factory(definition, dependencies);
}
