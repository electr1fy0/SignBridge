// Sign catalogue for the two firmware sketches, translation to display English,
// and contextual reply suggestions. Pure module.

/** Signs the CURRENT firmware can actually recognise. Keys match the firmware's phrases[] exactly. */
export const SIGNS = {
  // Sketch A — finger patterns (T I M R P, 1 = bent)
  OKAY: { text: 'Okay', sketch: 'A', cmd: 1, pattern: '11000', how: 'Thumb and index form a circle; other fingers open' },
  WATER: { text: 'Water', sketch: 'A', cmd: 2, pattern: '10001', how: 'Thumb and pinky bent; remaining fingers open' },
  TWO: { text: 'Two', sketch: 'A', cmd: 3, pattern: '10011', how: 'Index and middle raised in a V' },
  THREE: { text: 'Three', sketch: 'A', cmd: 4, pattern: '00011', how: 'Thumb, index and middle extended' },
  FOUR: { text: 'Four', sketch: 'A', cmd: 5, pattern: '10000', how: 'Four fingers raised, thumb folded' },
  SEVEN: { text: 'Seven', sketch: 'A', cmd: 6, pattern: '10010', how: 'Thumb touches ring fingertip' },
  // Sketch B — motion (MPU6500, open flat hand)
  HELLO: { text: 'Hello!', sketch: 'B', cmd: 1, how: 'Flat hand at forehead, salute outward' },
  BYE: { text: 'Bye!', sketch: 'B', cmd: 2, how: 'Open hand waving side to side' },
  'THANK YOU': { text: 'Thank you', sketch: 'B', cmd: 3, how: 'Fingertips at chin, forward and down once' },
  PLEASE: { text: 'Please', sketch: 'B', cmd: 4, how: 'Flat hand on chest, rub in a circle' },
  HAPPY: { text: 'Happy', sketch: 'B', cmd: 5, how: 'Flat hand on chest, brush upward twice' },
  'COME HERE': { text: 'Come here', sketch: 'B', cmd: 6, how: 'Palm up, curl hand toward you 2–3 times' },
  'SLOW DOWN': { text: 'Slow down', sketch: 'B', cmd: 7, how: 'Palm down, pat downward 2–3 times' },
  FINISHED: { text: 'Finished', sketch: 'B', cmd: 8, how: 'Palm facing you, flip to face outward' },
};

export const SKETCH_NAMES = {
  A: 'Sketch A · Finger signs',
  B: 'Sketch B · Motion signs',
};

/** "thank_you", " Thank  You " → "THANK YOU". Changes formatting only, never meaning. */
export function normalizeSignName(raw) {
  return String(raw).trim().toUpperCase().replace(/[_\s]+/g, ' ');
}

function sentenceCase(key) {
  const lower = key.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** @returns {{key:string, text:string, known:boolean, sketch:'A'|'B'|null}} */
export function translate(rawSign) {
  const key = normalizeSignName(rawSign);
  const sign = SIGNS[key];
  return { key, text: sign ? sign.text : sentenceCase(key), known: Boolean(sign), sketch: sign?.sketch ?? null };
}

// Replies may be plain strings or {text, lcd:[line1, line2]} when the auto LCD wrap would be ugly.
const SIGN_REPLIES = {
  OKAY: ['Great!', 'Okay, got it.', 'Anything else?', 'Are you sure?'],
  WATER: ["I'll get you some water.", { text: 'Cold or room-temperature water?', lcd: ['COLD OR ROOM', 'TEMP WATER?'] }, 'Here you go!'],
  TWO: ['Two, got it.', 'Two of what?', 'Did you mean two?'],
  THREE: ['Three, got it.', 'Three of what?', 'Did you mean three?'],
  FOUR: ['Four, got it.', 'Four of what?', 'Did you mean four?'],
  SEVEN: ['Seven, got it.', 'Seven of what?', 'Did you mean seven?'],
  HELLO: ['Hello!', 'How are you?', 'Nice to meet you!', 'What do you need?'],
  BYE: ['Goodbye!', 'See you later!', 'Take care!'],
  'THANK YOU': ["You're welcome!", 'Happy to help.', 'Anytime!'],
  PLEASE: ['Of course.', 'What do you need?', 'Sure, one moment.'],
  HAPPY: ["That's great!", "I'm happy too!", 'What made you happy?'],
  'COME HERE': ['Coming!', 'Give me a minute', 'Is everything okay?'],
  'SLOW DOWN': ["Sorry, I'll slow down.", 'Should I repeat that?', 'Yes'],
  FINISHED: ['Great job!', 'Anything else?', 'Shall we go?'],
};

export const DEFAULT_REPLIES = ['Yes', 'No', 'Give me a minute', 'Please repeat that.'];

export function repliesFor(key) {
  return SIGN_REPLIES[normalizeSignName(key)] ?? DEFAULT_REPLIES;
}

/** Normalise a reply entry to {text, lcd?}. */
export function replyItem(entry) {
  return typeof entry === 'string' ? { text: entry } : entry;
}
