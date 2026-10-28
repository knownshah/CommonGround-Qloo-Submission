const text = (value, limit) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, limit) : '';

export function movieDetails(properties = {}) {
  const p = properties ?? {};
  const short = Array.isArray(p.short_descriptions)
    ? p.short_descriptions.slice(0, 50).find(d => Array.isArray(d?.languages) && d.languages.includes('en') && text(d.value, 400))?.value : undefined;
  const description = text(short, 400) || text(p.short_description, 400) || text(p.description, 400) || text(p.plot_summary, 400);
  const genres = Array.isArray(p.genres) ? [...new Set(p.genres.slice(0, 20).map(g => text(g, 50)).filter(Boolean))].slice(0, 3) : [];
  return {
    releaseYear: Number.isInteger(p.release_year) && p.release_year >= 1888 && p.release_year <= 9999 ? p.release_year : null,
    ...(Number.isInteger(p.duration) && p.duration > 0 && p.duration <= 1440 ? { durationMinutes: p.duration } : {}),
    ...(genres.length ? { genres } : {}),
    ...(description ? { description } : {})
  };
}
