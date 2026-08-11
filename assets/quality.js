(async function loadQualityReport() {
  const named = document.querySelector('#quality-named');
  const surface = document.querySelector('#quality-surface');
  const failed = document.querySelector('#quality-failed');
  if (!named || !surface || !failed) return;

  try {
    const response = await fetch('./data/quality-report.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status}`);
    const report = await response.json();
    const pct = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
    named.textContent = pct(report?.field_coverage?.named?.percent);
    surface.textContent = pct(report?.field_coverage?.surface_known?.percent);
    const failedCount = report?.totals?.failed_primary_states;
    failed.textContent = Number.isFinite(failedCount) ? String(failedCount) : '—';
  } catch (error) {
    console.warn('Quality observatory report unavailable', error);
  }
})();
