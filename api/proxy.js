import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { workspacePages, workspaceUrl } from '../public/assets/workspace-routes.js';
import { workspaceHtml } from '../lib/workspace-html.js';

const adminPages = new Set([
  'index.php', 'manage_request.php', 'overdue_requests.php', 'document_type.php', 'released_summary.php',
  'statistics_summary.php', 'manage_programs.php', 'manage_assigned_faculty.php',
  'print_summary.php', 'printed_summary.php', 'query_request.php', 'query_programs.php',
  'query_assigned.php', 'query_print_report.php', 'get_remarks.php', 'get_doc_request_stats.php',
  'record_logs.php', 'query_record_logs.php',
]);

export function permittedPath(path) {
  if (path.includes('\\') || path.split('/').some(part => part === '..' || part === '.') || /[\x00-\x20]/.test(path)) return false;
  if (['', 'index.php', 'logout.php', 'verify.php', 'auth/session.php', 'auth/login.php', 'administrator', 'administrator/'].includes(path)) return true;
  if (path.startsWith('administrator/')) return adminPages.has(path.slice('administrator/'.length));
  return /^(assets|dist|profile)\/[\w./-]+\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(path);
}

export default async function proxy(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const incoming = new URL(req.url, 'http://request.local');
  let path;
  let publicPage;
  try {
    const pageParameter = req.query?.__request_page ?? incoming.searchParams.get('__request_page');
    publicPage = pageParameter == null ? incoming.pathname : '/' + String(pageParameter).replace(/^\//, '');
    if (pageParameter != null && !Object.hasOwn(workspacePages, publicPage)) {
      res.statusCode = 404;
      return res.end('Not found.');
    }
    path = Object.hasOwn(workspacePages, publicPage)
      ? workspacePages[publicPage]
      : decodeURIComponent(String(req.query?.__request_path ?? incoming.searchParams.get('__request_path') ?? incoming.pathname.replace(/^\/api\/?/, '')));
  } catch {
    res.statusCode = 400;
    return res.end('Invalid backend path.');
  }
  if (!permittedPath(path)) {
    res.statusCode = 404;
    return res.end('Not found.');
  }
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD, POST');
    return res.end('Method not allowed.');
  }
  incoming.searchParams.delete('__request_path');
  incoming.searchParams.delete('__request_page');
  const cleanUrl = workspaceUrl(path);
  // Preserve old bookmarks, including the directory URL that Vercel cannot serve.
  if (cleanUrl && !Object.hasOwn(workspacePages, publicPage)) {
    res.statusCode = 307;
    res.setHeader('Location', cleanUrl + incoming.search);
    return res.end();
  }
  const origin = process.env.REQUEST_API_ORIGIN;
  if (!origin) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ message: 'The records service is not configured.' }));
  }
  let base;
  try {
    base = new URL(origin.endsWith('/') ? origin : origin + '/');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid origin');
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ message: 'The records service configuration is invalid.' }));
  }
  const upstream = new URL(path, base);
  if (!['http:', 'https:'].includes(base.protocol) || upstream.origin !== base.origin || !upstream.pathname.startsWith(base.pathname)) {
    res.statusCode = 400;
    return res.end('Invalid backend path.');
  }
  upstream.search = incoming.searchParams.toString();
  const headers = {};
  for (const name of ['accept', 'content-type', 'cookie', 'x-csrf-token']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  try {
    let body;
    if (req.method === 'POST') {
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) body = req.body;
      else if (req.body && typeof req.body === 'object') {
        if (String(headers['content-type'] || '').includes('application/json')) body = JSON.stringify(req.body);
        else {
          const fields = new URLSearchParams();
          for (const [name, value] of Object.entries(req.body)) {
            for (const item of Array.isArray(value) ? value : [value]) fields.append(name, String(item));
          }
          body = fields.toString();
        }
      } else {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.statusCode = 413;
            return res.end('Request too large.');
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
    }
    const response = await fetch(upstream, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    res.statusCode = response.status;
    for (const name of ['content-type', 'content-disposition', 'allow']) {
      if (response.headers.has(name)) res.setHeader(name, response.headers.get(name));
    }
    // The browser talks to request-web; backend host/subdirectory attributes must not scope its session away from the frontend.
    const cookies = response.headers.getSetCookie().map(cookie => {
      const forwarded = cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Path=[^;]*/gi, '');
      return forwarded + '; Path=/';
    });
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    const location = response.headers.get('location');
    if (location) {
      const destination = new URL(location, upstream);
      if (destination.origin === base.origin && destination.pathname.startsWith(base.pathname)) {
        const backendPath = destination.pathname.slice(base.pathname.length);
        const mapped = workspaceUrl(backendPath) || (['', 'index.php'].includes(backendPath) ? '/' : '/api/' + backendPath);
        res.setHeader('Location', mapped + destination.search + destination.hash);
      } else res.setHeader('Location', location);
    }
    if (req.method === 'HEAD' || !response.body) return res.end();
    res.flushHeaders();
    if (Object.hasOwn(workspacePages, publicPage) && /^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await pipeline(Readable.fromWeb(response.body), workspaceHtml(), res);
      return;
    }
    await pipeline(Readable.fromWeb(response.body), res);
  } catch {
    if (res.headersSent || res.destroyed) {
      if (!res.destroyed) res.destroy();
      return;
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ message: 'The records service is temporarily unavailable. Please try again.' }));
  }
}
