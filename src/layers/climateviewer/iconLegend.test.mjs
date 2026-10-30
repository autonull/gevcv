import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(here, 'catalog.json'), 'utf8'),
);
const legend = readFileSync(
  join(here, '../../../docs/CV-ICON-LEGEND.md'),
  'utf8',
);
const markerLayers = Object.values(catalog.layers).filter(
  (layer) => layer.markerIcon,
);
const expectedIcons = [...new Set(markerLayers.map((layer) => layer.markerIcon))];

test('the legend documents every catalog marker and the pixel contract', () => {
  assert.match(legend, /32 × 32 px/);
  assert.match(legend, /0\.25–4/);
  assert.match(
    legend,
    new RegExp(`\\*\\*${expectedIcons.length} distinct marker images\\*\\*`),
  );
  assert.match(
    legend,
    new RegExp(`across\\n${markerLayers.length} vector layers`),
  );
  const linked = new Set(
    [...legend.matchAll(/\]\(\.\.\/public([^)]+)\)/g)].map((match) => match[1]),
  );
  assert.equal(linked.size, expectedIcons.length);
  for (const icon of expectedIcons) assert.ok(linked.has(icon), icon);
});
