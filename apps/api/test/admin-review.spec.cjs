const test = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { ModerationsService } = require('../dist/moderations/moderations.service.js');

function setup(job, updateCount = 1) {
  const calls = { audit: [], decisions: [], update: [] };
  const transaction = {
    moderationJob: { updateMany: async (args) => { calls.update.push(args); return { count: updateCount }; } },
    auditLog: { create: async (args) => { calls.audit.push(args); return {}; } },
    reviewDecision: { create: async (args) => { calls.decisions.push(args); return {}; } },
  };
  const prisma = {
    moderationJob: { findUnique: async () => job },
    $transaction: async (operation) => operation(transaction),
  };
  return { service: new ModerationsService(prisma, {}, {}, {}), calls };
}

test('claim uses optimistic locking and writes an audit event in the same transaction', async () => {
  const job = { id: 'job_1', reviewAssigneeId: null, reviewVersion: 0, effectiveDecision: null, results: [{ decision: 'REVIEW' }] };
  const { service, calls } = setup(job);
  assert.deepEqual(await service.claimReview('job_1', 'alice', 'ADMIN'), { review_version: 1 });
  assert.equal(calls.update[0].where.reviewVersion, 0);
  assert.equal(calls.update[0].data.reviewAssigneeId, 'alice');
  assert.equal(calls.audit[0].data.action, 'REVIEW_CLAIMED');
});

test('claim returns conflict when another reviewer wins the update race', async () => {
  const job = { id: 'job_1', reviewAssigneeId: null, reviewVersion: 0, effectiveDecision: null, results: [{ decision: 'REVIEW' }] };
  const { service } = setup(job, 0);
  await assert.rejects(() => service.claimReview('job_1', 'alice', 'ADMIN'), /Another moderator claimed/);
});

test('admin cannot claim a critical review', async () => {
  const job = { id: 'job_1', reviewAssigneeId: null, reviewVersion: 0, effectiveDecision: null, results: [{ decision: 'CRITICAL_REVIEW' }] };
  const { service } = setup(job);
  await assert.rejects(() => service.claimReview('job_1', 'alice', 'ADMIN'), ForbiddenException);
});

test('manual decision preserves the automated verdict and atomically writes decision plus audit', async () => {
  const job = { id: 'job_1', reviewAssigneeId: 'alice', reviewVersion: 2, effectiveDecision: null, results: [{ decision: 'REVIEW', nsfwRiskScore: 30 }] };
  const { service, calls } = setup(job);
  const result = await service.decideReview('job_1', 'alice', 'ADMIN', { action: 'REJECTED', reason: 'DOMAIN_MISMATCH', comment: 'Not an interior image.', reviewVersion: 2 });
  assert.deepEqual(result, { decision: 'REJECTED', review_version: 3 });
  assert.equal(calls.update[0].data.effectiveDecision, 'REJECTED');
  assert.equal(calls.decisions[0].data.action, 'REJECTED');
  assert.equal(calls.audit[0].data.action, 'REVIEW_REJECTED');
});
