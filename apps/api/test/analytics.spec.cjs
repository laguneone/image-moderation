const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsController } = require('../dist/moderations/analytics.controller.js');

test('CSV report exports bounded job data and neutralizes spreadsheet formulas', async () => {
  const prisma = { moderationJob: { findMany: async () => [{ id: 'job-1', createdAt: new Date('2026-11-16T10:00:00Z'), status: 'COMPLETED', pipeline: '=IMPORTXML("x")', pipelineVersionId: null, effectiveDecision: null, results: [{ decision: 'ALLOW', nsfwRiskScore: 0, domainMismatchScore: 0 }], invocations: [{ costUsd: null }] }] } };
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
  await new AnalyticsController(prisma).export({}, response);
  assert.match(response.headers['Content-Type'], /text\/csv/u);
  assert.match(response.headers['Content-Disposition'], /attachment/u);
  assert.match(response.body, /'=IMPORTXML/u);
  assert.match(response.body, /"job_id","created_at","status","pipeline"/u);
});

test('analytics rejects reversed and excessively long periods before querying', async () => {
  let queried = false;
  const prisma = { moderationJob: { findMany: async () => { queried = true; return []; } } };
  const response = { setHeader() {}, end() {} };
  const controller = new AnalyticsController(prisma);
  await assert.rejects(() => controller.export({ from: '2026-11-16', to: '2026-11-15' }, response), /предшествовать/u);
  await assert.rejects(() => controller.export({ from: '2024-01-01', to: '2026-11-15' }, response), /366 дней/u);
  assert.equal(queried, false);
});
