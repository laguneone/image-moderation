const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRules } = require('@moderation/shared');

test('rules safely match nested boolean conditions and stage action', () => {
  const result = evaluateRules([{ key: 'people-review', version: 2, applicationIds: [], conditions: { all: [{ field: 'peoplePresent', operator: 'EQUALS', value: true }, { not: { field: 'criticalReview', operator: 'EQUALS', value: true } }] }, actions: { TRIGGER_STAGE: 'deep_analysis' } }], { peoplePresent: true, criticalReview: false }, 'app-a');
  assert.deepEqual(result, { matchedRuleKeys: ['people-review@2'], triggerDeepAnalysis: true, requireReview: false });
});

test('rules honor application scopes and reject unsupported operators without executing expressions', () => {
  const result = evaluateRules([{ key: 'unsafe-rule', version: 1, applicationIds: ['other-app'], conditions: { field: 'nsfwUnsafe', operator: 'EVAL', value: 'true' }, actions: { REQUIRE_REVIEW: true } }], { nsfwUnsafe: true }, 'app-a');
  assert.deepEqual(result, { matchedRuleKeys: [], triggerDeepAnalysis: false, requireReview: false });
});

test('rules support bounded numeric comparisons and IN membership', () => {
  const result = evaluateRules([
    { key: 'risk-threshold', version: 1, applicationIds: [], conditions: { all: [{ field: 'nsfwRiskScore', operator: 'GT', value: 40 }, { field: 'sexualSignalCount', operator: 'IN', value: [0, 1] }] }, actions: { REQUIRE_REVIEW: true } },
  ], { nsfwRiskScore: 61, sexualSignalCount: 1 }, 'app-a');
  assert.equal(result.requireReview, true);
});
