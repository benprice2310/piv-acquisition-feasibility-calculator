#!/usr/bin/env node
/*
 * Assembles the deployable single-file page from src/.
 *
 * The output is one self-contained index.html: no build-time dependencies, no
 * network requests at runtime, and a hash-based Content-Security-Policy so the
 * page runs under a strict policy while still being a single file. The build is
 * deterministic — no timestamps — so CI can check the committed page matches
 * the sources.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

/* Modules in dependency order; the bundler flattens them into one scope. */
const MODULES = ['src/model.js', 'src/presets.js', 'src/app.js'];
const STYLES = ['src/theme.css', 'src/app.css'];

const IMPORT = /^import\s[\s\S]*?from\s+'[^']*';[ \t]*\n/gm;
const EXPORT = /^export\s+(?=const|let|var|function|class)/gm;
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/* One flat scope means duplicated top-level names would silently shadow or
   throw at runtime; catch them here instead. */
function assertNoCollisions(sources) {
  const seen = new Map();
  for (const [file, code] of sources) {
    for (const [, name] of code.matchAll(TOP_LEVEL_DECL)) {
      if (seen.has(name)) {
        throw new Error(
          `duplicate top-level declaration "${name}" in ${file} and ${seen.get(name)}`
        );
      }
      seen.set(name, file);
    }
  }
}

function bundle() {
  const sources = MODULES.map((file) => [file, read(file)]);
  assertNoCollisions(sources);
  const body = sources
    .map(([file, code]) => `/* ---- ${file} ---- */\n${code.replace(IMPORT, '').replace(EXPORT, '')}`)
    .join('\n');
  return `(() => {\n'use strict';\n${body}\n})();`;
}

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231876d2'/%3E%3Cg fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M7 11h9'/%3E%3Cpath d='M7 21h14'/%3E%3C/g%3E%3Ccircle cx='23' cy='11' r='3' fill='%23fff'/%3E%3C/svg%3E";

const DESCRIPTION =
  'Plan a 2D PIV experiment: pulse separation, particle-image diameter, loss of pairs, spatial resolution and temporal sampling, computed in the browser.';

export function buildPage() {
  const style = `\n${STYLES.map(read).join('\n')}\n`;
  const script = `\n${bundle()}\n`;
  const csp = [
    "default-src 'none'",
    `script-src ${sha256(script)}`,
    `style-src ${sha256(style)}`,
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="description" content="${DESCRIPTION}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fcfcfd" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151618" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:title" content="PIV acquisition feasibility calculator">
<meta property="og:description" content="${DESCRIPTION}">
<title>PIV acquisition feasibility calculator</title>
<link rel="icon" href="${FAVICON}">
<style>${style}</style>
</head>
<body>
${read('src/layout.html').trimEnd()}
<script>${script}</script>
</body>
</html>
`;
}

export const OUTPUT = join(root, 'index.html');

/* Only write when run as a script, so tests can import the builder. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = buildPage();
  writeFileSync(OUTPUT, html);
  process.stdout.write(`index.html written, ${(html.length / 1024).toFixed(1)} kB\n`);
}
