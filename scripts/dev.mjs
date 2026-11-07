import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import proxy from '../api/proxy.js';

process.env.REQUEST_API_ORIGIN ||= 'http://127.0.0.1:8016';
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const port = Number(process.env.REQUEST_WEB_PORT || 5178);
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(req, res);
  try {
    const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep)) {
      res.statusCode = 404;
      return res.end('Not found.');
    }
    const content = await readFile(path);
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('Not found.');
  }
}).listen(port, '127.0.0.1', () => console.log(`reQuest: http://127.0.0.1:${port}`));
