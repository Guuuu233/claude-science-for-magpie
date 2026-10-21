import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Missing exports are assertions during the first red run, rather than import errors.
const agentModule = await import('../src/agent.js').catch(() => ({}));
const middleware = await import('../src/middleware.js').catch(() => ({}));
const { SCIENCE_ICON } = await import('../src/icon.js').catch(() => ({}));
const { onRequest, onEvent, onResponse } = middleware;
function context(overrides = {}) {
  const rejections = [];
  return { agent: 'claude-science', protocol: 'anthropic',
    options: { agent: 'claude-science', model: 'codex/gpt-6-luna' }, state: {},
    reject: (status, message) => rejections.push({ status, message }), rejections, ...overrides };
}
function requireHooks() {
  for (const name of ['onRequest', 'onEvent', 'onResponse']) assert.equal(typeof middleware[name], 'function', `${name} must be exported`);
}

test('agent declares the dedicated Science config and installed app', () => {
  const { notice, ...metadata } = agentModule.agent;
  assert.match(notice, /npx magpie-claude-science@latest install/);
  assert.match(notice, /首次|first/i);
  assert.deepEqual(metadata, {
    id: 'claude-science', name: 'Claude Science', config: '~/.config/magpie/claude-science.json',
    format: 'json', model: 'model', dir: '/Applications/Claude Science.app', icon: SCIENCE_ICON,
  });
});
test('connect returns flat Magpie-managed keys without changing its input', () => {
  assert.equal(typeof agentModule.connect, 'function');
  const input = { gateway: { url: 'http://127.0.0.1:8080', v1: 'http://127.0.0.1:8080/v1', key: 'local-agent-key' }, model: { id: 'codex/gpt-6-luna', name: 'GPT-6 Luna' } };
  const original = structuredClone(input);
  assert.deepEqual(agentModule.connect(input), { gateway: input.gateway.url, key: input.gateway.key, displayName: 'GPT-6 Luna' });
  assert.deepEqual(input, original);
});
test('connect uses model ID when no display name exists', () => {
  assert.equal(typeof agentModule.connect, 'function');
  assert.equal(agentModule.connect({ gateway: { url: 'http://localhost', key: 'key' }, model: { id: 'codex/gpt-6-luna' } }).displayName, 'codex/gpt-6-luna');
});
test('Claude aliases map while tools, schemas, thinking and content survive', () => {
  requireHooks();
  const body = { model: 'claude-opus-4-6', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] }], tools: [{ name: 'run', input_schema: { type: 'object', additionalProperties: false } }], thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, stream: true };
  const expected = structuredClone(body); expected.model = 'codex/gpt-6-luna';
  const ctx = context();
  assert.deepEqual(onRequest(body, ctx), expected);
  assert.deepEqual(ctx.rejections, []);
});
test('unknown agents, other agents and other protocols are untouched even with invalid options', () => {
  requireHooks();
  for (const overrides of [{ agent: undefined }, { agent: '' }, { agent: 'claude-code' }, { agent: 'Claude-Science' }, { protocol: 'chat' }, { protocol: 'responses' }]) {
    const ctx = context({ options: {}, ...overrides });
    const body = { model: 'claude-sonnet-4-6' };
    assert.deepEqual(onRequest(body, ctx), { model: 'claude-sonnet-4-6' });
    assert.deepEqual(ctx.state, {}); assert.deepEqual(ctx.rejections, []);
  }
});
test('a malicious agent option cannot widen scope', () => {
  requireHooks();
  const ctx = context({ agent: 'claude-code', options: { agent: 'claude-code', model: 'codex/gpt-6-luna' } });
  assert.deepEqual(onRequest({ model: 'claude-sonnet' }, ctx), { model: 'claude-sonnet' });
  assert.deepEqual(ctx.state, {}); assert.deepEqual(ctx.rejections, []);
});
test('invalid target models reject scoped requests with a constant non-sensitive error', () => {
  requireHooks();
  for (const model of [undefined, null, '', '  ', {}, [], 12, 'secret\nInjected', 'https://host/path', '../secret', 'codex/gpt 6', '__proto__']) {
    const ctx = context({ options: { agent: 'claude-science', model } });
    const body = { model: 'claude-sonnet' };
    onRequest(body, ctx);
    assert.deepEqual(body, { model: 'claude-sonnet' });
    assert.equal(ctx.rejections.length, 1);
    assert.deepEqual(ctx.rejections[0], { status: 400, message: 'Claude Science requires a valid provider/model option.' });
  }
});
test('missing request model rejects only scoped requests', () => {
  requireHooks();
  for (const model of [undefined, null, '', 123, {}, 'a\nb']) {
    const ctx = context(); onRequest({ model }, ctx);
    assert.equal(ctx.rejections.length, 1);
    assert.equal(ctx.rejections[0].status, 400);
  }
});
test('valid direct target requests remain unchanged and need no echo restoration', () => {
  requireHooks();
  const ctx = context(); const body = { model: 'codex/gpt-6-luna' };
  assert.deepEqual(onRequest(body, ctx), body);
  assert.deepEqual(ctx.state, {});
});
test('bridge-selected models pass through without plugin model options after a source switch', () => {
  requireHooks();
  for (const options of [undefined, {}, { agent: 'claude-science' }, { model: '' }, { model: 'codex/old-model' }]) {
    const ctx = context({ options });
    const body = { model: 'codex/gpt-6.1-sol', messages: [{ role: 'user', content: '123' }] };
    const expected = structuredClone(body);
    assert.deepEqual(onRequest(body, ctx), expected);
    assert.deepEqual(ctx.rejections, []);
    assert.deepEqual(ctx.state, {});
  }
});
test('streaming and nonstreaming responses restore each request alias independently', () => {
  requireHooks();
  const first = context(), second = context();
  onRequest({ model: 'claude-opus' }, first); onRequest({ model: 'claude-sonnet' }, second);
  const response = { type: 'message', model: 'gpt-6-luna', content: [{ type: 'tool_use', id: 't1', name: 'run', input: { x: 1 } }], usage: { input_tokens: 1, output_tokens: 2 } };
  assert.deepEqual(onResponse(structuredClone(response), first), { ...response, model: 'claude-opus' });
  assert.deepEqual(onEvent({ type: 'message_start', message: structuredClone(response) }, second), { type: 'message_start', message: { ...response, model: 'claude-sonnet' } });
  assert.deepEqual(onResponse(structuredClone(response), context()), response);
});
test('tool deltas, unknown shapes and errors pass through without dropping events or throwing', () => {
  requireHooks();
  const ctx = context(); onRequest({ model: 'claude-opus' }, ctx);
  for (const event of [null, 42, 'text', [], {}, { type: 'message_start' }, { type: 'message_start', message: null }, { type: 'message_start', message: 'unknown' }, { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":' } }, { type: 'error', error: { message: 'backend error' }, model: 'backend' }]) {
    const expected = structuredClone(event);
    assert.deepEqual(onEvent(event, ctx), expected);
    assert.deepEqual(onResponse(event, ctx), expected);
  }
});
test('response hooks do not restore outside the matching agent and protocol', () => {
  requireHooks();
  const ctx = context(); onRequest({ model: 'claude-opus' }, ctx);
  for (const overrides of [{ agent: undefined }, { agent: 'claude-code' }, { protocol: 'chat' }]) {
    const body = { type: 'message', model: 'backend' };
    assert.deepEqual(onResponse(structuredClone(body), { ...ctx, ...overrides }), body);
    assert.deepEqual(onEvent({ type: 'message_start', message: structuredClone(body) }, { ...ctx, ...overrides }), { type: 'message_start', message: body });
  }
});


test('Science icon is an offline 128px PNG shared by agent and plugin metadata', () => {
  assert.equal(typeof SCIENCE_ICON, 'string', 'SCIENCE_ICON must be exported');
  assert.match(SCIENCE_ICON, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  const png = Buffer.from(SCIENCE_ICON.split(',')[1], 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
  assert.ok(Buffer.byteLength(SCIENCE_ICON) < 50000, 'Embedded icon should stay modest');
  assert.equal(agentModule.agent.icon, SCIENCE_ICON);
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.magpie.icon, SCIENCE_ICON);
});
