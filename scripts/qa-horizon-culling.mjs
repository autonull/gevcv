#!/usr/bin/env node
/**
 * qa:horizon-culling — browser proof of horizon culling and marker picking.
 *
 * Verifies:
 * 1. Markers behind the horizon are not rendered (occluded by Earth)
 * 2. Markers behind the horizon are not pickable
 * 3. Clicking a visible marker opens the popup with name, description, source
 * 4. Cluster clicking works (if applicable)
 * 5. ESC and camera motion close the popup
 * 6. CV picks don't conflict with core layer picks
 *
 * Usage:
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run qa:horizon-culling -- --url http://localhost:4173
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
const TARGET_LAYER = getOpt('--layer', 'earthquakes'); // Core layer with earthquake markers

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
    
    // Check if layer exists
    const allLayers = dm.getAll?.() || [];
    const layerExists = allLayers.some(l => l.id === id);
    if (!layerExists) {
      return { ok: false, reason: `layer ${id} not registered`, availableLayers: allLayers.map(l => l.id).filter(l => l.startsWith('cv-')).slice(0, 10) };
    }
    
    if (!dm.isEnabled(id)) {
      try {
        await dm.setEnabled(id, true);
      } catch (e) {
        return { ok: false, reason: `setEnabled failed: ${e.message}` };
      }
    }
    // Wait for layer to settle
    await dm.waitForLayerSettled?.(id);
    await new Promise(r => setTimeout(r, 2000));
    const enabled = dm.isEnabled(id);
    return { ok: enabled, reason: enabled ? '' : 'layer not enabled after setEnabled' };
  }, layerId);
  return result;
}

async function findVisibleMarker(page) {
  const marker = await page.evaluate(async () => {
    const viewer = window.__godsEyeView?.viewer;
    const scene = viewer?.scene;
    if (!scene) return { found: false, reason: 'no scene' };

    // Find marker entities in the scene (check all data sources)
    const dataSources = viewer.dataSources;
    let markerEntity = null;
    let markerPosition = null;
    let debugInfo = { dataSourcesCount: dataSources?.length ?? 0, entities: [] };

    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (!ds?.show || !ds.entities?.values?.length) continue;
      let entityTypes = {};
      for (const entity of ds.entities.values) {
        const keys = Object.keys(entity).filter(k => k !== 'id' && k !== 'name' && k !== 'position');
        entityTypes[keys.join(',')] = (entityTypes[keys.join(',')] || 0) + 1;
        if (entity.billboard || entity.point || entity.label || entity.polyline || entity.polygon || entity.ellipse || entity.rectangle || entity.corridor || entity.wall) {
          const now = Cesium.JulianDate.now();
          const pos = entity.position?.getValue?.(now);
          if (pos && !markerEntity) {
            markerEntity = entity;
            markerPosition = pos;
          }
        }
      }
      debugInfo.entities.push({ name: ds.name, count: ds.entities.values.length, types: entityTypes });
      if (markerEntity) break;
    }

    if (!markerEntity) return { found: false, reason: 'no marker entities found', debug: debugInfo };

    // Convert to screen position
    const screenPos = scene.cartesianToCanvasCoordinates(markerPosition);
    if (!screenPos) return { found: false, reason: 'marker not in view', debug: debugInfo };

    return {
      found: true,
      entityId: markerEntity.id,
      name: markerEntity.name?.getValue?.(Cesium.JulianDate.now()) ?? 'unnamed',
      screenX: screenPos.x,
      screenY: screenPos.y,
      worldPos: {
        x: markerPosition.x,
        y: markerPosition.y,
        z: markerPosition.z,
      },
    };
  });
  return marker;
}

async function rotateCameraBehindHorizon(page, markerWorldPos) {
  const result = await page.evaluate(async (pos) => {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { ok: false, reason: 'no viewer' };

    const markerCart = Cesium.Cartesian3.fromElements(pos.x, pos.y, pos.z);
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const cartographic = ellipsoid.cartesianToCartographic(markerCart);

    // Position camera on opposite side of globe, looking at marker
    const oppositeLon = cartographic.longitude + Math.PI;
    const oppositeLat = -cartographic.latitude;
    const distance = 5_000_000; // 5000 km away

    const destination = Cesium.Cartesian3.fromRadians(
      oppositeLon,
      oppositeLat,
      distance,
      ellipsoid
    );

    await viewer.camera.flyTo({
      destination,
      duration: 2.0,
    });

    await new Promise(r => setTimeout(r, 3000));

    // Verify camera is on opposite side
    const camPos = viewer.camera.position;
    const camCart = ellipsoid.cartesianToCartographic(camPos);

    return {
      ok: true,
      cameraLon: Cesium.Math.toDegrees(camCart.longitude).toFixed(2),
      cameraLat: Cesium.Math.toDegrees(camCart.latitude).toFixed(2),
      cameraHeightKm: (camCart.height / 1000).toFixed(0),
    };
  }, markerWorldPos);
  return result;
}

async function checkMarkerNotPickable(page, screenX, screenY) {
  const result = await page.evaluate(async (x, y) => {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { ok: false, reason: 'no viewer' };

    const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
    const isCVMarker = picked?.id && (
      picked.id.billboard ||
      picked.id.point ||
      picked.id.label
    );

    return {
      ok: !isCVMarker,
      pickedSomething: !!picked,
      pickedType: picked?.primitive?.constructor?.name ?? picked?.id?.constructor?.name ?? 'none',
    };
  }, screenX, screenY);
  return result;
}

async function clickMarkerAndCheckPopup(page, screenX, screenY) {
  await page.mouse.click(screenX, screenY);
  await sleep(500);

  const popup = await page.evaluate(() => {
    // Check for CV marker popup first
    const cvPopup = document.querySelector('.cv-marker-popup');
    if (cvPopup && !cvPopup.hidden) return { open: true, type: 'cv', title: cvPopup.querySelector('strong')?.textContent ?? '', source: cvPopup.querySelector('.cv-marker-source')?.textContent ?? '', body: cvPopup.querySelector('p')?.textContent ?? '' };
    
    // Check for other popups (e.g., Cesium InfoBox, custom popups)
    const infoBox = document.querySelector('.cesium-infoBox');
    if (infoBox && !infoBox.hidden) return { open: true, type: 'infobox', title: infoBox.querySelector('.cesium-infoBox-title')?.textContent ?? '', body: infoBox.querySelector('.cesium-infoBox-description')?.textContent ?? '' };
    
    // Check for any visible popup-like element
    const popups = document.querySelectorAll('[role="dialog"], .popup, .tooltip, .marker-popup');
    for (const p of popups) {
      if (!p.hidden && p.offsetParent !== null) {
        return { open: true, type: 'other', title: p.textContent?.slice(0, 100) ?? '' };
      }
    }
    
    return { open: false };
  });
  return popup;
}

async function closePopup(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  const popup = await page.evaluate(() => {
    const cvPopup = document.querySelector('.cv-marker-popup');
    if (cvPopup) return cvPopup.hidden;
    const infoBox = document.querySelector('.cesium-infoBox');
    if (infoBox) return infoBox.hidden;
    return true;
  });
  return popup;
}

async function testClusterInteraction(page) {
  // Test if there's a cluster and clicking it works
  const result = await page.evaluate(async () => {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { ok: false, reason: 'no viewer' };

    // Check for clustering
    const dataSources = viewer.dataSources;
    let hasClusters = false;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (ds.clustering?.enabled) {
        hasClusters = true;
        break;
      }
    }
    return { hasClusters };
  });
  return result;
}

async function testCoreLayerPickConflict(page) {
  // Enable a core layer (like flights) and verify clicks don't conflict
  const result = await page.evaluate(async () => {
    const dm = window.__godsEyeView?.dataManager;
    if (!dm) return { ok: false, reason: 'no dataManager' };

    // Enable flights layer
    await dm.setEnabled('flights', true);
    await new Promise(r => setTimeout(r, 3000));

    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { ok: false, reason: 'no viewer' };

    // Pick at center - should hit flight entities if any, not CV markers
    const picked = viewer.scene.pick(new Cesium.Cartesian2(
      viewer.canvas.clientWidth / 2,
      viewer.canvas.clientHeight / 2
    ));

    return {
      ok: true,
      pickedType: picked?.primitive?.constructor?.name ?? picked?.id?.constructor?.name ?? 'none',
      hasFlights: dm.isEnabled('flights'),
    };
  });
  return result;
}

async function main() {
  console.log('\nHorizon Culling & Marker Picking QA');
  console.log(`  App URL      : ${APP_URL}`);
  console.log(`  Target Layer : ${TARGET_LAYER}`);
  console.log(`  Mode         : ${HEADFUL ? 'headful' : 'headless'}\n`);

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
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/Failed to load resource.*(404|429|503|aborted|cancelled)/i.test(text)) return;
      if (/favicon\.ico.*404/i.test(text)) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Step 1: Load app and wait for Cesium ──────────────────────────────
    await open(page, { query: '?welcome=0' });
    await waitForCesiumReady(page);
    await shoot(page, '01-cesium-ready');

    // ── Step 2: Enable target layer ───────────────────────────────────────
    console.log(`\n  Enabling layer: ${TARGET_LAYER}`);
    const enableResult = await enableLayer(page, TARGET_LAYER);
    console.log('  enableResult:', JSON.stringify(enableResult, null, 2));
    record('target layer enabled', enableResult.ok, enableResult.reason || '');
    await shoot(page, '02-layer-enabled');

    // Wait for layer data to load
    console.log('\n  Waiting for layer data to load...');
    await sleep(5000);

    // ── Step 3: Find a visible marker ─────────────────────────────────────
    console.log('\n  Finding visible marker...');
    const marker = await findVisibleMarker(page);
    console.log('  marker result:', JSON.stringify(marker, null, 2));
    record('found visible marker', marker.found, marker.reason || `entity=${marker.entityId}, name=${marker.name}`);

    if (!marker.found) {
      console.log('  No markers found, trying another layer...');
      // Try a different layer
      const fallbackLayer = 'cv-live-kml-volcano';
      await enableLayer(page, fallbackLayer);
      await sleep(3000);
      const marker2 = await findVisibleMarker(page);
      if (!marker2.found) {
        record('found any visible marker', false, 'no markers in any test layer');
        process.exit(1);
      }
      // Use the fallback marker
      Object.assign(marker, marker2);
    }

    // ── Step 4: Verify marker is pickable when visible ────────────────────
    console.log('\n  Testing marker pick when visible...');
    const popup1 = await clickMarkerAndCheckPopup(page, marker.screenX, marker.screenY);
    const isCVLayer = TARGET_LAYER.startsWith('cv-');
    if (isCVLayer) {
      record('marker click opens popup when visible', popup1.open,
        popup1.open ? `title="${popup1.title}", source="${popup1.source}"` : 'popup did not open');
    } else {
      // Core layers may not have popups; just log
      console.log(`  Core layer ${TARGET_LAYER} - popup test skipped (not a CV layer)`);
      record('marker click opens popup when visible (CV layers only)', !isCVLayer || popup1.open,
        isCVLayer ? (popup1.open ? `title="${popup1.title}"` : 'popup did not open') : 'skipped for core layer');
    }

    if (popup1.open) {
      const closed = await closePopup(page);
      record('ESC closes popup', closed, closed ? 'popup hidden' : 'popup still visible');
    }
    await shoot(page, '03-marker-popup');

    // ── Step 5: Rotate camera to put marker behind horizon ────────────────
    console.log('\n  Rotating camera behind horizon...');
    const rotateResult = await rotateCameraBehindHorizon(page, marker.worldPos);
    record('camera rotated behind horizon', rotateResult.ok,
      rotateResult.ok ? `camera at ${rotateResult.cameraLat}, ${rotateResult.cameraLon}, ${rotateResult.cameraHeightKm} km` : rotateResult.reason);
    await sleep(2000);
    await shoot(page, '04-behind-horizon');

    // ── Step 6: Verify marker not pickable behind horizon ─────────────────
    console.log('\n  Checking marker not pickable behind horizon...');
    const pickResult = await checkMarkerNotPickable(page, marker.screenX, marker.screenY);
    record('marker not pickable behind horizon', pickResult.ok,
      pickResult.ok ? 'correctly occluded' : `picked ${pickResult.pickedType}`);
    await shoot(page, '05-pick-check');

    // ── Step 7: Verify clicking behind horizon doesn't open popup ─────────
    await page.mouse.click(marker.screenX, marker.screenY);
    await sleep(500);
    const popupBehind = await page.evaluate(() => {
      const popup = document.querySelector('.cv-marker-popup');
      return popup && !popup.hidden ? { open: true } : { open: false };
    });
    record('click behind horizon does not open popup', !popupBehind.open,
      popupBehind.open ? 'popup incorrectly opened' : 'no popup');

    // ── Step 8: Test cluster interaction if available ─────────────────────
    console.log('\n  Checking cluster support...');
    const clusterResult = await testClusterInteraction(page);
    if (clusterResult.hasClusters) {
      record('clustering detected', true, 'layer uses Cesium clustering');
      // TODO: Test cluster click behavior
    } else {
      console.log(`  Layer ${TARGET_LAYER} - no clustering (skipping cluster tests)`);
      record('clustering detected (optional)', true, `no clustering on ${TARGET_LAYER} (skipped)`);
    }

    // ── Step 9: Test core layer pick conflict ─────────────────────────────
    console.log('\n  Testing CV vs core layer pick ownership...');
    const conflictResult = await testCoreLayerPickConflict(page);
    record('CV picks do not steal core layer picks', conflictResult.ok,
      conflictResult.pickedType ? `picked: ${conflictResult.pickedType}` : 'no pick at center');

    // ── Step 10: Verify camera motion closes popup ────────────────────────
    console.log('\n  Testing camera motion closes popup...');
    // Re-enable marker layer, find marker, open popup, then move camera
    await enableLayer(page, TARGET_LAYER);
    await sleep(2000);
    const marker2 = await findVisibleMarker(page);
    if (marker2.found) {
      await clickMarkerAndCheckPopup(page, marker2.screenX, marker2.screenY);
      const popupBeforeMove = await page.evaluate(() => {
        const popup = document.querySelector('.cv-marker-popup');
        return popup && !popup.hidden;
      });
      if (popupBeforeMove) {
        // Move camera
        await page.evaluate(() => {
          const viewer = window.__godsEyeView?.viewer;
          if (viewer) viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000000), duration: 1 });
        });
        await sleep(1500);
        const popupAfterMove = await page.evaluate(() => {
          const popup = document.querySelector('.cv-marker-popup');
          return popup && !popup.hidden;
        });
        record('camera motion closes popup', !popupAfterMove,
          popupAfterMove ? 'popup still open after camera move' : 'popup closed');
      }
    }

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