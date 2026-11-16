const test = require('node:test');
const assert = require('node:assert/strict');
const { canOverridePrimaryUnsafe, hasPotentialSexualObject, parseSafety, parseScene } = require('../dist/worker.module.js');

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

test('only a complete safe consensus can overrule an unclassified Nemotron unsafe signal', () => {
  const safeDeep = {
    sceneDecomposition: { persons: [], objects: ['sofa', 'coffee table', 'plant'] },
    context: { classification: 'NON_SEXUAL', sexual_context: false, fetish_content: false },
    composition: { sexualized_focus: false },
    relationships: { sexualized_interaction: false },
    crops: { status: 'COMPLETED', regions: [{ sexual_content: false }] },
    ocr: { suspicious_text: false },
    arbitration: { recommendation: 'ALLOW' },
  };
  const safety = { unsafe: true, categories: [], criticalReview: false };
  const objectOnlyScene = { humans: { present: false, count: 0, categories: ['NO_HUMANS'] }, scene: { categories: ['INTERIOR_SCENE', 'FURNITURE'] }, objects: ['sofa', 'plant'] };
  assert.equal(canOverridePrimaryUnsafe(safety, safeDeep, objectOnlyScene, false), true);
  const skippedCropDeep = { ...safeDeep, crops: { status: 'SKIPPED_IMAGE_TOO_SMALL_OR_DISABLED' } };
  assert.equal(canOverridePrimaryUnsafe(safety, skippedCropDeep, objectOnlyScene, true), true);
  assert.equal(canOverridePrimaryUnsafe(safety, skippedCropDeep, objectOnlyScene, false), false);
  assert.equal(canOverridePrimaryUnsafe(safety, skippedCropDeep, { ...objectOnlyScene, objects: ['vibrator'] }, true), false);
  assert.equal(canOverridePrimaryUnsafe(safety, skippedCropDeep, { ...objectOnlyScene, humans: { present: true, count: 1, categories: ['REAL_PERSON'] } }, true), false);
  assert.equal(canOverridePrimaryUnsafe(safety, { ...safeDeep, context: { ...safeDeep.context, classification: 'AMBIGUOUS' } }, objectOnlyScene, false), false);
  assert.equal(canOverridePrimaryUnsafe({ ...safety, categories: ['sexual content'] }, safeDeep, objectOnlyScene, false), false);
  assert.equal(canOverridePrimaryUnsafe({ ...safety, criticalReview: true }, safeDeep, objectOnlyScene, false), false);
});

test('potential sexual objects are detected in English and Russian scene labels', () => {
  assert.equal(hasPotentialSexualObject(['sofa', 'coffee table', 'vibrator']), true);
  assert.equal(hasPotentialSexualObject(['диван', 'мастурбатор']), true);
  assert.equal(hasPotentialSexualObject(['sofa', 'lamp', 'plant']), false);
});
