---
name: coloring-book
description: Build a bold-and-easy KDP coloring book page by page in Canva - correct trim+bleed size, line-art sourcing, verse pairing in a single fixed Bible translation, and the export path to a print-ready interior PDF. Use when Jared says /coloring-book, "build the coloring book", "add a page to the coloring book", or names a new coloring book by theme.
---

# Coloring book production

Built and verified 2026-08-09 on the faith/scripture coloring book (Canva design
`<CANVA-DESIGN-ID>`). The market benchmark that justified this niche: Coco Wyo's
"Spooky Cutie" coloring book, BSR #88, 7,649 ratings, plus a faith-specific
indie comparable at BSR #32,108, both confirmed live on Amazon before this
skill was written. Re-verify comparables before starting a new theme; don't
trust old numbers.

## Prerequisites

- **Canva Pro must be active on the account.** Confirmed live 2026-08-09 by
  exporting a design containing a Pro-only element and checking the actual
  output file (not the editor thumbnail, which renders clean regardless of
  license): no watermark, full resolution. If a fresh check shows a
  watermark, Pro lapsed; stop and tell Jared before building more pages.
- The Canva MCP connector (`claude.ai Canva`) should be connected, useful for
  verification (`export-design`, `get-export-formats`) and for reusing an
  asset already placed once (`edit-design` with `insert_fill` by `mediaId`),
  but it **cannot search Canva's stock Elements library**. That discovery
  step is browser-only; see below.

## Page geometry (KDP paperback, square trim)

Every page is a **custom-size Canva design at 8.625in by 8.75in**, that's the
8.5in by 8.5in trim size (matching the Coco Wyo benchmark) plus KDP's bleed
spec: add 0.125in to width, 0.25in to height, applied via Canva's Custom Size
dialog with units switched to `in`. Set this once per design; every added
page inherits it.

KDP's custom trim range is width 4 to 8.5 inches, height 6 to 11.69 inches,
confirmed directly against `kdp.amazon.com/en_US/help/topic/G201834180`, not
from memory. Re-check if trim size changes.

**Not yet built into the layout**: a gutter margin (extra inside margin near
the spine, which grows with page count) and front matter (title/copyright
page before content). Centered art has held up fine at this page count but
this is a known gap; fix in the finishing pass before final export, not page
by page.

## Per-page build loop (do this once per motif)

1. **Add a page** via the `+ Add page` button at the bottom of the Canva
   editor. It inherits the custom size automatically.
2. **Click into the empty page canvas first**, then open the Elements panel
   (left sidebar, not Templates, Templates search returns full designs, not
   individual line-art objects).
3. **Search with the pattern `[subject] coloring page line art`**, for
   example "shepherd with sheep coloring page line art", "dove peace bird
   coloring page kids". Click into the actual **Elements search box** (there's
   a second, easy-to-miss search field under "Generate", use that one, not
   the top Templates search).
4. **Clear the field with `ctrl+a` before typing a new query.** A plain click
   plus type can append to old text instead of replacing it, producing a
   garbled compound query that returns the wrong results (hit this on page 3
   and 6 of the first book).
5. **Check the "Graphics" tab specifically** if the default "All" tab surfaces
   photos or mandala patterns instead of bold line art, click Graphics, wait
   about 1-2s for results to load before screenshotting.
6. **Reject anything with color fill.** A coloring page needs bold black
   outlines only, no shaded or colored icons, no solid silhouettes. Zoom in on
   a candidate thumbnail before placing if it's ambiguous.
7. **Click the result to place it**, then resize (drag the corner handle) and
   center it in the upper 65 percent of the page, leaving room below for the
   verse.
8. **Add the verse as a separate text box**: Text panel, "Add a heading",
   type the verse plus a hyphen plus the reference, select all the size field
   text via triple-click on the font-size number (top toolbar), type `24`
   (or `18-20` for longer verses so it stays to one or two lines), Enter,
   Escape, drag the text box down to sit just below the image, centered.

## Known failure modes and fixes

- **Renderer freeze**: the `zoom` screenshot action on a Canva tab can hang
  for 30s and time out ("renderer may be frozen"). Fix: `navigate` to the
  same URL again to reload, wait about 2s, retry. Don't keep retrying zoom
  blind.
- **Stray sticky-note comment**: if a double-click misses the actual text
  element (lands on empty canvas nearby) and you then `ctrl+a` plus type,
  Canva can create a yellow sticky-note **comment** object instead of editing
  text, signed with the account owner's name. It is not part of the design,
  select it and delete it, then double-click precisely on the visible text
  baseline and confirm the font toolbar (with a size number) appears before
  typing.
- **Undo cascades across pages**: `ctrl+z` repeated several times to fix one
  bad edit can silently remove an entire added page, not just the last
  operation. After any undo, check the page count in the bottom bar (`N / M`)
  before continuing, don't assume only the intended change reverted.
- **Text overlapping the image**: the verse text box drops in at the
  vertical center of the canvas regardless of where the image is. Always drag
  it down after typing; don't assume default placement.
- **Leading characters dropped after ctrl+a**: typing immediately after a
  `ctrl+a` select-all can silently drop the first several characters (hit on
  page 12: "The entrance of thy words" came out as "rance of thy words").
  Fix: double-click the text to enter edit mode, `ctrl+a`, `Delete`, wait
  about 1s, then type. Don't chain `ctrl+a` straight into `type` with no
  pause, always verify the rendered text against the source string with a
  screenshot before moving on.

## Scripture: one fixed translation, every verse

Jared's call, 2026-08-09: **King James Version (KJV)**, over NIV. Reasoning
that decided it: KJV is public domain, so a commercial book quoting around 50
verses carries zero licensing exposure; NIV is copyrighted (Biblica/Zondervan
permits short quotations under published guidelines, but that's a constraint
to track, not a guarantee, at this volume of quotes in one for-profit work).

**Do not quote a verse from memory and assume it's KJV wording.** Paraphrases
and other translations sound similar and are easy to mis-recall, this
happened twice in the first 8 pages (Psalm 119:105 typed as NIV wording,
Genesis 9:13 typed as NIV wording, both caught only because Jared asked and
forced an actual check rather than a guess). Look up or otherwise verify the
literal KJV text before typing it into a page, not after.

Per Jared 2026-08-09: once all pages are drafted, **spin up two independent
agents** before calling the book done, one for a formatting pass (consistent
image scale and position, consistent text size and placement across every
page), one dedicated to verifying every quoted verse against actual KJV text.
Do not skip this because the build-time verses were carefully sourced; verify
anyway.

## Verifying the mechanism (do this once per new book, not per page)

Confirms Pro assets export clean and that MCP can manipulate the file
directly, without re-deriving it from scratch:

1. `mcp__claude_ai_Canva__read-design` with `open_transaction: true` on the
   design, pull the `mediaId` of a placed image from the returned page
   content (`fill: IMAGE mediaId=...`).
2. `mcp__claude_ai_Canva__get-export-formats` then
   `mcp__claude_ai_Canva__export-design` (type `png`) on the design, download
   the actual output file (not the editor thumbnail) and inspect it for a
   watermark.
3. Optional: `mcp__claude_ai_Canva__edit-design` with an `insert_fill`
   operation using that `mediaId` proves the same asset can be placed on a
   different page entirely through MCP, no browser round trip, useful if a
   motif repeats across many pages in one book. Always `finalize: "cancel"`
   a test transaction so nothing untested gets committed to the real file.

## Export (final step, not yet exercised end to end)

Canva's **PDF Print** export type supports 300 DPI with a bleed and crop
marks checkbox, confirmed via Canva's own help docs, but is restricted to
Canva Pro same as everything else here. `mcp__claude_ai_Canva__export-design`
with `format.type: "pdf"` and `export_quality: "pro"` should be the MCP path;
the bleed and crop marks checkbox itself may only be exposed in the browser
editor's own Share to Download flow, verify which before relying on either
for the actual KDP upload file.
