import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, hkdfSync } from 'node:crypto';
const api = await import('../src/ticket.js').catch(() => ({}));

test('local ticket uses Science v2 authenticated encryption and local gateway identity', () => {
  assert.equal(typeof api.makeTicket, 'function');
  const t = api.makeTicket();
  assert.ok(t.encrypted.startsWith('v2:'));
  const bytes = Buffer.from(t.encrypted.slice(3), 'base64');
  const key = hkdfSync('sha256', Buffer.from(t.keys.OAUTH_ENCRYPTION_KEY, 'base64'), Buffer.alloc(0), 'operon:aes-256-gcm:oauth', 32);
  const d = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
  d.setAAD(Buffer.from('v2:oauth'));
  d.setAuthTag(bytes.subarray(-16));
  const data = JSON.parse(Buffer.concat([d.update(bytes.subarray(12,-16)),d.final()]));
  assert.equal(data.access_token,'magpie-claude-science');
  assert.equal(data.refresh_token,'');
  assert.equal(data.email,'science@localhost.invalid');
  assert.equal(data.account_uuid,t.account);
  assert.equal(data.org_uuid,t.org);
});

test('ticket creation preserves existing encryption material', () => {
  assert.equal(typeof api.makeTicket,'function');
  const first=api.makeTicket();
  const second=api.makeTicket(first.keys);
  assert.deepEqual(second.keys,first.keys);
  assert.notEqual(second.encrypted,first.encrypted);
});

test('invalid encryption material is rejected rather than replaced', () => {
  assert.equal(typeof api.makeTicket,'function');
  assert.throws(()=>api.makeTicket({OAUTH_ENCRYPTION_KEY:'bad'}), /key/i);
});
