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
- OSM object ID + source URL retained for every imported record
- State-by-state nationwide OSM ingestion
- Two Overpass endpoint fallback strategy
- Static GeoJSON snapshot suitable for Netlify
- Optional single-state live Overpass query for development
- Verification field separated from source ingestion
- GitHub Action for manual or twice-monthly snapshot refresh
- Find Near Me with distance-sorted nearby park list
- Viewport-aware sidebar results
- Shareable park hash URLs
- Partial refreshes retain prior state data instead of silently dropping it
- Validator rejects duplicate source IDs and feature-count drift

## Why the importer is state-by-state

Concrete Atlas does **not** use public Overpass as a high-traffic production backend. The refresh script makes a small, finite set of state-level queries and stores the results as a static GeoJSON snapshot. This is friendlier to shared public infrastructure and makes the site faster and more reliable for visitors.

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

1. Run `npm run refresh:data` locally.
2. Run `npm run validate:data`.
3. Commit the generated `data/skateparks.geojson`.
4. Deploy the repository to Netlify.

That keeps data ingestion out of the Netlify build and avoids spending deploy/build resources just to test OSM queries.

## Data model

Every feature keeps a `source_id` such as `osm:way/1234567`, plus:

- source / source state
- OSM object type and ID
- OSM URL
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

## OSM query coverage

For each state + D.C., the importer queries objects that match either:

- `leisure=skate_park`
- `sport` containing `skateboard`

This intentionally favors recall over perfect classification. Later governance passes can separate skateparks, plazas, indoor facilities, DIY parks, mixed-use wheel parks, and probable false positives.

## Partial refresh behavior

If a state-level query fails during a later refresh, Concrete Atlas retains that state's last known snapshot records instead of deleting them. The failed state and number of retained records are written into snapshot metadata so partial coverage stays visible and auditable.

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
