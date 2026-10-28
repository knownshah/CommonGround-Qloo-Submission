function participantsOf(snapshot) {
  return Array.isArray(snapshot?.participants) ? snapshot.participants : [];
}

function candidatesOf(snapshot) {
  return Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
}

function missingParticipantIndices(candidate, participantCount) {
  if (!Array.isArray(candidate?.affinities)) return Array.from({ length: participantCount }, (_, index) => index);
  return Array.from({ length: participantCount }, (_, index) => index)
    .filter(index => typeof candidate.affinities[index] !== 'number' || !Number.isFinite(candidate.affinities[index]));
}

function hasCompleteEvidence(candidate, participantCount) {
  return Array.isArray(candidate?.affinities)
    && candidate.affinities.length === participantCount
    && missingParticipantIndices(candidate, participantCount).length === 0;
}

function validParticipantCount(count) {
  return count >= 2 && count <= 8;
}

export function evidenceGap(snapshot) {
  const participants = participantsOf(snapshot);
  const candidates = candidatesOf(snapshot);
  const participantCount = participants.length;
  const validParticipants = validParticipantCount(participantCount);
  const incomplete = candidates.map((candidate, candidateIndex) => {
    const affinities = candidate?.affinities;
    const missing = validParticipants ? missingParticipantIndices(candidate, participantCount) : Array.from({ length: participantCount }, (_, index) => index);
    const complete = validParticipants && hasCompleteEvidence(candidate, participantCount);
    return complete ? null : {
      candidateIndex,
      candidateName: typeof candidate?.name === 'string' ? candidate.name : '',
      participantIndices: missing,
      vectorLengthMismatch: !Array.isArray(affinities) || affinities.length !== participantCount
    };
  }).filter(Boolean);

  return {
    totalCandidateCount: candidates.length,
    completeCandidateCount: candidates.length - incomplete.length,
    missingCandidateCount: incomplete.length,
    missingPairs: incomplete
  };
}

export function completeEvidenceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const participants = participantsOf(snapshot);
  const candidates = candidatesOf(snapshot);
  if (!validParticipantCount(participants.length) || !candidates.length) return null;

  const gap = evidenceGap(snapshot);
  if (gap.missingCandidateCount === 0) return null;
  const completeCandidates = candidates.filter(candidate => hasCompleteEvidence(candidate, participants.length));
  if (!completeCandidates.length) return null;
  if (completeCandidates.length > 1 && participants.some((_, index) =>
    completeCandidates.every(candidate => candidate.affinities[index] === completeCandidates[0].affinities[index]))) return null;

  let derived;
  try { derived = structuredClone(snapshot); }
  catch { return null; }

  const originalId = typeof snapshot.id === 'string' && snapshot.id.trim() ? snapshot.id.trim() : 'snapshot';
  const date = typeof snapshot.recordedAt === 'string' && snapshot.recordedAt ? `, recorded ${snapshot.recordedAt}` : '';
  const notice = `New shortlist of ${completeCandidates.length} fully evidenced options from original ${candidates.length}; relative ranks recomputed; no fresh Qloo request. Original comparison: ${originalId}${date}.`;
  derived.id = `${originalId.slice(0, 80)}-complete-evidence`;
  derived.candidates = derived.candidates.filter(candidate => hasCompleteEvidence(candidate, participants.length));
  derived.warnings = [...(Array.isArray(derived.warnings) ? derived.warnings : []), notice];
  return derived;
}
