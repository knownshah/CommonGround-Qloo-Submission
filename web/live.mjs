function locationLabel({ name, detail }) {
  if (!detail || detail === name || detail.startsWith(`${name},`)) return detail || name;
  return `${name}, ${detail}`;
}
function personDateLabel(detail) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(detail ?? '');
  if (!match) return detail;
  const date = new Date(`${detail}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== detail) return detail;
  return `Date: ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)}`;
}
function personSignature(choice) { return [choice.name, personDateLabel(choice.detail), choice.description ?? '', choice.imageUrl ?? ''].join(' · ').replace(/\s+/g, ' ').trim().toLowerCase(); }
function personMatchLabels(choices) {
  const counts = new Map();
  for (const choice of choices) { const key = personSignature(choice); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const seen = new Map();
  return choices.map(choice => {
    const key = personSignature(choice);
    if (counts.get(key) < 2) return '';
    const number = (seen.get(key) ?? 0) + 1; seen.set(key, number);
    return `Match ${number}`;
  });
}
function personChoiceContext(choice) {
  return [personDateLabel(choice.detail), choice.description].filter(Boolean);
}
function personImage(el, choice, className) {
  if (!choice.imageUrl) return null;
  const image = el('img', undefined, className);
  image.src = choice.imageUrl; image.alt = `${choice.name} — image supplied by Qloo`;
  image.width = 48; image.height = 48; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => { image.hidden = true; }, { once: true });
  return image;
}

export function createLiveDraft({ request, onSnapshot = () => {} }) {
  const field = type => ({ type, query: '', selected: null, choices: [], version: 0, message: '' });
  const state = { count: 3, fields: { city: field('locality'), ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`, field('film')])) }, confirmed: false, requirements: '', discoveryMode: 'pooled', outingType: '', maxPriceLevel: null, busy: false };
  state.searching = null;
  state.countryCode = '';
  state.labels = Array.from({ length: 8 }, (_, i) => `Participant ${'ABCDEFGH'[i]}`);
  let revision = 0;
  const invalidate = () => { revision++; state.confirmed = false; };
  return {
    state,
    setField(key, values) {
      const f = state.fields[key]; if (!f) throw new Error('Unknown input');
      if (values?.type !== undefined && !(key === 'city' ? values.type === 'locality' : ['film', 'artist', 'person', 'game'].includes(values.type))) throw new Error('Choose a supported favorite type');
      Object.assign(f, values); f.version++; f.selected = null; f.choices = []; f.message = ''; invalidate();
    },
    setCount(count) { if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('Choose 2–8 people'); state.count = count; invalidate(); },
    setRequirements(value) { state.requirements = value; invalidate(); },
    setDiscoveryMode(value) { if (!['pooled', 'individual'].includes(value)) throw new Error('Unknown discovery mode'); state.discoveryMode = value; invalidate(); },
    setOutingType(value) { if (!['places', 'sightseeing', 'restaurants', 'movies'].includes(value)) throw new Error('Choose a movie, outing or restaurant decision'); if (value !== state.outingType) state.maxPriceLevel = value === 'restaurants' ? 2 : null; state.outingType = value; invalidate(); },
    setMaxPriceLevel(value) { if (state.outingType !== 'restaurants' || (value !== null && (![1, 2, 3, 4].includes(value)))) throw new Error('Choose a restaurant price category'); state.maxPriceLevel = value; invalidate(); },
    confirm(value) { state.confirmed = value === true; },
    setCountry(code) {
      if (code !== '' && !/^[A-Z]{2}$/.test(code)) throw new Error('Choose a country or territory.');
      state.countryCode = code;
      const city = state.fields.city; city.version++; city.selected = null; city.choices = []; city.message = '';
      invalidate();
    },
    prepareRecovery(snapshot, participantId) {
      if (state.busy) throw new Error('Wait for the current live request to finish.');
      const index = snapshot?.participants?.findIndex(person => person.id === participantId);
      if (!Number.isInteger(index) || index < 0 || snapshot.source !== 'live' || snapshot.participants.length < 2 || snapshot.participants.length > 8) throw new Error('Choose a participant from the live comparison.');
      const keep = (existing, id, type, query) => existing?.selected?.id === id && existing.type === type ? existing : { ...field(type), query };
      state.count = snapshot.participants.length;
      state.outingType = snapshot.outingType ?? 'places'; state.maxPriceLevel = snapshot.maxPriceLevel ?? null;
      state.requirements = snapshot.requirements ?? ''; state.discoveryMode = snapshot.discoveryMode ?? 'pooled';
      state.fields.city = keep(state.fields.city, snapshot.locationId, 'locality', snapshot.location ?? '');
      state.countryCode = snapshot.locationDetails?.countryCode ?? state.fields.city.selected?.countryCode ?? '';
      snapshot.participants.forEach((person, i) => {
        const key = `p${i}`;
        state.labels[i] = person.label;
        state.fields[key] = i === index ? field(person.seed.type) : keep(state.fields[key], person.seed.id, person.seed.type, person.seed.name);
      });
      state.recovery = { participantIndex: index, previousFavorite: snapshot.participants[index].seed.name };
      invalidate();
    },
    async search(key) {
      if (state.busy) throw new Error('Wait for the current live request to finish.');
      const f = state.fields[key]; if (!f?.query.trim()) throw new Error('Enter a location or favorite first.');
      const version = ++f.version; f.selected = null; f.choices = []; f.message = 'Searching Qloo for matches…'; invalidate(); state.busy = true; state.searching = key;
      try {
        const result = await request('/api/live/search', { type: f.type, query: f.query, ...(key === 'city' && state.countryCode ? { countryCode: state.countryCode } : {}) });
        if (version !== f.version) return;
        f.choices = result.choices;
        const hasPersonContext = f.choices.some(choice => choice.detail || choice.description || choice.imageUrl);
        f.message = result.message || (f.choices.length ? f.type === 'person' && !hasPersonContext ? 'Qloo returned no additional identity context for these matches. If you cannot identify the right person, choose a film favorite instead.' : 'Choose the match you mean.' : f.type === 'person' ? 'No public figure match found. Try the full name or another spelling.' : f.type === 'artist' ? 'No music artist match found. Try the artist’s full name or another spelling. For actors, choose Actor or public figure.' : 'No match found. Try a more specific name.');
      } catch (error) {
        if (version === f.version) f.message = error.message;
        throw error;
      } finally { state.busy = false; state.searching = null; }
    },
    choose(key, token) {
      const f = state.fields[key]; const choice = f.choices.find(c => c.token === token);
      if (!choice || choice.type !== f.type) throw new Error('Search and choose the intended match.');
      f.selected = choice; invalidate();
    },
    async compare() {
      if (state.busy) throw new Error('Wait for the current live request to finish.');
      if (!state.outingType) throw new Error('Choose an activity before continuing.');
      const fields = Array.from({ length: state.count }, (_, i) => state.fields[`p${i}`]);
      if (!state.confirmed || (state.outingType !== 'movies' && !state.fields.city.selected) || fields.some(f => !f.selected)) throw new Error('Confirm the required location and every person’s favorite first.');
      const version = revision; state.busy = true;
      try {
        const snapshot = await request('/api/live/compare', { confirmed: true, ...(state.outingType !== 'movies' ? { locationToken: state.fields.city.selected.token } : {}),
          participants: fields.map((f, i) => ({ label: state.labels[i], token: f.selected.token })), requirements: state.requirements, discoveryMode: state.discoveryMode, outingType: state.outingType, maxPriceLevel: state.maxPriceLevel });
        if (version === revision) onSnapshot(snapshot);
      } finally { state.busy = false; }
    },
    cancel() { invalidate(); for (const f of Object.values(state.fields)) f.version++; }
  };
}

export function createLiveInputs({ root, onSnapshot, request, countries = [], onCancel = () => {}, getCancelLabel = () => 'View current options' }) {
  const el = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
  const draft = createLiveDraft({ request, onSnapshot });
  let message = ''; let open = false; let step = 0;
  function render(focusKey) {
    if (!open) return;
    const state = draft.state; const panel = el('div', undefined, 'panel live-panel');
    const movies = state.outingType === 'movies'; const firstPerson = movies ? 1 : 2;
    const titles = ['What are you planning?', ...(!movies ? ['Where shall we go?'] : []), ...Array.from({length:state.count}, (_,i) => `What does ${state.labels[i]} like?`), 'Ready to find your common ground?'];
    step = Math.min(step, titles.length - 1);
    const heading = el('h2', titles[step]); heading.tabIndex = -1;
    panel.append(el('p', `Step ${step + 1} of ${titles.length}`, 'eyebrow'), heading,
      el('p', step === 0 ? 'Choose what your group wants to decide and how many people are taking part.' : !movies && step === 1 ? 'Find your location or area, then choose the right match.' : step < titles.length - 1 ? 'Share one film, music artist, public figure or game this person enjoys. Qloo uses these cultural connections to suggest shared options. Find and choose the right match.' : 'Review the group below. Suggestions use cultural interests; practical details still need checking.', 'section-description'));
    if (state.recovery) panel.append(el('p', `Choose a replacement for ${state.recovery.previousFavorite}. Your group and location are kept. Confirm any remaining matches, then review the whole group again. Your previous comparison stays available until a new search succeeds.`, 'helper recovery-guidance'));
    const progress = el('div', undefined, 'setup-progress'); progress.setAttribute('aria-label', 'Your group setup progress');
    const progressSteps = el('ol', undefined, 'setup-progress-steps');
    const progressPeople = el('div', undefined, 'setup-progress-people');
    progress.append(progressSteps, progressPeople); panel.append(progress);
    function updateProgress() {
      const favoritesDone = Array.from({ length: state.count }, (_, i) => state.fields[`p${i}`]).every(f => f.selected);
      const stages = [
        ['Activity', step === 0, Boolean(state.outingType)],
        ...(!movies ? [['Location', step === 1, Boolean(state.fields.city.selected)]] : []),
        ['Favorites', step >= firstPerson && step < titles.length - 1, favoritesDone],
        ['Review', step === titles.length - 1, state.confirmed]
      ];
      progressSteps.replaceChildren(...stages.map(([title, current, done]) => {
        const item = el('li', title, 'setup-progress-step'); item.dataset.state = done ? 'done' : current ? 'current' : 'empty';
        item.setAttribute('aria-label', `${title}: ${done ? 'complete' : current ? 'current step' : 'up next'}`);
        if (current) item.setAttribute('aria-current', 'step');
        return item;
      }));
      progressPeople.replaceChildren(...Array.from({ length: state.count }, (_, i) => {
        const selected = state.fields[`p${i}`].selected; const current = step === i + firstPerson;
        const person = el('div', undefined, 'setup-progress-person'); person.dataset.participant = `p${i}`;
        person.dataset.state = selected ? 'done' : current ? 'current' : 'empty';
        if (current) person.setAttribute('aria-current', 'step');
        person.append(el('span', 'ABCDEFGH'[i], 'setup-progress-initial'), el('strong', state.labels[i]), el('span', selected?.name ?? (current ? 'Choose a favorite' : 'Favorite to add'), 'setup-progress-taste'));
        return person;
      }));
    }
    const stages = titles.map((_,i) => { const stage = el('div', undefined, 'setup-stage'); stage.hidden = step !== i; panel.append(stage); return stage; });
    const goal = stages[0]; const review = stages.at(-1);
    const activityChoices = el('div', undefined, 'activity-choices'); activityChoices.setAttribute('aria-label', 'Choose an activity');
    for (const [value, title, icon, caption] of [
      ['movies', 'Movie night', '▶', 'Find a film for everyone. No location needed.'],
      ['restaurants', 'A meal', '◒', 'Choose a restaurant around your group’s tastes.'],
      ['sightseeing', 'A day out', '↗', 'Discover sights and places to explore together.'],
      ['places', 'Explore places broadly', '⌖', 'A wider search with less specific outing results.']
    ]) {
      const activity = el('button', undefined, `activity-choice${value === 'places' ? ' activity-choice-secondary' : ''}${state.outingType === value ? ' selected' : ''}`);
      activity.type = 'button'; activity.disabled = state.busy; activity.dataset.activity = value; activity.dataset.focusKey = `activity-${value}`;
      activity.setAttribute('aria-label', title); activity.setAttribute('aria-pressed', String(state.outingType === value));
      const symbol = el('span', icon, 'activity-icon'); symbol.setAttribute('aria-hidden', 'true');
      activity.append(symbol, el('strong', title), el('span', caption, 'activity-caption'));
      activity.addEventListener('click', () => { draft.setOutingType(value); render(`activity-${value}`); }); activityChoices.append(activity);
    }
    if (step === 0) goal.append(activityChoices);
    const outingLabel = el('label', 'What are you choosing?'); const outing = el('select'); outing.setAttribute('aria-label', 'Outing type');
    const activityPlaceholder = el('option', 'Choose an activity'); activityPlaceholder.value = ''; activityPlaceholder.disabled = true; activityPlaceholder.selected = !state.outingType; outing.append(activityPlaceholder);
    for (const [value, title] of [['places', 'Explore places — broad results'], ['sightseeing', 'Sightseeing'], ['restaurants', 'Restaurants'], ['movies', 'Movie night']]) { const option = el('option', title); option.value = value; option.selected = value === state.outingType; outing.append(option); }
    outing.disabled = state.busy; outing.dataset.focusKey = 'outing-type'; outing.addEventListener('change', () => { draft.setOutingType(outing.value); render('outing-type'); }); outingLabel.append(outing); goal.append(outingLabel);
    if (state.outingType === 'places') goal.append(el('p', 'Broad results may include places unsuitable for an outing. Check each suggestion before agreeing.', 'helper'));
    const priceLabel = el('label', 'Restaurant price range'); const price = el('select'); price.setAttribute('aria-label', 'Maximum restaurant price category');
    const priceChoices = new Map([[null, 'Any price, including unknown'], [1, 'Lower-priced'], [2, 'Mid-priced or lower'], [3, 'Up to higher-priced'], [4, 'Any known price level']]);
    for (const value of [null, 1, 2, 3, 4]) { const option = el('option', priceChoices.get(value)); option.value = value === null ? '' : String(value); option.selected = value === state.maxPriceLevel; price.append(option); }
    price.disabled = state.busy || state.outingType !== 'restaurants'; price.dataset.focusKey = 'restaurant-price'; price.addEventListener('change', () => { draft.setMaxPriceLevel(price.value === '' ? null : Number(price.value)); render('restaurant-price'); }); priceLabel.append(price);
    const priceHelp = el('p', 'Based on Qloo’s price category. Check the menu for actual prices.', 'helper');
    priceLabel.hidden = priceHelp.hidden = state.outingType !== 'restaurants'; goal.append(priceLabel, priceHelp);
    const countLabel = el('label', 'How many people?'); const count = el('select'); count.setAttribute('aria-label', 'How many people?');
    for (const n of [2, 3, 4, 5, 6, 7, 8]) { const option = el('option', `${n} people`); option.value = n; option.selected = n === state.count; count.append(option); }
    count.disabled = state.busy; count.dataset.focusKey = 'participant-count'; count.addEventListener('change', () => { draft.setCount(Number(count.value)); render('participant-count'); }); countLabel.append(count); goal.append(countLabel);
    function inputField(key, title) {
      const f = state.fields[key]; const group = el('fieldset', undefined, 'live-field'); group.append(el('legend', title));
      const row = el('div', undefined, 'live-search-row');
      if (key === 'city') {
        const label = el('label', 'Country or territory (optional)', 'location-country');
        const country = el('select'); country.setAttribute('aria-label', 'Country or territory (optional)'); country.dataset.focusKey = 'location-country';
        const any = el('option', 'All countries and territories'); any.value = ''; country.append(any);
        for (const item of countries) { const option = el('option', item.name); option.value = item.code; country.append(option); }
        country.value = state.countryCode; country.disabled = state.busy;
        country.addEventListener('change', () => { draft.setCountry(country.value); render('location-country'); });
        label.append(country); group.append(label, el('p', 'Search a city or area, then confirm its country and boundaries. Different geographic areas remain separate choices.', 'helper'));
      }
      if (key !== 'city') {
        const domain = el('select'); domain.setAttribute('aria-label', `${title}: favorite type`);
        for (const [type, name] of [['film', 'Film'], ['artist', 'Music artist'], ['person', 'Actor or public figure'], ['game', 'Game']]) { const option = el('option', name); option.value = type; option.selected = type === f.type; domain.append(option); }
        domain.disabled = state.busy; domain.dataset.focusKey = `favorite-type-${key}`; domain.addEventListener('change', () => { draft.setField(key, { type: domain.value }); render(`favorite-type-${key}`); }); row.append(domain);
      }
      const query = el('input'); query.type = 'text'; query.maxLength = 120; query.value = f.query;
      query.placeholder = key === 'city' ? 'City or area, e.g. Rome' : { film: 'A film, e.g. Spirited Away', artist: 'A music artist, e.g. Rihanna', person: 'A full name, e.g. Shah Rukh Khan', game: 'A game, e.g. Minecraft' }[f.type]; query.setAttribute('aria-label', key === 'city' ? 'City or area' : `${title}: favorite name`);
      query.disabled = state.busy;
      query.dataset.focusKey = `query-${key}`;
      const choices = el('div', undefined, 'live-choices');
      query.addEventListener('input', () => { draft.setField(key, { query: query.value }); choices.replaceChildren(el('p', 'Search again to confirm this input.', 'helper')); updateActions(); });
      const search = el('button', state.searching === key ? 'Searching…' : 'Find matches'); search.type = 'button'; search.disabled = state.busy;
      search.setAttribute('aria-label', `${title}: Find matches`);
      async function searchMatches() {
        if (state.busy) return;
        message = ''; const pending = draft.search(key); render(`search-status-${key}`);
        try { await pending; } catch (error) { message = error.message; }
        const restore = document.activeElement?.dataset?.focusKey === `search-status-${key}`;
        render(restore ? (f.choices.length ? `choice-${key}-0` : `query-${key}`) : undefined);
      }
      search.addEventListener('click', searchMatches);
      query.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault(); return searchMatches();
      }); row.append(query, search); group.append(row);
      const fieldStatus = el('p', f.selected ? `Confirmed: ${key === 'city' ? locationLabel(f.selected) : `${f.selected.name}${f.selected.detail ? ` · ${f.selected.detail}` : ''}`}` : f.message, 'helper live-field-status');
      fieldStatus.setAttribute('role', 'status'); fieldStatus.tabIndex = -1; fieldStatus.dataset.focusKey = `search-status-${key}`;
      choices.append(fieldStatus);
      const matchLabels = key === 'city' || f.type !== 'person' ? [] : personMatchLabels(f.choices);
      for (const [choiceIndex, choice] of f.choices.entries()) {
        const selected = f.selected?.token === choice.token;
        const b = el('button', undefined, `scenario-choice live-choice${selected ? ' selected' : ''}`); b.type = 'button'; b.disabled = state.busy;
        const image = f.type === 'person' ? personImage(el, choice, 'live-choice-image') : null;
        if (image) b.append(image);
        const content = el('span', undefined, 'live-choice-content'); content.append(el('strong', `${choice.name}${key === 'city' && choice.countryName ? `, ${choice.countryName}` : ''}${matchLabels[choiceIndex] ? ` · ${matchLabels[choiceIndex]}` : ''}`));
        if (key === 'city') content.append(el('span', [choice.geographicLevel ?? 'Area', choice.originalName && choice.originalName !== choice.name ? `Local name: ${choice.originalName}` : '', !choice.countryName ? 'Country not supplied' : ''].filter(Boolean).join(' · '), 'live-choice-geography'));
        if (key === 'city' ? choice.detail : f.type === 'person' ? personDateLabel(choice.detail) : choice.detail) content.append(el('span', key === 'city' ? choice.detail : f.type === 'person' ? personDateLabel(choice.detail) : choice.detail, 'live-choice-detail'));
        if (f.type === 'person' && choice.description) content.append(el('span', choice.description, 'live-choice-description'));
        if (f.type === 'person' && !choice.detail && !choice.description && !choice.imageUrl) content.append(el('span', 'No additional identity context supplied.', 'live-choice-detail'));
        b.append(content); b.dataset.choiceToken = choice.token;
        b.append(el('span', selected ? 'Selected ✓' : key === 'city' ? 'Use this location' : 'Select', 'live-choice-action'));
        b.dataset.focusKey = `choice-${key}-${f.choices.indexOf(choice)}`;
        b.setAttribute('aria-pressed', String(selected));
        b.addEventListener('click', () => { draft.choose(key, choice.token); render(b.dataset.focusKey); }); choices.append(b);
      }
      if (f.type === 'person' && matchLabels.some(Boolean)) choices.append(el('p', 'Match numbers distinguish entries only; they are not identity evidence.', 'helper'));
      group.append(choices); stages[key === 'city' ? 1 : Number(key.slice(1)) + firstPerson].append(group);
    }
    if (!movies) inputField('city', 'Location');
    for (let i = 0; i < state.count; i++) inputField(`p${i}`, state.labels[i]);
    const requirementsLabel = el('label', 'Anything essential? (optional)', 'requirements-label'); const requirements = el('input'); requirements.type = 'text'; requirements.className = 'essential-requirements'; requirements.maxLength = 500; requirements.value = state.requirements; requirements.disabled = state.busy;
    requirements.placeholder = movies ? 'For example: suitable for children, under two hours' : 'For example: step-free access'; requirements.setAttribute('aria-label', 'Essential requirements');
    const summary = el('div', undefined, 'setup-review');
    summary.append(el('strong', movies ? 'Movie night · No location needed' : `${state.fields.city.selected ? locationLabel(state.fields.city.selected) : 'Choose a location'} · ${state.outingType === 'restaurants' ? 'Restaurants' : state.outingType === 'sightseeing' ? 'Sightseeing' : state.outingType === 'places' ? 'Explore places — broad results' : 'Choose an activity'}`));
    let duplicatePersonChoices = false;
    for (let i=0;i<state.count;i++) {
      const field = state.fields[`p${i}`]; const selected = field.selected;
      const labels = field.type === 'person' ? personMatchLabels(field.choices) : [];
      const selectedIndex = field.choices.findIndex(choice => choice.token === selected?.token);
      const matchLabel = selectedIndex >= 0 ? labels[selectedIndex] : '';
      if (matchLabel) duplicatePersonChoices = true;
      const taste = el('div', undefined, 'review-taste'); taste.dataset.participant = `p${i}`;
      taste.append(el('p', `${state.labels[i]}: ${selected?.name ?? 'Choose a favourite'}${matchLabel ? ` · ${matchLabel}` : ''}`, 'review-taste-name'));
      if (selected?.type === 'person') {
        for (const context of personChoiceContext(selected)) taste.append(el('p', context, 'live-review-identity'));
        if (!selected.detail && !selected.description && !selected.imageUrl) taste.append(el('p', 'Qloo returned no additional identity context. Choose a film favorite if you cannot identify this person.', 'helper live-review-identity'));
        const image = personImage(el, selected, 'live-review-identity-image');
        if (image) taste.append(image);
      }
      summary.append(taste);
    }
    if (duplicatePersonChoices) summary.append(el('p', 'Match numbers distinguish entries only; they are not identity evidence.', 'helper'));
    review.append(summary);
    requirementsLabel.append(requirements); review.append(requirementsLabel, el('p', movies ? 'We record these requirements, but cannot verify streaming availability, runtime, language or age suitability. Check the film and viewing service before agreeing.' : 'We record these requirements, but cannot yet verify them. Check them with the venue before agreeing to go.', 'helper'));
    requirements.addEventListener('input', () => { draft.setRequirements(requirements.value); updateActions(); });
    const broader = el('input'); broader.type = 'checkbox'; broader.checked = state.discoveryMode === 'individual'; broader.disabled = state.busy;
    broader.setAttribute('aria-label', 'Include options from each distinct taste');
    const broaderLabel = el('label', undefined, 'live-confirm'); broaderLabel.append(broader, el('span', 'Include options from each distinct taste'));
    const extra = el('details', undefined, 'setup-extra'); extra.append(el('summary', 'More search options'), broaderLabel, el('p', 'Finds up to ten options using extra Qloo requests. For the same group, existing vetoes and the decision rule carry forward where possible. Everyone must accept again. Changed group inputs start fresh.', 'helper')); review.append(extra);
    broader.addEventListener('change', () => { draft.setDiscoveryMode(broader.checked ? 'individual' : 'pooled'); updateActions(); });
    const confirmation = el('input'); confirmation.type = 'checkbox'; confirmation.checked = state.confirmed; confirmation.disabled = state.busy;
    const confirmationLabel = el('label', undefined, 'live-confirm'); confirmationLabel.append(confirmation, el('span', `${movies ? 'Everyone’s favorites are' : 'The location and everyone’s favorites are'} correct. I understand that practical requirements still need checking.`));
    review.append(confirmationLabel);
    const find = el('button', state.busy ? 'Working with Qloo…' : 'Find shared options', 'live-submit'); find.type = 'button';
    const next = el('button', 'Continue', 'live-submit'); next.type = 'button';
    const guidance = el('p', undefined, 'helper setup-guidance'); guidance.id = 'setup-guidance'; guidance.setAttribute('role', 'status');
    next.setAttribute('aria-describedby', guidance.id); find.setAttribute('aria-describedby', guidance.id);
    function updateActions() {
      confirmation.checked = state.confirmed;
      find.disabled = state.busy || !state.confirmed || (!movies && !state.fields.city.selected) || Array.from({ length: state.count }, (_, i) => state.fields[`p${i}`]).some(f => !f.selected);
      next.disabled = state.busy || (step === 0 && !state.outingType) || (!movies && step === 1 && !state.fields.city.selected) || (step >= firstPerson && step < titles.length - 1 && !state.fields[`p${step - firstPerson}`].selected);
      const activeField = !movies && step === 1 ? state.fields.city : step >= firstPerson && step < titles.length - 1 ? state.fields[`p${step - firstPerson}`] : null;
      guidance.textContent = state.busy ? 'Wait for Qloo to finish before continuing.' : step === 0 ? state.outingType ? `${state.count} people · Continue to ${movies ? 'everyone’s favorites' : 'your location'}.` : 'Choose an activity to continue.' : activeField ? activeField.selected ? 'Match confirmed. Continue when you’re ready.' : activeField.choices.length ? 'Choose the exact match you mean to continue.' : activeField.query.trim() ? 'Select Find matches, then choose the exact result to continue.' : !movies && step === 1 ? 'Enter a location and country, then select Find matches.' : 'Enter one favorite, select Find matches, then choose the exact result.' : state.confirmed ? 'Your inputs are confirmed. Find shared options when you’re ready.' : 'Check everyone’s favorites and confirm the inputs below to find shared options.';
      updateProgress();
    }
    confirmation.addEventListener('change', () => { draft.confirm(confirmation.checked); updateActions(); });
    find.addEventListener('click', async () => { message = ''; const pending = draft.compare(); render(); try { await pending; } catch (error) { message = error.message; } render(); });
    updateActions(); review.append(find);
    const navigation = el('div', undefined, 'setup-navigation');
    const back = el('button', 'Back', 'setup-back'); back.type = 'button'; back.hidden = step === 0; back.disabled = state.busy;
    back.addEventListener('click', () => { step--; message=''; render(); root.querySelector('h2')?.focus?.(); });
    next.hidden = step === titles.length - 1;
    next.addEventListener('click', () => { if (next.disabled) return; step++; message=''; render(); root.querySelector('h2')?.focus?.(); });
    navigation.append(back,next); panel.append(guidance, navigation);
    const status = el('p', state.busy ? 'Finding matches… Your existing options are saved.' : message, 'helper live-status'); status.setAttribute('role', 'status'); panel.append(status);
    const cancel = el('button', getCancelLabel(), 'text-button'); cancel.type = 'button'; cancel.addEventListener('click', onCancel); panel.append(cancel);
    root.replaceChildren(panel);
    if (focusKey) root.querySelector(`[data-focus-key="${focusKey}"]`)?.focus?.();
  }
  return { open({ snapshot, participantId } = {}) {
    if (snapshot && participantId) {
      draft.prepareRecovery(snapshot, participantId);
      step = (draft.state.outingType === 'movies' ? 1 : 2) + draft.state.recovery.participantIndex;
    } else { step = 0; draft.state.recovery = null; }
    open = true; root.hidden = false; render(); root.querySelector('h2')?.focus?.();
  }, close() { open = false; draft.cancel(); root.hidden = true; } };
}
