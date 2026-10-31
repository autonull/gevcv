#!/usr/bin/env node
/**
 * qa:boot — browser boot smoke test.
 *
 * Loads the app, waits for the Cesium canvas to be ready, and asserts:
 * 1. No console errors (except known resource aborts)
 * 2. Non-blank Cesium canvas (WebGL context created, first frame drawn)
 * 3. Zero auto-enabled ClimateViewer layers (fresh boot is quiet)
 * 4. No circular scope mask, no decorative effects (functional mode default)
 *
 * Usage:
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run qa:boot -- --url http://localhost:4173
 *   npm run qa:boot -- --url http://localhost:4173 --headful
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

async function main() {
  console.log('\nBoot Smoke QA');
  console.log(`  App URL : ${APP_URL}`);
  console.log(`  Mode    : ${HEADFUL ? 'headful' : 'headless'}\n`);

  // Verify server is reachable
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

    // Collect console errors (filter known noise)
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Ignore resource aborts from navigation
      if (/Failed to load resource.*(404|429|503|aborted|cancelled)/i.test(text)) return;
      // Ignore favicon 404
      if (/favicon\.ico.*404/i.test(text)) return;
      consoleErrors.push(text);
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    // Navigate with clean storage, skip first-run welcome
    await open(page, { query: '?welcome=0' });

    // Wait for Cesium canvas to exist and have a WebGL context
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('#cesiumContainer canvas');
        if (!canvas) return false;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return !!gl;
      },
      { timeout: 60000 }
    );

    // Give it a moment to render the first frame
    await sleep(500);

    // Take a screenshot for evidence
    const bootShot = await shoot(page, 'boot-smoke');

    // ── Assertion 1: No console errors ────────────────────────────────────
    const allErrors = [...consoleErrors, ...pageErrors];
    record('no console errors', allErrors.length === 0,
      allErrors.length ? allErrors.slice(0, 3).join(' | ') : 'clean');

    // ── Assertion 2: Non-blank Cesium canvas ──────────────────────────────
    const canvasCheck = await page.evaluate(() => {
      const canvas = document.querySelector('#cesiumContainer canvas');
      if (!canvas) return { ok: false, reason: 'no canvas in #cesiumContainer' };
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { ok: false, reason: 'no WebGL context' };
      // Read a single pixel from the center to verify something was drawn
      const pixels = new Uint8Array(4);
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) return { ok: false, reason: 'canvas has zero size' };
      gl.readPixels(Math.floor(width / 2), Math.floor(height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const nonZero = pixels.some((v) => v !== 0);
      return {
        ok: nonZero,
        reason: nonZero ? 'pixel data present' : 'canvas appears blank (all zeros)',
        width,
        height,
        centerPixel: Array.from(pixels),
      };
    });
    record('cesium canvas non-blank', canvasCheck.ok,
      canvasCheck.ok ? `${canvasCheck.width}x${canvasCheck.height}` : canvasCheck.reason);

    // ── Assertion 3: Zero auto-enabled CV layers ──────────────────────────
    const cvLayerCheck = await page.evaluate(() => {
      const dm = window.__godsEyeView?.dataManager;
      if (!dm) return { ok: false, reason: 'no dataManager' };
      // CV layer IDs start with 'cv-' or are in the catalog
      const allLayers = dm.getAll?.() || [];
      const enabledCV = allLayers
        .filter((l) => dm.isEnabled(l.id) && l.id.startsWith('cv-'))
        .map((l) => l.id);
      return { ok: enabledCV.length === 0, enabledCV };
    });
    record('zero auto-enabled CV layers', cvLayerCheck.ok,
      cvLayerCheck.ok ? 'none' : cvLayerCheck.enabledCV.join(', '));

    // ── Assertion 4: Functional mode default (no circular mask, no decorative effects) ─────
    const visualModeCheck = await page.evaluate(() => {
      const html = document.documentElement;
      const visualMode = html.dataset.visualMode;
      const scopeCanvas = document.getElementById('scope-mask');
      const hasScopeCanvas = !!scopeCanvas;
      const scopeCanvasInDOM = scopeCanvas && document.body.contains(scopeCanvas);
      // Check for decorative CSS classes that should not be present
      const decorativeClasses = [
        'scope-active', 'celestial-ring', 'detection-mode',
        'vignette', 'film-grain', 'scanlines', 'bloom', 'sharpen'
      ];
      const foundDecorative = decorativeClasses.filter((cls) => html.classList.contains(cls));
      return {
        visualMode,
        scopeCanvasInDOM,
        foundDecorative,
        ok: visualMode === 'functional' && !scopeCanvasInDOM && foundDecorative.length === 0,
      };
    });
    record('functional mode default (no decorative effects)', visualModeCheck.ok,
      visualModeCheck.ok
        ? `visualMode="${visualModeCheck.visualMode}", scopeCanvasInDOM=${visualModeCheck.scopeCanvasInDOM}`
        : `visualMode="${visualModeCheck.visualMode}", scopeCanvasInDOM=${visualModeCheck.scopeCanvasInDOM}, decorative: ${visualModeCheck.foundDecorative.join(', ')}`);

    // ── Assertion 5: First-run launcher NOT shown on fresh boot with ?welcome=0 ──
    const launcherCheck = await page.evaluate(() => {
      const launcher = document.getElementById('first-run-launcher');
      return { visible: launcher?.classList.contains('visible') ?? false };
    });
    record('first-run launcher hidden with ?welcome=0', !launcherCheck.visible,
      launcherCheck.visible ? 'launcher unexpectedly visible' : 'launcher hidden');

    // ── Assertion 6: Cesium viewer initialized ────────────────────────────
    const viewerCheck = await page.evaluate(() => {
      const viewer = window.__godsEyeView?.viewer;
      return {
        ok: !!viewer && !viewer.isDestroyed(),
        hasScene: !!viewer?.scene,
        hasGlobe: !!viewer?.scene?.globe,
      };
    });
    record('cesium viewer initialized', viewerCheck.ok,
      viewerCheck.ok ? 'viewer ready' : 'viewer missing or destroyed');

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