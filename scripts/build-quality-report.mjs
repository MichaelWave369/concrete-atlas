import { readFile, writeFile } from 'node:fs/promises';

const inputPath = new URL('../data/skateparks.geojson', import.meta.url);
const outputPath = new URL('../data/quality-report.json', import.meta.url);
const data = JSON.parse(await readFile(inputPath, 'utf8'));

if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
  throw new Error('data/skateparks.geojson is not a FeatureCollection');
}

const features = data.features;
const metadata = data.metadata || {};
const receipts = Array.isArray(metadata.state_sources) ? metadata.state_sources : [];
const failures = Array.isArray(metadata.failed_states) ? metadata.failed_states : [];

function percent(count, total = features.length) {
  return total ? Number(((count / total) * 100).toFixed(2)) : 0;
}

function countWhere(predicate) {
  let count = 0;
  for (const feature of features) if (predicate(feature.properties || {}, feature)) count += 1;
  return count;
}

function countsBy(getKey) {
  const counts = new Map();
  for (const feature of features) {
    const key = getKey(feature.properties || {}, feature);
    if (key == null || key === '') continue;
    counts.set(String(key), (counts.get(String(key)) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function coverage(predicate) {
  const count = countWhere(predicate);
  return { count, percent: percent(count) };
}

function numericSummary(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return { count: 0, min: null, median: null, mean: null, max: null };
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return {
    count: nums.length,
    min: Number(nums[0].toFixed(2)),
    median: Number(median.toFixed(2)),
    mean: Number(mean.toFixed(2)),
    max: Number(nums[nums.length - 1].toFixed(2))
  };
}

const named = coverage(p => p.named === true || (p.name && !/^unnamed\b/i.test(p.name)));
const surfaceKnown = coverage(p => Boolean(p.surface));
const concrete = coverage(p => String(p.surface || '').toLowerCase() === 'concrete');
const lightsKnown = coverage(p => p.lit === true || p.lit === false);
const hoursKnown = coverage(p => Boolean(p.opening_hours));
const indoorKnown = coverage(p => p.indoor === true || p.indoor === false);
const addressKnown = coverage(p => Boolean(p.address));
const operatorKnown = coverage(p => Boolean(p.operator));
const websiteKnown = coverage(p => Boolean(p.website));
const accessKnown = coverage(p => Boolean(p.access));
const classified = coverage(p => Boolean(p.candidate_kind && p.candidate_confidence && p.candidate_reason));
const communityVerified = coverage(p => p.verification_status === 'community_verified');

const stateCounts = countsBy(p => p.source_state || 'UNKNOWN');
const candidateKinds = countsBy(p => p.candidate_kind || 'unclassified');
const confidenceCounts = countsBy(p => p.candidate_confidence || 'unclassified');
const verificationCounts = countsBy(p => p.verification_status || 'unknown');

const primaryLags = receipts.map(receipt => receipt?.primary?.source_lag_hours).filter(Number.isFinite);
const supplementalSuccesses = receipts.filter(receipt => Boolean(receipt?.supplemental)).length;
const supplementalFailures = receipts.filter(receipt => receipt?.supplemental_enabled && !receipt?.supplemental).length;
const retainedSupplemental = receipts.reduce((sum, receipt) => sum + Number(receipt?.retained_supplemental_feature_count || 0), 0);
const retainedFailedStateFeatures = failures.reduce((sum, failure) => sum + Number(failure?.retained_feature_count || 0), 0);

const report = {
  schema_version: '0.1',
  project: 'Concrete Atlas',
  generated_at: new Date().toISOString(),
  snapshot_generated_at: metadata.generated_at || null,
  snapshot_version: metadata.version || null,
  totals: {
    source_candidates: features.length,
    excluded_non_facility_candidates: Number(metadata.excluded_non_facility_count || 0),
    requested_state_dc_codes: Array.isArray(metadata.requested_states) ? metadata.requested_states.length : null,
    fresh_state_receipts: receipts.length,
    failed_primary_states: failures.length,
    retained_failed_state_features: retainedFailedStateFeatures,
    retained_supplemental_features: retainedSupplemental
  },
  field_coverage: {
    named,
    classified,
    surface_known: surfaceKnown,
    concrete_surface: concrete,
    lights_known: lightsKnown,
    opening_hours_known: hoursKnown,
    indoor_status_known: indoorKnown,
    address_known: addressKnown,
    operator_known: operatorKnown,
    website_known: websiteKnown,
    access_known: accessKnown,
    community_verified: communityVerified
  },
  distributions: {
    candidate_kind: candidateKinds,
    candidate_confidence: confidenceCounts,
    verification_status: verificationCounts,
    source_state: stateCounts
  },
  source_health: {
    freshness_policy_hours: metadata.source_freshness_policy_hours ?? null,
    primary_source_lag_hours: numericSummary(primaryLags),
    supplemental_enabled: metadata.supplemental_enabled ?? null,
    supplemental_success_states: supplementalSuccesses,
    supplemental_unavailable_states: supplementalFailures,
    failed_primary_states: failures.map(failure => ({
      state: failure.state,
      error: failure.error,
      retained_feature_count: Number(failure.retained_feature_count || 0),
      retained_excluded_non_facility_count: Number(failure.retained_excluded_non_facility_count || 0)
    }))
  },
  governance: {
    classifier: metadata.classifier || null,
    principle: 'Source is not verification. Quality metrics describe dataset coverage and provenance, not real-world skateability or safety.'
  }
};

await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`Wrote data/quality-report.json for ${features.length} source candidates.`);
console.log(`Named ${named.percent}% · classified ${classified.percent}% · surface known ${surfaceKnown.percent}% · lights known ${lightsKnown.percent}% · hours known ${hoursKnown.percent}%.`);
