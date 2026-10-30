import catalog from './catalog.json' with { type: 'json' };
import { isExplicitLayerStateOrigin } from '../../data/layerState.js';

/** Deterministic catalog order is the identity a `cv` bitset refers to. */
export const CLIMATEVIEWER_LAYER_ORDER = Object.freeze(
  Object.keys(catalog.layers),
);
export const CLIMATEVIEWER_CATALOG_HASH = catalog.hash;
export const CLIMATEVIEWER_STATE_STORAGE_KEY = 'gev:climateviewer-state:v3';

const ORDER_INDEX = new Map(
  CLIMATEVIEWER_LAYER_ORDER.map((id, index) => [id, index]),
);
const ORDER_SET = new Set(CLIMATEVIEWER_LAYER_ORDER);
export const CLIMATEVIEWER_BITSET_BYTES = Math.ceil(
  CLIMATEVIEWER_LAYER_ORDER.length / 8,
);
export const CLIMATEVIEWER_BITSET_CHARS = Math.ceil(
  (CLIMATEVIEWER_BITSET_BYTES * 4) / 3,
);

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_LOOKUP = new Map(
  [...BASE64URL_ALPHABET].map((char, index) => [char, index]),
);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function bytesToBase64Url(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64URL_ALPHABET[(triple >> 18) & 63];
    output += BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (i + 1 < bytes.length) output += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (i + 2 < bytes.length) output += BASE64URL_ALPHABET[triple & 63];
  }
  return output;
}

function base64UrlToBytes(value) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    const sextet = BASE64URL_LOOKUP.get(char);
    if (sextet === undefined) return null;
    buffer = (buffer << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) return null;
  return bytes;
}

/** Encode enabled ids as a little-endian bit per catalog index. */
export function encodeClimateViewerLayerIds(ids) {
  const bytes = new Uint8Array(CLIMATEVIEWER_BITSET_BYTES);
  for (const id of ids ?? []) {
    const index = ORDER_INDEX.get(id);
    if (index === undefined) continue;
    bytes[index >> 3] |= 1 << (index & 7);
  }
  return bytesToBase64Url(bytes);
}

/**
 * Strict decode: exact length, canonical base64url, and zero bits past the
 * catalog's last layer. A payload that fails any rule rejects whole.
 */
export function decodeClimateViewerLayerIds(value) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value))
    return { ok: false, reason: 'base64' };
  if (value.length !== CLIMATEVIEWER_BITSET_CHARS)
    return { ok: false, reason: 'length' };
  const bytes = base64UrlToBytes(value);
  if (!bytes || bytes.length !== CLIMATEVIEWER_BITSET_BYTES)
    return { ok: false, reason: 'base64' };
  const lastUsedBit = CLIMATEVIEWER_LAYER_ORDER.length % 8;
  if (lastUsedBit > 0) {
    const validMask = (1 << lastUsedBit) - 1;
    if ((bytes[bytes.length - 1] & ~validMask) !== 0)
      return { ok: false, reason: 'trailing-bits' };
  }
  const encoded = bytesToBase64Url(bytes);
  if (encoded !== value) return { ok: false, reason: 'canonical' };
  const ids = [];
  for (let index = 0; index < CLIMATEVIEWER_LAYER_ORDER.length; index += 1) {
    if (bytes[index >> 3] & (1 << (index & 7)))
      ids.push(CLIMATEVIEWER_LAYER_ORDER[index]);
  }
  return { ok: true, ids };
}

export function isClimateViewerLayerId(id) {
  return ORDER_SET.has(id);
}

/** Apply the v3 query parameters to a parsed share state. */
export function decodeClimateViewerShareParams(
  params,
  { expectedHash = CLIMATEVIEWER_CATALOG_HASH } = {},
) {
  if (params.getAll('cv').length > 1) return { ok: false, reason: 'duplicate' };
  const hash = params.get('c');
  const cv = params.get('cv');
  if (hash === null && cv === null)
    return { ok: true, status: 'absent', ids: [], notice: null };
  if (hash === null || cv === null) return { ok: false, reason: 'incomplete' };
  if (!/^[a-f0-9]{8}$/.test(hash)) return { ok: false, reason: 'hash' };
  if (params.get('v') !== '3') return { ok: false, reason: 'version' };
  if (hash !== expectedHash) {
    return {
      ok: true,
      status: 'mismatch',
      ids: [],
      notice: 'catalog-mismatch',
    };
  }
  const decoded = decodeClimateViewerLayerIds(cv);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    status: 'applied',
    ids: decoded.ids,
    notice: null,
  };
}

/** Persist the same `v=3,c,cv` schema the URL uses. */
export function encodeClimateViewerStorageState({
  enabledLayerIds = [],
  catalogHash = CLIMATEVIEWER_CATALOG_HASH,
} = {}) {
  return JSON.stringify({
    v: 3,
    c: catalogHash,
    cv: encodeClimateViewerLayerIds(enabledLayerIds),
  });
}

export function decodeClimateViewerStorageState(
  raw,
  { expectedHash = CLIMATEVIEWER_CATALOG_HASH } = {},
) {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 3) return null;
  if (parsed.c !== expectedHash) return null;
  const decoded = decodeClimateViewerLayerIds(parsed.cv);
  return decoded.ok ? decoded.ids : null;
}

export function readClimateViewerStorageState(
  storage = globalThis.localStorage,
  options = {},
) {
  if (!storage?.getItem) return null;
  try {
    return decodeClimateViewerStorageState(
      storage.getItem(CLIMATEVIEWER_STATE_STORAGE_KEY),
      options,
    );
  } catch {
    return null;
  }
}

export function writeClimateViewerStorageState(
  storage = globalThis.localStorage,
  state = {},
) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(
      CLIMATEVIEWER_STATE_STORAGE_KEY,
      encodeClimateViewerStorageState(state),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Owns the CV bitset's live source: share restore once, then explicit user
 * toggles. URL generation and local persistence read the same set.
 */
export class ClimateViewerStateSync {
  constructor(
    dataManager,
    shareLinkManager = null,
    {
      storage = globalThis.localStorage,
      catalogHash = CLIMATEVIEWER_CATALOG_HASH,
      order = CLIMATEVIEWER_LAYER_ORDER,
      starterLayerIds = [],
    } = {},
  ) {
    if (!dataManager?.subscribe || !dataManager?.setEnabled)
      throw new TypeError('ClimateViewer state needs a data manager');
    this.dataManager = dataManager;
    this.shareLinkManager = shareLinkManager;
    this.storage = storage;
    this.catalogHash = catalogHash;
    this.order = order;
    this.orderSet = new Set(order);
    this.starterLayerIds = (starterLayerIds ?? []).filter((id) =>
      this.orderSet.has(id),
    );
    this._source = 'defaults';
    this._destroyed = false;
    this._unsubscribe = null;
    this.restorePromise = Promise.resolve([]);
    this.shareLinkManager?.setClimateViewerStateProvider?.(() =>
      this.getState(),
    );
  }

  getState() {
    return {
      catalogHash: this.catalogHash,
      enabledLayerIds: this._enabledIds(),
    };
  }

  _enabledIds() {
    return this.order.filter((id) => this.dataManager.isEnabled(id));
  }

  start({ shareEnabledLayerIds = null, allowLocalState = true } = {}) {
    if (this._destroyed)
      throw new Error('ClimateViewer state sync is destroyed');
    let selected = null;
    if (Array.isArray(shareEnabledLayerIds)) {
      selected = shareEnabledLayerIds.filter((id) => this.orderSet.has(id));
      this._source = 'share';
    } else if (allowLocalState) {
      selected = readClimateViewerStorageState(this.storage, {
        expectedHash: this.catalogHash,
      });
      if (selected) this._source = 'local';
      else if (this.starterLayerIds.length) {
        selected = this.starterLayerIds;
        this._source = 'starter';
      }
    } else {
      this._source = 'legacy-share';
    }
    this._unsubscribe = this.dataManager.subscribe((change) =>
      this._handleManagerChange(change),
    );
    this.shareLinkManager?.onLayerStateChange?.();
    this.restorePromise = this._apply(new Set(selected ?? []));
    return this.restorePromise;
  }

  applyShareLayerIds(ids) {
    if (this._destroyed) return Promise.resolve([]);
    this._source = 'share';
    return this._apply(
      new Set((ids ?? []).filter((id) => this.orderSet.has(id))),
    );
  }

  async _apply(desired) {
    const origin =
      this._source === 'share' || this._source === 'legacy-share'
        ? 'share-restore'
        : 'local-restore';
    const operations = [];
    for (const id of this.order) {
      const want = desired.has(id);
      if (want === this.dataManager.isEnabled(id)) continue;
      operations.push(
        this.dataManager.setEnabled(id, want, { origin }).catch(() => false),
      );
    }
    const results = await Promise.allSettled(operations);
    if (this._source !== 'share' && this._source !== 'legacy-share')
      this._persist();
    return results;
  }

  _handleManagerChange(change) {
    if (
      this._destroyed ||
      change?.type !== 'visibility' ||
      !this.orderSet.has(change.layerId) ||
      !isExplicitLayerStateOrigin(change.origin)
    )
      return;
    this._source = 'user';
    this._persist();
    this.shareLinkManager?.onLayerStateChange?.();
  }

  _persist() {
    writeClimateViewerStorageState(this.storage, {
      enabledLayerIds: this._enabledIds(),
      catalogHash: this.catalogHash,
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.shareLinkManager?.setClimateViewerStateProvider?.(null);
  }
}
