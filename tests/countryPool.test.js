'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPITAL_COORDINATES } = require('../src/capitals');
const { CURATED_COUNTRY_CODES } = require('../src/countryPool');

test('curated country pool is large, unique and has capital coordinates', () => {
  assert.ok(CURATED_COUNTRY_CODES.length >= 100);
  assert.equal(new Set(CURATED_COUNTRY_CODES).size, CURATED_COUNTRY_CODES.length);

  for (const code of CURATED_COUNTRY_CODES) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.ok(Array.isArray(CAPITAL_COORDINATES[code]), `missing capital coordinates for ${code}`);
  }
});
