import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] || 'partials';
const output = process.argv[3] || 'data/skateparks.geojson';

async function jsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.geojson')) files.push(path);
  }
  return files;
}

const files = (await jsonFiles(root)).sort();
if (!files.length) throw new Error(`No GeoJSON chunk files found beneath ${root}`);

const byId = new Map();
const failedStates = [];
const stateSources = [];
const requestedStates = new Set();
const freshnessPolicies = new Set();
const versions = new Set();
const queryTags = new Set();
const supplementalSettings = new Set();
const classifierPolicies = new Map();
let excludedNonFacilityCount = 0;
let retainedFailedStateFeatures = 0;
let newestGeneratedAt = null;

for (const file of files) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`${file} is not a FeatureCollection`);

  if (data.metadata?.version) versions.add(String(data.metadata.version));
  for (const state of data.metadata?.requested_states || []) requestedStates.add(state);
  for (const failure of data.metadata?.failed_states || []) failedStates.push(failure);
  for (const receipt of data.metadata?.state_sources || []) stateSources.push(receipt);
  for (const tag of data.metadata?.query_tags || []) queryTags.add(tag);
  if (data.metadata?.source_freshness_policy_hours != null) freshnessPolicies.add(data.metadata.source_freshness_policy_hours);
  if (data.metadata?.supplemental_enabled != null) supplementalSettings.add(Boolean(data.metadata.supplemental_enabled));
  if (data.metadata?.classifier) {
    const fingerprint = JSON.stringify(data.metadata.classifier);
    classifierPolicies.set(fingerprint, data.metadata.classifier);
  }
  excludedNonFacilityCount += Number(data.metadata?.excluded_non_facility_count || 0);
  retainedFailedStateFeatures += Number(data.metadata?.retained_failed_state_features || 0);

  if (data.metadata?.generated_at && (!newestGeneratedAt || data.metadata.generated_at > newestGeneratedAt)) {
    newestGeneratedAt = data.metadata.generated_at;
  }

  for (const feature of data.features) {
    const id = feature?.properties?.source_id;
    if (!id) throw new Error(`${file} contains a feature with no source_id`);
    const current = byId.get(id);
    if (!current || String(feature.properties?.osm_timestamp || '') >= String(current.properties?.osm_timestamp || '')) {
      byId.set(id, feature);
    }
  }
}

if (versions.size > 1) throw new Error(`Chunk version mismatch: ${[...versions].sort().join(', ')}`);
if (classifierPolicies.size > 1) throw new Error('Classifier policy mismatch across chunks');
if (supplementalSettings.size > 1) throw new Error('Supplemental-query policy mismatch across chunks');

const features = [...byId.values()].sort((a, b) =>
  (a.properties?.name || '').localeCompare(b.properties?.name || '') ||
  a.properties.source_id.localeCompare(b.properties.source_id)
);

const failuresByState = new Map();
for (const failure of failedStates) failuresByState.set(failure.state, failure);
const sourcesByState = new Map();
for (const receipt of stateSources) sourcesByState.set(receipt.state, receipt);

const metadata = {
  project: 'Concrete Atlas',
  version: [...versions][0] || '0.1.2',
  generated_at: newestGeneratedAt || new Date().toISOString(),
  source: 'OpenStreetMap via Overpass API',
  coverage: '50 U.S. states plus District of Columbia',
  requested_states: [...requestedStates].sort(),
  feature_count: features.length,
  failed_states: [...failuresByState.values()].sort((a, b) => a.state.localeCompare(b.state)),
  state_sources: [...sourcesByState.values()].sort((a, b) => a.state.localeCompare(b.state)),
  source_freshness_policy_hours: freshnessPolicies.size === 1 ? [...freshnessPolicies][0] : [...freshnessPolicies].sort((a, b) => a - b),
  supplemental_enabled: supplementalSettings.size ? [...supplementalSettings][0] : null,
  excluded_non_facility_count: excludedNonFacilityCount,
  retained_failed_state_features: retainedFailedStateFeatures,
  query_tags: [...queryTags].sort(),
  classifier: classifierPolicies.size ? [...classifierPolicies.values()][0] : null,
  merge: { chunk_count: files.length, deduplicated_by: 'source_id' }
};

const collection = { type: 'FeatureCollection', metadata, features };

await writeFile(output, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log(`Merged ${files.length} chunks into ${features.length} unique skatepark candidates.`);
console.log(`Coverage: ${requestedStates.size} state/DC codes; failures: ${failuresByState.size}; source receipts: ${sourcesByState.size}; excluded non-facility candidates: ${excludedNonFacilityCount}.`);
