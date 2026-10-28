/** Compare query-relative ranks, never calibrated satisfaction. Does not mutate evidence. */
export function evaluateDecision(snapshot, { policy = 'worst-rank', vetoedIds = [] } = {}) {
  if (!['worst-rank', 'average-rank'].includes(policy)) throw new TypeError('Unknown decision policy');
  if (!Array.isArray(snapshot?.participants) || snapshot.participants.length < 2 || snapshot.participants.length > 8
    || snapshot.participants.some(p => typeof p.id !== 'string' || !p.id)
    || new Set(snapshot.participants.map(p => p.id)).size !== snapshot.participants.length) throw new TypeError('Expected 2–8 distinct participants');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!Array.isArray(snapshot.candidates) || snapshot.candidates.length > 10
    || snapshot.candidates.some(c => !uuid.test(c.id))) throw new TypeError('Invalid candidate set');
  const candidates = snapshot.candidates.map(c => ({ ...c, id: c.id.toLowerCase() }));
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) throw new TypeError('Duplicate candidate IDs');
  if (!Array.isArray(vetoedIds) || vetoedIds.some(id => typeof id !== 'string' || !candidates.some(c => c.id === id.toLowerCase()))) throw new TypeError('Invalid veto candidate');
  const warnings = [...(snapshot.warnings ?? [])];
  const columns = snapshot.participants.length;
  if (!candidates.length) return { status: 'no-options', proposedId: null, ordered: [], excluded: [], warnings };
  const incomplete = candidates.some(c => !Array.isArray(c.affinities) || c.affinities.length !== columns || snapshot.participants.some((_, i) => typeof c.affinities[i] !== 'number' || !Number.isFinite(c.affinities[i])));
  // A sole candidate can be considered, but cannot establish relative preference.
  // Keep the complete-evidence gate and never manufacture rank 1 as support.
  if (candidates.length === 1 && !incomplete) {
    const row = { id: candidates[0].id, ranks: [], rankSum: null, worstRank: null };
    const vetoed = vetoedIds.some(id => id.toLowerCase() === row.id);
    warnings.push('Only one option was returned; no comparative preference can be established. Each person must decide whether it works for them.');
    return { status: vetoed ? 'no-options' : 'ready', proposedId: vetoed ? null : row.id,
      ordered: vetoed ? [] : [row], excluded: vetoed ? [{ ...row, reason: 'Participant veto' }] : [], warnings };
  }
  const flat = !incomplete && snapshot.participants.some((_, i) => candidates.every(c => c.affinities[i] === candidates[0].affinities[i]));
  if (incomplete || flat) {
    warnings.push(incomplete ? 'Some participant evidence is missing or invalid. Automatic selection is paused.' : 'A participant has flat evidence with no relative preference. Automatic selection is paused.');
    return { status: 'insufficient-evidence', proposedId: null, ordered: [], excluded: [], warnings };
  }
  const all = candidates.map(candidate => {
    const ranks = candidate.affinities.map((score, i) => 1 + candidates.filter(other => other.affinities[i] > score).length);
    return { id: candidate.id, ranks, rankSum: ranks.reduce((sum, rank) => sum + rank, 0), worstRank: Math.max(...ranks) };
  });
  const vetoes = new Set(vetoedIds.map(id => id.toLowerCase()));
  const ordered = all.filter(c => !vetoes.has(c.id));
  ordered.sort((a, b) => {
    const worst = a.worstRank - b.worstRank;
    const sum = a.rankSum - b.rankSum;
    return (policy === 'worst-rank' ? worst || sum : sum || worst) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return {
    status: ordered.length ? 'ready' : 'no-options', proposedId: ordered[0]?.id ?? null,
    ordered, excluded: all.filter(c => vetoes.has(c.id)).map(c => ({ ...c, reason: 'Participant veto' })), warnings
  };
}
