// Free speech-to-text through the browser's built-in recognizer (Web Speech API). No key or
// cost, but the browser decides how it runs: Chrome sends audio to Google's service, so it
// needs internet, and browsers only open the microphone on secure pages (https or localhost).

/** @returns {{Recognition: Function|null, secure: boolean}} */
export function dictationSupport(win = globalThis) {
  return {
    Recognition: win.SpeechRecognition || win.webkitSpeechRecognition || null,
    secure: Boolean(win.isSecureContext),
  };
}

/** Plain-language explanation for a recognizer error code (or 'unsupported' / 'insecure'). */
export function dictationMessage(code) {
  switch (code) {
    case 'unsupported':
      return "This browser has no built-in speech recognition. Use Chrome, Edge or Safari, or tap the microphone on your phone's keyboard.";
    case 'insecure':
      return "The browser blocked the microphone because the glove's page is plain http. Tap the microphone on your phone's keyboard instead, or in Chrome allow http://192.168.4.1 under chrome://flags/#unsafely-treat-insecure-origin-as-secure.";
    case 'not-allowed':
    case 'service-not-allowed':
      return "Microphone permission was denied. Allow it in the browser's site settings, or use the keyboard's microphone.";
    case 'network':
      return "This browser's speech recognition needs internet, and the glove's Wi-Fi has none. Use the keyboard's microphone, or give this device internet as well.";
    case 'no-speech':
      return 'No speech heard. Press Speak and try again.';
    case 'audio-capture':
      return 'No microphone was found on this device.';
    default:
      return "Speech recognition stopped. Try again, or use the keyboard's microphone.";
  }
}
