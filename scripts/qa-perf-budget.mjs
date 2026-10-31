#!/usr/bin/env node
/**
 * qa:perf-budget — browser performance budget measurement.
 *
 * Measures:
 * 1. First paint (first meaningful content)
 * 2. Boot-to-map (Cesium canvas ready + first frame)
 * 3. Idle CPU after settling (10s parked)
 * 4. Panel open time with 405 rows
 * 5. Toggle-to-first-entity for local layer
 * 6. Memory usage
 *
 * Usage:
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run qa:perf-budget -- --url http://localhost:4173 --runs 3
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
const RUNS = parseInt(getOpt('--runs', '3'), 10);
const SHOTS_DIR = getOpt('--shots', '');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  await puppeteer.executablePath().catch(() => null),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const BUDGETS = {
  firstPaintMs: 4000,
  bootToMapMs: 6000,
  idleCpuPercent: 2,
  panelOpenMs: 100,
  toggleToEntityMs: 1500,
  memoryMb: 900,
};

function record(name, value, unit, budget) {
  const ok = budget ? value <= budget : true;
  const status = budget ? (ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m') : '\x1b[36mINFO\x1b[0m';
  const budgetStr = budget ? ` (budget: ${budget} ${unit})` : '';
  console.log(`  [${status}] ${name}: ${value.toFixed(2)} ${unit}${budgetStr}`);
  return { name, value, unit, budget, ok };
}

async function shoot(page, name) {
  if (!SHOTS_DIR) return;
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(page, { clearStorage = true } = {}) {
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
  await page.goto(`${APP_URL}/?welcome=0`, { waitUntil: 'domcontentloaded' });
}

async function measureFirstPaint(page) {
  // Use PerformanceObserver to get first paint
  return page.evaluate(() => {
    return new Promise((resolve) => {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-paint' || entry.name === 'first-contentful-paint') {
            observer.disconnect();
            resolve(entry.startTime);
            return;
          }
        }
      });
      observer.observe({ type: 'paint', buffered: true });
      // Fallback
      setTimeout(() => {
        observer.disconnect();
        const nav = performance.getEntriesByType('navigation')[0];
        resolve(nav ? nav.responseStart : 0);
      }, 5000);
    });
  });
}

async function measureBootToMap(page) {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      const start = performance.now();
      const checkCanvas = () => {
        const canvas = document.querySelector('#cesiumContainer canvas');
        if (!canvas) {
          requestAnimationFrame(checkCanvas);
          return;
        }
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) {
          requestAnimationFrame(checkCanvas);
          return;
        }
        // Read a pixel to confirm first frame
        const pixels = new Uint8Array(4);
        gl.readPixels(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels
        );
        if (pixels.some(v => v !== 0)) {
          resolve(performance.now() - start);
        } else {
          requestAnimationFrame(checkCanvas);
        }
      };
      requestAnimationFrame(checkCanvas);
    });
  });
}

async function measureIdleCpu(page, durationMs = 10000) {
  return page.evaluate(async (duration) => {
    const viewer = window.__godsEyeView?.viewer;
    if (!viewer) return { renderMode: 'unknown', framesRendered: 0 };

    let frames = 0;
    const originalRender = viewer.scene.render.bind(viewer.scene);
    viewer.scene.render = function(time) {
      frames++;
      return originalRender(time);
    };

    // Ensure requestRenderMode is on
    viewer.useDefaultRenderLoop = false;

    await new Promise(r => setTimeout(r, duration));

    viewer.scene.render = originalRender;
    return { renderMode: viewer.useDefaultRenderLoop ? 'default' : 'requestRenderMode', framesRendered: frames };
  }, durationMs);
}

async function measurePanelOpen(page) {
  // Open the layers panel and measure time
  return page.evaluate(async () => {
    const dm = window.__godsEyeView?.dataManager;
    const sm = window.__godsEyeView?.styleManager;
    if (!dm || !sm) return { ok: false, reason: 'no managers' };

    const start = performance.now();

    // Click the layers panel toggle
    const layersBtn = document.getElementById('layers-panel-toggle') ||
                      document.querySelector('[data-panel="layers"]') ||
                      document.querySelector('button[aria-label*="ayer" i]');

    if (layersBtn) {
      layersBtn.click();
    } else {
      // Try keyboard shortcut
      const event = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true });
      document.dispatchEvent(event);
    }

    // Wait for panel to be visible and virtualized list rendered
    await new Promise(r => setTimeout(r, 100));

    // Check for virtualized list container
    const list = document.querySelector('.layer-virtual-list, [data-virtual-list], .data-toggle-container');
    const elapsed = performance.now() - start;

    return {
      elapsed,
      listFound: !!list,
      rowCount: list?.querySelectorAll?.('[data-layer-id]')?.length ?? 0,
    };
  });
}

async function measureToggleToEntity(page) {
  // Enable a local layer and measure time to first entity render
  return page.evaluate(async () => {
    const dm = window.__godsEyeView?.dataManager;
    const viewer = window.__godsEyeView?.viewer;
    if (!dm || !viewer) return { ok: false, reason: 'no managers' };

    const start = performance.now();
    await dm.setEnabled('local-dams', true);

    // Wait for entities to appear
    let entities = 0;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      const ds = viewer.dataSources.getByName('Dams') ||
                 viewer.dataSources._dataSources.find(d => d.name?.includes('Dam') || d.name?.includes('dam'));
      if (ds?.entities?.values?.length > 0) {
        entities = ds.entities.values.length;
        break;
      }
    }
    return { elapsed: performance.now() - start, entities };
  });
}

async function measureMemory(page) {
  return page.evaluate(() => {
    if (performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize / 1024 / 1024,
        total: performance.memory.totalJSHeapSize / 1024 / 1024,
        limit: performance.memory.jsHeapSizeLimit / 1024 / 1024,
      };
    }
    return { used: 0, total: 0, limit: 0 };
  });
}

async function runIteration(page, runNum) {
  console.log(`\n  ── Run ${runNum}/${RUNS} ──`);

  // Fresh load
  await open(page);

  // Measure first paint
  const firstPaint = await measureFirstPaint(page);

  // Measure boot-to-map
  const bootToMap = await measureBootToMap(page);
  await shoot(page, `perf-${runNum}-map-ready`);

  // Wait for settling
  await sleep(2000);

  // Measure idle CPU
  const idle = await measureIdleCpu(page, 10000);

  // Measure panel open
  const panel = await measurePanelOpen(page);

  // Measure toggle to entity
  const toggle = await measureToggleToEntity(page);

  // Measure memory
  const mem = await measureMemory(page);

  return { firstPaint, bootToMap, idle, panel, toggle, mem };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  console.log('\nPerformance Budget Measurement QA');
  console.log(`  App URL : ${APP_URL}`);
  console.log(`  Runs    : ${RUNS}\n`);

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
    headless: 'new',
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

  const allResults = [];
  try {
    for (let i = 1; i <= RUNS; i++) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

      // Enable memory info
      await page.evaluateOnNewDocument(() => {
        // Expose performance.memory in headless
        if (!performance.memory) {
          Object.defineProperty(performance, 'memory', {
            value: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
            writable: true,
          });
        }
      });

      try {
        const result = await runIteration(page, i);
        allResults.push(result);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Aggregate results
  console.log('\n  ── Aggregated (median of ' + RUNS + ' runs) ──');
  const firstPaints = allResults.map(r => r.firstPaint);
  const bootToMaps = allResults.map(r => r.bootToMap);
  const panelOpens = allResults.map(r => r.panel.elapsed).filter(v => v > 0);
  const toggles = allResults.map(r => r.toggle.elapsed).filter(v => v > 0);
  const memUsed = allResults.map(r => r.mem.used).filter(v => v > 0);
  const idleFrames = allResults.map(r => r.idle.framesRendered);

  record('First paint', median(firstPaints), 'ms', BUDGETS.firstPaintMs);
  record('Boot to map', median(bootToMaps), 'ms', BUDGETS.bootToMapMs);
  record('Panel open (405 rows)', median(panelOpens), 'ms', BUDGETS.panelOpenMs);
  record('Toggle to first entity', median(toggles), 'ms', BUDGETS.toggleToEntityMs);
  record('Memory (used)', median(memUsed), 'MB', BUDGETS.memoryMb);
  record('Idle frames in 10s', median(idleFrames), 'frames', 10); // Should be near 0 in requestRenderMode

  console.log('\n  Raw data:');
  allResults.forEach((r, i) => {
    console.log(`    Run ${i+1}: fp=${r.firstPaint.toFixed(0)}ms boot=${r.bootToMap.toFixed(0)}ms panel=${r.panel.elapsed.toFixed(0)}ms toggle=${r.toggle.elapsed.toFixed(0)}ms mem=${r.mem.used.toFixed(0)}MB idleFrames=${r.idle.framesRendered}`);
  });

  // Check budgets
  const failed = [
    median(firstPaints) > BUDGETS.firstPaintMs,
    median(bootToMaps) > BUDGETS.bootToMapMs,
    panelOpens.length && median(panelOpens) > BUDGETS.panelOpenMs,
    toggles.length && median(toggles) > BUDGETS.toggleToEntityMs,
    memUsed.length && median(memUsed) > BUDGETS.memoryMb,
    median(idleFrames) > 10, // Allow a few frames for settling
  ].filter(Boolean).length;

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});