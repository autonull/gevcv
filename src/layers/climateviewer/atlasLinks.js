/** Per-layer deep link: `?layer=<id>` with no stale share hash. */
export function climateViewerLayerDeepLink(
  id,
  href = globalThis.location?.href,
) {
  if (!id || !href) return null;
  const url = new URL(href);
  url.searchParams.set('layer', id);
  url.hash = '';
  return url.href;
}

export function climateViewerDeepLinkLayerId(search) {
  const value = new URLSearchParams(search ?? '').get('layer');
  return value && value.startsWith('cv-') ? value : null;
}

function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

/**
 * Agent-readable atlas table. `layers` may be catalog entries or live
 * descriptors; both expose name/id/metadata.
 */
export function climateViewerMarkdownTable(layers) {
  const rows = [
    '| Layer | Category | Family | Role | Source |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const layer of layers ?? []) {
    const metadata = layer.metadata ?? layer;
    const category = Array.isArray(metadata.category)
      ? metadata.category.join(' / ')
      : metadata.category;
    rows.push(
      `| ${cell(layer.name)} | ${cell(category)} | ${cell(layer.family ?? metadata.family)} | ${cell(metadata.role)} | ${cell(metadata.sourceUrl)} |`,
    );
  }
  return rows.join('\n');
}
