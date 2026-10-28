// Deterministic category screening, not a claim about access or personal enjoyment.
// Only direct place categories count; nearby-attraction tags and name guesses do not.
const attraction = 'urn:tag:genre:place:tourist_attraction';
const hardExclusions = new Set(['hotel', 'motel', 'hostel', 'lodging', 'resort_hotel', 'night_club', 'nightclub', 'club', 'casino', 'banquet_hall', 'wedding_venue']);
const commercial = new Set(['restaurant', 'bar', 'pub', 'cafe', 'event_venue', 'conference_center', 'convention_center', 'function_room_facility']);
const sights = new Set(['museum', 'art_museum', 'history_museum', 'science_museum', 'art_gallery', 'landmark', 'cultural_landmark', 'historical_landmark', 'historical_place', 'historic_site', 'monument', 'memorial', 'park', 'national_park', 'botanical_garden', 'garden', 'bridge', 'palace', 'castle', 'cathedral', 'abbey', 'temple', 'shrine', 'aquarium', 'zoo', 'observation_deck', 'observatory', 'beach', 'nature_reserve']);
for (const category of ['cabaret_club', 'disco_club', 'dance_club', 'adult_entertainment_club']) hardExclusions.add(category);
for (const category of ['performing_arts_theater', 'opera_house', 'concert_hall', 'historical_site']) sights.add(category);

export function sightseeingEligibility(tags) {
  if (!Array.isArray(tags) || !tags.some(tag => tag?.id === attraction)) return { eligible: false, reason: 'No direct tourist-attraction category.' };
  const categories = tags.slice(0, 100).flatMap(tag => {
    const match = /^urn:tag:(?:genre|category):place:([a-z0-9_:-]+)$/i.exec(tag?.id ?? '');
    return match ? match[1].toLowerCase().split(':') : [];
  });
  if (categories.some(category => hardExclusions.has(category) || category.endsWith('_hotel'))) return { eligible: false, reason: 'Accommodation, nightlife or private-event category.' };
  if (categories.some(category => commercial.has(category) || category.endsWith('_bar') || category.endsWith('_restaurant')) && !categories.some(category => sights.has(category))) return { eligible: false, reason: 'Dining or event category without a specific sightseeing category.' };
  return { eligible: true };
}
