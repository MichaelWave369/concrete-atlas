# Concrete Atlas v0.1.1

**The living map of American skateboarding.**

Public, open-source, and provenance-aware: the application software is MIT-licensed, while OpenStreetMap-derived database content remains subject to the ODbL. See [`LICENSE`](./LICENSE) and [`DATA_LICENSE.md`](./DATA_LICENSE.md).

Concrete Atlas is a static-first interactive U.S. skatepark atlas. It uses MapLibre GL JS for the map, OpenFreeMap for the basemap, and OpenStreetMap/Overpass as the initial nationwide data seed.

## v0.1.1 capabilities

- U.S.-wide interactive map shell
- MapLibre point clustering
- Search by park/city/operator
- State, surface, indoor/outdoor, and verification filters
- Park detail drawer with provenance
- Find Near Me with distance-sorted nearby park results
- Viewport-aware sidebar results
- Shareable park hash URLs
- OSM object ID + source URL retained for every imported record
- State-by-state nationwide OSM ingestion
- Freshness-governed Overpass endpoint fallback
- Per-state source receipts with OSM base timestamp and endpoint provenance
- Static GeoJSON snapshot suitable for Netlify
- Optional single-state live Overpass query for development
- Verification field separated from source ingestion
- GitHub Action for manual or twice-monthly snapshot refresh
- Partial refreshes retain prior state data instead of silently dropping it
- Validator rejects duplicate source IDs and feature-count drift

## Why the importer is state-by-state

Concrete Atlas does **not** use public Overpass as a high-traffic production backend. The refresh workflow makes a finite set of state-level queries, runs at most two chunk workers at once, and stores the result as a static GeoJSON snapshot. This keeps visitor traffic off shared Overpass infrastructure and gives the project an auditable state-by-state coverage record.

## First run

Requirements: Node.js 20+ and internet access.

```bash
npm run refresh:data
npm run validate:data
npm run serve
```

Then open `http://localhost:4173`.

If you only want to inspect the UI first, run `npm run serve`, choose a state, and use **Load selected state live**. Live mode depends on public Overpass availability and is not the recommended production data path.

## Netlify

This project is intentionally static. `netlify.toml` publishes the repository root and does not require a framework build.

Recommended release flow:

1. Refresh the nationwide snapshot with the GitHub Action or `npm run refresh:data`.
2. Run `npm run validate:data`.
3. Commit `data/skateparks.geojson`.
4. Deploy the repository to Netlify.

Data ingestion is kept separate from normal visitor requests and front-end rendering.

## Data model

Every feature keeps a `source_id` such as `osm:way/1234567`, plus:

- source / source state
- OSM object type and ID
- OSM URL
- source match tags
- name and address tags
- surface
- indoor / lit / covered
- access / fee / opening hours
- operator / website / phone when mapped
- OSM object version and timestamp
- ingest timestamp
- `verification_status`
- raw source tags

The initial status is `osm_seeded`. Future community verification should promote a park to a distinct status rather than overwriting source history.

## OSM query policy

The canonical primary pass queries each state + D.C. for `sport` values containing `skateboard`. That primary pass is what determines whether a state refresh succeeded.

Optional enrichment can additionally query:

- `leisure=skate_park`
- `leisure=skatepark`

Supplemental enrichment is deliberately non-blocking. If an enrichment query is unavailable or rate-limited, the primary skateboarding dataset remains valid and the enrichment failure is recorded instead of failing the state.

## Source freshness receipts

A successful endpoint response records its reported OSM base timestamp, areas timestamp when available, endpoint URL, source lag, and element count. Responses older than the configured freshness policy are rejected and the importer tries the next endpoint.

The generated snapshot includes per-state source receipts in metadata. This makes mixed-source refreshes visible instead of silently treating every endpoint response as equivalent.

## Partial refresh behavior

If a primary state-level query fails during a later refresh, Concrete Atlas retains that state's last known snapshot records instead of deleting them. The failed state and number of retained records are written into snapshot metadata so partial coverage stays visible and auditable.

## Production scaling path

Public Overpass is appropriate for periodic seed/refresh work, not as the backend for a popular consumer application. As Concrete Atlas grows, move ingestion to one of:

- self-hosted Overpass
- regional/planet OSM extracts processed offline
- a dedicated OSM feature service
- PostGIS + scheduled import pipeline

The front-end contract can stay GeoJSON initially and later graduate to vector tiles/PMTiles without redesigning park identities.

## Planned v0.2

- canonical park deduplication layer
- terrain taxonomy: street / bowl / transition / vert / flow / pump
- amenity taxonomy
- rider-submitted corrections
- verification receipts + history
- photos
- favorites / visited parks
- Road Trip Mode
- route corridor park search
- park construction / closure status
- confidence scoring

## Attribution and licensing

Concrete Atlas software is released under the MIT License. OpenStreetMap-derived database content is © OpenStreetMap contributors and remains subject to the Open Database License (ODbL). The generated `data/skateparks.geojson` must not be treated as MIT-licensed merely because it is stored beside the software. Concrete Atlas also uses OpenFreeMap tiles/style infrastructure in the default UI. See [`DATA_LICENSE.md`](./DATA_LICENSE.md) for the project boundary.

## Important product principle

**Source is not verification.** An OSM record proves that a mapped object exists in the source dataset; it does not prove that the facility is currently open, skateable, safe, publicly accessible, or accurately classified. Concrete Atlas keeps those claims separate by design.
