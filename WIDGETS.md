# WIDGETS.md — editing & adding gallery widgets

The Gallery (right panel) is the library of modules a rep drags onto a
client's page. This is the manual for changing what's in it.

**Importing a real widget from its preview link is the fastest route — see
§1.1.** Paste the link, press Import, Save. Everything else here is for
widgets you write by hand.

**The gallery starts empty.** There are no built-in widgets: what's in it is
what you (or your team's `custom-modules.js`) put there.

Two routes get a widget into the gallery. They share one validator, one CSS
scoper and one rendering path, so a widget behaves identically whichever route
you use — the only difference is where it's stored and who else can see it.

| Route | Where it lives | Survives | Editable in-app | Use it for |
|---|---|---|---|---|
| **A — in-app ＋ Add widget** | your own account (Supabase) | reloads, new browsers, new machines — anywhere you sign in | yes (✎ / ✕) | importing from a preview link (§1.1), drafting, one-off client-specific widgets, live tweaks during a call |
| **B — file** | [public/custom-modules.js](public/custom-modules.js) | everything; committed to the repo | no (duplicate ⧉ then edit the copy) | anything the team should have |

Eleven sample widgets (rating summary, review cards, trust badges,
testimonial, UGC gallery, Q&A, urgency bar, guarantee, press logos,
cross-sell, newsletter) sit unused in
[public/sample-modules.js](public/sample-modules.js) — see §3. They're the
best worked examples of the rules in this document.

The intended flow is **A → B**: shape the widget in the dialog with live
preview and validation, press **Copy as code**, paste into
`custom-modules.js`, then delete the in-app copy. This works for imported
widgets too — verified on a 109 KB capture, which round-trips byte-identically.

---

## 1. Route A — the ＋ Add widget dialog

1. Click **＋** in the Gallery header (or hover any card and click **⧉** to
   start from a copy of an existing widget — the original is untouched).
2. Fill in the fields:

   | Field | Required | Notes |
   |---|---|---|
   | **Product** | yes | **Reviews** or **Loyalty** — decides which gallery tab the widget lands in. Nothing is pre-selected on a new widget; Save stays disabled until you choose. |
   | **Name** | yes | Labels the gallery card, the hover chip and the Editor row. Keep it under ~48 chars. It's also what the gallery search matches against. |
   | **Description** | no | The grey line under the name on the card. |
   | **Widget id** | auto | Auto-slugged from the name (`Loyalty Points` → `loyalty-points`). Lowercase letters, digits, hyphens. Must be unique across all widgets; **fixed after the first save** (already-dropped instances are linked by it). |
   | **HTML** | yes | A markup *fragment*. Do **not** include a `<div class="dmb-module">` wrapper — the app adds one. |
   | **CSS** | no | Plain rules. Auto-scoped to the widget on save (see §4). |

3. Watch the right column: the **live preview** re-renders on every keystroke,
   and below it the validator lists blocking **errors** (red — Save stays
   disabled) and **warnings** (amber — allowed, but each one is a way the
   widget can look wrong on a real page). The preview shows the widget
   **twice — on a light store and on a dark one**, because the most common way
   a widget fails on a client's page is text that only reads on one of the two
   (see §1.1). Tick **site styling** to swap the box matching the loaded page's
   polarity for that page's own fonts and colors; it relabels itself "This
   page" and the other box keeps showing the opposite polarity.
4. **Save widget** → the card appears at the end of the gallery with a
   `custom` badge, and is immediately draggable. The gallery switches to the
   widget's product tab so you see it land.

Afterwards, on any `custom` card: **⧉** duplicate · **✎** edit · **✕** delete.
Editing re-renders every copy of that widget already dropped on the page.
Deleting does not — instances already on the page stay where they are.

**Copy as code** copies a ready-to-paste `registerModule({…})` call for
`custom-modules.js`. It works even before you save.

### 1.1 Import from a preview link

The top of the dialog takes the URL of a **widget preview page** — the link
your platform hands you to show a widget in isolation, e.g.

```
https://yap.yotpo.com/preview-wadmin/?guid=<guid>&widget_instance_id=<id>&is-mobile=false&mode-preview=true
```

Paste it, press **Import**, wait ~3 seconds. The app renders the preview
off-screen, waits for the widget to finish loading, and fills in Name,
Description, Widget id, HTML and CSS from what actually rendered. Then check
the live preview and press **Save widget**.

**Check both preview boxes before you save.** The widget is shown on a light
store and a dark one, and that pair is there to catch the one thing an import
gets wrong most often: text that reads on the store it was captured from and
disappears on the opposite one. Body copy should *flip* between the two boxes
(dark text on the light store, light text on the dark one). Text that stays
dark in both is fine **if** it sits on one of the widget's own frozen panels
— those keep their captured background, so their text is pinned to match (the
**blend** checkbox previews what dissolving them looks like). Text that fails
to flip while sitting on the page background is the real warning sign: it
means that color never got bridged, and the widget will be unreadable on half
of the stores you demo on. Re-capture it, and if it persists it's worth a bug
report rather than a live demo.

Two more things in that column:

- **blend** appears only for captures that carry frozen panels, and previews
  the **Blend** toggle (§1.1, "Frozen boxes"). It is a preview only — nothing
  about it is saved, and every dropped instance still starts on the faithful
  capture with its own reversible Blend button.
- **Re-capture** is what the Import button becomes once a capture has landed.
  A capture is a frozen snapshot, so re-running the same link is the fix for a
  render that came out wrong or half-loaded; editing the link turns the button
  back into **Import**.

The **Product** choice applies to imports too: pick Reviews or Loyalty (before
or after importing — the choice survives the form clear below) or Save stays
disabled.

Pressing **Import** clears the form first, so anything you'd typed or pasted
by hand is gone the moment you start an import — the fields only ever hold the
captured widget, never a mix of the two. (Importing while *editing* an existing
widget is the one exception: those fields are kept until the capture lands, so
a failed import can't wipe a saved widget's markup.) An empty form shows a
single neutral hint instead of red "required" errors.

What you get is a **static snapshot** — the widget exactly as it looked at
import time, frozen. That's deliberate: a demo canvas must not re-render or
re-fetch mid-call. It also means:

- **A new version of the widget = a new import.** Nothing updates itself.
  Import again to a new id and you have both versions in the gallery, which is
  usually what you want for an A/B on a call.
- **Images stay external** (the platform's CDN URLs are absolutized). They
  load on the client's page; they need a working network. This trips the
  self-contained-assets warning (§4) — expected for imports, ignore it.
  Photos a platform loads lazily (Yotpo's review photos, for instance) are
  forced to load during the capture, so they come along too — you should see
  every photo strip in the live preview that you see on the preview page.
- **Colors and fonts are bridged to the app's variables**, so an imported
  widget adapts to the client's brand like a hand-written one. The platform's
  theme properties are mapped on the way in:

  | Platform property | Becomes |
  |---|---|
  | `--primary-color` | `var(--dmb-accent)` |
  | `--stars-color` | `var(--dmb-star)` (stays amber by design) |
  | `--text-color` | `var(--dmb-text)` |
  | `--background-color` | `transparent` (the wrapper carries `--dmb-bg`) |
  | `--primary-font-family` | `var(--dmb-heading-font)` |
  | `--secondary-font-family` | `var(--dmb-font)` |

  The bridging also reaches the **store's own widget customizations** — the
  per-instance override CSS a platform writes for a store (hardcoded
  backgrounds, text colors, borders, brand fonts). Colors in the captured CSS
  and markup that match the instance's theme are mapped by their *role*: the
  theme background becomes transparent (your demo store's page shows through),
  theme text becomes `var(--dmb-text)`, and inverted elements (e.g. a
  white-on-black store's white buttons with black labels) become
  accent-on-accent-contrast. So a widget skinned for a dark store re-themes
  cleanly onto a light demo store and vice versa. Colors that aren't part of
  the theme (greys, shadows, photo artwork) keep their fixed values.
  Adding a mapping = one row in `CAPTURE_THEME_MAP` in `public/app.js`.

  **Loyalty widgets re-skin too, by a different route.** Reviews widgets declare
  the theme as the properties above. The loyalty family (Refer a Friend,
  points/spotlight widgets) writes its colors and fonts straight into the markup
  as literal values and declares no properties at all, so the app reads that
  instance's declared theme from the widget loader instead and maps it to the
  same roles: the card background becomes transparent so the client's page shows
  through, header/title/description colors all become `var(--dmb-text)`, and the
  button colors become `var(--dmb-accent)`. Fonts follow the same two slots —
  the widget's primary font is treated as the heading font, its secondary as
  body text.

  **Button corners come from the client's site too.** Platforms bake button
  shape into their own CSS, so the app re-points it: the CTA buttons in an
  imported widget use `var(--dmb-radius)`, which means square buttons imported
  from one store come out pill-shaped on a store with pill CTAs, and vice
  versa. Circular icon buttons are left alone.

  What an import does **not** inherit: font sizes, spacing, greys chosen for
  hierarchy, status colors and background artwork. Those stay as captured, so
  the widget still looks like the widget. One consequence worth knowing on a
  call: an outline button becomes the client's accent color, so dropping the
  widget into a section that is *already* that color makes the button blend in
  — set a background color on the widget and it pops back.

  **Frozen boxes have a Blend toggle.** When the source store pinned its own
  background colors on panels, filter pills or buttons (colors outside the
  widget's theme), the capture keeps them exactly as they were — on a store
  with the opposite polarity they read as solid light (or dark) boxes. Every
  inserted instance of such a widget gets a **Blend** button on its hover chip
  (and ▧ on its Editor row): one press dissolves those surfaces into the
  client's page — each becomes the same subtle page-relative tint it had on
  the source store, and the text on them switches from the frozen-legible
  color to the client's text color in the same press, so nothing goes
  unreadable. **Unblend** restores the faithful capture. Off by default;
  deliberately chromatic surfaces (brand-colored slabs) never blend.
- **Scripts and interactivity are dropped.** Filter dropdowns, "Read more",
  carousel arrows and pagination render but don't do anything. Links are
  neutralized so they can't navigate the canvas mid-demo.
- **The import is captured at the canvas's own desktop width (1280px)**, or at
  390px if the link says `is-mobile=true`. The widget's responsive CSS comes
  along, so a desktop capture still reflows in Mobile view.

The expected warnings on a Yotpo import are: external asset, literal
font-family, literal colors, un-prefixed classes. All four are inherent to
capturing someone else's rendered widget and none of them block Save.

**If the import fails**, the message says which stage failed. The two real
cases: the widget never finished loading its content (the app retries up to
twice on its own before telling you — open the link in a browser tab to confirm
it renders there at all), or the page had no widget on it (wrong link). An
import that produced only an empty widget skeleton is **rejected rather than
saved** — the count in the success message ("Captured 767 elements") is your
signal that real content came through.

**Check the preview before you save.** The app captures whatever the link
actually rendered, and it can't know that's the widget you meant: a preview URL
with an unknown `widget_instance_id`, for example, makes Yotpo render its
generic default widget — a perfectly real capture of the wrong thing. The
auto-filled name (taken from the widget's own class) and the live preview panel
are there for exactly that check.

Storage notes: widgets from this route are rows in your own gallery, private
to your signed-in account. They follow you to any browser and survive a cleared
profile — but nobody else can see them, and they are not in the repo. Promote
anything the whole team should have to route B, or hand it to one colleague
with the share link below.

Running locally without a `.env.local` there is no account to save to, so
widgets last only until you reload; the status line says so when a save has
nowhere to go.

### 1.2 Share an imported widget (⤴)

An imported widget's gallery card has a **⤴** button in its top-right corner
(alongside ⧉ ✎ ✕, visible on hover). One press copies a link to your clipboard:

```
https://yap.yotpo.com/preview-wadmin/?guid=…&widget_instance_id=…
  &utm_source=demo-modules-app&utm_medium=widget-share
  &utm_campaign=loyalty&utm_content=Refer%20a%20Friend&utm_term=Imported%20from%20yap.yotpo.com
```

It is the **preview link the widget was captured from**, with the widget's own
name, description and product line attached as UTM parameters. Paste it into
anyone else's ＋ dialog Import box and press Import: they get the same widget,
already named, described and filed under the same product — nothing to re-type,
and no way to file it under the wrong tab by accident.

Things worth knowing:

- **⤴ only appears on imported widgets.** A hand-written one has no link to
  share; its route out is **Copy as code** into `public/custom-modules.js`
  (route B).
- **Your edits to name, description and product travel; your edits to the
  markup do not.** The link carries metadata plus a capture URL, so the
  recipient re-renders the widget from the platform. If you have hand-edited the
  HTML or CSS, share the widget as code instead.
- **The capture itself is unaffected by the UTMs.** They're stripped before the
  preview page is rendered, so a shared link and the original link produce
  byte-for-byte the same widget — and re-sharing a widget you received produces
  a clean link, not a longer one.
- **A preview link that isn't one of ours is left alone.** Only links carrying
  `utm_source=demo-modules-app` are read; a merchant's own campaign tags on
  their preview link are never mistaken for a widget name.
- **The link is also visible when you edit a widget** — the Import box opens
  prefilled with it, labelled **Re-capture**. Re-capturing an existing widget
  refreshes its markup and styles and keeps the name and description you gave
  it.

---

## 2. Route B — public/custom-modules.js

Open [public/custom-modules.js](public/custom-modules.js) and add:

```js
registerModule({
  id: "loyalty-points",
  name: "Loyalty Points",
  desc: "Points earned on this purchase",
  product: "loyalty",   // "reviews" | "loyalty" — which gallery tab it lands in
                        // (omitted → "reviews"; anything else is an error)
  html: `<div class="dmbm-wrap">
    <div class="dmbm-lp">
      <strong>Earn 480 points</strong>
      <span class="dmbm-muted">Redeem for $12 off your next order</span>
    </div>
  </div>`,
  css: `
.dmbm-lp {
  display: flex; flex-direction: column; gap: 4px;
  max-width: 520px; margin: 0 auto; padding: 16px 20px;
  border: 1px solid var(--dmb-border);
  border-radius: var(--dmb-radius);
}
.dmbm-lp strong { color: var(--dmb-accent); font-size: 16px; }
`,
});
```

Reload the browser — that's the whole deploy step (the server sends
`Cache-Control: no-store`, so there's nothing to bust). The file ships with a
complete working example inside a comment block; delete the `/*` and `*/` to
see it in the gallery.

Errors and warnings for file widgets go to the **browser console**, prefixed
`[dmb] widget "<id>": …`. A widget with errors is rejected and simply won't
appear — always check the console after adding one.

---

## 3. The sample widgets (public/sample-modules.js)

The gallery ships empty, but the eleven widgets the app used to come with are
still in the repo, in [public/sample-modules.js](public/sample-modules.js).
**Nothing loads that file.** To put them back, uncomment its `<script>` line
in [public/index.html](public/index.html) (just above `custom-modules.js`) and
reload. They then arrive through route B — ordinary file widgets, validated,
scoped and rendered like anything else, so the eleven cards appear at the front
of the gallery and can be duplicated (⧉) and edited from there.

They're also the best worked examples of §4: zero external assets (CSS
gradients + inline SVG), every colour and font routed through a `--dmb-*`
variable, content in `.dmbm-wrap`, own classes prefixed `dmbm-`. Copying one as
the starting point for a new widget is faster than starting from a blank form.

Two things to know if you edit that file:

- All eleven share one stylesheet (`SAMPLE_MODULE_CSS`, blocks commented per
  widget: `/* Rating summary */`, …), attached to **every** entry as its `css`
  — widget CSS is scoped per widget (§4), so a single carrier entry would
  style only itself. It's scoped like any file-route CSS, so it can't touch
  the client's page (or another widget).
- Styling shared by *every* widget in the app (`.dmbm-h`, `.dmbm-btn`,
  `.dmbm-card`, `.dmbm-stars`, `.dmbm-wrap`, plus the variable defaults) is
  `DEMO_MODULE_BASE_CSS` in [public/modules.js](public/modules.js) — that one
  is hand-scoped, not auto-scoped, and changing it changes all widgets.

For a genuinely new widget, use route A or B. Adding one is never an edit to
`DEMO_MODULES` — that array is empty at startup and filled by
`registerModule()`.

---

## 4. The widget contract

Everything below is enforced or checked by `validateModuleDef()` in
[public/modules.js](public/modules.js). "Error" = rejected. "Warning" =
allowed but flagged.

### Structure

- **`html` is a fragment.** The app wraps it in `<div class="dmb-module">`,
  which is what carries the theme variables, the `all: revert` isolation and
  the hover/Hide/Remove plumbing. Declaring your own `.dmb-module` nests two
  wrappers → double padding and double background (*warning*).
- **Wrap content in `<div class="dmbm-wrap">`** (max-width 1080px, centred).
  Without it a widget dropped into a full-bleed page region runs edge to edge
  (*warning*).
- **No `<script>`** (*error*) and no `<html>/<head>/<body>` (*error*).
  Inserted markup never executes. The one inline handler worth using is
  `onclick="return false"` on demo links, purely to stop navigation — the
  samples and imported widgets both do that.
- **Don't use `id="dmb-…"` or `data-dmb-*` attributes.** They're the app's
  namespace: `data-dmb-id` / `data-dmb-kind` mark tracked elements, and
  section detection skips anything id-prefixed `dmb-`.

### Styling

- **Colors and fonts come from CSS variables.** This is the app's headline
  feature: on insert, the wrapper gets inline overrides sampled from the
  client's page (Adapt), and Revert removes them. A hardcoded color or font
  is invisible to both (*warning*).

  | Variable | Is | Use for |
  |---|---|---|
  | `--dmb-font` | body font of the host page | inherited automatically; don't set `font-family` yourself |
  | `--dmb-heading-font` | host `h1`/`h2` font | headings, big numbers, pull quotes |
  | `--dmb-text` | host body text color | body copy |
  | `--dmb-muted` | neutral grey | secondary copy, captions |
  | `--dmb-accent` | host button/CTA color | buttons, icons, emphasis, progress fills |
  | `--dmb-accent-contrast` | white or black, computed for legibility on the accent | text *on* an accent background |
  | `--dmb-border` | light neutral | card borders, dividers, empty track fills |
  | `--dmb-radius` | host button radius, clamped to 24px | corners; scale it with `calc(var(--dmb-radius) * .7)` |
  | `--dmb-bg` | the rep's colour-picker choice | already applied to the wrapper — don't override |
  | `--dmb-star` | fixed amber | star ratings only (deliberately *not* the accent) |

- **Prefix your classes `dmbm-`** (*warning* otherwise) so they can never
  collide with the client's CSS. Reuse the shared ones where you can:
  `dmbm-wrap`, `dmbm-h` (section heading), `dmbm-btn`, `dmbm-btn-ghost`,
  `dmbm-card`, `dmbm-stars`, `dmbm-muted`, `dmbm-verified`.
- **Your CSS is auto-scoped — to *your* widget**, whichever route it came in
  by. Every selector is prefixed with `.dmb-module.dmb-w-<your id>`, and that
  class is on your widget's wrapper wherever it renders (page, thumbnail).
  The `.dmb-module` half keeps your rules off the *client's* document (an
  unscoped `h2 { … }` would restyle their page); the `.dmb-w-<id>` half keeps
  them off *other widgets* — two imported widgets from the same platform
  share the platform's class names, and without the id scope one store's
  layout override restyles the other widget. Writing `.dmb-w-…` yourself is
  never needed. With `t` as the widget id:

  | You write | Becomes |
  |---|---|
  | `h2 { … }` | `.dmb-module.dmb-w-t h2 { … }` |
  | `.dmbm-a, .dmbm-b { … }` | `.dmb-module.dmb-w-t .dmbm-a, .dmb-module.dmb-w-t .dmbm-b { … }` |
  | `.dmb-module .dmbm-a { … }` | `.dmb-module.dmb-w-t .dmbm-a { … }` (retargeted) |
  | `:root`, `html`, `body` | `.dmb-module.dmb-w-t` (the wrapper *is* your root) |
  | `&.dmbm-x { … }` | `.dmb-module.dmb-w-t.dmbm-x { … }` |
  | `@media (…) { … }` | body scoped, condition untouched |
  | `@keyframes`, `@font-face` | untouched |

  Scoping is textual, not a hard boundary in the other direction: a host rule
  like `.product-page div { … }` can still leak *into* a widget. The
  pragmatic answer is the Revert button — see §9 of CLAUDE.md.

### Assets

- **Self-contained only** (*warning* otherwise). No image URLs, no icon
  fonts, no CDN scripts. Product and UGC imagery is CSS gradients, icons are
  inline `<svg>` with `stroke="currentColor"`, stars are the `★` glyph. This
  is why widgets render instantly, offline, and can't trip mixed-content or
  CORS on a client's page.

### Image slots (site imagery)

An **imported** widget gets one more thing automatically: a *slot manifest*
(`def.slots`) describing its image frames, so a rep can fill them with photos
harvested from the store being demoed (▣ in the Editor row, "Site photos" on
the hover chip). You don't author this — the capture measures it — but two
things are worth knowing.

- **The manifest travels with the markup.** Each frame carries a
  `data-dmb-slot="N"` attribute in the widget's HTML, and `def.slots` is what
  addresses them. If you hand-edit an imported widget's HTML, **don't strip
  those attributes** — the slots stop being addressable and the widget falls
  back to a weaker live re-walk. Duplicate (⧉), edit, Save and "Copy as code"
  all carry the manifest correctly on their own.
- **Two kinds of frame are never filled**, and the capture marks them
  `fill: false`: **avatars** (a review header's square frame is a face, and
  nothing in a store's image pool is one) and **brand marks** (stars, verified
  ticks, platform iconography). If a widget you're building by hand wants to
  opt a frame out, name its class accordingly — `avatar`, `logo`, `badge`,
  `verified`, `icon` and friends are what the matcher looks for.

Hand-written widgets don't participate: per the rule above they carry no
images, so there is nothing to swap. That is not a gap — a CSS-gradient
"product photo" is deliberate, and it adapts to the client's palette in a way
a real photo can't.

### Content

- Realistic, generic copy — named reviewers, plausible dates, "1,284
  reviews". A prospect should read it as a real integration, never as lorem
  ipsum. Avoid anything that dates fast or contradicts the client's category.
- The gallery thumbnail is your live HTML at `scale(.30)` in a 110px-tall
  box, so the first ~360px of the widget is what a rep actually sees. Lead
  with the recognisable part.

---

## 5. What I need from you to add a widget

If you're asking Claude (or a teammate) to build a widget, this is the
handoff. Items 1–4 are required; anything you leave out gets invented, which
usually means a round trip.

1. **What it is** — the widget's job in one line ("shows how many loyalty
   points this purchase earns"), plus a display **name** for the card.
2. **The content** — the actual copy, or explicit permission to write
   plausible filler. Include real numbers/labels if the demo depends on them
   (score, review count, price, delivery date, guarantee length).
3. **The layout** — a sketch, a screenshot, a reference URL, or a sentence
   ("icon left, two lines of text, button right; stacks on narrow"). A
   screenshot of the competitor widget you're replacing is the single most
   useful thing you can send.
4. **Permanent or throwaway** — route B (committed to
   `custom-modules.js`, everyone gets it) or route A (your gallery only). If
   you don't say, it goes in `custom-modules.js`.
5. **What must stay fixed** — by default *everything* adapts to the client's
   brand. Say so if some colour is non-negotiable (a certification badge's
   green, a partner logo colour); it becomes a literal instead of a variable.
6. **Where it's meant to land** — which section of which page you'll drop it
   into (buy box, below the gallery, above the footer). This decides width
   assumptions and whether it needs to work in a narrow column.
7. **Any imagery** — must be describable as a gradient, an inline SVG shape,
   or a glyph. A `.png`/`.jpg` URL can't be used (§4, Assets); send the shape
   and colours you want instead, or accept a gradient placeholder.
8. **Variants** — if you need "3-up" and "1-up" versions, say so up front;
   they're separate widgets, not one widget with options.

Copy-paste template:

```
Name:            Delivery Estimate
Purpose:         shows the order-by cutoff and arrival date
Route:           custom-modules.js (permanent)
Copy:            "Order in the next 4 hours" / "Arrives Thursday, March 19 —
                 free standard delivery" / button "Check my postcode"
Layout:          calendar icon left · two text lines · button right; wraps on mobile
Fixed colours:   none — adapt everything
Drop target:     just under the buy box on a Shopify PDP
Imagery:         inline SVG calendar icon only
```

There is no in-app "options" system: a widget is static markup, and its only
runtime knobs are the ones the app already gives every module — Adapt/Revert
and background colour. Anything else that needs to differ is a second widget.

---

## 6. Validation reference

Errors (block the widget):

| Message | Fix |
|---|---|
| `id is required` / `id "…" is invalid` | lowercase letters, digits, hyphens; max 40 chars |
| `id "…" is already used by "X"` | pick another id — ids are unique across file and in-app widgets |
| `name is required` | add a card label |
| `html is required` | add the markup fragment |
| `html must not contain <script>` | remove it; inserted markup never executes |
| `html must be a fragment` | drop the `<html>/<head>/<body>` tags |
| `product "…" is invalid` | must be `"reviews"` or `"loyalty"` (omitting it entirely defaults to reviews — except in the dialog, where the choice is mandatory) |

Warnings (allowed, but each one is a real symptom):

| Message | What actually happens |
|---|---|
| not wrapped in `dmbm-wrap` | widget runs edge-to-edge on full-bleed pages |
| declares its own `.dmb-module` | nested wrappers → double padding/background |
| references an external asset | may not load on the client's page; slow or broken in a live demo |
| sets `font-family` literally | Adapt/Revert can't reach it; widget stays off-brand |
| contains literal colors | same — won't pick up the client's brand (ignore this one for deliberate gradients/fixed brand marks) |
| un-prefixed classes | can collide with the client's CSS both ways |
| name longer than 48 chars | clipped on the gallery card |

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Gallery is empty | that's the default — it ships with no widgets | import one (§1.1), write one (§1), or enable the samples (§3) |
| Widget doesn't appear in the gallery | validation error, or a JS syntax error in `custom-modules.js` | check the browser console for `[dmb] widget "…" rejected:` and for a parse error |
| Appeared, but unstyled | the `css` was attached to a different widget's `registerModule()` call, or a selector typo | check the widget's rules exist in the `#dmb-custom-styles` sheet inside the canvas iframe |
| Widget restyles the *client's* page | a selector in `DEMO_MODULE_BASE_CSS` (the only CSS that isn't auto-scoped) | prefix it with `.dmb-module`; widget CSS from routes A/B can't cause this |
| Doesn't match the site after dropping | hardcoded colors/fonts | move them to `--dmb-*` variables |
| Looks right in the gallery, wrong on the page | host CSS leaking in (`.product-page div { … }`) | press **Revert CSS** (↺) on the instance; if it's chronic, tighten the widget's own selectors |
| Widget's *layout* changes when another widget is in the gallery (e.g. a review list goes side-by-side) | a session from before per-widget scoping — two same-platform imports share class names and their CSS used to share one scope | reload the app; CSS is re-scoped to `.dmb-module.dmb-w-<id>` on every load, nothing to re-import |
| Too wide / spills the column | missing `dmbm-wrap`, or a fixed `width` | wrap it; use `max-width` + `margin: 0 auto` |
| Edits to a widget don't show on the page | the instance predates a *route B* edit (only route A's Save re-renders instances) | reload the app, or remove and re-drop the instance |
| Widget vanished after clearing browser data | it was a route A widget | promote to `custom-modules.js` (**Copy as code**) |
| Import says the widget never finished loading | the widget's own loader stalled, or the preview needs data the link doesn't carry | it already retried once; open the preview link in a browser tab and confirm it renders there |
| Import says no rendered widget was found | not a widget-preview link (a normal store page, a dashboard, a login redirect) | use the preview URL the platform generates for the widget itself |
| Import says no rendered widget was found, but the link renders fine in a browser tab | a Yotpo *loyalty* link before this was fixed — small widgets were mistaken for an unfinished render | retry it; if it still fails, check the link is the widget preview shell and not an admin page that redirected to a login |
| Imported loyalty widget keeps the wrong brand colors and square buttons | a capture from before loyalty theming was bridged | delete the card and re-import the same preview link — a capture is a frozen snapshot, so old imports don't re-theme themselves |
| Imported widget's button is the right color but you can't see it | it took the client's accent and is sitting on a section that's already that color | set a background color on the widget (the swatch on its row or hover chip) |
| Imported widget shows a score/stars but no reviews | you're looking at a capture from before this was fixed — an untagged preview renders a skeleton | re-import; captures below the content bar are now rejected outright |
| Imported widget's images don't load | the platform's CDN is unreachable, or the client's page is offline | imports keep external image URLs by design (§1.1); nothing to fix locally |
| Imported widget has no review photos, or 2px-tall gaps where they belong | a capture from before lazy images were forced to load | re-import; every photo now loads during the capture |
| Imported dropdowns / "Read more" don't respond | scripts are never captured — imports are static snapshots | expected; if the interaction matters, import a preview that shows that state |
| Imported widget shows the *original* store's colors (e.g. a black slab on a light page) | a capture from before store-override CSS was theme-bridged | delete the card and re-import the same preview link — the capture is a frozen snapshot, so old imports don't heal themselves |
| Imported widget's dropdown/filter labels are invisible on a dark store while the reviews read fine | a capture from before floating-label text was re-anchored to its real backdrop (CLAUDE.md §8 #19) | delete the card and re-import the same preview link |
| Both preview boxes look identical — the "dark store" box isn't dark | the widget paints its own opaque background over the box (a captured `body`/`:root` background rule lands on the wrapper) | not a preview fault — it will do the same on a real dark store. Set a background colour on the instance, or drop the offending rule from the CSS box before saving |
| Imported widget carries light "boxes" (panels, pills, buttons) that clash with a dark store | the source store pinned those backgrounds outside its theme, so the capture keeps them frozen (faithfully) | hover the instance and press **Blend** (also ▧ on its Editor row) — subtle frozen surfaces dissolve into the site and their text follows; **Unblend** restores the original. No Blend button = the widget predates the toggle; re-import the link |
| `id "…" is already used` after promoting | the in-app copy and the file copy have the same id | delete the in-app copy (✕); the file version wins |
| Widget "missing" from the gallery | the other product tab is showing, or a search string is still typed in the box | switch the Reviews/Loyalty toggle (the counts show where widgets are), clear the search |
| Card thumbnail looks empty | the interesting part is below the visible ~360px | move the key content to the top of the widget |

Scripted checks in the app console (`DMB` is the debug surface):

```js
DMB.captureFromPreview("<preview url>", console.log)  // import without the dialog
DMB.modules.map(m => m.id + " · " + m.source)      // what's registered
DMB.validateModuleDef({id: "x", name: "X", html: "<div class='dmbm-wrap'>hi</div>"})
DMB.scopeModuleCss("h2 { color: red }")            // → ".dmb-module h2 { color: red }" (direct calls default to the bare scope; registered widgets get .dmb-module.dmb-w-<id>)
DMB.addWidget({id: "x", name: "X", html: "…", css: "…"})  // route A, persisted
DMB.updateWidget("x", {html: "…"});  DMB.removeWidget("x")
DMB.openWidgetEditor({from: DMB.modules[0]})       // open the dialog prefilled
DMB.insertModule("x", {ref: DMB.state.sections[3].el, where: "after"})
DMB.setGalleryProduct("loyalty")                   // switch the gallery tab
DMB.setGallerySearch("points")                     // filter cards by name

```

---

## 8. Before a live demo

1. Reload the app; console clean of `[dmb]` errors and warnings.
2. Widget's card shows the right name, description and a legible thumbnail.
   For an import, that check happened in the dialog: body copy flipped between
   the light and dark preview boxes (§1.1).
3. Load a real client-style PDP (Allbirds and Brooklinen are the two sample
   themes — black CTA/sans vs navy CTA/serif) and drop the widget into the
   position you'll use on the call.
4. Check it adapted: fonts, text colour, button colour, corner radius. Toggle
   **↺ Revert** and **✦ Adapt** to be sure both states look presentable.
5. Set a background colour on it once — the other live-tweak a rep does.
6. If the widget has photos and the badge in the top bar reads
   *N site images*, try **▣ Site photos** once on the page you'll demo. Check
   the reviewer avatars stayed stock, that roughly two thirds of the photos
   swapped rather than all of them, and that nothing landed with visible
   marketing text cropped into it. If a picture reads wrong, press **⟳** on
   the hover chip for a different draw — that's the intended fix, and it's
   fast enough to do mid-call. Toggle it back off if none of them work.
7. Switch to **Mobile** (390px) and confirm nothing overflows.
8. Confirm the widget's row appears in the Editor tree at the position you
   dropped it, and that **✕** removes it cleanly.

---

## 9. Where the code is

| Concern | Location |
|---|---|
| Import from a preview link | `captureFromPreview` / `captureAttempt` / `waitForRender` / `snapshotHtml` in [public/app.js](public/app.js), plus `CAPTURE_BOOTSTRAP` in [server.py](server.py) |
| The live gallery list & the shared widget CSS | `DEMO_MODULES` (empty at startup), `DEMO_MODULE_BASE_CSS` in [public/modules.js](public/modules.js) |
| The eleven sample widgets (not loaded) | [public/sample-modules.js](public/sample-modules.js), enabled by a `<script>` line in [public/index.html](public/index.html) |
| Registration, validation, CSS scoping, code export | the "Widget registry" section at the bottom of [public/modules.js](public/modules.js) |
| File-route widgets | [public/custom-modules.js](public/custom-modules.js) |
| Gallery rendering, card actions, CSS sync into both documents | `renderGallery` / `buildGalleryCard` / `syncCustomCss` in [public/app.js](public/app.js) |
| Share links (⤴): build, recognize, strip | `widgetShareUrl` / `parseWidgetShareUrl` / `stripShareParams` in [public/modules.js](public/modules.js); `shareWidget` and the pre-fill in `wzImport` in [public/app.js](public/app.js) |
| The ＋ dialog (open, preview, validate, save, persist) | the "widget editor" section of [public/app.js](public/app.js) |
| The light/dark preview pair, blend preview, Re-capture label | `wzRefresh` / `WZ_PREVIEW_PALETTES` / `wzHostPolarity` / `wzSetImportLabel` in [public/app.js](public/app.js), `.wz-pv` in [public/app.css](public/app.css) |
| Dialog & card styling | `/* ---------- Widget editor ---------- */` in [public/app.css](public/app.css) |
| Site imagery: harvest, classify, match, swap | [public/imagery.js](public/imagery.js) (`window.IMAGERY`) |
| Site imagery: slot capture, the toggle, the badge | `stampSlots` call in `captureAttempt`, `toggleImagery` / `imageryTargets` / `renderImageryBadge` in [public/app.js](public/app.js); removal notes in [ROLLBACK-IMAGERY.md](ROLLBACK-IMAGERY.md) |
| Insert / Adapt / Revert / background | `insertModule`, `toggleAdapt`, `setModuleBg` in [public/app.js](public/app.js) |

Architecture background — why the canvas is a same-origin proxy, why page
scripts are stripped, how sections are detected and how CSS adaptation works
— is in [CLAUDE.md](CLAUDE.md) §3–§5.
