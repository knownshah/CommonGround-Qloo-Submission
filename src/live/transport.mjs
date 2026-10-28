import { createCliRunner } from './cli-runner.mjs';
import { qlooImageUrl } from '../shared/qloo-image.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types = { locality: 'locality', film: 'movie', artist: 'artist', person: 'person', game: 'videogame' };
export const RESTAURANT_TAG = 'urn:tag:genre:place:restaurant';
export const SIGHTSEEING_TAG = 'urn:tag:genre:place:tourist_attraction';
export class LiveError extends Error {
  constructor(code) {
    const messages = {
      INVALID_INPUT: 'Check the city and each person’s confirmed favorite before continuing.',
      EXPIRED_INPUT: 'These confirmations expired. Search and confirm the city and favorites again.',
      BUSY: 'Another live search is running. Wait for it to finish before trying again.',
      RATE_LIMIT: 'Qloo’s request limit was reached. Live requests are paused; you can use the recorded demo.',
      AUTH: 'Live Qloo access is not available. Check the private server setup or use the recorded demo.',
      TIMEOUT: 'Qloo took too long to respond. Your previous comparison is still available.',
      UPSTREAM: 'Qloo could not complete this request. Your previous comparison is still available.'
    };
    super(messages[code] ?? messages.UPSTREAM); this.code = Object.hasOwn(messages, code) ? code : 'UPSTREAM';
  }
}
const requireIds = ids => { if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => typeof id !== 'string' || !uuid.test(id))) throw new LiveError('INVALID_INPUT'); };
export function normalizeOuting(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LiveError('INVALID_INPUT');
  const outingType = input.outingType === undefined ? 'places' : input.outingType;
  const maxPriceLevel = input.maxPriceLevel === undefined ? null : input.maxPriceLevel;
  if (!['places', 'restaurants', 'movies', 'sightseeing'].includes(outingType) || (maxPriceLevel !== null && (!Number.isInteger(maxPriceLevel) || maxPriceLevel < 1 || maxPriceLevel > 4 || outingType !== 'restaurants'))) throw new LiveError('INVALID_INPUT');
  return { outingType, maxPriceLevel };
}
const runCli = createCliRunner();
function failure(error) {
  if (error instanceof LiveError) return error;
  if (['BUSY', 'TIMEOUT', 'UPSTREAM'].includes(error?.code)) return new LiveError(error.code);
  let code = '';
  try { const data = JSON.parse(error.stdout ?? '{}'); code = `${data.error?.code ?? data.code ?? ''} ${data.message ?? ''}`; } catch {}
  if (/RATE_LIMIT|rate limit|too many requests|\b429\b/i.test(code)) return new LiveError('RATE_LIMIT');
  if (/AUTH|\b401\b|\b403\b/i.test(code)) return new LiveError('AUTH');
  if (/TIMEOUT/i.test(code)) return new LiveError('TIMEOUT');
  return new LiveError('UPSTREAM');
}
export function createQlooTransport({ run = runCli } = {}) {
  async function execute(args, input) {
    try {
      const output = await run(args, input);
      if (Buffer.byteLength(output) > 2 * 1024 * 1024) throw new LiveError('UPSTREAM');
      const result = JSON.parse(output);
      if (result?.error) throw Object.assign(new Error('Provider failed'), { stdout: output });
      return result;
    } catch (error) { throw failure(error); }
  }
  return {
    async prepare() {
      // The pinned harness returns help before configuration/API routing. Load
      // its local imports once before serving; no discovery or ranking request.
      try { await run(['--help']); } catch (error) { throw failure(error); }
    },
    async search(type, query) {
      if (!Object.hasOwn(types, type) || typeof query !== 'string' || !query.trim() || query.length > 120 || /[\x00-\x1f\x7f]/.test(query)) throw new LiveError('INVALID_INPUT');
      const fields = ['entity_id,name,type,subtype,types,disambiguation,location,properties.release_year,properties.place,properties.geocode,properties.ancestors,properties.akas'];
      if (type === 'locality') fields.push('properties.admin_level,properties.external.wikidata');
      if (type === 'person') fields.push('properties.short_description,properties.description,properties.image.url');
      return execute(['api', 'search', '--query', query.trim(), '--type', types[type], '--take', '5', '--json', '--fields', fields.join(',')]);
    },
    async discover(locationId, seeds, options = {}) {
      const { outingType, maxPriceLevel } = normalizeOuting(options);
      requireIds(seeds); if (outingType !== 'movies') requireIds([locationId]);
      return execute(['api', 'insights', '--type', outingType === 'movies' ? 'movie' : 'place', '--signal-entities', seeds.join(','), '--take', '5', '--json', '--params', JSON.stringify({ ...(outingType !== 'movies' ? { 'filter.location': locationId, 'filter.location.radius': 0 } : {}), 'feature.explainability': true,
        ...(outingType === 'restaurants' ? { 'filter.tags': RESTAURANT_TAG } : {}), ...(outingType === 'sightseeing' ? { 'filter.tags': SIGHTSEEING_TAG } : {}), ...(maxPriceLevel !== null ? { 'filter.price_level.max': maxPriceLevel } : {}) })]);
    },
    async rank(ids, seed, options = {}) {
      requireIds(ids); requireIds([seed]);
      const { outingType } = normalizeOuting(options);
      // Inputs were grounded by our server. Direct Insights avoids the workflow
      // wrapper's per-UUID hydration requests before ranking this known set.
      const results = await execute(['api', 'insights', '--type', outingType === 'movies' ? 'movie' : 'place', '--signal-entities', seed, '--take', String(ids.length), '--json', '--params', JSON.stringify({ 'filter.results.entities': ids.join(',') })]);
      if (!Array.isArray(results)) throw new LiveError('UPSTREAM');
      return results.map(row => {
        const affinity = row?.affinity ?? row?.query?.affinity;
        const imageUrl = qlooImageUrl(row?.properties?.image?.url);
        return { entity_id: row?.entity_id, ...(affinity === undefined ? {} : { affinity }), ...(imageUrl ? { imageUrl } : {}) };
      });
    }
  };
}
