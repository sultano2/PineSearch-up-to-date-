export function hasCoordinates(place) {
  return Number.isFinite(place.lat) && Number.isFinite(place.lon);
}

export function distanceFromPortland(place) {
  if (!hasCoordinates(place)) return Infinity;
  const radians = Math.PI / 180;
  const lat = (place.lat - 43.6591) * radians;
  const lon = (place.lon + 70.2568) * radians;
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(43.6591 * radians) * Math.cos(place.lat * radians)
    * Math.sin(lon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function filterPlaces(places, category, search) {
  const query = search.trim().toLowerCase();
  const now = Date.now();
  return places.filter(place => {
    const matchesCategory = category === 'all' || place.category === category;
    const matchesSearch = `${place.name} ${place.detail}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch && (!place.expiresAt || place.expiresAt > now);
  });
}

export function sortPlaces(places, sortBy) {
  return [...places].sort((a, b) => {
    if (sortBy === 'date') {
      return (a.eventStart || '9999').localeCompare(b.eventStart || '9999')
        || a.name.localeCompare(b.name);
    }
    if (sortBy === 'distance') {
      return distanceFromPortland(a) - distanceFromPortland(b)
        || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}

export function mergePlaces(current, incoming) {
  const places = [...current];
  for (const place of incoming) {
    const index = places.findIndex(existing => existing.id === place.id || (
      existing.category === place.category && existing.category !== 'events'
      && existing.name.toLowerCase() === place.name.toLowerCase()
      && Math.abs(existing.lat - place.lat) < 0.001
      && Math.abs(existing.lon - place.lon) < 0.001
    ));
    if (index === -1) places.push(place);
    else if (places[index].source !== 'Yelp' || place.source === 'Yelp') places[index] = place;
  }
  return places;
}
