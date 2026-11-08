import { Transform } from 'node:stream';

// Only inspect the document prefix. Reports continue streaming after their head.
export function workspaceHtml() {
  let prefix = Buffer.alloc(0);
  let complete = false;
  const additions = '<base href="/api/administrator/"><script type="module" src="/assets/workspace.js"></script>';
  return new Transform({
    transform(chunk, encoding, callback) {
      if (complete) return callback(null, chunk);
      prefix = Buffer.concat([prefix, chunk]);
      const text = prefix.toString('utf8');
      const head = /<head(?:\s[^>]*)?>/i.exec(text);
      if (head) {
        const end = Buffer.byteLength(text.slice(0, head.index + head[0].length));
        this.push(Buffer.concat([prefix.subarray(0, end), Buffer.from(additions), prefix.subarray(end)]));
        prefix = Buffer.alloc(0);
        complete = true;
      } else if (/<(?:body|p|div|table)(?:\s|>)/i.test(text) || prefix.length >= 65536) {
        this.push(prefix);
        prefix = Buffer.alloc(0);
        complete = true;
      }
      callback();
    },
    flush(callback) {
      if (!complete) this.push(prefix);
      callback();
    },
  });
}
