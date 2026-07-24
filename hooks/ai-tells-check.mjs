#!/usr/bin/env node
// PostToolUse hook: flags AI-tell language + em/en dashes in prose you are about to ship.
// Advisory, not destructive. It never edits or reverts anything. On a hit it exits 2
// so the finding is fed back to Claude to self-correct on the next turn.
// The banned-word list below is one writer's taste; edit it to your own.

import { readFileSync } from 'node:fs';

// Only scan prose/markup where the rule bites hardest. JS/TS excluded on purpose:
// too many false positives from identifiers (e.g. a var named "harness").
const SCAN_EXT = new Set(['.md', '.mdx', '.markdown', '.html', '.htm', '.astro', '.txt']);
const SKIP_PATH = /[\\/](node_modules|dist|build|\.git|\.astro|coverage)[\\/]/i;

const BANNED_WORDS = [
  'gate', 'gated', 'delve', 'leverage', 'robust', 'seamless', 'elevate', 'foster',
  'harness', 'underscore', 'unlock', 'game-changer', 'tapestry', 'landscape',
  'testament', 'pivotal', 'crucial', 'journey', 'deep dive', 'empower',
  'streamline', 'utilize', 'north star', 'flywheel', 'synergy', 'jargon'
];

// The dash ban is absolute, so cover every real dash code point plus its lookalikes
// (figure dash, non-breaking hyphen, minus sign, two/three-em dashes) and every escape
// form. The ordinary hyphen-minus U+002D is intentionally NOT here: normal hyphenation
// must not flag. Labels use code points, never the literal glyph, so this file does not
// trip its own scan.
const DASH_CPS = {
  0x2011: 'non-breaking hyphen (U+2011)',
  0x2012: 'figure dash (U+2012)',
  0x2013: 'en dash (U+2013)',
  0x2014: 'em dash (U+2014)',
  0x2015: 'horizontal bar (U+2015)',
  0x2212: 'minus sign (U+2212)',
  0x2e3a: 'two-em dash (U+2E3A)',
  0x2e3b: 'three-em dash (U+2E3B)'
};

// Literal glyphs, named entities, and numeric HTML entities (hex or decimal, any case,
// leading zeros tolerated) for exactly the covered code points. One regex, /gi.
const DASH_RE = /[\u2011\u2012\u2013\u2014\u2015\u2212\u2E3A\u2E3B]|&(mdash|ndash);|&#(?:[xX]0*(2011|2012|2013|2014|2015|2212|2e3a|2e3b)|0*(8209|8210|8211|8212|8213|8722|11834|11835));/gi;
const NAMED_CP = { mdash: 0x2014, ndash: 0x2013 };

function dashHits(text) {
  const found = new Map(); // cp -> label, deduped
  for (const m of text.matchAll(DASH_RE)) {
    let cp;
    if (m[1]) cp = NAMED_CP[m[1].toLowerCase()];        // &mdash; / &ndash;
    else if (m[2]) cp = parseInt(m[2], 16);             // hex numeric entity
    else if (m[3]) cp = parseInt(m[3], 10);             // decimal numeric entity
    else cp = m[0].codePointAt(0);                      // literal glyph
    if (DASH_CPS[cp]) found.set(cp, DASH_CPS[cp]);
  }
  return [...found.values()];
}

function ext(p) {
  const m = /\.[^.\\/]+$/.exec(p || '');
  return m ? m[0].toLowerCase() : '';
}

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { process.exit(0); }

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const ti = input.tool_input || {};
const filePath = ti.file_path || '';
if (!filePath || SKIP_PATH.test(filePath) || !SCAN_EXT.has(ext(filePath))) process.exit(0);

// Scan only what was just written, not the whole legacy file.
const content = ti.content ?? ti.new_string ?? '';
if (!content) process.exit(0);

const hits = [];

for (const label of dashHits(content)) {
  hits.push(`  - ${label} (banned in all user-visible copy)`);
}

// KNOWN FALSE POSITIVE, left as-is: for .html/.astro the word scan runs over the WHOLE
// content, embedded <script>/<style> included, so a code identifier or CSS keyword (a var
// named "gate", @keyframes "elevate") can trip a banned-word hit. This is the same identifier
// problem that justifies excluding .js/.ts entirely. Not fixed on purpose: the hook is advisory
// (exits 2, never edits), and stripping code regions cleanly is more risk than the rare false
// flag Claude can just ignore. Dashes are unaffected (they are banned inside code too).
const lower = content.toLowerCase();
const wordHits = BANNED_WORDS.filter(w => {
  const re = new RegExp(`(^|[^a-z])${w.replace(/[-]/g, '[-\\s]')}([^a-z]|$)`, 'i');
  return re.test(lower);
});
if (wordHits.length) hits.push(`  - AI-tell words: ${wordHits.join(', ')}`);

if (!hits.length) process.exit(0);

process.stderr.write(
  `AI-tells check flagged the copy you just wrote to ${filePath}:\n` +
  hits.join('\n') +
  `\n\nFix per your "no AI tells" rule: rewrite in plain prose, ` +
  `use hyphens not em/en dashes. If a flagged word is unavoidable and correct in context, ` +
  `you may keep it; otherwise replace it.\n`
);
process.exit(2);
