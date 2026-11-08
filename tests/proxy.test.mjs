import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import proxy, { permittedPath } from '../api/proxy.js';

test('only working PHP routes and static assets can pass through the proxy', () => {
  for (const path of ['auth/session.php', 'auth/login.php', 'administrator', 'administrator/', 'administrator/index.php', 'administrator/overdue_requests.php', 'administrator/query_request.php', 'administrator/record_logs.php', 'administrator/query_record_logs.php', 'assets/vendor/bootstrap/css/bootstrap.min.css', 'profile/default.png']) {
    assert.equal(permittedPath(path), true, path);
  }
  for (const path of ['.env', 'db.php', 'config.php', 'administrator/db.php', 'administrator/header.php', 'administrator/record_log_functions.php', 'deploy/migrate-record-logs.php', 'administrator/log.txt', '../db.php', 'assets/../db.php', 'administrator/index - Copy.php', '/evil.example/auth/login.php', 'assets/secret.php']) {
    assert.equal(permittedPath(path), false, path);
  }
});

test('dashboard aliases redirect to the explicit page and preserve queries and sessions', async t => {
  const originalOrigin = process.env.REQUEST_API_ORIGIN;
  let seen;
  const backend = createServer((req, res) => {
    seen = { url: req.url, cookie: req.headers.cookie };
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>Dashboard</h1>');
  }).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  process.env.REQUEST_API_ORIGIN = `http://127.0.0.1:${backend.address().port}/backend`;
  const frontend = createServer(proxy).listen(0, '127.0.0.1');
  await once(frontend, 'listening');
  t.after(async () => {
    if (originalOrigin === undefined) delete process.env.REQUEST_API_ORIGIN;
    else process.env.REQUEST_API_ORIGIN = originalOrigin;
    await Promise.all([new Promise(resolve => frontend.close(resolve)), new Promise(resolve => backend.close(resolve))]);
  });
  const origin = `http://127.0.0.1:${frontend.address().port}`;
  for (const path of [
    '/api/administrator?tab=pending',
    '/api/administrator/?tab=pending',
    '/api/proxy?__request_path=administrator&tab=pending',
    '/api/proxy?__request_path=administrator%2F&tab=pending',
  ]) {
    const alias = await fetch(origin + path, { redirect: 'manual' });
    assert.equal(alias.status, 307, path);
    assert.equal(alias.headers.get('location'), '/api/administrator/index.php?tab=pending');
    const dashboard = await fetch(origin + alias.headers.get('location'), { headers: { Cookie: 'PHPSESSID=fixture-session' } });
    assert.equal(dashboard.status, 200);
    assert.equal(await dashboard.text(), '<h1>Dashboard</h1>');
    assert.deepEqual(seen, { url: '/backend/administrator/index.php?tab=pending', cookie: 'PHPSESSID=fixture-session' });
  }
  const rejectedMethod = await fetch(origin + '/api/administrator/', { method: 'DELETE', redirect: 'manual' });
  assert.equal(rejectedMethod.status, 405);
});

test('forwards sessions, form data, queries and redirects without following them', async t => {
  const originalOrigin = process.env.REQUEST_API_ORIGIN;
  let seen;
  const backend = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { url: req.url, cookie: req.headers.cookie, csrf: req.headers['x-csrf-token'], body: Buffer.concat(chunks).toString() };
    res.statusCode = 302;
    res.setHeader('Location', 'administrator/');
    res.setHeader('Set-Cookie', ['PHPSESSID=replaced; Domain=backend.example; Path=/backend; HttpOnly; Secure']);
    res.end('redirect');
  }).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  process.env.REQUEST_API_ORIGIN = `http://127.0.0.1:${backend.address().port}/backend`;
  const frontend = createServer((req, res) => {
    if (req.url.includes('parsed=1')) {
      // Vercel provides parsed form bodies, unlike the local raw Node request stream.
      req.body = { username: 'sample', 'document_ids[]': ['1', '2'] };
    }
    return proxy(req, res);
  }).listen(0, '127.0.0.1');
  await once(frontend, 'listening');
  t.after(async () => {
    if (originalOrigin === undefined) delete process.env.REQUEST_API_ORIGIN;
    else process.env.REQUEST_API_ORIGIN = originalOrigin;
    await Promise.all([new Promise(resolve => frontend.close(resolve)), new Promise(resolve => backend.close(resolve))]);
  });
  const origin = `http://127.0.0.1:${frontend.address().port}`;
  const response = await fetch(`${origin}/api/proxy?__request_path=auth/login.php&filter=due`, {
    method: 'POST',
    headers: { Cookie: 'PHPSESSID=original', 'X-CSRF-Token': 'csrf-token' },
    body: new URLSearchParams({ username: 'sample', password: 'test-only' }),
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'administrator/');
  assert.match(response.headers.get('set-cookie'), /PHPSESSID=replaced/);
  assert.match(response.headers.get('set-cookie'), /Path=\//);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=|Path=\/backend/i);
  assert.deepEqual(seen, { url: '/backend/auth/login.php?filter=due', cookie: 'PHPSESSID=original', csrf: 'csrf-token', body: 'username=sample&password=test-only' });
  assert.equal((await fetch(`${origin}/api/proxy?__request_path=..%2Fdb.php`)).status, 404);
  assert.equal((await fetch(`${origin}/api/auth/login.php`, { method: 'DELETE' })).status, 405);
  const parsed = await fetch(`${origin}/api/auth/login.php?parsed=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'unused', redirect: 'manual',
  });
  assert.equal(parsed.status, 302);
  assert.equal(seen.body, 'username=sample&document_ids%5B%5D=1&document_ids%5B%5D=2');
  process.env.REQUEST_API_ORIGIN = 'https://user:embedded-test-secret@backend.example/';
  const invalid = await fetch(`${origin}/api/auth/session.php`);
  assert.equal(invalid.status, 503);
  assert.doesNotMatch(await invalid.text(), /embedded-test-secret/);
});
