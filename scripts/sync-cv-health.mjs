#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyLocalAsset,
  classifyProbe,
  summarizeHealth,
} from '../src/layers/climateviewer/health.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const catalogPath = path.join(root, 'src/layers/climateviewer/catalog.json');
const healthPath = path.join(root, 'src/layers/climateviewer/health.json');
const publicDir = path.join(root, 'public/cv');

export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_CONCURRENCY = 8;

/** Turn a tile template into a URL a HEAD request can answer. */
export function probeUrl(url) {
  return String(url ?? '')
    .replaceAll('{s}', 'a')
    .replaceAll('{z}', '0')
    .replaceAll('{x}', '0')
    .replaceAll('{y}', '0');
}

async function request(url, { method, headers, fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    method,
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    redirected: response.redirected,
  };
}

/**
 * Probe one endpoint. 403 and 405 reject HEAD often enough that a ranged GET
 * is the real answer, so retry those before declaring a layer unhealthy.
 */
export async function probeEndpoint(
  url,
  { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {},
) {
  const target = probeUrl(url);
  let head;
  try {
    head = await request(target, { method: 'HEAD', fetchImpl, timeoutMs });
  } catch (error) {
    return { status: classifyProbe({ error }), error: String(error) };
  }
  if (head.status !== 403 && head.status !== 405) {
    return { status: classifyProbe(head), http: head.status };
  }
  let ranged;
  try {
    ranged = await request(target, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      fetchImpl,
      timeoutMs,
    });
  } catch (error) {
    return { status: 'cors', http: head.status, error: String(error) };
  }
  return { status: classifyProbe(ranged), http: ranged.status };
}

/** Run async work with a fixed concurrency ceiling, preserving input order. */
export async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

export async function buildHealth(catalog, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = PROBE_TIMEOUT_MS,
    concurrency = PROBE_CONCURRENCY,
    publicDir: assetsDir = publicDir,
    limit = Infinity,
    previous = null,
  } = options;
  const assetsPresent = fs.existsSync(assetsDir);
  const layers = Object.values(catalog.layers).slice(0, limit);
  const results = await mapConcurrent(layers, concurrency, async (layer) => {
    if (String(layer.url ?? '').startsWith('/cv/')) {
      const local = assetsPresent
        ? classifyLocalAsset(
            layer.url,
            fs.existsSync(path.join(assetsDir, layer.url.slice(4))),
          )
        : null;
      if (local) return [layer.id, { status: local }];
      // A CI checkout has no CV assets. Keep the last known local status
      // rather than replacing real results with a checkout artefact.
      const preserved = previous?.results?.[layer.id]?.status;
      return [layer.id, { status: preserved ?? 'assets-missing' }];
    }
    if (layer.family === 'bing') return [layer.id, { status: 'key-required' }];
    const url = layer.provider?.url || layer.url;
    if (!url) return [layer.id, { status: 'untested' }];
    const probe = await probeEndpoint(url, { fetchImpl, timeoutMs });
    return [
      layer.id,
      { status: probe.status, ...(probe.http ? { http: probe.http } : {}) },
    ];
  });
  const table = Object.fromEntries(results);
  const summary = summarizeHealth(table);
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    generatedFromSha: catalog.generatedFromSha ?? null,
    catalogHash: catalog.hash ?? null,
    summary,
    results: table,
  };
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const previous = fs.existsSync(healthPath)
    ? JSON.parse(fs.readFileSync(healthPath, 'utf8'))
    : null;
  const limit = Number(process.env.CV_HEALTH_LIMIT) || Infinity;
  return buildHealth(catalog, { limit, previous }).then((health) => {
    fs.writeFileSync(healthPath, `${JSON.stringify(health)}\n`);
    const { summary } = health;
    console.log(
      `✓ ${summary.total} layers → ${path.relative(root, healthPath)}`,
    );
    console.log(
      `  ${Object.entries(summary)
        .filter(([key]) => key !== 'total')
        .map(([key, count]) => `${key} ${count}`)
        .join(' · ')}`,
    );
  });
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`✖ sync-cv-health: ${error.message}`);
    process.exit(1);
  });
}
