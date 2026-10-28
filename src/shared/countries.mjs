// ISO 3166-1 alpha-2 countries/territories; labels are supplied by the runtime's CLDR data.
const codes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
export const countryCodes = new Set(codes);
const english = new Intl.DisplayNames(['en'], { type: 'region' });
export const countries = codes.map(code => ({ code, name: english.of(code) })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
export const countryName = code => countryCodes.has(code) ? english.of(code) : '';
export const normalizeGeography = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
const names = new Map();
for (const locale of ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'tr', 'nl', 'pl', 'uk', 'fa', 'ur']) {
  const labels = new Intl.DisplayNames([locale], { type: 'region' });
  for (const code of codes) names.set(normalizeGeography(labels.of(code)), code);
}
for (const [name, code] of [['United States of America', 'US'], ['USA', 'US'], ['UK', 'GB'], ['Great Britain', 'GB'], ['UAE', 'AE']]) names.set(normalizeGeography(name), code);
export function countryCodeFor(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return countryCodes.has(code) ? code : names.get(normalizeGeography(value)) ?? null;
}
// Free-text hierarchies/queries can contain state abbreviations such as CA/IL.
// ISO codes are accepted only in explicitly country-typed metadata or inputs.
export const countryCodeForName = value => names.get(normalizeGeography(value)) ?? null;
