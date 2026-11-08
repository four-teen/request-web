import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import proxy from '../api/proxy.js';
import { workspaceHtml } from '../lib/workspace-html.js';
import { workspacePages, publicLink } from '../public/assets/workspace-routes.js';

test('page links, hash targets, and report forms retain their destinations at public URLs', () => {
  const base = 'https://request.example/api/administrator/';
  const current = 'https://request.example/requests?filter=due';
  assert.equal(publicLink('index.php', base, current), '/dashboard');
  assert.equal(publicLink('manage_request.php?search=sample#results', base, current), '/requests?search=sample#results');
  assert.equal(publicLink('printed_summary.php?year=2026', base, current), '/reports/print?year=2026');
  assert.equal(publicLink('#dialog', base, current), '/requests?filter=due#dialog');
  assert.equal(publicLink('../logout.php', base, current), '../logout.php');
  assert.equal(publicLink('https://other.example/index.php', base, current), 'https://other.example/index.php');
});

test('every public page has a Vercel rewrite to the same PHP screen used in development', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const page of Object.keys(workspacePages)) {
    const rewrite = config.rewrites.find(rule => rule.source === page);
    assert.equal(rewrite?.destination, '/api/proxy?__request_page=' + page.slice(1), page);
  }
  for (const alias of ['/api/administrator', '/api/administrator/']) {
    assert.equal(config.redirects.find(rule => rule.source === alias)?.destination, '/dashboard');
  }
});

test('workspace injection survives split tags and UTF-8 chunks without corrupting content', async () => {
  const original = Buffer.from('<!doctype html><head></head><body>NEÑA</body>');
  const split = original.indexOf(Buffer.from('Ñ')) + 1;
  const chunks = [original.subarray(0, 19), original.subarray(19, split), original.subarray(split)];
  let result = '';
  const buffers = [];
  for await (const chunk of Readable.from(chunks).pipe(workspaceHtml())) buffers.push(chunk);
  result = Buffer.concat(buffers).toString('utf8');
  assert.match(result, /<head><base href="\/api\/administrator\/">/);
  assert.match(result, /src="\/assets\/workspace.js"/);
  assert.ok(result.endsWith('<body>NEÑA</body>'));
});

test('clean pages and Vercel rewrites preserve authentication, form bodies, and redirect destinations', async t => {
  const originalOrigin = process.env.REQUEST_API_ORIGIN;
  const seen = [];
  const backend = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ path: req.url, cookie: req.headers.cookie, body: Buffer.concat(chunks).toString() });
    if (req.url.startsWith('/backend/logout.php')) {
      res.writeHead(302, { Location: 'index.php' });
      return res.end();
    }
    if (!req.headers.cookie) {
      res.writeHead(302, { Location: '../logout.php' });
      return res.end();
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><head></head><body><a href="manage_request.php">Requests</a></body>');
  }).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  process.env.REQUEST_API_ORIGIN = `http://127.0.0.1:${backend.address().port}/backend`;
  const frontend = createServer((req, res) => {
    const url = new URL(req.url, 'http://test');
    req.query = Object.fromEntries(url.searchParams);
    return proxy(req, res);
  }).listen(0, '127.0.0.1');
  await once(frontend, 'listening');
  t.after(async () => {
    if (originalOrigin === undefined) delete process.env.REQUEST_API_ORIGIN;
    else process.env.REQUEST_API_ORIGIN = originalOrigin;
    await Promise.all([new Promise(resolve => frontend.close(resolve)), new Promise(resolve => backend.close(resolve))]);
  });
  const origin = `http://127.0.0.1:${frontend.address().port}`;
  const anonymous = await fetch(origin + '/dashboard', { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/api/logout.php');
  const logout = await fetch(origin + '/api/logout.php', { redirect: 'manual' });
  assert.equal(logout.headers.get('location'), '/');
  for (const [page, backendPath] of Object.entries(workspacePages)) {
    for (const path of [page, '/api/proxy?__request_page=' + page.slice(1)]) {
      const response = await fetch(origin + path, { headers: { Cookie: 'PHPSESSID=fixture' } });
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), /<base href="\/api\/administrator\/">/);
      assert.deepEqual(seen.at(-1), { path: '/backend/' + backendPath, cookie: 'PHPSESSID=fixture', body: '' });
    }
  }
  const report = await fetch(origin + '/reports/print?year=2026', {
    method: 'POST', headers: { Cookie: 'PHPSESSID=fixture' }, body: new URLSearchParams({ program: '2' }),
  });
  assert.equal(report.status, 200);
  await report.body.cancel();
  assert.deepEqual(seen.at(-1), { path: '/backend/administrator/printed_summary.php?year=2026', cookie: 'PHPSESSID=fixture', body: 'program=2' });
  const invalidPage = await fetch(origin + '/api/proxy?__request_page=../config.php');
  assert.equal(invalidPage.status, 404);
});
