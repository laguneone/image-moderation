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

test('explicit mode supplies structured fixtures for deep analysis stages', async () => {
  const priorMode = process.env.MODERATION_TEST_MODE;
  const priorKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.MODERATION_TEST_MODE = 'true';
  try {
    const response = await new OpenRouterClient().analyzeText('qwen/qwen3.6-flash', '[stage:relationships] Test observations');
    const result = JSON.parse(response.content);
    assert.equal(result.sexualized_interaction, false);
    assert.deepEqual(result.relations, []);
  } finally {
    if (priorMode === undefined) delete process.env.MODERATION_TEST_MODE;
    else process.env.MODERATION_TEST_MODE = priorMode;
    if (priorKey !== undefined) process.env.OPENROUTER_API_KEY = priorKey;
  }
});

test('structured requests require a provider that honors their response schema', async () => {
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorBase = process.env.OPENROUTER_BASE_URL;
  const priorFetch = global.fetch;
  let requestBody;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/api';
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  try {
    await new OpenRouterClient().analyzeText('qwen/qwen3.6-flash', 'Return an object.', { name: 'result', strict: true, schema: { type: 'object' } });
    assert.deepEqual(requestBody.provider, { require_parameters: true });
    assert.equal(requestBody.response_format.type, 'json_schema');
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorKey;
    if (priorBase === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = priorBase;
  }
});

test('OpenRouter can route a failed Qwen request to its configured compatible fallback', async () => {
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorBase = process.env.OPENROUTER_BASE_URL;
  const priorFetch = global.fetch;
  let requestBody;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/api';
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ model: 'google/gemini-3-flash-preview', choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  try {
    const response = await new OpenRouterClient().analyzeText('qwen/qwen3.6-flash', 'Return an object.', { name: 'result', strict: true, schema: { type: 'object' } }, { fallbackModelId: 'google/gemini-3-flash-preview' });
    assert.deepEqual(requestBody.models, ['qwen/qwen3.6-flash', 'google/gemini-3-flash-preview']);
    assert.equal(response.modelId, 'google/gemini-3-flash-preview');
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorKey;
    if (priorBase === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = priorBase;
  }
});

test('OpenRouter provider failures retain bounded diagnostics for troubleshooting', async () => {
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorFetch = global.fetch;
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw: 'The selected model does not support this response format.' } } }), { status: 400 });
  try {
    await assert.rejects(
      () => new OpenRouterClient().analyzeText('qwen/qwen3.6-flash', 'Return an object.'),
      /400\): Provider returned error \[400\]; provider: The selected model does not support this response format\./,
    );
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorKey;
  }
});
