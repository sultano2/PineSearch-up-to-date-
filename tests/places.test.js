import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceFromPortland, filterPlaces, sortPlaces, mergePlaces } from '../public/places.js';

const places = [
  { id: 'a', name: 'Zulu', category: 'food', detail: 'Cafe', lat: 43.6591, lon: -70.2568 },
  { id: 'b', name: 'Alpha', category: 'trails', detail: 'Coastal walk', lat: 43.62, lon: -70.21 }
];

test('search combines category and case-insensitive text', () => {
  assert.equal(filterPlaces(places, 'food', ' CAFE ').length, 1);
  assert.equal(filterPlaces(places, 'trails', 'cafe').length, 0);
});

test('name and distance sorting do not mutate the original array', () => {
  assert.equal(sortPlaces(places, 'name')[0].id, 'b');
  assert.equal(sortPlaces(places, 'distance')[0].id, 'a');
  assert.equal(places[0].id, 'a');
  assert.equal(distanceFromPortland(places[0]), 0);
  assert.ok(distanceFromPortland(places[1]) > 3);
});

test('events sort by date and time with undated events last', () => {
  const events = [
    { name: 'Undated' },
    { name: 'Saturday', eventStart: '2026-11-14 10:00:00' },
    { name: 'Friday evening', eventStart: '2026-11-13 19:00:00' },
    { name: 'Friday afternoon', eventStart: '2026-11-13 13:00:00' }
  ];
  assert.deepEqual(sortPlaces(events, 'date').map(event => event.name),
    ['Friday afternoon', 'Friday evening', 'Saturday', 'Undated']);
});

test('merge removes duplicate locations but keeps different branches', () => {
  const otherBranch = { ...places[0], id: 'c', lat: 43.7 };
  const updated = { ...places[0], id: 'yelp-a', source: 'Yelp' };
  const merged = mergePlaces(places, [updated, otherBranch]);
  assert.equal(merged.length, 3);
  assert.ok(merged.some(p => p.id === 'yelp-a'));
  const refreshed = mergePlaces(merged, [{ ...places[0], source: 'OpenStreetMap' }]);
  assert.ok(refreshed.some(p => p.id === 'yelp-a'));
});
