// Optional desktop preview. The glove serves this UI itself after flashing.
// Set SIGNBRIDGE_DEVICE=http://192.168.4.1 to proxy a real glove during UI work.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export function createPreviewServer(deviceUrl = process.env.SIGNBRIDGE_DEVICE) {
  const device = deviceUrl ? new URL(deviceUrl) : null;
  if (device && (device.protocol !== 'http:' || device.username || device.password)) throw new Error('SIGNBRIDGE_DEVICE must be an http:// device address without credentials.');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!device) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Preview only. Connect to the glove Wi-Fi and open http://192.168.4.1, or set SIGNBRIDGE_DEVICE.' })); return; }
      const upstream = http.request(new URL(req.url, device), { method: req.method, headers: { ...req.headers, host: device.host }, timeout: 5000 }, (response) => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Glove unavailable'); });
      req.pipe(upstream); return;
    }
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end('Invalid path'); return; }
    const file = path.resolve(PUBLIC_DIR, `.${decoded === '/' ? '/index.html' : decoded}`);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.stat(file, (error, stats) => {
      if (error || !stats.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !device) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const upstream = http.request(new URL('/ws', device), { headers: { ...req.headers, host: device.host }, timeout: 5000 });
    upstream.on('upgrade', (response, remote, remoteHead) => {
      upstream.setTimeout(0);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      socket.pipe(remote); remote.pipe(socket);
      socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
      socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.end();
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3050;
  createPreviewServer().listen(port, '0.0.0.0', () => console.log(`SignBridge preview: http://localhost:${port}${process.env.SIGNBRIDGE_DEVICE ? ` (glove: ${process.env.SIGNBRIDGE_DEVICE})` : ' (no glove connected)'}`));
}
