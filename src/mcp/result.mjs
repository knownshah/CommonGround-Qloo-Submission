// Project the existing decision into an agent-readable result. No new ranking,
// provider request, inferred preference or participant response is introduced.
import { favoriteEvidenceGaps } from '../shared/favorite-recovery.mjs';
export function summarizeResult(session) {
  const { snapshot, decision, policy } = session;
  const option = row => {
    const candidate = snapshot.candidates.find(c => c.id === row.id);
    const details = Object.fromEntries(['address', 'description', 'placeTypes', 'priceLevel',
      'releaseYear', 'durationMinutes', 'genres'].filter(key => candidate[key] !== undefined)
      .map(key => [key, candidate[key]]));
    return {
      id: row.id, name: candidate.name, details,
      rankings: snapshot.participants.map((person, index) => ({
        participantId: person.id, label: person.label, favorite: person.seed.name,
        rank: row.ranks[index] ?? null
      })),
      worstRank: row.worstRank
    };
  };
  const proposed = decision.ordered.find(row => row.id === decision.proposedId);
  const missingFavorites = decision.status === 'insufficient-evidence' ? favoriteEvidenceGaps(snapshot) : [];
  return structuredClone({
    status: decision.status, policy, evidenceSource: snapshot.source,
    outingType: snapshot.outingType ?? 'places', evidenceCapturedAt: snapshot.recordedAt,
    location: snapshot.location ?? null,
    ...(snapshot.locationDetails ? { locationDetails: snapshot.locationDetails } : {}),
    originalOptionCount: snapshot.candidates.length,
    rankMeaning: 'Lower ranks are stronger among the original options, not predicted satisfaction. Null means no comparative rank is established.',
    proposal: proposed ? option(proposed) : null,
    alternatives: decision.ordered.filter(row => row.id !== decision.proposedId).slice(0, 3).map(option),
    exclusions: snapshot.candidates.map(candidate => ({
      id: candidate.id, name: candidate.name,
      participantIds: snapshot.participants.filter(p => session.vetoes[p.id].includes(candidate.id)).map(p => p.id)
    })).filter(exclusion => exclusion.participantIds.length),
    requirements: snapshot.requirements ?? '',
    ...(snapshot.sightseeingSelection ? { sightseeingSelection: snapshot.sightseeingSelection } : {}),
    recovery: missingFavorites.length ? {
      reason: 'missing-favorite-evidence', favorites: missingFavorites,
      message: `Missing Qloo affinity evidence for ${missingFavorites.map(person => `${person.label} (${person.favorite})`).join(', ')}. A supported group proposal cannot be made yet.`,
      nextSteps: ['Ask the affected participant to choose another favorite; preserve the location and all other people.',
        'Use resolve_input to confirm the replacement, then compare_group with the whole confirmed group. Reconfirm any expired input tokens.',
        'If the user explicitly requests broader discovery, compare_group with discoveryMode individual may find other options; it does not guarantee coverage. Never fill missing affinities or infer acceptance.'],
      appRequired: false
    } : null,
    warnings: decision.warnings, sourceRefs: snapshot.sourceRefs ?? [],
    agreed: session.agreed
  });
}
