const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRisk } = require('../dist/risk-engine.js');

test('a person in a clearly identified furnished interior does not trigger manual review on its own', () => {
  const result = calculateRisk({ nsfwUnsafe: false, sexualSignalCount: 0, peoplePresent: true, humanBodyPartPresent: false, interiorContextPresent: true });
  assert.equal(result.nsfwRiskScore, 0);
  assert.equal(result.domainMismatchScore, 35);
  assert.equal(result.decision, 'ALLOW');
});

test('a person without a recognized interior still triggers a domain review', () => {
  const result = calculateRisk({ nsfwUnsafe: false, sexualSignalCount: 0, peoplePresent: true, humanBodyPartPresent: false });
  assert.equal(result.decision, 'REVIEW');
});

test('an uncorroborated unsafe primary result requires review instead of restriction', () => {
  const result = calculateRisk({ nsfwUnsafe: true, sexualSignalCount: 0, peoplePresent: false, humanBodyPartPresent: false });
  assert.equal(result.nsfwRiskScore, 50);
  assert.equal(result.decision, 'REVIEW');
});

test('a primary unsafe signal cleared by complete independent analysis does not add risk points', () => {
  const result = calculateRisk({ nsfwUnsafe: true, primaryUnsafeOverruled: true, sexualSignalCount: 0, peoplePresent: true, humanBodyPartPresent: false, interiorContextPresent: true });
  assert.equal(result.nsfwRiskScore, 0);
  assert.equal(result.domainMismatchScore, 35);
  assert.equal(result.decision, 'ALLOW');
  assert.ok(result.reasons.some((reason) => reason.includes('не подтвердился')));
});

test('suspicious metadata is review evidence and absence does not increase risk', () => {
  const withTerm = calculateRisk({ nsfwUnsafe: false, sexualSignalCount: 1, peoplePresent: false, humanBodyPartPresent: false });
  const withoutTerm = calculateRisk({ nsfwUnsafe: false, sexualSignalCount: 0, peoplePresent: false, humanBodyPartPresent: false });
  assert.equal(withTerm.decision, 'REVIEW');
  assert.equal(withoutTerm.decision, 'ALLOW');
  assert.equal(withoutTerm.nsfwRiskScore, 0);
});

test('correlated deep signals use the maximum configured weight instead of stacking', () => {
  const result = calculateRisk({ nsfwUnsafe: false, sexualSignalCount: 1, peoplePresent: false, humanBodyPartPresent: false, sexualizedRelationship: true, sexualizedContext: true });
  assert.equal(result.nsfwRiskScore, 65);
  assert.equal(result.decision, 'REVIEW');
});

test('corroborated sexual content is restricted even when its score is below the ordinary threshold', () => {
  const result = calculateRisk({
    nsfwUnsafe: false,
    sexualSignalCount: 0,
    peoplePresent: true,
    humanBodyPartPresent: false,
    sexualizedRelationship: true,
    sexualizedComposition: true,
    sexualizedContext: true,
    cropUnsafe: true,
    arbitratorRestricted: true,
    confirmedSexualContent: true,
  });
  assert.equal(result.nsfwRiskScore, 65);
  assert.equal(result.decision, 'RESTRICT');
  assert.ok(result.reasons.some((reason) => reason.includes('подтверждён')));
});

test('one crop or an arbitrator recommendation alone does not bypass the ordinary thresholds', () => {
  const result = calculateRisk({
    nsfwUnsafe: false,
    sexualSignalCount: 0,
    peoplePresent: false,
    humanBodyPartPresent: false,
    cropUnsafe: true,
    arbitratorRestricted: true,
  });
  assert.equal(result.decision, 'REVIEW');
});

test('fetish-related content is restricted without assuming age', () => {
  const result = calculateRisk({
    nsfwUnsafe: false,
    sexualSignalCount: 0,
    peoplePresent: false,
    humanBodyPartPresent: false,
    fetishContentDetected: true,
  });
  assert.equal(result.nsfwRiskScore, 0);
  assert.equal(result.decision, 'RESTRICT');
  assert.ok(result.reasons.some((reason) => reason.includes('фетиш')));
});
