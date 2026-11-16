const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkerConfigurationService } = require('../dist/worker-configuration.service.js');

test('Qwen configurations inherit a configured fallback when none is saved per model', async () => {
  const priorFallback = process.env.OPENROUTER_QWEN_FALLBACK_MODEL;
  process.env.OPENROUTER_QWEN_FALLBACK_MODEL = 'google/gemini-3-flash-preview';
  const prisma = { modelConfiguration: { findFirst: async () => ({
    openRouterModelId: 'qwen/qwen3.6-flash', fallbackModelId: null, timeoutMs: 90_000, maxTokens: null, generationParams: {},
  }) } };
  try {
    const result = await new WorkerConfigurationService(prisma).model('initial_scene', 'qwen/qwen3.6-flash');
    assert.equal(result.fallbackModelId, 'google/gemini-3-flash-preview');
  } finally {
    if (priorFallback === undefined) delete process.env.OPENROUTER_QWEN_FALLBACK_MODEL;
    else process.env.OPENROUTER_QWEN_FALLBACK_MODEL = priorFallback;
  }
});

test('Qwen does not fall back to itself', async () => {
  const priorFallback = process.env.OPENROUTER_QWEN_FALLBACK_MODEL;
  process.env.OPENROUTER_QWEN_FALLBACK_MODEL = 'qwen/qwen3.6-flash';
  const prisma = { modelConfiguration: { findFirst: async () => null } };
  try {
    const result = await new WorkerConfigurationService(prisma).model('initial_scene', 'qwen/qwen3.6-flash');
    assert.equal(result.fallbackModelId, null);
  } finally {
    if (priorFallback === undefined) delete process.env.OPENROUTER_QWEN_FALLBACK_MODEL;
    else process.env.OPENROUTER_QWEN_FALLBACK_MODEL = priorFallback;
  }
});
