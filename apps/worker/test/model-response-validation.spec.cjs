const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSafety, parseScene } = require('../dist/worker.module.js');

test('Nemotron uses User Safety and treats categories as optional', () => {
  assert.deepEqual(parseSafety('Safety: safe\nCategories: none'), { unsafe: false, categories: [], criticalReview: false });
  assert.deepEqual(parseSafety('User Safety: safe\nResponse Safety: safe'), { unsafe: false, categories: [], criticalReview: false });
  assert.deepEqual(parseSafety('User Safety: unsafe\nResponse Safety: safe'), { unsafe: true, categories: [], criticalReview: false });
  assert.deepEqual(parseSafety('User Safety: unsafe\nSafety Categories: explicit content'), { unsafe: true, categories: ['explicit content'], criticalReview: false });
  assert.throws(() => parseSafety('looks safe'), /valid User Safety label/);
  assert.throws(() => parseSafety('Response Safety: unsafe'), /valid User Safety label/);
});

test('critical sexual-minor category triggers specialized review', () => {
  const result = parseSafety('Safety: unsafe\nCategories: child sexual exploitation');
  assert.equal(result.criticalReview, true);
  assert.equal(result.unsafe, true);
});

test('Qwen output must have consistent counts and supported categories', () => {
  const valid = { humans: { present: true, count: 1, categories: ['REAL_PERSON'] }, scene: { categories: ['INTERIOR_SCENE'] }, objects: ['chair'] };
  assert.deepEqual(parseScene(JSON.stringify(valid)), valid);
  assert.deepEqual(parseScene(JSON.stringify([valid])), valid);
  assert.throws(() => parseScene(JSON.stringify([valid, valid])), /missing required/);
  const countSaysPerson = parseScene(JSON.stringify({ ...valid, humans: { present: false, count: 1, categories: ['REAL_PERSON'] } }));
  assert.equal(countSaysPerson.humans.present, true);
  assert.equal(countSaysPerson.humans.count, 1);
  const categorySaysPerson = parseScene(JSON.stringify({ ...valid, humans: { present: false, count: 0, categories: ['HUMANOID_CHARACTER'] } }));
  assert.equal(categorySaysPerson.humans.present, true);
  assert.equal(categorySaysPerson.humans.count, 1);
  const trueWithoutCount = parseScene(JSON.stringify({ ...valid, humans: { present: true, count: 0, categories: ['REAL_PERSON'] } }));
  assert.equal(trueWithoutCount.humans.present, true);
  assert.equal(trueWithoutCount.humans.count, 1);
  assert.deepEqual(parseScene(JSON.stringify({ ...valid, humans: { present: false, count: 1, categories: ['NO_HUMANS'] } })).humans.categories, []);
  assert.throws(() => parseScene(JSON.stringify({ ...valid, scene: { categories: ['UNKNOWN_SCENE'] } })), /unsupported/);
});
