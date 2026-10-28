import { randomUUID } from 'node:crypto';
import { qlooImageUrl } from '../shared/qloo-image.mjs';
import { movieDetails } from './movie-details.mjs';
import { sightseeingEligibility } from './sightseeing.mjs';
import { localityIntent, localityMetadata, localityOrder } from './localities.mjs';
import { countryCodes, countryName } from '../shared/countries.mjs';
import { LiveError, normalizeOuting, RESTAURANT_TAG, SIGHTSEEING_TAG } from './transport.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types = { locality: 'urn:entity:locality', film: 'urn:entity:movie', artist: 'urn:entity:artist', person: 'urn:entity:person', game: 'urn:entity:videogame' };
const TTL = 15 * 60_000;
const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : '';
const rows = value => Array.isArray(value) ? value : value?.status === 'ok' && Array.isArray(value.results) ? value.results : null;
function locationLabel({ name, detail }) {
  if (!detail || detail === name || detail.startsWith(`${name},`)) return detail || name;
  return `${name}, ${detail}`;
}
function localityName(result) {
  const aliases = result.properties?.akas;
  if (Array.isArray(aliases)) {
    for (const alias of aliases.slice(0, 100)) {
      if (alias?.language === 'en') {
        const name = clean(alias.value).trim();
        if (name) return name;
      }
    }
  }
  return clean(result.name);
}
function localityDetail(result) {
  const geocode = result.properties?.geocode;
  const originalName = clean(result.name);
  const disambiguation = clean(result.disambiguation, 160).trim();
  const hasOriginal = disambiguation === originalName || disambiguation.startsWith(`${originalName},`);
  const parts = [localityName(result) !== originalName && !hasOriginal ? originalName : null, result.disambiguation, geocode?.admin1_region, geocode?.country_code];
  const ancestors = result.properties?.ancestors;
  if (Array.isArray(ancestors)) for (const ancestor of ancestors.slice(0, 8)) parts.push(ancestor?.name);
  const included = [];
  for (const part of parts) {
    const value = clean(part, 160).trim().replace(/\s*,\s*/g, ', ');
    if (!value) continue;
    // Preserve the provider's hierarchy (e.g. New York city and state), but do
    // not append another field already present as a complete component sequence.
    if (!`, ${included.join(', ')}, `.toLowerCase().includes(`, ${value}, `.toLowerCase())) included.push(value);
  }
  return included.join(', ').slice(0, 500);
}

export function createLiveService({ transport, now = Date.now }) {
  const tokens = new Map(); const searches = new Map(); const snapshots = new Map();
  let active; let pausedUntil = 0;
  function purge(map, max) {
    for (const [key, entry] of map) if (entry.expires <= now()) map.delete(key);
    while (map.size > max) map.delete(map.keys().next().value);
  }
  async function work(key, fn) {
    if (now() < pausedUntil) throw new LiveError('RATE_LIMIT');
    if (active) { if (active.key === key) return structuredClone(await active.promise); throw new LiveError('BUSY'); }
    // Assign the lock before invoking the provider, including synchronous failures.
    const promise = Promise.resolve().then(fn); active = { key, promise };
    try { return structuredClone(await promise); }
    catch (error) {
      const safe = error instanceof LiveError ? error : new LiveError(error?.code);
      if (safe.code === 'RATE_LIMIT') pausedUntil = now() + 60_000;
      throw safe;
    } finally { active = undefined; }
  }
  function token(value, type) {
    const entry = tokens.get(value);
    if (!entry) throw new LiveError('INVALID_INPUT');
    if (entry.expires <= now()) throw new LiveError('EXPIRED_INPUT');
    if (type === 'locality' ? entry.type !== 'locality' : entry.type === 'locality') throw new LiveError('INVALID_INPUT');
    return entry;
  }
  return {
    getSnapshot(id) {
      purge(snapshots, 20);
      const entry = [...snapshots.values()].find(value => value.value.id === id);
      return entry ? structuredClone(entry.value) : undefined;
    },
    async search(input) {
      const { type, query } = input ?? {};
      if (!Object.hasOwn(types, type) || typeof query !== 'string' || !query.trim() || query.length > 120 || /[\x00-\x1f\x7f]/.test(query)) throw new LiveError('INVALID_INPUT');
      if (input.countryCode !== undefined && (type !== 'locality' || !countryCodes.has(input.countryCode))) throw new LiveError('INVALID_INPUT');
      const intent = type === 'locality' ? localityIntent(query, input.countryCode) : null;
      const key = JSON.stringify([type, query.trim(), input.countryCode ?? null]); purge(searches, 50);
      if (searches.has(key)) return structuredClone(searches.get(key).value);
      return work(`search:${key}`, async () => {
        const primary = rows(await transport.search(type, intent?.firstQuery ?? query.trim()));
        if (!primary) throw new LiveError('UPSTREAM');
        const found = primary.slice(0, 10);
        if (intent) {
          const resolvedHint = intent.hint && found.some(item => item?.properties?.external?.wikidata?.id === intent.hint.id);
          const qualified = found.some(item => item && (!intent.country || localityMetadata(item).countryCode === intent.country));
          const alternative = !resolvedHint && intent.hint ? intent.hint.lookup : !qualified && intent.city !== intent.firstQuery ? intent.city : null;
          if (alternative && alternative !== intent.firstQuery) {
            const extra = rows(await transport.search(type, alternative));
            if (!extra) throw new LiveError('UPSTREAM');
            found.push(...extra.slice(0, 10));
          }
        }
        const matches = []; const ids = new Set();
        for (const result of found) {
          const resultType = result?.subtype ?? result?.type;
          const typeMatches = typeof resultType === 'string' ? resultType === types[type] : result?.types?.includes(types[type]);
          if (!uuid.test(result?.entity_id) || !typeMatches || !clean(result.name) || ids.has(result.entity_id.toLowerCase())) continue;
          ids.add(result.entity_id.toLowerCase());
          const name = type === 'locality' ? localityName(result) : clean(result.name);
          const choice = { id: result.entity_id.toLowerCase(), name, type,
            detail: type === 'locality' ? localityDetail(result) : clean(result.disambiguation, 300) || (Number.isInteger(result.properties?.release_year) ? String(result.properties.release_year) : '') };
          if (type === 'locality') {
            Object.assign(choice, localityMetadata(result));
            if (intent.country && choice.countryCode !== intent.country) continue;
          }
          if (type === 'person') {
            for (const candidate of [result.properties?.short_description, result.properties?.description]) {
              const description = clean(candidate, 240).trim();
              if (description && description.toLowerCase() !== name.trim().toLowerCase()) { choice.description = description; break; }
            }
            const imageUrl = qlooImageUrl(result.properties?.image?.url);
            if (imageUrl) choice.imageUrl = imageUrl;
          }
          matches.push(choice);
          if (type !== 'locality' && matches.length === 5) break;
        }
        // A user cannot confirm geography when distinct IDs have identical visible labels.
        const signature = choice => [choice.name, choice.countryName, choice.geographicLevel, choice.originalName, choice.detail].join(' · ').replace(/\s+/g, ' ').trim().toLowerCase();
        const counts = new Map();
        if (type === 'locality') for (const match of matches) counts.set(signature(match), (counts.get(signature(match)) ?? 0) + 1);
        if (intent) matches.sort((a, b) => localityOrder(a, intent.city) - localityOrder(b, intent.city));
        const choices = matches.filter(match => type !== 'locality' || counts.get(signature(match)) === 1).slice(0, 5).map(match => {
          const choice = { ...match, token: randomUUID() };
          tokens.set(choice.token, { ...choice, expires: now() + TTL }); return choice;
        });
        purge(tokens, 250);
        const value = { choices };
        if (intent?.country && !choices.length) value.message = `No distinguishable location with verified country metadata for ${countryName(intent.country)} was found. Try a more specific city or local spelling, or change the country filter.`;
        else if ([...counts.values()].some(count => count > 1)) value.message = 'Some location matches cannot be distinguished. Make the location search more specific, including state or region and country.';
        searches.set(key, { value, expires: now() + TTL }); purge(searches, 50);
        return value;
      });
    },
    async compare(input) {
      if (!input || input.confirmed !== true || !Array.isArray(input.participants) || input.participants.length < 2 || input.participants.length > 8) throw new LiveError('INVALID_INPUT');
      const outing = normalizeOuting(input); const { outingType, maxPriceLevel } = outing;
      const location = outingType === 'movies' ? { id: null, name: 'Movie night', detail: '' } : token(input.locationToken, 'locality');
      if (input.requirements !== undefined && (typeof input.requirements !== 'string' || input.requirements.length > 500 || /[\x00-\x1f\x7f]/.test(input.requirements))) throw new LiveError('INVALID_INPUT');
      const requirements = input.requirements?.trim() ?? '';
      const discoveryMode = input.discoveryMode === undefined ? 'pooled' : input.discoveryMode;
      if (!['pooled', 'individual'].includes(discoveryMode)) throw new LiveError('INVALID_INPUT');
      const participants = input.participants.map((p, i) => {
        if (typeof p?.label !== 'string' || !p.label.trim() || p.label.length > 40 || /[\x00-\x1f\x7f]/.test(p.label)) throw new LiveError('INVALID_INPUT');
        const choice = token(p.token, 'favorite');
        return { id: `p${i + 1}`, label: p.label.trim(), seed: { id: choice.id, name: choice.name, type: choice.type } };
      });
      const key = JSON.stringify([location.id, participants, requirements, discoveryMode, outing]); purge(snapshots, 20);
      if (snapshots.has(key)) return structuredClone(snapshots.get(key).value);
      return work(`compare:${key}`, async () => {
        const seeds = [...new Set(participants.map(p => p.seed.id))];
        const discovered = rows(await transport.discover(location.id, seeds, outing));
        if (!discovered) throw new LiveError('UPSTREAM');
        const candidates = []; const ids = new Set();
        const screenedOut = new Map();
        const priceLevel = c => Number.isInteger(c?.properties?.price_level) && c.properties.price_level >= 1 && c.properties.price_level <= 4 ? c.properties.price_level : null;
        const eligible = c => {
          if (seeds.includes(c?.entity_id?.toLowerCase())) return false;
          // Insights returns subtype; search/workflow responses can use types.
          // An explicit conflicting subtype must not pass through a types fallback.
          if (outingType === 'movies') return c?.subtype !== undefined
            ? c.subtype === 'urn:entity:movie'
            : Array.isArray(c?.types) && c.types.includes('urn:entity:movie');
          if (outingType === 'sightseeing') {
            const fit = sightseeingEligibility(c?.tags);
            if (!fit.eligible && uuid.test(c?.entity_id) && clean(c.name)) screenedOut.set(c.entity_id.toLowerCase(), { id: c.entity_id.toLowerCase(), name: clean(c.name), reason: fit.reason });
            return fit.eligible;
          }
          return outingType !== 'restaurants' || (Array.isArray(c?.tags) && c.tags.some(t => t?.id === RESTAURANT_TAG) && (maxPriceLevel === null || (priceLevel(c) !== null && priceLevel(c) <= maxPriceLevel)));
        };
        function addCandidate(c, seedId) {
          if (!uuid.test(c?.entity_id) || !clean(c.name) || ids.has(c.entity_id.toLowerCase()) || !eligible(c)) return;
          const id = c.entity_id.toLowerCase(); ids.add(id);
          const description = outingType === 'movies' ? ''
            : clean(c.properties?.short_description, 400).trim() || clean(c.properties?.description, 400).trim();
          const imageUrl = qlooImageUrl(c.properties?.image?.url);
          candidates.push({ id, name: clean(c.name), address: clean(c.properties?.address, 300), affinities: [],
            ...(imageUrl ? { imageUrl } : {}),
            ...(description ? { description } : {}),
            ...(outingType !== 'movies' ? { placeTypes: [...new Set((Array.isArray(c.tags) ? c.tags : []).slice(0, 100)
              .filter(t => /^urn:tag:(genre|category):place:[a-z0-9_:-]+$/i.test(t?.id ?? ''))
              .map(t => clean(t.name, 80).trim()).filter(Boolean))].slice(0, 3) } : {}),
            ...(outingType === 'sightseeing' ? { eligibilityTags: [{ id: SIGHTSEEING_TAG, name: 'Tourist attraction' }] } : {}),
            category: outingType === 'sightseeing' ? 'tourist_attraction' : outingType === 'movies' ? 'movie' : outingType === 'restaurants' ? 'restaurant' : null, priceLevel: outingType === 'movies' ? null : priceLevel(c),
            ...(outingType === 'movies' ? movieDetails(c.properties) : { releaseYear: null }),
            discovery: seedId ? { kind: 'individual', seedId } : { kind: 'pooled' },
            contributions: (Array.isArray(c.explainability?.['signal.interests.entities']) ? c.explainability['signal.interests.entities'] : []).filter(x => seeds.includes(x.entity_id?.toLowerCase()) && typeof x.score === 'number' && Number.isFinite(x.score)).map(x => ({ seedId: x.entity_id.toLowerCase(), score: x.score })) });
        }
        // Leave a first discovery turn for every distinct taste, even in a larger group.
        const pooledLimit = discoveryMode === 'individual' && seeds.length > 1 ? Math.min(5, 10 - seeds.length) : 5;
        for (const c of discovered) {
          addCandidate(c);
          if (candidates.length === pooledLimit) break;
        }
        // One call per distinct taste, including the outlier; duplicate people still
        // keep separate rows in the decision matrix. A single taste adds no new query.
        if (discoveryMode === 'individual' && seeds.length > 1) {
          const pools = [];
          for (const seed of seeds) {
            const pool = rows(await transport.discover(location.id, [seed], outing));
            if (!pool) throw new LiveError('UPSTREAM');
            const seen = new Set();
            pools.push({ seed, candidates: pool.filter(c => {
              const id = typeof c?.entity_id === 'string' ? c.entity_id.toLowerCase() : '';
              if (!uuid.test(id) || !clean(c.name) || seen.has(id) || !eligible(c)) return false;
              seen.add(id); return true;
            }).slice(0, 5) });
          }
          for (let i = 0; i < 5 && candidates.length < 10; i++) {
            for (const pool of pools) {
              // Skip overlaps within a turn so duplicates cannot consume a taste's slot.
              while (pool.candidates.length && ids.has(pool.candidates[0].entity_id.toLowerCase())) pool.candidates.shift();
              if (pool.candidates.length) addCandidate(pool.candidates.shift(), pool.seed);
              if (candidates.length === 10) break;
            }
          }
        }
        const ranks = new Map();
        if (candidates.length) for (const seed of seeds) {
          const ranked = rows(await transport.rank(candidates.map(c => c.id), seed, outing));
          if (!ranked) throw new LiveError('UPSTREAM');
          const values = new Map();
          for (const row of ranked) {
            const id = row?.entity_id?.toLowerCase();
            // Conflicting/duplicate rows are inadequate evidence, never silently last-wins.
            values.set(id, values.has(id) ? null : typeof row.affinity === 'number' && Number.isFinite(row.affinity) ? row.affinity : null);
            const candidate = candidates.find(item => item.id === id);
            const imageUrl = qlooImageUrl(row?.imageUrl);
            if (candidate && !candidate.imageUrl && imageUrl) candidate.imageUrl = imageUrl;
          }
          ranks.set(seed, values);
        }
        for (const c of candidates) c.affinities = participants.map(p => ranks.get(p.seed.id)?.get(c.id) ?? null);
        for (const id of ids) screenedOut.delete(id);
        const warnings = [
          'Live Qloo evidence. Cultural relationships do not predict personal enjoyment.',
          'Ranks are relative to this shortlist. Small affinity gaps may not be meaningful.',
          ...(outingType === 'movies' ? ['Streaming availability, subscription costs, runtime, language and age suitability are not verified. Check before watching.'] : [
            'Exact prices, hours, accessibility and availability are not verified. Confirm practical details before going.',
            'The confirmed locality was sent to Qloo with radius 0. Returned addresses are not independently verified.'
          ])
        ];
        if (outingType === 'sightseeing') {
          warnings.push('Sightseeing category checks exclude explicit accommodation, nightlife and private-event venues, plus dining/event places without a specific sightseeing category. These checks do not verify public access, opening hours, outdoor suitability or travel distance.');
          if (screenedOut.size) warnings.push(`${screenedOut.size} returned ${screenedOut.size === 1 ? 'place' : 'places'} excluded by sightseeing category checks. The search was not automatically broadened.`);
        }
        if (requirements) warnings.push(`Your essential requirements are not verified: ${requirements}`);
        if (outingType === 'restaurants') warnings.push(maxPriceLevel === null ? 'Restaurant category is supplied by Qloo tags. Price categories may be unknown; exact bills are not verified.' : `Only Qloo-tagged restaurants with a known price category at or below ${maxPriceLevel} are included. These categories do not guarantee an exact bill.`);
        if (discoveryMode === 'individual') warnings.push('This shortlist includes suggestions for each distinct taste, capped at ten. Broader coverage does not guarantee everyone will like an option.');
        const snapshot = { id: `live-${randomUUID()}`, title: outingType === 'sightseeing' ? 'Your sightseeing options' : outingType === 'movies' ? 'Your movie night' : outingType === 'restaurants' ? 'Your shared meal' : 'Your shared outing', source: 'live', recordedAt: new Date(now()).toISOString(), location: locationLabel(location),
          locationId: location.id, ...(outingType !== 'movies' ? { locationDetails: { countryCode: location.countryCode ?? null, countryName: location.countryName ?? '', geographicLevel: location.geographicLevel ?? 'Area', originalName: location.originalName ?? location.name } } : {}), requirements, discoveryMode, outingType, maxPriceLevel, participants, candidates, warnings,
          ...(outingType === 'sightseeing' ? { sightseeingSelection: { policy: 'sightseeing-categories-v1', excluded: [...screenedOut.values()] } } : {}),
          sourceRefs: [outingType === 'movies' ? 'Qloo /v2/insights: filter.type=urn:entity:movie; pooled discovery; no geographic filter' : `Qloo /v2/insights: filter.location=${location.id}; radius=0; pooled discovery`,
            ...(outingType === 'restaurants' ? [`Qloo /v2/insights: filter.tags=${RESTAURANT_TAG}; filter.price_level.max=${maxPriceLevel ?? 'not set'}`] : []),
            ...(outingType === 'sightseeing' ? [`Qloo /v2/insights: filter.tags=${SIGHTSEEING_TAG}`] : []),
            ...(discoveryMode === 'individual' && seeds.length > 1 ? seeds.map(seed => outingType === 'movies'
              ? `Qloo /v2/insights: filter.type=urn:entity:movie; individual discovery signal=${seed}; no geographic filter`
              : `Qloo /v2/insights: filter.location=${location.id}; radius=0; individual discovery signal=${seed}`) : []),
            ...seeds.map(seed => `Qloo /v2/insights: signal=${seed}; filter.results.entities=same ${candidates.length} candidate IDs`)] };
        snapshots.set(key, { value: snapshot, expires: now() + TTL }); purge(snapshots, 20);
        return snapshot;
      });
    }
  };
}
