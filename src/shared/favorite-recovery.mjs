// Describe missing columns without changing evidence, ranks, or group membership.
export function favoriteEvidenceGaps(snapshot) {
  const candidates = snapshot.candidates ?? [];
  if (!candidates.length) return [];
  return snapshot.participants.flatMap((person, participantIndex) => {
    const missingOptionCount = candidates.filter(candidate => !Number.isFinite(candidate.affinities?.[participantIndex])).length;
    return missingOptionCount ? [{ participantId: person.id, participantIndex, label: person.label, favorite: person.seed.name, missingOptionCount, totalOptionCount: candidates.length }] : [];
  });
}
