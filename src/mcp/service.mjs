import { randomBytes } from 'node:crypto';
import { createSession, applyAction } from '../shared/session.mjs';

export class HandoffError extends Error {
  constructor(code) { super(code); this.name = 'HandoffError'; this.code = code; }
}

const invalid = () => new HandoffError('INVALID_INPUT');
const expired = () => new HandoffError('CONTEXT_EXPIRED');
const clone = value => structuredClone(value);

export function createHandoffService({ liveService, now = Date.now, ttlMs = 30 * 60_000, maxSessions = 20 } = {}) {
  if (!liveService || typeof liveService.search !== 'function' || typeof liveService.compare !== 'function' ||
      typeof now !== 'function' || !Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxSessions) || maxSessions < 1) throw invalid();
  const revisions = new Map();
  const purge = () => {
    const time = now();
    for (const [token, revision] of revisions) if (revision.expires <= time) revisions.delete(token);
    while (revisions.size > maxSessions) revisions.delete(revisions.keys().next().value);
  };
  const save = (session, expires) => {
    purge();
    const token = randomBytes(32).toString('hex');
    revisions.set(token, { session: clone(session), expires, created: now() });
    purge();
    return { token, expiresAt: new Date(expires).toISOString(), session: clone(session) };
  };
  const get = token => {
    purge();
    if (typeof token !== 'string' || !revisions.has(token)) throw expired();
    return revisions.get(token);
  };
  return {
    async resolve(input) { return clone(await liveService.search(clone(input))); },
    async compare(input) {
      if (!input || input.confirmed !== true) throw invalid();
      const snapshot = await liveService.compare(clone(input));
      try { return save(createSession(snapshot), now() + ttlMs); }
      catch (error) { if (error instanceof HandoffError) throw error; throw invalid(); }
    },
    async read(token) {
      const revision = get(token);
      return { token, expiresAt: new Date(revision.expires).toISOString(), session: clone(revision.session) };
    },
    async reconsider(input) {
      const allowed = new Set(['token', 'participantId', 'candidateId', 'excluded', 'confirmed']);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key)) ||
          input.confirmed !== true || typeof input.participantId !== 'string' || typeof input.candidateId !== 'string' || typeof input.excluded !== 'boolean') throw invalid();
      const revision = get(input.token);
      const current = revision.session;
      if (!current.snapshot.participants.some(p => p.id === input.participantId) || !current.snapshot.candidates.some(c => c.id === input.candidateId)) throw invalid();
      let next = clone(current);
      const hasExclusion = next.vetoes[input.participantId].includes(input.candidateId);
      if (hasExclusion !== input.excluded) {
        try { next = applyAction(next, { type: 'toggle-veto', participantId: input.participantId, candidateId: input.candidateId }); }
        catch { throw invalid(); }
        next.acceptance = {};
        next.agreed = false;
      }
      return save(next, revision.expires);
    }
  };
}
