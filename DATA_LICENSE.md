# Concrete Atlas Data Licensing

Concrete Atlas separates the license for its software from the licenses that apply to geographic and community-contributed data.

## Application code

The Concrete Atlas application code and project-owned software are licensed under the MIT License. See [`LICENSE`](./LICENSE).

## OpenStreetMap-derived data

Records derived from OpenStreetMap are © OpenStreetMap contributors and are available under the Open Database License (ODbL) 1.0.

Concrete Atlas preserves source identifiers and provenance fields so that OSM-derived records remain traceable to their source. Any redistribution or use of an OSM-derived database must comply with the applicable ODbL attribution and share-alike requirements.

The generated `data/skateparks.geojson` snapshot may contain OSM-derived database content and therefore must **not** be treated as MIT-licensed merely because it is stored in this repository.

## Basemap

The default application uses MapLibre GL JS with an OpenFreeMap basemap. Provider attribution and terms remain applicable independently of the MIT license for Concrete Atlas software.

## Future community content

Photos, descriptions, verification receipts, and other user-submitted content should have explicit contribution terms before those features accept public submissions. Do not assume that future community media is MIT-licensed or ODbL-licensed.

## Project principle

**Source is not verification.** A source record and a real-world community verification are separate claims and should remain separately attributable.
