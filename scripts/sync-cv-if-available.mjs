#!/usr/bin/env node
/**
 * Refresh the ClimateViewer catalog only when a sibling `cv/` clone exists.
 * The generated catalog is committed; the CV assets are not, so a checkout
 * without the clone still builds and simply lacks local CV layers.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source =
  process.env.CV_LAYERS_FILE ??
  path.resolve(root, '../cv/dist/js/cv-layers-5.5.js');

if (!fs.existsSync(source)) {
  console.warn(
    `[cv] no ClimateViewer clone at ${path.relative(process.cwd(), source)}; ` +
      'skipping catalog sync (local CV layers will not resolve)',
  );
  process.exit(0);
}

execFileSync(process.execPath, [path.join(root, 'scripts/sync-cv-catalog.mjs')], {
  stdio: 'inherit',
});
