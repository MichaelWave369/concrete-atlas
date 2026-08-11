const STATES = [
  ['','All states'],['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia']
];
const stateSelect = document.querySelector('#state');
for (const [value, label] of STATES) {
  const o = document.createElement('option'); o.value = value; o.textContent = label; stateSelect.appendChild(o);
}

const state = {
  all: { type:'FeatureCollection', features:[] },
  filtered: { type:'FeatureCollection', features:[] },
  metadata: {},
  liveLoaded: new Set(),
  userLocation: null,
  userMarker: null
};

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [-98.5, 39.5],
  zoom: 3.1,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl(), 'top-left');

function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function valueOr(v, fallback='Unknown') { return v == null || v === '' ? fallback : v; }
function yesNo(v) { return v === true ? 'Yes' : v === false ? 'No' : 'Unknown'; }
function hasSkateboardSport(tags={}) { return String(tags.sport||'').split(';').map(v=>v.trim()).includes('skateboard'); }
function matchedBy(tags={}) {
  const matches=[];
  if (hasSkateboardSport(tags)) matches.push('sport=skateboard');
  if (tags.leisure === 'skate_park') matches.push('leisure=skate_park');
  if (tags.leisure === 'skatepark') matches.push('leisure=skatepark');
  return matches;
}
function classifySourceCandidate(tags={}, name='') {
  const leisure=String(tags.leisure||'').toLowerCase();
  const skateLeisure=leisure==='skate_park' || leisure==='skatepark';
  const skateSport=hasSkateboardSport(tags);
  const physicalSportLeisure=['pitch','sports_centre','recreation_ground'].includes(leisure);
  const skateName=/\bskate\s*(park|plaza|facility|center|centre)\b|\bskatepark\b/i.test(name);
  const obviousCommercial=Boolean(tags.shop || tags.office || tags.craft);
  if (obviousCommercial && !skateLeisure && !physicalSportLeisure) return null;
  if (skateLeisure) return {kind:'skatepark',confidence:'high',reason:'explicit_skatepark_leisure'};
  if (skateSport && physicalSportLeisure) return {kind:'skate_facility',confidence:'high',reason:`sport_skateboard_plus_leisure_${leisure}`};
  if (skateSport && skateName) return {kind:'probable_skatepark',confidence:'medium_high',reason:'sport_skateboard_plus_skatepark_name'};
  if (skateSport) return {kind:'skateboard_facility_candidate',confidence:'medium',reason:'sport_skateboard_only'};
  return null;
}
function distanceKm(a, b) {
  const toRad = d => d * Math.PI / 180;
  const [lng1, lat1] = a; const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1); const dLng = toRad(lng2 - lng1);
  const x = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function distanceLabel(km) {
  const miles = km * 0.621371;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}
function featureFromHash() {
  const raw = new URLSearchParams(location.hash.replace(/^#/, '')).get('park');
  if (!raw) return null;
  return state.all.features.find(f => f.properties?.source_id === raw) || null;
}
function openParkFromHash() {
  const f = featureFromHash();
  if (f) openPark(f, { syncHash:false });
}
function addMapLayers() {
  if (map.getSource('parks')) return;
  map.addSource('parks', { type:'geojson', data:state.filtered, cluster:true, clusterMaxZoom:11, clusterRadius:52 });
  map.addLayer({ id:'clusters', type:'circle', source:'parks', filter:['has','point_count'], paint:{
    'circle-color':'#d7ff38', 'circle-radius':['step',['get','point_count'],18,25,23,100,29,500,36], 'circle-stroke-width':2, 'circle-stroke-color':'#0b0d10'
  }});
  map.addLayer({ id:'cluster-count', type:'symbol', source:'parks', filter:['has','point_count'], layout:{ 'text-field':['get','point_count_abbreviated'], 'text-size':12 }, paint:{ 'text-color':'#0b0d10' } });
  map.addLayer({ id:'parks-point', type:'circle', source:'parks', filter:['!',['has','point_count']], paint:{
    'circle-color':['case',['==',['get','verification_status'],'community_verified'],'#8df0ff','#d7ff38'], 'circle-radius':6, 'circle-stroke-width':2, 'circle-stroke-color':'#0b0d10'
  }});
  map.on('click','clusters', async e => {
    const f = map.queryRenderedFeatures(e.point,{ layers:['clusters'] })[0];
    if (!f) return;
    const source = map.getSource('parks');
    const zoom = await source.getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center:f.geometry.coordinates, zoom });
  });
  map.on('click','parks-point', e => { if (e.features?.[0]) openPark(e.features[0]); });
  for (const layer of ['clusters','parks-point']) {
    map.on('mouseenter', layer, () => map.getCanvas().style.cursor='pointer');
    map.on('mouseleave', layer, () => map.getCanvas().style.cursor='');
  }
}

function mergeFeatures(features) {
  const byId = new Map(state.all.features.map(f => [f.properties.source_id, f]));
  for (const f of features) byId.set(f.properties.source_id, f);
  state.all = { type:'FeatureCollection', features:[...byId.values()] };
  applyFilters();
}

function applyFilters() {
  const q = document.querySelector('#search').value.trim().toLowerCase();
  const st = document.querySelector('#state').value;
  const surface = document.querySelector('#surface').value;
  const environment = document.querySelector('#environment').value;
  const verification = document.querySelector('#verification').value;
  state.filtered = { type:'FeatureCollection', features: state.all.features.filter(f => {
    const p = f.properties || {};
    const hay = `${p.name||''} ${p.city||''} ${p.address||''} ${p.operator||''}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (st && p.source_state !== st) return false;
    if (surface === 'concrete' && String(p.surface||'').toLowerCase() !== 'concrete') return false;
    if (surface === 'known' && !p.surface) return false;
    if (environment === 'indoor' && p.indoor !== true) return false;
    if (environment === 'outdoor' && p.indoor === true) return false;
    if (verification === 'verified' && p.verification_status !== 'community_verified') return false;
    if (verification === 'osm' && p.verification_status !== 'osm_seeded') return false;
    return true;
  }) };
  if (map.getSource('parks')) map.getSource('parks').setData(state.filtered);
  renderSidebar(); renderStats();
}

function renderStats() {
  document.querySelector('#count-all').textContent = state.all.features.length.toLocaleString();
  document.querySelector('#count-visible').textContent = state.filtered.features.length.toLocaleString();
  document.querySelector('#snapshot').textContent = state.metadata.generated_at ? new Date(state.metadata.generated_at).toLocaleDateString() : 'live / none';
}

function renderSidebar() {
  const wrap = document.querySelector('#park-list');
  let candidates = state.filtered.features;
  if (map.loaded()) {
    const bounds = map.getBounds();
    const inView = candidates.filter(f => bounds.contains(f.geometry.coordinates));
    if (inView.length) candidates = inView;
  }
  if (state.userLocation) {
    candidates = candidates.map(f => ({ f, d:distanceKm(state.userLocation, f.geometry.coordinates) })).sort((a,b)=>a.d-b.d).map(x => ({...x.f, _distanceKm:x.d}));
  }
  const list = candidates.slice(0, 80);
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">No source candidates match the current view. Choose another state/filter, or refresh the source snapshot.</div>`;
    return;
  }
  wrap.innerHTML = list.map((f,i) => {
    const p=f.properties; const labels=[];
    if (p.candidate_confidence) labels.push(`<span class="chip">${esc(p.candidate_confidence)} confidence</span>`);
    if (p.surface) labels.push(`<span class="chip">${esc(p.surface)}</span>`);
    if (p.lit===true) labels.push(`<span class="chip accent">lights</span>`);
    if (p.indoor===true) labels.push(`<span class="chip">indoor</span>`);
    if (Number.isFinite(f._distanceKm)) labels.unshift(`<span class="chip accent">${distanceLabel(f._distanceKm)}</span>`);
    return `<div class="park-card"><button data-index="${i}"><div class="park-name">${esc(p.name)}</div><div class="park-meta">${esc(p.city || p.source_state || '')}${p.address ? `<br>${esc(p.address)}`:''}</div><div class="chips">${labels.join('')}</div></button></div>`;
  }).join('');
  [...wrap.querySelectorAll('button')].forEach(btn => btn.addEventListener('click', () => openPark(list[Number(btn.dataset.index)])));
}

function openPark(feature, { syncHash=true } = {}) {
  const p = feature.properties || {};
  const drawer = document.querySelector('#drawer');
  document.querySelector('#drawer-title').textContent = p.name || 'Unnamed skate location';
  document.querySelector('#drawer-body').innerHTML = `
    <div class="chips">
      <span class="chip accent">${esc(p.verification_status || 'osm_seeded')}</span>
      ${p.candidate_confidence ? `<span class="chip">${esc(p.candidate_confidence)} confidence</span>`:''}
      ${p.surface ? `<span class="chip">${esc(p.surface)}</span>`:''}
      ${p.indoor===true ? '<span class="chip">indoor</span>':''}
      ${p.lit===true ? '<span class="chip">lights</span>':''}
      ${p.covered===true ? '<span class="chip">covered</span>':''}
    </div>
    <dl class="kv">
      <dt>Candidate type</dt><dd>${esc(valueOr(p.candidate_kind))}</dd>
      <dt>Candidate reason</dt><dd>${esc(valueOr(p.candidate_reason))}</dd>
      <dt>State</dt><dd>${esc(valueOr(p.source_state))}</dd>
      <dt>Address</dt><dd>${esc(valueOr(p.address))}</dd>
      <dt>Surface</dt><dd>${esc(valueOr(p.surface))}</dd>
      <dt>Indoor</dt><dd>${yesNo(p.indoor)}</dd>
      <dt>Lights</dt><dd>${yesNo(p.lit)}</dd>
      <dt>Access</dt><dd>${esc(valueOr(p.access))}</dd>
      <dt>Fee</dt><dd>${esc(valueOr(p.fee))}</dd>
      <dt>Hours</dt><dd>${esc(valueOr(p.opening_hours))}</dd>
      <dt>Operator</dt><dd>${esc(valueOr(p.operator))}</dd>
      <dt>OSM source</dt><dd>${p.osm_url ? `<a class="link" href="${esc(p.osm_url)}" target="_blank" rel="noreferrer">${esc(p.source_id)}</a>` : esc(valueOr(p.source_id))}</dd>
      <dt>OSM updated</dt><dd>${esc(valueOr(p.osm_timestamp))}</dd>
      <dt>Ingested</dt><dd>${esc(valueOr(p.ingested_at))}</dd>
    </dl>`;
  drawer.classList.add('open');
  if (syncHash && p.source_id) history.replaceState(null, '', `#${new URLSearchParams({park:p.source_id})}`);
  const c = feature.geometry?.coordinates;
  if (c) map.easeTo({center:c, zoom:Math.max(map.getZoom(),12)});
}

async function loadSnapshot() {
  try {
    const res = await fetch('./data/skateparks.geojson', { cache:'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    state.metadata = json.metadata || {};
    mergeFeatures(json.features || []);
    openParkFromHash();
    const failed = state.metadata.failed_states || [];
    if (failed.length) document.querySelector('#notice').textContent = `Snapshot loaded with partial coverage: ${failed.length} state(s) failed the latest refresh (${failed.map(x=>x.state).join(', ')}). OSM records remain source candidates, not guarantees.`;
  } catch (error) {
    console.warn('Snapshot unavailable', error);
  }
}

function liveQuery(stateCode) {
  return `[out:json][timeout:90];area["ISO3166-2"="US-${stateCode}"][admin_level=4]->.a;(nwr["leisure"="skate_park"](area.a);nwr["leisure"="skatepark"](area.a);nwr["sport"~"(^|;)skateboard(;|$)"](area.a););out center tags meta;`;
}
function normalizeLive(el, st) {
  const coords = Number.isFinite(el.lon) ? [el.lon,el.lat] : Number.isFinite(el.center?.lon) ? [el.center.lon,el.center.lat] : null;
  if (!coords) return null;
  const t=el.tags||{};
  const name=t.name||t.official_name||t.alt_name||'Unnamed skate location';
  const classification=classifySourceCandidate(t,name);
  if (!classification) return null;
  const sourceId=`osm:${el.type}/${el.id}`;
  return { type:'Feature', id:sourceId, geometry:{type:'Point',coordinates:coords}, properties:{
    source_id:sourceId, source:'OpenStreetMap', osm_type:el.type, osm_id:String(el.id), osm_url:`https://www.openstreetmap.org/${el.type}/${el.id}`, source_state:st,
    matched_by:matchedBy(t), candidate_kind:classification.kind, candidate_confidence:classification.confidence, candidate_reason:classification.reason,
    name, named:Boolean(t.name), address:[t['addr:housenumber'],t['addr:street'],t['addr:city'],t['addr:state'],t['addr:postcode']].filter(Boolean).join(' ')||null,
    city:t['addr:city']||null, leisure:t.leisure||null, sport:t.sport||null, surface:t.surface||null, indoor:['yes','true','1'].includes(String(t.indoor).toLowerCase())?true:['no','false','0'].includes(String(t.indoor).toLowerCase())?false:null,
    lit:['yes','true','1'].includes(String(t.lit).toLowerCase())?true:['no','false','0'].includes(String(t.lit).toLowerCase())?false:null, covered:['yes','true','1'].includes(String(t.covered).toLowerCase())?true:null,
    access:t.access||null, fee:t.fee||null, opening_hours:t.opening_hours||null, operator:t.operator||null, website:t.website||null, verification_status:'osm_seeded', osm_timestamp:el.timestamp||null, ingested_at:new Date().toISOString(), tags:t
  }};
}

async function loadStateLive() {
  const st = stateSelect.value;
  if (!st) { alert('Choose a state first.'); return; }
  const btn = document.querySelector('#load-live');
  btn.disabled=true; const before=btn.textContent; btn.textContent=`Loading US-${st}…`;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'}, body:new URLSearchParams({data:liveQuery(st)}) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json=await response.json();
    const elements=json.elements||[];
    const features=elements.map(el=>normalizeLive(el,st)).filter(Boolean);
    const excluded=elements.length-features.length;
    mergeFeatures(features); state.liveLoaded.add(st);
    document.querySelector('#notice').textContent=`Loaded ${features.length.toLocaleString()} classified OSM skate-location candidates for US-${st}; quarantined ${excluded.toLocaleString()} non-facility candidate(s). Live mode is for development; use the governed refresh for production.`;
  } catch (error) {
    document.querySelector('#notice').textContent=`Live query failed: ${error.message}. Public Overpass instances can shed load; try again later or use the governed refresh workflow.`;
  } finally { btn.disabled=false; btn.textContent=before; }
}

function findNearMe() {
  const notice = document.querySelector('#notice');
  if (!navigator.geolocation) {
    notice.textContent = 'This browser does not expose geolocation. You can still search by city or state.';
    return;
  }
  const btn = document.querySelector('#near-me');
  btn.disabled = true; const before = btn.textContent; btn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(pos => {
    const coords = [pos.coords.longitude, pos.coords.latitude];
    state.userLocation = coords;
    if (state.userMarker) state.userMarker.remove();
    state.userMarker = new maplibregl.Marker().setLngLat(coords).addTo(map);
    map.easeTo({ center:coords, zoom:10 });
    notice.textContent = 'Location found. Source candidates in the sidebar are now sorted by straight-line distance from you within the current map view.';
    renderSidebar();
    btn.disabled=false; btn.textContent=before;
  }, err => {
    notice.textContent = `Could not use your location: ${err.message}. Search by city or state instead.`;
    btn.disabled=false; btn.textContent=before;
  }, { enableHighAccuracy:false, timeout:10000, maximumAge:300000 });
}

map.on('load', async () => { addMapLayers(); await loadSnapshot(); applyFilters(); });
map.on('moveend', renderSidebar);
for (const id of ['search','state','surface','environment','verification']) document.querySelector(`#${id}`).addEventListener(id==='search'?'input':'change', applyFilters);
document.querySelector('#load-live').addEventListener('click', loadStateLive);
document.querySelector('#near-me').addEventListener('click', findNearMe);
window.addEventListener('hashchange', openParkFromHash);
document.querySelector('#drawer-close').addEventListener('click', () => { document.querySelector('#drawer').classList.remove('open'); history.replaceState(null, '', location.pathname + location.search); });
document.querySelector('#fit').addEventListener('click', () => {
  const fs=state.filtered.features; if (!fs.length) return;
  const bounds=new maplibregl.LngLatBounds(); fs.forEach(f=>bounds.extend(f.geometry.coordinates)); map.fitBounds(bounds,{padding:70,maxZoom:11});
});
