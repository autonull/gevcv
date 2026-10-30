import { syncChipGroup } from './chipGroup.js';
import { syncRowList } from './rowList.js';
import { layerFeedState } from '../data/feedState.js';
export { layerFeedState } from '../data/feedState.js';
import { GUIDANCE_STATUSES } from '../loadingFeedback.js';
import { keyGuidanceText, keyRequirementText } from './keyGuidance.js';
import {
  LAYER_NAME_KEYS,
  PANEL_LABEL_KEYS as PANEL_LABELS,
  sourceLabel,
} from './layerNames.js';
export { localizeLayerName } from './layerNames.js';
import { createWeatherPanel } from './weatherPanel.js';
import { CLIMATEVIEWER_PACKS } from '../layers/climateviewer/packs.js';
import catalog from '../layers/climateviewer/catalog.json' with { type: 'json' };
import {
  climateViewerFolderForLayer,
  climateViewerFolderLayerIds,
  climateViewerFolderState,
  createClimateViewerTree,
  defaultCollapsedFolders,
  flattenClimateViewerTree,
} from './climateViewerTree.js';
import {
  climateViewerLayerDeepLink,
  climateViewerMarkdownTable,
} from '../layers/climateviewer/atlasLinks.js';
import { translateFeedError, translateStatusLine } from './statusText.js';
import {
  formatNumber,
  getLocale,
  msg,
  t,
  translateKnown,
} from '../i18n/index.js';

// Feed-state values are machine ids (QA hooks, CSS feed-* classes); only the
// label translates.
const FEED_STATE_LABEL_KEYS = Object.freeze({
  nominal: msg('ON'),
  loading: msg('LOADING'),
  degraded: msg('DEGRADED'),
  stale: msg('STALE'),
  partial: msg('PARTIAL'),
  fallback: msg('FALLBACK'),
  unavailable: msg('UNAVAILABLE'),
});

function lifecycleStateLabel(lifecycleState) {
  return t(lifecycleState === 'enabling' ? msg('ENABLING') : msg('DISABLING'));
}

async function copyText(text, ownerDocument) {
  if (!text) return false;
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection fallback.
  }
  const doc = ownerDocument ?? globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } finally {
    area.remove();
  }
  return copied;
}

// Presentation order is independent of catalog registration and startup order.
const PANEL_GROUPS = [
  {
    label: msg('Movement'),
    ids: [
      'satellites',
      'flights',
      'military',
      'local-adsb',
      'ais-live-vessels',
      'traffic',
      'transit',
      'bikeshare',
    ],
  },
  {
    label: msg('Cameras'),
    ids: ['cctv', 'recent-imagery', 'street-level'],
  },
  {
    label: msg('Infrastructure'),
    ids: [
      'alpr-cameras',
      'military-installations',
      'local-datacenters',
      'telegeography-submarine-cables',
      'local-dams',
    ],
  },
  {
    label: msg('Events'),
    ids: [
      'rocket-launches',
      'earthquakes',
      'local-firms',
      'fire-perimeters',
      'gnss-integrity',
      's2-ghostmaps',
    ],
  },
  {
    label: msg('Weather'),
    ids: [
      'air-quality',
      'wind',
      'weather-radar',
      'weather-satellite',
      'weather-lightning',
      'weather-cyclones',
    ],
  },
  {
    label: msg('Utilities'),
    ids: ['directions', 'radio'],
  },
];
const PANEL_ORDER = PANEL_GROUPS.flatMap(({ label, ids }) =>
  ids.map((id) => ({ id, label })),
);
const PANEL_POSITIONS = new Map(
  PANEL_ORDER.map(({ id }, index) => [id, index]),
);

function englishPanelLabel(layer) {
  return PANEL_LABELS[layer.id] || LAYER_NAME_KEYS[layer.id] || layer.name;
}

// PANEL_LABELS win over layer-name keys; otherwise the module's own name.
function panelLabel(layer) {
  if (PANEL_LABELS[layer.id]) return t(PANEL_LABELS[layer.id]);
  const key = LAYER_NAME_KEYS[layer.id];
  return key ? t(key) : layer.name;
}

/**
 * Guidance for a control a missing provider key is holding back.
 *
 * The key registry already owns what each key is called and which environment
 * variables enable it, so a layer only declares WHICH key it needs
 * (`requiresKeyId`) and reports `stats.keyRequired` while that key is absent.
 * Naming the variable turns an unexplained dead control into a next step.
 *
 * An unnamed or unknown key returns '' rather than guessing: guidance naming
 * the wrong variable sends the operator to the wrong provider.
 *
 * @param {object} [layer] Row from the layer manager's getAll().
 * @returns {string} Guidance text, or '' when no key guidance applies.
 */
export function layerKeyRequirementTooltip(layer = {}) {
  if (layer?.stats?.keyRequired !== true) return '';
  const requiresKeyId = String(layer.requiresKeyId || '').trim();
  // A layer with several sources also names the ones it could use instead.
  return keyGuidanceText(
    requiresKeyId ? keyRequirementText(requiresKeyId) : '',
    layer.stats.keyAlternatives || [],
  );
}

const ROW_TEXT_SEPARATOR = ' · ';

// A short Latin code joined by hyphens: every part after a hyphen is capitals
// or digits (ADS-B, RTL-SDR, GTFS-RT). A compound such as "ALPR-Kameras" is a
// word, not a code, and may break at its hyphen. Longer runs (a URL, a token
// in an error) keep their break opportunities so they cannot overflow the rail.
const HYPHENATED_CODE = /\b[A-Za-z0-9]+(?:-[A-Z0-9]+)+(?![A-Za-z0-9])/g;
const HYPHENATED_CODE_MAX = 16;

/** A span for one run of row text; `keep` stops the browser breaking inside it. */
function rowTextSpan(text, keep) {
  const span = document.createElement('span');
  if (keep) span.className = 'data-keep';
  span.textContent = text;
  return span;
}

/**
 * Set a row's name, count or meta line so that a narrow column wraps it well
 * in every language: a Latin code with hyphens (ADS-B, RTL-SDR, GTFS-RT) never
 * splits at its hyphen, and a " · " separator stays at the end of the line it
 * closes, so no line starts with "·". The element's textContent is still the
 * plain string; text with neither feature is set directly.
 *
 * @param {HTMLElement} element
 * @param {string} text
 */
export function setRowText(element, text) {
  const value = String(text ?? '');
  // Refreshes run every second; leave unchanged text (and its spans) alone.
  if (element.textContent === value) return;
  const codes = [...value.matchAll(HYPHENATED_CODE)].filter(
    (match) => match[0].length <= HYPHENATED_CODE_MAX,
  );
  if (!codes.length && !value.includes(ROW_TEXT_SEPARATOR)) {
    element.textContent = value;
    return;
  }
  const spans = [];
  const pushPlain = (from, to) => {
    if (to <= from) return;
    const pieces = value.slice(from, to).split(ROW_TEXT_SEPARATOR);
    pieces.forEach((piece, index) => {
      // The space before the dot belongs to a no-wrap span, so the only break
      // opportunity around a separator is the space after it.
      if (index > 0) spans.push(rowTextSpan(' ·', true));
      const textPiece = index > 0 ? ` ${piece}` : piece;
      if (textPiece) spans.push(rowTextSpan(textPiece, false));
    });
  };
  let cursor = 0;
  for (const match of codes) {
    pushPlain(cursor, match.index);
    spans.push(rowTextSpan(match[0], true));
    cursor = match.index + match[0].length;
  }
  pushPlain(cursor, value.length);
  element.textContent = '';
  for (const span of spans) element.appendChild(span);
}

/** Layer row presentation over supplied state and actions; no layer imports. */
export class LayerPanel {
  constructor({
    getLayers,
    isEnabled,
    setEnabled,
    setLayerParams,
    getRowControls,
    hasRowControls,
    subscribeRowControls,
    onHiddenRefresh = () => {},
    zoomToLayer = () => false,
    weatherClock,
  }) {
    this.weatherClock = weatherClock;
    this.zoomToLayer = zoomToLayer;
    this.getAll = getLayers;
    this.isEnabled = isEnabled;
    this.setEnabled = setEnabled;
    this.setLayerParams = setLayerParams;
    this._rowControlsFor = getRowControls;
    this.hasRowControls = hasRowControls;
    this.subscribeRowControls = subscribeRowControls;
    this.onHiddenRefresh = onHiddenRefresh;
    this._generation = 0;
    this._removers = [];
    this._destroyed = false;
    this._cancelRowControlsRefresh = null;
    this._recentImageryFactory = null;
    this._recentImageryPanel = null;
  }
  mount(container) {
    if (this._destroyed) return;
    this._releaseBindings();
    this._toggleContainer = container;
    this._weatherPanel?.destroy();
    this._weatherPanel = createWeatherPanel({
      clock: this.weatherClock,
      container:
        container?.ownerDocument?.getElementById?.('weather-panel-body'),
      setLayerParams: this.setLayerParams,
    });
    this._mountRecentImagery();
    this._renderToggles();
  }
  /**
   * Host the Recent Imagery readout in its rail body, like the weather
   * readout. The application supplies the factory once the layer, viewer and
   * box tool exist; a remount rebuilds the readout in place.
   * @param {((container: HTMLElement) => { destroy: () => void } | null) | null} factory
   */
  attachRecentImagery(factory) {
    if (this._destroyed) return;
    this._recentImageryFactory = typeof factory === 'function' ? factory : null;
    this._mountRecentImagery();
  }
  _mountRecentImagery() {
    this._recentImageryPanel?.destroy();
    this._recentImageryPanel = null;
    const container = this._toggleContainer?.ownerDocument?.getElementById?.(
      'recent-imagery-panel-body',
    );
    if (container && this._recentImageryFactory)
      this._recentImageryPanel = this._recentImageryFactory(container) || null;
  }
  _bind(element, type, listener) {
    element.addEventListener(type, listener);
    this._removers.push(() => element.removeEventListener(type, listener));
  }
  _releaseBindings() {
    this._generation++;
    this._cancelRowControlsRefresh?.();
    this._cancelRowControlsRefresh = null;
    for (const remove of this._removers.splice(0)) remove();
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._releaseBindings();
    this._weatherPanel?.destroy();
    this._weatherPanel = null;
    this._recentImageryPanel?.destroy();
    this._recentImageryPanel = null;
    this._recentImageryFactory = null;
    this._toggleContainer = null;
    this._climateViewerSheetBody?.classList?.toggle(
      'climateviewer-sheet-open',
      false,
    );
    this._climateViewerSheetBody = null;
  }
  _renderToggles() {
    if (this._destroyed || !this._toggleContainer) return;
    this._releaseBindings();
    this._toggleContainer.innerHTML = '';

    const generation = this._generation;
    const layers = this.getAll()
      .slice()
      .sort(
        (a, b) =>
          (PANEL_POSITIONS.get(a.id) ?? PANEL_ORDER.length) -
          (PANEL_POSITIONS.get(b.id) ?? PANEL_ORDER.length),
      );
    let previousGroup = '';
    const climateViewerLayers = [];
    for (const layer of layers) {
      if (!layer.showInTogglePanel) continue;
      if (layer.panelGroup === 'ClimateViewer') {
        climateViewerLayers.push(layer);
        continue;
      }
      const group =
        PANEL_ORDER[PANEL_POSITIONS.get(layer.id)]?.label ??
        msg('Other layers');
      if (group && group !== previousGroup) {
        const heading = document.createElement('h3');
        heading.className = 'data-layer-group-heading';
        heading.textContent = t(group);
        this._toggleContainer.appendChild(heading);
      }
      previousGroup = group;
      const row = document.createElement('div');
      row.className = 'data-toggle-row';
      row.dataset.layerId = layer.id;
      // English name for voice tools, which must not receive translated text.
      row.dataset.layerName = englishPanelLabel(layer);

      const topRow = document.createElement('div');
      topRow.className = 'data-toggle-top';

      const left = document.createElement('div');
      left.className = 'data-toggle-left';
      const icon = document.createElement('span');
      icon.className = 'data-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = layer.icon;
      const name = document.createElement('span');
      name.className = 'data-name';
      setRowText(name, panelLabel(layer));
      left.appendChild(icon);
      left.appendChild(name);

      const right = document.createElement('div');
      right.className = 'data-toggle-right';

      const count = document.createElement('span');
      count.className = 'data-count';
      this._syncCount(row, count, layer.stats);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `data-toggle-btn${layer.enabled ? ' active' : ''}`;
      this._syncToggleButton(toggle, layer);
      this._bind(toggle, 'click', async () => {
        // Native `disabled` immediately evicts keyboard focus in Chromium. Keep
        // the lifecycle control focusable while it is busy, and enforce the
        // same single-flight interaction contract through ARIA instead.
        if (
          this._destroyed ||
          this._generation !== generation ||
          toggle.getAttribute('aria-disabled') === 'true'
        )
          return;
        toggle.setAttribute('aria-disabled', 'true');
        toggle.setAttribute('aria-busy', 'true');
        try {
          await this.setEnabled(layer.id, !this.isEnabled(layer.id), {
            origin: 'user',
          });
        } catch (error) {
          console.warn(`[Data] ${layer.id} toggle error:`, error);
        } finally {
          const current = this.getAll().find(({ id }) => id === layer.id);
          if (!this._destroyed && current && this._generation === generation)
            this._syncToggleButton(toggle, current);
        }
      });

      const readout = Boolean(this._rowControlsFor(layer.id)?.readout);
      if (!readout) right.appendChild(count);
      right.appendChild(toggle);
      topRow.appendChild(left);
      topRow.appendChild(right);

      const bottomRow = document.createElement('div');
      bottomRow.className = 'data-toggle-meta';
      setRowText(bottomRow, this._buildMetaText(layer));

      row.appendChild(topRow);
      row.appendChild(bottomRow);

      // Optional per-layer sub-controls (chips + color legend). The click
      // listener is delegated and attached once here, so it survives
      // _refreshTogglePanel — which only rewrites the container's contents.
      if (this.hasRowControls(layer.id)) {
        // A layer whose controls settle asynchronously (a chunked catalog load
        // that can also fail) pushes a re-render through this; nothing else
        // would repaint the row before its next scheduled refresh.
        const unsubscribe = this.subscribeRowControls(layer.id, () =>
          this._scheduleRowControlsRefresh(),
        );
        if (unsubscribe) this._removers.push(unsubscribe);
        if (!readout) {
          const controls = document.createElement('div');
          controls.className = 'data-toggle-controls';
          this._bind(controls, 'click', (event) => {
            const button = event.target?.closest?.('.data-toggle-chip');
            if (!button || button.disabled) return;
            // Re-read the live descriptor rather than trusting the rendered
            // chip, so a stale row can never apply an inverted toggle.
            const chip = this._rowControlsFor(layer.id)?.chips?.find(
              (entry) => entry.id === button.dataset.chipId,
            );
            if (!chip || chip.disabled || !this.isEnabled(layer.id)) return;
            if (typeof chip.onClick === 'function') chip.onClick();
            else if (chip.params)
              this.setLayerParams(layer.id, chip.params, { origin: 'user' });
          });
          row.appendChild(controls);
          // An ordered list below the chips, for a layer whose row carries a
          // sequence (turn-by-turn directions). Its own delegated listener, its
          // own container — the chip row stays a chip row.
          const list = document.createElement('ol');
          list.className = 'data-row-list';
          list.hidden = true;
          this._bind(list, 'click', (event) => {
            const button = event.target?.closest?.('.data-row-list-item');
            if (!button || button.disabled) return;
            const item = this._rowControlsFor(layer.id)?.list?.items?.find(
              (entry) => entry.id === button.dataset.listItemId,
            );
            if (item?.params)
              this.setLayerParams(layer.id, item.params, { origin: 'user' });
          });
          row.appendChild(list);
          this._syncRowControls(controls, layer, list);
        }
      }

      this._toggleContainer.appendChild(row);
    }
    if (climateViewerLayers.length)
      this._renderClimateViewerRows(climateViewerLayers, generation);
    this._refreshWeatherPanel();
  }

  /**
   * ClimateViewer carries hundreds of layers; render them behind one collapsed
   * section. Search runs over catalogue data, and rows stream in chunks so a
   * 405-row result does not block the first paint.
   */
  _renderClimateViewerRows(layers, generation) {
    const details = document.createElement('details');
    details.className = 'data-cv-section';
    details.open = this._climateViewerOpen === true;
    const summary = document.createElement('summary');
    summary.className = 'data-layer-group-heading';
    summary.textContent = t('ClimateViewer ({count})', {
      count: layers.length,
    });
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'data-cv-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'data-cv-toolbar';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.value = this._climateViewerQuery ?? '';
    filter.className = 'data-cv-filter';
    filter.placeholder = msg('Filter ClimateViewer layers');
    filter.setAttribute('aria-label', msg('Filter ClimateViewer layers'));
    const count = document.createElement('span');
    count.className = 'data-cv-count';
    count.setAttribute('aria-live', 'polite');
    const enabledCount = document.createElement('span');
    enabledCount.className = 'data-cv-enabled';
    enabledCount.setAttribute('aria-live', 'polite');
    enabledCount.setAttribute('aria-label', t('Layers enabled'));
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'data-cv-clear';
    clear.textContent = t('Clear');
    const copyAtlas = document.createElement('button');
    copyAtlas.type = 'button';
    copyAtlas.className = 'data-cv-copy-atlas';
    copyAtlas.textContent = msg('MD');
    copyAtlas.setAttribute('aria-label', t('Copy atlas (Markdown)'));
    copyAtlas.title = t('Copy atlas (Markdown)');
    toolbar.append(filter, count, enabledCount, clear, copyAtlas);

    const packBar = document.createElement('div');
    packBar.className = 'data-cv-packs';
    for (const pack of CLIMATEVIEWER_PACKS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'data-cv-pack';
      button.textContent = pack.name;
      button.title = pack.description;
      this._bind(button, 'click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await this._applyClimateViewerPack(pack);
        } finally {
          button.disabled = false;
          if (!this._destroyed && this._generation === generation) renderList();
        }
      });
      packBar.appendChild(button);
    }

    const recents = document.createElement('div');
    recents.className = 'data-cv-recents';
    recents.hidden = true;

    const legend = document.createElement('div');
    legend.className = 'data-cv-legend';
    legend.setAttribute('aria-hidden', 'true');
    for (const badge of ['large', 'time', 'proxy', 'base', 'key', 'health']) {
      const chip = document.createElement('span');
      chip.className = `data-cv-badge data-cv-badge-${badge}`;
      chip.textContent = {
        large: 'L',
        time: 'T',
        proxy: 'P',
        base: 'B',
        key: 'K',
        health: 'H',
      }[badge];
      legend.appendChild(chip);
    }

    const list = document.createElement('div');
    list.className = 'data-cv-list';
    body.append(packBar, toolbar, recents, legend, list);
    details.appendChild(body);
    this._toggleContainer.appendChild(details);

    let renderToken = 0;
    let scheduled = null;
    const cancel = () => {
      renderToken += 1;
      if (scheduled !== null) {
        if (typeof cancelAnimationFrame === 'function')
          cancelAnimationFrame(scheduled);
        else clearTimeout(scheduled);
        scheduled = null;
      }
    };
    const schedule = (callback) => {
      if (typeof requestAnimationFrame === 'function')
        scheduled = requestAnimationFrame(callback);
      else scheduled = setTimeout(callback, 0);
    };
    const matchesFor = (query) => {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return layers;
      return layers.filter((layer) => {
        const haystack = [
          layer.name,
          layer.id,
          layer.metadata?.cvId,
          layer.metadata?.category,
          layer.metadata?.sourceUrl,
          layer.metadata?.description,
          layer.family,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });
    };
    const tree = createClimateViewerTree(catalog.tree ?? [], layers);
    this._climateViewerTree = tree;
    const collapsed =
      this._climateViewerCollapsed ??
      (this._climateViewerCollapsed = defaultCollapsedFolders(tree));
    const folderRows = [];
    const syncFolderStates = () => {
      for (const entry of folderRows) {
        entry.sync(
          climateViewerFolderState(entry.node, (id) => this.isEnabled(id)),
        );
      }
    };
    this._climateViewerFolderSync = syncFolderStates;
    const syncBulkState = () => {
      const enabled = layers.filter((layer) => this.isEnabled(layer.id)).length;
      enabledCount.textContent = `${enabled} ${t('ON')}`;
      clear.hidden = enabled === 0;
    };
    this._climateViewerBulkSync = syncBulkState;
    const buildFolderRow = (entry, depth) => {
      const folderRow = this._createClimateViewerFolderRow(entry.node, {
        depth,
        open: entry.open,
        onToggleOpen: () => {
          if (collapsed.has(entry.path)) collapsed.delete(entry.path);
          else collapsed.add(entry.path);
          renderList();
        },
        onToggleAll: async (enable) => {
          const state = climateViewerFolderState(entry.node, (id) =>
            this.isEnabled(id),
          );
          const operations = state.ids
            .filter((id) => this.isEnabled(id) !== enable)
            .map((id) =>
              this.setEnabled(id, enable, { origin: 'user' }).catch(
                () => false,
              ),
            );
          if (
            operations.length > 50 &&
            !this._confirmClimateViewerBulk(operations.length)
          )
            return;
          await Promise.allSettled(operations);
          renderList();
        },
      });
      folderRows.push({ node: entry.node, sync: folderRow.sync });
      folderRow.sync(
        climateViewerFolderState(entry.node, (id) => this.isEnabled(id)),
      );
      return folderRow.row;
    };
    const renderList = () => {
      cancel();
      const token = renderToken;
      const query = filter.value.trim();
      const searching = query.length > 0;
      const similar = this._climateViewerSimilar;
      const matches =
        similar && query === similar.query
          ? layers.filter((layer) => similar.ids.has(layer.id))
          : matchesFor(query);
      count.textContent = `${matches.length} / ${layers.length}`;
      syncBulkState();
      list.textContent = '';
      folderRows.length = 0;
      if (!matches.length) {
        const note = document.createElement('div');
        note.className = 'data-cv-note';
        note.textContent = layers.length ? t('No layers match') : t('Loading');
        list.appendChild(note);
        return;
      }
      const rows = searching
        ? matches.map((layer) => ({ kind: 'layer', layer }))
        : flattenClimateViewerTree(tree, collapsed);
      let index = 0;
      let previousCategory = '';
      const paint = () => {
        if (token !== renderToken) return;
        const stop = Math.min(index + 48, rows.length);
        for (; index < stop; index += 1) {
          const entry = rows[index];
          if (entry.kind === 'folder') {
            list.appendChild(buildFolderRow(entry, entry.depth));
            continue;
          }
          if (searching) {
            const category = entry.layer.metadata?.category ?? '';
            if (category !== previousCategory) {
              const heading = document.createElement('div');
              heading.className = 'data-cv-category';
              heading.textContent = category;
              list.appendChild(heading);
              previousCategory = category;
            }
          }
          const layerRow = this._createClimateViewerRow(
            entry.layer,
            generation,
          );
          layerRow.style?.setProperty?.('--cv-depth', String(entry.depth ?? 0));
          list.appendChild(layerRow);
        }
        scheduled = null;
        if (index < rows.length) schedule(paint);
      };
      paint();
    };

    let rendered = false;
    const syncSheetState = () => {
      const body = details.ownerDocument?.body;
      if (!body?.classList) return;
      this._climateViewerSheetBody = body;
      body.classList.toggle('climateviewer-sheet-open', details.open);
    };
    const onToggle = () => {
      this._climateViewerOpen = details.open;
      syncSheetState();
      if (!details.open || rendered) return;
      rendered = true;
      renderList();
    };
    const renderRecents = () => {
      recents.textContent = '';
      const recent = this._recentClimateViewerSearches();
      recents.hidden = recent.length === 0;
      for (const query of recent) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'data-cv-recent';
        chip.textContent = query;
        chip.setAttribute('aria-label', query);
        this._bind(chip, 'click', () => {
          filter.value = query;
          this._climateViewerQuery = query;
          this._climateViewerSimilar = null;
          filter.focus?.();
          renderList();
        });
        recents.appendChild(chip);
      }
    };
    this._bind(details, 'toggle', onToggle);
    this._bind(filter, 'input', () => {
      this._climateViewerQuery = filter.value;
      this._climateViewerSimilar = null;
      if (rendered) renderList();
    });
    this._bind(filter, 'keydown', (event) => {
      if (event.key === 'Enter' && filter.value.trim()) {
        event.preventDefault();
        this._rememberClimateViewerSearch(filter.value);
        this._climateViewerQuery = filter.value;
        this._climateViewerSimilar = null;
        renderRecents();
        const row = list.querySelector('.data-cv-row');
        const info = row?.querySelector?.('.data-cv-info');
        if (info) info.click();
        else row?.scrollIntoView?.({ block: 'center' });
        return;
      }
      if (event.key !== 'ArrowDown') return;
      const first = list.querySelector('.data-toggle-btn');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    });
    this._bind(clear, 'click', async () => {
      if (this._clearingClimateViewer) return;
      this._clearingClimateViewer = true;
      clear.disabled = true;
      try {
        const enabled = layers.filter((layer) =>
          this.isEnabled(layer.id),
        ).length;
        if (enabled > 50 && !this._confirmClimateViewerBulk(enabled)) return;
        for (const layer of layers) {
          if (this.isEnabled(layer.id))
            await this.setEnabled(layer.id, false, { origin: 'user' });
        }
      } finally {
        this._clearingClimateViewer = false;
        clear.disabled = false;
        if (!this._destroyed && this._generation === generation) renderList();
      }
    });
    this._bind(copyAtlas, 'click', async () => {
      const ok = await copyText(
        climateViewerMarkdownTable(layers),
        details.ownerDocument,
      );
      copyAtlas.textContent = ok ? t('Copied') : t('Copy failed');
      setTimeout(() => {
        if (copyAtlas.isConnected) copyAtlas.textContent = msg('MD');
      }, 1500);
    });
    renderRecents();
    syncSheetState();
    this._climateViewerControls = { details, filter, list, renderList };
    const ownerDocument = details.ownerDocument;
    if (typeof ownerDocument?.addEventListener === 'function') {
      this._bind(ownerDocument, 'keydown', (event) => {
        if (event.key !== '/' || !details.open || !details.isConnected) return;
        const target = event.target;
        const tag = target?.tagName?.toLowerCase?.() ?? '';
        if (
          ['input', 'textarea', 'select'].includes(tag) ||
          target?.isContentEditable
        )
          return;
        event.preventDefault();
        filter.focus();
        filter.select?.();
      });
    }
    if (details.open) {
      rendered = true;
      renderList();
    }
  }

  /** Apply a named pack by diffing every CV toggle against the pack set. */
  async _applyClimateViewerPack(pack) {
    const target = new Set(pack.layers);
    const operations = [];
    for (const layer of this.getAll()) {
      if (!layer.id?.startsWith?.('cv-')) continue;
      const want = target.has(layer.id);
      if (want === this.isEnabled(layer.id)) continue;
      operations.push(
        this.setEnabled(layer.id, want, { origin: 'user' }).catch(() => false),
      );
    }
    await Promise.allSettled(operations);
  }

  _confirmClimateViewerBulk(count) {
    if (count <= 50) return true;
    if (typeof globalThis.confirm !== 'function') return true;
    return globalThis.confirm(t('Change {count} layers?', { count }));
  }

  _recentClimateViewerSearches() {
    if (Array.isArray(this._cvRecentSearches)) return this._cvRecentSearches;
    let stored = [];
    try {
      const raw = globalThis.window?.localStorage?.getItem(
        'gevcv.climateviewer.recentSearches',
      );
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        stored = parsed.filter(
          (query) => typeof query === 'string' && query.trim(),
        );
      }
    } catch {
      stored = [];
    }
    this._cvRecentSearches = stored.slice(0, 5);
    return this._cvRecentSearches;
  }

  _rememberClimateViewerSearch(query) {
    const value = String(query ?? '').trim();
    if (!value) return;
    const previous = this._recentClimateViewerSearches();
    const next = [
      value,
      ...previous.filter(
        (entry) => entry.toLowerCase() !== value.toLowerCase(),
      ),
    ].slice(0, 5);
    this._cvRecentSearches = next;
    try {
      globalThis.window?.localStorage?.setItem(
        'gevcv.climateviewer.recentSearches',
        JSON.stringify(next),
      );
    } catch {
      /* memory-only when storage is unavailable */
    }
  }

  /** `?layer=<id>`: enable, open the CV section and drawer, and fly there. */
  async openClimateViewerLayer(id) {
    const layer = this.getAll().find((entry) => entry.id === id);
    if (!layer) return false;
    if (!this.isEnabled(id)) {
      try {
        await this.setEnabled(id, true, { origin: 'user' });
      } catch {
        return false;
      }
    }
    this.zoomToLayer(id);
    this._climateViewerOpen = true;
    this._refreshTogglePanel();
    requestAnimationFrame(() => {
      const controls = this._climateViewerControls;
      if (!controls) return;
      this._climateViewerQuery = id;
      this._climateViewerSimilar = null;
      controls.filter.value = id;
      controls.renderList();
      requestAnimationFrame(() => {
        const row = controls.list.querySelector(
          `.data-cv-row[data-layer-id="${id}"]`,
        );
        if (!row) return;
        row.scrollIntoView?.({ block: 'center' });
        const info = row.querySelector('.data-cv-info');
        const drawer = row.querySelector('.data-cv-drawer');
        if (info && drawer?.hidden) info.click();
      });
    });
    return true;
  }

  _createClimateViewerFolderRow(
    node,
    { depth, open, onToggleOpen, onToggleAll },
  ) {
    const row = document.createElement('div');
    row.className = 'data-cv-folder-row';
    row.dataset.cvPath = node.path;
    row.style?.setProperty?.('--cv-depth', String(depth));

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'data-cv-folder';
    header.setAttribute('aria-expanded', String(open));
    const chevron = document.createElement('span');
    chevron.className = 'data-cv-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = open ? '▾' : '▸';
    const name = document.createElement('span');
    name.className = 'data-cv-folder-name';
    name.textContent = node.name;
    const count = document.createElement('span');
    count.className = 'data-cv-folder-count';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'data-cv-folder-toggle';
    const sync = (state) => {
      count.textContent = `${state.enabled}/${state.total}`;
      toggle.classList.toggle('active', state.all);
      toggle.classList.toggle('partial', state.some && !state.all);
      toggle.setAttribute('aria-pressed', state.all ? 'true' : 'false');
      toggle.textContent = t(state.all ? 'ON' : 'OFF');
      toggle.setAttribute(
        'aria-label',
        `${node.name}: ${t(state.all ? 'ON' : 'OFF')}`,
      );
    };
    sync({ enabled: 0, total: node.count, all: false, some: false });
    header.append(chevron, name, count);
    this._bind(header, 'click', onToggleOpen);
    this._bind(toggle, 'click', async () => {
      if (toggle.getAttribute('aria-disabled') === 'true') return;
      toggle.setAttribute('aria-disabled', 'true');
      try {
        await onToggleAll(!toggle.classList.contains('active'));
      } finally {
        toggle.removeAttribute('aria-disabled');
      }
    });
    row.append(header, toggle);
    return { row, sync };
  }

  _createClimateViewerRow(layer, generation) {
    const row = document.createElement('div');
    row.className = 'data-toggle-row data-cv-row';
    row.dataset.layerId = layer.id;
    row.dataset.layerName = layer.name;

    const topRow = document.createElement('div');
    topRow.className = 'data-toggle-top';
    const left = document.createElement('div');
    left.className = 'data-toggle-left';
    const icon = document.createElement('span');
    icon.className = 'data-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = layer.icon;
    const name = document.createElement('span');
    name.className = 'data-name';
    name.textContent = layer.name;
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'data-cv-info';
    info.textContent = 'i';
    info.setAttribute('aria-label', t('Details'));
    info.setAttribute('aria-expanded', 'false');
    left.append(icon, name, info);

    const right = document.createElement('div');
    right.className = 'data-toggle-right';
    for (const badge of this._climateViewerBadges(layer)) {
      const chip = document.createElement('span');
      chip.className = `data-cv-badge data-cv-badge-${badge.kind}`;
      chip.textContent = badge.label;
      chip.setAttribute('aria-label', badge.label);
      right.appendChild(chip);
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'data-toggle-btn';
    this._syncToggleButton(toggle, layer);
    this._bind(toggle, 'click', async () => {
      if (
        this._destroyed ||
        this._generation !== generation ||
        toggle.getAttribute('aria-disabled') === 'true'
      )
        return;
      toggle.setAttribute('aria-disabled', 'true');
      toggle.setAttribute('aria-busy', 'true');
      toggle.classList.add('transitioning');
      let failure = null;
      try {
        await this.setEnabled(layer.id, !this.isEnabled(layer.id), {
          origin: 'user',
        });
      } catch (error) {
        failure = error;
        console.warn(`[Data] ${layer.id} toggle error:`, error);
      } finally {
        const live = this.getAll().find(({ id }) => id === layer.id);
        if (!this._destroyed && this._generation === generation && live) {
          this._syncToggleButton(toggle, live);
        } else {
          toggle.classList.remove('transitioning');
          toggle.setAttribute('aria-busy', 'false');
        }
        toggle.removeAttribute('aria-disabled');
        if (failure && !this._destroyed && this._generation === generation) {
          row.classList.add('data-cv-row-error');
          meta.textContent = t('Error: {message}', {
            message: failure.message || failure,
          });
        }
        this._climateViewerFolderSync?.();
        this._climateViewerBulkSync?.();
      }
    });
    right.appendChild(toggle);
    topRow.appendChild(left);
    topRow.appendChild(right);
    row.appendChild(topRow);

    const meta = document.createElement('div');
    meta.className = 'data-toggle-meta';
    setRowText(meta, this._buildMetaText(layer));
    row.appendChild(meta);

    const drawer = document.createElement('div');
    drawer.className = 'data-cv-drawer';
    drawer.hidden = true;
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      const metadata = layer.metadata ?? {};
      const add = (text, className = '') => {
        const line = document.createElement('div');
        line.className = `data-cv-drawer-line ${className}`.trim();
        line.textContent = text;
        drawer.appendChild(line);
      };
      if (metadata.description) add(metadata.description);
      if (metadata.health) {
        add(
          `${metadata.health.status}${
            metadata.health.http ? ` · HTTP ${metadata.health.http}` : ''
          }`,
          'data-cv-drawer-health',
        );
      }
      if (metadata.sourceUrl) {
        try {
          const link = document.createElement('a');
          link.href = metadata.sourceUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = t('Source');
          drawer.appendChild(link);
        } catch {
          add(metadata.sourceUrl);
        }
      }
      if (metadata.providerUrl) add(metadata.providerUrl, 'data-keep');
      const parts = [`cvId: ${metadata.cvId ?? '—'}`];
      if (metadata.sublayers?.length)
        parts.push(`sublayers: ${metadata.sublayers.join(', ')}`);
      add(parts.join(' · '));
      if (layer.stats?.error) add(layer.stats.error, 'data-cv-drawer-error');
      if (layer.stats?.remedy) add(layer.stats.remedy, 'data-cv-drawer-remedy');

      const actions = document.createElement('div');
      actions.className = 'data-cv-drawer-actions';
      const sourceUrl = metadata.sourceUrl || metadata.providerUrl;
      const copySource = document.createElement('button');
      copySource.type = 'button';
      copySource.className = 'data-cv-copy-source';
      copySource.textContent = t('Copy source');
      if (!sourceUrl) copySource.disabled = true;
      this._bind(copySource, 'click', async () => {
        if (!sourceUrl) return;
        const ok = await copyText(sourceUrl, drawer.ownerDocument);
        copySource.textContent = ok ? t('Copied') : t('Copy failed');
        setTimeout(() => {
          if (copySource.isConnected) copySource.textContent = t('Copy source');
        }, 1500);
      });
      const zoomTo = document.createElement('button');
      zoomTo.type = 'button';
      zoomTo.className = 'data-cv-zoom';
      zoomTo.textContent = t('Zoom to layer');
      this._bind(zoomTo, 'click', () => {
        this.zoomToLayer(layer.id);
      });
      const similar = document.createElement('button');
      similar.type = 'button';
      similar.className = 'data-cv-similar';
      similar.textContent = t('Similar layers');
      this._bind(similar, 'click', () => {
        const controls = this._climateViewerControls;
        const folder = climateViewerFolderForLayer(
          this._climateViewerTree ?? [],
          layer.id,
        );
        const query = folder?.name || this._climateViewerSimilarQuery(layer);
        if (!controls || !query) return;
        this._climateViewerSimilar = folder
          ? {
              query,
              ids: new Set(climateViewerFolderLayerIds(folder)),
            }
          : null;
        this._climateViewerQuery = query;
        controls.filter.value = query;
        controls.renderList();
        controls.filter.focus?.();
      });
      const copyLink = document.createElement('button');
      copyLink.type = 'button';
      copyLink.textContent = t('Copy link');
      this._bind(copyLink, 'click', async () => {
        const ok = await copyText(
          climateViewerLayerDeepLink(layer.id),
          drawer.ownerDocument,
        );
        copyLink.textContent = ok ? t('Copied') : t('Copy failed');
        setTimeout(() => {
          if (copyLink.isConnected) copyLink.textContent = t('Copy link');
        }, 1500);
      });
      const copyMarkdown = document.createElement('button');
      copyMarkdown.type = 'button';
      copyMarkdown.textContent = t('Copy Markdown');
      this._bind(copyMarkdown, 'click', async () => {
        const ok = await copyText(
          climateViewerMarkdownTable([layer]),
          drawer.ownerDocument,
        );
        copyMarkdown.textContent = ok ? t('Copied') : t('Copy failed');
        setTimeout(() => {
          if (copyMarkdown.isConnected)
            copyMarkdown.textContent = t('Copy Markdown');
        }, 1500);
      });
      actions.append(copySource, zoomTo, similar, copyLink, copyMarkdown);
      drawer.appendChild(actions);
    };
    this._bind(info, 'click', () => {
      const open = drawer.hidden;
      drawer.hidden = !open;
      info.setAttribute('aria-expanded', String(open));
      if (open) fill();
    });
    row.appendChild(drawer);
    return row;
  }

  _climateViewerSimilarQuery(layer) {
    const metadata = layer.metadata ?? {};
    const category = Array.isArray(metadata.category)
      ? metadata.category.filter(Boolean).at(-1)
      : '';
    if (category) return category;
    const tags = Array.isArray(metadata.tags)
      ? metadata.tags.find((tag) => typeof tag === 'string' && tag.trim())
      : '';
    return tags || layer.family || '';
  }

  _climateViewerBadges(layer) {
    const badges = [];
    const flags = layer.metadata?.flags ?? {};
    if (flags.large) badges.push({ kind: 'large', label: 'L' });
    if (flags.timeline) badges.push({ kind: 'time', label: 'T' });
    if (flags.proxy) badges.push({ kind: 'proxy', label: 'P' });
    if (layer.metadata?.role === 'basemap')
      badges.push({ kind: 'base', label: 'B' });
    if (layer.keyRequired) badges.push({ kind: 'key', label: 'K' });
    const health = layer.metadata?.health?.status;
    if (health && health !== 'ok')
      badges.push({ kind: `health health-${health}`, label: 'H' });
    return badges;
  }

  _scheduleRowControlsRefresh() {
    if (this._destroyed || this._cancelRowControlsRefresh) return;
    const refresh = () => {
      this._cancelRowControlsRefresh = null;
      if (!this._destroyed) this._refreshTogglePanel();
    };
    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(refresh);
      this._cancelRowControlsRefresh = () => cancelAnimationFrame(frame);
    } else {
      const timer = setTimeout(refresh, 0);
      this._cancelRowControlsRefresh = () => clearTimeout(timer);
    }
  }

  /** Synchronously flush a pending row-controls refresh, including in tests. */
  _flushRowControlsRefresh() {
    if (this._destroyed || !this._cancelRowControlsRefresh) return;
    this._cancelRowControlsRefresh();
    this._cancelRowControlsRefresh = null;
    this._refreshTogglePanel();
  }

  _refreshWeatherPanel() {
    this._weatherPanel?.update(
      this.getAll()
        .filter(
          (layer) =>
            layer.enabled &&
            [
              'wind',
              'weather-radar',
              'weather-satellite',
              'weather-lightning',
              'weather-cyclones',
              'air-quality',
            ].includes(layer.id),
        )
        .map((layer) => ({
          id: layer.id,
          icon: layer.icon,
          ...this._rowControlsFor(layer.id),
        })),
    );
  }

  /**
   * Write a row's count. Outside English a count phrase ("24 nearby · 2 on
   * screen") gets its own line, or it squeezes a longer translated name to a
   * word per line. "—" is marked so a wide status chip can replace it
   * (radio.css).
   */
  _syncCount(row, count, stats) {
    const text = this._layerCountText(stats);
    setRowText(count, text);
    const phrase =
      getLocale() !== 'en' &&
      typeof stats.countLabel === 'string' &&
      /\d/.test(stats.countLabel);
    row.classList.toggle('data-toggle-row--count-line', phrase);
    count.classList.toggle('data-count-empty', text === '—');
  }

  /** Qualify a loaded count when it does not mean items currently on screen. */
  _layerCountText(stats) {
    if (typeof stats.countLabel === 'string' && stats.countLabel.trim())
      return stats.countLabel;
    return stats.count ? this._formatCount(stats.count) : '—';
  }

  /**
   * Render a layer's row chips and color legend, and keep the whole block
   * hidden while the layer is off (or while a dependency owner has surrendered
   * it) so a quiet row stays quiet.
   *
   * Chip BUTTONS are reconciled in place, keyed by chip id, rather than
   * rebuilt: this runs on every panel refresh — including the one the chip's
   * own click triggers — and replacing the node would drop keyboard focus
   * mid-interaction. Legend entries are rebuilt only when their content changes;
   * the info node is retained across refreshes.
   * @param {HTMLElement|null} container The row's `.data-toggle-controls` node.
   * @param {object} layer Registered layer entry.
   * @param {HTMLElement|null} [listContainer] The row's `.data-row-list` node.
   */
  _syncRowControls(container, layer, listContainer = null) {
    if (!container) return;
    const controls = layer.enabled ? this._rowControlsFor(layer.id) : null;
    if (controls?.readout) {
      container.remove();
      listContainer?.remove();
      return;
    }
    const chips = controls?.chips || [];
    const legend = controls?.legend || [];
    const infoText = controls?.info;
    this._syncRowList(listContainer, controls?.list || null);
    container.hidden = chips.length === 0 && legend.length === 0 && !infoText;

    const info = container._rowControlsInfo || null;
    const firstLegend = container.querySelector('.data-toggle-legend-item');

    syncChipGroup(container, chips, { before: firstLegend || info });

    const legendSignature = JSON.stringify(
      legend.map(({ label, color, count, blurb }) => [
        label,
        color,
        count,
        blurb,
      ]),
    );
    if (container._legendSignature !== legendSignature) {
      for (const node of [...container.children]) {
        if (node.className === 'data-toggle-legend-item') node.remove();
      }
      for (const item of legend) {
        const entry = document.createElement('span');
        entry.className = 'data-toggle-legend-item';
        if (item.blurb) entry.title = item.blurb;
        const swatch = document.createElement('span');
        swatch.className = 'data-toggle-legend-swatch';
        swatch.style.background = item.color;
        const text = document.createElement('span');
        text.textContent =
          item.count == null
            ? String(item.label)
            : `${item.label} ${this._formatCount(item.count)}`;
        entry.append(swatch, text);
        container.insertBefore(entry, info);
      }
      container._legendSignature = legendSignature;
    }
    if (infoText || info) {
      const node = info || document.createElement('div');
      if (!info) {
        container.appendChild(node);
        container._rowControlsInfo = node;
      }
      const className = 'data-toggle-controls-info';
      if (node.className !== className) node.className = className;
      const text = infoText ? String(infoText) : '';
      const title = controls?.infoTitle || '';
      if (node.textContent !== text) node.textContent = text;
      if (node.title !== title) node.title = title;
      const hidden = !text;
      if (node.hidden !== hidden) node.hidden = hidden;
    }
  }

  /**
   * Render a row's ordered list (turn-by-turn directions).
   *
   * Each entry is a real `<button>` inside a real `<li>`, so Tab reaches it and
   * Enter activates it with no key handling of our own, and the `<ol>` carries
   * the ordering a screen reader announces. Items are reconciled in place,
   * keyed by id, for the same reason chips are: this runs on every refresh —
   * including the one a click on the list triggers — and replacing the node
   * would drop keyboard focus mid-interaction.
   * @param {HTMLElement|null} container The row's `.data-row-list` node.
   * @param {{ariaLabel?: string, items?: Array<object>}|null} list Descriptor.
   */
  _syncRowList(container, list) {
    syncRowList(container, list);
  }

  _refreshTogglePanel() {
    if (this._destroyed || !this._toggleContainer) return;
    // Skip DOM churn while hidden; visibilitychange (main.js) triggers one
    // refresh on return. (perf wave 2)
    if (typeof document !== 'undefined' && document.hidden) {
      this.onHiddenRefresh();
      return;
    }
    for (const layer of this.getAll()) {
      const row = this._toggleContainer.querySelector(
        `[data-layer-id="${layer.id}"]`,
      );
      if (!row) continue;

      const btn = row.querySelector('.data-toggle-btn');
      if (btn) {
        this._syncToggleButton(btn, layer);
      }

      const count = row.querySelector('.data-count');
      if (count) {
        this._syncCount(row, count, layer.stats);
      }

      const meta = row.querySelector('.data-toggle-meta');
      if (meta) {
        setRowText(meta, this._buildMetaText(layer));
      }

      this._syncRowControls(
        row.querySelector('.data-toggle-controls'),
        layer,
        row.querySelector('.data-row-list'),
      );
    }
    this._refreshWeatherPanel();
  }

  _buildMetaText(layer) {
    const stats = layer.stats || {};
    const feedState = layerFeedState(stats);
    const stateLabel = t(FEED_STATE_LABEL_KEYS[feedState]);
    const source = sourceLabel(stats.source || layer.source);
    const lifecycleState =
      layer.lifecycleState || (layer.enabled ? 'enabled' : 'disabled');
    if (lifecycleState === 'enabling' || lifecycleState === 'disabling') {
      return t('{state} · {source}', {
        state: lifecycleStateLabel(lifecycleState),
        source,
      });
    }
    if (layer.lifecycleUncertain) {
      return t(
        'UNCERTAIN · {source} · lifecycle state requires reconciliation',
        { source },
      );
    }
    const presentedError = translateFeedError(
      stats.error || stats.lastError || stats.managerRefreshError,
    );
    if (presentedError) {
      if (typeof stats.retryInSec === 'number' && stats.retryInSec > 0) {
        return t('{state} · {source} · {detail} · retry {seconds}s', {
          state: stateLabel,
          source,
          detail: presentedError,
          seconds: stats.retryInSec,
        });
      }
      return t('{state} · {source} · {detail}', {
        state: stateLabel,
        source,
        detail: presentedError,
      });
    }
    // A guidance status carries its prompt in `statusMessage`, not `error`, so
    // the row still tells the operator what to do without reporting a fault.
    if (
      GUIDANCE_STATUSES.includes(String(stats.status || '').toLowerCase()) &&
      typeof stats.statusMessage === 'string' &&
      stats.statusMessage.trim()
    ) {
      return `${source} · ${translateKnown(stats.statusMessage.trim())}`;
    }
    const ago = stats.lastUpdate ? this._timeAgo(stats.lastUpdate) : t('never');
    if (stats.loading) {
      const loadingLabel =
        typeof stats.loadingLabel === 'string' && stats.loadingLabel.trim()
          ? translateStatusLine(stats.loadingLabel.trim())
          : t('loading...');
      return t('{source} · {loadingLabel}', { source, loadingLabel });
    }
    if (feedState === 'fallback') {
      const detail =
        typeof stats.loadingLabel === 'string' && stats.loadingLabel.trim()
          ? translateStatusLine(stats.loadingLabel.trim())
          : stats.coverage || ago;
      return t('{state} · {source} · {detail}', {
        state: stateLabel,
        source,
        detail,
      });
    }
    if (feedState === 'partial') {
      const { acceptedRowCount, rawRowCount } = stats;
      const detail =
        Number.isInteger(acceptedRowCount) &&
        Number.isInteger(rawRowCount) &&
        acceptedRowCount >= 0 &&
        rawRowCount > acceptedRowCount
          ? t('{accepted} of {raw} records accepted', {
              accepted: acceptedRowCount,
              raw: rawRowCount,
            })
          : t('incomplete snapshot');
      return t('{state} · {source} · {detail} · {ago}', {
        state: stateLabel,
        source,
        detail,
        ago,
      });
    }
    if (feedState === 'stale') {
      // A layer drawing cached upstream data (Traffic's proxy tiles) dates the
      // row by the oldest of it, not by the load that re-served it.
      const dataAgo =
        Number(stats.oldestTileAt) > 0
          ? this._timeAgo(stats.oldestTileAt)
          : ago;
      if (typeof stats.retryInSec === 'number' && stats.retryInSec > 0) {
        return t('{state} · {source} · {ago} · retrying in {seconds}s', {
          state: stateLabel,
          source,
          ago: dataAgo,
          seconds: stats.retryInSec,
        });
      }
      return t('{state} · {source} · {ago}', {
        state: stateLabel,
        source,
        ago: dataAgo,
      });
    }
    if (typeof stats.loadingLabel === 'string' && stats.loadingLabel.trim()) {
      return t('{source} · {loadingLabel}', {
        source,
        loadingLabel: translateStatusLine(stats.loadingLabel.trim()),
      });
    }
    return t('{source} · {ago}', { source, ago });
  }

  _syncToggleButton(button, layer) {
    const unavailable = layer.stats?.sourceUnavailable === true;
    const feedState = unavailable
      ? 'unavailable'
      : layer.enabled
        ? layerFeedState(layer.stats)
        : 'off';
    const transitioning =
      layer.lifecycleState === 'enabling' ||
      layer.lifecycleState === 'disabling';
    const uncertain = Boolean(layer.lifecycleUncertain);
    button.classList.toggle('active', layer.enabled);
    button.classList.toggle('transitioning', transitioning);
    button.classList.toggle('enabling', layer.lifecycleState === 'enabling');
    button.classList.toggle('disabling', layer.lifecycleState === 'disabling');
    button.classList.toggle('lifecycle-uncertain', uncertain);
    for (const state of Object.keys(FEED_STATE_LABEL_KEYS)) {
      button.classList.toggle(
        `feed-${state}`,
        (layer.enabled || unavailable) && !uncertain && feedState === state,
      );
    }
    button.dataset.feedState = transitioning
      ? layer.lifecycleState
      : uncertain
        ? 'uncertain'
        : feedState;
    // A busy toggle remains the keyboard focus owner. `aria-disabled` plus the
    // click guard above prevents repeat activation without the focus loss caused
    // by native `disabled`.
    button.disabled = false;
    button.setAttribute(
      'aria-disabled',
      String(transitioning || (unavailable && !layer.enabled)),
    );
    button.setAttribute('aria-busy', String(transitioning));
    const showsFeedState =
      !transitioning && !uncertain && (layer.enabled || unavailable);
    const stateText = transitioning
      ? lifecycleStateLabel(layer.lifecycleState)
      : uncertain
        ? t('UNCERTAIN')
        : showsFeedState
          ? t(FEED_STATE_LABEL_KEYS[feedState])
          : t('OFF');
    // The chip may abbreviate where a language's word is wider than the
    // status column; the meta line and the accessible name keep the full word.
    button.textContent =
      showsFeedState && feedState === 'unavailable'
        ? t('UNAVAILABLE', { context: 'status chip' })
        : stateText;
    const keyGuidance = unavailable
      ? String(
          translateFeedError(layer.stats.error) || t('Data source unavailable'),
        )
      : layerKeyRequirementTooltip(layer);
    // Name the missing key on the control itself: a row reading KEY REQUIRED
    // without saying WHICH key leaves a dead control and no next step. Empty
    // when the layer needs no key, or already has one.
    button.title = keyGuidance;
    const ariaLabel = t('{name}: {state}', {
      name: panelLabel(layer),
      state: stateText,
    });
    button.setAttribute(
      'aria-label',
      keyGuidance ? `${ariaLabel}. ${keyGuidance}` : ariaLabel,
    );
  }

  _formatCount(n) {
    if (n >= 1000)
      return `${formatNumber(n / 1000, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        useGrouping: false,
      })}K`;
    return String(n);
  }

  _timeAgo(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return t('just now');
    if (diff < 60) return t('{count}s ago', { count: diff });
    if (diff < 3600) return t('{count}m ago', { count: Math.floor(diff / 60) });
    return t('{count}h ago', { count: Math.floor(diff / 3600) });
  }
}
