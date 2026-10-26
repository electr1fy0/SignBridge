// LCD formatting and haptic codes shared with the unified firmware.
export const LCD_COLS = 16;
export const LCD_ROWS = 2;

/** Upper-case and strip characters a HD44780 / PCF8574 LCD can't show reliably. */
export function lcdSanitize(text) {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,!?'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Word-wrap to 2 x 16. Longer text is truncated with ".." on line 2;
 * the website always keeps the full message.
 * @param {string} text
 * @param {string[]} [override] hand-written [line1, line2] for known replies
 * @returns {{lines:[string,string], truncated:boolean}}
 */
export function formatLcd(text, override) {
  if (override) {
    const [a = '', b = ''] = override.map((l) => lcdSanitize(l).slice(0, LCD_COLS));
    return { lines: [a, b], truncated: false };
  }
  const lines = [];
  let cur = '';
  for (let word of lcdSanitize(text).split(' ').filter(Boolean)) {
    while (word.length > LCD_COLS) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, LCD_COLS));
      word = word.slice(LCD_COLS);
    }
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= LCD_COLS) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);

  if (lines.length <= LCD_ROWS) return { lines: [lines[0] ?? '', lines[1] ?? ''], truncated: false };
  const rest = lines.slice(1).join(' ');
  return { lines: [lines[0], rest.slice(0, LCD_COLS - 2).trimEnd() + '..'], truncated: true };
}

/** Suggested motor patterns, in ms: [on, off, on, …]. Implemented by the unified firmware. */
export const VIBES = {
  ACK: { label: 'Short pulse', meaning: 'Acknowledgment / simple confirmation', pattern: [150] },
  YES: { label: 'Two short pulses', meaning: 'Yes', pattern: [150, 150, 150] },
  NO: { label: 'One long pulse', meaning: 'No', pattern: [800] },
  MSG: { label: 'Three short pulses', meaning: 'Incoming message / attention', pattern: [150, 150, 150, 150, 150] },
  URGENT: { label: 'Long-short repeated ×3', meaning: 'Urgent assistance', pattern: [500, 120, 150, 120, 500, 120, 150, 120, 500, 120, 150] },
};

export function vibFor(text) {
  const t = String(text).trim().toLowerCase();
  if (/\b(help|doctor|emergency|urgent|ambulance)\b/.test(t)) return 'URGENT';
  if (/^(yes|yeah|yep)\b/.test(t)) return 'YES';
  if (/^(no|nope)\b(?!\s+problem)/.test(t)) return 'NO';
  if (/^(okay|ok|got it|sure|done)\b/.test(t)) return 'ACK';
  return 'MSG';
}

/** Unique-enough id that also works outside secure contexts (crypto.randomUUID doesn't on LAN http). */
export function makeUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
