import { evidenceCopy } from './evidence-copy.mjs';
import { createSession, applyAction, replaceEvidence } from '/shared/session.mjs';
import { evaluateDecision } from '/shared/decision.mjs';
import { createLiveInputs } from '/live.mjs';
import { participantDisplayNames } from './participant-names.mjs';
import { qlooImageUrl } from '/shared/qloo-image.mjs';
import { createHomeStory, createStoryFrames, tasteArtwork, recordedVenueArtwork } from './walkthrough.mjs';
import { adFacts, createAd, createAgentExchange, createBridge, exchangeModel, revealOnScroll, setupAgentPanel } from './showcase.mjs';
import { evidenceGap, completeEvidenceSnapshot } from './evidence-recovery.mjs';
import { favoriteEvidenceGaps } from '/shared/favorite-recovery.mjs';
import { countries } from '/shared/countries.mjs';

const workspace = document.querySelector('#workspace');
const announcement = document.querySelector('#announcements');
const errorBanner = document.querySelector('#error-banner');
let session;
let originalEvidenceSnapshot;
let scenarios = [];
let loadVersion = 0;
let liveInputs;
let mode = 'recorded';
let handoffOrigin = false;
let planningFromWelcome = false;
const handoffNote = 'Opened from your assistant. Changes and responses stay on this device; reopening the link starts from the shared comparison.';
const welcome = document.querySelector('#welcome');
let atWelcome = Boolean(welcome);
let settingUp = false;
let revisionFeedback = '';
let walkthrough;
let walkthroughPending;
async function mountWalkthrough() {
  const root = document.querySelector('#visual-story');
  if (!root || walkthrough) return;
  if (!walkthroughPending) walkthroughPending = json('/api/scenarios/sightseeing').then(snapshot => {
    walkthrough = createHomeStory({ root, frames: createStoryFrames(snapshot, { createSession, applyAction }), isActive: () => atWelcome });
  }).catch(() => { root.replaceChildren(node('p', 'story-unavailable', 'The product film could not load. You can still open the recorded demo or start your own plan.')); walkthroughPending = undefined; });
  await walkthroughPending;
}
let showcasePending;
async function mountShowcase() {
  const adRoot = document.querySelector('#ad-root');
  const bridgeRoot = document.querySelector('#bridge-root');
  if (!adRoot || showcasePending) return showcasePending;
  const setup = document.querySelector('#agent-setup'); if (setup) setupAgentPanel(setup);
  showcasePending = json('/api/scenarios/mixed-domain').then(snapshot => {
    const facts = adFacts(snapshot, evaluateDecision);
    if (facts) createAd({ root: adRoot, facts, isActive: () => atWelcome });
    else adRoot.replaceChildren(node('p', 'story-unavailable', 'The film needs complete recorded evidence and could not load.'));
    if (bridgeRoot) createBridge({ root: bridgeRoot, snapshot, evaluate: evaluateDecision, announce: text => { announcement.textContent = text; } });
    const exchangeRoot = document.querySelector('#agent-exchange');
    const exchange = exchangeRoot && exchangeModel(snapshot, evaluateDecision);
    if (exchange) createAgentExchange({ root: exchangeRoot, model: exchange, announce: text => { announcement.textContent = text; } });
    else exchangeRoot?.remove();
    revealOnScroll(document.querySelector('#welcome-coda') ?? document);
  }).catch(() => {
    adRoot.replaceChildren(node('p', 'story-unavailable', 'The film could not load. You can still open the recorded demo or start your own plan.'));
    bridgeRoot?.replaceChildren(node('p', 'story-unavailable', 'The comparison could not load. You can still open the recorded demo.'));
    showcasePending = undefined;
  });
  return showcasePending;
}
async function ensureWelcomeWalkthrough() {
  await Promise.all([mountShowcase(), mountWalkthrough()]);
}
function updateVisibility() {
  const skip = document.querySelector('#skip-link');
  if (skip) skip.href = atWelcome ? '#page-title' : settingUp ? '#live-inputs' : '#workspace';
  if (welcome) welcome.hidden = !atWelcome;
  const coda = document.querySelector('#welcome-coda');
  if (coda) coda.hidden = !atWelcome;
  const homeMain = document.querySelector('#home-main'); if (homeMain) homeMain.hidden = !atWelcome;
  workspace.hidden = atWelcome || settingUp;
  for (const id of ['decision-controls', 'journey-nav']) {
    const element = document.querySelector(`#${id}`);
    if (element) element.hidden = atWelcome || (id === 'journey-nav' && settingUp);
  }
}
function startPlanning({ snapshot, participantId } = {}) {
  if (!settingUp) planningFromWelcome = atWelcome;
  loadVersion++; handoffOrigin = false; clearHandoffHash(); workspace.setAttribute('aria-busy', 'false'); atWelcome = false; settingUp = true; mode = 'live'; errorBanner.hidden = true;
  liveInputs?.open({ snapshot, participantId }); updateModeLabels(); updateVisibility();
  document.querySelector('#live-inputs')?.focus?.();
}
const labels = { 'worst-rank': 'Limit worst rank', 'average-rank': 'Best average rank' };
const number = value => value.toFixed(4);
const priceLevels = ['Lower-priced', 'Mid-priced', 'Higher-priced', 'Most expensive'];
const priceCeilings = ['Lower-priced', 'Mid-priced or lower', 'Up to higher-priced', 'Any known price level'];
const priceLabel = candidate => Number.isInteger(candidate.priceLevel) && candidate.priceLevel >= 1 && candidate.priceLevel <= 4 ? `Price: ${priceLevels[candidate.priceLevel - 1]}` : 'Price information unavailable';

const node = (tag, className = '', text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = evidenceCopy(session?.snapshot, text);
  return element;
};
const add = (parent, ...children) => { parent.append(...children); return parent; };
function button(text, key, action, className = '') {
  const b = node('button', className, text);
  b.type = 'button'; b.dataset.focusKey = key;
  b.addEventListener('click', action);
  return b;
}
function dispatch(action, message) {
  const previous = session.decision.proposedId;
  try {
    session = applyAction(session, action);
    if (previous !== session.decision.proposedId) {
      const before = session.snapshot.candidates.find(c => c.id === previous)?.name;
      const after = session.snapshot.candidates.find(c => c.id === session.decision.proposedId)?.name;
      revisionFeedback = `${message}${before ? ` (${before})` : ''}. ${after ? `Now considering ${after}.` : 'No eligible proposal remains.'} Everyone needs to respond again.`;
    } else if (action.type === 'set-acceptance') revisionFeedback = '';
    render();
    const current = session.snapshot.candidates.find(c => c.id === session.decision.proposedId);
    announcement.textContent = `${message}. ${previous !== session.decision.proposedId ? `Proposed choice: ${current?.name ?? 'none'}. Previous acceptance cleared.` : ''}`;
  } catch { showError('That change could not be applied. Reset the demo and try again.'); }
}
function showError(message, retryId = session?.snapshot.id ?? 'mixed-domain') {
  errorBanner.replaceChildren(node('span', '', message), button('Try again', 'retry', () => load(retryId), 'text-button'));
  errorBanner.hidden = false;
}
async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}
async function load(id) {
  const version = ++loadVersion;
  handoffOrigin = false; clearHandoffHash();
  workspace.setAttribute('aria-busy', 'true');
  errorBanner.hidden = true;
  try {
    if (!scenarios.length) scenarios = await json('/api/scenarios');
    const snapshot = await json(`/api/scenarios/${encodeURIComponent(id)}`);
    if (version !== loadVersion) return;
    session = createSession(snapshot);
    revisionFeedback = '';
    originalEvidenceSnapshot = undefined;
    mode = snapshot.source === 'live' ? 'live' : 'recorded';
    render();
    announcement.textContent = atWelcome ? '' : `${snapshot.title} loaded. ${snapshot.participants.length} participants and ${snapshot.candidates.length} ${snapshot.source} options. Acceptance reset.`;
  } catch { if (version === loadVersion) showError('We could not load the recorded comparison. Check that the local app is running, then try again.', id); }
  finally { if (version === loadVersion) workspace.setAttribute('aria-busy', 'false'); }
}

function clearHandoffHash() {
  if (globalThis.location?.hash?.startsWith('#handoff=')) {
    try { globalThis.history?.replaceState?.(null, '', `${globalThis.location.pathname ?? ''}${globalThis.location.search ?? ''}`); } catch { /* Embedded harnesses may not expose browser history. */ }
  }
}

async function startDemo() {
  const previousComparison = !atWelcome && (!settingUp || !planningFromWelcome) ? session : undefined;
  planningFromWelcome = false; clearHandoffHash(); handoffOrigin = false;
  atWelcome = false; settingUp = false; liveInputs?.close(); mode = 'recorded';
  workspace.replaceChildren(node('div', 'loading', 'Opening the recorded group…'));
  updateVisibility();
  const version = loadVersion + 1;
  await load('sightseeing');
  if (loadVersion === version && !errorBanner.hidden && previousComparison) {
    session = previousComparison; mode = session.snapshot.source === 'live' ? 'live' : 'recorded'; render();
  }
  workspace.focus?.();
}

async function loadHandoff(token) {
  const version = ++loadVersion;
  atWelcome = false; settingUp = false; errorBanner.hidden = true; liveInputs?.close();
  workspace.setAttribute('aria-busy', 'true'); updateVisibility();
  try {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('The comparison link is invalid or expired.');
    const response = await fetch('/api/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'This comparison link is invalid or has expired.');
    if (version !== loadVersion) return;
    const shared = result.session;
    let restored = createSession(shared.snapshot);
    if (shared.policy) restored = applyAction(restored, { type: 'set-policy', policy: shared.policy });
    for (const participant of restored.snapshot.participants) {
      for (const candidateId of shared.vetoes?.[participant.id] ?? []) {
        restored = applyAction(restored, { type: 'toggle-veto', participantId: participant.id, candidateId });
      }
    }
    session = restored;
    revisionFeedback = '';
    originalEvidenceSnapshot = undefined;
    handoffOrigin = true; mode = 'live';
    render();
    announcement.textContent = 'Shared comparison opened. All participant responses start unanswered.';
  } catch (error) {
    if (version !== loadVersion) return;
    handoffOrigin = false;
    errorBanner.replaceChildren(node('span', '', `We could not open this comparison: ${error.message || 'the link is invalid or expired.'}`),
      button('Start planning', 'handoff-plan', startPlanning, 'text-button'),
      button('Try a quick demo', 'handoff-demo', startDemo, 'text-button'));
    errorBanner.hidden = false; atWelcome = true; updateVisibility();
  } finally { if (version === loadVersion) workspace.setAttribute('aria-busy', 'false'); }
}

function sidebar() {
  const snapshot = session.snapshot;
  const aside = node('aside', 'sidebar');
  const overview = node('details', 'group-overview');
  overview.id = 'group-stage'; overview.tabIndex = -1;
  overview.append(node('summary', '', `Your group · ${snapshot.participants.length} people · ${snapshot.outingType === 'movies' ? 'Movie night' : snapshot.location}`));
  const scenarioPanel = node('section', 'panel scenario-panel');
  add(scenarioPanel, node('p', 'eyebrow', '01 / SET THE SCENE'), node('h2', '', snapshot.source === 'live' ? 'Recorded examples' : 'Try a group'));
  const choices = node('div', 'scenario-choices');
  choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'Recorded group');
  for (const s of scenarios) {
    const choice = button('', `scenario-${s.id}`, () => { liveInputs?.close(); mode = 'recorded'; return load(s.id); }, `scenario-choice ${s.id === snapshot.id ? 'selected' : ''}`);
    choice.setAttribute('aria-pressed', String(s.id === snapshot.id));
    add(choice, node('span', 'choice-dot', s.id === snapshot.id ? '●' : '○'), add(node('span'), node('strong', '', s.title), node('small', '', s.id === 'movie-night' ? 'Choose what to watch together' : s.id === 'sightseeing' ? 'Three film favorites, five places' : s.id === 'mixed-domain' ? 'Film, music & gaming' : 'Two similar tastes, one outlier')));
    choices.append(choice);
  }
  const movies = snapshot.outingType === 'movies';
  add(scenarioPanel, choices, node('p', 'field-label', movies ? 'SHARED DECISION' : snapshot.source === 'live' ? 'CONFIRMED LOCATION' : 'RECORDED LOCATION'), node('div', 'location', movies ? 'Movie night' : `⌖  ${snapshot.location}`), node('p', 'helper', movies ? 'Choose a film together. No city is required.' : snapshot.source === 'live' ? 'Using the location you confirmed.' : 'These saved results belong to New York. Choose Live search to use your own city and favorites.'));
  if (snapshot.outingType === 'sightseeing') scenarioPanel.append(node('p', 'helper', 'Sightseeing · Tourist attractions'));
  if (snapshot.outingType === 'restaurants') scenarioPanel.append(node('p', 'helper', `Restaurants · ${snapshot.maxPriceLevel === null ? 'Any price, including unknown' : priceCeilings[snapshot.maxPriceLevel - 1]}`));
  const group = node('section', 'panel group-panel');
  const displayNames = participantDisplayNames(snapshot.participants);
  add(group, add(node('div', 'section-title'), node('h2', '', 'Your group'), node('span', 'small-tag', `${snapshot.participants.length} people`)), node('p', 'helper', 'One cultural favorite per person.'));
  for (const [i, p] of snapshot.participants.entries()) {
    const card = node('div', `participant participant-${i}`);
    const confirmation = handoffOrigin ? '✓ Confirmed by the person who shared this comparison' : snapshot.source === 'live' ? '✓ Confirmed by you' : '✓ Confirmed in recording';
    add(card, node('span', `avatar avatar-${i}`, 'ABCDEFGH'[i]), add(node('div', 'participant-copy'), node('strong', '', displayNames[i]), node('span', 'taste-type', p.seed.type), node('p', 'favorite', p.seed.name), node('small', 'confirmed', confirmation)));
    group.append(card);
  }
  add(group, node('div', 'synthetic-note', snapshot.source === 'live' ? 'This prototype collects responses on this device. Have each person answer for themselves.' : `You’re simulating all ${snapshot.participants.length} participants. Their tastes are fictional; the Qloo responses are real.`), button(snapshot.source === 'live' ? 'Reset group responses' : 'Reset this demo', 'reset', () => { session = createSession(snapshot); revisionFeedback = ''; render(); announcement.textContent = 'Group responses reset. All vetoes and acceptance cleared.'; }, 'reset-button'));
  overview.append(add(aside, scenarioPanel, group));
  return overview;
}

function groupContext() {
  const snapshot = session.snapshot;
  const section = node('section', 'group-context');
  const names = participantDisplayNames(snapshot.participants);
  add(section, node('p', 'eyebrow', snapshot.source === 'recorded' ? 'THE INTERACTIVE DEMO' : 'YOUR SHARED PLAN'),
    node('h2', '', snapshot.id === 'sightseeing' ? 'Three film favorites. One New York outing.' : snapshot.source === 'recorded' ? snapshot.title : `${snapshot.participants.length} tastes. One shared ${snapshot.outingType === 'movies' ? 'movie night' : snapshot.outingType === 'restaurants' ? 'meal' : 'outing'}.`),
    node('p', 'group-context-meta', `${snapshot.location} · ${snapshot.participants.length} people · ${snapshot.candidates.length} options to compare`));
  const roster = node('div', 'taste-roster');
  snapshot.participants.forEach((p, i) => {
    const tile = node('div', `taste-tile person-${i % 3}`);
    const art = tasteArtwork(p.seed);
    if (art) { const img = node('img', 'taste-tile-art'); img.src = art; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => { img.hidden = true; }); tile.append(img); }
    else tile.append(node('span', 'person-token', 'ABCDEFGH'[i]));
    add(tile, add(node('span', 'taste-tile-copy'), node('small', '', names[i]), node('strong', '', p.seed.name)));
    roster.append(tile);
  });
  section.append(roster, node('p', 'group-context-note', snapshot.source === 'recorded' ? 'Fictional participants. Real recorded Qloo evidence. You control each response below; nothing is accepted for them. Taste artwork is illustrative.' : 'Confirmed cultural favorites. Each person responds on this device. Suggestions start the conversation; your group decides.'));
  return section;
}

function listingDetail(candidate) {
  if (session.snapshot.outingType === 'movies') return '';
  const peers = session.snapshot.candidates.filter(c => c.name.trim().toLowerCase() === candidate.name.trim().toLowerCase());
  return peers.length > 1 ? `Listing ${peers.findIndex(c => c.id === candidate.id) + 1} · ${candidate.address || 'Address unavailable'}` : '';
}
function candidateLabel(candidate) {
  const detail = listingDetail(candidate);
  return detail ? `${candidate.name} · ${detail}` : candidate.name;
}

function mapsLink(candidate) {
  if (session.snapshot.outingType === 'movies' || typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.address !== 'string' || !candidate.address.trim()) return null;
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${candidate.name.trim()}, ${candidate.address.trim()}`);
  const link = node('a', 'maps-link', 'Find on Google Maps');
  link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Find ${candidateLabel(candidate)} on Google Maps (opens a new tab)`);
  return link;
}

function proposal() {
  const { snapshot, decision, policy } = session;
  const section = node('section', `proposal ${decision.proposedId ? '' : 'proposal-empty'}`);
  section.id = 'options-stage'; section.tabIndex = -1;
  const body = node('div', 'proposal-body');
  section.append(body);
  add(body, node('p', 'eyebrow', 'CURRENT PROPOSAL'));
  const candidate = snapshot.candidates.find(c => c.id === decision.proposedId);
  if (!candidate) {
    add(body, node('h2', '', decision.status === 'no-options' ? 'No option everyone can consider.' : 'More evidence is needed.'), node('p', '', decision.status === 'no-options' ? snapshot.candidates.length ? 'Every option has been vetoed. Restore an option in the comparison below, or use Live search for a broader shortlist.' : snapshot.outingType === 'sightseeing' ? 'No places with verified tourist-attraction category data matched this request. Try another confirmed location or favorite. Broad places search is a separate choice.' : snapshot.outingType === 'movies' ? 'No new films were returned for these favorites. Confirm different favorites or try broader discovery.' : snapshot.outingType === 'restaurants' ? 'No restaurants with sufficient category and price evidence matched this request. Choose another city, favorite or price category and confirm again.' : 'No places were returned for this group and location. Try another confirmed city or favorite.' : 'Automatic selection is paused. A participant’s evidence is incomplete or does not distinguish these options.'));
    if (decision.status !== 'no-options') {
      if (snapshot.source === 'live') {
        for (const person of favoriteEvidenceGaps(snapshot)) {
          body.append(node('p', 'helper', `${person.label}’s favorite, ${person.favorite}, is missing Qloo ranking evidence for ${person.missingOptionCount} of ${person.totalOptionCount} options.`));
          body.append(button(`Change ${person.label}’s favorite`, `recover-favorite-${person.participantId}`, () => startPlanning({ snapshot, participantId: person.participantId }), 'primary-button'));
        }
      }
      const gap = evidenceGap(snapshot);
      if (gap.missingCandidateCount) {
        body.append(node('p', 'helper', `${gap.completeCandidateCount} of ${gap.totalCandidateCount} options have evidence for every person. Missing evidence pauses this original comparison.`));
        const names = participantDisplayNames(snapshot.participants);
        for (const pair of gap.missingPairs.slice(0, 5)) body.append(node('p', 'helper', `${pair.candidateName || 'Unnamed option'}: ${pair.participantIndices.length ? `missing evidence for ${pair.participantIndices.map(i => names[i]).join(', ')}` : 'the evidence vector does not match this group'}.`));
        const derived = completeEvidenceSnapshot(snapshot);
        if (derived) {
          body.append(node('p', 'helper', 'Start a new comparison using only the fully evidenced options. All people stay in the group; ranks are recalculated; vetoes, the decision rule and acceptance reset. No new Qloo request.'));
          body.append(button(`Compare ${derived.candidates.length} fully evidenced options`, 'complete-evidence', () => {
            originalEvidenceSnapshot = snapshot;
            session = createSession(derived);
            revisionFeedback = '';
            render(); workspace.querySelector('#options-stage')?.focus?.();
            announcement.textContent = `New shortlist of ${derived.candidates.length} fully evidenced options. Ranks recalculated; vetoes, the decision rule and acceptance reset.`;
          }, 'primary-button'));
        }
      }
    }
    const screenedCount = snapshot.sightseeingSelection?.excluded?.length;
    if (screenedCount) body.append(node('p', 'helper', `${screenedCount} returned ${screenedCount === 1 ? 'place' : 'places'} did not pass the sightseeing category checks. Explore places broadly is a separate choice.`));
    return section;
  }
  const row = decision.ordered[0];
  const single = snapshot.candidates.length === 1;
  const curated = recordedVenueArtwork(snapshot, candidate);
  const imageUrl = curated?.url ?? qlooImageUrl(candidate.imageUrl);
  if (!imageUrl && snapshot.source === 'recorded' && snapshot.outingType !== 'movies' && snapshot.location === 'New York, NY') {
    const figure = node('figure', 'proposal-media editorial-photo');
    const image = node('img'); image.src = '/assets/new-york.jpg'; image.alt = 'New York atmosphere — editorial photograph, not this option';
    image.addEventListener('error', () => { figure.hidden = true; });
    figure.append(image, node('figcaption', 'helper', 'New York atmosphere · Editorial photograph, not a verified image of this option'));
    section.append(figure);
    section.className += ' recorded-new-york';
  }
  body.append(node('p', 'result-context', `${snapshot.outingType === 'movies' ? 'Movie night' : snapshot.location} · ${snapshot.participants.length} people · ${snapshot.source === 'recorded' ? 'Recorded example' : 'Your confirmed group'}`));
  const top = node('div', 'proposal-top');
  add(top, node('span', 'suggested-tag', session.agreed ? '✓ Group accepted' : 'A proposal, open for discussion'), node('span', 'proposal-number', ''));
  add(body, top, node('h2', '', candidate.name));
  if (snapshot.outingType === 'movies') {
    const details = [Number.isInteger(candidate.releaseYear) ? String(candidate.releaseYear) : '',
      Number.isInteger(candidate.durationMinutes) && candidate.durationMinutes > 0 ? `${candidate.durationMinutes} min` : '',
      Array.isArray(candidate.genres) ? candidate.genres.filter(g => typeof g === 'string').slice(0, 3).join(' / ') : ''].filter(Boolean);
    if (details.length) body.append(node('p', 'helper', details.join(' · ')));
  }
  if (imageUrl) {
    const figure = node('figure', `${snapshot.outingType === 'movies' ? 'proposal-media place-photo movie-poster' : 'proposal-media place-photo'}${curated ? ` ${curated.className}` : ''}`);
    const image = node('img');
    image.src = imageUrl; image.alt = curated ? `${candidate.name} — licensed photograph` : `${candidate.name} — photo supplied by Qloo`;
    image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { figure.hidden = true; });
    figure.append(image, node('figcaption', 'helper', curated ? `Photo: ${curated.credit}` : 'Photo supplied by Qloo'));
    section.append(figure);
  }
  if (snapshot.outingType === 'movies' && !imageUrl) body.append(node('p', 'helper', 'Qloo did not supply a poster for this movie.'));
  if (listingDetail(candidate)) body.append(node('p', 'helper', listingDetail(candidate)));
  if (snapshot.outingType !== 'movies') {
    const types = candidate.placeTypes;
    const facts = node('div', 'candidate-facts');
    facts.append(node('p', 'helper', Array.isArray(types) && types.length ? types.join(' · ') : 'Place type unavailable'),
      node('p', 'helper', candidate.address || 'Address unavailable'), node('p', 'helper', priceLabel(candidate)));
    body.append(facts);
    const map = mapsLink(candidate);
    if (map) body.append(map);
  }
  if (typeof candidate.description === 'string' && candidate.description.trim()) {
    body.append(node('p', 'helper', candidate.description.trim().slice(0, 400)));
  }

  const factsDetails = node('details', 'place-details');
  factsDetails.append(node('summary', '', snapshot.outingType === 'movies' ? 'Film details' : 'Place details & Maps'));
  const facts = [...body.children].filter(e => e.className === 'candidate-facts' || e.className === 'maps-link' || (e.className === 'helper' && e.textContent));
  // Move practical metadata into an inspectable disclosure; the title/ranks stay in view.
  for (const fact of facts) factsDetails.append(fact);
  if (facts.length) body.append(factsDetails);

  const reason = single ? 'Only one option was returned. There are no alternatives to compare; each person can accept or veto this option.' : policy === 'worst-rank' ? `Within the top ${row.worstRank} of ${snapshot.candidates.length} options for every taste in your group.` : `Average rank: ${(row.rankSum / snapshot.participants.length).toFixed(2)} of ${snapshot.candidates.length} across your group’s tastes.`;
  add(body, node('p', 'proposal-reason', reason));
  const ranks = node('div', 'proposal-ranks');
  row.ranks.forEach((rank, i) => {
    const person = add(node('div', `rank-person rank-person-${i}`), node('b', '', 'ABCDEFGH'[i]));
    const art = tasteArtwork(snapshot.participants[i].seed);
    if (art) { const image = node('img', 'rank-art'); image.src = art; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => { image.hidden = true; }); person.append(image); }
    person.append(add(node('span', 'rank-identity'), node('small', '', participantDisplayNames(snapshot.participants)[i]), node('strong', '', snapshot.participants[i].seed.name)), node('span', 'rank-value', `rank ${rank} of ${snapshot.candidates.length}`));
    ranks.append(person);
  });
  add(body, ranks, node('p', 'proposal-caution', single ? 'No comparative preference established · Acceptance is up to each person' : `Qloo evidence among the original ${snapshot.candidates.length} options. Lower ranks are stronger; responses are separate.`));
  if (!single) {
    const why = node('details', 'fairness-story');
    why.append(node('summary', '', 'Why this proposal?'));
    const alternatePolicy = policy === 'worst-rank' ? 'average-rank' : 'worst-rank';
    const alternate = evaluateDecision(snapshot, { policy: alternatePolicy, vetoedIds: Object.values(session.vetoes).flat() });
    const other = snapshot.candidates.find(c => c.id === alternate.proposedId);
    add(why, node('p', '', policy === 'worst-rank' ? 'The weakest-supported taste comes first. This choice limits the group’s worst rank.' : 'This rule prioritises the average rank. One person may rank the choice lower than the others.'));
    if (other) {
      add(why, node('p', 'fairness-alternative', `${labels[alternatePolicy]} ${other.id === candidate.id ? 'also proposes' : 'would propose'} ${other.name}.`));
      add(why, node('p', 'fairness-rankline', `Its participant ranks: ${alternate.ordered[0].ranks.join(' · ')} of ${snapshot.candidates.length}. Lower ranks indicate stronger relative evidence.`));
    }
    body.append(why);
  }
  if (snapshot.requirements) body.append(node('p', 'requirements-callout', `Still to check: ${snapshot.requirements}. These practical requirements are not verified by cultural ranking.`));
  const about = node('aside', 'suggestion-note');
  about.setAttribute('aria-label', 'About these suggestions');
  add(about, node('strong', '', 'Powered by Qloo'), node('p', 'helper', 'Suggestions use your group’s interests. Details may change, and a recommendation doesn’t guarantee everyone will enjoy it.'),
    node('p', 'helper', snapshot.outingType === 'movies' ? 'Before agreeing, check where to watch, language and age suitability.' : 'Before agreeing, check public access, opening hours, prices, accessibility and the matching Maps listing. Maps links search by name and address.'));
  section.append(about);
  return section;
}

function alternativesOverview(details) {
  const snapshot = session.snapshot;
  if (!session.decision.proposedId || snapshot.candidates.length < 2) return null;
  const section = node('section', 'alternatives-overview');
  const heading = node('div', 'alternatives-heading');
  add(heading, add(node('div'), node('p', 'eyebrow', 'KEEP THE CHOICE OPEN'), node('h2', '', 'Other ways to spend it.')),
    button(`Compare all ${snapshot.candidates.length} options →`, 'alternatives-compare', () => { details.open = true; details.focus?.(); }, 'text-button'));
  if (snapshot.outingType === 'movies') heading.children[0].children[1].textContent = 'More possibilities for movie night.';
  section.append(heading);
  const rows = node('div', 'alternative-cards');
  session.decision.ordered.slice(1, 4).forEach((row, i) => {
    const candidate = snapshot.candidates.find(c => c.id === row.id);
    const card = node('article', 'alternative-card');
    const art = recordedVenueArtwork(snapshot, candidate);
    const imageUrl = art?.url ?? qlooImageUrl(candidate.imageUrl);
    const media = node('div', 'alternative-media');
    media.append(node('span', 'alternative-number', String(i + 2).padStart(2, '0')));
    if (imageUrl) { const img = node('img'); img.src = imageUrl; img.alt = art ? `${candidate.name} — licensed photograph` : `${candidate.name} — image supplied by Qloo`; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => { img.hidden = true; }); media.append(img); }
    const copy = node('div', 'alternative-copy');
    add(copy, node('h3', '', candidate.name), node('p', '', row.ranks.length ? row.ranks.map((rank, j) => `${'ABCDEFGH'[j]} ${rank}/${snapshot.candidates.length}`).join(' · ') : 'No comparative ranks'));
    if (imageUrl) copy.append(node('small', '', art ? `Photo: ${art.credit}` : 'Image supplied by Qloo'));
    card.append(media, copy); rows.append(card);
  });
  section.append(rows, node('p', 'helper', `Showing leading alternatives under the current rule. All original ${snapshot.candidates.length} options, including excluded ones, remain in the full comparison.`));
  return section;
}

function comparison() {
  const { snapshot, decision, policy } = session;
  const displayNames = participantDisplayNames(snapshot.participants);
  const single = snapshot.candidates.length === 1;
  const section = node('section', 'panel comparison');
  add(section, add(node('div', 'section-title'), node('h2', '', single ? 'Consider this option' : 'See the trade-offs'), node('span', 'small-tag', `${snapshot.candidates.length} ${single ? 'option' : 'options'}`)), node('p', 'section-description', single ? 'No comparative ranks are available for one option. A veto excludes it for the whole group.' : 'Lower rank means stronger relative evidence. A veto excludes an option for the whole group.'));
  const policyGroup = node('div', 'policy-group');
  policyGroup.setAttribute('role', 'group'); policyGroup.setAttribute('aria-label', 'Decision rule');
  for (const key of Object.keys(labels)) {
    const b = button(labels[key], `policy-${key}`, () => dispatch({ type: 'set-policy', policy: key }, `${labels[key]} selected`), policy === key ? 'active' : '');
    b.setAttribute('aria-pressed', String(policy === key));
    policyGroup.append(b);
  }
  section.append(policyGroup);
  const alternativePolicy = policy === 'worst-rank' ? 'average-rank' : 'worst-rank';
  const alternate = evaluateDecision(snapshot, { policy: alternativePolicy, vetoedIds: Object.values(session.vetoes).flat() });
  const other = snapshot.candidates.find(c => c.id === alternate.proposedId);
  add(section, node('p', 'alternative', single ? 'Decision rules cannot compare a single option.' : other ? `${labels[alternativePolicy]} ${other.id === decision.proposedId ? 'also proposes' : 'would propose'} ${other.name}.` : 'Neither rule can propose an eligible option.'));
  const wrapper = node('div', 'table-scroll');
  wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Full candidate comparison, scroll horizontally on small screens');
  const table = node('table');
  const caption = node('caption', 'sr-only', single ? 'Single option and participant veto controls; no comparative ranks' : 'Original shortlist ranks and participant veto controls');
  const head = node('thead'); const header = node('tr');
  const candidateHead = node('th', '', 'Shared option'); candidateHead.scope = 'col'; header.append(candidateHead);
  for (const [i, p] of snapshot.participants.entries()) {
    const th = node('th'); th.scope = 'col';
    add(th, node('span', `table-avatar table-avatar-${i}`, 'ABCDEFGH'[i]), node('span', 'sr-only', displayNames[i])); header.append(th);
  }
  head.append(header); table.append(caption, head);
  const body = node('tbody');
  const rows = [...decision.ordered, ...decision.excluded];
  const display = rows.length ? rows : snapshot.candidates.map(c => ({ id: c.id, ranks: [] }));
  for (const row of display) {
    const candidate = snapshot.candidates.find(c => c.id === row.id);
    const excludedBy = snapshot.participants.map((p, i) => ({ p, i })).filter(({ p }) => session.vetoes[p.id].includes(row.id));
    const tr = node('tr', `${row.id === decision.proposedId ? 'proposed-row' : ''} ${excludedBy.length ? 'excluded-row' : ''}`);
    const name = node('th', 'candidate-name'); name.scope = 'row';
    const posterUrl = snapshot.outingType === 'movies' ? qlooImageUrl(candidate.imageUrl) : null;
    if (posterUrl) {
      const poster = node('img', 'poster-thumb'); poster.src = posterUrl;
      poster.alt = `${candidate.name} — image supplied by Qloo`; poster.width = 42; poster.height = 62;
      poster.loading = 'lazy'; poster.referrerPolicy = 'no-referrer';
      poster.addEventListener('error', () => { poster.hidden = true; }); name.append(poster);
    }
    add(name, node('strong', '', candidate.name), node('small', '', excludedBy.length ? `Excluded by ${excludedBy.map(({ i }) => displayNames[i].replace(/^Participant /, '')).join(', ')}` : row.id === decision.proposedId ? 'Proposed choice' : 'Available to consider'));
    if (listingDetail(candidate)) name.append(node('small', '', listingDetail(candidate)));
    if (snapshot.outingType !== 'movies') name.append(node('small', '', priceLabel(candidate)));
    const map = mapsLink(candidate);
    if (map) name.append(map);
    tr.append(name);
    snapshot.participants.forEach((p, i) => {
      const cell = node('td');
      const vetoed = session.vetoes[p.id].includes(row.id);
      const displayName = displayNames[i];
      const b = button(vetoed ? 'Restore' : 'Veto', `veto-${p.id}-${row.id}`, () => dispatch({ type: 'toggle-veto', participantId: p.id, candidateId: row.id }, `${displayName} ${vetoed ? 'restored' : 'vetoed'} ${candidateLabel(candidate)}`), `veto-button ${vetoed ? 'veto-active' : ''}`);
      b.setAttribute('aria-pressed', String(vetoed)); b.setAttribute('aria-label', `${displayName}: ${vetoed ? 'Restore' : 'Veto'} ${candidateLabel(candidate)}`);
      add(cell, node('span', 'rank-pill', row.ranks[i] === undefined ? '—' : String(row.ranks[i])), b); tr.append(cell);
    });
    body.append(tr);
  }
  table.append(body); wrapper.append(table);
  if (snapshot.candidates.some(c => listingDetail(c))) section.append(node('p', 'helper', 'Same-named listings may refer to the same place. Check their addresses; excluding one listing does not exclude the others.'));
  section.append(node('p', 'comparison-scroll-hint', 'Scroll across to see every person’s ranks and veto controls →'));
  add(section, wrapper, node('p', 'matrix-footnote', single ? 'A dash means no comparative rank. Vetoes and responses make no new Qloo request.' : `Ranks stay anchored to the original ${snapshot.candidates.length} options, even after a veto. No new Qloo request is made.`));
  if (!single) section.append(node('p', 'helper', 'Limit worst rank prioritises the weakest rank; Best average rank prioritises the group average. Ties use the other rank measure, then a stable option ID.'));
  return section;
}

function acceptance() {
  const section = node('section', 'panel acceptance');
  section.id = 'agreement-stage'; section.tabIndex = -1;
  const count = session.snapshot.participants.length;
  const displayNames = participantDisplayNames(session.snapshot.participants);
  add(section, node('p', 'eyebrow', '03 / LET EVERYONE HAVE A SAY'), node('h2', '', session.agreed ? 'You found your common ground.' : 'Does this work for everyone?'), node('p', 'section-description', session.agreed ? `All ${count} ${session.snapshot.source === 'recorded' ? 'synthetic participants' : 'participants'} explicitly accepted the current proposal.` : session.snapshot.source === 'recorded' ? 'Simulate each person’s response. A ranking alone doesn’t mean they agree.' : 'Let each person respond. A ranking alone doesn’t mean they agree.'));
  if (!session.decision.proposedId) { section.append(node('p', 'helper', session.decision.status === 'no-options' ? 'Restore an option before asking for acceptance.' : 'Agreement is paused until a proposal can be supported.')); return section; }
  const grid = node('div', 'acceptance-grid');
  for (const [i, p] of session.snapshot.participants.entries()) {
    const field = node('fieldset', `acceptance-person acceptance-person-${i}`);
    const displayName = displayNames[i];
    field.append(node('legend', '', displayName));
    const current = session.acceptance[p.id];
    for (const [accepted, text] of [[true, 'Works for me'], [false, 'Not for me']]) {
      const b = button(text, `accept-${p.id}-${accepted}`, () => dispatch({ type: 'set-acceptance', participantId: p.id, candidateId: session.decision.proposedId, accepted }, `${displayName} ${accepted ? 'accepted' : 'declined'} the current proposal`), current?.accepted === accepted ? `accept-selected ${accepted ? 'yes' : 'no'}` : '');
      b.setAttribute('aria-pressed', String(current?.accepted === accepted)); b.setAttribute('aria-label', `${displayName}: ${text}`); field.append(b);
    }
    if (current?.accepted === false) {
      field.append(node('p', 'helper', 'Your objection blocks agreement. Exclude this option to consider a different proposal.'));
      field.append(button('Exclude this option and reconsider', `exclude-current-${p.id}`, () => dispatch({ type: 'toggle-veto', participantId: p.id, candidateId: session.decision.proposedId }, `${displayName} excluded the current proposal`), 'text-button'));
    }
    grid.append(field);
  }
  const replies = Object.values(session.acceptance);
  add(section, node('p', `agreement-note ${session.agreed ? 'agreed' : ''}`, session.agreed ? '✓ Everyone has said yes.' : `${replies.filter(r => r.accepted).length} of ${count} accepted · ${replies.filter(r => !r.accepted).length} declined · ${count - replies.length} awaiting a response`), grid);
  return section;
}

function evidence() {
  const details = node('details', 'panel evidence');
  details.append(node('summary', '', 'Behind this comparison'));
  const warnings = node('ul', 'evidence-warnings');
  session.decision.warnings.forEach(warning => warnings.append(node('li', '', warning)));
  details.append(warnings);
  add(details, node('p', 'helper', `${session.snapshot.source === 'live' ? 'Fetched' : 'Recorded'} ${session.snapshot.recordedAt}. Affinities are query-relative evidence; input contributions describe influence on the discovery query that found an option, not personal support.`));
  const table = node('table', 'evidence-table');
  const header = node('tr');
  for (const label of ['Option', ...session.snapshot.participants.map((_, i) => `${'ABCDEFGH'[i]} affinity`)]) { const th = node('th', '', label); th.scope = 'col'; header.append(th); }
  table.append(add(node('thead'), header));
  const body = node('tbody');
  for (const candidate of session.snapshot.candidates) {
    const row = node('tr'); const title = node('th', '', candidateLabel(candidate)); title.scope = 'row'; row.append(title);
    candidate.affinities.forEach(a => row.append(node('td', '', typeof a === 'number' && Number.isFinite(a) ? number(a) : 'Unknown'))); body.append(row);
  }
  table.append(body); details.append(add(node('div', 'table-scroll'), table));
  const proposed = session.snapshot.candidates.find(c => c.id === session.decision.proposedId);
  const contributions = proposed?.contributions;
  if (contributions?.length) {
    add(details, node('h3', '', proposed.discovery?.kind === 'individual' ? 'Individual taste discovery input influence' : 'Pooled discovery input influence'));
    contributions.forEach(c => details.append(node('p', 'helper', `${session.snapshot.participants.find(p => p.seed.id === c.seedId)?.seed.name ?? c.seedId}: ${number(c.score)}`)));
  }
  add(details, node('h3', '', 'Evidence sources'));
  session.snapshot.sourceRefs.forEach(ref => details.append(node('code', 'source-ref', ref)));
  return details;
}

function render() {
  const focus = document.activeElement?.dataset?.focusKey;
  const expanded = workspace.querySelector('details.option-details')?.open;
  const main = node('div', 'main-column decision-main');
  if (revisionFeedback) {
    const banner = node('div', 'revision-banner');
    banner.append(node('span', '', revisionFeedback), button('View revised proposal →', 'view-revision', () => workspace.querySelector('#options-stage')?.focus?.(), 'text-button'));
    main.append(banner);
  }
  if (handoffOrigin) main.append(node('p', 'synthetic-note handoff-note', handoffNote));
  if (originalEvidenceSnapshot) {
    const notice = node('div', 'synthetic-note recovery-note');
    notice.append(node('p', '', `New shortlist of ${session.snapshot.candidates.length} fully evidenced options from original ${originalEvidenceSnapshot.candidates.length}. Ranks recalculated; vetoes, the decision rule and acceptance reset when this shortlist started.`), button('Restore original comparison', 'restore-evidence', () => {
      session = createSession(originalEvidenceSnapshot); originalEvidenceSnapshot = undefined;
      revisionFeedback = '';
      render(); workspace.querySelector('#options-stage')?.focus?.();
      announcement.textContent = 'Original evidence restored. Vetoes, the decision rule and acceptance reset.';
    }, 'text-button'));
    main.append(notice);
  }
  const details = node('details', 'option-details');
  details.id = 'comparison-details'; details.tabIndex = -1;
  details.open = expanded || !session.decision.proposedId;
  add(details, node('summary', '', `Compare ${session.snapshot.candidates.length} options or rule one out`), comparison(), evidence());
  const result = node('div', 'result-layout');
  const proposed = proposal();
  const body = proposed.querySelector?.('.proposal-body');
  if (body) {
    const compare = button(`Compare all ${session.snapshot.candidates.length} options →`, 'compare-options', () => {
      details.open = true; details.focus?.();
    }, 'compare-shortcut');
    compare.setAttribute('aria-controls', 'comparison-details'); body.append(compare);
  }
  result.append(proposed, acceptance());
  add(main, result);
  const alternatives = alternativesOverview(details); if (alternatives) main.append(alternatives);
  main.append(details);
  workspace.replaceChildren(groupContext(), sidebar(), main);
  updateModeLabels();
  updateVisibility();
  if (focus) workspace.querySelector(`[data-focus-key="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}

function updateModeLabels() {
  const groupLink = document.querySelector('#group-stage-link');
  if (groupLink) groupLink.href = mode === 'live' ? '#live-inputs' : '#group-stage';
  const badge = document.querySelector('#evidence-mode');
  if (badge) badge.textContent = atWelcome ? 'Group planner' : settingUp ? 'Group setup' : session?.snapshot.source === 'live' ? 'Live Qloo evidence' : 'Recorded demo';
  const note = document.querySelector('#mode-note');
  if (note) note.textContent = settingUp ? 'One question at a time · Your current options are saved' : session?.snapshot.source === 'live' ? 'Confirmed inputs · Live Qloo evidence' : evidenceCopy(session?.snapshot, 'Real Qloo evidence · Synthetic participants · No fresh API calls');
  for (const name of ['recorded', 'live']) {
    const control = document.querySelector(`#mode-${name}`);
    if (control) { control.className = mode === name ? 'mode-active' : ''; control.setAttribute('aria-pressed', String(mode === name)); }
  }
}

globalThis.addEventListener?.('hashchange', () => {
  const hash = globalThis.location?.hash;
  if (typeof hash !== 'string' || !hash.startsWith('#handoff')) return;
  const token = hash.match(/^#handoff=([0-9a-f]{64})$/)?.[1] ?? '';
  void loadHandoff(token);
});
const initialHash = globalThis.location?.hash;
if (typeof initialHash === 'string' && initialHash.startsWith('#handoff')) {
  const token = initialHash.match(/^#handoff=([0-9a-f]{64})$/)?.[1];
  if (token) await loadHandoff(token);
  else await loadHandoff('');
} else { await load('mixed-domain'); await ensureWelcomeWalkthrough(); }
const inputsRoot = document.querySelector('#live-inputs');
if (inputsRoot) {
  const request = async (path, input) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Live search could not complete. Your previous comparison is still available.');
    return result;
  };
  liveInputs = createLiveInputs({ root: inputsRoot, request, countries, getCancelLabel: () => planningFromWelcome ? 'Back to start' : 'View current options', onCancel: () => {
    liveInputs.close(); settingUp = false;
    if (planningFromWelcome) {
      planningFromWelcome = false; atWelcome = true; mode = 'recorded'; updateModeLabels(); updateVisibility();
      document.querySelector('#page-title')?.focus?.({ preventScroll: true });
      globalThis.scrollTo?.({ top: 0, behavior: 'instant' });
    }
    else { mode = session?.snapshot.source ?? 'recorded'; if (session) { render(); workspace.focus?.(); } else { atWelcome = true; updateModeLabels(); updateVisibility(); } }
  }, onSnapshot: snapshot => {
    planningFromWelcome = false;
    const update = replaceEvidence(session, snapshot);
    loadVersion++; handoffOrigin = false; clearHandoffHash(); session = update.session; revisionFeedback = ''; originalEvidenceSnapshot = undefined; mode = 'live'; settingUp = false; liveInputs.close(); errorBanner.hidden = true; render(); workspace.focus?.();
    announcement.textContent = `Live comparison loaded for ${snapshot.participants.length} people. ${update.preserved ? 'Existing vetoes and decision rule retained for this group. ' : 'New group responses started. '}Acceptance reset.`;
  } });
  document.querySelector('#mode-live').addEventListener('click', startPlanning);
  document.querySelector('#mode-recorded').addEventListener('click', startDemo);
  try { const status = await json('/api/status'); document.querySelector('#mode-live').disabled = !status.live; } catch { document.querySelector('#mode-live').disabled = true; }
  const start = document.querySelector('#start-plan');
  if (start) { start.disabled = document.querySelector('#mode-live').disabled; start.addEventListener('click', startPlanning); }
  const availability = document.querySelector('#live-availability');
  if (availability && document.querySelector('#mode-live').disabled) availability.textContent = 'Live planning is unavailable right now. Try the recorded demo.';
}
document.querySelector('#start-demo')?.addEventListener('click', startDemo);
document.querySelector('#hero-demo')?.addEventListener('click', startDemo);
document.querySelector('#start-over')?.addEventListener('click', async () => {
  loadVersion++; handoffOrigin = false; clearHandoffHash();
  atWelcome = true; settingUp = false; liveInputs?.close(); errorBanner.hidden = true; announcement.textContent = ''; updateModeLabels(); updateVisibility();
  document.querySelector('#start-plan')?.focus?.();
  await ensureWelcomeWalkthrough();
});
updateVisibility();
