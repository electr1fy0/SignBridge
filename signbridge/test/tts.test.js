import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextToSpeechManager } from '../public/js/tts.js';
test('speech prefers an installed English voice on the internet-free glove network', (context) => {
  const saved = Object.fromEntries(['window', 'localStorage', 'SpeechSynthesisUtterance'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let spoken;
  const voices = [{ name:'Google US English', lang:'en-US', localService:false }, { name:'Microsoft David', lang:'en-US', localService:true }];
  globalThis.window = { speechSynthesis: { getVoices: () => voices, speak: (message) => { spoken = message; }, cancel: () => {} } };
  globalThis.localStorage = { getItem: () => null };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text=text; } };
  context.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const voice = new TextToSpeechManager();
  assert.equal(voice.speak('Water'), true);
  assert.equal(spoken.voice.name, 'Microsoft David'); assert.equal(spoken.voice.localService, true);
});
