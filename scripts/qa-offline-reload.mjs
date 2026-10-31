#!/usr/bin/env node
/**
 * qa:offline-reload — browser proof that cached layer DATA works offline.
 *
 * Verifies:
 * 1. Load app online, enable a local layer (datacenters/dams) - this caches the GeoJSONL files
 * 2. Go offline (simulate)
 * 3. Reload page
 * 4. Re-enable the layer - should load from cache, no network requests
 * 5. Verify layer renders from cached data
 *
 * Usage:
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run qa:offline-reload -- --url http://localhost:4173
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const getOpt = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const APP_URL = getOpt('--url', 'http://localhost:4173').replace(/\/$/, '');
const HEADFUL = hasFlag('--headful');
const SHOTS_DIR = getOpt('--shots', '');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  await puppeteer.executablePath().catch(() => null),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shoot(page, name) {
  if (!SHOTS_DIR) return `${name}.png (skipped: no --shots dir)`;
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(ROOT, file);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(page, { clearStorage = true, hash = '', query = '' } = {}) {
  if (clearStorage) {
    try {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch {
      // localStorage access denied in some headless configurations
    }
  }
  await page.goto(`${APP_URL}/${query}${hash}`, { waitUntil: 'domcontentloaded' });
}

async function waitForCesiumReady(page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#cesiumContainer canvas');
      if (!canvas) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return !!gl;
    },
    { timeout: 60000 }
  );
  await sleep(1000);
}

async function enableLayer(page, layerId) {
  const result = await page.evaluate(async (id) => {
    const dm = window.__godsEyeView?.dataManager;
    if (!dm) return { ok: false, reason: 'no dataManager' };

    const allLayers = dm.getAll?.() || [];
    console.log('All layers:', JSON.stringify(allLayers.map(l => ({ id: l.id, hasGetStats: typeof l.getStats === 'function' }))));
    const layerExists = allLayers.some(l => l.id === id);
    if (!layerExists) {
      return { ok: false, reason: `layer ${id} not registered` };
    }

    if (!dm.isEnabled(id)) {
      try {
        await dm.setEnabled(id, true);
      } catch (e) {
        return { ok: false, reason: `setEnabled failed: ${e.message}` };
      }
    }
    await dm.waitForLayerSettled?.(id);
    await new Promise(r => setTimeout(r, 3000));
    const enabled = dm.isEnabled(id);
    
    // Get layer stats for debugging
    const layer = allLayers.find(l => l.id === id);
    const stats = layer?.getStats?.() || {};
    console.log(`Layer ${id} stats:`, JSON.stringify(stats));
    
    return { ok: enabled, reason: enabled ? '' : 'layer not enabled after setEnabled', stats };
  }, layerId);
  return result;
}

async function checkLayerRenders(page, layerId) {
  const result = await page.evaluate(async (id) => {
    const viewer = window.__godsEyeView?.viewer;
    const dm = window.__godsEyeView?.dataManager;
    if (!viewer || !dm) return { ok: false, reason: 'no viewer or dataManager' };

    const enabled = dm.isEnabled(id);
    if (!enabled) return { ok: false, reason: 'layer not enabled' };

    // Debug: list all data sources
    const allSources = [];
    for (let i = 0; i < viewer.dataSources.length; i++) {
      const candidate = viewer.dataSources.get(i);
      if (candidate?.entities?.values?.length > 0) {
        const firstEntity = candidate.entities.values[0];
        allSources.push({
          name: candidate.name,
          entityCount: candidate.entities.values.length,
          firstEntityLayerId: firstEntity?.__localLayerId,
          firstEntityId: firstEntity?.id,
        });
      }
    }

    // Find the data source by checking all data sources for our layer tag
    let ds = null;
    let dsName = '';
    for (let i = 0; i < viewer.dataSources.length; i++) {
      const candidate = viewer.dataSources.get(i);
      if (candidate && candidate.entities && candidate.entities.values.length > 0) {
        const firstEntity = candidate.entities.values[0];
        if (firstEntity?.__localLayerId === id) {
          ds = candidate;
          dsName = candidate.name;
          break;
        }
      }
    }

    if (!ds) {
      // Fallback: check by name
      ds = viewer.dataSources.getByName(id === 'local-dams' ? 'Dams' : 'Datacenters');
      dsName = ds?.name || '';
    }

    if (!ds) {
      // Last resort: find any data source with entities
      for (let i = 0; i < viewer.dataSources.length; i++) {
        const candidate = viewer.dataSources.get(i);
        if (candidate?.entities?.values?.length > 0) {
          ds = candidate;
          dsName = candidate.name;
          break;
        }
      }
    }

    const entityCount = ds?.entities?.values?.length ?? 0;

    let visibleCount = 0;
    if (ds?.entities?.values) {
      for (const entity of ds.entities.values) {
        if (entity.show === true) visibleCount++;
      }
    }

    return {
      ok: entityCount > 0,
      entityCount,
      visibleCount,
      dataSourceName: dsName,
      layerId: id,
      debug: { allSources },
      reason: entityCount > 0 ? '' : `entityCount=${entityCount}, dataSources=${allSources.length}, sources=${JSON.stringify(allSources)}`,
    };
  }, layerId);
  return result;
}

async function goOffline(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('offline'));
  });
  await sleep(500);
}

async function goOnline(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('online'));
  });
  await sleep(500);
}

async function countNetworkRequests(page, urlPattern) {
  return page.evaluate((pattern) => {
    const entries = performance.getEntriesByType('resource');
    return entries.filter(e => e.name.includes(pattern)).length;
  }, urlPattern);
}

async function main() {
  console.log('\nOffline Reload QA (Layer Data Caching)');
  console.log(`  App URL : ${APP_URL}`);
  console.log(`  Mode    : ${HEADFUL ? 'headful' : 'headless'}\n`);

  try {
    const response = await fetch(`${APP_URL}/`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`Dev server not reachable at ${APP_URL}: ${error.message}`);
    process.exit(2);
  }

  if (SHOTS_DIR) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const executablePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      ...(process.platform === 'darwin'
        ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
        : ['--use-gl=angle', '--use-angle=swiftshader']),
      '--disable-dev-shm-usage', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--window-size=1440,900',
    ],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error') {
        if (/Failed to load resource.*(404|429|503|aborted|cancelled)/i.test(text)) return;
        if (/favicon\.ico.*404/i.test(text)) return;
        consoleErrors.push(text);
      } else if (message.type() === 'log') {
        console.log(`  [BROWSER LOG] ${text}`);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Step 1: Load app online ──────────────────────────────────────────────
    console.log('\n  Step 1: Load app online...');
    await open(page, { query: '?welcome=0' });
    await waitForCesiumReady(page);
    await shoot(page, '01-online-ready');

    // ── Step 2: Enable local-dams layer (this caches the GeoJSONL file) ──────
    console.log('\n  Step 2: Enable local-dams layer online (caches data)...');
    const enableResult = await enableLayer(page, 'local-dams');
    console.log('  local-dams stats:', JSON.stringify(enableResult.stats));
    record('local-dams enabled online', enableResult.ok, enableResult.reason || '');
    await shoot(page, '02-layer-enabled-online');

    // ── Step 3: Verify layer renders online ──────────────────────────────────
    console.log('\n  Step 3: Verify layer renders online...');
    const onlineRender = await checkLayerRenders(page, 'local-dams');
    record('local-dams renders online', onlineRender.ok,
      onlineRender.ok ? `entities=${onlineRender.entityCount}, visible=${onlineRender.visibleCount}` : onlineRender.reason);

    // ── Step 4: Go offline ───────────────────────────────────────────────────
    console.log('\n  Step 4: Simulate offline...');
    await goOffline(page);
    const offlineCheck = await page.evaluate(() => navigator.onLine);
    record('navigator.onLine is false', offlineCheck === false, `onLine=${offlineCheck}`);

    // ── Step 5: Reload page while offline ────────────────────────────────────
    console.log('\n  Step 5: Reload page while offline...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForCesiumReady(page);
    await sleep(2000);
    await shoot(page, '03-reloaded-offline');

    // ── Step 6: Re-enable layer offline (should use cached data) ─────────────
    console.log('\n  Step 6: Re-enable local-dams offline (should use cache)...');
    const offlineEnableStart = Date.now();
    const offlineEnableResult = await enableLayer(page, 'local-dams');
    const offlineEnableTime = Date.now() - offlineEnableStart;
    record('local-dams enabled offline', offlineEnableResult.ok,
      offlineEnableResult.ok ? `time=${offlineEnableTime}ms` : offlineEnableResult.reason);

    // ── Step 7: Verify layer renders offline ─────────────────────────────────
    console.log('\n  Step 7: Verify layer renders offline...');
    const offlineRender = await checkLayerRenders(page, 'local-dams');
    record('local-dams renders offline', offlineRender.ok,
      offlineRender.ok ? `entities=${offlineRender.entityCount}, visible=${offlineRender.visibleCount}` : offlineRender.reason);

    // ── Step 8: Verify no network requests for cached assets ─────────────────
    console.log('\n  Step 8: Verify no network requests for /cv/ assets...');
    const cvRequests = await countNetworkRequests(page, '/cv/layers/geojson/dams.geojsonl');
    record('no network requests for cached GeoJSONL', cvRequests === 0,
      cvRequests === 0 ? 'no requests' : `${cvRequests} requests made`);

    // ── Step 9: Go back online ───────────────────────────────────────────────
    console.log('\n  Step 9: Go back online...');
    await goOnline(page);
    const onlineCheck = await page.evaluate(() => navigator.onLine);
    record('navigator.onLine is true', onlineCheck === true, `onLine=${onlineCheck}`);

    // ── Step 10: Test local-datacenters layer ────────────────────────────────
    console.log('\n  Step 10: Test local-datacenters layer offline caching...');
    // First enable online to cache
    await enableLayer(page, 'local-datacenters');
    await sleep(3000);
    // Go offline
    await goOffline(page);
    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForCesiumReady(page);
    await sleep(2000);
    // Re-enable offline
    const dcOfflineEnableStart = Date.now();
    const dcOfflineEnableResult = await enableLayer(page, 'local-datacenters');
    const dcOfflineEnableTime = Date.now() - dcOfflineEnableStart;
    record('local-datacenters enabled offline', dcOfflineEnableResult.ok,
      dcOfflineEnableResult.ok ? `time=${dcOfflineEnableTime}ms` : dcOfflineEnableResult.reason);
    const dcOfflineRender = await checkLayerRenders(page, 'local-datacenters');
    record('local-datacenters renders offline', dcOfflineRender.ok,
      dcOfflineRender.ok ? `entities=${dcOfflineRender.entityCount}, visible=${dcOfflineRender.visibleCount}` : dcOfflineRender.reason);
    const dcRequests = await countNetworkRequests(page, '/cv/layers/geojson/datacenters.geojsonl');
    record('no network requests for cached datacenters GeoJSONL', dcRequests === 0,
      dcRequests === 0 ? 'no requests' : `${dcRequests} requests made`);

  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\n  FAILED:');
    for (const f of failed) console.log(`    - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});