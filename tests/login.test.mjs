import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('a quick sign-in reuses the pending session request and opens the public dashboard URL', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const attributes = new Map();
      elements.set(id, {
        value: '', type: id === 'password' ? 'password' : 'text', handlers: {}, style: { setProperty() {} },
        classList: { contains: value => classes.has(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        setAttribute(name, value) { attributes.set(name, value); },
        querySelector() { return { textContent: '' }; }, focus() {},
      });
    }
    return elements.get(id);
  }
  let resolveSession;
  const pendingSession = new Promise(resolve => { resolveSession = resolve; });
  const calls = [];
  const navigation = [];
  const context = {
    document: { getElementById: element }, URLSearchParams,
    window: { innerHeight: 900, addEventListener() {}, location: { assign: path => navigation.push(path) } },
    fetch: (path, options) => {
      calls.push({ path, options });
      return path.endsWith('session.php') ? pendingSession : Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaceUrl: '/api/administrator/' }) });
    },
  };
  vm.runInNewContext(await readFile(new URL('../public/assets/login.js', import.meta.url), 'utf8'), context);
  element('sealButton').handlers.click();
  element('username').value = 'fixture-user';
  element('password').value = 'fixture-password';
  const submitting = element('loginForm').handlers.submit({ preventDefault() {} });
  assert.equal(calls.filter(call => call.path.endsWith('session.php')).length, 1);
  assert.equal(element('loginButton').disabled, true);
  resolveSession({ ok: true, json: async () => ({ csrfToken: 'fixture-csrf', user: null }) });
  await submitting;
  const login = calls.find(call => call.path.endsWith('login.php'));
  assert.equal(login.options.body.get('csrf_token'), 'fixture-csrf');
  assert.equal(login.options.body.get('username'), 'fixture-user');
  assert.deepEqual(navigation, ['/dashboard']);
});
