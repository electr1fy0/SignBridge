// Web Speech API (Text-to-Speech) manager.
// Handles English voice selection, queue management, mute/unmute, replay, and user-activation unlocks.

export class TextToSpeechManager {
  #synth = null;
  #voice = null;
  #muted = false;
  #lastSpokenText = '';
  #onStateChange = null;
  #onError = null;
  #unlocked = false;

  constructor({ onStateChange, onError } = {}) {
    this.#onStateChange = onStateChange || (() => {});
    this.#onError = onError || (() => {});
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.#synth = window.speechSynthesis;
      this.#muted = localStorage.getItem('signbridge_muted') === 'true';
      this.#loadVoices();
      if (this.#synth.onvoiceschanged !== undefined) {
        this.#synth.onvoiceschanged = () => this.#loadVoices();
      }
    }
  }

  isSupported() {
    return Boolean(this.#synth);
  }

  isMuted() {
    return this.#muted;
  }

  isUnlocked() {
    return this.#unlocked;
  }

  getLastSpokenText() {
    return this.#lastSpokenText;
  }

  #loadVoices() {
    if (!this.#synth) return;
    const voices = this.#synth.getVoices();
    if (!voices || voices.length === 0) return;

    // Preference: English natural voices, en-US / en-GB
    const englishVoices = voices.filter((v) => v.lang.startsWith('en'));
    // The glove's access point has no internet. Prefer installed voices over
    // network voices even when a remote voice sounds more natural.
    const localVoices = englishVoices.filter((v) => v.localService);
    const candidates = localVoices.length ? localVoices : englishVoices;
    const preferred = candidates.find((v) =>
      /natural|google|samantha|karen|daniel|moira/i.test(v.name)
    ) || candidates[0] || voices[0];

    this.#voice = preferred;
    this.#notifyState();
  }

  #notifyState() {
    this.#onStateChange({
      supported: this.isSupported(),
      muted: this.#muted,
      voiceName: this.#voice ? this.#voice.name : 'Default',
      lastText: this.#lastSpokenText,
      unlocked: this.#unlocked,
    });
  }

  toggleMute() {
    this.#muted = !this.#muted;
    localStorage.setItem('signbridge_muted', String(this.#muted));
    if (this.#muted && this.#synth) {
      this.#synth.cancel();
    }
    this.#notifyState();
    return this.#muted;
  }

  /**
   * Unlock speech synthesis on browsers that require user gesture activation.
   * Plays a silent utterance or brief confirmation.
   */
  unlock() {
    if (!this.#synth) return;
    this.#unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0.01;
      this.#synth.speak(u);
    } catch (e) {
      console.warn('[TTS] Unlock attempt:', e);
    }
    this.#notifyState();
  }

  /**
   * Speak a phrase aloud immediately. Cancels any stale pending speech to prevent backlog.
   * If speech fails or is muted, returns false without throwing so UI translation is never delayed.
   */
  speak(text) {
    if (!text || typeof text !== 'string') return false;
    this.#lastSpokenText = text;
    this.#notifyState();

    if (!this.#synth || this.#muted) return false;

    try {
      // Clear backlog so new signs are heard without stale delay
      this.#synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      if (this.#voice) {
        utterance.voice = this.#voice;
      }
      utterance.lang = 'en-US';
      utterance.rate = 0.95; // Slightly measured rate for clear assistive audio
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onerror = (err) => {
        // SpeechSynthesis interrupted or cancelled is expected when new signs arrive
        if (err.error !== 'interrupted' && err.error !== 'canceled') {
          console.warn('[TTS] Speech error:', err);
          this.#onError('Voice could not play. Check audio or install an offline English voice on this device.');
        }
      };

      this.#synth.speak(utterance);
      this.#unlocked = true;
      this.#notifyState();
      return true;
    } catch (err) {
      console.warn('[TTS] Speak failed:', err);
      return false;
    }
  }

  /** Replay the last spoken text */
  replay() {
    if (this.#lastSpokenText) {
      this.speak(this.#lastSpokenText);
    }
  }
}
