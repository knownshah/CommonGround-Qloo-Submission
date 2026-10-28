import { evaluateDecision } from './decision.mjs';

function decide(state) {
  state.decision = evaluateDecision(state.snapshot, { policy: state.policy, vetoedIds: [...new Set(Object.values(state.vetoes).flat())] });
  state.agreed = Boolean(state.decision.proposedId) && state.snapshot.participants.every(p => state.acceptance[p.id]?.candidateId === state.decision.proposedId && state.acceptance[p.id]?.accepted === true);
  return state;
}

export function createSession(snapshot) {
  const cloned = structuredClone(snapshot);
  // Let the decision validator reject malformed IDs before canonicalizing them.
  // Session actions, UI lookups, and decision output then share one ID spelling.
  evaluateDecision(cloned);
  cloned.candidates = cloned.candidates.map(candidate => ({ ...candidate, id: candidate.id.toLowerCase() }));
  return decide({
    snapshot: cloned, policy: 'worst-rank',
    vetoes: Object.fromEntries(snapshot.participants.map(p => [p.id, []])),
    acceptance: {}, agreed: false
  });
}

export function replaceEvidence(previous, snapshot) {
  const next = createSession(snapshot);
  const old = previous?.snapshot;
  // Only explicit broader discovery for the identical confirmed group continues
  // negotiation. Participant order/labels matter: never transfer somebody's veto.
  const preserved = old?.source === 'live' && snapshot.source === 'live' && snapshot.discoveryMode === 'individual'
    && ((old.outingType === 'movies' && snapshot.outingType === 'movies') || (Boolean(old.locationId) && old.locationId === snapshot.locationId))
    && (old.requirements ?? '') === (snapshot.requirements ?? '')
    && (old.outingType ?? 'places') === (snapshot.outingType ?? 'places')
    && (old.maxPriceLevel ?? null) === (snapshot.maxPriceLevel ?? null)
    && old.participants.length === snapshot.participants.length
    && old.participants.every((p, i) => {
      const current = snapshot.participants[i];
      return p.id === current.id && p.label === current.label && p.seed.id === current.seed.id && p.seed.type === current.seed.type;
    });
  if (preserved) {
    const ids = new Set(next.snapshot.candidates.map(c => c.id));
    next.policy = previous.policy;
    for (const p of next.snapshot.participants) next.vetoes[p.id] = previous.vetoes[p.id].filter(id => ids.has(id.toLowerCase()));
    decide(next);
  }
  // createSession already clears acceptance, including when the proposal is unchanged.
  return { session: next, preserved };
}

export function applyAction(session, action) {
  if (!action || !['toggle-veto', 'set-policy', 'set-acceptance'].includes(action.type)) throw new TypeError('Unknown refinement action');
  if (action.type !== 'set-policy' && !session.snapshot.participants.some(p => p.id === action.participantId)) throw new TypeError('Unknown participant');
  const next = structuredClone(session);
  if (action.type === 'toggle-veto') {
    const candidateId = typeof action.candidateId === 'string' ? action.candidateId.toLowerCase() : null;
    if (!session.snapshot.candidates.some(c => c.id === candidateId)) throw new TypeError('Unknown candidate');
    const vetoes = next.vetoes[action.participantId];
    next.vetoes[action.participantId] = vetoes.includes(candidateId) ? vetoes.filter(id => id !== candidateId) : [...vetoes, candidateId];
  } else if (action.type === 'set-policy') {
    next.policy = action.policy;
  } else {
    const candidateId = typeof action.candidateId === 'string' ? action.candidateId.toLowerCase() : null;
    if (!session.decision.proposedId || candidateId !== session.decision.proposedId) throw new TypeError('Acceptance must target the current proposal');
    if (typeof action.accepted !== 'boolean') throw new TypeError('Acceptance must be yes or no');
    next.acceptance = { ...next.acceptance, [action.participantId]: { candidateId, accepted: action.accepted } };
  }
  decide(next);
  if (next.decision.proposedId !== session.decision.proposedId) {
    next.acceptance = {};
    next.agreed = false;
  }
  return next;
}
