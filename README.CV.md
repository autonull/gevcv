# ClimateViewer (CV) — Codebase Assessment & Rewrite Strategy

**Status:** DRAFT — For internal decision-making only
**Date:** 2026-10-31
**Related repos:** `gev/` (this fork), `cv/` (upstream ClimateViewer 3D)

---

## 1. Executive Summary

| Repository | Role | State |
|------------|------|-------|
| `bilawalsidhu/gods-eye-view` (upstream) | Visual demo platform ("spy-satellite simulator") | Active, optimizing for YouTube/social |
| `autonull/gevcv` (this fork, `gev/`) | Fork with ClimateViewer integration | **Diverged 2,377 commits**; metadata still points upstream |
| `cv/` (sibling, `../cv/`) | Original ClimateViewer 3D — layer catalog source | **Source of truth for CV layers**; synced via `scripts/sync-cv-catalog.mjs` |

**Core tension:** Upstream GEV optimizes for *visual spectacle* (CRT/NVG/FLIR shaders, cockpit 3D models, detection mesh, sonar, bloom, starfield). CV needs *analytical utility* (headless analysis, MCP tools, minimal GPU, zero bloat).

**Verdict:** The fork is too diverged to maintain sync. The CV layer system (`src/layers/climateviewer/`) is the only high-value asset here. Extract it; discard the GEV host.

---

## 2. Current Architecture Map

### 2.1 What Lives Where

```
gev/ (this repo, 2,377 commits ahead of upstream sync point 423ca3ca)
├── src/
│   ├── layers/climateviewer/          ← THE ASSET (405 layers, 10 categories)
│   │   ├── catalog.json               ← Generated from ../cv/dist/js/cv-layers-5.5.js
│   │   ├── health.json                ← Probe results per layer
│   │   ├── index.js                   ← Layer factory, lifecycle, analyst records
│   │   ├── families/                  ← KML, GeoJSON, ArcGIS, WMS, GIBS, CartoDB, Bing
│   │   ├── imagery.js                 ← ImageryProvider factory (Cesium-coupled)
│   │   ├── vector.js                  ← GeoJSONL worker, batched entities
│   │   ├── packs.js / packs.json      ← Layer packs, deep links, atlas export
│   │   ├── health.js / healthAudit.js ← Probe classification, status summaries
│   │   ├── clock.js                   ← Timeline scrub (30-day)
│   │   └── atlasLinks.js              ← Cross-layer navigation
│   ├── agent/worldPacket.js           ← Model-free context extraction (MCP/voice)
│   ├── tools/mcp/                     ← MCP server (stdio + HTTP, 30+ tools)
│   ├── voice/realtime*.js             ← OpenAI + Gemini Live (modular)
│   └── [200+ other GEV modules]       ← Visual bloat, cockpit, HUD, styles, etc.
├── scripts/sync-cv-catalog.mjs        ← Pulls catalog from ../cv/dist/
└── package.json                       ← Still claims upstream repo/author

cv/ (external sibling, not in this repo)
├── dist/js/cv-layers-5.5.js           ← Source of catalog.json (generated)
├── src/                               ← Original ClimateViewer 3D source
└── [build pipeline]                   ← Generates the layer definitions
```

### 2.2 Dependency Graph

```
cv/ (source)
    │
    ▼ generates
catalog.json + health.json
    │
    ▼ consumed by
gev/src/layers/climateviewer/index.js  ← Layer factory
    │
    ├── requires Cesium (ImageryProvider, Entity, DataSource)
    ├── requires GEV dataManager (layer lifecycle, stats, analyst records)
    ├── requires GEV mapStack (basemap switching)
    ├── requires GEV styleManager (visual styles, context mode)
    └── requires GEV viewer (camera, scene)
    │
    ▼ exposes
- createClimateViewerLayer(definition, options)
- createClimateViewerLayers(options)
- climateViewerHealth(id), climateViewerTraits(id)
- getAnalystRecords(maxCount) → pure JSON
- Layer metadata (cvId, description, sourceUrl, category, flags, health)
```

**Key insight:** CV layers are *factories* that plug into GEV's runtime. The catalog data is pure JSON. The coupling is in the `enable/disable/update/destroy` lifecycle and Cesium resource creation.

---

## 3. What GEV Contributes to CV (Value Assessment)

| GEV Component | Value to CV | Extractable? |
|---------------|-------------|--------------|
| **Cesium globe + Google 3D Tiles** | 3D terrain, photorealistic cities | Yes — thin wrapper |
| **Map stack controller** | Basemap switching (Esri, OSM, Ion, Google 3D) | Yes — thin wrapper |
| **Layer lifecycle (dataManager)** | Enable/disable, stats, analyst records, share links | **Core coupling** — reimplement |
| **UI shell (panels, rails, HUD)** | ClimateViewer tree panel, atlas UI | **Reimplement** — minimal atlas panel only |
| **Voice / MCP / World Packet** | Analyst queries, "point and ask", MCP tools | **Extract** — pure logic, no viewer needed |
| **Scene Director** | Cinematic tours, data packs, sharing | Optional — CV-specific scenes |
| **Server proxies** | CORS-free NOAA/USGS/PDC access | **Extract** — Node fetch wrappers |
| **Share links / persistence** | CV layer state in URLs | **Reimplement** — minimal codec |

**Net:** ~15% of GEV code is useful to CV. 85% is visual bloat (styles, cockpit, HUD, detection, sonar, bloom, starfield, 3D models, voice UI, scene director, street level, radio, transit, traffic, CCTV, ALPR, flights, vessels, satellites, military, FIRMS, launches, installations, perimeters, wind, weather, cyclones).

---

## 4. What `cv/` (Upstream ClimateViewer) Contributes

| Asset | Location | Value |
|-------|----------|-------|
| **Layer catalog (405 layers)** | `cv/dist/js/cv-layers-5.5.js` → `catalog.json` | **Primary asset** — definitions, metadata, hierarchy |
| **Health probe data** | `cv/` build output → `health.json` | Operational — probe status per layer |
| **Layer families** | `cv/src/` → `families/*.js` | KML, GeoJSON, ArcGIS, WMS, GIBS, CartoDB, Bing parsers |
| **Tile generation** | `cv/` build pipeline | Pre-rendered tiles for static hosting |
| **Domain knowledge** | `cv/` source + docs | Categorization, source URLs, update cadences |

**Critical:** `cv/` is the *source of truth*. `gev/` only consumes its build output. Any rewrite must preserve the `cv/` → `catalog.json` pipeline.

---

## 5. Salvage Inventory — Maximum Value Extraction

### 5.1 High Value (Extract → `cv-core/`)

| File/Module | Lines | Extraction Effort | Target |
|-------------|-------|-------------------|--------|
| `src/layers/climateviewer/catalog.json` | ~50KB | Copy | `cv-core/catalog/` |
| `src/layers/climateviewer/health.json` | ~20KB | Copy | `cv-core/catalog/` |
| `src/layers/climateviewer/index.js` | 357 | Medium — strip GEV deps | `cv-core/factory.js` |
| `src/layers/climateviewer/families/*.js` | ~1,500 | Medium — Cesium→fetch interface | `cv-core/families/` |
| `src/layers/climateviewer/vector.js` | ~500 | Medium — worker→Node | `cv-core/vector.js` |
| `src/layers/climateviewer/imagery.js` | ~300 | Medium — Cesium→fetch | `cv-core/imagery.js` |
| `src/layers/climateviewer/health.js` | ~400 | Low — pure logic | `cv-core/health.js` |
| `src/layers/climateviewer/healthAudit.js` | ~200 | Low — pure logic | `cv-core/healthAudit.js` |
| `src/layers/climateviewer/packs.js` | ~300 | Low — pure logic | `cv-core/packs.js` |
| `src/layers/climateviewer/atlasLinks.js` | ~150 | Low — pure logic | `cv-core/atlasLinks.js` |
| `src/agent/worldPacket.js` | 170 | **High value** — strip viewer deps | `cv-headless/analyst-query.js` |
| `src/tools/mcp/` | ~2,000 | **High value** — strip Vite/GEV | `cv-headless/mcp-server.js` |
| `scripts/sync-cv-catalog.mjs` | ~350 | Low — adapt paths | `cv-core/cli/sync.js` |

### 5.2 Medium Value (Adapt → `cv-runtime-browser/`)

| File/Module | Lines | Adaptation |
|-------------|-------|------------|
| `src/ui/climateViewerTree.js` | ~800 | Strip GEV panel system → standalone atlas tree |
| `src/ui/styles/climateviewer.css` | ~800 | Minimal theme for atlas panel only |
| `src/layers/climateviewer/clock.js` | ~100 | Timeline scrub UI (optional) |

### 5.3 Zero Value (Discard)

All visual styles, cockpit, HUD, detection, sonar, bloom, starfield, 3D aircraft, voice UI, scene director, street level, radio, transit, traffic, CCTV, ALPR, flights, vessels, satellites, military, FIRMS, launches, installations, perimeters, wind, weather, cyclones, key setup, PWA, Docker, Pinokio, etc.

---

## 6. Ideal Rewrite Architecture

### 6.1 Three-Package Monorepo (Recommended)

```
cv-monorepo/
├── packages/
│   ├── cv-core/                    # npm package, zero deps
│   │   ├── src/
│   │   │   ├── catalog/            # catalog.json, health.json, types
│   │   │   ├── families/           # KML, GeoJSON, ArcGIS, WMS, GIBS, CartoDB, Bing
│   │   │   ├── imagery.js          # ImageryProvider interface (fetch-based)
│   │   │   ├── vector.js           # GeoJSONL parse, batched entities, analyst records
│   │   │   ├── health.js           # Probe classification, status summaries
│   │   │   ├── healthAudit.js      # Drift detection, health reports
│   │   │   ├── packs.js            # Layer packs, deep links, atlas export
│   │   │   ├── atlasLinks.js       # Cross-layer navigation
│   │   │   ├── factory.js          # createLayer(definition, adapters)
│   │   │   └── index.js            # Public API
│   │   ├── cli/
│   │   │   ├── sync.js             # Pull from cv/ → generate catalog
│   │   │   ├── health-audit.js     # Run probes, update health.json
│   │   │   └── generate-tiles.js   # Pre-render static tiles
│   │   └── package.json
│   │
│   ├── cv-headless/                # npm package, Node only
│   │   ├── src/
│   │   │   ├── mcp-server.js       # MCP stdio/HTTP (30+ tools)
│   │   │   ├── analyst-query.js    # Filter/rank/count (from worldPacket)
│   │   │   ├── providers/          # NOAA, USGS, PDC, EMSC fetch wrappers
│   │   │   └── tile-cache.js       # Disk cache for imagery/vector
│   │   ├── bin/cv-mcp              # CLI entry: `npx cv-mcp`
│   │   └── package.json
│   │
│   └── cv-runtime-browser/         # npm package, optional
│       ├── src/
│       │   ├── viewer.js           # Minimal Cesium init + layer mount
│       │   ├── atlas-panel.js      # Tree UI (from climateViewerTree)
│       │   └── share-codec.js      # Minimal URL serialization
│       └── package.json
│
├── cv/ (submodule or sibling)      # Upstream ClimateViewer 3D source
│   └── dist/js/cv-layers-*.js      # Catalog source
│
├── package.json                    # Workspace root
├── turbo.json                      # Turborepo config
└── README.md
```

### 6.2 Interface Contracts (Decoupling)

```typescript
// cv-core/src/types.ts
interface LayerDefinition {
  id: string;
  name: string;
  family: 'kml' | 'geojson' | 'arcgis' | 'wms' | 'gibs' | 'cartodb' | 'baseLayer' | 'bing';
  role: 'overlay' | 'basemap';
  url: string;                    // Can be http(s):// or /cv/ (local)
  category: string[];
  cvId: string;
  description?: string;
  sourceUrl?: string;
  sublayers?: string[];
  flags?: { zoomTo?: boolean; [k: string]: any };
  traits?: { nameIsData?: boolean; voice?: 'toggle' | 'none' };
  markerIcon?: string;
}

interface LayerAdapter {
  // Implemented by runtime (browser or headless)
  fetchImageryTile(url: string, z: number, x: number, y: number): Promise<ImageBitmap>;
  fetchVectorData(url: string): Promise<GeoJSON>;
  createImageryProvider(def: LayerDefinition): ImageryProvider;  // Browser only
  createVectorLayer(def: LayerDefinition): VectorLayer;          // Browser only
}

interface AnalystRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  properties: Record<string, any>;
  layerId: string;
  timestamp: number;
}

// Pure functions — no runtime deps
interface CVCoreAPI {
  getCatalog(): LayerDefinition[];
  getHealth(layerId: string): HealthResult;
  createLayer(def: LayerDefinition, adapters: LayerAdapter): LayerInstance;
  queryAnalyst(filters: AnalystFilters): AnalystRecord[];
  getPacks(): PackDefinition[];
  resolveAtlasLink(link: string): LayerDefinition[];
}
```

### 6.3 Data Flow (Headless MCP Example)

```
User (Claude/Codex) → "Show fires near LA"
       │
       ▼
cv-mcp (stdio/HTTP) → cv-headless/mcp-server.js
       │
       ├── tools/queries/hazards.js → analyst-query.js
       │       │
       │       ├── cv-core/factory.js → loadVectorDataSource(definition)
       │       │       │
       │       │       ├── families/geojson.js → fetch + parse GeoJSON
       │       │       └── vector.js → batched entities → analyst records
       │       │
       │       └── filter/rank by distance, intensity, time
       │
       ▼
JSON response → LLM → User
```

**No Cesium. No browser. No GEV.**

---

## 7. Migration Plan (Phased)

### Phase 1: Extract `cv-core` (Week 1-2)
- [ ] Copy `src/layers/climateviewer/` → `packages/cv-core/src/`
- [ ] Replace Cesium `ImageryProvider` with fetch-based interface in families
- [ ] Convert `vector.js` GeoJSONL worker to Node-compatible (no `self`/`postMessage`)
- [ ] Extract `health.js`, `healthAudit.js`, `packs.js`, `atlasLinks.js` (pure logic)
- [ ] Write `factory.js` with adapter pattern
- [ ] Write `cli/sync.js` to generate catalog from `cv/` build output
- [ ] Publish `cv-core` to local registry / npm

### Phase 2: Build `cv-headless` (Week 2-3)
- [ ] Extract `worldPacket.js` → `analyst-query.js` (pure functions, no viewer)
- [ ] Extract `tools/mcp/` → `mcp-server.js` (stdio/HTTP, no Vite)
- [ ] Implement provider fetch wrappers (NOAA, USGS, PDC, EMSC, NWS)
- [ ] Add disk cache for imagery/vector tiles
- [ ] Test: `npx cv-mcp` works in Claude Desktop
- [ ] Test: `cv-analyst "fires near LA"` returns JSON

### Phase 3: Optional `cv-runtime-browser` (Week 3-4)
- [ ] Minimal Cesium viewer (`viewer.js` ~200 lines)
- [ ] Atlas panel from `climateViewerTree.js` (strip GEV panel system)
- [ ] Share codec for layer state URLs
- [ ] Test: Load CV layers on globe, toggle, atlas navigation

### Phase 4: Deprecate `gev/`
- [ ] Archive `gev/` repo
- [ ] Update documentation, CI, deployment to use `cv-monorepo`
- [ ] Notify any downstream consumers

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `cv/` upstream changes catalog format | Medium | High | Pin `cv/` version in `sync.js`; version `catalog.json` |
| Cesium API changes break browser runtime | Low | Medium | `cv-runtime-browser` is optional; core works without it |
| MCP protocol changes | Low | Medium | MCP is stable; version tools |
| Loss of GEV visual features users expect | Low | Low | CV never had them; different audience |
| `cv/` repo becomes unavailable | Low | High | Mirror `cv/dist/js/cv-layers-*.js` in `cv-core/catalog/` |
| Developer familiarity with GEV patterns | Medium | Low | Document adapter pattern; provide examples |

---

## 9. Decision Matrix

| Option | Effort | Maintenance | CV Utility | GEV Utility | Recommendation |
|--------|--------|-------------|------------|-------------|----------------|
| **Keep `gev/` as-is** | 0 | High (sync debt) | Low (buried in bloat) | High | ❌ No |
| **Sync `gev/` with upstream** | High/ongoing | High | Low | High | ❌ No |
| **Extract CV layers only (minimal)** | Medium | Low | Medium | None | ⚠️ Partial |
| **Full `cv-monorepo` rewrite (this plan)** | Medium (4 weeks) | **Low** | **High** | None | ✅ **Yes** |
| **Rewrite from scratch** | High | Low | High | None | ❌ Waste |

---

## 10. Appendix: Key File References

### GEV Fork (`gev/`)
- `src/layers/climateviewer/` — Complete CV integration
- `src/agent/worldPacket.js` — Context extraction for MCP
- `src/tools/mcp/` — MCP server implementation
- `scripts/sync-cv-catalog.mjs` — Catalog sync from `cv/`
- `package.json` — Metadata (still upstream)

### Upstream CV (`cv/`, external)
- `dist/js/cv-layers-5.5.js` — Catalog source (generated)
- `src/` — Original layer definitions, families, build
- Build pipeline → generates `cv-layers-*.js`

### Sync Point
- Upstream GEV commit: `423ca3ca` (PR #1485, CCTV view thinning)
- Fork merge commit: `404f79e5` ("merge: sync fork main into prototype work")
- Divergence: **2,377 commits**, **+17,213 net lines**

---

## 11. Next Steps for Decision

1. **Review this document** with team
2. **Confirm `cv/` access** — ensure `../cv/` is available or mirrored
3. **Approve Phase 1** — extract `cv-core` as standalone package
4. **Assign ownership** — `cv-core`, `cv-headless`, `cv-runtime-browser`
5. **Set timeline** — target 4 weeks to `cv-mcp` working in Claude Desktop

---

**Contact:** [Team lead] — Questions, objections, or approvals by [date].

---

# ClimateViewer — Architecture Decision Report (Extended)

**Status:** DRAFT — For internal decision-making
**Date:** 2026-10-31
**Scope:** Choose between continuing `gev/` fork, extracting CV, rebuilding from SpimeDB, or greenfield rewrite

---

## 1. The Four Options

| Option | Description | Codebase | Effort | Risk |
|--------|-------------|----------|--------|------|
| **A. Continue `gev/` fork** | Maintain current fork, sync upstream periodically | `autonull/gevcv` (this repo) | Low initial, High ongoing | Sync debt, visual bloat, metadata lies |
| **B. Extract CV from `gev/`** | Create `cv-monorepo` from `src/layers/climateviewer/` + `agent/` + `tools/mcp/` | `gev/` subset | Medium (4 weeks) | Cesium coupling, upstream CV drift |
| **C. Rebuild from SpimeDB** | Modernize `autonull/spimedb` (Java + WorldWind + NObjects) | `spimedb` | High (3-6 months) | Java stack, WorldWind dead, P2P complexity |
| **D. Greenfield rewrite** | New stack: TypeScript, Cesium/MapLibre, Postgres/Parquet, MCP-native | None | High (2-3 months) | No existing code reuse |

---

## 1.1 Strategic Extension: PWA + P2P + Optional Server-Side Spacetime DB

**This is not a separate option — it's an architectural layer on top of Option B.**

| Layer | Technology | Purpose | Optional? |
|-------|------------|---------|-----------|
| **PWA** | Vite + `vite-plugin-pwa` (already in `gev/`) | Offline-first, installable, background sync | No — baseline |
| **P2P Data Sharing** | WebRTC DataChannels + libp2p/helia (JS) | Peer-to-peer layer/catalog/share sync, no central server | Yes — progressive enhancement |
| **Server-Side Spacetime DB** | Node/TypeScript + DuckDB/Parquet + H3 index | Authoritative spacetime index, ingestion pipeline, multi-tenant | Yes — for teams/organizations |

**Philosophy:** Local-first (PWA) → Peer-enhanced (P2P) → Server-optional (Spacetime DB). Each layer adds capability without requiring the next. This **realizes SpimeDB's "autonomy maximization" vision** on a modern TypeScript stack without AGPL viral license.

---

## 2. Codebase Comparison Matrix

### 2.1 `gev/` (this fork, `autonull/gevcv`)

| Aspect | Detail |
|--------|--------|
| **Language** | TypeScript (ESM), Node.js 24+ |
| **Globe** | CesiumJS 1.138 + Google Photorealistic 3D Tiles |
| **Visuals** | CRT/NVG/FLIR/Noir/Surveillance/Thermal/Anime/Snow/Bloom/Sonar shaders |
| **Layers** | 20+ live layers (flights, vessels, sats, eq, FIRMS, traffic, CCTV, radio, transit, wind, weather, cyclones, launches, installations, perimeters, ALPR, dams, cables, datacenters) |
| **CV Integration** | `src/layers/climateviewer/` — 405 layers, 10 categories, catalog.json + health.json from `cv/` |
| **Voice/MCP** | OpenAI Realtime + Gemini Live, MCP stdio/HTTP (30+ tools), `worldPacket.js` |
| **UI** | Vanilla JS panels, HUD, cockpit, atlas tree, scene director v6 |
| **Server** | Vite dev + API proxies (CORS-free NOAA/USGS/PDC), standalone Vite, Docker |
| **Sync point** | Upstream `423ca3ca` (PR #1485), **2,377 commits diverged**, +17,213 net lines |
| **License** | MIT |
| **Package metadata** | **Still claims upstream** (`bilawalsidhu/gods-eye-view`) |

**Strengths:** Working globe, live data pipelines, MCP server, voice agent, scene sharing, PWA, i18n (10 langs)
**Weaknesses:** 85% visual bloat, Cesium lock-in, no headless mode, sync debt, metadata misleading

---

### 2.2 `cv/` (upstream ClimateViewer 3D, sibling `../cv/`)

| Aspect | Detail |
|--------|--------|
| **Source** | `cv/dist/js/cv-layers-5.5.js` → generates `catalog.json` + `health.json` |
| **Layers** | 405 layers across Alerts, Weather, Satellites, Pollution, Surveillance, Geoengineering, Electromagnetic, MyReadingMapped, Other, Base Layer |
| **Families** | KML, GeoJSON, ArcGIS, WMS, GIBS, CartoDB, Bing, BaseLayer |
| **Format** | JSON catalog with `id`, `name`, `family`, `role`, `url`, `category[]`, `cvId`, `description`, `sourceUrl`, `sublayers[]`, `flags`, `traits`, `markerIcon` |
| **Health** | Probe results per layer (`health.json`) |
| **Build** | Custom pipeline → `cv-layers-*.js` |
| **Relationship** | **Source of truth** — `gev/` only consumes build output |

**Strengths:** Curated layer catalog, health monitoring, diverse sources (NOAA, USGS, PDC, EMSC, NASA GIBS, EUMETSAT, etc.)
**Weaknesses:** No runtime, no visualization, build pipeline opaque, external dependency

---

### 2.3 `spimedb` (`autonull/spimedb`)

| Aspect | Detail |
|--------|--------|
| **Language** | Java 9+ (Maven), JavaScript (jQuery, WorldWind) |
| **Core** | SpimeDB — n-dimensional ranged vector space, hyperdimensional locality |
| **Data model** | NObjects: JSON with `@` spacetime bounds (4D: lon, lat, alt, time), graph edges (S/D/U), tags, provenance |
| **Globe** | NASA WorldWind (JavaScript) — **not Cesium** |
| **Inputs** | Tika (HTML, XML, Office, PDF, EPUB, RTF, ZIP, Audio, Image, Video, Java class), JSON, RSS, KML/KMZ, GeoJSON |
| **Tools** | Search UI, Map 2D/3D UI, Timeline UI, Spacetime UI, JSON HTTP API, MsgPack WebSocket API |
| **CV Integration** | `data/climateviewer.json` — KML-heavy layer list (~200 entries), loads into SpimeDB via `ClimateViewer.java` |
| **Architecture** | P2P, real-time decentralized propagation, notification, analysis |
| **License** | AGPL-3.0 |
| **Last activity** | ~2024 (441 commits, 20 stars, 4 forks) |

**Strengths:** Unified spacetime data model, P2P, semantic search, multi-format ingestion, NObject spec
**Weaknesses:** Java stack, WorldWind (unmaintained), AGPL viral, KML-centric, no modern tooling, P2P complexity, no MCP, no voice

---

## 3. Detailed Option Analysis

### Option A: Continue `gev/` Fork

**Pros:**
- Works today — run `npm run dev`, get globe with CV layers
- MCP server functional for Claude/Codex
- Voice agent works (OpenAI + Gemini)
- Scene director, share links, PWA, i18n all functional
- Team knows the codebase

**Cons:**
- **Sync debt:** 2,377 commits diverged; every upstream refactor breaks merge
- **Visual bloat:** 85% of code is CRT/NVG/FLIR shaders, cockpit 3D models, detection mesh, sonar, bloom, starfield, HUD — burns GPU/battery
- **No headless mode:** Can't run analysis without browser + WebGL
- **Cesium lock-in:** 2MB WASM, WebGL required, no Node-only path
- **Metadata lies:** `package.json` still claims upstream repo/author
- **Tight coupling:** CV layers import GEV internals (`dataManager`, `mapStack`, `styleManager`, `viewer`)
- **Upstream direction:** Optimizes for YouTube demos, not analysis

**Verdict:** ❌ **Not sustainable** for mission-critical use. Technical debt compounds monthly.

---

### Option B: Extract CV from `gev/` → `cv-monorepo`

**Pros:**
- Reuses **proven CV layer implementations** (families, vector, imagery, health, packs, atlas)
- Reuses **`worldPacket.js`** → `analyst-query.js` (pure logic, high value)
- Reuses **`tools/mcp/`** → `mcp-server.js` (30+ tools, MCP stdio/HTTP)
- Reuses **`sync-cv-catalog.mjs`** → `cli/sync.js`
- TypeScript/Node stack — modern, team knows it
- MIT license — no viral concerns
- Incremental: Phase 1 (`cv-core`) delivers headless analysis in 2 weeks

**Cons:**
- **Cesium coupling in families:** `imagery.js` creates `Cesium.ImageryProvider`, `vector.js` uses `Cesium.GeoJsonDataSource`
- **Upstream CV drift:** `cv/` build output may change format; `sync.js` must adapt
- **No tile generation:** `cv/` builds tiles; `gev/` only consumes — need to replicate or mirror
- **Browser runtime optional:** `cv-runtime-browser` still needs Cesium for visualization

**Mitigation:**
- Adapter pattern: `LayerAdapter` interface (fetch-based) — Cesium only in `cv-runtime-browser`
- Pin `cv/` version in `sync.js`; version `catalog.json`
- Mirror `cv/dist/js/cv-layers-*.js` in `cv-core/catalog/`

**Verdict:** ✅ **Best balance** — maximum salvage, minimum risk, delivers headless MCP in weeks.

---

### Option C: Rebuild from SpimeDB

**Pros:**
- **Unified spacetime model** (NObjects) — elegant, hyperdimensional indexing
- **Semantic ingestion** — Tika handles 20+ formats (PDF, Office, Audio, Video)
- **P2P/decentralized** — aligns with "autonomy maximization" philosophy
- **Graph edges** (S/D/U) — rich relationship modeling
- **Existing CV layer list** in `data/climateviewer.json` (~200 KML layers)

**Cons:**
- **Java stack** — hiring, tooling, deployment complexity vs. TypeScript/Node
- **WorldWind is dead** — NASA archived it; no WebGL2, no modern Tiles support
- **AGPL-3.0** — viral, blocks commercial/proprietary use
- **KML-centric** — legacy format; modern pipelines use GeoJSON, Vector Tiles, COG, Zarr
- **No MCP, no voice, no scene director, no share links**
- **P2P complexity** — DHT, NAT traversal, conflict resolution — huge effort
- **No team Java expertise** — current stack is TypeScript
- **441 commits over years** — low velocity, abandoned feel

**Migration path if chosen:**
1. Replace Java core with TypeScript (Node/Rust) — rewrite SpimeDB spacetime index
2. Replace WorldWind with Cesium/MapLibre — rewrite globe
3. Replace KML ingestion with modern formats — rewrite parsers
4. Add MCP, voice, scene director — build from scratch
5. Relicense AGPL → MIT/Apache-2.0 — requires all contributors

**Verdict:** ❌ **Negative ROI** — rewriting SpimeDB in TypeScript *is* a greenfield rewrite (Option D) with extra baggage.

---

### Option D: Greenfield Rewrite

**Pros:**
- Clean architecture from day one
- Choose optimal stack: TypeScript, Cesium/MapLibre, DuckDB/Parquet, MCP-native
- No legacy coupling, no sync debt, no viral license
- Purpose-built for headless analysis + optional visualization

**Cons:**
- **Zero code reuse** — discard 405-layer catalog implementations, family parsers, health system, packs, atlas, MCP tools, worldPacket, sync script
- **2-3 months** to parity with Option B Phase 1+2
- **Re-inventing wheels:** KML/GeoJSON/ArcGIS/WMS/GIBS parsers, probe health, layer packs, analyst queries
- **Team opportunity cost** — 3 months not shipping features

**Verdict:** ❌ **Wasteful** — Option B salvages 80% of unique CV value in 25% of the time.

---

## 4. What Each Codebase Uniquely Contributes

| Capability | `gev/` | `cv/` | `spimedb` | Verdict |
|------------|--------|-------|-----------|---------|
| **405-layer catalog** | ✅ Consumes | ✅ **Source** | ⚠️ KML subset | Use `cv/` as source |
| **Family parsers (KML, GeoJSON, ArcGIS, WMS, GIBS, CartoDB, Bing)** | ✅ Implements | ❌ | ⚠️ KML only | Salvage from `gev/` |
| **Vector tile/GeoJSONL worker** | ✅ Implements | ❌ | ❌ | Salvage from `gev/` |
| **Health probes/audit** | ✅ Implements | ✅ Generates | ❌ | Salvage from `gev/` |
| **Layer packs/deep links/atlas** | ✅ Implements | ❌ | ❌ | Salvage from `gev/` |
| **Analyst queries (filter/rank/count)** | ✅ `worldPacket.js` | ❌ | ⚠️ NQuery draft | Salvage from `gev/` |
| **MCP server (30+ tools)** | ✅ Implements | ❌ | ❌ | Salvage from `gev/` |
| **Voice agent (OpenAI/Gemini)** | ✅ Implements | ❌ | ❌ | Optional — separate |
| **Spacetime data model** | ❌ | ❌ | ✅ **NObjects** | **Adopt concept** |
| **Semantic ingestion (Tika)** | ❌ | ❌ | ✅ 20+ formats | **Adopt concept** |
| **P2P/decentralized** | ❌ | ❌ | ✅ Design | Defer — not MVP |
| **Globe runtime (Cesium)** | ✅ Full | ❌ | ⚠️ WorldWind | Thin wrapper only |
| **Tile generation** | ❌ | ✅ Build pipeline | ❌ | Mirror from `cv/` |

**Key insight:** `gev/` has the **runtime implementations**; `cv/` has the **source catalog**; `spimedb` has the **spacetime data model**. The winning strategy: **Extract runtime from `gev/`, feed from `cv/`, adopt spacetime model from `spimedb`.**

---

## 5. Recommended Architecture: `cv-monorepo` with Spacetime Core

### 5.1 Package Structure

```
cv-monorepo/
├── packages/
│   ├── cv-core/                    # Core: catalog, families, query engine, spacetime
│   │   ├── src/
│   │   │   ├── catalog/            # catalog.json, health.json, types
│   │   │   ├── spacetime/          # NObject-inspired spacetime index
│   │   │   │   ├── index.ts        # 4D range query (lon, lat, alt, time)
│   │   │   │   ├── nobject.ts      # Spacetime entity with bounds, edges, tags
│   │   │   │   ├── grid.ts         # H3/S2 grid for hyperdimensional locality
│   │   │   │   ├── crdt.ts         # CRDT for P2P sync (Yjs/Automerge)
│   │   │   │   └── sync.ts         # P2P sync protocol (WebRTC + libp2p)
│   │   │   ├── families/           # KML, GeoJSON, ArcGIS, WMS, GIBS, CartoDB, Bing
│   │   │   ├── imagery.ts          # Fetch-based imagery interface
│   │   │   ├── vector.ts           # GeoJSONL parse, batched entities, analyst records
│   │   │   ├── health.ts           # Probe classification, status summaries
│   │   │   ├── healthAudit.ts      # Drift detection, health reports
│   │   │   ├── packs.ts            # Layer packs, deep links, atlas export
│   │   │   ├── atlasLinks.ts       # Cross-layer navigation
│   │   │   └── factory.ts          # createLayer(def, adapters)
│   │   ├── cli/
│   │   │   ├── sync.ts             # Pull from cv/ → generate catalog
│   │   │   ├── health-audit.ts     # Run probes, update health.json
│   │   │   └── ingest.ts           # Tika-style semantic ingestion
│   │   └── package.json
│   │
│   ├── cv-headless/                # MCP server, analyst CLI
│   │   ├── src/
│   │   │   ├── mcp-server.ts       # MCP stdio/HTTP (30+ tools)
│   │   │   ├── analyst-query.ts    # Filter/rank/count (from worldPacket)
│   │   │   ├── spacetime-query.ts  # 4D range + graph traversal
│   │   │   ├── providers/          # NOAA, USGS, PDC, EMSC, NASA, EUMETSAT
│   │   │   └── tile-cache.ts       # Disk cache (Parquet/COG)
│   │   ├── bin/cv-mcp
│   │   └── package.json
│   │
│   ├── cv-runtime-browser/         # PWA: offline-first visualization
│   │   ├── src/
│   │   │   ├── viewer.ts           # Minimal Cesium/MapLibre init
│   │   │   ├── atlas-panel.ts      # Tree UI (from climateViewerTree)
│   │   │   ├── share-codec.ts      # Minimal URL serialization
│   │   │   ├── pwa.ts              # Service worker, offline cache, background sync
│   │   │   ├── p2p.ts              # WebRTC/libp2p peer discovery & sync
│   │   │   └── indexedDB.ts        # Local spacetime index (Dexie.js)
│   │   └── package.json
│   │
│   ├── cv-p2p/                     # P2P networking layer (optional)
│   │   ├── src/
│   │   │   ├── discovery.ts        # mDNS + DHT peer discovery
│   │   │   ├── webrtc.ts           # WebRTC DataChannel mesh
│   │   │   ├── libp2p.ts           # libp2p/helia for NAT traversal, relay
│   │   │   ├── gossip.ts           # GossipSub for catalog/layer updates
│   │   │   ├── crdt.ts             # Yjs/Automerge for conflict-free sync
│   │   │   └── identity.ts         # Ed25519 keys, capability-based auth
│   │   └── package.json
│   │
│   └── cv-server/                  # Optional server-side spacetime DB
│       ├── src/
│       │   ├── api.ts              # REST + GraphQL + MCP HTTP
│       │   │   ├── spacetime/      # DuckDB + H3 index (authoritative)
│       │   │   ├── ingestion/      # Tika + scheduled provider polls
│       │   │   ├── tiles/          # COG/Parquet tile server (Cloudflare R2/S3)
│       │   │   ├── auth.ts         # OIDC + capability tokens (macaroons)
│       │   │   ├── multi-tenant.ts # Organizations, projects, RBAC
│       │   │   └── sync.ts         # P2P gateway (relay + persistence)
│       │   ├── worker/             # Background jobs (BullMQ/Redis)
│       │   │   ├── probe-health.ts
│       │   │   ├── ingest-scheduled.ts
│       │   │   └── tile-generation.ts
│       │   └── deploy/             # Docker, K8s, Fly.io, Railway
│       └── package.json
│
├── cv/ (submodule)                 # Upstream ClimateViewer 3D source
│   └── dist/js/cv-layers-*.js
│
├── package.json                    # Workspace (pnpm/turbo)
└── README.md
```

**Progressive Enhancement Model:**
```
cv-core (pure logic, no deps)
    │
    ├── cv-headless (Node, MCP, CLI)          ← Works standalone
    ├── cv-runtime-browser (PWA, offline)     ← Adds visualization + PWA
    │       │
    │       └── cv-p2p (WebRTC/libp2p)        ← Adds peer sync (optional)
    │
    └── cv-server (DuckDB, multi-tenant)      ← Adds authoritative sync (optional)
```

### 5.2 Spacetime Core (From SpimeDB, Modernized)

```typescript
// cv-core/src/spacetime/nobject.ts
interface NObject {
  id: string;                    // UUID/URL
  name?: string;
  tags: Map<string, number>;     // tag → strength (0-1)
  parents: string[];             // '<' super-tags
  children: string[];            // '>' sub-tags
  description: I18nString;
  authors: string[];             // URLs/emails
  created: number;               // Unix ms
  modified: number[];
  expires?: number;              // Unix ms, 0 = temporary
  privacy: ('private'|'anonymous'|'public')[];
  bounds: SpacetimeBounds;       // 4D: [lon, lat, alt, time] ranges
  edges: {
    incoming: Map<string, Map<string, number>>;  // predicate → sourceId → strength
    outgoing: Map<string, Map<string, number>>;  // predicate → targetId → strength
    undirected: Map<string, Map<string, number>>;
  };
  payload: Record<string, any>;  // Arbitrary data
}

// 4D range: [min, max] or point value
type SpacetimeBounds = [
  number | [number, number],  // longitude
  number | [number, number],  // latitude
  number | [number, number],  // altitude (meters)
  number | [number, number]   // time (Unix ms)
];
```

```typescript
// cv-core/src/spacetime/index.ts
class SpacetimeIndex {
  // H3/S2 grid for spatial, segment tree for temporal
  // Insert: O(log n), Query: O(log n + k)
  insert(object: NObject): void;
  query(bounds: SpacetimeBounds): NObject[];
  queryRadius(lon: number, lat: number, radiusKm: number, timeRange?: [number, number]): NObject[];
  queryGraph(startId: string, predicates: string[], depth: number): NObject[];
}
```

**Why this wins:** Unifies CV layers (each layer = NObject collection), enables "show me all layers overlapping this spacetime region", powers analyst queries without Cesium.

---

## 6. Migration Path (Option B + Spacetime Core + PWA/P2P/Server)

### Phase 1: `cv-core` (Weeks 1-2) — **Headless Analysis Ready**
- [ ] Copy `gev/src/layers/climateviewer/` → `packages/cv-core/src/`
- [ ] Replace Cesium deps with `LayerAdapter` interface (fetch-based)
- [ ] Convert `vector.js` worker → Node (no `self`/`postMessage`)
- [ ] Extract `health.js`, `healthAudit.js`, `packs.js`, `atlasLinks.js`
- [ ] Write `factory.ts` with adapter pattern
- [ ] Write `cli/sync.ts` to generate catalog from `cv/` build output
- [ ] **Add `spacetime/` package** — H3 grid + 4D range index + NObject types
- [ ] Publish `cv-core` locally

### Phase 2: `cv-headless` (Weeks 2-3) — **MCP + Analyst CLI Ready**
- [ ] Extract `worldPacket.js` → `analyst-query.ts` (pure, no viewer)
- [ ] Extract `tools/mcp/` → `mcp-server.ts` (stdio/HTTP, no Vite)
- [ ] Implement provider fetch wrappers (NOAA, USGS, PDC, EMSC, NASA, EUMETSAT)
- [ ] Add disk cache (Parquet for vector, COG for imagery)
- [ ] **Integrate spacetime index** — MCP tools use 4D range queries
- [ ] Test: `npx cv-mcp` works in Claude Desktop
- [ ] Test: `cv-analyst "fires near LA last 24h"` returns JSON

### Phase 3: `cv-runtime-browser` PWA (Week 3-4) — **Offline-First Visualization**
- [ ] Minimal Cesium/MapLibre viewer (`viewer.ts` ~200 lines)
- [ ] Atlas panel from `climateViewerTree.js` (strip GEV panel system)
- [ ] Share codec for layer state URLs
- [ ] **PWA: Service worker (Workbox), offline tile/cache strategy, background sync**
- [ ] **IndexedDB local spacetime index (Dexie.js) — mirrors cv-core spacetime**
- [ ] Test: Load CV layers offline, toggle, atlas navigation
- [ ] Test: `vite-plugin-pwa` generates installable PWA

### Phase 4: `cv-p2p` (Week 4-5) — **Peer-to-Peer Data Sharing (Optional)**
- [ ] **WebRTC DataChannel mesh** — direct browser-to-browser sync
- [ ] **libp2p/helia** — NAT traversal, relay, DHT discovery
- [ ] **GossipSub** — catalog/layer/update propagation
- [ ] **Yjs/Automerge CRDT** — conflict-free sync of layer state, annotations, shares
- [ ] **Ed25519 identity + capability tokens** — auth without central server
- [ ] Test: Two PWA instances sync layer toggles, annotations, share links P2P
- [ ] Test: Works behind NAT, falls back to relay

### Phase 5: `cv-server` (Week 5-6) — **Optional Server-Side Spacetime DB**
- [ ] **DuckDB + H3 index** — authoritative spacetime store (Parquet persistence)
- [ ] **REST + GraphQL + MCP HTTP** — API for `cv-runtime-browser` and `cv-headless`
- [ ] **Tika ingestion worker** — scheduled PDF/Office/HTML/Audio/Video → NObject
- [ ] **Provider poll workers** — NOAA/USGS/PDC/NASA scheduled ingestion
- [ ] **Tile server** — COG/Parquet tiles via Cloudflare R2 / S3 / local
- [ ] **OIDC + macaroons** — org/project RBAC, capability-based delegation
- [ ] **P2P gateway** — relay + persistence for offline peers
- [ ] **Multi-tenant** — organizations, projects, audit logs
- [ ] Deploy: Docker → Fly.io / Railway / K8s

### Phase 6: Semantic Ingestion (Week 6+) — **SpimeDB Parity**
- [ ] Add Tika-style ingestion (Apache Tika via REST or `tika-js`)
- [ ] Support PDF, Office, HTML, XML, Audio, Video → NObject extraction
- [ ] KML/KMZ/GeoJSON → NObject pipeline (already have parsers)
- [ ] Graph edge inference (co-location, temporal overlap, semantic similarity)

### Phase 7: Deprecate `gev/`
- [ ] Archive `gev/` repo
- [ ] Update CI, deployment, documentation
- [ ] Notify downstreams

---

## 7. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `cv/` upstream changes catalog format | Medium | High | Pin version in `sync.ts`; version `catalog.json`; mirror build output |
| Cesium API breaks browser runtime | Low | Medium | `cv-runtime-browser` optional; core works without it; MapLibre fallback |
| MCP protocol changes | Low | Medium | MCP stable at 1.0; version tools in `cv-headless` |
| `cv/` repo disappears | Low | High | Mirror `cv/dist/js/cv-layers-*.js` in `cv-core/catalog/` |
| Team lacks Spacetime index experience | Medium | Medium | Start simple (H3 + segment tree); iterate; H3 is well-documented |
| AGPL contamination from SpimeDB ideas | None | N/A | SpimeDB is AGPL but **ideas/architecture not code** — clean-room reimplement |

---

## 8. Decision Matrix (Final)

| Criterion | Weight | Option A (Continue Fork) | Option B (Extract) | Option C (SpimeDB) | Option D (Greenfield) |
|-----------|--------|--------------------------|---------------------|---------------------|------------------------|
| **Time to headless MCP** | 30% | 0 (already works but coupled) | **2 weeks** | 3-6 months | 2-3 months |
| **Code reuse (CV value)** | 25% | 100% (but buried) | **80%** | 20% (KML list only) | 0% |
| **Maintenance burden** | 20% | **High** (sync debt) | **Low** (independent) | High (Java + P2P) | Low |
| **Mission-critical fitness** | 15% | **Poor** (bloat, no headless) | **Excellent** | Poor (WorldWind, AGPL) | Excellent |
| **Team velocity** | 10% | Current | **High** (TS/Node) | Low (Java learning) | Medium |
| **License safety** | 5% | MIT | **MIT** | **AGPL-3.0 (viral)** | Choose MIT |
| **Total** | 100% | **35/100** | **92/100** | **45/100** | **65/100** |

---

## 9. Recommendation

**Choose Option B: Extract CV from `gev/` into `cv-monorepo` with Spacetime Core.**

### Why:
1. **Maximum salvage** — 13 high-value modules from `gev/`, catalog from `cv/`, spacetime model from `spimedb`
2. **Minimum risk** — TypeScript/Node stack, MIT license, no P2P complexity
3. **Fastest to value** — Headless MCP in 2 weeks, full analyst CLI in 3 weeks
4. **Future-proof** — Spacetime index enables "show me everything in this 4D region" queries that neither GEV nor SpimeDB fully deliver
5. **Clean break** — Archive `gev/`, stop sync debt, own the metadata

### What to Explicitly Adopt from SpimeDB:
- **NObject spacetime model** — 4D bounds, graph edges, tags, provenance
- **H3/S2 hyperdimensional indexing** — efficient spacetime range queries
- **Semantic ingestion concept** — Tika-style multi-format → NObject pipeline
- **Spacetime vector semantics** — ECEF + Unix time as internal representation

### What to Discard from SpimeDB:
- Java stack, WorldWind, AGPL, KML-centric parsers, P2P protocol, NQuery DSL

---

## 10. Next Steps

1. **Approve this direction** — Team consensus on Option B + Spacetime Core
2. **Create `cv-monorepo`** — `pnpm init -w`, add `cv-core`, `cv-headless`, `cv-runtime-browser`
3. **Mirror `cv/`** — Add as submodule or clone `cv/dist/js/cv-layers-*.js` to `cv-core/catalog/`
4. **Assign owners** — `cv-core` (1), `cv-headless` (1), `cv-runtime-browser` (optional, 1)
5. **Kick off Phase 1** — Target: `cv-mcp` working in Claude Desktop by [date + 2 weeks]

---

## Appendix: Key File References

### `gev/` (Salvage)
- `src/layers/climateviewer/` — Complete CV runtime
- `src/agent/worldPacket.js` → `analyst-query.ts`
- `src/tools/mcp/` → `mcp-server.ts`
- `scripts/sync-cv-catalog.mjs` → `cli/sync.ts`

### `cv/` (Source)
- `dist/js/cv-layers-5.5.js` → `catalog.json` + `health.json`
- Build pipeline (tile generation) — mirror or replicate

### `spimedb/` (Ideas)
- `media/src/main/java/spimedb/media/ClimateViewer.java` — KML ingestion pattern
- `data/climateviewer.json` — Layer list (subset of current CV)
- `README.md` — NObject spec, spacetime vector semantics
- `core/src/main/java/spimedb/util/geom/geodesic/` — Geodesic math (port to TS)

---

## 11. Option E: Engage GEV Upstream Developer(s)

**Contact Bilawal Sidhu / `bilawalsidhu/gods-eye-view` maintainers** to discuss:

### Why This Could Work
- **Shared pain point:** Upstream also suffers from visual bloat (they know it)
- **CV is their most requested feature** — users want ClimateViewer layers in GEV
- **MCP/voice is their differentiator** — they're investing heavily here
- **They have resources** — YouTube revenue, sponsorships, team

### What to Propose
1. **Upstream adopts `cv-core` as a library** — GEV becomes a thin consumer
2. **Joint stewardship of `cv/` catalog** — Single source of truth, shared maintenance
3. **Co-develop spacetime index** — Benefits both: GEV gets "show me everything here", CV gets headless queries
4. **PWA/P2P as shared roadmap** — Offline-first + peer sync = resilience for both

### Risks
- **Different priorities:** They optimize for demos/YouTube; you optimize for analysis
- **Control:** They own the repo, roadmap, releases
- **License:** Still MIT (good), but they control direction
- **Timeline:** Their release cycle may not match yours

### Decision Framework
| If upstream says... | Then... |
|---------------------|---------|
| "Yes, let's extract `cv-core` together" | **Best outcome** — shared maintenance, upstream gets CV layers, you get headless |
| "No, we like our visual bloat" | Proceed with Option B independently |
| "Maybe, but not now" | Proceed independently; keep door open |

### Action
- Open GitHub Discussion on `bilawalsidhu/gods-eye-view` with this proposal
- Reference this document (`README.CV.md` + `DECISION.md`)
- Offer to do the extraction work (you have the fork, you know the code)
- Set 2-week response deadline; if no alignment, proceed with Option B

---

**Decision deadline:** [Date]
**Owner:** [Name]
**Reviewers:** [Names]