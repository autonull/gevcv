import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

function packagePaths(suffix) {
  return Object.keys(lock.packages).filter(
    (path) =>
      path === `node_modules/${suffix}` || path.endsWith(`/node_modules/${suffix}`),
  );
}

test('Cesium resolves to a single engine version', () => {
  const engines = packagePaths('@cesium/engine');
  assert.ok(engines.length > 0, 'engine must be installed');
  assert.equal(
    new Set(engines.map((path) => lock.packages[path].version)).size,
    1,
    `duplicate @cesium/engine copies break ContextLimits: ${engines.join(', ')}`,
  );
  for (const widgets of packagePaths('@cesium/widgets')) {
    const engine = `${widgets}/node_modules/@cesium/engine`;
    assert.ok(
      !lock.packages[engine],
      `@cesium/widgets must share the top-level engine, found ${engine}`,
    );
  }
});
