# Concrete Atlas v0.2.0-alpha.1

**The living map of American skateboarding.**

**Live atlas:** https://michaelwave369.github.io/concrete-atlas/

Public, open-source, and provenance-aware: the application software is MIT-licensed, while OpenStreetMap-derived database content remains subject to the ODbL. See [`LICENSE`](./LICENSE) and [`DATA_LICENSE.md`](./DATA_LICENSE.md).

Concrete Atlas is a static-first interactive U.S. skatepark atlas. It uses MapLibre GL JS for the map, OpenFreeMap for the basemap, and OpenStreetMap/Overpass as the initial nationwide data seed.

## Current capabilities

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
- Deterministic Data Quality Observatory report
- Header receipts for named coverage, surface coverage, and failed-state count
- Conservative Park Intelligence evidence extraction from stored raw OSM tags
- Static GeoJSON snapshot suitable for GitHub Pages and Netlify
- GitHub CI and twice-monthly/manual dataset refresh
- Independent quality-report publication when canonical data changes
- Automatic GitHub Pages deployment from `main` when the public app or canonical data changes

## First run

Requirements: Node.js 20+ and internet access.

```bash
npm run refresh:data
npm run enrich:intelligence
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

High-confidence examples include explicit `leisure=skate_park` / `leisure=skatepark` records and `sport=skateboard` objects combined with physical recreation tags. Medium-confidence candidates include skateboard-tagged objects whose names identify a skatepark or skate plaza plus other non-commercial skateboard-facility records.

Objects tagged as `shop`, `office`, or `craft` are excluded unless they also carry a physical skatepark/recreation signal. Every accepted record stores `candidate_kind`, `candidate_confidence`, `candidate_reason`, `matched_by`, and raw OSM tags.

The classifier is deliberately conservative and versioned so future governance passes can improve it without erasing provenance.

## Park Intelligence alpha

`npm run enrich:intelligence` derives a conservative evidence layer from raw OSM tags already stored on each source feature. It does not infer terrain from names, descriptions, photos, or nearby map context.

The current alpha records explicit equipment signals, broad terrain families only when directly supported by recognized equipment tags, direct amenity tags, and activity-access tags. Unmapped or absent evidence remains unknown rather than being promoted into a claim.

The first nationwide measurement showed that detailed Park Intelligence evidence in raw OSM is sparse. That result is being treated as a signal to prioritize community evidence and verification receipts rather than manufacture nationwide terrain metadata.

## Data Quality Observatory

`npm run report:data` deterministically derives `data/quality-report.json` from the canonical GeoJSON snapshot.

The report measures dataset health as separate, auditable dimensions rather than collapsing unrelated facts into one score. It includes:

- total source candidates and quarantined non-facility candidates
- name, surface, lighting, hours, indoor, address, operator, website, and access coverage
- classifier coverage and confidence distribution
- verification-state distribution
- candidate counts by state/DC
- primary source freshness statistics
- supplemental-source availability
- failed primary states and retained fallback counts

These are **metadata and provenance measurements**, not ratings of park quality, safety, legality, accessibility, or current skateability.

The browser loads the report independently through `assets/quality.js`; if the report is absent or malformed, the map itself continues to function.

## Refresh architecture

The nationwide OSM crawl is intentionally schedule/manual only. It runs finite state chunks with serialized public-Overpass access, rate-limit backoff, source-freshness validation, deterministic merging, Park Intelligence enrichment, validation, and failed-state retention.

Quality-report generation is a separate lightweight workflow. A changed canonical `data/skateparks.geojson` automatically regenerates `data/quality-report.json` without launching another nationwide crawl.

GitHub Pages deployment is also independent. Changes to the public app or canonical data publish a minimal runtime artifact containing only `index.html`, `assets/`, and the canonical data files.

## OSM query policy

The canonical primary pass queries each state + D.C. for `sport` values containing `skateboard`. A primary-query failure is a real state refresh failure.

Optional non-blocking enrichment additionally queries explicit `leisure=skate_park` and `leisure=skatepark` records. If enrichment is unavailable or rate-limited, the primary dataset remains usable and the enrichment failure is recorded instead of failing the state.

## Source freshness receipts

A successful endpoint response records its reported OSM base timestamp, areas timestamp when available, endpoint URL, source lag, and element count. Responses older than the configured freshness policy are rejected and the importer tries the next endpoint.

The nationwide snapshot contains per-state source receipts so mixed-source refreshes are visible and auditable.

## Partial refresh behavior

If a primary state query fails, Concrete Atlas retains that state's last known records rather than deleting the state from the atlas. Failed states and retained-record counts are written into metadata.

## Production scaling path

As Concrete Atlas grows, ingestion should graduate to one of:

- self-hosted Overpass
- regional/planet OSM extracts processed offline
- a dedicated OSM feature service
- PostGIS + scheduled import pipeline
- PMTiles/vector tiles for large front-end datasets

## Next v0.2 work

- immutable community evidence receipts
- deterministic community verification reducer
- conflict / closure / staleness handling
- rider-submitted corrections and observations
- community-backed terrain and amenity evidence
- photos
- favorites / visited parks
- Road Trip Mode and route-corridor park search
- confidence scoring informed by source + community evidence

## Attribution and licensing

Concrete Atlas software is released under the MIT License. OpenStreetMap-derived database content is © OpenStreetMap contributors and remains subject to the Open Database License (ODbL). The generated `data/skateparks.geojson` must not be treated as MIT-licensed merely because it is stored beside the software. See [`DATA_LICENSE.md`](./DATA_LICENSE.md) for the project boundary.
