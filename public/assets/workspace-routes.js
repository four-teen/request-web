// Public page URLs share one mapping in the browser, development server, and proxy.
export const workspacePages = Object.freeze({
  '/dashboard': 'administrator/index.php',
  '/requests': 'administrator/manage_request.php',
  '/overdue-requests': 'administrator/overdue_requests.php',
  '/record-logs': 'administrator/record_logs.php',
  '/document-types': 'administrator/document_type.php',
  '/released-requests': 'administrator/released_summary.php',
  '/statistics': 'administrator/statistics_summary.php',
  '/programs': 'administrator/manage_programs.php',
  '/program-incharge': 'administrator/manage_assigned_faculty.php',
  '/reports': 'administrator/print_summary.php',
  '/reports/print': 'administrator/printed_summary.php',
});

export function workspaceUrl(backendPath) {
  if (backendPath === 'administrator' || backendPath === 'administrator/') return '/dashboard';
  return Object.entries(workspacePages).find(([, path]) => path === backendPath)?.[0];
}

export function publicLink(value, baseUrl, currentUrl) {
  const current = new URL(currentUrl);
  if (value.startsWith('#')) return current.pathname + current.search + value;
  const resolved = new URL(value, baseUrl);
  if (resolved.origin !== current.origin || !resolved.pathname.startsWith('/api/')) return value;
  const page = workspaceUrl(resolved.pathname.slice('/api/'.length));
  return page ? page + resolved.search + resolved.hash : value;
}
