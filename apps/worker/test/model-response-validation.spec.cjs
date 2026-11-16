const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSafety, parseScene } = require('../dist/worker.module.js');

test('Nemotron requires explicit safety and category labels', () => {
  assert.deepEqual(parseSafety('Safety: safe\nCategories: none'), { unsafe: false, categories: [], criticalReview: false });
  assert.throws(() => parseSafety('looks safe'), /valid Safety and Categories labels/);
});

test('critical sexual-minor category triggers specialized review', () => {
  const result = parseSafety('Safety: unsafe\nCategories: child sexual exploitation');
  assert.equal(result.criticalReview, true);
  assert.equal(result.unsafe, true);
});

test('Qwen output must have consistent counts and supported categories', () => {
  const valid = { humans: { present: true, count: 1, categories: ['REAL_PERSON'] }, scene: { categories: ['INTERIOR_SCENE'] }, objects: ['chair'] };
  assert.deepEqual(parseScene(JSON.stringify(valid)), valid);
  assert.throws(() => parseScene(JSON.stringify({ ...valid, humans: { ...valid.humans, count: 0 } })), /inconsistent human count/);
  assert.throws(() => parseScene(JSON.stringify({ ...valid, scene: { categories: ['UNKNOWN_SCENE'] } })), /unsupported/);
});
