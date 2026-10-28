export function participantDisplayNames(participants) {
  const labels = participants.map(person => person.label);
  const hasDuplicates = labels.some((label, index) => labels.indexOf(label) !== index);
  return hasDuplicates ? labels.map((label, index) => `Person ${index + 1} — ${label}`) : labels;
}
