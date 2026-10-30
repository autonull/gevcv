import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import catalog from '../layers/climateviewer/catalog.json' with { type: 'json' };
import health from '../layers/climateviewer/health.json' with { type: 'json' };

test('panel presentation places Transit between Street Traffic and Bike Share in Movement', () => {
  const source = readFileSync(
    new URL('./layerPanel.js', import.meta.url),
    'utf8',
  );
  const declarations = source.slice(
    source.indexOf('const PANEL_GROUPS ='),
    source.indexOf('const PANEL_POSITIONS ='),
  );
  const order = JSON.parse(
    runInNewContext(
      `const msg = (text) => text;\n${declarations}\nJSON.stringify(PANEL_ORDER)`,
    ),
  );
  assert.deepEqual(
    order.filter(({ label }) => label === 'Movement').map(({ id }) => id),
    [
      'satellites',
      'flights',
      'military',
      'local-adsb',
      'ais-live-vessels',
      'traffic',
      'transit',
      'bikeshare',
    ],
  );
  assert.equal(order.filter(({ id }) => id === 'transit').length, 1);
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState } = await import('./layerPanel.js');
  const classes = new Map();
  const attrs = new Map();
  const button = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'PARTIAL');
  assert.equal(button.dataset.feedState, 'partial');
  assert.equal(classes.get('feed-partial'), true);
  assert.equal(classes.get('feed-stale'), false);
  assert.match(attrs.get('aria-label'), /PARTIAL/);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'ON');
  assert.equal(classes.get('feed-partial'), false);
  layer.enabled = false;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'OFF');
});

test('a stale row dates cached data by its oldest tile, not the last load', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const panel = LayerPanel.prototype;
  const layer = {
    id: 'traffic',
    name: 'Street Traffic',
    source: 'TomTom',
    enabled: true,
    stats: {
      mode: 'live',
      stale: true,
      count: 4,
      lastUpdate: Date.now(),
      oldestTileAt: Date.now() - 3 * 3600_000,
    },
  };
  assert.match(panel._buildMetaText(layer), /^STALE · TomTom · 3h ago$/);
  delete layer.stats.oldestTileAt;
  assert.match(panel._buildMetaText(layer), /^STALE · TomTom · just now$/);
});

test('readout rows contain only toggles and metadata; ordinary rows retain controls', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = [
    'wind',
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'weather-cyclones',
    'other',
  ];
  let refresh;
  const layers = ids.map((id) => ({
    id,
    name: id,
    icon: '*',
    source: 'Source',
    enabled: true,
    showInTogglePanel: true,
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled: (...args) => calls.push(args),
    setLayerParams: (...args) => calls.push(args),
    hasRowControls: () => true,
    subscribeRowControls: (_id, callback) => {
      refresh = callback;
    },
    getRowControls: (id) => ({
      readout: id !== 'other',
      summary: { status: 'Loading' },
      info: 'Detailed time',
      chips: [{ id: 'config', label: 'Soft', params: { opacity: 'light' } }],
      legend: [{ label: 'Rain', color: '#abcdef' }],
      list: {
        items: [{ id: 'storm', text: 'Storm', params: { focus: true } }],
      },
    }),
  });
  try {
    panel.mount(f.container);
    for (const id of ids.slice(0, -1)) {
      const row = f.find((n) => n.dataset.layerId === id);
      assert.equal(row.children.length, 2);
      assert.ok(row.querySelector('.data-name'));
      assert.ok(row.querySelector('.data-toggle-meta'));
      for (const cls of [
        'data-toggle-chip',
        'data-count',
        'data-toggle-controls',
        'data-toggle-controls-status',
        'data-row-list',
      ])
        assert.equal(row.querySelector(`.${cls}`), null);
      row.querySelector('.data-toggle-btn').click();
    }
    assert.deepEqual(
      calls.map(([id]) => id),
      ids.slice(0, -1),
    );
    const ordinary = f.find((n) => n.dataset.layerId === 'other');
    assert.equal(
      ordinary.querySelector('.data-toggle-controls-info').textContent,
      'Detailed time',
    );
    assert.ok(ordinary.querySelector('.data-toggle-legend-item'));
    ordinary.querySelector('.data-toggle-chip').click();
    assert.deepEqual(calls.at(-1), [
      'other',
      { opacity: 'light' },
      { origin: 'user' },
    ]);
    assert.equal(typeof refresh, 'function');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('the Recent Imagery readout mounts in its rail body like the weather readout and is rebuilt or released with the panel', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const body = f.document.createElement('div');
  f.document.getElementById = (id) =>
    id === 'recent-imagery-panel-body' ? body : null;
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const mounted = [];
  const factory = (container) => {
    const readout = {
      container,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    mounted.push(readout);
    return readout;
  };
  const panel = new LayerPanel({
    getLayers: () => [],
    isEnabled: () => false,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => false,
    subscribeRowControls() {},
    getRowControls: () => null,
  });
  try {
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 0, 'no body before the panel mounts');
    panel.mount(f.container);
    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].container, body);
    panel.mount(f.container);
    assert.equal(mounted[0].destroyed, true, 'a remount rebuilds it');
    assert.equal(mounted.length, 2);
    panel.attachRecentImagery(null);
    assert.equal(mounted[1].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3);
    panel.destroy();
    assert.equal(mounted[2].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3, 'a destroyed panel mounts nothing');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('an omitted source is visibly unavailable and cannot be toggled on', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const attrs = new Map();
  const button = {
    classList: { toggle() {} },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'flights',
    name: 'Flights',
    enabled: false,
    stats: {
      sourceUnavailable: true,
      status: 'unavailable',
      error: 'Data source not configured: flights',
    },
  };
  LayerPanel.prototype._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'UNAVAILABLE');
  assert.equal(attrs.get('aria-disabled'), 'true');
  assert.match(button.title, /not configured/);
  LayerPanel.prototype._syncToggleButton(button, { ...layer, enabled: true });
  assert.equal(
    attrs.get('aria-disabled'),
    'false',
    'an active layer can always be switched off',
  );
});

test('row text keeps a hyphenated code whole and never starts a line with the separator', async () => {
  const { setRowText } = await import('./layerPanel.js');
  const previousDocument = globalThis.document;
  const element = () => ({
    className: '',
    textContent: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  });
  globalThis.document = { createElement: element };
  try {
    const text = (node) =>
      node.children.length
        ? node.children.map((child) => child.textContent).join('')
        : node.textContent;
    const kept = (node) =>
      node.children
        .filter((child) => child.className === 'data-keep')
        .map((child) => child.textContent);

    const name = element();
    setRowText(name, 'Локальный ADS-B');
    assert.equal(text(name), 'Локальный ADS-B');
    assert.deepEqual(kept(name), ['ADS-B']);

    const meta = element();
    setRowText(meta, 'UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED');
    assert.equal(text(meta), 'UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED');
    assert.deepEqual(kept(meta), [' ·', ' ·', ' ·']);
    assert.ok(
      meta.children.every((child) => !child.textContent.startsWith('·')),
      'the space before each dot is held to the piece it closes',
    );

    const plain = element();
    setRowText(plain, 'Satellites');
    assert.equal(plain.textContent, 'Satellites');
    assert.equal(plain.children.length, 0);

    const compound = element();
    setRowText(compound, 'Kartierte ALPR-Kameras · ADS-B-Flüge');
    assert.equal(text(compound), 'Kartierte ALPR-Kameras · ADS-B-Flüge');
    assert.deepEqual(
      kept(compound),
      [' ·', 'ADS-B'],
      'a compound may break at its hyphen; the code inside it stays whole',
    );

    const long = element();
    setRowText(long, 'see https-proxy-endpoint-config-x');
    assert.deepEqual(kept(long), [], 'a long hyphenated run may still wrap');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('the ClimateViewer panel renders a collapsible folder tree with folder toggles', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = ['cv-live-usgs-all-hour', 'cv-live-usgs-45-today'];
  const layers = ids.map((id) => ({
    id,
    name: catalog.layers[id].name,
    icon: '*',
    enabled: false,
    showInTogglePanel: true,
    panelGroup: 'ClimateViewer',
    metadata: catalog.layers[id],
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (id) => layers.find((layer) => layer.id === id)?.enabled,
    setEnabled: async (id, value, options) => {
      calls.push([id, value, options]);
      const layer = layers.find((entry) => entry.id === id);
      if (layer) layer.enabled = value;
    },
  });
  panel._climateViewerOpen = true;
  try {
    panel.mount(f.container);
    const alerts = f.find((node) => node.dataset.cvPath === 'Alerts');
    assert.ok(alerts);
    assert.equal(
      alerts.querySelector('.data-cv-folder').getAttribute('aria-expanded'),
      'true',
    );
    const earthquake = f.find(
      (node) => node.dataset.cvPath === 'Alerts/Earthquake',
    );
    assert.ok(earthquake);
    assert.equal(
      earthquake.querySelector('.data-cv-folder').getAttribute('aria-expanded'),
      'false',
    );
    assert.equal(
      earthquake.querySelector('.data-cv-folder-toggle').textContent,
      'OFF',
    );
    earthquake.querySelector('.data-cv-folder').click();
    const rows = ids.map((id) => f.find((node) => node.dataset.layerId === id));
    assert.ok(rows.every(Boolean));
    const expanded = f.find(
      (node) => node.dataset.cvPath === 'Alerts/Earthquake',
    );
    expanded.querySelector('.data-cv-folder-toggle').click();
    assert.deepEqual(
      calls.map(([id, value]) => [id, value]),
      ids.map((id) => [id, true]),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer search opens the first result, remembers it, and survives a rebuild', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = ['cv-live-usgs-all-hour', 'cv-live-usgs-45-today'];
  const layers = ids.map((id) => ({
    id,
    name: catalog.layers[id].name,
    icon: '*',
    enabled: false,
    showInTogglePanel: true,
    panelGroup: 'ClimateViewer',
    metadata: catalog.layers[id],
    stats: {},
  }));
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (id) => layers.find((layer) => layer.id === id)?.enabled,
    setEnabled: async (id, value) => {
      const layer = layers.find((entry) => entry.id === id);
      if (layer) layer.enabled = value;
    },
  });
  panel._climateViewerOpen = true;
  const fire = (node, type, props = {}) => {
    const event = new Event(type);
    for (const [key, value] of Object.entries(props))
      Object.defineProperty(event, key, { value });
    node.dispatchEvent(event);
    return event;
  };
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    let filter = byClass('data-cv-filter');
    filter.value = 'usgs';
    fire(filter, 'input');
    const first = byClass('data-cv-row');
    fire(filter, 'keydown', { key: 'Enter' });
    assert.equal(first.querySelector('.data-cv-drawer').hidden, false);
    assert.equal(
      first.querySelector('.data-cv-info').getAttribute('aria-expanded'),
      'true',
    );
    const recent = byClass('data-cv-recent');
    assert.equal(recent.textContent, 'usgs');

    panel._renderToggles();
    filter = byClass('data-cv-filter');
    assert.equal(filter.value, 'usgs');
    assert.equal(byClass('data-cv-recent').textContent, 'usgs');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer drawer copies source, zooms, and filters similar layers', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  globalThis.document = f.document;
  const clipboard = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (text) => clipboard.push(text) } },
  });
  const ids = [
    'cv-live-usgs-all-hour',
    'cv-live-usgs-45-today',
    'cv-live-ngdc-hazards',
  ];
  const layers = ids.map((id) => ({
    id,
    name: catalog.layers[id].name,
    icon: '*',
    enabled: false,
    showInTogglePanel: true,
    panelGroup: 'ClimateViewer',
    metadata: catalog.layers[id],
    stats: {},
  }));
  const zoomed = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (id) => layers.find((layer) => layer.id === id)?.enabled,
    setEnabled: async (id, value) => {
      const layer = layers.find((entry) => entry.id === id);
      if (layer) layer.enabled = value;
    },
    zoomToLayer: (id) => zoomed.push(id),
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    const filter = byClass('data-cv-filter');
    filter.value = 'usgs-all-hour';
    filter.dispatchEvent(new Event('input'));
    const row = f.find(
      (node) => node.dataset.layerId === 'cv-live-usgs-all-hour',
    );
    row.querySelector('.data-cv-info').click();
    const drawer = row.querySelector('.data-cv-drawer');
    assert.equal(drawer.hidden, false);
    byClass('data-cv-copy-source').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(clipboard, [catalog.layers[ids[0]].sourceUrl]);
    byClass('data-cv-zoom').click();
    assert.deepEqual(zoomed, [ids[0]]);
    byClass('data-cv-similar').click();
    assert.equal(filter.value, 'Earthquake');
    assert.ok(
      f.find((node) => node.dataset.layerId === 'cv-live-usgs-45-today'),
    );
    assert.equal(
      f.find((node) => node.dataset.layerId === 'cv-live-ngdc-hazards'),
      null,
    );
  } finally {
    panel.destroy();
    if (previousNavigator)
      Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer shows an empty state and tracks its full-screen sheet class', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const id = 'cv-live-usgs-all-hour';
  const layers = [
    {
      id,
      name: catalog.layers[id].name,
      icon: '*',
      enabled: false,
      showInTogglePanel: true,
      panelGroup: 'ClimateViewer',
      metadata: catalog.layers[id],
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: async (layerId, value) => {
      const layer = layers.find((entry) => entry.id === layerId);
      if (layer) layer.enabled = value;
    },
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    assert.equal(
      f.document.body.classList.contains('climateviewer-sheet-open'),
      true,
    );
    const details = byClass('data-cv-section');
    const filter = byClass('data-cv-filter');
    filter.value = 'no-such-layer-zzz';
    filter.dispatchEvent(new Event('input'));
    assert.equal(byClass('data-cv-note').textContent, 'No layers match');

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    assert.equal(
      f.document.body.classList.contains('climateviewer-sheet-open'),
      false,
    );
  } finally {
    panel.destroy();
    assert.equal(
      f.document.body.classList.contains('climateviewer-sheet-open'),
      false,
    );
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer refreshes its global enabled counter and confirms large bulk edits', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  const previousConfirm = globalThis.confirm;
  globalThis.document = f.document;
  const id = 'cv-live-usgs-all-hour';
  const layers = [
    {
      id,
      name: catalog.layers[id].name,
      icon: '*',
      enabled: false,
      showInTogglePanel: true,
      panelGroup: 'ClimateViewer',
      metadata: catalog.layers[id],
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: async (layerId, value) => {
      const layer = layers.find((entry) => entry.id === layerId);
      if (layer) layer.enabled = value;
    },
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  const asks = [];
  globalThis.confirm = (message) => {
    asks.push(message);
    return false;
  };
  try {
    panel.mount(f.container);
    assert.equal(byClass('data-cv-enabled').textContent, '0 ON');
    const filter = byClass('data-cv-filter');
    filter.value = 'usgs-all-hour';
    filter.dispatchEvent(new Event('input'));
    byClass('data-toggle-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(byClass('data-cv-enabled').textContent, '1 ON');

    assert.equal(panel._confirmClimateViewerBulk(50), true);
    assert.equal(panel._confirmClimateViewerBulk(51), false);
    assert.deepEqual(asks, ['Change 51 layers?']);
  } finally {
    panel.destroy();
    if (previousConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = previousConfirm;
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer rows show a busy state and surface toggle failures', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  const previousWarn = console.warn;
  globalThis.document = f.document;
  console.warn = () => {};
  const id = 'cv-live-usgs-all-hour';
  const layers = [
    {
      id,
      name: catalog.layers[id].name,
      icon: '*',
      enabled: false,
      showInTogglePanel: true,
      panelGroup: 'ClimateViewer',
      metadata: catalog.layers[id],
      stats: {},
    },
  ];
  let rejectToggle;
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: () =>
      new Promise((resolve, reject) => {
        rejectToggle = reject;
      }),
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    const filter = byClass('data-cv-filter');
    filter.value = 'usgs-all-hour';
    filter.dispatchEvent(new Event('input'));
    const toggle = byClass('data-toggle-btn');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-busy'), 'true');
    assert.equal(toggle.classList.contains('transitioning'), true);

    rejectToggle(new Error('boom'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = f.find((node) => node.dataset.layerId === id);
    assert.equal(row.classList.contains('data-cv-row-error'), true);
    assert.equal(
      row.querySelector('.data-toggle-meta').textContent,
      'Error: boom',
    );
    assert.equal(toggle.getAttribute('aria-busy'), 'false');
  } finally {
    panel.destroy();
    console.warn = previousWarn;
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer health chips filter rows and expose the probe summary', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = ['cv-live-usgs-all-hour', 'cv-pollution-bw-reactor'];
  const layers = ids.map((id) => ({
    id,
    name: catalog.layers[id].name,
    icon: '*',
    enabled: false,
    showInTogglePanel: true,
    panelGroup: 'ClimateViewer',
    metadata: { ...catalog.layers[id], health: health.results[id] },
    stats: {},
  }));
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: async (layerId, value) => {
      const layer = layers.find((entry) => entry.id === layerId);
      if (layer) layer.enabled = value;
    },
    climateViewerHealth: { ...health, catalogHash: 'deadbeef' },
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    assert.equal(byClass('data-cv-health-stale').textContent, 'Health stale');
    assert.equal(byClass('data-cv-health-chip').textContent, 'ok 1');
    const redirectChip = f.find((node) => node.dataset.health === 'redirect');
    assert.ok(redirectChip);
    const okChip = f.find((node) => node.dataset.health === 'ok');
    okChip.click();
    assert.equal(
      f
        .find((node) => node.dataset.health === 'ok')
        .classList.contains('active'),
      true,
    );
    assert.ok(f.find((node) => node.dataset.layerId === ids[1]));
    assert.equal(
      f.find((node) => node.dataset.layerId === ids[0]),
      null,
    );
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer clock surface follows the shared day and labels time rows', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const { createClimateViewerClock } =
    await import('../layers/climateviewer/clock.js');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const clock = createClimateViewerClock({
    now: () => new Date('2026-01-02T12:00:00Z'),
  });
  const id = 'cv-satellites-sat15';
  const layers = [
    {
      id,
      name: catalog.layers[id].name,
      icon: '*',
      enabled: true,
      showInTogglePanel: true,
      panelGroup: 'ClimateViewer',
      metadata: catalog.layers[id],
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: async (layerId, value) => {
      const layer = layers.find((entry) => entry.id === layerId);
      if (layer) layer.enabled = value;
    },
    climateViewerClock: clock,
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    assert.equal(byClass('data-cv-clock').hidden, false);
    assert.equal(byClass('data-cv-date').value, '2026-01-02');
    const filter = byClass('data-cv-filter');
    filter.value = id;
    filter.dispatchEvent(new Event('input'));
    const row = f.find((node) => node.dataset.layerId === id);
    assert.equal(row.querySelector('.data-cv-day').textContent, '2026-01-02');
    assert.equal(byClass('data-cv-timeline').hidden, false);
    assert.equal(clock.today(), '2026-01-02');
    assert.equal(
      f
        .find((node) => node.dataset.day === '2026-01-02')
        .classList.contains('active'),
      true,
    );
    const earliest = f.find((node) => node.dataset.day === '2025-12-04');
    assert.ok(earliest);
    earliest.dispatchEvent(new Event('mouseenter'));
    assert.equal(byClass('data-cv-timeline-preview').textContent, '2025-12-04');
    earliest.click();
    assert.equal(clock.isoDate(), '2025-12-04');
    byClass('data-cv-day-next').click();
    assert.equal(clock.isoDate(), '2025-12-05');
    assert.equal(row.querySelector('.data-cv-day').textContent, '2025-12-05');
  } finally {
    panel.destroy();
    clock.destroy();
    globalThis.document = previousDocument;
  }
});

test('ClimateViewer proxy preference validates, saves, and clears', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const { CLIMATEVIEWER_PROXY_STORAGE_KEY } =
    await import('../layers/climateviewer/settings.js');
  const f = railFixture();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = f.document;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  const id = 'cv-live-usgs-all-hour';
  const layers = [
    {
      id,
      name: catalog.layers[id].name,
      icon: '*',
      enabled: false,
      showInTogglePanel: true,
      panelGroup: 'ClimateViewer',
      metadata: catalog.layers[id],
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: async (layerId, value) => {
      const layer = layers.find((entry) => entry.id === layerId);
      if (layer) layer.enabled = value;
    },
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    const input = byClass('data-cv-proxy-input');
    byClass('data-cv-proxy-save').click();
    input.value = 'https://proxy.example/';
    byClass('data-cv-proxy-save').click();
    assert.equal(
      values.get(CLIMATEVIEWER_PROXY_STORAGE_KEY),
      'https://proxy.example',
    );
    assert.equal(
      byClass('data-cv-proxy-status').textContent,
      'Reload to apply',
    );
    input.value = 'ftp://bad.example/';
    byClass('data-cv-proxy-save').click();
    assert.equal(
      byClass('data-cv-proxy-status').textContent,
      'Invalid proxy URL',
    );
    byClass('data-cv-proxy-clear').click();
    assert.equal(values.has(CLIMATEVIEWER_PROXY_STORAGE_KEY), false);
  } finally {
    panel.destroy();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('time providers offer an opt-in drawer animation control', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const { createClimateViewerClock } =
    await import('../layers/climateviewer/clock.js');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const clock = createClimateViewerClock({
    now: () => new Date('2026-01-02T12:00:00Z'),
  });
  const id = 'cv-satellites-modis-terra-correctedreflectance-truecolor';
  const layers = [
    {
      id,
      name: catalog.layers[id].name,
      icon: '*',
      enabled: true,
      showInTogglePanel: true,
      panelGroup: 'ClimateViewer',
      metadata: catalog.layers[id],
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: (layerId) =>
      layers.find((layer) => layer.id === layerId)?.enabled,
    setEnabled: async (layerId, value) => {
      const layer = layers.find((entry) => entry.id === layerId);
      if (layer) layer.enabled = value;
    },
    climateViewerClock: clock,
  });
  panel._climateViewerOpen = true;
  const byClass = (name) =>
    f.find((node) => node.className?.split(' ').includes(name));
  try {
    panel.mount(f.container);
    const filter = byClass('data-cv-filter');
    filter.value = id;
    filter.dispatchEvent(new Event('input'));
    const row = f.find((node) => node.dataset.layerId === id);
    row.querySelector('.data-cv-info').click();
    const animate = row.querySelector('.data-cv-animate');
    assert.equal(animate.hidden, false);
    assert.equal(animate.textContent, 'Animate');
    animate.click();
    assert.equal(animate.textContent, 'Stop');
    assert.equal(animate.getAttribute('aria-pressed'), 'true');
    animate.click();
    assert.equal(animate.textContent, 'Animate');
    assert.equal(animate.getAttribute('aria-pressed'), 'false');
  } finally {
    panel.destroy();
    clock.destroy();
    globalThis.document = previousDocument;
  }
});

test('the unavailable chip may abbreviate, but its accessible name keeps the full state', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const attrs = new Map();
  const button = {
    classList: { toggle() {} },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  LayerPanel.prototype._syncToggleButton(button, {
    id: 'local-firms',
    name: 'FIRMS Active Fires',
    enabled: false,
    stats: { sourceUnavailable: true, error: 'KEY REQUIRED' },
  });
  assert.equal(button.textContent, 'UNAVAILABLE');
  assert.equal(button.dataset.feedState, 'unavailable');
  assert.match(attrs.get('aria-label'), /^Active Fires: UNAVAILABLE\./);
});

test('the Weather readout receives enabled air-quality alongside weather layers', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const layers = ['wind', 'air-quality', 'other'].map((id) => ({
    id,
    icon: '*',
    enabled: true,
  }));
  layers.push({ id: 'weather-radar', icon: '*', enabled: false });
  const panel = new LayerPanel({
    getLayers: () => layers,
    getRowControls: (id) => ({ readout: true, summary: { label: id } }),
  });
  let entries = null;
  panel._weatherPanel = {
    update: (next) => {
      entries = next;
    },
  };
  panel._refreshWeatherPanel();
  assert.deepEqual(
    entries.map(({ id, summary }) => [id, summary.label]),
    [
      ['wind', 'wind'],
      ['air-quality', 'air-quality'],
    ],
  );
});
