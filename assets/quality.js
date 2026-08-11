async function loadConcreteAtlasQualityReport() {
  const named = document.querySelector('#quality-named');
  const surface = document.querySelector('#quality-surface');
  const failed = document.querySelector('#quality-failed');

  try {
    const response = await fetch('./data/quality-report.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status}`);
    const quality = await response.json();

    if (named) {
      const value = quality.field_coverage?.named?.percent;
      named.textContent = value == null ? '—' : `${value}%`;
    }
    if (surface) {
      const value = quality.field_coverage?.surface_known?.percent;
      surface.textContent = value == null ? '—' : `${value}%`;
    }
    if (failed) {
      const value = quality.totals?.failed_primary_states;
      failed.textContent = value == null ? '—' : String(value);
    }
  } catch (error) {
    console.warn('Concrete Atlas quality report unavailable', error);
  }
}

loadConcreteAtlasQualityReport();
