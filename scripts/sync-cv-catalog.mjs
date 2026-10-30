#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath =
  process.env.CV_LAYERS_FILE ??
  path.resolve(root, '../cv/dist/js/cv-layers-5.5.js');
const cvRoot = process.env.CV_ROOT ?? path.resolve(root, '../cv');
const outputDir = path.join(root, 'src/layers/climateviewer');
const publicDir = path.join(root, 'public/cv');

export const CATALOG_VERSION = 2;
export const MINIMUM_LAYER_COUNT = 400;
export const MAXIMUM_LAYER_DROP = 0.05;

const FAMILIES = Object.freeze({
  kml: { family: 'kml', role: 'overlay' },
  'arcgis-layer': { family: 'arcgis', role: 'overlay' },
  arcgis: { family: 'arcgis', role: 'overlay' },
  geojson: { family: 'geojson', role: 'overlay' },
  wms: { family: 'wms', role: 'overlay' },
  'nasa-gibs': { family: 'gibs', role: 'overlay', generatedUrl: true },
  'cartodb-layer': { family: 'cartodb', role: 'basemap' },
  'base-layer': { family: 'baseLayer', role: 'basemap' },
  bing: { family: 'bing', role: 'basemap', keyRequired: true },
});

const GIBS = Object.freeze({
  url: 'https://map1.vis.earthdata.nasa.gov/wmts-webmerc/wmts.cgi',
  format: 'image/jpeg',
  tileMatrixSetID: 'GoogleMapsCompatible_Level9',
  maximumLevel: 9,
});

const CATEGORY_LABELS = Object.freeze({
  Live: 'Live',
  weather: 'Weather',
  satellites: 'Satellites',
  pollution: 'Pollution',
  bigbrother: 'Big Brother',
  WXMOD: 'Weather Modification',
  electromagnetic: 'Electromagnetic',
  MRM: 'MyReadingMapped',
  other: 'Other',
  basemaps: 'Basemaps',
});

const VALID_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_CV_ID = /^[A-Za-z0-9_.:-]+$/;

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'layer';

const stripHtml = (value) =>
  String(value ?? '')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function readDefinitions(file) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/var layers\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) throw new Error(`No \`var layers = {...}\` in ${file}`);
  return { source, tree: new Function(`return ${match[1]}`)() };
}

/** Stable SHA-256 over layer entries, ordered by id. */
export function hashLayerEntries(layers) {
  const ordered = Object.keys(layers)
    .sort()
    .map((id) => layers[id]);
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Asset manifest content for the files copied in this sync. */
export function buildAssetManifest({
  files,
  catalogHash,
  generatedFromSha = null,
}) {
  const entries = [...files.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const hash = createHash('sha256')
    .update(entries.map(([file, digest]) => `${file}:${digest}`).join('\n'))
    .digest('hex');
  return {
    version: 1,
    generatedFromSha,
    catalogHash,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, [, entry]) => sum + entry.bytes, 0),
    hash,
    files: Object.fromEntries(
      entries.map(([file, entry]) => [
        file,
        { bytes: entry.bytes, sha256: entry.sha256 },
      ]),
    ),
  };
}

/** Validate a freshly built catalog against the committed one. */
export function validateCatalog({
  layers,
  tree,
  previous = null,
  missing = [],
}) {
  const all = collectLayers(tree, layers);
  const problems = [];
  if (all.length < MINIMUM_LAYER_COUNT)
    problems.push(`only ${all.length} layers extracted`);
  if (all.length !== Object.keys(layers).length)
    problems.push('layer table and tree disagree');
  const previousCount = previous
    ? collectLayers(previous.tree ?? [], previous.layers ?? {}).length
    : 0;
  if (
    previousCount > 0 &&
    all.length < previousCount * (1 - MAXIMUM_LAYER_DROP)
  )
    problems.push(
      `layer count dropped from ${previousCount} to ${all.length} (>${MAXIMUM_LAYER_DROP * 100}%)`,
    );
  const seen = new Set();
  for (const layer of all) {
    if (!VALID_ID.test(layer.id)) problems.push(`${layer.id}: invalid id`);
    if (seen.has(layer.id)) problems.push(`${layer.id}: duplicate id`);
    seen.add(layer.id);
    if (!VALID_CV_ID.test(String(layer.cvId)))
      problems.push(`${layer.id}: invalid cvId ${JSON.stringify(layer.cvId)}`);
    if (!layer.url && layer.family !== 'bing')
      problems.push(`${layer.id}: no url`);
    if (!layer.category.length) problems.push(`${layer.id}: no category`);
    if (!layer.provider) problems.push(`${layer.id}: no provider`);
    if (!layer.traits || layer.traits.voice !== 'off')
      problems.push(`${layer.id}: missing traits`);
  }
  if (missing.length)
    problems.push(
      `${missing.length} missing assets: ${missing.slice(0, 3).join(', ')}`,
    );
  return problems;
}

function collectLayers(nodes, layers, out = []) {
  for (const node of nodes) {
    if (node.kind === 'layer') out.push(layers[node.id]);
    else collectLayers(node.children ?? [], layers, out);
  }
  return out;
}

function readPreviousCatalog(catalogPath) {
  if (!fs.existsSync(catalogPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch {
    return null;
  }
}

function cvRevision(cvRoot) {
  try {
    return execFileSync('git', ['-C', cvRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function runSync({
  root,
  sourcePath,
  cvRoot,
  outputDir,
  publicDir,
  revision = cvRevision(cvRoot),
}) {
  const copied = new Map();
  const missing = [];

  function publishAsset(reference) {
    if (!reference || !reference.startsWith('/') || reference.startsWith('//'))
      return reference;
    const from = path.join(cvRoot, reference);
    const to = path.join(publicDir, reference);
    if (!fs.existsSync(from)) {
      missing.push(reference);
      return reference;
    }
    if (!copied.has(`/cv${reference}`)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied.set(`/cv${reference}`, {
        bytes: fs.statSync(to).size,
        sha256: sha256File(to),
      });
    }
    return `/cv${reference}`;
  }

  const normalizeUrl = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (raw.startsWith('/layers/') || raw.startsWith('/img/'))
      return publishAsset(raw);
    if (raw.startsWith('//')) return `https:${raw}`;
    return raw;
  };

  const { tree: definitions } = readDefinitions(sourcePath);
  const layers = {};
  const children = [];
  const folderMeta = new Map();
  const usedIds = new Set();
  const duplicateCvIds = [];

  function walk(node, categoryPath, target) {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, categoryPath, target);
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (node.T) {
      target.push(defineLayer(node, categoryPath));
      return;
    }

    const label = stripHtml(
      node.N ?? path[categoryPath.length - 1] ?? 'Layers',
    );
    const folder = {
      kind: 'folder',
      name: label,
      icon: node.icon ?? '',
      children: [],
    };
    target.push(folder);
    folderMeta.set(folder, { categoryPath, label });
    for (const [key, value] of Object.entries(node)) {
      if (key === 'N' || key === 'icon' || key === 'I' || key === '>') {
        if (key === '>') walk(value, categoryPath, folder.children);
        continue;
      }
      walk(value, [...categoryPath, key], folder.children);
    }
  }

  function buildProvider(mapping, url, node) {
    const sublayers = String(node.L ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    switch (mapping.family) {
      case 'kml':
        return { kind: 'kml', url, proxy: node.P === true };
      case 'geojson':
        return { kind: 'geojson', url };
      case 'arcgis':
        return { kind: 'arcgis', url, sublayers };
      case 'wms':
        return {
          kind: 'wms',
          url,
          layers: sublayers,
          format: 'image/png',
          transparent: true,
        };
      case 'gibs':
        return {
          kind: 'wmts',
          url,
          layer: String(node.I ?? ''),
          format: GIBS.format,
          tileMatrixSetID: GIBS.tileMatrixSetID,
          maximumLevel: GIBS.maximumLevel,
          time: true,
        };
      case 'cartodb':
        return { kind: 'urlTemplate', url };
      case 'baseLayer':
        return { kind: 'osm', url };
      default:
        return { kind: 'bing', imagerySet: String(node.G ?? '') };
    }
  }

  function defineLayer(node, categoryPath) {
    const cvId = String(node.I ?? 'unknown');
    const mapping = FAMILIES[String(node.T)] ?? FAMILIES.kml;
    const base = `cv-${slug(categoryPath[0] ?? 'other')}-${slug(cvId)}`;
    let id = base;
    if (usedIds.has(id)) {
      duplicateCvIds.push(cvId);
      let suffix = 2;
      while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
      id = `${base}-${suffix}`;
    }
    usedIds.add(id);

    const sublayers = String(node.L ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const url = mapping.generatedUrl ? GIBS.url : normalizeUrl(node.G);
    const layer = {
      id,
      cvId,
      name: stripHtml(node.N ?? cvId),
      type: node.T,
      family: mapping.family,
      role: mapping.role,
      url,
      provider: buildProvider(mapping, url, node),
      sublayers,
      category: categoryPath.map((key) => CATEGORY_LABELS[key] ?? key),
      categoryKey: categoryPath[0] ?? 'other',
      description: stripHtml(node.S).slice(0, 600),
      sourceUrl: normalizeUrl(node.U),
      markerIcon: normalizeUrl(node.MI ?? ''),
      markerScale: Number(node.MS) || 1,
      flags: {
        large: node.H === true,
        new: node.NL === true,
        timeline: node.C === true,
        proxy: node.P === true,
        noFeatures: node.X === true,
        zoomTo: node.Z === true,
        threeOnly: node.TRD === true,
        leafletOnly: node.TWD === true,
      },
      // Replaces per-layer exemption lists in i18n, voice and panel code.
      traits: {
        // Names come from the source catalogue, not from UI message ids.
        nameIsData: true,
        voice: 'off',
      },
    };
    layers[id] = layer;
    return { kind: 'layer', id };
  }

  for (const [key, value] of Object.entries(definitions)) {
    if (key === 'I' || key === 'N') continue;
    if (value && typeof value === 'object' && !Array.isArray(value))
      walk(value, [key], children);
  }

  for (const folder of folderMeta.keys()) {
    if (folder.children.length === 1 && folder.children[0].kind === 'folder') {
      folder.collapsed = true;
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const catalogPath = path.join(outputDir, 'catalog.json');
  const previous = readPreviousCatalog(catalogPath);
  const problems = validateCatalog({
    layers,
    tree: children,
    previous,
    missing,
  });
  if (problems.length) {
    console.error(`✖ sync-cv-catalog: ${problems.length} problem(s)`);
    for (const problem of problems.slice(0, 20))
      console.error(`  - ${problem}`);
    process.exit(1);
  }

  const hash = hashLayerEntries(layers);
  const catalog = {
    version: CATALOG_VERSION,
    generatedFrom: path.relative(root, sourcePath),
    generatedFromSha: revision,
    hash: hash.slice(0, 8),
    tree: children,
    layers,
  };
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);

  fs.mkdirSync(publicDir, { recursive: true });
  const manifest = buildAssetManifest({
    files: copied,
    catalogHash: catalog.hash,
    generatedFromSha: revision,
  });
  const manifestPath = path.join(publicDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

  const all = collectLayers(children, layers);
  const byFamily = {};
  const byCategory = {};
  for (const layer of all) {
    byFamily[layer.family] = (byFamily[layer.family] ?? 0) + 1;
    byCategory[layer.categoryKey] = (byCategory[layer.categoryKey] ?? 0) + 1;
  }
  const local = all.filter((layer) => layer.url.startsWith('/cv/')).length;
  const size = (fs.statSync(catalogPath).size / 1024).toFixed(1);

  console.log(
    `✓ ${all.length} layers → ${path.relative(root, catalogPath)} (${size} KB, hash ${catalog.hash})`,
  );
  console.log(`  families: ${JSON.stringify(byFamily)}`);
  console.log(`  categories: ${JSON.stringify(byCategory)}`);
  console.log(
    `  local assets: ${local} layers, ${copied.size} files, ${manifest.totalBytes} bytes`,
  );
  console.log(
    `  manifest: ${path.relative(root, manifestPath)} (${manifest.hash.slice(0, 8)})`,
  );
  console.log(
    `  duplicate cvIds resolved: ${duplicateCvIds.length ? duplicateCvIds.join(', ') : 'none'}`,
  );
  return { catalog, manifest };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runSync({ root, sourcePath, cvRoot, outputDir, publicDir });
}

export { runSync };
