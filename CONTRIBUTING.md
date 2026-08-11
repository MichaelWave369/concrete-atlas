# Contributing to Concrete Atlas

Thanks for helping build a better map of places to skate.

## Good contributions for v0.1

- Fix a missing or incorrectly classified skatepark.
- Improve search, filters, accessibility, or mobile behavior.
- Improve OSM ingestion and deduplication without losing provenance.
- Add tests or validation for the GeoJSON contract.
- Improve documentation and licensing clarity.

## Data corrections

Whenever possible, correct OpenStreetMap at the source and include the OSM object URL in the issue or pull request. Concrete Atlas should avoid silently diverging from source data when a source correction is appropriate.

A mapped source record is not the same thing as a community verification. Do not change `verification_status` to `community_verified` without a future verification receipt mechanism that records who/what verified the claim and when.

## Development

Requirements: Node.js 20+.

```bash
npm run validate:data
npm run serve
```

To rebuild the nationwide OSM snapshot:

```bash
npm run refresh:data
npm run validate:data
```

## Licensing

By contributing software code to this repository, you agree that your contribution may be distributed under the project's MIT License. Data derived from OpenStreetMap remains subject to the ODbL; see `DATA_LICENSE.md`.
