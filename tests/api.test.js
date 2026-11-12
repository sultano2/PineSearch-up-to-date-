import test from 'node:test';
import assert from 'node:assert/strict';
import { getYelpDetails, readYelp, readEvents, readMuseumEvents, readOpenStreetMap, loadSource } from '../api.js';
import { makeServer } from '../server.js';

test('Yelp drops closed businesses and missing coordinates', () => {
  const business = { id: 'cafe', name: 'Test cafe', rating: 4.5, review_count: 23,
    coordinates: { latitude: 43.66, longitude: -70.25 } };
  const places = readYelp({ businesses: [business, { ...business, is_closed: true }, { id: 'invalid' }] });
  assert.equal(places.length, 1);
  assert.equal(places[0].source, 'Yelp');
  assert.equal(places[0].rating, 4.5);
  assert.equal(places[0].reviewCount, 23);
});

test('events retain dates and skip cancelled or unmapped venues', () => {
  const event = {
    id: 'concert', name: 'Test concert', dates: { start: { localDate: '2027-01-20' } },
    _embedded: { venues: [{ name: 'Test venue', location: { latitude: '43.66', longitude: '-70.25' } }] }
  };
  const places = readEvents({ _embedded: { events: [event, { ...event, _embedded: {} },
    { ...event, dates: { status: { code: 'cancelled' } } }] } });
  assert.equal(places.length, 1);
  assert.match(places[0].detail, /2027-01-20/);
  assert.equal(places[0].eventStart, '2027-01-20 00:00:00');
  assert.equal(readEvents({}).length, 0);
});

test('museum events skip past listings and leave unknown venues off the map', () => {
  const event = { id: 1, title: 'PMA Films:&nbsp;Example', utc_start_date: '2026-11-12 17:00:00',
    venue: { venue: 'Auditorium', address: '7 Congress Square', city: 'Portland' } };
  const events = readMuseumEvents({ events: [event,
    { ...event, id: 2, venue: [] },
    { ...event, id: 3, utc_start_date: '2026-11-10 17:00:00' },
    { ...event, id: 4, title: '(Past Event) Old listing' },
    { ...event, id: 5, utc_start_date: '2026-12-12 19:00:00' },
    { ...event, id: 6, utc_start_date: '2026-12-10 19:00:00' }
  ] }, Date.parse('2026-11-11T19:00:00Z'));
  assert.deepEqual(events.map(place => place.id), ['pma-1', 'pma-2', 'pma-6']);
  assert.equal(events[0].name, 'PMA Films: Example');
  assert.match(events[0].detail, /12:00 PM/);
  assert.equal(events[0].eventStart, '2026-11-12 12:00:00');
  assert.ok(Number.isFinite(events[0].lat));
  assert.equal(events[1].lat, null);
});

test('Yelp details return contact information, price and regular hours', async t => {
  const hours = [{ day: 0, start: '0900', end: '1800' }];
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    location: { display_address: ['10 Main St', 'Portland, ME'] },
    display_phone: '(207) 555-0100', price: '$$',
    business_hours: [{ hours_type: 'REGULAR', open: hours }]
  }));
  assert.deepEqual(await getYelpDetails('test-restaurant', 'test-key'), {
    address: '10 Main St, Portland, ME', phone: '(207) 555-0100', price: '$$', hours
  });
});

test('OSM normalizes trails and rejects out-of-region coordinates', () => {
  const trail = { type: 'way', id: 1, tags: { name: 'Test trail', highway: 'path' }, center: { lat: 43.67, lon: -70.3 } };
  const places = readOpenStreetMap({ elements: [trail, { ...trail, center: { lat: 44.3, lon: -68.2 } }] });
  assert.equal(places.length, 1);
  assert.equal(places[0].category, 'trails');
  assert.throws(() => readOpenStreetMap({ elements: [], remark: 'Query timed out' }));
});

test('OSM does not classify pharmacies as food', () => {
  const pharmacy = { type: 'node', id: 1, lat: 43.67, lon: -70.3,
    tags: { name: 'Test pharmacy', shop: 'chemist', amenity: 'pharmacy' } };
  assert.equal(readOpenStreetMap({ elements: [pharmacy] })[0].category, 'businesses');
});

test('Yelp keeps restaurant results when the shops request fails', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.searchParams.get('categories') === 'shopping') return new Response('', { status: 503 });
    return Response.json({ businesses: [{ id: 'cafe', name: 'Test cafe',
      coordinates: { latitude: 43.66, longitude: -70.25 } }] });
  });
  const result = await loadSource('yelp', { YELP_API_KEY: 'test-key' });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.places.map(place => place.name), ['Test cafe']);
});

test('missing credentials are reported without making network calls', async () => {
  assert.equal((await loadSource('yelp', {})).status, 'missing-key');
  assert.equal((await loadSource('events', {})).status, 'missing-key');
});

test('provider errors do not leak keys or crash the route', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  const result = await loadSource('yelp', { YELP_API_KEY: 'test-secret' });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.places, []);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('server serves the app but never environment or source files', async t => {
  const server = makeServer(async () => ({ places: [], status: 'live' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /PineSearch/);
  for (const path of ['/.env', '/server.js', '/.git/config', '/api/places?source=unknown', '/api/yelp-details?id=%2F']) {
    const response = await fetch(base + path);
    assert.ok([400, 404].includes(response.status));
  }
  assert.equal((await fetch(base + '/api/places?source=yelp')).status, 200);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});
