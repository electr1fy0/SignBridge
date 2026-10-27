import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictationSupport, dictationMessage } from '../public/js/dictation.js';

test('speech recognition is detected from either constructor name', () => {
  class Recognizer {}
  assert.equal(dictationSupport({ webkitSpeechRecognition: Recognizer, isSecureContext: false }).Recognition, Recognizer);
  assert.deepEqual(dictationSupport({}), { Recognition: null, secure: false });
  assert.equal(dictationSupport({ SpeechRecognition: Recognizer, isSecureContext: true }).secure, true);
});

test('every failure explains a free fallback', () => {
  for (const code of ['unsupported', 'insecure', 'not-allowed', 'network', 'no-speech', 'audio-capture', 'aborted']) {
    assert.ok(dictationMessage(code).length > 20, code);
  }
  assert.match(dictationMessage('insecure'), /keyboard/);
  assert.match(dictationMessage('network'), /internet/);
});
