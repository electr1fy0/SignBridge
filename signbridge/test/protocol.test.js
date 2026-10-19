import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLcd, vibFor, buildCommand, validateCommand, DEFAULT_TEMPLATE, makeAckId } from '../public/js/protocol.js';

test('12. LCD: short text fits on two 16-char lines', () => {
  assert.deepEqual(formatLcd("I'll heat it for you."), { lines: ["I'LL HEAT IT FOR", 'YOU.'], truncated: false });
  assert.deepEqual(formatLcd('Yes'), { lines: ['YES', ''], truncated: false });
});

test('12. LCD: long text is truncated with ".." and never exceeds 16 columns', () => {
  const r = formatLcd('Please help me find my train to the airport today');
  assert.equal(r.truncated, true);
  assert.ok(r.lines.every((l) => l.length <= 16));
  assert.ok(r.lines[1].endsWith('..'));
  const long = formatLcd('Supercalifragilisticexpialidocious');
  assert.ok(long.lines.every((l) => l.length <= 16));
});

test('LCD override and unsupported characters', () => {
  assert.deepEqual(formatLcd('ignored', ['Cold or room', 'temp water?']).lines, ['COLD OR ROOM', 'TEMP WATER?']);
  assert.deepEqual(formatLcd('Café “hot” 😀').lines, ['CAF HOT', '']);
});

test('vibration mapping', () => {
  assert.equal(vibFor('Yes'), 'YES');
  assert.equal(vibFor('No'), 'NO');
  assert.equal(vibFor('No problem.'), 'MSG');
  assert.equal(vibFor("I'll call a doctor."), 'URGENT');
  assert.equal(vibFor('Okay, got it.'), 'ACK');
  assert.equal(vibFor('Hello!'), 'MSG');
});

test('command builder: framed, validated, newline-terminated', () => {
  const cmd = buildCommand(DEFAULT_TEMPLATE, { id: 'A1B2', vib: 'YES', lines: ['YES', ''] });
  assert.equal(cmd, '~MSG|A1B2|YES|YES|\n');
});

test('command builder rejects anything that could reach the single-key command handler', () => {
  assert.throws(() => buildCommand('MSG|{id}', { id: 'A1', vib: 'MSG', lines: ['', ''] }), /start with "~"/);
  assert.throws(() => buildCommand(DEFAULT_TEMPLATE, { id: 'A1', vib: 'MSG', lines: ['HI\nX', ''] }), /Invalid line1/);
  assert.throws(() => buildCommand(DEFAULT_TEMPLATE, { id: 'A1', vib: 'MSG', lines: ['A|B', ''] }), /Invalid line1/);
  assert.throws(() => buildCommand('~{nope}', { id: 'A1', vib: 'MSG', lines: ['', ''] }), /placeholder/);
  assert.equal(validateCommand('~OK'), null);
});

test('ack ids are 4 chars of [0-9A-Z]', () => {
  for (let i = 0; i < 200; i++) assert.match(makeAckId(), /^[0-9A-Z]{4}$/);
});
