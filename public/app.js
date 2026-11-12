import { distanceFromPortland, hasCoordinates, filterPlaces, sortPlaces, mergePlaces } from './places.js';

const search = document.querySelector('#search');
const sort = document.querySelector('#sort');
const eventSort = document.querySelector('#event-sort');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const sourceStatus = {};
const labels = { osm: 'OpenStreetMap', yelp: 'Yelp', events: 'Ticketmaster', museum: 'Portland Museum of Art' };
const isPages = document.documentElement.hasAttribute('data-pages');
let places = [];
let category = 'all';
let placeSort = 'name';
let map;
let markerLayer;
let matchingPlaces = [];
let markerZoom;
const markers = new Map();
const resultRows = new Map();
const yelpDetails = new Map();
const pineOutline = [
  [0, -16], [4, -10], [2.5, -10], [6, -6], [4, -6], [7, -2.5],
  [1.5, -2.5], [1.5, 0], [-1.5, 0], [-1.5, -2.5],
  [-7, -2.5], [-4, -6], [-6, -6], [-2.5, -10], [-4, -10]
];
const pinOutline = [
  [0, -15], [4, -14], [6, -11], [6, -8], [4, -5], [0, 0],
  [-4, -5], [-6, -8], [-6, -11], [-4, -14]
];

if (window.L) {
  map = L.map('map', { preferCanvas: true }).setView([43.6591, -70.2568], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('moveend', updateMarkers);
} else {
  document.querySelector('#map').textContent = 'The map could not load. You can still browse the list.';
}

function placeDetails(place) {
  const container = document.createElement('div');
  const name = document.createElement('h3');
  name.textContent = place.name;
  const detail = document.createElement('p');
  detail.textContent = place.detail;
  const source = document.createElement('p');
  source.textContent = place.source;
  if (hasCoordinates(place)) source.append(` · ${distanceFromPortland(place).toFixed(1)} mi from downtown`);
  container.append(name, detail);
  if (place.source === 'Yelp' && Number.isFinite(place.rating)
      && place.rating >= 1 && place.rating <= 5) {
    const rating = document.createElement('p');
    const count = place.reviewCount;
    const reviews = Number.isInteger(count) && count > 0
      ? ` · ${count.toLocaleString()} ${count === 1 ? 'review' : 'reviews'}` : '';
    rating.className = 'yelp-rating';
    rating.setAttribute('aria-label', `Yelp rating ${place.rating.toFixed(1)} out of 5${reviews}`);
    const star = document.createElement('span');
    star.className = 'rating-star';
    star.textContent = '★';
    star.setAttribute('aria-hidden', 'true');
    rating.append(star, ` ${place.rating.toFixed(1)}${reviews}`);
    container.append(rating);
  }
  container.append(source);
  return container;
}

function markerPoints(place, zoom, outline) {
  const anchor = map.project([place.lat, place.lon], zoom);
  const scale = zoom < 12 ? 0.65 : zoom < 15 ? 0.85 : 1.15;
  return outline.map(([x, y]) => map.unproject([anchor.x + x * scale, anchor.y + y * scale], zoom));
}

function updateMarkers() {
  if (!map) return;
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const zoomChanged = zoom !== markerZoom;
  markerZoom = zoom;
  const visible = new Map(matchingPlaces
    .filter(place => hasCoordinates(place) && bounds.contains([place.lat, place.lon]))
    .map(place => [place.id, place]));

  for (const [id, marker] of markers) {
    if (!visible.has(id)) {
      markerLayer.removeLayer(marker);
      markers.delete(id);
    }
  }
  for (const [id, place] of visible) {
    const isOutdoors = place.category === 'trails' || place.category === 'outdoors';
    const outline = isOutdoors ? pineOutline : pinOutline;
    const current = markers.get(id);
    if (current) {
      if (zoomChanged) current.setLatLngs(markerPoints(place, zoom, outline));
      continue;
    }
    const marker = L.polygon(markerPoints(place, zoom, outline), {
      color: '#fff5dc', weight: 1, fillColor: isOutdoors ? '#214958' : '#5c6570',
      fillOpacity: 1, smoothFactor: 0
    }).addTo(markerLayer);
    let popup;
    marker.bindPopup(() => {
      if (popup) return popup;
      popup = placeDetails(place);
      addSourceLink(popup, place);
      if (place.source === 'Yelp' && place.category === 'food') showYelpDetails(popup, place, marker);
      return popup;
    }, { maxHeight: 250, offset: [0, -9] });
    marker.on('click', () => resultRows.get(id)?.scrollIntoView({ block: 'nearest' }));
    markers.set(id, marker);
  }
}

function formatTime(time) {
  if (!/^\d{4}$/.test(time)) return '';
  const hour = Number(time.slice(0, 2));
  return `${hour % 12 || 12}:${time.slice(2)} ${hour < 12 || hour === 24 ? 'AM' : 'PM'}`;
}

async function showYelpDetails(popup, place, marker) {
  const extra = document.createElement('div');
  extra.textContent = 'Loading Yelp details…';
  popup.append(extra);
  const id = place.id.slice('yelp-'.length);

  try {
    let details = yelpDetails.get(id);
    if (!details) {
      const response = await fetch(`./api/yelp-details?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('Details unavailable');
      details = await response.json();
      yelpDetails.set(id, details);
    }
    extra.replaceChildren();
    for (const [label, value] of Object.entries({ Address: details.address, Phone: details.phone, Price: details.price })) {
      if (!value) continue;
      const line = document.createElement('p');
      line.textContent = `${label}: ${value}`;
      extra.append(line);
    }
    if (details.hours?.length) {
      const hours = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Hours';
      hours.append(summary);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (const period of details.hours) {
        const line = document.createElement('p');
        line.textContent = `${days[period.day]}: ${formatTime(period.start)}–${formatTime(period.end)}${period.is_overnight ? ' next day' : ''}`;
        hours.append(line);
      }
      hours.addEventListener('toggle', () => {
        if (marker.isPopupOpen()) marker.getPopup().update();
      });
      extra.append(hours);
    }
    if (!extra.childElementCount) extra.textContent = 'No additional details available.';
  } catch {
    extra.textContent = 'Yelp details could not load.';
  }
  if (marker.isPopupOpen()) marker.getPopup().update();
}

function addSourceLink(container, place) {
  try {
    const url = new URL(place.url);
    if (url.protocol !== 'https:') return;
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = `View on ${place.source === 'Sample location' ? 'OpenStreetMap' : place.source}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.append(link);
  } catch {
    return;
  }
}

function render() {
  const filtered = filterPlaces(places, category, search.value);
  const sorted = sortPlaces(filtered, sort.value);
  matchingPlaces = sorted;
  document.querySelector('#event-calendar').hidden = category !== 'events';
  document.querySelector('#count').textContent = `${sorted.length} ${category === 'events' ? 'events' : 'places'}`;
  results.replaceChildren();
  resultRows.clear();
  markerLayer?.clearLayers();
  markers.clear();
  updateMarkers();

  if (!sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = category === 'events'
      ? 'No events loaded. Check the source status below or try another search.'
      : 'No matching places. Try another category or search.';
    results.append(empty);
  }

  for (const place of sorted) {
    const row = document.createElement('article');
    row.className = 'item';
    const details = placeDetails(place);
    addSourceLink(details, place);
    row.append(details);
    results.append(row);
    resultRows.set(place.id, row);
    if (!map || !hasCoordinates(place)) continue;

    const button = document.createElement('button');
    button.className = 'map-button';
    button.textContent = 'Show on map';
    button.addEventListener('click', () => {
      map.setView([place.lat, place.lon], 15, { animate: false });
      markers.get(place.id)?.openPopup([place.lat, place.lon]);
    });
    details.append(button);
  }
}

function updateStatus() {
  const loading = Object.values(sourceStatus).some(value => value === 'loading');
  const liveCount = places.filter(place => place.source !== 'Sample location').length;
  status.textContent = `${liveCount} provider listings, plus labeled sample locations.${loading ? ' Loading sources…' : ''}`;
  document.querySelector('#provider-status').textContent = Object.entries(sourceStatus)
    .map(([source, message]) => message ? `${labels[source]}: ${message}` : `${labels[source]}:`).join(' · ');
}

async function loadProvider(source) {
  sourceStatus[source] = 'loading';
  updateStatus();
  try {
    const path = isPages ? `./data/${source}.json` : `./api/places?source=${source}`;
    const response = await fetch(path, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Request failed');
    const data = await response.json();
    if (source === 'museum' && data.status === 'live') {
      places = places.filter(place => place.source !== labels.museum);
    }
    places = mergePlaces(places, data.places);
    sourceStatus[source] = source === 'events' && data.status === 'missing-key'
      ? '' : data.message || `${data.places.length} places`;
    render();
  } catch {
    sourceStatus[source] = 'unavailable; existing places kept';
  }
  updateStatus();
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
document.querySelectorAll('[data-category]').forEach(button => {
  button.addEventListener('click', () => {
    if (category !== 'events') placeSort = sort.value;
    category = button.dataset.category;
    eventSort.hidden = category !== 'events';
    eventSort.disabled = eventSort.hidden;
    sort.value = category === 'events' ? 'date' : placeSort;
    document.querySelectorAll('[data-category]').forEach(chip => {
      const selected = chip === button;
      chip.classList.toggle('active', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
    render();
  });
});

async function start() {
  try {
    const response = await fetch('./sample-places.json');
    if (!response.ok) throw new Error('Samples unavailable');
    places = await response.json();
    render();
  } catch {
    status.textContent = 'Sample locations could not load.';
  }
  const sources = isPages ? ['osm', 'museum'] : ['osm', 'yelp', 'events', 'museum'];
  await Promise.all(sources.map(loadProvider));
  if (isPages) {
    sourceStatus.yelp = 'disabled (API key not configured)';
    updateStatus();
  }
}

if (!isPages) {
  setInterval(() => {
    if (!document.hidden && sourceStatus.museum !== 'loading') loadProvider('museum');
  }, 15 * 60 * 1000);
}

start();
