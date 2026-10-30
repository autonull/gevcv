/**
 * Resolve the generated ClimateViewer catalogue tree against the live panel
 * layers. Catalog ids are stable; a layer absent from the panel is dropped so
 * the tree never renders a row that cannot toggle anything.
 */
export function createClimateViewerTree(catalogTree, layers) {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const walk = (node, parentPath) => {
    if (node.kind === 'layer') {
      const layer = byId.get(node.id);
      if (!layer) return null;
      return { kind: 'layer', id: node.id, layer, path: node.id };
    }
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    const children = node.children
      .map((child) => walk(child, path))
      .filter(Boolean);
    if (!children.length) return null;
    const count = children.reduce(
      (total, child) => total + (child.kind === 'layer' ? 1 : child.count),
      0,
    );
    return {
      kind: 'folder',
      name: node.name,
      icon: node.icon ?? '',
      path,
      children,
      count,
    };
  };
  return catalogTree.map((node) => walk(node, '')).filter(Boolean);
}

/** Deepest folder that directly contains a layer id, or null. */
export function climateViewerFolderForLayer(nodes, layerId) {
  const visit = (entries) => {
    for (const entry of entries) {
      if (entry.kind === 'layer') {
        if (entry.id === layerId) return null;
        continue;
      }
      const direct = entry.children.some(
        (child) => child.kind === 'layer' && child.id === layerId,
      );
      if (direct) return entry;
      const nested = visit(entry.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(nodes);
}

/** Every physical layer id below a folder node, in catalogue order. */
export function climateViewerFolderLayerIds(node) {
  const ids = [];
  const visit = (entry) => {
    if (entry.kind === 'layer') ids.push(entry.id);
    else entry.children.forEach(visit);
  };
  if (node?.kind === 'folder') node.children.forEach(visit);
  return ids;
}

/**
 * Flatten the tree into renderable rows. Collapsed folders contribute one row
 * and no descendants; expanded folders contribute their children in order.
 */
export function flattenClimateViewerTree(nodes, collapsed = new Set()) {
  const rows = [];
  const visit = (entries, depth) => {
    for (const entry of entries) {
      if (entry.kind === 'layer') {
        rows.push({
          kind: 'layer',
          layer: entry.layer,
          path: entry.path,
          depth,
        });
        continue;
      }
      const open = !collapsed.has(entry.path);
      rows.push({ kind: 'folder', node: entry, path: entry.path, depth, open });
      if (open) visit(entry.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return rows;
}

/** Collapsed-by-default paths: every nested folder, leaving the roots open. */
export function defaultCollapsedFolders(nodes) {
  const collapsed = new Set();
  const visit = (entries, depth) => {
    for (const entry of entries) {
      if (entry.kind !== 'folder') continue;
      if (depth > 0) collapsed.add(entry.path);
      visit(entry.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return collapsed;
}

/** Live enable state for a folder's descendants. */
export function climateViewerFolderState(node, isEnabled) {
  const ids = climateViewerFolderLayerIds(node);
  const enabled = ids.filter((id) => isEnabled(id)).length;
  return {
    ids,
    enabled,
    total: ids.length,
    all: ids.length > 0 && enabled === ids.length,
    some: enabled > 0,
  };
}
