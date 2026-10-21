import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.MAGPIE_SCIENCE_BRIDGE_LOG='/dev/null';
const {scienceLane, sessionLabel}=await import('../src/bridge.js');

// Mirrors Science 0.1.60 apiMetadata (tl()): session_id is
// <session hex>[:<frame hex first 24>][:<lane>] (lane omitted for "agent").
const FRAME = '7133cf97b33d444c91010589a074dff9';
const ROOT = '0123456789abcdef0123456789abcdef';
const meta = (sessionId, frame = FRAME) => ({user_id: JSON.stringify({session_id: sessionId, frame_id: frame})});
const body = (sessionId, extra = {}, frame = FRAME) => ({metadata: meta(sessionId, frame), messages: [{role: 'user', content: 'x'}], ...extra});

const lane = b => { const r = scienceLane(b); return r && {kind: r.kind, lane: r.lane}; };

test('scienceLane follows Science apiMetadata encoding', () => {
  assert.deepEqual(lane(body(FRAME)), {kind: 'main', lane: 'agent'}, "frame's own agent");
  assert.deepEqual(lane(body(ROOT + ':' + FRAME.slice(0, 24))), {kind: 'main', lane: 'agent'}, "child frame's agent is not a helper");
  assert.deepEqual(lane(body(FRAME, {tool_choice: {type: 'none'}})), {kind: 'fork', lane: 'fork'}, 'memory/compaction fork of the agent view');
  assert.deepEqual(lane(body(FRAME + ':mem')), {kind: 'aux', lane: 'mem'});
  assert.deepEqual(lane(body(FRAME + ':sniff')), {kind: 'aux', lane: 'sniff'});
  assert.deepEqual(lane(body(ROOT + ':' + FRAME.slice(0, 24) + ':rc_enrich')), {kind: 'aux', lane: 'rc_enrich'}, "child frame's helper");
  assert.deepEqual(lane(body(ROOT + ':sniff')), {kind: 'aux', lane: 'unknown'}, 'helper of another frame is not trusted');
  assert.deepEqual(lane(body(FRAME + ':Bad-Lane')), {kind: 'aux', lane: 'unknown'});
  assert.deepEqual(lane(body('ffff')), {kind: 'aux', lane: 'unknown'}, 'unrecognized shape downgrades to a helper');
  assert.equal(scienceLane({messages: []}), null, 'no metadata');
  // tool_choice auto/tool on the agent lane stays the agent conversation.
  assert.deepEqual(lane(body(FRAME, {tool_choice: {type: 'auto'}})), {kind: 'main', lane: 'agent'});
});

test('session labels: one conversation per frame, helpers stateless', () => {
  const uuid = '7133cf97-b33d-444c-9101-0589a074dff9';
  assert.equal(scienceLane(body(FRAME)).frame, uuid);
  assert.equal(sessionLabel(body(FRAME)), 'science-' + uuid);
  assert.equal(sessionLabel(body(ROOT + ':' + FRAME.slice(0, 24))), 'science-' + uuid, "child frame's own agent");
  assert.equal(sessionLabel(body(FRAME, {tool_choice: {type: 'none'}})), null, 'memory/compaction fork');
  assert.equal(sessionLabel(body(FRAME + ':mem')), null);
  assert.equal(sessionLabel({messages: []}), null, 'no frame');
});
