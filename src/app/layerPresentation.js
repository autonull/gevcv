import { LayerPanel } from '../ui/layers.js';
import { governorRequestRender } from '../renderGovernor.js';
import { markDetectionSourcesChanged } from '../data/detection.js';

/** Own the layer panel and application reactions to lifecycle activity. */
export class LayerPresentation {
  constructor(
    manager,
    {
      weatherClock,
      climateViewerClock,
      climateViewerHealth,
      createClimateViewerLayers,
      resolveAsset,
      getCameraHeight = () => null,
      requestRender = governorRequestRender,
      invalidateDetection = markDetectionSourcesChanged,
    } = {},
  ) {
    this.manager = manager;
    this.weatherClock = weatherClock;
    this.climateViewerClock = climateViewerClock;
    this.climateViewerHealth = climateViewerHealth;
    this.createClimateViewerLayers = createClimateViewerLayers;
    this.resolveAsset = resolveAsset;
    this.getCameraHeight = getCameraHeight;
    this._panel = null;
    this.pendingVisible = false;
    this._unsubscribe = manager.subscribeActivity((change) => {
      if (change.type === 'status') this.refresh();
      else if (change.type === 'destroy-all') this.destroy();
      else {
        const reason =
          change.type === 'data-updated'
            ? `layer-tick:${change.layerId}`
            : change.type === 'visibility-settled'
              ? 'layer-visibility'
              : change.type === 'params-settled'
                ? `layer-params:${change.layerId}`
                : null;
        if (!reason) return;
        requestRender(reason);
        if (change.type !== 'params-settled') invalidateDetection(reason);
      }
    });
  }
  get panel() {
    if (!this._panel)
      this._panel = new LayerPanel({
        weatherClock: this.weatherClock,
        climateViewerClock: this.climateViewerClock,
        climateViewerHealth: this.climateViewerHealth,
        createClimateViewerLayers: this.createClimateViewerLayers,
        resolveAsset: this.resolveAsset,
        registerLayer: (layer) => this.manager.register(layer),
        retryLayer: async (id) => {
          await this.manager.setEnabled(id, false, { origin: 'user' });
          return this.manager.setEnabled(id, true, { origin: 'user' });
        },
        getLayers: () => this.manager.getAll(),
        isEnabled: (id) => this.manager.isEnabled(id),
        setEnabled: (id, enabled, options) =>
          this.manager.setEnabled(id, enabled, options),
        setLayerParams: (id, params, options) =>
          this.manager.setLayerParams(id, params, options),
        getRowControls: (id) => {
          const module = this.manager.layers.get(id)?.module;
          try {
            return module?.getRowControls?.() || null;
          } catch (error) {
            console.warn(`[Data] ${id} getRowControls error:`, error);
            return null;
          }
        },
        hasRowControls: (id) =>
          typeof this.manager.layers.get(id)?.module?.getRowControls ===
          'function',
        subscribeRowControls: (id, listener) => {
          const module = this.manager.layers.get(id)?.module;
          module?.setRowControlsListener?.(listener);
          return () => module?.setRowControlsListener?.(null);
        },
        onHiddenRefresh: () => {
          this.pendingVisible = true;
        },
        zoomToLayer: (id) =>
          this.manager.layers.get(id)?.module?.zoomTo?.() ?? false,
        getCameraHeight: () => this.getCameraHeight(),
        setSpotlightLayer: (id) => {
          for (const [layerId, entry] of this.manager.layers ?? []) {
            const module = entry?.module;
            if (typeof module?.setSpotlightOpacity !== 'function') continue;
            module.setSpotlightOpacity(id && layerId !== id ? 0.35 : 1);
          }
        },
      });
    return this._panel;
  }
  mount(container) {
    this.panel.mount(container);
  }
  /** Hand the Recent Imagery readout factory to the panel (see LayerPanel). */
  attachRecentImagery(factory) {
    // Detaching never builds a panel that teardown already released.
    if (factory) this.panel.attachRecentImagery(factory);
    else this._panel?.attachRecentImagery(null);
  }
  refresh() {
    this._panel?._refreshTogglePanel();
  }
  flushVisible() {
    if (!this.pendingVisible) return;
    this.pendingVisible = false;
    this.refresh();
  }
  destroy() {
    this._panel?.destroy();
    this._panel = null;
    this.pendingVisible = false;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}
