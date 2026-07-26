# The web-interface baseline

Five things every page ships. They came out of an audit of four live sites, all of which
were missing the same five. Each one fixes a specific, reproducible defect, not a style
preference. Four of the five live in a shared stylesheet, so one edit covers every page
that inherits it. The fifth cannot, and that is exactly why it is the one that goes
missing.

The five rules are drawn from [Vercel Labs' Web Interface
Guidelines](https://github.com/vercel-labs/web-interface-guidelines), which is MIT licensed,
the same as this repo. That project states its preferences reflect Vercel's own brand and
product choices rather than universal law, and this is a subset of it, not a summary. The
write-up, the reasoning, the CSS as written here, and the checker in
[`../scripts/check-baseline.mjs`](../scripts/check-baseline.mjs) are original work.

Adopt it by pasting the CSS block at the bottom into your shared stylesheet, adding the one
meta tag to every page head, then running the checker against your **built** output. Wire
the checker to something that runs on every change or the rule rots.

---

## 1. `color-scheme` on `html`

**The rule.** Declare `color-scheme` on the root element and make it match the actual page,
not what you wish it were.

**Why.** The browser paints scrollbars, `<select>` dropdowns, date pickers, spinner arrows,
and form field backgrounds itself. Without this declaration it paints them all for a light
page. On a dark site you get a white scrollbar track against a near-black body and dropdown
text that is dark grey on dark grey. It is not a subtle contrast miss, it is unreadable
native UI, and no amount of CSS on your own elements fixes it because you do not own those
controls.

```css
html { color-scheme: dark; }
```

Use `light dark` if you genuinely support both and let the OS pick. Use one value if you
ship one look. A site that declares `light dark` while hard-coding a dark palette is the
worst of the three, because the browser then trusts you.

## 2. `<meta name="theme-color">` in every page head

**The rule.** Every page carries a theme-color meta tag whose value matches the color at the
top of that page.

**Why.** Mobile browsers tint the address bar and the status bar area with this value. With
no tag, Safari and Chrome guess from the page background, and they guess late, so you get a
visible flash of the wrong color on load. The reason this one belongs in a checker rather
than a code review is that **a stylesheet cannot supply it.** It is per page. Every other
rule here is inherited the moment a page links the shared sheet; this one has to be present
in the head of each document. The usual way it goes missing is a second layout: someone adds
a bare error page or a landing page template, does not copy the head partial, and that page
alone ships without it. That is precisely the case the audit found.

```html
<meta name="theme-color" content="#0b0b0f">
```

If a page has a light hero and the rest is dark, match the top. That is what the user sees
under the address bar.

## 3. A `prefers-reduced-motion: reduce` block

**The rule.** One media query that flattens animation and transition duration site-wide.

**Why.** Vestibular disorders are real and parallax, large-scale slides, and auto-playing
carousels can cause actual nausea. The user has already told the operating system they want
less of it. Respecting it costs six lines. Note the `!important` and the universal selector:
this has to beat every animation you shipped, including the ones in a component you pulled in
later, so a polite low-specificity version does not do the job.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`.01ms` rather than `0` on purpose. A zero-duration animation can skip its `animationend`
event in some engines, and code that waits on that event then hangs forever. A duration too
short to perceive fires the event and stays invisible.

## 4. `touch-action: manipulation` and `-webkit-tap-highlight-color` on controls

**The rule.** Both properties on everything a finger taps.

**Why.** Two separate mobile defects.

`touch-action: manipulation` removes the roughly 300ms delay mobile browsers hold after a tap
while they wait to see whether you are starting a double-tap-to-zoom. On a button, that delay
reads as a laggy, cheap-feeling app, and it is the single most common reason a site "feels
slow" on a phone when every metric says it is fast. Declaring `manipulation` tells the
browser this element does not participate in double-tap zoom, so it can dispatch the tap
immediately.

`-webkit-tap-highlight-color` controls the grey flash box iOS and Android Chrome paint over a
tapped element. The default is a translucent grey rectangle that ignores your border radius,
so a rounded pill button flashes as a hard-cornered grey block. Set it to `transparent` and
supply your own `:active` state, which you control.

```css
a, button, input, select, textarea, summary, [role="button"] {
  -webkit-tap-highlight-color: transparent;
}
button, a, summary, [role="button"],
input[type="submit"], input[type="button"] {
  touch-action: manipulation;
}
```

## 5. A global `:focus-visible` ring, and never `transition: all`

Two rules that travel together because both are about what your CSS does when you were not
looking.

**The focus ring.** Keyboard and switch users navigate by focus. Browsers ship a default
outline; a great many stylesheets delete it with `outline: none` for aesthetics and never
replace it, which makes the site unusable without a mouse. `:focus-visible` is the fix
that satisfies both parties: it applies on keyboard focus and not on a mouse click, so you
get a visible ring exactly when someone needs it and never the "ugly box after clicking a
button" that motivated the deletion in the first place.

```css
:focus-visible {
  outline: 2px solid #4c8dff; /* your action color */
  outline-offset: 2px;
  border-radius: 2px;
}
```

**Never `transition: all`.** Name the properties you animate. `all` opts every animatable
property into the transition, including ones you never intended and ones a browser adds in a
future version. Concretely it causes: layout thrash, because the browser cannot skip
properties it knows are static; a paint on every property change rather than the one you
meant; and animations that appear out of nowhere when a class toggle happens to change a
property you forgot was covered. It also defeats the reduced-motion block above in a subtle
way, since you can no longer reason about what is even moving.

```css
/* no */
.card { transition: all .2s ease; }

/* yes */
.card { transition: transform .2s ease, box-shadow .2s ease; }
```

---

## The whole block, copy-paste

Paste into your shared stylesheet. Swap the two colors.

```css
/* Web-interface baseline. */
html { color-scheme: dark; }

a, button, input, select, textarea, summary, [role="button"] {
  -webkit-tap-highlight-color: transparent;
}
button, a, summary, [role="button"],
input[type="submit"], input[type="button"] {
  touch-action: manipulation;
}

:focus-visible {
  outline: 2px solid #4c8dff;
  outline-offset: 2px;
  border-radius: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

And in every page head, matched to the top of that page:

```html
<meta name="theme-color" content="#0b0b0f">
```

## Two extras worth the same paste

Not part of the five, but they come from the same audit and cost as little.

```css
/* Keyboard users need a way past the nav. Offscreen until tabbed to. */
.skip-link {
  position: absolute; left: -9999px; top: 0; z-index: 100;
  padding: .6rem 1rem; text-decoration: none;
  background: #4c8dff; color: #fff;
}
.skip-link:focus { left: 0; }

/* iOS zooms the page when a focused control renders under 16px. The max()
   keeps a deliberately larger control large. */
@media (max-width: 640px) {
  input, select, textarea { font-size: max(16px, 1em); }
}
```

The skip link needs one line of markup as the first child of `<body>`:

```html
<a class="skip-link" href="#main">Skip to content</a>
```

## Check it against the shipped tree

```
node scripts/check-baseline.mjs dist
```

Point it at built output, never at source. That distinction is the finding that started
this: a grep over the source said all four sites were clean of `transition: all`, and they
were not. A build step, a component library, or a copied vendor file can put the thing back
after your source is clean. The only tree whose opinion counts is the one you upload.

See [`../scripts/check-baseline.mjs`](../scripts/check-baseline.mjs) for the checker and how
to wire it into CI or a `postbuild` script.
