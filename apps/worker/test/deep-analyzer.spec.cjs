const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { DeepAnalyzer } = require('../dist/deep-analyzer.js');
const { OpenRouterClient } = require('../dist/openrouter.client.js');

test('anomaly triggers bounded deep stages with explicit local model fixtures', async () => {
  const previousMode = process.env.MODERATION_TEST_MODE;
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousCrops = process.env.MAX_IMAGE_CROPS;
  delete process.env.OPENROUTER_API_KEY;
  process.env.MODERATION_TEST_MODE = 'true';
  process.env.MAX_IMAGE_CROPS = '2';
  let nextId = 0;
  const prisma = {
    stageExecution: {
      create: async () => ({ id: `stage-${++nextId}` }),
      update: async () => ({}),
    },
    modelInvocation: { create: async () => ({}) },
    $transaction: async (operations) => Promise.all(operations),
  };
  try {
    const image = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#bcbcbc' } }).png().toBuffer();
    const result = await new DeepAnalyzer(prisma, new OpenRouterClient()).analyze('job-test', image, 'image/png', {
      safety: { unsafe: false, categories: [] },
      scene: { humans: { present: false, count: 0, categories: ['NO_HUMANS'] }, scene: { categories: ['INTERIOR_SCENE'] }, objects: ['table'] },
      metadata: { suspiciousKeywords: ['explicit'], sourceUrls: [] },
      width: 1024,
      height: 768,
    });
    assert.equal(result.triggered, true);
    assert.equal(result.context.classification, 'NON_SEXUAL');
    assert.equal(result.crops.status, 'COMPLETED');
    assert.equal(result.arbitration, null);
  } finally {
    if (previousMode === undefined) delete process.env.MODERATION_TEST_MODE;
    else process.env.MODERATION_TEST_MODE = previousMode;
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    if (previousCrops === undefined) delete process.env.MAX_IMAGE_CROPS;
    else process.env.MAX_IMAGE_CROPS = previousCrops;
  }
});
