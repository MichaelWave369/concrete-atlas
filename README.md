# Concrete Atlas v0.1.3

**The living map of American skateboarding.**

Public, open-source, and provenance-aware: the application software is MIT-licensed, while OpenStreetMap-derived database content remains subject to the ODbL. See [`LICENSE`](./LICENSE) and [`DATA_LICENSE.md`](./DATA_LICENSE.md).

Concrete Atlas is a static-first interactive U.S. skatepark atlas. It uses MapLibre GL JS for the map, OpenFreeMap for the basemap, and OpenStreetMap/Overpass as the initial nationwide data seed.

## v0.1.3 capabilities

- U.S.-wide interactive map shell and clustering
- Search by park/city/operator
- State, surface, indoor/outdoor, and verification filters
- Find Near Me with distance-sorted nearby results
- Viewport-aware sidebar results
- Shareable park hash URLs
- Park detail drawer with OSM provenance
- Freshness-governed state-by-state OSM ingestion
- Per-state source receipts with OSM base timestamp and endpoint provenance
- Failed-state retention instead of silent deletion
- Candidate classification before publication
- Obvious commercial records quarantined unless they also carry physical skatepark tags
- Explicit `candidate_kind`, `candidate_confidence`, and `candidate_reason`
- Short non-blocking enrichment for explicit skatepark leisure tags
- Static GeoJSON snapshot suitable for Netlify
- GitHub CI and twice-monthly/manual dataset refresh
- Deterministic **Data Quality Observatory** report generated with every nationwide refresh

## First run

Requirements: Node.js 20+ and internet access.

```bash
npm run refresh:data
npm run validate:data
npm run report:data
npm run serve
```

Then open `http://localhost:4173`.

## Data philosophy

**Source is not verification.** OSM tells Concrete Atlas that a source record exists; it does not prove the place is currently open, safe, publicly accessible, correctly classified, or recently inspected by a skater.

The initial verification state is `osm_seeded`. Community evidence must promote a record separately rather than overwriting source history.

## Candidate classification

The importer intentionally separates source discovery from publication classification.

High-confidence examples include:

- explicit `leisure=skate_park` or `leisure=skatepark`
- `sport=skateboard` combined with a physical recreation tag such as `leisure=pitch` or `leisure=sports_centre`

Medium-confidence candidates include skateboard-tagged objects whose names identify a skatepark or skate plaza, plus other skateboard-facility records that are not obviously commercial.

Objects tagged as `shop`, `office`, or `craft` are excluded unless they also carry a physical skatepark/recreation signal. This prevents skate shops and similar businesses from silently becoming “parks” just because OSM associates them with skateboarding.

Every accepted record stores:

- `candidate_kind`
- `candidate_confidence`
- `candidate_reason`
- `matched_by`
- raw OSM tags

This classifier is deliberately conservative and versioned so future governance passes can improve it without erasing provenance.

## Data Quality Observatory

Every completed nationwide refresh generates [`data/quality-report.json`](./data/quality-report.json). It reports measurable dataset health without collapsing everything into a made-up single score.

The report includes:

- total source candidates and quarantined non-facility candidates
- named-record coverage
- classifier coverage and confidence distribution
- known surface, concrete, lights, hours, indoor, address, operator, website, and access coverage
- state-by-state candidate counts
- community-verification coverage
- fresh source receipt count
- primary source-lag statistics
- supplemental-enrichment successes and misses
- failed primary states and retained fallback counts

The report describes the database, **not** whether a real-world park is open, safe, legal to access, or currently skateable.

## OSM query policy

The canonical primary pass queries each state + D.C. for `sport` values containing `skateboard`. A primary-query failure is a real state refresh failure.

A short non-blocking enrichment pass additionally queries:

- `leisure=skate_park`
- `leisure=skatepark`

If enrichment is unavailable or rate-limited, the primary dataset remains usable and previously classified leisure-only candidates can be retained until a later enrichment succeeds.

## Source freshness receipts

A successful endpoint response records its reported OSM base timestamp, areas timestamp when available, endpoint URL, source lag, and element count. Responses older than the configured freshness policy are rejected and the importer tries the next endpoint.

The nationwide snapshot contains per-state source receipts so mixed-source refreshes are visible and auditable.

## Partial refresh behavior

If a primary state query fails, Concrete Atlas retains that state's last known **reclassified** records rather than deleting the state from the atlas. Failed states and retained-record counts are written into metadata.

## Why refreshes are bounded

Concrete Atlas does **not** use public Overpass as the visitor-facing backend. The scheduled refresh uses finite state chunks with serialized public-API work, explicit rate-limit backoff, validation, deterministic merging, and a static GeoJSON snapshot for visitors.

## Production scaling path

As Concrete Atlas grows, ingestion should graduate to one of:

- self-hosted Overpass
- regional/planet OSM extracts processed offline
- a dedicated OSM feature service
- PostGIS + scheduled import pipeline
- PMTiles/vector tiles for large front-end datasets

## Planned v0.2

- stronger canonical deduplication
- terrain taxonomy: street / bowl / transition / vert / flow / pump
- amenity taxonomy
- rider-submitted corrections
- verification receipts + history
- closure / construction / damage status
- photos
- favorites / visited parks
- Road Trip Mode and route-corridor park search
- confidence scoring informed by source + community evidence

## Attribution and licensing

Concrete Atlas software is released under the MIT License. OpenStreetMap-derived database content is © OpenStreetMap contributors and remains subject to the Open Database License (ODbL). The generated `data/skateparks.geojson` must not be treated as MIT-licensed merely because it is stored beside the software. See [`DATA_LICENSE.md`](./DATA_LICENSE.md) for the project boundary.
