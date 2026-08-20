---
name: freebie
description: Ship a free tool on jaredhebb.com end to end - pick it, build it to the standards, verify it, deploy it, and record it. Use when Jared says /freebie, "new free tool", "ship a freebie", "add a tool to the site", or names a specific one (CLAUDE.md grader, hook builder, permissions builder).
---

# Ship a freebie

A free tool on jaredhebb.com. The first one was the Claude house rules generator at
`/claude-md`, shipped 2026-07-21. This is the repeatable version of that.

The tools live under the **Free stuff** nav dropdown. They are the top of the funnel:
someone uses one, it works, and the course is the next thing they see. They are also
the most shareable thing on the site, which is the whole reason they are free.

## 1. Decide whether to build it at all

Answer these before writing anything. If two or more are bad, pick a different tool.

- **Who has this problem, and are there more of them than the last tool served?** The
  generator serves people with no CLAUDE.md. The grader serves people who have one
  and suspect it is bad, which is a bigger group. Prefer the bigger group.
- **Is the output shareable?** A score, a grade, a file someone posts a screenshot
  of. A thing that only helps privately does not spread.
- **What does it cost to run per use?** Zero is the default and the strong preference.
  If it needs a model call, price it out against live pricing (load the `claude-api`
  skill, do not price from memory), and say what a single abusive paste costs, not
  just the average. Anything with a running cost is deferred behind revenue. Jared
  settled the spend order on 2026-07-21: official X API access comes first, all day.
- **Can it be deterministic instead?** A template, a lookup, or a rules engine beats
  a model call: instant, free, no key on a public endpoint, nothing to rate-limit,
  and no abuse surface. The house rules generator was going to be an API call and is
  better as prewritten blocks. Reach for the model only when the work is genuine
  judgment.
- **Does it already exist inside Claude Code?** `/init` already drafts a CLAUDE.md
  from a repo. The generator earns its place by doing the part `/init` cannot infer:
  standing rules, escalation preferences, hard limits. If Claude Code already does
  the whole job, do not rebuild it.

Write the answers into the Notion task before building. That is what made the grader
task useful months later.

## 2. The standards. These are not optional

Both came from Jared rejecting a first draft on 2026-07-21. Full history in Claude
Code memory `feedback-free-tools-for-non-coders.md`.

### It has to work for someone who has never opened a terminal

> "it's too technical. no nontechnical user is going to understand this. at all. this
> has to work at the lowest common denominator."

- Every question in plain English. Not "package manager" but "what do you type to
  start it up?" Not "test suite" but "what do you type to check it still works?"
- **Every question gets an explicit way to skip it**, in the hint text, in his voice:
  "leave this blank if you have no idea," "if Claude never told you to type anything,
  skip this whole section. It costs you nothing to leave blank."
- Words that do not belong in anything a visitor reads: repo, root, branch, commit,
  lint, suite, deploy, stack, CLI, dependency. They are fine inside output that an AI
  reads. Keep the two vocabularies separate and check the visible one.
- Placeholders are concrete examples, never format descriptions. "Maple Street Bakery
  site" beats "your project name."
- **Give a no-terminal path for whatever comes after.** The generator's is: copy it,
  paste it to Claude, say "save this as CLAUDE.md in the top folder of my project."
- Cutting a question beats explaining one. Deleting the package-manager question also
  deleted a bug where four of its eight choices emitted broken commands.

### The output has to be worth more than the input

> "That's weak sauce."

That was aimed at a checkbox labeled "every change ships with a test" producing the
sentence "Every change ships with a test. A change without one is not done."

- Every block states **the rule, why it exists, and how to tell it is being followed.**
  All three. A block that restates its own checkbox is filler and he will call it.
- His own bar-setting example: a checkbox about testing should produce something like
  write the test, break the code on purpose, watch it fail, fix it, watch it pass,
  because a test that passes no matter what is worse than none.
- Ship the good defaults pre-checked. Someone who answers nothing and clicks download
  should still get a genuinely useful file.
- Free does not mean thin. "we want this to along with all of our products, free or
  not to provide as much value as possible."

### Other standing decisions

- **No email required.** Settled 2026-07-21. The course funnel already has its magnet
  (free Module 1 plus the cheat sheet). A second email wall competes with the one that
  already converts. Show the result, then offer the newsletter and the course under it.
- **Nothing the visitor types leaves the browser** unless the tool truly cannot work
  that way, and say so on the page when it is true. It is a real selling point.
- If a tool ever does store something, store the least possible. The grader's decision:
  keep score, date, and a typed display name, never the submitted file. That one choice
  removes moderation, privacy exposure, and storage cost at once.
- No em dashes or en dashes anywhere, including in whatever the tool generates into
  someone else's file. The repo test enforces this.

## 3. Build it

Work in `<HOME>\projects\jaredhebb-com`. **Read that repo's `CLAUDE.md`
first**; it holds the deploy hazard, the CSP trap, and the shared-styles rule, and it
is the authority over anything here that has drifted.

1. Copy `tool-template.html` to `<slug>.html`, replace the `TOOL_` placeholders,
   delete the instruction comment. It already carries the header, footer, cookie
   banner, stylesheet links, and the two-column form-and-preview layout.
2. Write `<slug>.js`. Model it on `claude-md.js`: read the form with `FormData`, build
   a string from template blocks, put it in `out.textContent`, download with a Blob,
   copy with `navigator.clipboard` and a fallback. No dependency, no framework.
   **It must be its own file.** The CSP is `script-src 'self'` with no
   `'unsafe-inline'`, so an inline script is blocked with nothing visible on the page.
3. Add a `<url>` entry to `sitemap.xml`.
4. Add it to the **Free stuff** dropdown in every page that has one. Copy the block,
   do not retype it; the test compares them byte for byte.
5. Add an entry to the list on `/work` if it is worth showing as something built:
   kind tag, name, plain blurb, single link out.
6. Keep page-specific CSS to what is genuinely unique. Shared chrome is in `site.css`,
   the tool layout is in `tool.css`. If you find yourself copying a rule between two
   tool pages, it belongs in `tool.css`.

## 4. Verify before briefing him

- `npm test`. **It finds your new page by itself**, no list to update: any deployed
  `.html` carrying the site header is held to the shared chrome, and any page with a
  "Free tool" eyebrow and a result panel is additionally held to the plain-language
  vocabulary rule. So the moment the file exists it is checked for drift in the
  header, footer, and cookie banner, for anything inline the CSP would silently
  block, for banned dashes, and for words a non-coder will not know.
  A page copied from `tool-template.html` passes all of it on day one, which was
  verified on 2026-07-21 by building a throwaway page from the template and running
  the suite against it.
- `npx wrangler pages dev .` and actually use the tool. Fill nothing, confirm the
  output is short and clean with no empty sections. Fill everything, confirm every
  section appears and reads like a person wrote it.
- Devtools console: **zero CSP violations.** This is the one failure here that does
  not announce itself.
- Read the generated output end to end as if you were the stranger receiving it. No
  stray `undefined`, no dashes, no section that restates its own checkbox.
- **Write the tests against the source of truth, never against your own file.** On
  2026-07-22 the cost calculator shipped a first draft whose repeated-part arithmetic
  was 8x out, with 20 passing tests, because the tests restated the implementation's
  own assumptions back at them line for line. A test you could only have written by
  copying a line out of the file under test is not a check, it is a mirror. Derive
  every expected number from the published table or doc, put that derivation in a
  comment, and add at least one property that must hold no matter what the code does
  (there: no answer may ever be priced above the same answer with the discount left
  off). This matters most for anything emitting a number, a price, or a config.
- **The plain-words check stops at the HTML.** It reads the page, not the JS, so every
  word your tool emits into the result panel is unchecked by default. Half of what the
  visitor reads comes out of that file. Add a matching guard over the generated text.
- Check it at 375px. **The browser's window resize does not move the viewport on this
  machine, and an iframe does not work either** (`contentDocument` comes back null from
  the extension's context). Measure it instead, which is how it was finally verified on
  2026-07-22 after three ships of saying it was unverified: read the computed padding
  off `.wrap` and `pre#out`, subtract both from 375 to get the real panel width, then
  measure candidate strings with a canvas 2d context whose font is set to the panel's
  own computed font. For the shared tool layout that comes to a 301px panel and 38
  monospaced characters. Wrap the output to fit and let a test hold it there. If you
  cannot measure it either, say so plainly rather than claiming it passed.
- **Independent review before briefing Jared.** Not optional, never ask first. Hand
  the reviewer the exact files and tell it to read the page as a non-coder and name
  every word a normal person would not understand.

## 5. Ship it

Follow the deploy section of the repo's `CLAUDE.md` exactly. The short version:
commit first (the deploy archives `HEAD`, not your working tree, so HTML and CSS have
to land in the same commit), build an enumerated copy from the committed tree, and
deploy **that**, never the working directory. Then poll the live URL until several
checks in a row return the new content, because edge nodes serve the old deploy for a
minute and one check is not proof.

## 6. Record it

- **Notion Tasks**: mark the task Done and write what shipped, what changed from the
  plan, and what is still unverified. If the build answered an open question on
  another task, go update that task too.
- **Watson vault**: append a dated UPDATE section to
  `projects/aide-data/memory/projects/jaredhebb-com.md`.
- **Claude Code memory**: update `project-jaredhebb-site.md`. Add a new memory only if
  Jared set a new standard, not for the tool itself.
- Tell him plainly what is unverified. That is more useful than a clean report.

## The queue

Live, all three shipped 2026-07-21:
- **First message builder**, `/claude-brief`. Answer plain questions, get an opening
  message to paste into Claude. Two modes that swap which questions show using CSS
  `:has()` and no script.
- **Claude house rules generator**, `/claude-md`.
- **Claude settings builder**, `/claude-settings`. This is the hook builder and the
  permissions builder merged. They were queued as two tools and ship as one page,
  because both write the same `settings.json` and two pages would have handed the
  visitor two partial JSON blocks to merge by hand. Worth remembering as a test for
  the next idea: **if two candidate tools write to the same file, they are one tool.**

**Build on `tool.js`.** The form reading, live preview, download, copy, `period`, and
`lines` are shared. A new tool's script only turns answers into a string and calls
`window.Tool.wire({filename, type, render})`. Never write that plumbing again.

Also live: **API cost calculator**, `/claude-api-cost` (shipped 2026-07-22). Four plain
questions in words, monthly bill on four models side by side. Its lesson is in section 4:
the prices were the easy part and the pricing *rules* were not, and the first draft was 8x
out on the repeat discount with every test passing.

The next-tool list lives in the task database, not in this file. Two rules govern it, and they
are the part worth copying:

- **Every candidate must be deterministic and cost nothing to run.** Anything needing a model
  call per use goes on a separate wishlist and waits behind a decision about spending money.
  Keeping those two lists apart is what stops a free-tools pipeline quietly becoming a bill.
- **Some candidates carry a content risk, not a build risk.** A tool that emits configuration is
  only as good as the docs it was written against, and emitting confidently wrong config is
  worse than shipping nothing. Those get their output verified against live documentation before
  they ship, every time.

Keep a short list of ideas **rejected** against section 1, with the reason and the date, and do
not revive them. Section 1 exists to be able to say no.

**The reliable way to find the next one:** the three live tools all serve someone who is
already using Claude and already annoyed. `/claude-brief` beat two better-known ideas
purely because it moved one step earlier in the story, to the moment before any of the
others help. Ask where else the person is stuck that no tool reaches yet.

**Before writing any rule, permission, or config the tool emits into someone else's
setup, verify the syntax against the live docs.** Building `/claude-settings` turned up
two things that no amount of recall would have caught: `Write(path)` and `Glob(path)`
permission rules are accepted and then never matched, and a plain `./` path only ever
means the folder being worked in, so a file destined for the home folder needs `~/`
anchored rules to cover anything else. Both would have shipped as protection that was
not there.
