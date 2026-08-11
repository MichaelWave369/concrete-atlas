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
let newestGeneratedAt = null;
for (const file of files) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`${file} is not a FeatureCollection`);
  for (const state of data.metadata?.requested_states || []) requestedStates.add(state);
  for (const failure of data.metadata?.failed_states || []) failedStates.push(failure);
  for (const receipt of data.metadata?.state_sources || []) stateSources.push(receipt);
  if (data.metadata?.source_freshness_policy_hours != null) freshnessPolicies.add(data.metadata.source_freshness_policy_hours);
  if (data.metadata?.generated_at && (!newestGeneratedAt || data.metadata.generated_at > newestGeneratedAt)) newestGeneratedAt = data.metadata.generated_at;
  for (const feature of data.features) {
    const id = feature?.properties?.source_id;
    if (!id) throw new Error(`${file} contains a feature with no source_id`);
    const current = byId.get(id);
    if (!current || String(feature.properties?.osm_timestamp || '') >= String(current.properties?.osm_timestamp || '')) byId.set(id, feature);
  }
}

const features = [...byId.values()].sort((a, b) =>
  (a.properties?.name || '').localeCompare(b.properties?.name || '') ||
  a.properties.source_id.localeCompare(b.properties.source_id)
);
const failuresByState = new Map();
for (const failure of failedStates) failuresByState.set(failure.state, failure);
const sourcesByState = new Map();
for (const receipt of stateSources) sourcesByState.set(receipt.state, receipt);

const collection = {
  type: 'FeatureCollection',
  metadata: {
    project: 'Concrete Atlas',
    version: '0.1.1',
    generated_at: newestGeneratedAt || new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    coverage: '50 U.S. states plus District of Columbia',
    requested_states: [...requestedStates].sort(),
    feature_count: features.length,
    failed_states: [...failuresByState.values()].sort((a,b) => a.state.localeCompare(b.state)),
    state_sources: [...sourcesByState.values()].sort((a,b) => a.state.localeCompare(b.state)),
    source_freshness_policy_hours: freshnessPolicies.size === 1 ? [...freshnessPolicies][0] : [...freshnessPolicies].sort((a,b) => a-b),
    query_tags: ['sport includes skateboard (primary)', 'leisure=skate_park (supplemental)', 'leisure=skatepark (supplemental)'],
    merge: { chunk_count: files.length, deduplicated_by: 'source_id' }
  },
  features
};

await writeFile(output, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log(`Merged ${files.length} chunks into ${features.length} unique skatepark features.`);
console.log(`Coverage: ${requestedStates.size} state/DC codes; failures: ${failuresByState.size}; source receipts: ${sourcesByState.size}.`);
