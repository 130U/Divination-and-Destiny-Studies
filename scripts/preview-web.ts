import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const assets = new Map([['index.html','text/html; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['browser.js','text/javascript; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['LICENSE','text/plain; charset=utf-8'],['THIRD_PARTY_NOTICES.md','text/plain; charset=utf-8'],['THIRD_PARTY_LICENSES.txt','text/plain; charset=utf-8']]);
const port = Number(process.env.PORT ?? 3213);
createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.replace(/^\/Divination-and-Destiny-Studies/, '');
  const name = path === '/' ? 'index.html' : path.slice(1), type = assets.get(name);
  if (request.method !== 'GET' || !type) { response.writeHead(404); response.end('Not found'); return; }
  try { const data = await readFile(new URL('../dist/' + name, import.meta.url)); response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(data); }
  catch { response.writeHead(404); response.end('Build the web app first.'); }
}).listen(port, '127.0.0.1', () => console.log('Browser-only preview: http://127.0.0.1:' + port + '/Divination-and-Destiny-Studies/'));
