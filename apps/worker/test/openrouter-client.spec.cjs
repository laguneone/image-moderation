const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenRouterClient } = require('../dist/openrouter.client.js');

test('test responses are available only when the explicit test flag is enabled', async () => {
  const priorMode = process.env.MODERATION_TEST_MODE;
  const priorKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.MODERATION_TEST_MODE = 'true';
  try {
    const response = await new OpenRouterClient().analyze('qwen/qwen3.6-flash', 'test', Buffer.from('image'), 'image/png');
    assert.equal(response.provider, 'test');
    assert.equal(JSON.parse(response.content).humans.present, false);
  } finally {
    if (priorMode === undefined) delete process.env.MODERATION_TEST_MODE;
    else process.env.MODERATION_TEST_MODE = priorMode;
    if (priorKey !== undefined) process.env.OPENROUTER_API_KEY = priorKey;
  }
});

test('missing credentials without explicit test mode fail closed', async () => {
  const priorMode = process.env.MODERATION_TEST_MODE;
  const priorKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.MODERATION_TEST_MODE = 'false';
  try {
    await assert.rejects(() => new OpenRouterClient().analyze('qwen/qwen3.6-flash', 'test', Buffer.from('image'), 'image/png'), /OPENROUTER_API_KEY is required/);
  } finally {
    if (priorMode === undefined) delete process.env.MODERATION_TEST_MODE;
    else process.env.MODERATION_TEST_MODE = priorMode;
    if (priorKey !== undefined) process.env.OPENROUTER_API_KEY = priorKey;
  }
});
