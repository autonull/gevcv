#!/usr/bin/env node
/**
 * Measure the marginal cost of constructing all 405 ClimateViewer layer
 * shells. The budget is 50 ms / 5 MB; this script reports both and only gates
 * when asked, because Node's heap is not the browser's boot profile.
 */
import { performance } from 'node:perf_hooks';
import { createClimateViewerLayers } from '../src/layers/climateviewer/index.js';

const SAMPLES = 7;
const TIME_BUDGET_MS = 50;
const MEMORY_BUDGET_BYTES = 5 * 1024 * 1024;

function sample() {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const layers = createClimateViewerLayers();
  const elapsed = performance.now() - started;
  const after = process.memoryUsage().heapUsed;
  return { elapsed, bytes: after - before, count: layers.length };
}

const samples = Array.from({ length: SAMPLES }, sample).sort(
  (a, b) => a.elapsed - b.elapsed,
);
const median = samples[Math.floor(samples.length / 2)];
const memory = samples.map((entry) => entry.bytes).sort((a, b) => a - b)[
  Math.floor(samples.length / 2)
];

console.log(
  `✓ ${median.count} ClimateViewer shells: ${median.elapsed.toFixed(2)} ms, ` +
    `${(memory / 1024).toFixed(1)} KiB median heap delta`,
);
console.log(
  `  budget: ${TIME_BUDGET_MS} ms / ${(MEMORY_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB` +
    ` (gate ${process.argv.includes('--gate') ? 'on' : 'off'})`,
);

if (process.argv.includes('--gate')) {
  if (median.elapsed > TIME_BUDGET_MS || memory > MEMORY_BUDGET_BYTES) {
    console.error('✖ ClimateViewer boot budget exceeded');
    process.exit(1);
  }
}
