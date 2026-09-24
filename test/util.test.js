const test = require('node:test');
const assert = require('node:assert');
const { randomSlug, isValidSlug, parseUrl, classifyDevice } = require('../src/util');

test('randomSlug 7 karakter alfanumerik', () => assert.match(randomSlug(), /^[0-9a-zA-Z]{7}$/));
test('slug dicadangkan ditolak', () => assert.equal(isValidSlug('api'), false));
test('slug valid diterima', () => assert.equal(isValidSlug('promo-2026'), true));
test('hanya http/https', () => assert.equal(parseUrl('javascript:alert(1)', 'http://x.id'), null));
test('domain sendiri ditolak', () => assert.equal(parseUrl('http://x.id/abc', 'http://x.id'), null));
test('url valid dinormalisasi', () => assert.equal(parseUrl('https://example.com', 'http://x.id'), 'https://example.com/'));
test('deteksi perangkat', () => assert.equal(classifyDevice('Mozilla/5.0 (iPhone) Mobile'), 'mobile'));
