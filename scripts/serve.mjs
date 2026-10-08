import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const prefix = process.env.PREVIEW_PREFIX ?? '/r/review/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
const port = Number(process.env.PORT ?? 4175);
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === prefix.slice(0, -1)) { response.writeHead(302, { Location: prefix }); response.end(); return; }
    const nested = path.startsWith(prefix);
    const relative = (nested ? path.slice(prefix.length) : path.slice(1)) || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    if (process.env.SANDBOX_PREVIEW === '1') response.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-popups allow-forms allow-modals');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`OUR-SLAM preview: http://127.0.0.1:${port}${prefix}\nStandalone: http://127.0.0.1:${port}/`));
