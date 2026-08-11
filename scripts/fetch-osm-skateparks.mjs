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
const supplementalEndpoints = (process.env.SUPPLEMENTAL_OVERPASS_ENDPOINTS || 'https://overpass-api.de/api/interpreter,https://lz4.overpass-api.de/api/interpreter')
  .split(',').map(v => v.trim()).filter(Boolean);
const pauseMs = Number(process.env.OVERPASS_DELAY_MS || 2500);
const timeoutSeconds = Number(process.env.OVERPASS_TIMEOUT_SECONDS || 20);
const supplementalTimeoutSeconds = Number(process.env.SUPPLEMENTAL_TIMEOUT_SECONDS || 10);
const retryDelayMs = Number(process.env.OVERPASS_RETRY_DELAY_MS || 15000);
const maxSourceLagHours = Number(process.env.MAX_SOURCE_LAG_HOURS || 72);
const includeSupplemental = /^(1|true|yes)$/i.test(process.env.INCLUDE_SUPPLEMENTAL || 'true');
const classifierPolicyVersion = process.env.CLASSIFIER_POLICY_VERSION || '0.1';
const outputPath = new URL('../data/skateparks.geojson', import.meta.url);

function areaPrefix(state, queryTimeoutSeconds) {
  return `[out:json][timeout:${queryTimeoutSeconds}];\narea["ISO3166-2"="US-${state}"][admin_level=4]->.searchArea;\n`;
}

function primaryQuery(state) {
  return areaPrefix(state, timeoutSeconds) +
    `nwr["sport"~"(^|;)skateboard(;|$)"](area.searchArea);\n` +
    `out center tags meta;`;
}

function supplementalQuery(state) {
  return areaPrefix(state, supplementalTimeoutSeconds) +
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

function hasSkateboardSport(tags = {}) {
  return String(tags.sport || '').split(';').map(v => v.trim()).includes('skateboard');
}

function matchTags(tags = {}) {
  const matches = [];
  if (hasSkateboardSport(tags)) matches.push('sport=skateboard');
  if (tags.leisure === 'skate_park') matches.push('leisure=skate_park');
  if (tags.leisure === 'skatepark') matches.push('leisure=skatepark');
  return matches;
}

function isLeisureOnlyCandidate(feature) {
  const tags = feature?.properties?.tags || {};
  const leisure = tags.leisure === 'skate_park' || tags.leisure === 'skatepark';
  return leisure && !hasSkateboardSport(tags);
}

function classifyCandidate(tags = {}, name = '') {
  const leisure = String(tags.leisure || '').toLowerCase();
  const skateLeisure = leisure === 'skate_park' || leisure === 'skatepark';
  const skateSport = hasSkateboardSport(tags);
  const physicalSportLeisure = ['pitch', 'sports_centre', 'recreation_ground'].includes(leisure);
  const skateName = /\bskate\s*(park|plaza|facility|center|centre)\b|\bskatepark\b/i.test(name);
  const obviousCommercial = Boolean(tags.shop || tags.office || tags.craft);

  if (obviousCommercial && !skateLeisure && !physicalSportLeisure) {
    return { include:false, kind:'excluded_commercial', confidence:'excluded', reason:'commercial_tag_without_skatepark_leisure' };
  }
  if (skateLeisure) {
    return { include:true, kind:'skatepark', confidence:'high', reason:'explicit_skatepark_leisure' };
  }
  if (skateSport && physicalSportLeisure) {
    return { include:true, kind:'skate_facility', confidence:'high', reason:`sport_skateboard_plus_leisure_${leisure}` };
  }
  if (skateSport && skateName) {
    return { include:true, kind:'probable_skatepark', confidence:'medium_high', reason:'sport_skateboard_plus_skatepark_name' };
  }
  if (skateSport) {
    return { include:true, kind:'skateboard_facility_candidate', confidence:'medium', reason:'sport_skateboard_only' };
  }
  return { include:false, kind:'excluded_unclassified', confidence:'excluded', reason:'no_supported_skatepark_signal' };
}

function normalize(el, state, generatedAt) {
  const coords = coordinateOf(el);
  if (!coords) return { excluded:true, reason:'missing_coordinates' };
  const t = el.tags || {};
  const sourceId = `osm:${el.type}/${el.id}`;
  const name = t.name || t.official_name || t.alt_name || 'Unnamed skatepark';
  const classification = classifyCandidate(t, name);
  if (!classification.include) return { excluded:true, reason:classification.reason, kind:classification.kind };
  const address = [t['addr:housenumber'], t['addr:street'], t['addr:city'], t['addr:state'], t['addr:postcode']]
    .filter(Boolean).join(' ');
  return {
    excluded:false,
    feature: {
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
        candidate_kind: classification.kind,
        candidate_confidence: classification.confidence,
        candidate_reason: classification.reason,
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
    }
  };
}

function reclassifyRetainedFeature(feature) {
  const p = feature?.properties;
  if (!p) return null;
  const tags = p.tags || {};
  const classification = classifyCandidate(tags, p.name || '');
  if (!classification.include) return null;
  return {
    ...feature,
    properties: {
      ...p,
      matched_by: matchTags(tags),
      candidate_kind: classification.kind,
      candidate_confidence: classification.confidence,
      candidate_reason: classification.reason
    }
  };
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return retryDelayMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(retryDelayMs, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(retryDelayMs, date - Date.now());
  return retryDelayMs;
}

async function fetchQuery(state, kind, query, options = {}) {
  const endpointList = options.endpointList || endpoints;
  const requestTimeoutSeconds = options.requestTimeoutSeconds || timeoutSeconds;
  const maxAttemptsPerEndpoint = options.maxAttemptsPerEndpoint || 2;
  const retryRateLimits = options.retryRateLimits !== false;
  let lastError;

  for (const endpoint of endpointList) {
    for (let attempt = 1; attempt <= maxAttemptsPerEndpoint; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (requestTimeoutSeconds + 7) * 1000);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            accept: 'application/json',
            'user-agent': 'ConcreteAtlas/0.1.2 (nationwide skatepark dataset refresh)'
          },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal
        });
        if (response.status === 429 && retryRateLimits && attempt < maxAttemptsPerEndpoint) {
          const delay = retryAfterMs(response);
          console.warn(`[${state}] ${kind} ${endpoint} rate limited; backing off ${Math.ceil(delay / 1000)}s before retry`);
          await sleep(delay);
          continue;
        }
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
            element_count: (json.elements || []).length,
            attempts: attempt
          }
        };
      } catch (error) {
        lastError = error;
        console.warn(`[${state}] ${kind} ${endpoint} attempt ${attempt} failed: ${error.message}`);
        break;
      } finally {
        clearTimeout(timer);
      }
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
      supplemental = await fetchQuery(
        state,
        'supplemental:leisure=skate_park|skatepark',
        supplementalQuery(state),
        {
          endpointList: supplementalEndpoints,
          requestTimeoutSeconds: supplementalTimeoutSeconds,
          maxAttemptsPerEndpoint: 1,
          retryRateLimits: false
        }
      );
    } catch (error) {
      supplementalError = error.message;
      console.warn(`[${state}] supplemental skatepark enrichment unavailable: ${error.message}`);
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
let excludedNonFacilityCount = 0;
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
  if (!st || !STATES.includes(st)) continue;
  if (!previousByState.has(st)) previousByState.set(st, { features: [], excluded_non_facility_count: 0 });
  const bucket = previousByState.get(st);
  const upgraded = reclassifyRetainedFeature(feature);
  if (upgraded) bucket.features.push(upgraded);
  else bucket.excluded_non_facility_count += 1;
}

for (const [i, state] of STATES.entries()) {
  process.stdout.write(`[${i + 1}/${STATES.length}] US-${state} ... `);
  try {
    const result = await fetchState(state);
    let acceptedFresh = 0;
    let excluded = 0;
    const currentStateIds = new Set();
    for (const el of result.elements) {
      const normalized = normalize(el, state, generatedAt);
      if (!normalized || normalized.excluded) {
        excluded += 1;
        continue;
      }
      const feature = normalized.feature;
      byId.set(feature.properties.source_id, feature);
      currentStateIds.add(feature.properties.source_id);
      acceptedFresh += 1;
    }

    let retainedSupplemental = 0;
    if (!result.receipt.supplemental) {
      const retained = previousByState.get(state) || { features: [] };
      for (const feature of retained.features) {
        if (!isLeisureOnlyCandidate(feature)) continue;
        if (currentStateIds.has(feature.properties.source_id)) continue;
        byId.set(feature.properties.source_id, feature);
        retainedSupplemental += 1;
      }
    }

    excludedNonFacilityCount += excluded;
    stateSources.push({
      ...result.receipt,
      feature_count: acceptedFresh + retainedSupplemental,
      fresh_feature_count: acceptedFresh,
      retained_supplemental_feature_count: retainedSupplemental,
      excluded_non_facility_count: excluded
    });
    const supplementNote = result.receipt.supplemental
      ? ''
      : ` (supplement unavailable; retained ${retainedSupplemental} leisure-only prior candidate(s))`;
    console.log(`${acceptedFresh} fresh accepted, ${retainedSupplemental} supplement-retained, ${excluded} excluded; ${byId.size} unique total${supplementNote}`);
  } catch (error) {
    const retained = previousByState.get(state) || { features: [], excluded_non_facility_count: 0 };
    for (const feature of retained.features) byId.set(feature.properties.source_id, feature);
    excludedNonFacilityCount += retained.excluded_non_facility_count;
    failures.push({
      state,
      error: error.message,
      retained_feature_count: retained.features.length,
      retained_excluded_non_facility_count: retained.excluded_non_facility_count
    });
    console.log(`FAILED: ${error.message}; retained ${retained.features.length} prior feature(s), excluded ${retained.excluded_non_facility_count} prior non-facility candidate(s)`);
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
    version: '0.1.2',
    generated_at: generatedAt,
    source: 'OpenStreetMap via Overpass API',
    coverage: requestedStates.length ? `State chunk: ${STATES.join(',')}` : '50 U.S. states plus District of Columbia',
    requested_states: STATES,
    feature_count: features.length,
    failed_states: failures,
    state_sources: stateSources,
    source_freshness_policy_hours: maxSourceLagHours,
    supplemental_enabled: includeSupplemental,
    supplemental_timeout_seconds: supplementalTimeoutSeconds,
    excluded_non_facility_count: excludedNonFacilityCount,
    retained_failed_state_features: failures.reduce((sum, x) => sum + (x.retained_feature_count || 0), 0),
    query_tags: queryTags,
    classifier: {
      version: classifierPolicyVersion,
      principle: 'OSM source candidates are classified before display; obvious commercial records are excluded unless they also carry physical skatepark tags.'
    }
  },
  features
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(outputPath, JSON.stringify(collection, null, 2) + '\n', 'utf8');
console.log(`\nWrote ${features.length} unique features to data/skateparks.geojson; excluded ${excludedNonFacilityCount} non-facility candidates.`);
if (failures.length) {
  console.warn(`Partial refresh: ${failures.length} state(s) failed primary ingestion. Re-run to retry.`);
  process.exitCode = 2;
}
