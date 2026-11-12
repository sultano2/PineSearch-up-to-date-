const foodAmenities = ['restaurant', 'cafe', 'bar', 'fast_food', 'pub'];

export function validLocation(place) {
  return Number.isFinite(place.lat) && Number.isFinite(place.lon)
    && place.lat >= 43.5 && place.lat <= 43.85
    && place.lon >= -70.55 && place.lon <= -70.05;
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json();
}

export function readYelp(data, category = 'food') {
  if (!Array.isArray(data.businesses)) throw new Error('Invalid Yelp response');
  return data.businesses.filter(business => !business.is_closed).map(business => ({
    id: `yelp-${business.id}`,
    name: business.name,
    category,
    detail: `${business.location?.city || 'Greater Portland'} · ${business.categories?.[0]?.title || 'Business'}`,
    lat: business.coordinates?.latitude,
    lon: business.coordinates?.longitude,
    url: business.url,
    rating: business.rating,
    reviewCount: business.review_count,
    source: 'Yelp'
  })).filter(place => place.name && validLocation(place));
}

export async function getYelp(key) {
  const places = [];
  const searches = { food: 'restaurants,cafes,bars', businesses: 'shopping' };
  let failed = 0;
  for (const [category, categories] of Object.entries(searches)) {
    try {
      const url = new URL('https://api.yelp.com/v3/businesses/search');
      url.search = new URLSearchParams({
        latitude: '43.6591', longitude: '-70.2568', radius: '20000',
        categories, limit: '50', sort_by: 'distance'
      });
      const data = await requestJSON(url, { headers: { Authorization: `Bearer ${key}` } });
      places.push(...readYelp(data, category));
    } catch {
      failed++;
    }
  }
  if (failed === 2) throw new Error('Yelp unavailable');
  if (failed === 1) return { places, status: 'partial', message: 'Only one Yelp category loaded.' };
  return places;
}

export async function getYelpDetails(id, key = process.env.YELP_API_KEY) {
  if (!key) return null;
  const data = await requestJSON(`https://api.yelp.com/v3/businesses/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  const hours = (data.business_hours || data.hours)?.find(period => period.hours_type === 'REGULAR');
  return {
    address: data.location?.display_address?.join(', '),
    phone: data.display_phone,
    price: data.price,
    hours: hours?.open
  };
}

export function readEvents(data) {
  const events = data._embedded?.events || [];
  return events.filter(event => event.dates?.status?.code !== 'cancelled').map(event => {
    const venue = event._embedded?.venues?.[0];
    const date = event.dates?.start;
    const start = Date.parse(date?.dateTime);
    const eventStart = Number.isFinite(start) ? localEventTime.format(start)
      : date?.localDate && `${date.localDate} ${date.localTime || '00:00:00'}`;
    return {
      id: `ticketmaster-${event.id}`, name: event.name, category: 'events',
      detail: `${venue?.name || 'Venue not listed'} · ${Number.isFinite(start) ? eventDate.format(start) : date?.localDate || 'Date TBA'}`,
      eventStart,
      lat: venue?.location?.latitude ? Number(venue.location.latitude) : NaN,
      lon: venue?.location?.longitude ? Number(venue.location.longitude) : NaN,
      url: event.url, source: 'Ticketmaster'
    };
  }).filter(place => place.name && validLocation(place));
}

export async function getEvents(key) {
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  url.search = new URLSearchParams({
    apikey: key, latlong: '43.6591,-70.2568', radius: '20', unit: 'miles',
    stateCode: 'ME', countryCode: 'US', size: '100', sort: 'date,asc',
    startDateTime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  });
  return readEvents(await requestJSON(url));
}

const museumCalendar = 'https://www.portlandmuseum.org/wp-json/tribe/events/v1/events';
const eventWindow = 30 * 24 * 60 * 60 * 1000;
const localEventTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const eventDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});
const allDayDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric'
});

function cleanEventText(text) {
  const entities = { '&nbsp;': ' ', '&amp;': '&', '&#8217;': '’', '&quot;': '"', '&#039;': "'" };
  return String(text || '').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|quot|#8217|#039);/g, match => entities[match]).trim();
}

export function readMuseumEvents(data, now = Date.now()) {
  if (!Array.isArray(data.events)) throw new Error('Invalid museum calendar');
  const places = [];
  for (const event of data.events) {
    const name = cleanEventText(event.title);
    const start = Date.parse(`${event.utc_start_date?.replace(' ', 'T')}Z`);
    const end = Date.parse(`${event.utc_end_date?.replace(' ', 'T')}Z`);
    if (!event.id || !name || !Number.isFinite(start) || /^\(past event\)/i.test(name)) continue;
    const expiresAt = event.all_day && end > start ? end : start;
    if (expiresAt <= now || start > now + eventWindow) continue;

    const venue = cleanEventText(event.venue?.venue);
    const museumAddress = !event.is_virtual && event.venue?.address === '7 Congress Square'
      && event.venue?.city === 'Portland';
    const date = (event.all_day ? allDayDate : eventDate).format(start);
    places.push({
      id: `pma-${event.id}`, name, category: 'events',
      detail: `${date} · ${venue || 'See event page for venue'}`,
      lat: museumAddress ? 43.6536 : null, lon: museumAddress ? -70.2621 : null,
      url: event.url, source: 'Portland Museum of Art', expiresAt,
      eventStart: localEventTime.format(start)
    });
  }
  return places;
}

let museumCache;
let museumRequest;

async function loadMuseumCalendar() {
  const url = new URL(museumCalendar);
  url.searchParams.set('per_page', '50');
  const endDate = new Date(Date.now() + eventWindow + 86400000).toISOString().slice(0, 10);
  url.searchParams.set('end_date', endDate);
  const events = [];
  for (let page = 1; page <= 4; page++) {
    url.searchParams.set('page', String(page));
    const data = await requestJSON(url);
    if (!Array.isArray(data.events)) throw new Error('Invalid museum calendar');
    events.push(...data.events);
    if (page >= data.total_pages || !data.events.length) break;
  }
  museumCache = { time: Date.now(), data: { events } };
}

async function getMuseumEvents() {
  if (!museumCache || Date.now() - museumCache.time >= 900000) {
    if (!museumRequest) {
      museumRequest = loadMuseumCalendar().finally(() => { museumRequest = null; });
    }
    await museumRequest;
  }
  return readMuseumEvents(museumCache.data);
}

export function readOpenStreetMap(data) {
  if (!Array.isArray(data.elements) || data.remark) throw new Error('Incomplete map response');
  return data.elements.filter(element => element.tags?.name).map(element => {
    const tags = element.tags;
    let category = 'attractions';
    if (tags.leisure) category = 'outdoors';
    if (tags.highway || tags.route === 'hiking') category = 'trails';
    if (tags.shop) category = 'businesses';
    if (foodAmenities.includes(tags.amenity)) category = 'food';
    return {
      id: `osm-${element.type}-${element.id}`, name: tags.name, category,
      detail: `${tags['addr:city'] || 'Greater Portland'} · ${tags.cuisine || tags.shop || tags.leisure || tags.tourism || tags.highway || tags.route || tags.amenity}`.replaceAll('_', ' '),
      lat: element.lat ?? element.center?.lat, lon: element.lon ?? element.center?.lon,
      url: `https://www.openstreetmap.org/${element.type}/${element.id}`, source: 'OpenStreetMap'
    };
  }).filter(validLocation);
}

let mapCache;
let mapRequest;

export async function getOpenStreetMap() {
  if (mapCache && Date.now() - mapCache.time < 3600000) return mapCache.places;
  if (!mapRequest) {
    mapRequest = loadMap().catch(error => {
      if (mapCache) return { places: mapCache.places, status: 'saved', message: 'Saved map results; refresh unavailable.' };
      throw error;
    }).finally(() => { mapRequest = null; });
  }
  return mapRequest;
}

async function loadMap() {
  const bounds = '(43.5,-70.55,43.85,-70.05)';
  const query = `[out:json][timeout:20];(
    nwr["amenity"~"^(${foodAmenities.join('|')})$"]["name"]${bounds};
    nwr["shop"]${bounds};
    nwr["leisure"~"^(park|nature_reserve)$"]${bounds};
    nwr["tourism"~"^(museum|attraction|viewpoint)$"]${bounds};
    way["highway"~"^(path|footway)$"]["name"]${bounds};
    relation["route"="hiking"]["name"]${bounds};
  );out center;`;
  const endpoints = [
    'https://ovp.dresel.systems/api-na/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];
  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint}?${new URLSearchParams({ data: query })}`;
      const data = await requestJSON(url, {
        headers: { 'User-Agent': 'PineSearch student project' }
      });
      const places = readOpenStreetMap(data);
      mapCache = { time: Date.now(), places };
      return places;
    } catch {
      // try the backup server
    }
  }
  throw new Error('Map providers unavailable');
}

export async function loadSource(source, keys = process.env) {
  if (source === 'yelp' && !keys.YELP_API_KEY) {
    return { places: [], status: 'missing-key', message: 'Yelp is not connected yet.' };
  }
  if (source === 'events' && !keys.TICKETMASTER_API_KEY) {
    return { places: [], status: 'missing-key', message: 'Ticketmaster is not connected yet.' };
  }
  try {
    let result;
    if (source === 'yelp') result = await getYelp(keys.YELP_API_KEY);
    else if (source === 'events') result = await getEvents(keys.TICKETMASTER_API_KEY);
    else if (source === 'museum') result = await getMuseumEvents();
    else result = await getOpenStreetMap();
    return Array.isArray(result) ? { places: result, status: 'live' } : result;
  } catch {
    return { places: [], status: 'unavailable', message: `${source} is temporarily unavailable.` };
  }
}
