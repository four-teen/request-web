import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import proxy from '../api/proxy.js';

test('streams the first upstream chunk before the report finishes', async t => {
  const originalOrigin = process.env.REQUEST_API_ORIGIN;
  let release;
  const finish = new Promise(resolve => { release = resolve; });
  const backend = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.write('<p>first chunk</p>');
    await finish;
    res.end('x'.repeat(5 * 1024 * 1024));
  }).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  process.env.REQUEST_API_ORIGIN = `http://127.0.0.1:${backend.address().port}`;
  const frontend = createServer(proxy).listen(0, '127.0.0.1');
  await once(frontend, 'listening');
  t.after(async () => {
    release();
    if (originalOrigin === undefined) delete process.env.REQUEST_API_ORIGIN;
    else process.env.REQUEST_API_ORIGIN = originalOrigin;
    await Promise.all([new Promise(resolve => frontend.close(resolve)), new Promise(resolve => backend.close(resolve))]);
  });
  const response = await fetch(`http://127.0.0.1:${frontend.address().port}/api/administrator/printed_summary.php`, { signal: AbortSignal.timeout(5000) });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), '<p>first chunk</p>');
  release();
  let size = first.value.length;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
  }
  assert.ok(size > 5 * 1024 * 1024);
});