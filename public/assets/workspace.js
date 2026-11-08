import { publicLink } from './workspace-routes.js';

// The base URL preserves the PHP screens' relative assets and background requests.
// Navigation and report forms use the public page URLs instead.
function updateLink(element) {
  const attribute = element.tagName === 'FORM' ? 'action' : 'href';
  const original = element.getAttribute(attribute);
  if (!original) return;
  const mapped = publicLink(original, document.baseURI, window.location.href);
  if (mapped !== original) element.setAttribute(attribute, mapped);
}

function updateLinks(root) {
  if (root.matches?.('a[href], form[action]')) updateLink(root);
  root.querySelectorAll?.('a[href], form[action]').forEach(updateLink);
}

updateLinks(document);
new MutationObserver(changes => {
  for (const change of changes) {
    if (change.type === 'attributes') updateLink(change.target);
    else change.addedNodes.forEach(updateLinks);
  }
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'action'] });
