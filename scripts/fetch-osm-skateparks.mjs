import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
];

const endpoints = (process.env.OVERPASS_ENDPOINTS || 'https://overpass.private.coffee/api/interpreter,https://overpass-api.de/api/interpreter')
  .split(',').map(v => v.trim()).filter(Boolean);
const pauseMs = Number(process.env.OVERPASS_DELAY_MS || 900);
const timeoutSeconds = Number(process.env.OVERPASS_TIMEOUT_SECONDS || 45);
const outputPath = new URL('../data/skateparks.geojson', import.meta.url);

function queryFor(state) {
  return `[out:json][timeout:${timeoutSeconds}];\n` +
    `area["ISO3166-2"="US-${state}"][admin_level=4]->.searchArea;\n` +
    `(\n` +
    `  nwr["leisure"="skate_park"](area.searchArea);\n` +
    `  nwr["sport"~"(^|;)skateboard(;|$)"](area.searchArea);\n` +
    `);\n` +
    `out center tags meta;`;
}

function boolish(value) {
  if (value == null) return null;
  const v = String(value).toLowerCase();
  if (['yes','true','1'].includes(v)) return true;
  if (['no','false','0'].includes(v)) return false;
  return null;
}

function coordinateOf(el) {
  if (Number.isFinite(el.lon) && Number.isFinite(el.lat)) return [el.lon, el.lat];
  if (Number.isFinite(el.center?.lon) && Number.isFinite(el.center?.lat)) return [el.center.lon, el.center.lat];
  return null;
}

function normalize(el, state, generatedAt) {
  const coords = coordinateOf(el);
  if (!coords) return null;
  const t = el.tags || {};
  const sourceId = `osm:${el.type}/${el.id}`;
  const name = t.name || t['official_name'] || t['alt_name'] || 'Unnamed skatepark';
  const address = [t['addr:housenumber'], t['addr:street'], t['addr:city'], t['addr:state'], t['addr:postcode']]
    .filter(Boolean).join(' ');
  const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;
  return {
    type: 'Feature',
    id: sourceId,
    geometry: { type: 'Point', coordinates: coords },
    properties: {
      source_id: sourceId,
      source: 'OpenStreetMap',
      osm_type: el.type,
      osm_id: String(el.id),
      osm_url: osmUrl,
      source_state: state,
      name,
      named: Boolean(t.name),
      address: address || null,
      city: t['addr:city'] || null,
      postcode: t['addr:postcode'] || null,
      leisure: t.leisure || null,
      sport: t.sport || null,
      surface: t.surface || null,
      indoor: boolish(t.indoor),
      lit: boolish(t.lit),
      covered: boolish(t.covered),
      access: t.access || null,
      fee: t.fee || null,
      opening_hours: t.opening_hours || null,
      operator: t.operator || null,
      website: t.website || t['contact:website'] || null,
      phone: t.phone || t['contact:phone'] || null,
      description: t.description || null,
      osm_version: el.version ?? null,
      osm_timestamp: el.timestamp ?? null,
      verification_status: 'osm_seeded',
      community_verified_at: null,
      ingested_at: generatedAt,
      tags: t
    }
  };
}

async function fetchState(state) {
  const query = queryFor(state);
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 10) * 1000);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'accept': 'application/json',
          'user-agent': 'ConcreteAtlas/0.1 (nationwide skatepark dataset refresh)'
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      return json.elements || [];
    } catch (error) {
      lastError = error;
      console.warn(`[${state}] ${endpoint} failed: ${error.message}`);
    }
  }
  throw lastError || new Error(`No Overpass endpoint succeeded for ${state}`);
}

const generatedAt = new Date().toISOString();
const byId = new Map();
const failures = [];
let previousFeatures = [];
try {
  const previous = JSON.parse(await readFile(outputPath, 'utf8'));
  if (previous?.type === 'FeatureCollection' && Array.isArray(previous.features)) previousFeatures = previous.features;
} catch {
  // First bootstrap or unreadable prior snapshot: nothing to retain.
}
const previousByState = new Map();
for (const feature of previousFeatures) {
  const st = feature?.properties?.source_state;
  if (!st) continue;
  if (!previousByState.has(st)) previousByState.set(st, []);
  previousByState.get(st).push(feature);
}

for (const [i, state] of STATES.entries()) {
  process.stdout.write(`[${i + 1}/${STATES.length}] US-${state} ... `);
  try {
    const elements = await fetchState(state);
    let accepted = 0;
    for (const el of elements) {
      const feature = normalize(el, state, generatedAt);
      if (!feature) continue;
      byId.set(feature.properties.source_id, feature);
      accepted += 1;
    }
    console.log(`${accepted} returned; ${byId.size} unique total`);
  } catch (error) {
    const retained = previousByState.get(state) || [];
    for (const feature of retained) byId.set(feature.properties.source_id, feature);
    failures.push({ state, error: error.message, retained_feature_count: retained.length });
    console.log(`FAILED: ${error.message}; retained ${retained.length} prior feature(s)`);
  }
  if (i < STATES.length - 1) await sleep(pauseMs);
}

const features = [...byId.values()].sort((a, b) =>
  (a.properties.name || '').localeCompare(b.properties.name || '') ||
  a.properties.source_id.localeCompare(b.properties.source_id)
);

const collection = {
  type: 'FeatureCollection',
  metadata: {
    project: 'Concrete Atlas',
    version: '0.1.1',
    generated_at: generatedAt,
    source: 'OpenStreetMap via Overpass API',
    coverage: '50 U.S. states plus District of Columbia',
    feature_count: features.length,
    failed_states: failures,
    retained_failed_state_features: failures.reduce((sum, x) => sum + (x.retained_feature_count || 0), 0),
    query_tags: ['leisure=skate_park', 'sport includes skateboard']
  },
  features
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(outputPath, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log(`\nWrote ${features.length} unique features to data/skateparks.geojson`);
if (failures.length) {
  console.warn(`Partial refresh: ${failures.length} state(s) failed. Re-run to retry.`);
  process.exitCode = 2;
}
