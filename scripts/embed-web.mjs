// Embed the dependency-free browser application and the gesture phrase table in
// the single flashable sketch.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'signbridge/public');
const seen = new Set();
async function bundle(file) {
  if (seen.has(file)) return '';
  seen.add(file);
  const source = await readFile(file, 'utf8');
  let output = '', offset = 0;
  for (const match of source.matchAll(/^import\s+.*?\s+from\s+['"](.+?)['"];?\s*$/gm)) {
    output += source.slice(offset, match.index);
    output += await bundle(path.resolve(path.dirname(file), match[1]));
    offset = match.index + match[0].length;
  }
  return output + source.slice(offset).replace(/^export /gm, '') + '\n';
}
let html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
const css = await readFile(path.join(publicDir, 'css/index.css'), 'utf8');
const js = await bundle(path.join(publicDir, 'js/app.js'));
html = html.replace('<link rel="stylesheet" href="css/index.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="js/app.js"></script>', `<script type="module">\n${js}</script>`);
if (html.includes(')SBWEB"')) throw new Error('HTML conflicts with firmware raw string delimiter.');
// The firmware's gesture enum and LCD phrase table come from the same data the website uses.
const { GESTURES, ENVIRONMENTS } = await import(new URL('../signbridge/public/js/gestures.js', import.meta.url));
const { formatLcd, lcdSanitize } = await import(new URL('../signbridge/public/js/protocol.js', import.meta.url));
const keys = Object.keys(GESTURES);
const quote = (text) => `"${text}"`;
const lcdRows = ENVIRONMENTS.map((env) => '  {' + keys.map((key) => {
  const phrase = env.phrases[key];
  if (!phrase) throw new Error(`${env.id} has no phrase for ${key}.`);
  const lcd = formatLcd(phrase.text, phrase.lcd);
  if (lcd.truncated) throw new Error(`"${phrase.text}" does not fit the LCD; add lcd: [line1, line2].`);
  return `{${lcd.lines.map(quote).join(', ')}}`;
}).join(', ') + '}');
const gestureTable = [
  '// BEGIN GENERATED GESTURES',
  `enum Gesture : int { ${keys.map((key) => `G_${key}`).join(', ')}, GESTURE_N };`,
  `constexpr int ENV_N = ${ENVIRONMENTS.length};`,
  `const char* gestureNames[GESTURE_N] = {${keys.map(quote).join(', ')}};`,
  `const char* envIds[ENV_N] = {${ENVIRONMENTS.map((env) => quote(env.id)).join(', ')}};`,
  `const char* envLcd[ENV_N] = {${ENVIRONMENTS.map((env) => quote(lcdSanitize(`${env.name} mode`).slice(0, 16))).join(', ')}};`,
  'const char* phraseLcd[ENV_N][GESTURE_N][2] = {',
  lcdRows.join(',\n'),
  '};',
  '// END GENERATED GESTURES',
].join('\n');
const firmware = path.join(root, 'firmware/SignBridge/SignBridge.ino');
let source = await readFile(firmware, 'utf8');
const generated = `// BEGIN GENERATED WEB\nconst char WEB_PAGE[] PROGMEM = R"SBWEB(${html})SBWEB";\n// END GENERATED WEB`;
source = source.replace(/\/\/ BEGIN GENERATED WEB[\s\S]*?\/\/ END GENERATED WEB/, () => generated)
  .replace(/\/\/ BEGIN GENERATED GESTURES[\s\S]*?\/\/ END GENERATED GESTURES/, () => gestureTable);
if (process.argv.includes('--check')) {
  if (source !== await readFile(firmware, 'utf8')) throw new Error('Embedded website is stale. Run npm run embed.');
} else await writeFile(firmware, source);
console.log(`Embedded web app: ${Buffer.byteLength(html)} bytes (${gzipSync(html).length} bytes gzip equivalent).`);
