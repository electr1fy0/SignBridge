import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineBuffer, parseLine } from '../public/js/parser.js';

/** Feed chunks through a fresh buffer and return the recognition events in order. */
function recognitions(chunks) {
  const buf = new LineBuffer();
  const out = [];
  for (const c of chunks) {
    for (const line of buf.push(c)) {
      const ev = parseLine(line);
      if (ev?.type === 'recognition') out.push(ev.sign);
    }
  }
  return out;
}

test('1. official event is recognised', () => {
  assert.deepEqual(recognitions(['>>> RECOGNIZED: OKAY <<<\n']), ['OKAY']);
});

test('2. the same official event twice yields two events', () => {
  assert.deepEqual(recognitions(['>>> RECOGNIZED: OKAY <<<\n>>> RECOGNIZED: OKAY <<<\n']), ['OKAY', 'OKAY']);
});

test('3/4. undelimited RECOGNIZED lines are live diagnostics, never events', () => {
  assert.deepEqual(recognitions(['RECOGNIZED: OKAY\nRECOGNIZED: NONE\n']), []);
  assert.deepEqual(parseLine('RECOGNIZED: OKAY'), { type: 'live', key: 'recognized', value: 'OKAY' });
  assert.equal(parseLine('>>> RECOGNIZED: NONE <<<').type, 'log');
});

test('half-delimited lines are not events', () => {
  assert.deepEqual(recognitions(['>>> RECOGNIZED: OKAY\nRECOGNIZED: OKAY <<<\n']), []);
});

test('chunk boundaries: split anywhere, processed exactly once', () => {
  const line = '>>> RECOGNIZED: THANK YOU <<<\r\n';
  for (let i = 1; i < line.length; i++) {
    assert.deepEqual(recognitions([line.slice(0, i), line.slice(i)]), ['THANK YOU'], `split at ${i}`);
  }
  // one byte at a time
  assert.deepEqual(recognitions([...line]), ['THANK YOU']);
});

test('incomplete line is held until its newline arrives', () => {
  const buf = new LineBuffer();
  assert.deepEqual(buf.push('>>> RECOGNIZED: OKAY <<<'), []);
  assert.deepEqual(buf.push('\n'), ['>>> RECOGNIZED: OKAY <<<']);
});

test('mixed line endings and multiple lines per chunk', () => {
  assert.deepEqual(
    recognitions(['\n>>> RECOGNIZED: HELLO <<<\r\n>>> RECOGNIZED: BYE <<<\r>>> RECOGNIZED: SLOW DOWN <<<\n']),
    ['HELLO', 'BYE', 'SLOW DOWN'],
  );
});

test('5. live diagnostic block parses into fields, no events', () => {
  const block = `--------------------------------
FLEX  (T I M R P): 2410 | 2980 | 0 | 3120 | 2875
DELTA (T I M R P): 310 | 250 | 0 | 15 | 20
BENT PATTERN: 11000
ACC: X=-1.72 Y=-2.58 Z=-10.00
GYRO: X=1.37 Y=3.60 Z=1.57
RECOGNIZED: OKAY
STATUS: MPU=OK LCD=OK
`;
  const evs = new LineBuffer().push(block).map(parseLine).filter(Boolean);
  assert.equal(evs.filter((e) => e.type === 'recognition').length, 0);
  const byKey = Object.fromEntries(evs.filter((e) => e.type === 'live').map((e) => [e.key, e.value]));
  assert.deepEqual(byKey.flex, [2410, 2980, 0, 3120, 2875]);
  assert.deepEqual(byKey.delta, [310, 250, 0, 15, 20]);
  assert.equal(byKey.pattern, '11000');
  assert.deepEqual(byKey.acc, [-1.72, -2.58, -10]);
  assert.deepEqual(byKey.gyro, [1.37, 3.6, 1.57]);
  assert.deepEqual(evs.find((e) => e.type === 'status'), { type: 'status', mpu: 'OK', lcd: 'OK' });
});

test('6/7. banners detect the sketch and never produce events', () => {
  assert.deepEqual(parseLine('DIFFERENCE-BASED DETECTION'), { type: 'sketch', sketch: 'A' });
  assert.deepEqual(parseLine(' MOTION GLOVE (MPU6500 ONLY)'), { type: 'sketch', sketch: 'B' });
  assert.deepEqual(parseLine(' Motion sensor: NOT FOUND'), { type: 'status', mpu: 'FAIL' });
  assert.equal(parseLine('1 = Train OKAY   (11000)').type, 'log');
  assert.equal(parseLine('Keep all five fingers straight!').type, 'log');
});

test('live toggle replies and proposed ACK', () => {
  assert.deepEqual(parseLine('Live readings: ON'), { type: 'live-toggle', on: true });
  assert.deepEqual(parseLine('Live readings: OFF'), { type: 'live-toggle', on: false });
  assert.deepEqual(parseLine('ACK|7K2Q'), { type: 'ack', id: '7K2Q' });
});

