import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../layers/climateviewer/catalog.json' with { type: 'json' };
import {
  climateViewerFolderForLayer,
  climateViewerFolderLayerIds,
  climateViewerFolderState,
  createClimateViewerTree,
  defaultCollapsedFolders,
  flattenClimateViewerTree,
} from './climateViewerTree.js';

const layers = Object.values(catalog.layers).map((layer) => ({
  id: layer.id,
  name: layer.name,
  metadata: layer,
}));

test('the catalogue tree resolves every live layer exactly once', () => {
  const tree = createClimateViewerTree(catalog.tree, layers);
  const ids = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'layer') ids.push(node.id);
      else visit(node.children);
    }
  };
  visit(tree);
  assert.equal(ids.length, layers.length);
  assert.equal(new Set(ids).size, layers.length);
  const topLevel = tree.find((node) => node.name === 'Alerts');
  assert.equal(topLevel.count, 29);
  assert.equal(topLevel.children.length, 6);
});

test('unknown catalogue ids are dropped and empty folders disappear', () => {
  const tree = createClimateViewerTree(
    [
      {
        kind: 'folder',
        name: 'Empty',
        children: [{ kind: 'layer', id: 'missing' }],
      },
      {
        kind: 'folder',
        name: 'Live',
        children: [{ kind: 'layer', id: 'cv-live-usgs-all-hour' }],
      },
    ],
    [layers.find(({ id }) => id === 'cv-live-usgs-all-hour')],
  );
  assert.deepEqual(
    tree.map((node) => node.name),
    ['Live'],
  );
  assert.equal(tree[0].count, 1);
});

test('collapsed folders hide descendants while keeping their own row', () => {
  const tree = createClimateViewerTree(catalog.tree, layers);
  const alerts = tree.find((node) => node.name === 'Alerts');
  const collapsed = new Set([alerts.path]);
  const rows = flattenClimateViewerTree(tree, collapsed);
  const folderRow = rows.find((row) => row.path === alerts.path);
  assert.equal(folderRow.kind, 'folder');
  assert.equal(folderRow.open, false);
  assert.equal(
    rows.some((row) => row.path.startsWith(`${alerts.path}/`)),
    false,
  );
  const expanded = flattenClimateViewerTree(tree, new Set());
  assert.ok(expanded.some((row) => row.kind === 'folder' && row.depth === 1));
  assert.equal(expanded.filter((row) => row.kind === 'layer').length, layers.length);
});

test('nested folders start collapsed but roots stay open', () => {
  const tree = createClimateViewerTree(catalog.tree, layers);
  const collapsed = defaultCollapsedFolders(tree);
  assert.ok(collapsed.size > 0);
  for (const path of collapsed) assert.match(path, /\//);
  const rows = flattenClimateViewerTree(tree, collapsed);
  assert.ok(rows.some((row) => row.kind === 'folder' && row.depth === 0));
  for (const row of rows) {
    if (row.kind === 'folder' && row.depth > 0) assert.equal(row.open, false);
    if (row.kind === 'layer') assert.ok(row.depth <= 1);
  }
});

test('a layer resolves to its deepest containing folder', () => {
  const tree = createClimateViewerTree(catalog.tree, layers);
  const folder = climateViewerFolderForLayer(tree, 'cv-live-usgs-all-hour');
  assert.equal(folder.name, 'Earthquake');
  assert.equal(folder.path, 'Alerts/Earthquake');
  assert.equal(
    climateViewerFolderForLayer(tree, 'missing-layer'),
    null,
  );
});

test('folder state reports partial and complete enablement', () => {
  const tree = createClimateViewerTree(catalog.tree, layers);
  const alerts = tree.find((node) => node.name === 'Alerts');
  const ids = climateViewerFolderLayerIds(alerts);
  assert.equal(ids.length, alerts.count);
  const none = climateViewerFolderState(alerts, () => false);
  assert.deepEqual(
    [none.enabled, none.total, none.all, none.some],
    [0, ids.length, false, false],
  );
  const one = climateViewerFolderState(alerts, (id) => id === ids[0]);
  assert.deepEqual([one.enabled, one.all, one.some], [1, false, true]);
  const all = climateViewerFolderState(alerts, () => true);
  assert.deepEqual([all.enabled, all.all, all.some], [ids.length, true, true]);
});
