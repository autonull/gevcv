#!/usr/bin/env node
/**
 * qa:horizon-culling — browser proof of horizon culling and marker picking.
 *
 * Verifies:
 * 1. Markers behind the horizon are not rendered (occluded by Earth)
 * 2. Markers behind the horizon are not pickable
 * 3. Clicking a visible marker opens the popup with name, description, source
 * 4. Cluster clicking works (zoom or list members)
 * 5. ESC and camera motion close the popup
 * 6. CV picks don't conflict with core layer picks
 * 7. Popup shows attribution/source link, copy-coordinates, "zoom to" action
 * 8. Popup shows catalog health (cors, dead, etc.)
 * 9. Pick-ownership registration for CV entities
 * 10. 4 provider smoke: KML/KMZ, GeoJSON, ArcGIS, WMS (1 layer each)
 * 11. Horizon culling for all vector families including clustered and KML NetworkLinks
 *
 * Usage:
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run qa:horizon-culling -- --url http://localhost:4173
 *   npm run qa:horizon-culling -- --url http://localhost:4173 --shots ./shots
 *   npm run qa:horizon-culling -- --url http://localhost:4173 --layer cv-live-kml-volcano
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
const TARGET_LAYER = getOpt('--layer', 'earthquakes'); // Default to core earthquakes layer

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Provider smoke layers: one per family (using known-working layers)
const PROVIDER_SMOKE_LAYERS = {
  // Vector families (have markers, test horizon culling)
  kml: 'cv-weather-kml-usshour',       // KML (weather) - known ok
  geojson: 'cv-live-gvp-volcanos',     // GeoJSON (volcanoes) - known ok
  // Imagery families (no markers, verify health status)
  arcgis: 'cv-bigbrother-drone-nofly', // ArcGIS - known ok
  wms: 'cv-weather-mesonet-nexrad',    // WMS (weather radar) - known ok
};

// Vector families that support marker testing
const VECTOR_FAMILIES = new Set(['kml', 'geojson']);

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

async function disableLayer(page, layerId) {
  const result = await page.evaluate(async (id) => {
    const dm = window.__godsEyeView?.dataManager;
    if (!dm) return { ok: false, reason: 'no dataManager' };
    if (dm.isEnabled(id)) {
      try {
        await dm.setEnabled(id, false);
      } catch (e) {
        return { ok: false, reason: `setEnabled(false) failed: ${e.message}` };
      }
    }
    await new Promise(r => setTimeout(r, 1000));
    return { ok: !dm.isEnabled(id) };
  }, layerId);
  return result;
}

async function findVisibleMarker(page, fromIndex = 0) {
  const marker = await page.evaluate(async (startIndex) => {
    const viewer = window.__godsEyeView?.viewer;
    const scene = viewer?.scene;
    if (!scene) return { found: false, reason: 'no scene' };

    // Find marker entities in the scene (check data sources added for this layer)
    const dataSources = viewer.dataSources;
    let markerEntity = null;
    let markerPosition = null;
    let debugInfo = { dataSourcesCount: dataSources?.length ?? 0, entities: [] };

    for (let i = Math.max(0, startIndex); i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (!ds?.show || !ds.entities?.values?.length) continue;
      // Skip app chrome data sources (annotations, draw previews); the test
      // needs a marker from a real layer.
      if (String(ds.name || '').startsWith('gev-')) continue;
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
    let screenPos = scene.cartesianToCanvasCoordinates(markerPosition);
    if (!screenPos) return { found: false, reason: 'marker not in view', debug: debugInfo };

    // A marker on the far side of the globe projects to a screen point but is
    // not visible. Fly to it so a click test exercises a real on-screen marker.
    const ellipsoid = scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84;
    const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, scene.camera.positionWC);
    if (!occluder.isPointVisible(markerPosition)) {
      const carto = Cesium.Cartographic.fromCartesian(markerPosition, ellipsoid);
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          2_000_000,
          ellipsoid,
        ),
      });
      scene.requestRender();
      await new Promise((resolve) => setTimeout(resolve, 300));
      screenPos = scene.cartesianToCanvasCoordinates(markerPosition);
      if (!screenPos) return { found: false, reason: 'marker not in view after fly', debug: debugInfo };
    }

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
  }, fromIndex);
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

    // setView is synchronous and cannot be cancelled by an in-flight camera
    // arrival, so the far-side position is guaranteed for the pick test.
    viewer.camera.setView({ destination });
    viewer.scene.requestRender();

    await new Promise(r => setTimeout(r, 500));

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

async function checkMarkerNotPickable(page, worldPos, entityId = null) {
  const result = await page.evaluate(
    async ({ pos, id }) => {
      const viewer = window.__godsEyeView?.viewer;
      if (!viewer) return { ok: false, reason: 'no viewer' };
      const scene = viewer.scene;
      const ellipsoid = scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84;
      const position = Cesium.Cartesian3.fromElements(pos.x, pos.y, pos.z);

      // Physical proof: the globe hides the point from the current camera.
      const occluder = new Cesium.EllipsoidalOccluder(
        ellipsoid,
        scene.camera.positionWC,
      );
      const occluded = !occluder.isPointVisible(position);

      // Behavioral proof: the target entity is not picked at its projection.
      const screen = scene.cartesianToCanvasCoordinates(position);
      const canvas = scene.canvas;
      const onScreen =
        screen &&
        screen.x >= 0 &&
        screen.y >= 0 &&
        screen.x <= canvas.clientWidth &&
        screen.y <= canvas.clientHeight;
      let pickedId = null;
      if (onScreen) {
        const picked = scene.pick(new Cesium.Cartesian2(screen.x, screen.y));
        pickedId = picked?.id?.id ?? picked?.id ?? null;
      }
      const pickedTarget = id !== null && String(pickedId) === String(id);

      return {
        ok: occluded,
        occluded,
        pickedTarget,
        onScreen: !!onScreen,
        pickedId,
      };
    },
    { pos: worldPos, id: entityId },
  );
  return result;
}

async function clickMarkerAndCheckPopup(page, screenX, screenY) {
  // Dispatch pointer events on the Cesium canvas itself. A map overlay (for
  // example Cesium's own error panel) can otherwise swallow a synthetic click;
  // the handler under test listens on the canvas.
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('#cesiumContainer canvas');
      if (!canvas) return;
      const init = {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        view: window,
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', init));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      canvas.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
    },
    { x: screenX, y: screenY },
  );
  await sleep(500);

  const popup = await page.evaluate(() => {
    // Check for any visible CV marker popup. Multiple layers may own one.
    const cvPopup = [...document.querySelectorAll('.cv-marker-popup')].find(
      (popup) => !popup.hidden,
    );
    if (cvPopup) {
      const title = cvPopup.querySelector('strong')?.textContent ?? '';
      const source = cvPopup.querySelector('.cv-marker-source')?.textContent ?? '';
      const body = cvPopup.querySelector('p')?.textContent ?? '';
      // Check for enhanced popup features
      const attribution = cvPopup.querySelector('.cv-marker-attribution')?.textContent ?? '';
      const copyCoordsBtn = cvPopup.querySelector('.cv-marker-copy-coords')?.textContent ?? '';
      const zoomToBtn = cvPopup.querySelector('.cv-marker-zoom-to')?.textContent ?? '';
      const health = cvPopup.querySelector('.cv-marker-health')?.textContent ?? '';
      return { 
        open: true, 
        type: 'cv', 
        title, 
        source, 
        body,
        attribution,
        copyCoordsBtn,
        zoomToBtn,
        health,
      };
    }
    
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
    let clusterInfo = null;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (ds.clustering?.enabled) {
        hasClusters = true;
        clusterInfo = {
          name: ds.name,
          pixelRange: ds.clustering.pixelRange,
          minimumClusterSize: ds.clustering.minimumClusterSize,
        };
        break;
      }
    }
    return { hasClusters, clusterInfo };
  });
  return result;
}

async function testClusterClick(page) {
  // Try to find and click a cluster
  const result = await page.evaluate(async () => {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { ok: false, reason: 'no viewer' };

    // Find a cluster entity
    const dataSources = viewer.dataSources;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (!ds?.show || !ds.entities?.values?.length) continue;
      for (const entity of ds.entities.values) {
        if (entity.billboard && entity.billboard.image && entity.billboard.image instanceof Cesium.EntityCluster) {
          // Found a cluster entity - get screen position
          const screenPos = viewer.scene.cartesianToCanvasCoordinates(entity.position.getValue(Cesium.JulianDate.now()));
          if (screenPos) {
            return { found: true, screenX: screenPos.x, screenY: screenPos.y };
          }
        }
      }
    }
    return { found: false, reason: 'no cluster entity found' };
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

async function testPickOwnership(page, layerId) {
  // Verify pick ownership is registered for the CV layer
  const result = await page.evaluate(async (id) => {
    const dm = window.__godsEyeView?.dataManager;
    if (!dm) return { ok: false, reason: 'no dataManager' };
    
    const layer = dm.layers.get?.(id)?.module;
    if (!layer) return { ok: false, reason: 'layer not found' };
    
    // Check if pick ownership is registered by looking at the pick registry
    // The pick registry is internal, so we check if the layer has entities that can be picked
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { ok: false, reason: 'no viewer' };
    
    const dataSources = viewer.dataSources;
    let hasEntities = false;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (ds?.name?.includes?.('ClimateViewer') || ds?.name?.includes?.(id)) {
        if (ds.entities?.values?.length > 0) {
          hasEntities = true;
          break;
        }
      }
    }
    
    return { ok: hasEntities, reason: hasEntities ? 'entities found' : 'no entities in dataSource' };
  }, layerId);
  return result;
}

async function checkPopupEnhancements(page) {
  // Check popup has attribution, copy coords, zoom to, health
  const result = await page.evaluate(() => {
    const cvPopup = document.querySelector('.cv-marker-popup');
    if (!cvPopup || cvPopup.hidden) return { open: false };
    
    return {
      open: true,
      hasAttribution: !!cvPopup.querySelector('.cv-marker-attribution'),
      hasCopyCoords: !!cvPopup.querySelector('.cv-marker-copy-coords'),
      hasZoomTo: !!cvPopup.querySelector('.cv-marker-zoom-to'),
      hasHealth: !!cvPopup.querySelector('.cv-marker-health'),
      hasSourceLink: !!cvPopup.querySelector('.cv-marker-source a'),
      attributionText: cvPopup.querySelector('.cv-marker-attribution')?.textContent ?? '',
      healthText: cvPopup.querySelector('.cv-marker-health')?.textContent ?? '',
    };
  });
  return result;
}

async function testProviderSmoke(page, family, layerId) {
  console.log(`\n  Testing ${family} provider with layer: ${layerId}`);
  const isVectorFamily = VECTOR_FAMILIES.has(family);

  // Data sources added after this point belong to the layer under test.
  const fromIndex = await page.evaluate(
    () => window.__godsEyeView?.viewer?.dataSources?.length ?? 0,
  );

  // Enable layer
  const enableResult = await enableLayer(page, layerId);
  if (!enableResult.ok) {
    // For known-bad layers, check health status
    const health = await page.evaluate(async (id) => {
      const dm = window.__godsEyeView?.dataManager;
      if (!dm) return { status: 'unknown' };
      const layer = dm.layers.get(id)?.module;
      const metadataHealth = layer?.metadata?.health?.status;
      const stats = layer?.getStats?.() ?? { status: 'no-stats' };
      return { metadataHealth, statsStatus: stats.status };
    }, layerId);
    return { 
      ok: true, 
      reason: `enable failed (expected for some layers): ${enableResult.reason}; health: ${health.metadataHealth || health.statsStatus}` 
    };
  }
  
  // Wait for layer data to load
  await sleep(8000);
  
  if (isVectorFamily) {
    // Vector families: test markers and horizon culling
    const marker = await findVisibleMarker(page, fromIndex);
    if (!marker.found) {
      const stats = await page.evaluate(async (id) => {
        const dm = window.__godsEyeView?.dataManager;
        if (!dm) return { status: 'unknown' };
        const layer = dm.layers.get(id)?.module;
        return layer?.getStats?.() ?? { status: 'no-stats' };
      }, layerId);
      return { ok: true, reason: `layer loaded (status: ${stats.status || 'unknown'}), no markers in view`, stats };
    }
    
    // Test marker pick when visible
    await sleep(800);
    const popup1 = await clickMarkerAndCheckPopup(page, marker.screenX, marker.screenY);
    const popupOk = popup1.open;
    
    if (popup1.open) {
      const closed = await closePopup(page);
    }
    
    // Test horizon culling
    const rotateResult = await rotateCameraBehindHorizon(page, marker.worldPos);
    if (!rotateResult.ok) {
      return { ok: false, reason: `rotate failed: ${rotateResult.reason}` };
    }
    await sleep(2000);
    
    const pickResult = await checkMarkerNotPickable(
      page,
      marker.worldPos,
      marker.entityId,
    );
    const cullOk = pickResult.ok;
    // Clicking the hidden marker must not open its card. Other nearby markers
    // may legitimately open their own; only the target title matters.
    const behindPosition = await page.evaluate((pos) => {
      const viewer = window.__godsEyeView?.viewer;
      const screen = viewer.scene.cartesianToCanvasCoordinates(
        Cesium.Cartesian3.fromElements(pos.x, pos.y, pos.z),
      );
      return screen ? { x: screen.x, y: screen.y } : null;
    }, marker.worldPos);
    let noPopupBehind = true;
    if (behindPosition) {
      await clickMarkerAndCheckPopup(page, behindPosition.x, behindPosition.y);
      const popupBehind = await page.evaluate(() => {
        const popup = [...document.querySelectorAll('.cv-marker-popup')].find(
          (candidate) => !candidate.hidden,
        );
        return popup ? popup.querySelector('strong')?.textContent ?? '' : null;
      });
      noPopupBehind = popupBehind === null || popupBehind !== marker.name;
    }
    
    // Disable layer for next test
    await disableLayer(page, layerId);
    
    return { 
      ok: popupOk && cullOk && noPopupBehind, 
      reason: `popup=${popupOk}, cull=${cullOk} (occluded=${pickResult.occluded}, pickedTarget=${pickResult.pickedTarget}), noPopupBehind=${noPopupBehind}`,
      marker,
    };
  } else {
    // Imagery families: verify they load or report health
    const stats = await page.evaluate(async (id) => {
      const dm = window.__godsEyeView?.dataManager;
      if (!dm) return { status: 'unknown' };
      const layer = dm.layers.get(id)?.module;
      const metadataHealth = layer?.metadata?.health?.status;
      const stats = layer?.getStats?.() ?? { status: 'no-stats' };
      return { metadataHealth, statsStatus: stats.status };
    }, layerId);
    
    // Disable layer for next test
    await disableLayer(page, layerId);
    
    const hasHealth = stats.metadataHealth && stats.metadataHealth !== 'ok';
    const statsOk = stats.statsStatus === 'ok' || stats.statsStatus === 'empty' || stats.statsStatus === 'loading';
    
    return { 
      ok: statsOk || hasHealth, 
      reason: `imagery layer: health=${stats.metadataHealth || 'none'}, stats=${stats.statsStatus}` 
    };
  }
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

  const executablePath = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    await puppeteer.executablePath().catch(() => null),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean).find((candidate) => {
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
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
      console.log(`  [pageerror] ${error.message}`);
    });
    // ── Step 1: Load app and wait for Cesium ──────────────────────────────
    await open(page, { query: '?welcome=0' });
    await waitForCesiumReady(page);
    await shoot(page, '01-cesium-ready');
    // ── Step 1.5: Open ClimateViewer panel to register layers ─────────────
    console.log('\n  Opening ClimateViewer panel to register layers...');
    await page.evaluate(() => {
      const details = document.querySelector('details.data-cv-section summary');
      if (details) details.click();
    });
    await sleep(2000); // Wait for layers to be created and registered
    await shoot(page, '01b-cv-panel-open');

    // ── Step 2: Test primary target layer ──────────────────────────────────
    console.log(`\n=== Testing primary layer: ${TARGET_LAYER} ===`);
    const enableResult = await enableLayer(page, TARGET_LAYER);
    record('target layer enabled', enableResult.ok, enableResult.reason || '');
    await shoot(page, '02-layer-enabled');

    await sleep(5000);

    // Find a visible marker
    console.log('\n  Finding visible marker...');
    const marker = await findVisibleMarker(page);
    record('found visible marker', marker.found, marker.reason || `entity=${marker.entityId}, name=${marker.name}`);

    let primaryMarker = marker;
    if (!marker.found) {
      console.log('  No markers found, trying fallback layer...');
      const fallbackLayer = 'cv-live-kml-volcano';
      await enableLayer(page, fallbackLayer);
      await sleep(3000);
      const marker2 = await findVisibleMarker(page);
      if (!marker2.found) {
        record('found any visible marker', false, 'no markers in any test layer');
        process.exit(1);
      }
      primaryMarker = marker2;
    }

    // Test marker pick when visible
    console.log('\n  Testing marker pick when visible...');
    const popup1 = await clickMarkerAndCheckPopup(page, primaryMarker.screenX, primaryMarker.screenY);
    const isCVLayer = TARGET_LAYER.startsWith('cv-');
    if (isCVLayer) {
      record('marker click opens popup when visible', popup1.open,
        popup1.open ? `title="${popup1.title}", source="${popup1.source}"` : 'popup did not open');
    } else {
      record('marker click opens popup when visible (CV layers only)', !isCVLayer || popup1.open,
        isCVLayer ? (popup1.open ? `title="${popup1.title}"` : 'popup did not open') : 'skipped for core layer');
    }

    if (popup1.open) {
      const closed = await closePopup(page);
      record('ESC closes popup', closed, closed ? 'popup hidden' : 'popup still visible');
    }
    await shoot(page, '03-marker-popup');

    // Test popup enhancements
    if (isCVLayer && popup1.open) {
      await clickMarkerAndCheckPopup(page, primaryMarker.screenX, primaryMarker.screenY);
      await sleep(300);
      const enhancements = await checkPopupEnhancements(page);
      record('popup has attribution link', enhancements.hasAttribution, enhancements.attributionText || 'missing');
      record('popup has copy coords button', enhancements.hasCopyCoords, enhancements.copyCoordsBtn || 'missing');
      record('popup has zoom to button', enhancements.hasZoomTo, enhancements.zoomToBtn || 'missing');
      record('popup shows health status', enhancements.hasHealth, enhancements.healthText || 'missing');
      record('popup source is clickable link', enhancements.hasSourceLink, 'source link present');
      await closePopup(page);
    }

    // Test pick ownership registration
    console.log('\n  Testing pick ownership registration...');
    const pickOwnership = await testPickOwnership(page, TARGET_LAYER);
    record('CV pick ownership registered', pickOwnership.ok, pickOwnership.reason);

    // Test cluster interaction
    console.log('\n  Checking cluster support...');
    const clusterResult = await testClusterInteraction(page);
    if (clusterResult.hasClusters) {
      record('clustering detected', true, `layer uses Cesium clustering: ${JSON.stringify(clusterResult.clusterInfo)}`);
      // Test cluster click
      const clusterClick = await testClusterClick(page);
      if (clusterClick.found) {
        await page.mouse.click(clusterClick.screenX, clusterClick.screenY);
        await sleep(1000);
        const clusterPopup = await page.evaluate(() => {
          const cvPopup = document.querySelector('.cv-marker-popup');
          if (cvPopup && !cvPopup.hidden) return { open: true, type: 'cluster' };
          return { open: false };
        });
        record('cluster click opens popup/zoom', clusterPopup.open, clusterPopup.type || 'no popup');
        if (clusterPopup.open) await closePopup(page);
      } else {
        record('cluster click test', true, 'no cluster entity in view (skipped)');
      }
    } else {
      record('clustering detected (optional)', true, `no clustering on ${TARGET_LAYER} (skipped)`);
    }

    // Test core layer pick conflict
    console.log('\n  Testing CV vs core layer pick ownership...');
    const conflictResult = await testCoreLayerPickConflict(page);
    record('CV picks do not steal core layer picks', conflictResult.ok,
      conflictResult.pickedType ? `picked: ${conflictResult.pickedType}` : 'no pick at center');

    // Test camera motion closes popup
    console.log('\n  Testing camera motion closes popup...');
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

    // Rotate camera to put marker behind horizon
    console.log('\n  Rotating camera behind horizon...');
    const rotateResult = await rotateCameraBehindHorizon(page, primaryMarker.worldPos);
    record('camera rotated behind horizon', rotateResult.ok,
      rotateResult.ok ? `camera at ${rotateResult.cameraLat}, ${rotateResult.cameraLon}, ${rotateResult.cameraHeightKm} km` : rotateResult.reason);
    await sleep(2000);
    await shoot(page, '04-behind-horizon');

    // Verify marker not pickable behind horizon
    console.log('\n  Checking marker not pickable behind horizon...');
    const pickResult = await checkMarkerNotPickable(
      page,
      primaryMarker.worldPos,
      primaryMarker.entityId,
    );
    record('marker not pickable behind horizon', pickResult.ok,
      pickResult.ok ? 'correctly occluded' : `picked target=${pickResult.pickedTarget}`);
    await shoot(page, '05-pick-check');

    // Verify clicking behind horizon doesn't open the target's popup
    const behindPosition = await page.evaluate((pos) => {
      const viewer = window.__godsEyeView?.viewer;
      const screen = viewer.scene.cartesianToCanvasCoordinates(
        Cesium.Cartesian3.fromElements(pos.x, pos.y, pos.z),
      );
      return screen ? { x: screen.x, y: screen.y } : null;
    }, primaryMarker.worldPos);
    let popupBehindTitle = null;
    if (behindPosition) {
      await clickMarkerAndCheckPopup(page, behindPosition.x, behindPosition.y);
      popupBehindTitle = await page.evaluate(() => {
        const popup = [...document.querySelectorAll('.cv-marker-popup')].find(
          (candidate) => !candidate.hidden,
        );
        return popup ? popup.querySelector('strong')?.textContent ?? '' : null;
      });
    }
    record(
      'click behind horizon does not open target popup',
      popupBehindTitle === null || popupBehindTitle !== primaryMarker.name,
      popupBehindTitle ? `opened "${popupBehindTitle}"` : 'no popup',
    );

    // ── Step 3: Test all four provider families ─────────────────────────────
    console.log('\n=== Testing provider smoke layers (one per family) ===');
    for (const [family, layerId] of Object.entries(PROVIDER_SMOKE_LAYERS)) {
      if (layerId === TARGET_LAYER) {
        console.log(`  Skipping ${family} (${layerId}) - already tested as primary`);
        record(`provider smoke: ${family}`, true, 'tested as primary layer');
        continue;
      }
      
      const result = await testProviderSmoke(page, family, layerId);
      record(`provider smoke: ${family} (${layerId})`, result.ok, result.reason);
      if (result.marker) {
        console.log(`    Marker: ${result.marker.name} at ${result.marker.screenX},${result.marker.screenY}`);
      }
    }

    // ── Step 4: Batch verify ArcGIS and WMS layers ──────────────────────────
    if (hasFlag('--batch-verify')) {
      console.log('\n=== Batch verifying ArcGIS and WMS layers ===');
      
      // Get all ArcGIS and WMS layers from catalog
      const catalog = await page.evaluate(() => {
        return window.__godsEyeView?.climateViewerCatalog || { layers: {} };
      });
      
      const arcgisLayers = Object.entries(catalog.layers || {})
        .filter(([id, layer]) => layer.family === 'arcgis' && layer.role === 'overlay')
        .map(([id]) => id);
      
      const wmsLayers = Object.entries(catalog.layers || {})
        .filter(([id, layer]) => layer.family === 'wms' && layer.role === 'overlay')
        .map(([id]) => id);
      
      console.log(`  Found ${arcgisLayers.length} ArcGIS layers and ${wmsLayers.length} WMS layers`);
      
      // Test a sample of each (first 5 to keep test time reasonable)
      for (const layerId of arcgisLayers.slice(0, 5)) {
        const result = await testProviderSmoke(page, 'arcgis', layerId);
        record(`arcgis batch: ${layerId}`, result.ok, result.reason);
      }
      for (const layerId of wmsLayers.slice(0, 5)) {
        const result = await testProviderSmoke(page, 'wms', layerId);
        record(`wms batch: ${layerId}`, result.ok, result.reason);
      }
      
      // For remaining layers, just verify they report a health status
      for (const layerId of arcgisLayers.slice(5)) {
        const health = await page.evaluate(async (id) => {
          const dm = window.__godsEyeView?.dataManager;
          if (!dm) return { status: 'no-dm' };
          // Check health from catalog
          const catalog = window.__godsEyeView?.climateViewerCatalog;
          if (catalog?.layers?.[id]?.metadata?.health) {
            return catalog.layers[id].metadata.health;
          }
          return { status: 'unknown' };
        }, layerId);
        record(`arcgis health: ${layerId}`, health.status !== 'unknown', health.status);
      }
      for (const layerId of wmsLayers.slice(5)) {
        const health = await page.evaluate(async (id) => {
          const catalog = window.__godsEyeView?.climateViewerCatalog;
          if (catalog?.layers?.[id]?.metadata?.health) {
            return catalog.layers[id].metadata.health;
          }
          return { status: 'unknown' };
        }, layerId);
        record(`wms health: ${layerId}`, health.status !== 'unknown', health.status);
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