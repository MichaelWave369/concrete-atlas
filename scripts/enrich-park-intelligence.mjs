import { readFile, writeFile } from 'node:fs/promises';

const dataPath = new URL('../data/skateparks.geojson', import.meta.url);
const data = JSON.parse(await readFile(dataPath, 'utf8'));

if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
  throw new Error('data/skateparks.geojson is not a FeatureCollection');
}

const TERRAIN_BY_EQUIPMENT = new Map([
  ['bowl', 'bowl'], ['pool', 'bowl'],
  ['rail', 'street'], ['flatbar', 'street'], ['handrail', 'street'], ['ledge', 'street'],
  ['stairs', 'street'], ['stair', 'street'], ['manual_pad', 'street'], ['pyramid', 'street'],
  ['bank', 'street'], ['funbox', 'street'], ['hubba', 'street'],
  ['quarter_pipe', 'transition'], ['quarterpipe', 'transition'], ['halfpipe', 'transition'],
  ['half_pipe', 'transition'], ['mini_ramp', 'transition'], ['miniramp', 'transition'],
  ['spine', 'transition'], ['ramp', 'transition'],
  ['vert', 'vert'], ['vert_wall', 'vert'], ['vert_ramp', 'vert'],
  ['pump_track', 'pump'], ['pumptrack', 'pump'],
  ['snake_run', 'flow'], ['snakerun', 'flow'], ['flow', 'flow']
]);

const AMENITY_KEYS = [
  'toilets', 'drinking_water', 'shower', 'changing_rooms', 'benches', 'picnic_table',
  'shelter', 'parking', 'bicycle_parking', 'waste_basket'
];

const ACTIVITY_KEYS = ['skateboard', 'bmx', 'scooter', 'scooters', 'inline_skates'];

function isSupportedValue(value) {
  if (value == null || value === '') return false;
  return !['no', 'false', '0', 'none', 'unknown'].includes(String(value).trim().toLowerCase());
}

function normalizeToken(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_:]/g, '');
}

function deriveIntelligence(tags = {}) {
  const equipment = new Set();
  const terrain = new Set();
  const terrainEvidence = [];

  for (const [key, rawValue] of Object.entries(tags)) {
    if (!key.startsWith('skatepark:')) continue;
    if (!isSupportedValue(rawValue)) continue;

    const equipmentKey = normalizeToken(key.slice('skatepark:'.length));
    if (!equipmentKey) continue;

    if (equipmentKey === 'obstacles') {
      for (const token of String(rawValue).split(/[;,]/).map(normalizeToken).filter(Boolean)) equipment.add(token);
      continue;
    }

    equipment.add(equipmentKey);
  }

  for (const token of equipment) {
    const family = TERRAIN_BY_EQUIPMENT.get(token);
    if (!family) continue;
    terrain.add(family);
    terrainEvidence.push(`skatepark:${token}`);
  }

  const amenities = {};
  for (const key of AMENITY_KEYS) {
    if (tags[key] == null || tags[key] === '') continue;
    amenities[key] = tags[key];
  }

  const activityAccess = {};
  for (const key of ACTIVITY_KEYS) {
    if (tags[key] == null || tags[key] === '') continue;
    activityAccess[key] = tags[key];
  }

  return {
    park_intelligence_version: '0.1',
    equipment_signals: [...equipment].sort(),
    terrain_types: [...terrain].sort(),
    terrain_evidence: terrainEvidence.sort(),
    amenity_signals: amenities,
    activity_access: activityAccess,
    intelligence_evidence: equipment.size || Object.keys(amenities).length || Object.keys(activityAccess).length
      ? 'explicit_osm_tags'
      : 'none'
  };
}

let equipmentFeatures = 0;
let terrainFeatures = 0;
let amenityFeatures = 0;
let accessFeatures = 0;
const terrainCounts = new Map();

for (const feature of data.features) {
  const properties = feature.properties || {};
  const intelligence = deriveIntelligence(properties.tags || {});
  feature.properties = { ...properties, ...intelligence };

  if (intelligence.equipment_signals.length) equipmentFeatures += 1;
  if (intelligence.terrain_types.length) terrainFeatures += 1;
  if (Object.keys(intelligence.amenity_signals).length) amenityFeatures += 1;
  if (Object.keys(intelligence.activity_access).length) accessFeatures += 1;
  for (const terrain of intelligence.terrain_types) terrainCounts.set(terrain, (terrainCounts.get(terrain) || 0) + 1);
}

data.metadata = {
  ...(data.metadata || {}),
  park_intelligence: {
    version: '0.1',
    enriched_at: new Date().toISOString(),
    source: 'stored_raw_osm_tags',
    principle: 'Only explicit OSM equipment, amenity, and activity-access tags are promoted. Broad terrain families are conservative mappings from explicit skatepark equipment tags; absent evidence remains unknown.'
  }
};

await writeFile(dataPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log(`Enriched ${data.features.length} candidates with Park Intelligence v0.1.`);
console.log(`Equipment evidence: ${equipmentFeatures}; terrain evidence: ${terrainFeatures}; amenity evidence: ${amenityFeatures}; activity-access evidence: ${accessFeatures}.`);
console.log(`Terrain families: ${JSON.stringify(Object.fromEntries([...terrainCounts].sort()))}`);
