#!/usr/bin/env node
/*
  Web-interface baseline guard. Fails the build when a page drops one of the five
  baseline rules. The rules, and why each one exists, are in
  ../standards/web-interface-baseline.md.

  Usage: node scripts/check-baseline.mjs <root> [<root>...]

  Pass the SHIPPED tree (dist/ for a build step, the deploy directory for a static
  site), never the source. A source-only scan is what let this rule rot in the first
  place: a grep over source said four sites were clean of `transition: all` and they
  were not, because a build step and a copied vendor file put it back.

  Wire it to something that runs. A `postbuild` script in package.json, a CI step, or
  a line in the deploy recipe. All three is better:

    "scripts": { "postbuild": "node scripts/check-baseline.mjs dist" }

  Checked, per site:
    1. every public .html page declares <meta name="theme-color">
    2. the CSS declares color-scheme
    3. the CSS has a prefers-reduced-motion block
    4. the CSS sets touch-action + -webkit-tap-highlight-color on controls
    5. the CSS defines a :focus-visible ring, and never uses `transition: all`

  Node 18+, no dependencies. Exits 0 clean, 1 on findings, 2 on bad usage.
*/
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIR = /^(node_modules|\.git|\.astro|\.wrangler|_astro-cache)$/;
// Reference-only PAGES that are never published, so they carry no obligation.
// Add your own never-shipped filename prefixes here. Note the scope: this
// filters the HTML page list only. The `transition: all` scan further down
// reads every .css file in the tree regardless, so a skipped stylesheet is
// still checked for that one rule. That is deliberate, since a stylesheet
// named like a mock is usually still linked by a real page.
const SKIP_FILE = /(^|[\\/])mock-/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.test(name)) walk(p, out);
    } else out.push(p);
  }
  return out;
}

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('usage: check-baseline.mjs <root> [<root>...]');
  process.exit(2);
}

const failures = [];
let pagesChecked = 0;

for (const root of roots) {
  let files;
  try {
    files = walk(root);
  } catch {
    failures.push(`${root}: not found (build first?)`);
    continue;
  }

  const html = files.filter((f) => f.endsWith('.html') && !SKIP_FILE.test(f));
  const cssFiles = files.filter((f) => f.endsWith('.css'));

  const required = [
    [/color-scheme\s*:/i, 'color-scheme declaration'],
    [/prefers-reduced-motion/i, 'prefers-reduced-motion block'],
    [/touch-action\s*:/i, 'touch-action on controls'],
    [/-webkit-tap-highlight-color\s*:/i, '-webkit-tap-highlight-color'],
    [/:focus-visible/i, ':focus-visible ring'],
  ];
  // Every page is judged on its own inline CSS plus exactly the stylesheets it links.
  // Judging site-wide is what let a bare 404 page ship with none of the rules: a
  // sibling page's stylesheet was covering for it.
  for (const f of html) {
    pagesChecked++;
    const text = readFileSync(f, 'utf8');
    const name = relative(root, f);

    // Rule 1 is per-page: a stylesheet cannot supply a meta tag.
    if (!/<meta[^>]+name=["']theme-color["']/i.test(text)) {
      failures.push(`${name}: missing <meta name="theme-color">`);
    }

    let scope = text;
    for (const m of text.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
      const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
      if (!href || /^(https?:)?\/\//i.test(href)) continue; // remote sheet, cannot read
      const clean = href.split(/[?#]/)[0];
      const path = clean.startsWith('/')
        ? join(root, clean)
        : join(f, '..', clean);
      try {
        scope += '\n' + readFileSync(path, 'utf8');
      } catch {
        /* linked sheet not in this tree; the markers just will not be found */
      }
    }

    for (const [re, label] of required) {
      if (!re.test(scope)) failures.push(`${name}: missing ${label}`);
    }
  }

  const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n') +
    html.map((f) => readFileSync(f, 'utf8')).join('\n');

  // Name the properties you animate. `all` opts in properties you never intended.
  if (/transition\s*:\s*all\b|transition-property\s*:\s*all\b/i.test(css)) {
    failures.push(`${root}: uses "transition: all" (list the properties instead)`);
  }
}

if (failures.length) {
  console.error('FAIL: web-interface baseline\n');
  for (const f of failures) console.error('  - ' + f);
  console.error(`\n${failures.length} problem(s). See standards/web-interface-baseline.md.`);
  process.exit(1);
}

console.log(`OK: web-interface baseline clean across ${pagesChecked} page(s).`);
