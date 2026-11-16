const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { AdminSessionGuard } = require('../dist/common/admin-session.guard.js');

function token(role) {
  const payload = Buffer.from(JSON.stringify({ id: 'admin-1', role, expiresAt: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  return `${payload}.${createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url')}`;
}
function context(value) {
  return { switchToHttp: () => ({ getRequest: () => ({ header: () => value }) }) };
}

test('configuration guard accepts a signed active admin session', () => {
  const previous = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = 'x'.repeat(40);
  try { assert.equal(new AdminSessionGuard().canActivate(context(token('ADMIN'))), true); }
  finally { if (previous === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = previous; }
});

test('configuration guard rejects specialist sessions and invalid signatures', () => {
  const previous = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = 'x'.repeat(40);
  try {
    assert.throws(() => new AdminSessionGuard().canActivate(context(token('SPECIALIST'))), /administrator session/i);
    assert.throws(() => new AdminSessionGuard().canActivate(context('bogus.signature')), /invalid/i);
  } finally { if (previous === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = previous; }
});
