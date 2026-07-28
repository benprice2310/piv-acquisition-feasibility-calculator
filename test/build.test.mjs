import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { buildPage, OUTPUT } from '../build.mjs';

const committed = readFileSync(OUTPUT, 'utf8');

test('the committed page matches the sources', () => {
  assert.equal(
    committed,
    buildPage(),
    'index.html is stale: run `npm run build` and commit the result'
  );
});

test('the content security policy hashes the inline blocks it ships', () => {
  const csp = committed.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const style = committed.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = committed.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const block of [style, script]) {
    const hash = createHash('sha256').update(block, 'utf8').digest('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`), `missing hash for a ${block === style ? 'style' : 'script'} block`);
  }
  assert.match(csp, /default-src 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'policy should not need unsafe directives');
});

test('the page is self-contained', () => {
  const external = committed.match(/(?:src|href)="(?!data:|#)[^"]*"/g) ?? [];
  assert.deepEqual(external, [], `page must not reference external resources: ${external.join(', ')}`);
  /* The only absolute URLs left should be XML namespaces, which are identifiers
     rather than fetches. */
  const urls = (committed.match(/https?:\/\/[^\s"'`)]+/g) ?? []).filter(
    (url) => !url.startsWith('http://www.w3.org/')
  );
  assert.deepEqual(urls, [], `no runtime network references: ${urls.join(', ')}`);
});
