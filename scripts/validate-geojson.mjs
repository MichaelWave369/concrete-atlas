import { readFile } from 'node:fs/promises';

const path = new URL('../data/skateparks.geojson', import.meta.url);
const parsed = JSON.parse(await readFile(path, 'utf8'));
if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
  throw new Error('data/skateparks.geojson is not a valid FeatureCollection');
}

const classifiedSnapshot = parsed.metadata?.version === '0.1.2';
if (classifiedSnapshot && !parsed.metadata?.classifier?.version) {
  throw new Error('v0.1.2 snapshot is missing classifier metadata');
}

const ids = new Set();
const allowedConfidence = new Set(['high', 'medium_high', 'medium']);
for (const [index, feature] of parsed.features.entries()) {
  if (feature?.type !== 'Feature' || feature?.geometry?.type !== 'Point') {
    throw new Error(`Feature ${index} is not a Point feature`);
  }
  const [lng, lat] = feature.geometry.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    throw new Error(`Feature ${index} has invalid coordinates`);
  }
  const p = feature.properties || {};
  if (!p.source_id) throw new Error(`Feature ${index} has no source_id`);
  if (ids.has(p.source_id)) throw new Error(`Duplicate source_id at feature ${index}: ${p.source_id}`);
  ids.add(p.source_id);

  if (classifiedSnapshot) {
    if (!p.candidate_kind) throw new Error(`Feature ${index} has no candidate_kind`);
    if (!allowedConfidence.has(p.candidate_confidence)) {
      throw new Error(`Feature ${index} has invalid candidate_confidence: ${p.candidate_confidence}`);
    }
    if (!p.candidate_reason) throw new Error(`Feature ${index} has no candidate_reason`);
    if (!Array.isArray(p.matched_by) || !p.matched_by.length) {
      throw new Error(`Feature ${index} has no matched_by provenance`);
    }
  }
}

if (parsed.metadata?.feature_count != null && parsed.metadata.feature_count !== parsed.features.length) {
  throw new Error(`metadata.feature_count (${parsed.metadata.feature_count}) does not match features.length (${parsed.features.length})`);
}

if (Array.isArray(parsed.metadata?.requested_states)) {
  const uniqueStates = new Set(parsed.metadata.requested_states);
  if (uniqueStates.size !== parsed.metadata.requested_states.length) {
    throw new Error('metadata.requested_states contains duplicates');
  }
}

console.log(`Validated ${parsed.features.length} ${classifiedSnapshot ? 'classified skate-location candidates' : 'skatepark features'}.`);
