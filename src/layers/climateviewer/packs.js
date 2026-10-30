import catalog from './catalog.json' with { type: 'json' };
import packsFile from './packs.json' with { type: 'json' };

const ORDER = new Set(Object.keys(catalog.layers));
const BY_ID = new Map(packsFile.packs.map((pack) => [pack.id, pack]));

/** Named presets, in catalog order, with unknown ids removed. */
export const CLIMATEVIEWER_PACKS = Object.freeze(
  packsFile.packs.map((pack) =>
    Object.freeze({
      ...pack,
      layers: Object.freeze(pack.layers.filter((id) => ORDER.has(id))),
    }),
  ),
);

export const STARTER_PACK_ID = 'disaster-watch';

export function getClimateViewerPack(id) {
  return BY_ID.get(id) ?? null;
}

export function starterClimateViewerLayerIds() {
  return getClimateViewerPack(STARTER_PACK_ID)?.layers?.slice() ?? [];
}

/** The pack whose layer set exactly matches the enabled CV ids, if any. */
export function activeClimateViewerPackId(enabledIds) {
  const enabled = new Set(enabledIds ?? []);
  if (!enabled.size) return null;
  for (const pack of CLIMATEVIEWER_PACKS) {
    if (pack.layers.length !== enabled.size) continue;
    if (pack.layers.every((id) => enabled.has(id))) return pack.id;
  }
  return null;
}

/** Catalog names, used by the Markdown atlas and pack tests. */
export function climateViewerLayerName(id) {
  return catalog.layers[id]?.name ?? id;
}
