'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPITAL_COORDINATES } = require('../src/capitals');

test('capital coordinate table is complete and valid', () => {
  const entries = Object.entries(CAPITAL_COORDINATES);
  assert.ok(entries.length >= 190);

  for (const [code, coordinates] of entries) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.equal(coordinates.length, 2);
    assert.ok(Number.isFinite(coordinates[0]));
    assert.ok(Number.isFinite(coordinates[1]));
    assert.ok(coordinates[0] >= -90 && coordinates[0] <= 90);
    assert.ok(coordinates[1] >= -180 && coordinates[1] <= 180);
  }

  assert.deepEqual(CAPITAL_COORDINATES.DE, [52.52, 13.405]);
  assert.deepEqual(CAPITAL_COORDINATES.FR, [48.8566, 2.3522]);
  assert.deepEqual(CAPITAL_COORDINATES.JP, [35.6762, 139.6503]);
});
