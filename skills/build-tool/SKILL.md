---
name: build-tool
description: Build a new calculator tool for the site following the repo's spec-first, four-file convention. Usable interactively as /build-tool <tool-name>; the release pipeline uses the same checklist as its build stages.
---

# build-tool

Checklist for building one calculator tool. This one comes from a site of NEC electrical
calculators, so the domain language is electrical, but the shape holds for any site whose tools
have to be right rather than pretty.

Authoritative references live in the repo this runs against. Read them, do not duplicate them.
The paths below are that repo's; substitute your own.

- `CLAUDE.md` for accuracy principles, voice rules, the mandatory 7-part page template, exact
  disclaimer text, compliance flags.
- `docs/voltage-drop-spec.md` for the reference spec format.
- Your own release playbook for everything after the build. This skill covers spec plus build
  and stops there. See `pipeline/` in this repo for the shape of one.

## 1. Spec first

Write `docs/specs/<slug>-spec.md` modeled on the reference spec: identity (name, slug,
target keyword, NEC edition + exact tables/articles), formula derivation with stated
assumptions, inputs (ranges/units/validation), output contract, **5 to 10 hand-derived
reference scenarios with arithmetic shown**, documented deviations from third-party tools,
v1 out-of-scope list.

## 2. Four files

| File | Notes |
|---|---|
| `site/src/lib/calculators/<slug>.js` | Pure functions only. Comment header cites the NEC table/formula + edition + assumptions. |
| `site/src/lib/calculators/<slug>.test.js` | Vitest. The spec's 5 to 10 scenarios, arithmetic in comments, at least 1 cross-checked against a named independent tool. |
| `site/src/components/tools/<slug>-tool.astro` | Interactive UI, vanilla JS in `<script>`. No frameworks. Tool fully visible above the fold. |
| `site/src/pages/<slug>.astro` | 7-part template; `meta` object (title with keyword + brand, about 60 chars; 120 to 155 char description; keyword; canonical optional, Layout derives the trailing-slash form); WebApplication + FAQPage JSON-LD. |

**Color.** Two roles, declared in `site/src/styles/global.css` and enforced by
`npm run check:accent`. Blue is action: the Calculate button, focus rings, the result hero,
in-content links. Amber is identity: the brand shell, cards, eyebrows, callouts. In a scoped
`<style>` block read the tokens (`var(--action)`, `var(--action-hover)`,
`var(--action-text)`) rather than writing a hex, and copy the block from an existing tool
instead of inventing one. Never put white text on amber, it is 2.15:1 and fails AA.

Shared NEC table data: `site/src/data/nec-tables/<table>.json`, versioned by edition, header
cites the source. Reuse existing table files and calculator modules before creating new ones
(for example `wire-size-calculator.js` exports `STANDARD_OCPD_AMPS`; the voltage-drop and
ampacity modules are composable).

## 3. Register the tool

- `site/src/pages/index.astro`: add to the right `categories` entry (feeds the homepage
  cards and ItemList JSON-LD).
- `site/src/layouts/Layout.astro`: add `[label, href]` to the matching footer column.
- `docs/tools-roadmap.md`: status not-started to shipped.
- Sitemap is automatic (@astrojs/sitemap).

## 4. Verify locally

From `site/`: `npm run lint && npm test -- --run && npm run build && npm run check:dashes && npm run check:accent`
(no em/en dashes in user-visible copy). Then run
`/validate-accuracy <slug>` before considering the tool done. "Looks right" is not the
same as "arithmetic checks out against the NEC table."

---

## Why this one is in the library

The paths are specific to one site and will mean nothing in your repo. Four things generalize,
and they are the reason a skill this boring is worth reading.

**The spec comes before the code, and it contains the answers.** Five to ten scenarios with the
arithmetic written out, produced before anything is built. That single ordering decision is what
later makes an independent accuracy check possible at all. Without it there is nothing to check
against except the code, and checking code against itself is what this whole library is about
avoiding.

**A fixed file convention makes review cheap.** Four files, always the same four, always the same
names. A reviewer who knows the shape can tell in ten seconds that the test file is missing. A
project where every feature is laid out differently has no such moment.

**Reuse is stated as a step, not hoped for.** "Reuse existing table files and calculator modules
before creating new ones", with a named example of a module that already exports the constant you
were about to redefine. Left implicit, this never happens.

**One rule per decision, with the check named next to it.** The color rule says what each color
means, which token to read, what the failing contrast ratio is, and which command fails when you
get it wrong. That is the shape every rule in a skill should have.
