// Read-only readiness checks. Never print credentials, cookies, tokens, or account data.
const argumentsList = process.argv.slice(2);
const settings = {
  api: process.env.REQUEST_API_ORIGIN || 'http://127.0.0.1:8016',
  web: `http://127.0.0.1:${process.env.REQUEST_WEB_PORT || 5178}`,
};

try {
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]?.replace(/^--/, '');
    if (!['api', 'web'].includes(key) || !argumentsList[index + 1]) {
      throw new Error('Usage: npm run health -- --api HTTPS_API_BASE --web HTTPS_FRONTEND_BASE');
    }
    settings[key] = argumentsList[index + 1];
  }
  for (const key of Object.keys(settings)) {
    const base = new URL(settings[key]);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('Use HTTP(S) base URLs without credentials, query strings, or fragments.');
    }
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    settings[key] = base;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function report(label, ok, details) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${details}`);
  if (!ok) process.exitCode = 1;
}

function failureLabel(error) {
  const code = error.cause?.code || error.code || error.name;
  if (/TIMEOUT|Timeout|Abort/.test(code)) return 'connection timed out';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'DNS lookup failed';
  if (/CERT|TLS|SSL|ISSUER/.test(code)) return 'HTTPS certificate validation failed';
  return `connection failed (${code})`;
}

async function checkSession(label, url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const type = response.headers.get('content-type') || '';
    if (response.status !== 200 || !type.includes('application/json')) {
      await response.body?.cancel();
      report(label, false, `HTTP ${response.status}, ${type || 'no content type'}; expected HTTP 200 JSON. Check PHP configuration, public directory permissions, and rewrite rules.`);
      return;
    }
    const data = await response.json();
    if (typeof data.csrfToken !== 'string' || !data.csrfToken || !Object.hasOwn(data, 'user') || data.workspaceUrl !== '/api/administrator/') {
      report(label, false, 'JSON does not contain a usable reQuest session. Check PHP sessions and the configured API path.');
      return;
    }
    const cookie = response.headers.getSetCookie().find(value => /^PHPSESSID=/i.test(value))?.split(';')[0];
    if (!cookie) {
      report(label, false, 'PHP session cookie is missing. Check PHP sessions and proxy cookie forwarding.');
      return;
    }
    const repeat = await fetch(url, { headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const repeatData = await repeat.json().catch(() => null);
    const persisted = repeat.status === 200 && repeatData?.csrfToken === data.csrfToken;
    report(label, persisted, persisted ? 'database-backed JSON session and session persistence work' : 'session was not preserved between requests');
  } catch (error) {
    report(label, false, failureLabel(error));
  }
}

async function checkAsset(label, url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const type = response.headers.get('content-type') || '';
    const ok = response.status === 200 && /^image\/png(?:;|$)/i.test(type);
    await response.body?.cancel();
    report(label, ok, ok ? 'public API assets are reachable' : `HTTP ${response.status}, ${type || 'no content type'}; expected a PNG. Check deployment, directory permissions, and parent rewrite rules.`);
  } catch (error) {
    report(label, false, failureLabel(error));
  }
}

if (!process.exitCode) {
  await Promise.all([
    checkSession('Direct API session', new URL('auth/session.php', settings.api)),
    checkSession('Frontend proxy session', new URL('api/auth/session.php', settings.web)),
    checkAsset('Direct API asset', new URL('assets/img/request-logo.png', settings.api)),
    checkAsset('Frontend proxy asset', new URL('api/assets/img/request-logo.png', settings.web)),
  ]);
}
