// Embed the dependency-free browser application in the single flashable sketch.
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
const firmware = path.join(root, 'firmware/SignBridge/SignBridge.ino');
let source = await readFile(firmware, 'utf8');
const generated = `// BEGIN GENERATED WEB\nconst char WEB_PAGE[] PROGMEM = R"SBWEB(${html})SBWEB";\n// END GENERATED WEB`;
source = source.replace(/\/\/ BEGIN GENERATED WEB[\s\S]*?\/\/ END GENERATED WEB/, () => generated);
if (process.argv.includes('--check')) {
  if (source !== await readFile(firmware, 'utf8')) throw new Error('Embedded website is stale. Run npm run embed.');
} else await writeFile(firmware, source);
console.log(`Embedded web app: ${Buffer.byteLength(html)} bytes (${gzipSync(html).length} bytes gzip equivalent).`);
