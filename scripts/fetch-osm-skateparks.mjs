import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
];
const requestedStates = (process.env.STATE_CODES || '').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
const STATES = requestedStates.length ? requestedStates : ALL_STATES;
for (const state of STATES) {
  if (!ALL_STATES.includes(state)) throw new Error(`Unknown U.S. state code: ${state}`);
}

const endpoints = (process.env.OVERPASS_ENDPOINTS || 'https://overpass-api.de/api/interpreter,https://lz4.overpass-api.de/api/interpreter,https://z.overpass-api.de/api/interpreter')
  .split(',').map(v => v.trim()).filter(Boolean);
const pauseMs = Number(process.env.OVERPASS_DELAY_MS || 1500);
const timeoutSeconds = Number(process.env.OVERPASS_TIMEOUT_SECONDS || 20);
const maxSourceLagHours = Number(process.env.MAX_SOURCE_LAG_HOURS || 72);
const includeSupplemental = /^(1|true|yes)$/i.test(process.env.INCLUDE_SUPPLEMENTAL || 'false');
const outputPath = new URL('../data/skateparks.geojson', import.meta.url);

function areaPrefix(state) {
  return `[out:json][timeout:${timeoutSeconds}];\narea["ISO3166-2"="US-${state}"][admin_level=4]->.searchArea;\n`;
}

function primaryQuery(state) {
  return areaPrefix(state) +
    `nwr["sport"~"(^|;)skateboard(;|$)"](area.searchArea);\n` +
    `out center tags meta;`;
}

function supplementalQuery(state) {
  return areaPrefix(state) +
    `(\n` +
    `  nwr["leisure"="skate_park"](area.searchArea);\n` +
    `  nwr["leisure"="skatepark"](area.searchArea);\n` +
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

function sourceLagHours(timestamp) {
  const ms = Date.parse(timestamp || '');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (Date.now() - ms) / 3_600_000);
}

function matchTags(tags = {}) {
  const matches = [];
  if (String(tags.sport || '').split(';').map(v => v.trim()).includes('skateboard')) matches.push('sport=skateboard');
  if (tags.leisure === 'skate_park') matches.push('leisure=skate_park');
  if (tags.leisure === 'skatepark') matches.push('leisure=skatepark');
  return matches;
}

function normalize(el, state, generatedAt) {
  const coords = coordinateOf(el);
  if (!coords) return null;
  const t = el.tags || {};
  const sourceId = `osm:${el.type}/${el.id}`;
  const name = t.name || t.official_name || t.alt_name || 'Unnamed skatepark';
  const address = [t['addr:housenumber'], t['addr:street'], t['addr:city'], t['addr:state'], t['addr:postcode']]
    .filter(Boolean).join(' ');
  return {
    type: 'Feature',
    id: sourceId,
    geometry: { type: 'Point', coordinates: coords },
    properties: {
      source_id: sourceId,
      source: 'OpenStreetMap',
      osm_type: el.type,
      osm_id: String(el.id),
      osm_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      source_state: state,
      matched_by: matchTags(t),
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

async function fetchQuery(state, kind, query) {
  let lastError;
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 7) * 1000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          accept: 'application/json',
          'user-agent': 'ConcreteAtlas/0.1.1 (nationwide skatepark dataset refresh)'
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      const osmBase = json.osm3s?.timestamp_osm_base || null;
      const lagHours = sourceLagHours(osmBase);
      if (lagHours != null && lagHours > maxSourceLagHours) {
        throw new Error(`stale OSM base ${osmBase} (${lagHours.toFixed(1)}h lag > ${maxSourceLagHours}h policy)`);
      }
      return {
        elements: json.elements || [],
        receipt: {
          kind,
          endpoint,
          osm_base: osmBase,
          areas_base: json.osm3s?.timestamp_areas_base || null,
          source_lag_hours: lagHours == null ? null : Number(lagHours.toFixed(2)),
          element_count: (json.elements || []).length
        }
      };
    } catch (error) {
      lastError = error;
      console.warn(`[${state}] ${kind} ${endpoint} failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`No Overpass endpoint succeeded for ${state} ${kind}`);
}

async function fetchState(state) {
  const primary = await fetchQuery(state, 'primary:sport=skateboard', primaryQuery(state));
  let supplemental = null;
  let supplementalError = null;
  if (includeSupplemental) {
    try {
      supplemental = await fetchQuery(state, 'supplemental:leisure=skate_park|skatepark', supplementalQuery(state));
    } catch (error) {
      supplementalError = error.message;
      console.warn(`[${state}] supplemental skatepark tags unavailable: ${error.message}`);
    }
  }
  const elements = new Map();
  for (const el of primary.elements) elements.set(`${el.type}/${el.id}`, el);
  for (const el of supplemental?.elements || []) elements.set(`${el.type}/${el.id}`, el);
  return {
    elements: [...elements.values()],
    receipt: {
      state,
      primary: primary.receipt,
      supplemental_enabled: includeSupplemental,
      supplemental: supplemental?.receipt || null,
      supplemental_error: supplementalError,
      merged_element_count: elements.size
    }
  };
}

const generatedAt = new Date().toISOString();
const byId = new Map();
const failures = [];
const stateSources = [];
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
    const result = await fetchState(state);
    let accepted = 0;
    for (const el of result.elements) {
      const feature = normalize(el, state, generatedAt);
      if (!feature) continue;
      byId.set(feature.properties.source_id, feature);
      accepted += 1;
    }
    stateSources.push({ ...result.receipt, feature_count: accepted });
    const supplementNote = includeSupplemental && result.receipt.supplemental_error ? ' (supplement unavailable)' : '';
    console.log(`${accepted} returned; ${byId.size} unique total${supplementNote}`);
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

const queryTags = ['sport includes skateboard (primary)'];
if (includeSupplemental) queryTags.push('leisure=skate_park (supplemental)', 'leisure=skatepark (supplemental)');

const collection = {
  type: 'FeatureCollection',
  metadata: {
    project: 'Concrete Atlas',
    version: '0.1.1',
    generated_at: generatedAt,
    source: 'OpenStreetMap via Overpass API',
    coverage: requestedStates.length ? `State chunk: ${STATES.join(',')}` : '50 U.S. states plus District of Columbia',
    requested_states: STATES,
    feature_count: features.length,
    failed_states: failures,
    state_sources: stateSources,
    source_freshness_policy_hours: maxSourceLagHours,
    supplemental_enabled: includeSupplemental,
    retained_failed_state_features: failures.reduce((sum, x) => sum + (x.retained_feature_count || 0), 0),
    query_tags: queryTags
  },
  features
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(outputPath, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log(`\nWrote ${features.length} unique features to data/skateparks.geojson`);
if (failures.length) {
  console.warn(`Partial refresh: ${failures.length} state(s) failed primary ingestion. Re-run to retry.`);
  process.exitCode = 2;
}
