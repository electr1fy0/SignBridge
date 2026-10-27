import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateState, consumeEvents, replyDelivery } from '../public/js/device.js';
const makeState = (events = [], boot = 'boot-a') => ({ type: 'state', boot, uptime: 1234, flex: [0,0,0,0,0], delta: [0,0,0,0,0], baseline: [0,0,0,0,0], acc: [0,0,9.81], gyro: [0,0,0], bendOn: [150,100,100,130,110], fullBend: [150,100,100,130,110], shapesTrained: [false,false,false,false], env: 'everyday', events });
const sign = (seq, text = 'FIST') => ({ seq, type: 'sign', source: 'flex', env: 'everyday', text });
test('initial device history is visible without replaying old speech', () => {
  const result = consumeEvents({ boot: null, seq: 0 }, makeState([sign(1), sign(2)]));
  assert.equal(result.events.length, 2); assert.equal(result.audible.length, 0);
  assert.deepEqual(result.cursor, { boot: 'boot-a', seq: 2 });
});
test('overlapping HTTP and WebSocket snapshots do not duplicate signs', () => {
  const cursor = { boot: 'boot-a', seq: 2 };
  const result = consumeEvents(cursor, makeState([sign(1), sign(2), sign(3)]));
  assert.deepEqual(result.events.map((e) => e.seq), [3]); assert.equal(result.audible.length, 1);
  const repeated = consumeEvents(result.cursor, makeState([sign(2), sign(3)]));
  assert.equal(repeated.events.length, 0);
});
test('restart accepts new low sequence numbers without speaking old device history', () => {
  const result = consumeEvents({ boot: 'boot-a', seq: 99 }, makeState([sign(1, 'WAVE')], 'boot-b'));
  assert.equal(result.events.length, 1); assert.equal(result.cursor.seq, 1); assert.equal(result.audible.length, 0);
});
test('LCD failure never claims hardware delivery', () => {
  assert.equal(replyDelivery({ lcd: false, haptic: false }), 'Received by glove; LCD unavailable');
  assert.match(replyDelivery({ lcd: true, haptic: true }), /Written to glove LCD; vibration triggered/);
});
test('invalid and incomplete server responses cannot establish a device session', () => {
  assert.throws(() => validateState({ type: 'connected' }), /not running SignBridge/);
  const state = makeState(); state.flex = [123];
  assert.throws(() => validateState(state), /flex/);
  assert.equal(validateState(makeState()).boot, 'boot-a');
});
