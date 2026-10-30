#!/usr/bin/env node
/**
 * ClimateViewer proof tour. Boots the built app, drives real UI interactions and
 * fails when the globe is blank, the console errors, or a toggled layer reports
 * no data. Screenshots are artefacts of a passing run, never a substitute for one.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const shotsDir = path.join(root, 'docs/screenshots');
const PORT = Number(process.env.QA_PORT || 4173);
const MIN_PIXEL_VARIANCE = Number(process.env.QA_PIXEL_VARIANCE || 12);

fs.mkdirSync(shotsDir, { recursive: true });
const failures = [];
const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function serve() {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html')))
    throw new Error('dist/index.html missing — run `npm run build` first');
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.geojson': 'application/geo+json',
    '.kml': 'application/vnd.google-earth.kml+xml',
    '.kmz': 'application/vnd.google-earth.kmz',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2',
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || url.pathname === '/')
      file = path.join(dist, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(dist, 'index.html');
    response.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(PORT, resolve));
  return server;
}

async function canvasVariance(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    const canvas = canvases.sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    if (!canvas) return 0;
    const grid = document.createElement('canvas');
    grid.width = 64;
    grid.height = 64;
    const context = grid.getContext('2d');
    context.drawImage(canvas, 0, 0, 64, 64);
    const { data } = context.getImageData(0, 0, 64, 64);
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const luma = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      sum += luma;
      sumSq += luma * luma;
      count += 1;
    }
    const mean = sum / count;
    return Math.sqrt(sumSq / count - mean * mean);
  });
}

async function openLayerPanel(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visible = await page.evaluate(() => {
      const section = document.querySelector('.data-cv-section');
      return Boolean(section && section.getBoundingClientRect().width > 0);
    });
    if (visible) return true;
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('button, [role="button"], div')]
        .find((node) => /DATA LAYERS/.test(node.textContent || '') &&
          node.querySelectorAll('*').length < 6);
      const control = label?.closest('[class*="rail"], section, header, div');
      control?.querySelector?.('button:last-of-type')?.click();
      label?.click?.();
    });
    await page.waitForTimeout(1200);
  }
  return page.evaluate(() => {
    const section = document.querySelector('.data-cv-section');
    return Boolean(section && section.getBoundingClientRect().width > 0);
  });
}

async function filterAndToggle(page, query) {
  await page.evaluate(() => {
    const section = document.querySelector('.data-cv-section');
    if (section && !section.open) {
      section.open = true;
      section.dispatchEvent(new Event('toggle'));
    }
  });
  await page.waitForTimeout(400);
  await page.evaluate((value) => {
    const filter = document.querySelector('.data-cv-filter');
    filter.value = value;
    filter.dispatchEvent(new Event('input'));
  }, query);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const row = document.querySelector('.data-cv-row');
    if (!row) return null;
    const id = row.dataset.layerId;
    row.querySelector('button.data-toggle-btn').click();
    return id;
  });
}

const statsFor = (page, id) =>
  page.evaluate((layerId) => {
    const entry = window.__gevData?.layers.get(layerId);
    return entry?.module.getStats?.() ?? null;
  }, id);

/** Bring the ClimateViewer section and its filtered rows into the panel view. */
async function revealClimateViewerRow(page) {
  await page.evaluate(() => {
    const section = document.querySelector('.data-cv-section');
    section?.scrollIntoView({ block: 'start' });
    const row = section?.querySelector('.data-cv-row');
    row?.scrollIntoView({ block: 'nearest' });
  });
  await page.waitForTimeout(600);
}

async function shot(page, name) {
  const file = path.join(shotsDir, name);
  await page.screenshot({ path: file });
  const { size } = fs.statSync(file);
  console.log(`  📸 ${name} (${(size / 1024).toFixed(0)} KB)`);
  return { name, size };
}

const server = await serve();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/Content Security Policy|favicon|Failed to load resource/.test(text)) return;
  consoleErrors.push(text.slice(0, 200));
});
page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 200)));

try {
  await page.addInitScript(() => {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__gevData), null, {
    timeout: 90_000,
  });
  await page.waitForTimeout(12000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  const variance = await canvasVariance(page);
  check('globe renders (canvas pixel variance)', variance >= MIN_PIXEL_VARIANCE,
    `σ=${variance.toFixed(1)}`);
  await shot(page, '01-boot.png');

  const panelOpen = await openLayerPanel(page);
  const sectionCount = await page.locator('.data-cv-section').count();
  check('ClimateViewer section present', sectionCount === 1);
  check('layer panel visible', panelOpen, panelOpen ? '' : 'panel stayed closed');
  await shot(page, '02-layer-panel.png');

  const vectorId = await filterAndToggle(page, 'boiling water');
  check('vector layer identified', Boolean(vectorId), vectorId || 'no row');
  if (vectorId) {
    await page.waitForTimeout(9000);
    const stats = await statsFor(page, vectorId);
    check('local GeoJSON layer loads entities', (stats?.count ?? 0) > 0,
      `${stats?.count ?? 0} entities`);
    check('local GeoJSON layer reports ok', stats?.status === 'ok', stats?.error || '');
    await revealClimateViewerRow(page);
    await shot(page, '03-cv-vectors.png');
  }

  const tileId = await filterAndToggle(page, 'nexrad');
  check('imagery layer identified', Boolean(tileId), tileId || 'no row');
  if (tileId) {
    await page.waitForTimeout(6000);
    const stats = await statsFor(page, tileId);
    check('imagery layer attaches', stats?.status === 'ok', stats?.status || 'no stats');
    await shot(page, '04-cv-imagery.png');
  }

  await page.evaluate(() => {
    const viewer = window.__gevViewer;
    const Cesium = window.__CESIUM__;
    if (!viewer || !Cesium) return;
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(-125, 18, -60, 55),
      duration: 0,
    });
  }).catch(() => {});
  await page.waitForTimeout(4000);
  await shot(page, '05-globe-with-cv-layer.png');

  const atlasPressed = await page.evaluate(() => {
    const button = document.getElementById('atlas-mode-toggle');
    if (!button) return null;
    button.click();
    return button.getAttribute('aria-pressed');
  });
  check('Atlas Mode toggles from the display controls', atlasPressed === 'true',
    atlasPressed ?? 'missing button');
  await page.waitForTimeout(1600);
  await shot(page, '06-atlas-mode.png');

  const registry = await page.evaluate(() => ({
    layers: window.__gevData.layers.size,
    cv: [...window.__gevData.layers.keys()].filter((id) => id.startsWith('cv-')).length,
  }));
  check('catalog holds every CV layer', registry.cv === 405, `${registry.cv} CV / ${registry.layers} total`);
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`tour aborted: ${error.message}`);
  console.error(error);
} finally {
  await browser.close();
  server.close();
}

const gallery = fs
  .readdirSync(shotsDir)
  .filter((name) => name.endsWith('.png'))
  .sort()
  .map(
    (name) =>
      `<figure><img src="${name}" alt="${name}"><figcaption>${name}</figcaption></figure>`,
  )
  .join('\n');
fs.writeFileSync(
  path.join(shotsDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>ClimateViewer tour</title><style>body{background:#05080b;color:#ccd;font:14px system-ui;margin:24px}figure{margin:0 0 28px}img{max-width:100%;border:1px solid #223}</style><h1>God's Eye View — ClimateViewer tour</h1>${gallery}\n`,
);

fs.writeFileSync(
  path.join(shotsDir, 'tour-results.json'),
  `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
);

if (failures.length) {
  console.error(`\n✖ ${failures.length} tour failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n✓ tour passed; screenshots in docs/screenshots');
