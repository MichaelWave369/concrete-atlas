import { readFile } from 'node:fs/promises';

const path = new URL('../data/skateparks.geojson', import.meta.url);
const parsed = JSON.parse(await readFile(path, 'utf8'));
if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
  throw new Error('data/skateparks.geojson is not a valid FeatureCollection');
}
const ids = new Set();
for (const [index, feature] of parsed.features.entries()) {
  if (feature?.type !== 'Feature' || feature?.geometry?.type !== 'Point') {
    throw new Error(`Feature ${index} is not a Point feature`);
  }
  const [lng, lat] = feature.geometry.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    throw new Error(`Feature ${index} has invalid coordinates`);
  }
  if (!feature.properties?.source_id) throw new Error(`Feature ${index} has no source_id`);
  if (ids.has(feature.properties.source_id)) throw new Error(`Duplicate source_id at feature ${index}: ${feature.properties.source_id}`);
  ids.add(feature.properties.source_id);
}
if (parsed.metadata?.feature_count != null && parsed.metadata.feature_count !== parsed.features.length) {
  throw new Error(`metadata.feature_count (${parsed.metadata.feature_count}) does not match features.length (${parsed.features.length})`);
}
console.log(`Validated ${parsed.features.length} skatepark features.`);
