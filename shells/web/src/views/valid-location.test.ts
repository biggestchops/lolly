// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressLookupUrl } from './valid-location.ts';
import { locationCardHtml } from './valid-context.ts';

test('address handoff uses the named website and only valid, displayed coordinates', () => {
  const url = new URL(addressLookupUrl(51.500729, -0.124625)!);
  assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(url.pathname, '/ui/reverse.html');
  assert.equal(url.searchParams.get('lat'), '51.50073');
  assert.equal(url.searchParams.get('lon'), '-0.12462');
  assert.deepEqual([...url.searchParams.keys()], ['lat', 'lon', 'zoom']);
  assert.ok(addressLookupUrl(0, 0));
  assert.ok(addressLookupUrl(-90, 180));
  for (const [lat, lon] of [[91, 0], [0, 181], [NaN, 0], [0, Infinity]]) assert.equal(addressLookupUrl(lat!, lon!), null);
});

test('the offline location card offers a deliberate request without a service URL to prefetch', () => {
  const html = locationCardHtml({ format: 'JPEG', fields: [], gps: { lat: 51.500729, lon: -0.124625 } });
  assert.match(html, /data-request-address/);
  assert.match(html, /data-lat="51.50073" data-lon="-0.12462"/);
  assert.ok(!html.includes('nominatim.openstreetmap.org'));
  assert.equal(locationCardHtml({ format: 'JPEG', fields: [] }), '');
});
