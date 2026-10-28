import { countryCodeFor, countryCodeForName, countryName, normalizeGeography } from '../shared/countries.mjs';

// Identity-bound display aids, not inferred IDs or a general translation service.
// Verified 2026-10-16 against the provider-linked Wikidata records (CC0):
// https://www.wikidata.org/wiki/Q220 and https://www.wikidata.org/wiki/Q1490
const known = [
  { id: 'Q220', names: ['Rome', 'Roma'], lookup: 'Roma', name: 'Rome', countryCode: 'IT', level: 'City' },
  { id: 'Q1490', names: ['Tokyo', 'Tokyo Metropolis', '東京都'], lookup: '東京都', name: 'Tokyo Metropolis', countryCode: 'JP', level: 'Metropolitan region' }
];
const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
const levels = { city: 'City', town: 'Town', village: 'Village', municipality: 'Municipality', neighbourhood: 'Neighbourhood', neighborhood: 'Neighbourhood', quarter: 'Neighbourhood', suburb: 'Suburb', district: 'District', county: 'County', state: 'Region', province: 'Province', region: 'Region', country: 'Country', island: 'Island', islet: 'Islet' };

export function localityIntent(query, countryCode) {
  const parts = query.split(',').map(part => part.trim());
  const inferred = parts.length > 1 && normalizeGeography(parts.at(-1)) !== 'georgia' ? countryCodeForName(parts.at(-1)) : null;
  const country = countryCode || inferred;
  const city = parts.length > 1 && inferred ? parts.slice(0, -1).join(', ') : query.trim();
  const hint = known.find(item => item.names.some(name => normalizeGeography(name) === normalizeGeography(city)) && (!country || item.countryCode === country));
  return { city, country, hint, firstQuery: countryCode ? city : query.trim() };
}

export function localityMetadata(result) {
  const props = result.properties ?? {};
  const ancestors = Array.isArray(props.ancestors) ? props.ancestors.slice(0, 24) : [];
  const countryAncestor = ancestors.find(item => item?.place === 'country' || item?.admin_level === 2);
  let countryCode = countryCodeFor(props.geocode?.country_code) || countryCodeFor(countryAncestor?.name);
  // Exact hierarchy components only; never substring matches or the user's query.
  if (!countryCode) countryCode = countryCodeForName(clean(result.disambiguation, 500).split(',').at(-1)?.trim());
  let identity = known.find(item => item.id === props.external?.wikidata?.id);
  if (identity && countryCode && identity.countryCode !== countryCode) identity = undefined;
  countryCode ||= identity?.countryCode ?? null;
  const alias = (Array.isArray(props.akas) ? props.akas.slice(0, 100) : []).find(item => item?.language === 'en' && clean(item.value));
  const name = clean(alias?.value) || identity?.name || clean(result.name);
  const originalName = clean(result.name);
  return { name, originalName, countryCode, countryName: countryName(countryCode),
    geographicLevel: identity?.level ?? levels[props.place] ?? 'Area',
    ...(identity ? { identitySource: `https://www.wikidata.org/wiki/${identity.id}` } : {}) };
}

export function localityOrder(choice, city) {
  const names = [choice.name, choice.originalName];
  const identity = known.find(item => item.name === choice.name && item.countryCode === choice.countryCode);
  if (identity) names.push(...identity.names);
  const exact = names.some(name => normalizeGeography(name) === normalizeGeography(city));
  const levels = { City: 0, Town: 1, Municipality: 2, 'Metropolitan region': 3, Region: 4, Province: 4, County: 5, District: 5, Area: 9, Neighbourhood: 7, Suburb: 7, Island: 8, Islet: 8, Country: 10 };
  return (exact ? 0 : 20) + (levels[choice.geographicLevel] ?? 6);
}
