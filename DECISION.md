# ClimateViewer — Architecture Decision Report

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
│   │   │   │   ├── crdt.ts         # **NEW: CRDT for P2P sync (Yjs/Automerge)**
│   │   │   │   └── sync.ts         # **NEW: P2P sync protocol (WebRTC + libp2p)**
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
│   │   │   ├── p2p.ts              # **NEW: WebRTC/libp2p peer discovery & sync**
│   │   │   └── indexedDB.ts        # **NEW: Local spacetime index (Dexie.js)**
│   │   └── package.json
│   │
│   ├── cv-p2p/                     # **NEW: P2P networking layer (optional)**
│   │   ├── src/
│   │   │   ├── discovery.ts        # mDNS + DHT peer discovery
│   │   │   ├── webrtc.ts           # WebRTC DataChannel mesh
│   │   │   ├── libp2p.ts           # libp2p/helia for NAT traversal, relay
│   │   │   ├── gossip.ts           # GossipSub for catalog/layer updates
│   │   │   ├── crdt.ts             # Yjs/Automerge for conflict-free sync
│   │   │   └── identity.ts         # Ed25519 keys, capability-based auth
│   │   └── package.json
│   │
│   └── cv-server/                  # **NEW: Optional server-side spacetime DB**
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

**Decision deadline:** [Date]
**Owner:** [Name]
**Reviewers:** [Names]