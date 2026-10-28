import { evidenceCopy } from './evidence-copy.mjs';
// The motion sample owns an isolated session; scripted responses never enter the app session.
export function tasteArtwork(seed) {
  if (seed?.type !== 'film') return null;
  const name = seed.name.replace(/\s*\(\d{4}\)$/, '').trim().toLowerCase();
  return ({ 'john wick': '/assets/taste-action.webp', 'lady bird': '/assets/taste-indie.webp', dune: '/assets/taste-desert.webp' })[name] ?? null;
}

export function recordedVenueArtwork(snapshot, candidate) {
  if (snapshot?.source !== 'recorded' || snapshot.id !== 'sightseeing') return null;
  const assets = {
    'ff8a43d9-bcd9-4b86-b5b6-6692eafcee1d': { url: '/assets/one-world-trade-center.webp', credit: 'Willian Justen de Vasconcellos / Pexels', className: 'venue-wtc' },
    'b2b057e1-f085-4b83-9c24-ed0110f8bea2': { url: '/assets/statue-of-liberty.webp', credit: 'Louis / Pexels', className: 'venue-liberty' }
  };
  const syntheticAssets = { '00000000-0000-4000-8000-000000000031': assets['ff8a43d9-bcd9-4b86-b5b6-6692eafcee1d'], '00000000-0000-4000-8000-000000000032': assets['b2b057e1-f085-4b83-9c24-ed0110f8bea2'] };
  return (snapshot.evidenceKind === 'synthetic' ? syntheticAssets : assets)[candidate?.id.toLowerCase()] ?? null;
}

export function createStoryFrames(snapshot, { createSession, applyAction }) {
  let state = createSession(snapshot);
  const frames = [];
  const frame = (at, chapter, caption, detail, action) => {
    if (action) state = applyAction(state, action);
    frames.push({ at, chapter, caption, detail, session: state });
  };
  const initial = state.decision.proposedId;
  const last = snapshot.participants.at(-1).id;
  frame(0, 0, 'Different tastes. A day out together.', 'One favorite each. Three starting points, one shared plan.');
  frame(4500, 1, 'A cultural connection, beyond the obvious.', 'Qloo connects their film tastes to five places in New York.');
  frame(8000, 2, 'See the trade-off before you decide.', 'CommonGround compares the same options for every person.');
  frame(13000, 3, 'A suggestion is not an agreement.', 'C declines. The option stays until someone explicitly rules it out.',
    { type: 'set-acceptance', participantId: last, candidateId: initial, accepted: false });
  frame(15000, 3, 'Everyone gets a say. And a way forward.', 'C rules this option out for the group. CommonGround reconsiders.',
    { type: 'toggle-veto', participantId: last, candidateId: initial });
  frame(17000, 4, 'New proposal. A fresh conversation.', 'The evidence stays. The proposal changes. Every response resets.');
  frame(22000, 5, 'Your common ground is a human decision.', 'The group responds to the revised proposal, one person at a time.');
  snapshot.participants.forEach((p, i) => frame(23000 + i * 1000, 5,
    'Your common ground is a human decision.', 'Scripted example: all three people explicitly accept the revised proposal.',
    { type: 'set-acceptance', participantId: p.id, candidateId: state.decision.proposedId, accepted: true }));
  return frames;
}

export function createHomeStory({ root, frames, isActive = () => true }) {
  const el = (tag, className = '', text) => {
    const n = document.createElement(tag); n.className = className;
    if (text !== undefined) n.textContent = evidenceCopy(frames[0].session.snapshot, text);
    return n;
  };
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const starts = [0, 4500, 8000, 13000, 17000, 22000];
  const names = ['Tastes', 'Connections', 'Trade-offs', 'A veto', 'Revision', 'Agreement'];
  const duration = 28000;
  let elapsed = 0; let currentFrame = -1; let visible = !globalThis.IntersectionObserver;
  let playing = !media?.matches; let destroyed = false;
  const snapshot = frames[0].session.snapshot;
  const original = snapshot.candidates.find(c => c.id === frames[0].session.decision.proposedId);
  const header = el('div', 'story-header');
  header.append(el('span', 'story-wordmark', 'CommonGround'), el('span', 'story-goal', 'A day out in New York'), el('span', 'story-source', 'Recorded Qloo evidence · Scripted responses'));
  const group = el('div', 'story-group-strip');
  snapshot.participants.forEach((p, i) => {
    const item = el('div', 'story-group-person person-' + i);
    item.append(el('span', 'person-token', 'ABC'[i]), el('span', '', p.seed.name.replace(/\s*\(\d{4}\)$/, '')));
    group.append(item);
  });
  const stage = el('div', 'motion-stage');
  const caption = el('div', 'story-caption');
  const index = el('span', 'story-chapter-number');
  const title = el('h2', 'story-caption-title');
  const detail = el('p', 'story-caption-detail');
  const copy = el('div', 'story-caption-copy'); copy.append(title, detail); caption.append(index, copy);
  const controls = el('div', 'story-controls');
  const play = el('button', 'explain-play'); play.type = 'button';
  const chapters = el('div', 'story-chapters'); chapters.setAttribute('role', 'group'); chapters.setAttribute('aria-label', 'Product film chapters');
  const steps = names.map((name, i) => {
    const b = el('button', 'story-chapter', name); b.type = 'button'; b.dataset.step = String(i);
    b.dataset.label = '0' + (i + 1);
    b.setAttribute('aria-label', 'Chapter ' + (i + 1) + ': ' + name);
    b.addEventListener('click', () => { elapsed = starts[i]; playing = false; update(); });
    chapters.append(b); return b;
  });
  const time = el('span', 'story-time');
  const replay = el('button', 'story-replay', 'Replay'); replay.type = 'button'; replay.setAttribute('aria-label', 'Replay product film');
  const progress = el('progress', 'story-progress'); progress.max = duration; progress.value = 0;
  progress.setAttribute('aria-label', 'Product film progress');
  controls.append(play, chapters, time, replay);
  const note = el('p', 'story-footnote', 'Recorded example. Fictional tastes, real Qloo ranks, simulated responses. Taste artwork is illustrative.');
  root.replaceChildren(header, group, stage, caption, progress, controls, note);

  function photo(candidate, className) {
    const figure = el('figure', className);
    const art = recordedVenueArtwork(snapshot, candidate);
    if (art) {
      figure.className += ' ' + art.className;
      const img = el('img'); img.src = art.url; img.alt = candidate.name + ' — licensed photograph'; img.decoding = 'async';
      img.addEventListener('error', () => { img.hidden = true; figure.append(el('span', 'photo-fallback', candidate.name)); }, { once: true });
      figure.append(img, el('figcaption', 'story-photo-credit', art.credit));
    } else {
      figure.append(el('span', 'photo-fallback', String(snapshot.candidates.indexOf(candidate) + 1).padStart(2, '0')));
    }
    return figure;
  }
  function renderFrame(frame) {
    const scene = frame.chapter;
    const composition = el('div', 'story-frame story-scene-' + scene + (frame.at === 15000 ? ' is-vetoed' : ''));
    if (scene === 0) {
      const tasteWall = el('div', 'story-taste-wall');
      snapshot.participants.forEach((p, i) => {
        const card = el('div', 'story-taste-card person-' + i);
        const img = el('img'); img.src = tasteArtwork(p.seed); img.alt = ''; img.decoding = 'async';
        const label = el('div', 'story-taste-label');
        label.append(el('span', 'person-token', 'ABC'[i]), el('span', 'story-taste-kind', 'A film they love'), el('strong', '', p.seed.name.replace(/\s*\(\d{4}\)$/, '')));
        card.append(img, label); tasteWall.append(card);
      });
      composition.append(tasteWall, el('div', 'story-goal-pill', '3 people · 5 possibilities · A day out in New York'));
    } else if (scene === 1) {
      const sheet = el('div', 'story-contact-sheet');
      snapshot.candidates.forEach((c, i) => {
        const card = el('div', 'story-option');
        const repeated = snapshot.candidates.filter(other => other.name === c.name).length > 1;
        const listing = repeated ? ' · Listing ' + (snapshot.candidates.filter(other => other.name === c.name).indexOf(c) + 1) : '';
        card.append(photo(c, 'story-option-photo'), el('span', 'story-option-number', '0' + (i + 1)), el('strong', '', c.name + listing));
        sheet.append(card);
      });
      composition.append(el('p', 'story-qloo-source', 'DISCOVERED THROUGH QLOO · FROM FILM TASTES TO PLACES'), sheet);
    } else {
      const state = frame.session;
      const candidate = scene === 3 ? original : snapshot.candidates.find(c => c.id === state.decision.proposedId);
      const row = (scene === 3 ? frames[2].session : state).decision.ordered[0];
      const card = el('div', 'story-proposal');
      const image = photo(candidate, 'story-proposal-photo');
      const evidence = el('div', 'story-evidence');
      evidence.append(el('p', 'eyebrow', state.agreed ? 'COMMON GROUND FOUND' : frame.at === 15000 ? 'RULED OUT BY C' : scene === 4 ? 'REVISED PROPOSAL' : 'A PROPOSAL, NOT A PROMISE'), el('h3', 'story-venue-title', candidate.name));
      const rows = el('div', 'story-ranks');
      snapshot.participants.forEach((p, i) => {
        const person = el('div', 'story-rank-person person-' + i);
        const response = state.acceptance[p.id];
        const identity = el('span', 'story-rank-identity');
        identity.append(el('small', '', 'Participant ' + 'ABC'[i]), el('strong', '', p.seed.name.replace(/\s*\(\d{4}\)$/, '')));
        const rank = el('span', 'story-rank-value', row.ranks[i] + ' / ' + snapshot.candidates.length);
        person.append(el('span', 'person-token', 'ABC'[i]), identity, rank);
        if (scene === 5) person.append(el('span', response?.accepted ? 'story-response response-yes' : 'story-response', response?.accepted ? '✓ Works for me' : 'Awaiting response'));
        rows.append(person);
      });
      evidence.append(rows, el('p', 'story-rank-note', 'Relative ranks among the original five. Lower is stronger; ranks are not consent.'));
      if (scene === 3) {
        const ruledOut = frame.at >= 15000;
        const action = el('div', 'scripted-action');
        action.append(el('span', 'scripted-action-label', 'SCRIPTED ACTION · PARTICIPANT C'),
          el('span', 'scripted-decline', '✓ Not for me'),
          el('span', ruledOut ? 'scripted-veto activated' : 'scripted-veto', ruledOut ? '✓ Ruled out for the group' : 'Then: rule this option out →'));
        evidence.append(action);
      }
      if (scene === 4) evidence.append(el('p', 'story-revision', 'Proposal revised · Responses reset'));
      if (scene === 5) evidence.append(el('p', state.agreed ? 'story-agreement complete' : 'story-agreement',
        state.agreed ? '✓ All three explicitly agreed' : Object.values(state.acceptance).filter(r => r.accepted).length + ' / 3 scripted responses'));
      card.append(image, evidence); composition.append(card);
    }
    stage.replaceChildren(composition);
    title.textContent = frame.caption; detail.textContent = evidenceCopy(snapshot, frame.detail);
    index.textContent = '0' + (scene + 1) + ' / 06';
  }
  function update() {
    const frameIndex = frames.findLastIndex(f => f.at <= elapsed);
    const frame = frames[Math.max(0, frameIndex)];
    root.dataset.scene = String(frame.chapter); root.dataset.playing = String(playing && visible && isActive() && !document.hidden);
    if (frameIndex !== currentFrame) { currentFrame = frameIndex; renderFrame(frame); }
    play.textContent = playing ? 'Pause' : elapsed >= duration ? 'Play again' : 'Play';
    play.setAttribute('aria-label', playing ? 'Pause product film' : 'Play product film');
    steps.forEach((b, i) => b.setAttribute('aria-pressed', String(frame.chapter === i)));
    time.textContent = '0:' + String(Math.floor(elapsed / 1000)).padStart(2, '0') + ' / 0:28';
    progress.value = elapsed;
  }
  play.addEventListener('click', () => {
    if (elapsed >= duration) { elapsed = 0; currentFrame = -1; }
    playing = !playing; update();
  });
  replay.addEventListener('click', () => { elapsed = 0; currentFrame = -1; playing = !media?.matches; update(); });
  const onMedia = event => { if (event.matches) { playing = false; update(); } };
  media?.addEventListener?.('change', onMedia);
  const observer = globalThis.IntersectionObserver ? new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .75); update();
  }, { threshold: [.75] }) : null;
  // A phone may show the top of the player while its explanation is still below
  // the fold. Begin only when the caption itself is readable.
  observer?.observe(caption);
  update();
  const timer = setInterval(() => {
    if (destroyed) return;
    if (playing && visible && isActive() && !document.hidden) {
      elapsed = Math.min(duration, elapsed + 100);
      if (elapsed === duration) playing = false;
    }
    update();
  }, 100);
  timer.unref?.();
  return { destroy() { destroyed = true; clearInterval(timer); observer?.disconnect(); media?.removeEventListener?.('change', onMedia); } };
}
