'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const nativeCore = require('..');

test('exports only the health function', () => {
  assert.deepEqual(Object.keys(nativeCore), ['health']);
  assert.equal(typeof nativeCore.health, 'function');
});

test('health returns stable core and protocol versions', () => {
  const expected = {
    coreVersion: '0.1.0',
    protocolVersion: 1,
  };

  assert.deepEqual(nativeCore.health(), expected);
  assert.deepEqual(nativeCore.health(), expected);

  const result = nativeCore.health();
  result.coreVersion = 'changed';
  result.protocolVersion = 999;

  assert.deepEqual(nativeCore.health(), expected);
});
