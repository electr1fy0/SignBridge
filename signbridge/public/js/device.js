// State validation and replay handling shared by the live UI and tests.
export function validateState(state) {
  if (!state || state.type !== 'state' || typeof state.boot !== 'string' || !Number.isFinite(state.uptime)) throw new Error('This address is not running SignBridge firmware.');
  for (const [key, length] of [['flex', 5], ['delta', 5], ['baseline', 5], ['acc', 3], ['gyro', 3], ['bendOn', 5], ['fullBend', 5], ['shapesTrained', 5], ['motionsTrained', 4]]) {
    if (!Array.isArray(state[key]) || state[key].length !== length) throw new Error(`Incomplete device data: ${key}`);
  }
  if (typeof state.env !== 'string') throw new Error('Incomplete device data: env');
  if (!Array.isArray(state.events)) throw new Error('Missing device event history.');
  return state;
}

export function consumeEvents(cursor, state) {
  const changedBoot = cursor.boot !== state.boot;
  const previous = changedBoot ? 0 : cursor.seq;
  const events = state.events.filter((event) => Number.isInteger(event.seq) && event.seq > previous && ['sign', 'reply'].includes(event.type)).sort((a, b) => a.seq - b.seq);
  // Initial history and restart history are shown, but never spoken again.
  const audible = changedBoot ? [] : events.filter((event) => event.type === 'sign');
  return { cursor: { boot: state.boot, seq: Math.max(previous, ...events.map((event) => event.seq)) }, events, audible };
}

export function replyDelivery(event) {
  const extras = `${event.haptic ? '; vibration triggered' : ''}${event.buzzer ? '; spelled in Morse on the buzzer' : ''}`;
  return event.lcd ? `Written to glove LCD${extras}` : `Received by glove; LCD unavailable${extras}`;
}
