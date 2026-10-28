import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { evaluateDecision } from '../shared/decision.mjs';

const ids = ['mixed-domain', 'two-to-one', 'movie-night', 'sightseeing'];

// Private recordings are mounted by the operator, never bundled in public source.
// Explicit configuration errors stop startup instead of changing the demo.
export function createScenarioStore(file) {
  if (file && !isAbsolute(file)) throw new RangeError('Private recordings file must be absolute');
  const snapshots = JSON.parse(readFileSync(file || new URL('../../fixtures/synthetic-scenarios.json', import.meta.url), 'utf8'));
  if (!snapshots || Object.keys(snapshots).length !== ids.length || !ids.every(id => Object.hasOwn(snapshots, id))) throw new RangeError('Expected four allowlisted scenarios');
  for (const id of ids) {
    const snapshot = snapshots[id];
    if (snapshot.id !== id || snapshot.source !== 'recorded' || typeof snapshot.title !== 'string' || typeof snapshot.location !== 'string') throw new RangeError('Invalid scenario metadata');
    evaluateDecision(snapshot);
  }
  return {
    listScenarios: () => ids.map(id => {
      const s = snapshots[id];
      return { id: s.id, title: s.title, location: s.location, participantCount: s.participants.length };
    }),
    loadScenario: id => {
      if (!ids.includes(id)) throw new RangeError('Unknown scenario');
      return structuredClone(snapshots[id]);
    }
  };
}

const store = createScenarioStore(process.env.COMMONGROUND_RECORDINGS_FILE);
export const listScenarios = store.listScenarios;
export const loadScenario = store.loadScenario;
