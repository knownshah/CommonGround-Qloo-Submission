import { evidenceCopy } from './evidence-copy.mjs';
// Homepage showcase: a code-driven product ad and an interactive "taste bridge".
// Everything here is computed from a recorded Qloo snapshot with the real decision engine.
// Responses in the ad are scripted and labelled as such; nothing here touches the app session.

const PERSON_LABELS = ['A', 'B', 'C'];
const TYPE_LABELS = { film: 'Film', artist: 'Artist', game: 'Game', person: 'Public figure' };
const POLICIES = [
  { id: 'worst-rank', label: 'Limit worst rank', hint: 'Nobody is left far behind' },
  { id: 'average-rank', label: 'Best average rank', hint: 'Best overall, even if one person loses' }
];

export const cleanSeedName = name => String(name ?? '').replace(/\s*\(\d{4}\)$/, '').trim();
const participantLabel = person => `${person.letter} (${person.name} fan)`;

/**
 * Pure model of the rank matrix for a snapshot. `evaluate` is the shared decision engine,
 * injected so this module has no browser-only imports and can be tested under Node.
 */
export function matrixModel(snapshot, { policy = 'worst-rank', vetoedIds = [] } = {}, evaluate) {
  const decision = evaluate(snapshot, { policy, vetoedIds });
  const people = snapshot.participants.map((p, i) => ({
    index: i, letter: PERSON_LABELS[i] ?? String(i + 1), name: cleanSeedName(p.seed.name),
    type: TYPE_LABELS[p.seed.type] ?? 'Taste', seedId: p.seed.id
  }));
  const byId = new Map(snapshot.candidates.map(c => [c.id.toLowerCase(), c]));
  const rows = [...decision.ordered, ...decision.excluded].map(row => {
    const candidate = byId.get(row.id);
    const influence = people.map(person => {
      const found = candidate?.contributions?.find(c => c.seedId === person.seedId);
      return typeof found?.score === 'number' ? found.score : null;
    });
    return {
      id: row.id, name: candidate?.name ?? row.id, ranks: row.ranks, rankSum: row.rankSum, worstRank: row.worstRank,
      vetoed: decision.excluded.some(x => x.id === row.id), proposed: row.id === decision.proposedId,
      influence: influence.every(v => v === null) ? null : influence
    };
  });
  return { evidenceKind: snapshot.evidenceKind, status: decision.status, proposedId: decision.proposedId, people, rows, total: snapshot.candidates.length, warnings: decision.warnings };
}

/** The option most people rank first, ties broken by lowest rank sum then id. The "obvious" crowd pick. */
export function crowdPick(model) {
  const live = model.rows.filter(r => !r.vetoed && r.ranks.length);
  const firsts = r => r.ranks.filter(rank => rank === 1).length;
  return [...live].sort((a, b) => firsts(b) - firsts(a) || a.rankSum - b.rankSum || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/** Facts the ad needs, all derived from real ranks. Returns null if the evidence cannot support the story. */
export function adFacts(snapshot, evaluate) {
  const balanced = matrixModel(snapshot, { policy: 'worst-rank' }, evaluate);
  if (balanced.status !== 'ready' || balanced.people.length < 3) return null;
  const crowd = crowdPick(balanced);
  const proposed = balanced.rows.find(r => r.proposed);
  if (!crowd || !proposed) return null;
  const worst = Math.max(...crowd.ranks);
  const leftBehind = crowd.ranks.indexOf(worst);
  return {
    model: balanced, crowd, proposed,
    leftBehind: { person: balanced.people[leftBehind], rank: worst },
    differs: crowd.id !== proposed.id
  };
}

export const ordinal = n => (n >= 11 && n <= 13) ? `${n}th` : `${n}${['th', 'st', 'nd', 'rd'][n % 10 < 4 ? n % 10 : 0]}`;

function baseEl(tag, className = '', text, ns) {
  const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  if (className) node.setAttribute('class', className);
  if (text !== undefined) node.textContent = text;
  return node;
}
const el = baseEl;
const scopedEl = snapshot => (...args) => { args[2] = evidenceCopy(snapshot, args[2]); return baseEl(...args); };
const append = (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; };
const SVG = 'http://www.w3.org/2000/svg';
const motionReduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* ------------------------------------------------------------------ the ad */

const SCENES = [
  { name: 'Tastes', at: 0 },
  { name: 'Qloo', at: 4200 },
  { name: 'Trade-offs', at: 9000 },
  { name: 'Balance', at: 14500 },
  { name: 'Agreement', at: 19000 },
  { name: 'Yours', at: 23500 }
];
const LOOP = 27500;

export function createAd({ root, facts, isActive = () => true }) {
  const el = scopedEl(facts.model);
  const { model, crowd, proposed, leftBehind, differs } = facts;
  const people = model.people;
  const reduced = motionReduced();
  let elapsed = 0; let scene = -1; let playing = !reduced; let visible = !globalThis.IntersectionObserver; let last = 0; let raf = 0; let destroyed = false;

  const stage = el('div', 'ad-stage');
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-roledescription', 'product film');
  stage.setAttribute('aria-label', evidenceCopy(facts.model, 'CommonGround in 27 seconds. Recorded Qloo evidence, fictional people, scripted responses.'));
  const glow = el('div', 'ad-glow'); glow.setAttribute('aria-hidden', 'true');
  const frame = el('div', 'ad-frame');

  // Scene 1: tastes
  const s1 = el('section', 'ad-scene ad-s1');
  const s1Title = el('h2', 'ad-title');
  append(s1Title, el('span', 'ad-line', 'Friday night.'), el('span', 'ad-line', 'Three friends.'), el('span', 'ad-line ad-accent', 'Zero agreement.'));
  const tasteRow = el('div', 'ad-tastes');
  people.forEach((p, i) => {
    const card = el('div', `ad-taste person-${i}`);
    card.style.setProperty('--i', String(i));
    append(card, el('span', 'ad-token', p.letter), el('small', '', p.type), el('strong', '', p.name));
    tasteRow.append(card);
  });
  append(s1, s1Title, tasteRow);

  // Scene 2: Qloo bridge
  const s2 = el('section', 'ad-scene ad-s2');
  append(s2, el('h2', 'ad-title ad-title-sm', 'A film. An artist. A game.'), el('p', 'ad-sub', 'Qloo reads taste across worlds and finds where they meet.'));
  const web = el('div', 'ad-web');
  const left = el('div', 'ad-web-col ad-web-tastes');
  people.forEach((p, i) => { const n = el('span', `ad-chip person-${i}`); append(n, el('b', '', p.letter), document.createTextNode(p.name)); left.append(n); });
  const hub = el('div', 'ad-hub'); append(hub, el('span', 'ad-hub-ring'), el('strong', '', 'Qloo'), el('small', '', 'taste graph'));
  const right = el('div', 'ad-web-col ad-web-places');
  model.rows.forEach((r, i) => { const n = el('span', 'ad-place', r.name); n.style.setProperty('--i', String(i)); right.append(n); });
  const lines = el('svg', 'ad-lines', undefined, SVG); lines.setAttribute('aria-hidden', 'true');
  append(web, lines, left, hub, right);
  append(s2, web);

  // Scene 3: trade-offs
  const s3 = el('section', 'ad-scene ad-s3');
  append(s3, el('h2', 'ad-title ad-title-sm', differs ? 'The obvious pick leaves someone behind.' : 'Same options. Every person ranked.'),
    el('p', 'ad-sub', differs ? `${crowd.name} is first for most of the group, but ${ordinal(leftBehind.rank)} for the ${leftBehind.person.name} fan.` : 'Each person ranks the same five places.'));
  const grid = el('div', 'ad-matrix');
  const head = el('div', 'ad-matrix-row ad-matrix-head');
  append(head, el('span', ''), ...people.map((p, i) => { const h = el('span', `ad-matrix-cell person-${i}`); append(h, el('b', '', p.letter)); return h; }));
  grid.append(head);
  [...model.rows].sort((a, b) => a.rankSum - b.rankSum || (a.id < b.id ? -1 : 1)).forEach((r, rowIndex) => {
    const row = el('div', 'ad-matrix-row' + (r.id === crowd.id ? ' is-crowd' : ''));
    row.style.setProperty('--i', String(rowIndex));
    append(row, el('span', 'ad-matrix-name', r.name));
    r.ranks.forEach((rank, i) => {
      const cell = el('span', `ad-matrix-cell person-${i}`);
      append(cell, el('i', `ad-rank ad-rank-${rank}` + (r.id === crowd.id && i === people.indexOf(leftBehind.person) && differs ? ' is-left' : ''), String(rank)));
      row.append(cell);
    });
    grid.append(row);
  });
  append(s3, grid, el('p', 'ad-foot', `Rank 1 is strongest among these ${model.total} options. Ranks are relative evidence, not enjoyment scores.`));

  // Scene 4: balance
  const s4 = el('section', 'ad-scene ad-s4');
  append(s4, el('h2', 'ad-title ad-title-sm', 'See it. Then choose what fair means.'));
  const duel = el('div', 'ad-duel');
  const makeCard = (kind, title, row, note) => {
    const card = el('div', `ad-pick ad-pick-${kind}`);
    const ranks = el('div', 'ad-pick-ranks');
    row.ranks.forEach((rank, i) => { const r = el('span', `ad-pick-rank person-${i}`); append(r, el('b', '', people[i].letter), el('i', '', ordinal(rank))); ranks.append(r); });
    append(card, el('small', '', title), el('strong', '', row.name), ranks, el('p', '', note));
    return card;
  };
  if (differs) append(duel, makeCard('crowd', 'Crowd pick', crowd, `Ranked ${ordinal(leftBehind.rank)} for the ${leftBehind.person.name} fan.`));
  append(duel, makeCard('balanced', 'Limit worst rank', proposed, `Nobody lower than ${ordinal(proposed.worstRank)}.`));
  append(s4, duel, el('p', 'ad-foot', 'CommonGround proposes. Your group decides which rule fits the night.'));

  // Scene 5: agreement
  const s5 = el('section', 'ad-scene ad-s5');
  append(s5, el('h2', 'ad-title ad-title-sm', 'A suggestion is not an agreement.'), el('p', 'ad-sub', 'Everyone answers for themselves. Anyone can say no.'));
  const decide = el('div', 'ad-decide');
  const ring = el('div', 'ad-ring'); ring.setAttribute('aria-hidden', 'true');
  append(ring, el('span', 'ad-ring-core'), el('strong', '', proposed.name));
  const answers = el('div', 'ad-answers');
  people.forEach((p, i) => { const a = el('div', `ad-answer person-${i}`); a.style.setProperty('--i', String(i)); append(a, el('b', '', p.letter), el('span', '', 'Works for me')); answers.append(a); });
  append(decide, ring, answers);
  append(s5, decide, el('p', 'ad-foot', 'Scripted example. In the app, every response is a real choice.'));

  // Scene 6: yours
  const s6 = el('section', 'ad-scene ad-s6');
  const brand = el('div', 'ad-brand'); append(brand, el('span', 'ad-brand-mark'), el('strong', '', 'CommonGround'));
  append(s6, brand, el('h2', 'ad-title', 'Your common ground, found.'),
    el('p', 'ad-sub', 'Taste evidence from Qloo. Fair trade-offs you can see. The final say stays human.'),
    el('p', 'ad-tags', 'Powered by Qloo · Agent-ready via MCP'));

  const scenes = [s1, s2, s3, s4, s5, s6];
  frame.append(...scenes);

  // Controls
  const bar = el('div', 'ad-bar');
  const play = el('button', 'ad-play'); play.type = 'button';
  const chapters = el('div', 'ad-chapters'); chapters.setAttribute('role', 'group'); chapters.setAttribute('aria-label', 'Film chapters');
  const dots = SCENES.map((s, i) => {
    const b = el('button', 'ad-dot'); b.type = 'button'; b.setAttribute('aria-label', `Film scene ${i + 1}: ${s.name}`);
    const fill = el('span', 'ad-dot-fill'); b.append(fill);
    b.addEventListener('click', () => { seek(s.at + 50); });
    chapters.append(b); return { b, fill };
  });
  const clock = el('span', 'ad-clock', '0:00');
  append(bar, play, chapters, clock);
  const caption = el('p', 'ad-caption', 'Recorded Qloo evidence · Fictional people · Scripted responses');
  append(stage, glow, frame, bar);
  root.replaceChildren(stage, caption);

  function sceneAt(ms) { let idx = 0; SCENES.forEach((s, i) => { if (ms >= s.at) idx = i; }); return idx; }
  function paint() {
    const idx = sceneAt(elapsed);
    if (idx !== scene) {
      scene = idx;
      scenes.forEach((node, i) => { node.classList.toggle('is-active', i === idx); node.classList.toggle('is-past', i < idx); node.setAttribute('aria-hidden', i === idx ? 'false' : 'true'); });
      stage.dataset.scene = String(idx);
      if (idx === 1) requestAnimationFrame(drawLines);
    }
    dots.forEach(({ b, fill }, i) => {
      const start = SCENES[i].at; const end = SCENES[i + 1]?.at ?? LOOP;
      const pct = i < idx ? 100 : i > idx ? 0 : Math.min(100, ((elapsed - start) / (end - start)) * 100);
      fill.style.setProperty('--p', pct.toFixed(1) + '%');
      b.setAttribute('aria-current', i === idx ? 'step' : 'false');
    });
    const s = Math.floor(elapsed / 1000); clock.textContent = `0:${String(s).padStart(2, '0')}`;
  }
  function label() { play.textContent = playing ? 'Pause' : (elapsed >= LOOP - 50 || elapsed === 0 ? 'Play' : 'Resume'); play.setAttribute('aria-pressed', String(playing)); }
  function tick(now) {
    raf = 0; if (destroyed) return;
    if (playing && visible && isActive() && !document.hidden) {
      elapsed += Math.min(now - (last || now), 80); last = now;
      if (elapsed >= LOOP) elapsed = 0;
      paint();
    } else last = 0;
    raf = requestAnimationFrame(tick);
  }
  function seek(ms) { elapsed = Math.max(0, Math.min(LOOP - 1, ms)); scene = -1; paint(); label(); }
  play.addEventListener('click', () => { playing = !playing; last = 0; label(); });

  function drawLines() {
    const rect = web.getBoundingClientRect(); if (!rect.width) return;
    const stacked = getComputedStyle(web).flexDirection === 'column';
    lines.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    lines.replaceChildren();
    const point = (node, side) => {
      const r = node.getBoundingClientRect();
      return stacked ? { x: r.left - rect.left + r.width / 2, y: (side === 'out' ? r.bottom : r.top) - rect.top }
        : { x: (side === 'out' ? r.right : r.left) - rect.left, y: r.top - rect.top + r.height / 2 };
    };
    const curve = (a, b, cls, i) => {
      const path = el('path', cls, undefined, SVG);
      const mid = stacked ? { x1: a.x, y1: (a.y + b.y) / 2, x2: b.x, y2: (a.y + b.y) / 2 } : { x1: (a.x + b.x) / 2, y1: a.y, x2: (a.x + b.x) / 2, y2: b.y };
      path.setAttribute('d', `M${a.x},${a.y} C${mid.x1},${mid.y1} ${mid.x2},${mid.y2} ${b.x},${b.y}`);
      path.style.setProperty('--i', String(i)); lines.append(path);
    };
    [...left.children].forEach((n, i) => curve(point(n, 'out'), point(hub, 'in'), `ad-line-in person-${i}`, i));
    [...right.children].forEach((n, i) => curve(point(hub, 'out'), point(n, 'in'), 'ad-line-out', i));
  }
  const onResize = () => { if (scene === 1) drawLines(); };
  globalThis.addEventListener?.('resize', onResize);
  if (globalThis.IntersectionObserver) new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); }, { threshold: 0.25 }).observe(stage);

  paint(); label();
  if (reduced) { /* a calm still: start on the matrix, which carries the product's point */ seek(SCENES[2].at + 600); }
  raf = requestAnimationFrame(tick);
  return {
    seek, pause() { playing = false; label(); },
    destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); globalThis.removeEventListener?.('resize', onResize); }
  };
}

/* -------------------------------------------------------- the taste bridge */

export function createBridge({ root, snapshot, evaluate, announce = () => {} }) {
  const el = scopedEl(snapshot);
  let policy = 'worst-rank';
  const vetoed = new Set();
  let selected = null;
  const base = matrixModel(snapshot, {}, evaluate);
  const people = base.people;

  const legend = el('div', 'bridge-legend');
  people.forEach((p, i) => {
    const item = el('div', `bridge-person person-${i}`);
    append(item, el('span', 'bridge-token', p.letter), el('span', 'bridge-person-copy'));
    append(item.lastChild, el('small', '', p.type), el('strong', '', p.name));
    legend.append(item);
  });

  const controls = el('div', 'bridge-controls');
  const policyGroup = el('div', 'bridge-policy'); policyGroup.setAttribute('role', 'group'); policyGroup.setAttribute('aria-label', 'Decision rule');
  const policyButtons = POLICIES.map(p => {
    const b = el('button', 'bridge-policy-btn'); b.type = 'button'; b.dataset.policy = p.id;
    append(b, el('strong', '', p.label), el('small', '', p.hint));
    b.addEventListener('click', () => { policy = p.id; render(); announce(`Rule: ${p.label}.`); });
    policyGroup.append(b); return b;
  });
  const reset = el('button', 'bridge-reset', 'Reset'); reset.type = 'button';
  reset.addEventListener('click', () => { vetoed.clear(); policy = 'worst-rank'; selected = null; render(); announce('Reset to the original comparison.'); });
  append(controls, policyGroup, reset);

  const list = el('ol', 'bridge-list');
  const detail = el('div', 'bridge-detail'); detail.setAttribute('aria-live', 'polite');
  const verdict = el('p', 'bridge-verdict'); verdict.setAttribute('role', 'status');
  const layout = el('div', 'bridge-layout'); append(layout, list, detail);
  const note = el('p', 'bridge-note', 'Recorded Qloo evidence from October 6, 2026, with fictional participants. Ranks are relative to these five places and do not predict enjoyment.');
  root.replaceChildren(legend, controls, verdict, layout, note);

  function rankTrack(row) {
    const track = el('span', 'bridge-track'); track.setAttribute('aria-hidden', 'true');
    for (let n = 1; n <= base.total; n++) track.append(el('i', 'bridge-tick'));
    row.ranks.forEach((rank, i) => {
      const dot = el('b', `bridge-dot person-${i}`, people[i].letter);
      dot.style.setProperty('--rank', String(rank - 1)); dot.style.setProperty('--of', String(base.total - 1));
      dot.style.setProperty('--nudge', String(i)); track.append(dot);
    });
    return track;
  }

  function renderDetail(row) {
    detail.replaceChildren();
    if (!row) { append(detail, el('p', 'bridge-hint', 'Select a place to see how each person ranks it and which taste pulled it in.')); return; }
    append(detail, el('small', 'bridge-detail-kicker', row.proposed ? 'Proposed under this rule' : row.vetoed ? 'Ruled out' : 'Option'), el('h3', '', row.name));
    const ranks = el('ul', 'bridge-ranks');
    row.ranks.forEach((rank, i) => {
      const li = el('li', `person-${i}`);
      append(li, el('b', '', people[i].letter), el('span', '', people[i].name), el('strong', '', `rank ${rank} of ${base.total}`));
      ranks.append(li);
    });
    detail.append(ranks);
    if (row.influence) {
      append(detail, el('h4', '', 'Which taste pulled this in'));
      const bars = el('ul', 'bridge-influence');
      row.influence.forEach((score, i) => {
        if (score === null) return;
        const li = el('li', `person-${i}`); const bar = el('span', 'bridge-bar'); const fill = el('i', ''); fill.style.setProperty('--w', (Math.max(0, Math.min(1, score)) * 100).toFixed(1) + '%'); bar.append(fill);
        append(li, el('b', '', people[i].letter), bar, el('em', '', score.toFixed(3)));
        bars.append(li);
      });
      append(detail, bars, el('p', 'bridge-caveat', 'Qloo input influence: how much each declared taste shaped discovery of this place. It describes the evidence, not anyone’s satisfaction.'));
    }
  }

  function render() {
    const model = matrixModel(snapshot, { policy, vetoedIds: [...vetoed] }, evaluate);
    policyButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.policy === policy)));
    list.replaceChildren();
    model.rows.forEach((row, i) => {
      const li = el('li', 'bridge-row' + (row.proposed ? ' is-proposed' : '') + (row.vetoed ? ' is-vetoed' : '') + (selected === row.id ? ' is-selected' : ''));
      li.style.setProperty('--i', String(i));
      const open = el('button', 'bridge-open'); open.type = 'button'; open.setAttribute('aria-pressed', String(selected === row.id));
      append(open, el('span', 'bridge-name', row.name), row.proposed ? el('span', 'bridge-pill', 'Proposed') : row.vetoed ? el('span', 'bridge-pill bridge-pill-out', 'Ruled out') : el('span', 'bridge-worst', `worst rank ${row.worstRank}`), rankTrack(row));
      open.addEventListener('click', () => { selected = row.id; render(); });
      const veto = el('button', 'bridge-veto', row.vetoed ? 'Restore' : 'Rule out'); veto.type = 'button';
      veto.setAttribute('aria-label', `${row.vetoed ? 'Restore' : 'Rule out'} ${row.name}`);
      veto.addEventListener('click', () => { if (row.vetoed) vetoed.delete(row.id); else vetoed.add(row.id); render(); const next = matrixModel(snapshot, { policy, vetoedIds: [...vetoed] }, evaluate); announce(next.proposedId ? `Now proposing ${next.rows.find(r => r.proposed)?.name}.` : 'No options left.'); });
      append(li, open, veto); list.append(li);
    });
    const proposed = model.rows.find(r => r.proposed);
    verdict.textContent = proposed ? `Proposal: ${proposed.name}. ${vetoed.size ? `${vetoed.size} ruled out. ` : ''}A proposal is not an agreement.` : 'Every option has been ruled out.';
    renderDetail(model.rows.find(r => r.id === selected) ?? model.rows.find(r => r.proposed) ?? null);
  }
  render();
  return { render };
}

/* ------------------------------------------------------- agent exchange */
/**
 * Pure model of the example agent exchange, derived from the recorded snapshot with the real engine.
 * The prompts are scripted; ranks, proposal and revision are computed. Returns null if the evidence
 * cannot support the story (fewer than 2 people, paused evidence, or no revision available).
 */
export function exchangeModel(snapshot, evaluate) {
  const first = matrixModel(snapshot, { policy: 'worst-rank' }, evaluate);
  const proposed = first.rows.find(r => r.proposed);
  if (first.status !== 'ready' || !proposed || proposed.ranks.length < 2) return null;
  const worst = Math.max(...proposed.ranks);
  const objector = first.people[proposed.ranks.indexOf(worst)];
  const second = matrixModel(snapshot, { policy: 'worst-rank', vetoedIds: [proposed.id] }, evaluate);
  const revised = second.rows.find(r => r.proposed);
  if (!revised) return null;
  const crowd = crowdPick(first);
  return { evidenceKind: snapshot.evidenceKind, people: first.people, total: first.total, proposed, objector, objectorRank: worst, revised, crowd };
}

const rankLine = (people, row, total) => people.map((p, i) => `${participantLabel(p)}: rank ${row.ranks[i]} of ${total}`);

export function createAgentExchange({ root, model, announce = () => {} }) {
  const el = scopedEl(model);
  const { people, total, proposed, objector, objectorRank, revised, crowd } = model;
  const log = el('ol', 'exchange-log'); log.setAttribute('aria-live', 'polite');
  const bubble = (who, ...parts) => { const li = el('li', `exchange-msg exchange-${who}`); append(li, el('small', '', who === 'you' ? 'You' : who === 'tool' ? 'Tool call' : 'Your agent')); parts.forEach(part => li.append(typeof part === 'string' ? el('p', '', part) : part)); return li; };
  const ranks = row => { const ul = el('ul', 'exchange-ranks'); rankLine(people, row, total).forEach((t, i) => { const li = el('li', `person-${i}`, t); ul.append(li); }); return ul; };
  const tool = (name, note) => bubble('tool', el('code', '', name), el('span', '', note));
  const names = people.map(p => p.name).join(', ');
  const first = [
    bubble('you', `Plan a Friday night in New York for three friends. Favorites: ${names}.`),
    tool('resolve_input', `Matched ${people.length} favorites to exact Qloo entities.`),
    tool('compare_group', `Ranked ${total} New York places for each person.`),
    bubble('agent', `I’d propose ${proposed.name}. Nobody ranks it lower than ${proposed.worstRank} of ${total}.`, ranks(proposed),
      crowd && crowd.id !== proposed.id ? `The obvious pick, ${crowd.name}, ranks ${Math.max(...crowd.ranks)} of ${total} for participant ${participantLabel(people[crowd.ranks.indexOf(Math.max(...crowd.ranks))])}.` : '')
  ];
  const second = [
    bubble('you', `Participant ${participantLabel(objector)} says no to ${proposed.name}.`),
    tool('reconsider_exclusion', `Applied one explicit exclusion; evidence unchanged.`),
    bubble('agent', `Revised proposal: ${revised.name}.`, ranks(revised),
      revised.worstRank > proposed.worstRank ? `Trade-off: it is the best remaining option, but participant ${participantLabel(people[revised.ranks.indexOf(revised.worstRank)])} ranks it ${revised.worstRank} of ${total}.` : '',
      'You can compare and revise the plan here in chat; the app is optional. This is still a proposal until everyone agrees. I can’t accept for anyone.')
  ];
  const action = el('button', 'exchange-action'); action.type = 'button';
  const note = el('p', 'exchange-note', 'Illustrative conversation composed from recorded Qloo evidence with fictional people. Ranks and proposals are computed by the real engine; an agent’s wording varies.');
  let step = 1;
  function render() {
    log.replaceChildren(...first, ...(step > 1 ? second : []));
    action.textContent = step > 1 ? 'Start over' : `Participant ${objector.letter} rules it out`;
    action.setAttribute('aria-label', step > 1 ? 'Start the example over' : `Participant ${participantLabel(objector)} rules out ${proposed.name}`);
  }
  action.addEventListener('click', () => { step = step > 1 ? 1 : 2; render(); announce(step > 1 ? `Revised proposal: ${revised.name}.` : 'Example restarted.'); });
  root.replaceChildren(log, action, note);
  render();
  return { render };
}

/* Setup tabs + copy buttons for the agent panel. Pure DOM; no network. */
export function setupAgentPanel(scope) {
  const tabs = [...scope.querySelectorAll('[role="tab"]')];
  const select = tab => tabs.forEach(t => {
    const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    const pane = scope.querySelector('#' + t.getAttribute('aria-controls')); if (pane) pane.hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; const n = tabs[(i + d + tabs.length) % tabs.length]; select(n); n.focus(); e.preventDefault(); });
  });
  scope.querySelectorAll('.copy-btn').forEach(btn => btn.addEventListener('click', async () => {
    const text = scope.querySelector('#' + btn.dataset.copy + ' code')?.textContent ?? '';
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
    catch { const range = document.createRange(); range.selectNodeContents(scope.querySelector('#' + btn.dataset.copy + ' code')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); btn.textContent = 'Press Ctrl+C'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  }));
}

/* ------------------------------------------------------- scroll reveals */
export function revealOnScroll(scope) {
  const targets = [...scope.querySelectorAll('[data-reveal]')];
  if (!globalThis.IntersectionObserver || motionReduced()) { targets.forEach(t => t.classList.add('is-in')); return; }
  const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  scope.classList.add('reveal-ready');
  targets.forEach(t => io.observe(t));
}
