const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigurationController } = require('../dist/moderations/configuration.controller.js');
const { AnalyticsController } = require('../dist/moderations/analytics.controller.js');
const { ApiKeyGuard } = require('../dist/common/api-key.guard.js');

test('configuration and analytics are available through the internal API key without an admin session', () => {
  for (const controller of [ConfigurationController, AnalyticsController]) {
    const guards = Reflect.getMetadata('__guards__', controller);
    assert.deepEqual(guards, [ApiKeyGuard]);
  }
});
