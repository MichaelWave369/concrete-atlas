# Concrete Atlas Architecture v0.1.0

## Flow

```text
OpenStreetMap
    │
    ▼
Periodic Overpass refresh
(state-by-state)
    │
    ▼
Normalizer + provenance fields
    │
    ▼
data/skateparks.geojson
    │
    ├──────────────► validation
    │
    ▼
Static Netlify site
    │
    ▼
MapLibre + OpenFreeMap
    │
    ├─ clustering
    ├─ search
    ├─ filters
    └─ park detail/provenance
```

## Deliberate boundaries

1. Public Overpass is an ingestion source, not the production request backend.
2. `osm_seeded` is not equivalent to `community_verified`.
3. Raw OSM tags are preserved for future reclassification.
4. OSM IDs are stable source identities but are not the final canonical Concrete Atlas park IDs.
5. Road Trip Mode is held for v0.2 so v0.1 can stabilize park identity, search, and data quality first.
