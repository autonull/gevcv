/**
 * User-supplied ClimateViewer proxy. Off by default; only an absolute HTTP(S)
 * URL survives normalization so a stored value cannot become a scheme-relative
 * or credential-bearing surprise.
 */

export const CLIMATEVIEWER_PROXY_STORAGE_KEY = 'gev.climateviewer.proxyUrl';

export function normalizeProxyUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function readableStorage(storage) {
  try {
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

/** Read the saved proxy, or null when unset or invalid. */
export function readClimateViewerProxyUrl(storage = globalThis.localStorage) {
  try {
    const target = readableStorage(storage);
    return target
      ? normalizeProxyUrl(target.getItem(CLIMATEVIEWER_PROXY_STORAGE_KEY))
      : null;
  } catch {
    return null;
  }
}

/** Persist a proxy URL; an empty or invalid value removes the setting. */
export function writeClimateViewerProxyUrl(
  value,
  storage = globalThis.localStorage,
) {
  const target = readableStorage(storage);
  if (!target) return null;
  const normalized = normalizeProxyUrl(value);
  try {
    if (normalized) target.setItem(CLIMATEVIEWER_PROXY_STORAGE_KEY, normalized);
    else target.removeItem(CLIMATEVIEWER_PROXY_STORAGE_KEY);
  } catch {
    return null;
  }
  return normalized;
}
