import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTURES, ENVIRONMENTS, meaning, normalizeGesture } from '../public/js/gestures.js';
import { formatLcd } from '../public/js/protocol.js';

test('every environment gives every gesture a phrase that fits the LCD', () => {
  assert.equal(Object.keys(GESTURES).length, 12);
  for (const env of ENVIRONMENTS) {
    assert.deepEqual(Object.keys(env.phrases).sort(), Object.keys(GESTURES).sort(), env.id);
    for (const [key, phrase] of Object.entries(env.phrases)) {
      assert.equal(formatLcd(phrase.text, phrase.lcd).truncated, false, `${env.id} ${key}`);
      assert.ok(phrase.replies.length > 0, `${env.id} ${key} replies`);
    }
  }
});

test('the same gesture changes meaning with the environment', () => {
  assert.equal(meaning('FIST', 'everyday').text, 'Yes.');
  assert.equal(meaning('FIST', 'hospital').text, 'I am in pain.');
  assert.equal(meaning('fist', 'market').text, "Yes, I'll buy it.");
  assert.equal(meaning('SHAKE', 'restaurant').urgent, true);
});

test('unknown gestures and environments fall back safely', () => {
  assert.equal(meaning('WAVE', 'moon').env, 'Everyday');
  assert.deepEqual(
    { known: meaning('NEW_SIGN', 'everyday').known, text: meaning('NEW_SIGN', 'everyday').text },
    { known: false, text: 'NEW SIGN' },
  );
  assert.equal(normalizeGesture('  fist '), 'FIST');
});
