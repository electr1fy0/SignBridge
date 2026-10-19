// Serial line parsing. Pure module: no DOM, no Web Serial — testable with `node --test`.
//
// The ESP32 sends plain text. Only lines of the exact form
//     >>> RECOGNIZED: SIGN_NAME <<<
// are official recognition events. Sketch A's live-readings block also prints
// `RECOGNIZED: OKAY` / `RECOGNIZED: NONE` WITHOUT the >>> <<< delimiters; those
// are diagnostics and must never be translated or spoken.

const MAX_PARTIAL = 4096; // a "line" longer than this without a newline is garbage

/** Accumulates arbitrary serial chunks and returns only complete lines. */
export class LineBuffer {
  #partial = '';

  /** @param {string} chunk @returns {string[]} complete lines (without terminators) */
  push(chunk) {
    this.#partial += chunk;
    // Handles \r\n, \n and bare \r. A \r\n split across two chunks yields one
    // extra empty line, which parseLine ignores — it never duplicates content.
    const parts = this.#partial.split(/\r\n|\r|\n/);
    this.#partial = parts.pop() ?? '';
    if (this.#partial.length > MAX_PARTIAL) this.#partial = '';
    return parts;
  }

  reset() {
    this.#partial = '';
  }
}

const OFFICIAL = /^>>>\s*RECOGNIZED:\s*(.*?)\s*<<<$/;
const FIVE = /^(FLEX|DELTA)\s*\(T I M R P\):\s*(.+)$/;
const AXES = /^(ACC|GYRO):\s*X=(\S+)\s+Y=(\S+)\s+Z=(\S+)$/;

function fiveNumbers(text) {
  const nums = text.split('|').map((s) => Number(s.trim()));
  return nums.length === 5 && nums.every(Number.isFinite) ? nums : null;
}

/**
 * Classify one complete line.
 * @returns {null | {type:string, [k:string]:any}}
 *   recognition | live | status | live-toggle | sketch | ack | log
 */
export function parseLine(raw) {
  const line = String(raw).trim();
  if (!line) return null;

  let m = OFFICIAL.exec(line);
  if (m) {
    const sign = m[1].trim();
    if (!sign || sign.toUpperCase() === 'NONE') return { type: 'log', text: line };
    return { type: 'recognition', sign };
  }

  // Undelimited RECOGNIZED: … is a live diagnostic reading, never an event.
  if (line.startsWith('RECOGNIZED:')) {
    return { type: 'live', key: 'recognized', value: line.slice('RECOGNIZED:'.length).trim() };
  }

  m = FIVE.exec(line);
  if (m) {
    const values = fiveNumbers(m[2]);
    if (values) return { type: 'live', key: m[1] === 'FLEX' ? 'flex' : 'delta', value: values };
  }

  m = /^BENT PATTERN:\s*([01]{5})$/.exec(line);
  if (m) return { type: 'live', key: 'pattern', value: m[1] };

  m = AXES.exec(line);
  if (m) {
    const value = [m[2], m[3], m[4]].map(Number);
    if (value.every(Number.isFinite)) return { type: 'live', key: m[1] === 'ACC' ? 'acc' : 'gyro', value };
  }

  m = /^STATUS:\s*MPU=(\w+)\s+LCD=(\w+)$/.exec(line);
  if (m) return { type: 'status', mpu: m[1], lcd: m[2] };

  // Sketch B startup banner: " Motion sensor: OK" / "NOT FOUND"
  m = /^Motion sensor:\s*(.+)$/.exec(line);
  if (m) return { type: 'status', mpu: m[1].trim() === 'OK' ? 'OK' : 'FAIL' };

  m = /^Live readings:\s*(ON|OFF)$/i.exec(line);
  if (m) return { type: 'live-toggle', on: m[1].toUpperCase() === 'ON' };

  // Proposed firmware acknowledgement (see docs/FIRMWARE_PROTOCOL.md). Not sent by current sketches.
  m = /^ACK\|([A-Z0-9]{1,8})$/.exec(line);
  if (m) return { type: 'ack', id: m[1] };

  if (line.includes('DIFFERENCE-BASED DETECTION')) return { type: 'sketch', sketch: 'A' };
  if (line.includes('MOTION GLOVE (MPU6500 ONLY)')) return { type: 'sketch', sketch: 'B' };

  return { type: 'log', text: line };
}
