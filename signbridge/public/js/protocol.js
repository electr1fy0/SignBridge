// Outgoing glove protocol (PROPOSED — not implemented by the current sketches),
// 16x2 LCD formatting and vibration pattern mapping. Pure module.
//
// WHY THIS IS OFF BY DEFAULT: both current sketches read serial one byte at a time
// and treat single characters as commands — '1'..'8' start (blocking) training,
// 'c' recalibrates, 's' prints status, and 'X' ERASES ALL TRAINED GESTURES.
// Sending any text such as "MSG|YES" to unmodified firmware would trigger those.
// The app only writes messages after the user confirms the firmware implements
// the framed "~" protocol documented in docs/FIRMWARE_PROTOCOL.md.

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

/** Suggested motor patterns, in ms: [on, off, on, …]. Firmware must implement these. */
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

export const DEFAULT_TEMPLATE = '~MSG|{id}|{vib}|{line1}|{line2}';
const FIELD_OK = /^[A-Z0-9 .,!?'-]*$/;

/** @returns {string|null} a human-readable problem, or null if the command is safe to send. */
export function validateCommand(cmd) {
  if (!cmd.startsWith('~')) return 'Command must start with "~" so updated firmware can tell it apart from single-key commands.';
  if (/[\r\n]/.test(cmd)) return 'Command must be a single line.';
  if (!/^[\x20-\x7E]+$/.test(cmd)) return 'Command must be printable ASCII.';
  if (cmd.length > 96) return 'Command is too long (max 96 characters).';
  if (/[{}]/.test(cmd)) return 'Template contains an unknown placeholder.';
  return null;
}

/** Fill the template and validate. Throws on anything unsafe. Returns the line incl. "\n". */
export function buildCommand(template, { id, vib, lines }) {
  const fields = { id, vib, line1: lines[0] ?? '', line2: lines[1] ?? '' };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'string' || !FIELD_OK.test(v)) throw new Error(`Invalid ${k} field`);
  }
  const cmd = String(template).replace(/\{(id|vib|line1|line2)\}/g, (_, k) => fields[k]);
  const problem = validateCommand(cmd);
  if (problem) throw new Error(problem);
  return cmd + '\n';
}

/** Short hardware ACK id: 4 chars [0-9A-Z]. */
export function makeAckId() {
  return Math.floor(Math.random() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
}

/** Unique-enough id that also works outside secure contexts (crypto.randomUUID doesn't on LAN http). */
export function makeUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
