# CLAUDE.md — Yotpo Looks

Guidance for Claude (and any developer) working on this codebase. Read this
before changing anything; it explains not just *what* the code does but *why*
it is shaped the way it is.

---

## 1. What this app is

An interactive sales-demo tool. A sales rep pastes the URL of a prospect's
product detail page (PDP), the app renders that real page inside a canvas,
automatically detects its sections ("modules"), and lets the rep:

1. **Hide** competitor modules (e.g. a rival review widget) via hover controls.
   Editor rows **expand (▸)** to reveal the sub-sections inside a detected
   section — e.g. just the star-rating line inside a product buy box — which
   can be hidden (and dropped between) individually.
2. **Drag & drop** our own demo modules (reviews, trust badges, testimonials…)
   from a gallery into any position on the page — including between
   sub-sections inside an expanded section.
3. Watch the dropped module **automatically inherit the host site's styling**
   (font, text color, accent/button color, corner radius) so it looks native.
4. **Revert** a module to its default styling if the inherited CSS clashes.
5. Recolor a module's **background** — deliberately the *only* other
   customization, to keep live demos fast and un-fiddly.
6. Switch the canvas between **Desktop and Mobile viewports** (top bar
   toggle), and **collapse the Gallery** (arrow in its header) for more
   canvas real estate.
7. **Add their own widgets** to the gallery, which ships **empty** — ＋ in the
   Gallery header opens a paste-HTML/CSS editor with live preview and
   validation (stored in the browser), or drop a `registerModule()` call into
   `public/custom-modules.js` for something the whole team gets. Authoring
   rules live in **WIDGETS.md**; the mechanism is §5.8.
8. **Import a real widget by pasting its preview link** — the same dialog
   takes a platform widget-preview URL, renders it off-screen, and snapshots
   the rendered result into a static gallery widget that adapts to the host
   page like a hand-written one (§5.9).
9. **Hand an imported widget to a colleague** — ⤴ in the corner of its gallery
   card copies the capture link with the widget's name, description and product
   attached as UTM parameters; pasting it into another rep's Import box
   re-captures the widget with those fields already filled (§5.12).
10. **Fill an inserted widget's photos with the client's own imagery** — the
   app harvests usable images from the loaded page and a per-instance toggle
   (▣ in the Editor row, "Site photos" on the hover chip) swaps them into the
   widget's image frames, matched by role first and shape second. Off by
   default, reversible, never applied to faces or brand marks (§5.11).

The success bar: URL → convincing, native-looking demo in under 5 minutes.

Primary use cases:
- **Competitive replacement** — hide the competitor's review module, drop ours
  in the same slot, show the client "this is what switching looks like".
- **Enhancement** — add social proof modules to a bare PDP.
- **Live personalization** — tweak module background to the client's brand
  color during a call.

---

## 2. How to run it

```bash
python3 server.py
```

Then open **http://localhost:4173**. Port comes from `$PORT` (default 4173).

There is no build step, no package manager, no dependency installation. Edit a
file, reload the browser, done. The server sends `Cache-Control: no-store` on
*everything* precisely so reloads always pick up edits (see §8, bug #2).

**There is also a hosted deployment now** (2026-08): GitHub →
`leonardovacavliev-ai/yotpo-looks` → Vercel, with Supabase for Google login and
the per-user widget gallery. Setup is **DEPLOY.md**; the architecture of what
changed is §3.1 and §5.13. Two properties of the local build survive the move
and are worth defending:

- `python3 server.py` still runs the whole app with **zero installs and no
  configuration**. Without a `.env.local` there is no login, no saved gallery
  and an open proxy — exactly the tool as it was. The gate turns itself on only
  where it is needed (`auth_required()` keys off `SUPABASE_URL` existing).
- The proxy is **one implementation, two entry points**: `api/_proxy_core.py`
  holds all of it, `server.py` and `api/proxy.py` only turn a `Result` into
  bytes. Fix a rewrite bug once and both get it. Do not let these drift by
  "quickly" patching one side.

### Shipping a change (read this before doing anything clever)

**The live app is https://yotpo-looks-beta.vercel.app** and it redeploys itself
from `main`. There is no deploy command, no CLI, no dashboard step:

```bash
git push        # ~60s later it is live
```

Vercel watches the GitHub repo (`leonardovacavliev-ai/yotpo-looks`) and rebuilds
on every push to `main`. Push credentials are in the Mac's keychain, so this
works unattended — **which also means a careless `git push` is a production
deploy.** Work on a branch if a change is not ready to be seen by whoever is
mid-demo.

Two things that are *not* in the repo and therefore never change by pushing:

- **Environment variables** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `ALLOWED_EMAIL_DOMAINS`, `ALLOWED_EMAILS`) live in the Vercel dashboard.
  Editing one requires a **manual redeploy** — Vercel does not apply new values
  to an existing deployment.
- **The database schema.** `supabase/schema.sql` is a record of what was run,
  not something that runs itself. Changing it means pasting the change into the
  Supabase SQL editor by hand.

The owner is **not technical**. Explain in plain language, one step at a time,
and never hand over a wall of dashboard instructions — check what can be
verified from here (`curl` the live `/api/config`, the GitHub API, a proxy
fetch) before asking them to go and look at something.

### Environment constraints (important!)

- **This machine has no Node.js, no npm, no Homebrew.** Only system Python
  3.9.6 at `/usr/bin/python3`. That is *the* reason the backend is a single
  Python file using only the standard library. Do not introduce npm packages,
  `pip install`s, or a bundler unless the user explicitly says the environment
  has changed. Keep Python code 3.9-compatible (no `match`, no `X | Y` type
  syntax).
- **The Claude desktop preview launcher cannot read `~/Downloads`**
  (macOS TCC gives "Operation not permitted"). So `.claude/launch.json` has
  two configs:
  - `demo-builder` — runs `python3 server.py` directly. **Fails** when
    launched by the preview tool (permissions), works from a normal terminal.
  - `demo-builder-attach` — URL-only config that attaches to an
    already-running server. **Use this from Claude**: start the server via a
    background Bash command, then `preview_start` with `demo-builder-attach`.

---

## 3. Architecture — the one decision everything hangs on

**Problem:** virtually every store sends `X-Frame-Options: DENY/SAMEORIGIN`
and/or CSP `frame-ancestors`, so you cannot iframe their PDP directly. And
even if you could, a cross-origin iframe's DOM is untouchable — no section
detection, no hiding, no inserting.

**Solution:** a local **proxy**. `GET /proxy?url=<pdp>` fetches the page
server-side with browser-like headers, rewrites the HTML, and serves it from
`localhost:4173`. Consequences, all deliberate:

1. The iframe content is now **same-origin** with the app. `app.js` reaches
   straight into `iframe.contentDocument` — no `postMessage` protocol, no
   script injection via the server, no serialization layer. This is the single
   biggest simplifier in the codebase. If you ever change the proxy origin,
   almost everything in `app.js` breaks.
2. Frame-blocking is gone because *we* author the response headers.
3. Relative asset URLs still resolve against the original store because the
   proxy injects `<base href="<final URL after redirects>">` as the first
   element of `<head>`. Images/CSS/fonts load *directly* from the store's CDN
   (not proxied) — fine, because static assets aren't frame-restricted and
   `getComputedStyle` works regardless of where a stylesheet came from.

### Page scripts: strippable, but on by default

The proxy removes all `<script>` tags unless `&scripts=1`. The **JS checkbox**
in the top bar controls that flag and is **checked by default** (2026-08, user
request: "make it so that the js toggle is pre-selected"), so the normal load is
`scripts=1`. Hosting briefly reversed this — see §3.1 item 1 for why, and for
why it was reversed back; the security machinery it describes is all still in
place and still does its job on the unticked path. Both sides of the trade-off
are real, which is why the switch exists at all:

*Stripping* gives a stable canvas: hydration frameworks (React/Vue themes)
re-render and would **wipe our inserted modules and hidden-section state** at
unpredictable moments, JS-based frame-busting
(`if (top !== self) top.location = ...`) dies with the scripts, and most
e-commerce PDPs (Shopify, WooCommerce, Magento) are server-rendered so the page
still looks right without JS. Cost: lazy-loaded images and client-rendered
widgets don't materialize — the client-side lazy-image fixup (§5.2) only
partly compensates.

*Keeping* them gives a faithful page — the case a rep hits most often — at the
risk of a re-render eating an edit. Expect the store's own console errors
(Allbirds' cart drawer can't fetch cross-origin, for example); they're the
page's, not ours, and harmless for a demo. If inserted modules disappear or
hidden sections come back, untick JS and reload; that's the documented escape
hatch, and it belongs to the user.

### Why the frontend is vanilla JS

No framework because: (a) nothing to install it *with* (no npm), (b) the app
is one screen with a small amount of state, (c) most of the interesting logic
runs against a *foreign* DOM (the loaded page) where a framework wouldn't help
anyway. State lives in one plain `state` object; the Editor panel re-renders
wholesale via `renderEditor()` — it's a small list, so no diffing needed.

One exception since the app went hosted: `auth.js`, `boot.js` and `store.js`
are ES modules, because supabase-js is consumed as ESM straight from a CDN
(still no npm, still no build step). `boot.js` is the bridge — it does the
module-world work, hands the session and the store to the classic-script world
on `window`, and only then loads the four original scripts. The app itself was
not converted and should not be.

### 3.1 The same-origin proxy, once there is a session to steal

Hosting turned §3's central trade-off into a security decision. The proxied
page is same-origin with the app *by design* — that is what makes
`iframe.contentDocument` reachable and it is the single biggest simplifier in
the codebase. It also means a store's own JavaScript runs in the origin that
holds the signed-in user's Supabase session.

There is no clever escape. Moving the proxy to another origin, sandboxing away
`allow-same-origin`, `srcdoc`, `document.write` — every variant that removes
the risk also removes `contentDocument`, and with it section detection,
hiding, insertion and adaptation. The app *is* the same-origin trick.

So the answer is to make the safe mode genuinely safe and the unsafe mode
explicit:

1. **The JS toggle defaults ON again** (2026-08, user request: "make the JS
   toggle pre-selected when adding a URL to load"), reversing the hosted
   default this section originally argued for. It was flipped OFF at migration
   because default-on means **every** page load runs a third party's code next
   to a live session, not just the loads a rep opted into; it was flipped back
   because client-rendered PDPs look empty without it and unticking-then-
   reloading on most demos was the bigger day-to-day cost. That trade is the
   owner's call and it has been made — but it is a *decision*, not a default
   nobody looked at, so do not quietly re-flip it in either direction. What
   still holds the line: the sandbox below is real whenever the box is
   unticked, and the status line explains the trade on every switch.
2. **`sandbox="allow-same-origin"` with no `allow-scripts`** on the canvas
   iframe when JS is off. This is the enforcement — the browser guarantees what
   a regex only approximates, and it kills inline handlers, `javascript:` URLs
   and `srcdoc` along with `<script>`. We keep full DOM access. Verified: 11
   sections detected on Allbirds with zero store globals present.
   The attribute is only read **when the frame navigates**, so
   `applyCanvasSandbox()` must run *before* `iframe.src` is assigned.
   With JS on, both tokens are present, which by spec disables the sandbox
   entirely — that is the honest representation of what the rep asked for.
3. **The server strips the other three execution routes** when `scripts=0`
   (`INLINE_HANDLER_RE`, `JS_URL_RE`, `SRCDOC_RE` in `_proxy_core.py`). Second
   layer, and the only layer the capture frame gets.
4. **The capture frame is not sandboxed and cannot be.** An import only works
   if the platform's loader runs (`&scripts=1`) *and* the result is readable
   (same-origin) — precisely the combination with no sandbox. What limits it is
   that the frame is short-lived, points at a URL the rep typed, and is torn
   down by `abortCapture()`.

What is still accepted: with JS on, a malicious store page can read the
session. The mitigation that would close it — a server-side OAuth exchange
keeping the refresh token in an HttpOnly cookie — was scoped and deferred
(2026-08, user choice), and it would still leave that page able to call the API
as the user. Do not describe the current state as "solved"; it is *confined to
an explicit opt-in*.

---

## 4. File map

```
server.py                 Local dev server: static files + /proxy + /api/config.
                          Thin — the proxy itself lives in api/_proxy_core.py
api/
  _proxy_core.py          THE proxy: fetch, rewrite, capture bootstrap, the
                          session gate, the allowlist. Shared verbatim by
                          server.py and the Vercel function. Underscore-prefixed
                          so Vercel treats it as a helper, not a route
  proxy.py                Vercel entry point for /proxy (bytes only)
  config.py               Vercel entry point for /api/config — hands the browser
                          the Supabase URL, anon key and allowlist from env vars,
                          because a no-build-step site can't read them any other way
vercel.json               Static root = public/, /proxy -> /api/proxy, no build
supabase/
  schema.sql              widgets + allowlist tables, RLS policies, email_allowed()
DEPLOY.md                 GitHub -> Vercel -> Supabase -> Google OAuth setup
.env.local.example        Template for local Supabase settings (.env.local is
                          gitignored; without one the app runs as it always did)
public/
  index.html              Three-panel shell: Editor | Browser | Gallery
                          + the widget-editor dialog markup. Loads exactly one
                          script (boot.js) — the app's own four are loaded from
                          there, after the session check
  login.html              The only page a signed-out visitor can reach. Google
                          sign-in, allowlist verdict, self-contained styling
  boot.js                 (module) The front door: prove a session, expose
                          window.DMB_STORE / DMB_USER, then load the app's
                          classic scripts in order. Holds the load list,
                          including the commented-out sample-modules.js switch
  auth.js                 (module) supabase-js from CDN, session, allowlist,
                          and the cookie the proxy checks
  store.js                (module) The widget gallery's CRUD against Supabase,
                          plus the one-time lift of a pre-hosting localStorage
                          library into the account
  app.css                 App chrome styling (dark theme) — NOT module styling
  modules.js              Module base CSS (the --dmb-* variable defaults and
                          shared dmbm- classes) + the widget registry
                          (validate/scope/register) + share-link build/parse
                          (§5.12). Ships no widgets.
  custom-modules.js       Extension point: team-owned widgets, committed
  sample-modules.js       The 11 widgets the app used to ship with — NOT loaded
                          (commented-out entry in boot.js's APP_SCRIPTS, which
                          is where index.html's script tags went); reference
                          implementations and a one-line restore (§5.4)
  imagery.js              Site imagery (§5.11): harvest the loaded page's
                          images, classify them, find a widget's image slots,
                          match and swap. Self-contained — exposes
                          window.IMAGERY and calls nothing in app.js
  app.js                  All behavior: load, detect, hover, DnD, adapt, editor
  logo.png                The brand mark (384², black ink on transparent, with
                          an opaque white cursor fill) — the only binary asset
                          in the app. Used twice, both small: the topbar brand
                          and the favicon. It is a *cropped* export (the source
                          drawing had ~40% empty margin, which at 28px rendered
                          the mark uselessly small). It was also tried at 72px
                          in the canvas empty state and pulled back out
                          (2026-08, user request): the ink is asymmetric — the X
                          sits left, the cursor juts right — so at that size it
                          reads as mis-centered above centered text, however it
                          is aligned. Treat it as a small mark
  (no other assets — icons are inline SVG/emoji, thumbnails are CSS gradients)
.claude/launch.json       Preview configs (see §2)
README.md                 User-facing quick start
WIDGETS.md                How to add/edit gallery widgets (the contract)
CLAUDE.md                 This file
```

---

## 5. Component deep-dive

### 5.1 `server.py`

- `ThreadingHTTPServer` + `SimpleHTTPRequestHandler` subclass. Static files
  come from `public/` via the stock handler (`directory=` arg).
- `end_headers()` is overridden to add `Cache-Control: no-store` globally.
- `/proxy` flow: validate URL → `fetch()` with Chrome-like headers →
  (the flow below; `&dmb-capture=1` additionally injects `CAPTURE_BOOTSTRAP` —
  see §5.9) →
  decompress (gzip/deflate — **brotli is deliberately not in
  `Accept-Encoding`** because the stdlib can't decode it; don't add `br`) →
  if non-HTML, pipe through unchanged → decode using charset from
  Content-Type (fallback utf-8, `errors="replace"`) → `rewrite_html()` → send.
- `rewrite_html()` does five regex passes:
  1. strip `<script>...</script>` and self-closing scripts (unless `scripts=1`)
  2. strip `<meta http-equiv>` for CSP, refresh, and X-Frame-Options
     (meta-refresh would navigate our iframe away; meta-CSP could block
     inline styles we inject)
  3. strip `integrity=` attributes (subresource integrity can fail once we've
     touched the document; assets still load fine without it)
  4. remove any existing `<base>` tag
  5. inject our own `<base href="<final redirect URL>">` right after `<head>`
     — the *final* URL matters: redirects (e.g. to a locale path) change what
     relative URLs must resolve against. With `&dmb-capture=1`,
     `CAPTURE_BOOTSTRAP` is appended to that same injection so it becomes the
     document's **first script** (§5.9 — it has to beat the page's own). It
     does two things, both of which must run before any page script: tag widget
     mounts `mode-preview="true"`, and replace `IntersectionObserver` with a
     stub that reports every observed element as intersecting, so lazy content
     loads eagerly (§8 #8).
- Regex-over-HTML is a conscious choice: Python 3.9 stdlib has no lenient
  HTML5 parser, and these five transformations are shallow enough that regex
  is reliable in practice. If rewriting ever needs to get structural
  (rewriting every `href`, sandboxing inline handlers), revisit this.
- SSL: `fetch()` retries once with an **unverified** context if certificate
  verification fails — Apple's bundled Python sometimes has broken CA paths.
  Acceptable because we only render public storefronts for display; do not
  copy this pattern anywhere credentials or private data could flow.
- Error responses are human-readable HTML because they render *inside the
  canvas iframe* where the user will actually see them.

### 5.2 `app.js` — page pipeline

`loadPage(url)` sets `iframe.src = /proxy?...`. On the iframe `load` event we
wait **700 ms** before `initPage()` — section detection is geometry-based and
needs fonts/images to have laid out. If detection quality is ever poor on
slow-loading pages, raise this or re-run detection on demand; don't remove it.

`initPage()` order matters:
1. Inject one `<style id="dmb-styles">` into the loaded page containing:
   overlay UI CSS (`IFRAME_UI_CSS`) + `DEMO_MODULE_BASE_CSS`. Per-widget CSS is
   *not* here — it changes at runtime and lives in `#dmb-custom-styles` (§5.8).
2. `fixLazyImages()` — promotes `data-src`/`data-srcset`/`data-lazy-src`/
   `data-original` to real `src`/`srcset` (and `<source data-srcset>`), forces
   `loading=eager`. Compensates for stripped lazy-load JS. Only replaces `src`
   when the current one is missing or a `data:` placeholder.
3. `detectSections()` — see below.
4. `sampleHostStyles()` — cached once per page load in `state.host` (§5.3).
5. `setupChip()` / `setupDragDrop()` — event wiring on the iframe document.
6. `renderEditor()`.

**Section detection** (`detectSections`) is a DFS over `body` deciding for
each significant child: *descend* or *emit as a section*.

- "Significant" = not in `SKIP_TAGS`, not our own UI (`id` starting `dmb-`),
  not `display:none`/`visibility:hidden`, **not `position:fixed`** (sticky
  headers/cookie banners aren't sections you insert between), and at least
  40px tall × 120px wide (filters spacers and tracking pixels).
- Descend into a child when *any* of: it's a structural tag
  (`MAIN`/`ARTICLE`/`FORM`); it's a **single-child pass-through wrapper**
  (exactly one significant kid covering >80% of its height — the endless
  `<div class="page-wrapper">` pattern); or it's a **huge container**
  (taller than 1.4 viewport-heights with ≥2 significant kids — a page-length
  wrapper that should be split). Depth cap 6.
- Everything else is emitted. DFS order = document order, which the Editor
  relies on.
- These thresholds (40px, 120px, 0.8, 1.4×vh, depth 6) are empirically tuned
  on Allbirds (17 sections) and Brooklinen (20 sections). Tune them against
  real pages, not in the abstract — a change that helps one theme regularly
  hurts another.
- Each section gets `data-dmb-id="host-N"` + `data-dmb-kind="host"` attributes
  on the *live element*; state keeps `{id, el, name, tag, hidden}`. Elements
  are held by reference — nothing is looked up by selector later.

**Sub-section detection** (`runSubDetection`, driven by `toggleExpand`): the
Editor is a *tree* — expanding a host row lazily detects **one level** of
blocks inside that element and registers them as ordinary host entries
(`parent`/`depth` set, ids from the same `hostCounter`). Because they're
ordinary entries with `data-dmb-id`, the hover chip, Hide, drop anchoring and
re-detection all work on them with zero special cases. Design points:

- Smaller thresholds than top-level (18×60 vs 40×120) so compact rows — a
  star-rating line, a price row — qualify. Same `isSignificant`, extra params.
- Descends through single-child pass-through wrappers (same 0.8 rule) and
  through `display: contents` wrappers (Shopify custom elements like
  `<product-rerender>` — they have a 0×0 rect, so the significance check
  would otherwise kill the walk; found on bedrop.de).
- If a level yields exactly **one** sub-section it drills deeper until the
  split is meaningful — a lone full-height child is a useless level to offer.
- Detection runs once per entry (`subsChecked`); "no children" replaces the
  caret with a spacer. Already-tagged elements (`data-dmb-id`) are never
  re-emitted, so expand/collapse is idempotent.
- Drops use sub-sections as anchors automatically (they're in
  `state.sections`). `insertionPointAt` adds a **horizontal penalty**
  (distance from pointer X to the anchor's x-range) because side-by-side
  columns put anchor edges at the same Y — without it, drops inside a buy-box
  column could snap to the gallery column. Full-width sections are unaffected
  (penalty 0 when the pointer is inside the x-range).
- `insertModule` auto-expands the ancestor chain around a drop so the new
  demo row is visible in the tree.

**Naming** (`nameFor`) tries, in order: heading text when the element *is* an
`h1–h6` (sub-section granularity reaches individual headings, and the pattern
table would mislabel them); then regex patterns over
`id + className + tagName` (the `NAME_PATTERNS` table maps e-commerce
vocabulary — `yotpo|okendo|judgeme|stamped|loox` → "Reviews", `add-to-cart` →
"Product info & buy box", etc.); first `h1/h2/h3/[role=heading]` text
(truncated to 42 chars); semantic tag names; finally "Section N". Pattern
order matters — more specific patterns sit above generic ones (`review`
before `product`). When a page shows too many bare "Section N" rows, the fix
is usually a new pattern row, not algorithm surgery.

**Hover chip** (`setupChip`): one floating `#dmb-chip` div appended to the
loaded page's `<body>`, repositioned on `mouseover` (delegated on the
document, resolved via `closest('[data-dmb-id]')`) and on scroll. Host
sections get a **Hide** button; demo modules get **color input / Revert‑Adapt
toggle / Remove**, plus a **Blend/Unblend** toggle when the widget's import
found blendable frozen surfaces (`def.flattenable`, §5.9). Design constraints
that must survive refactors:

- The chip is **not** a child of the hovered section. Injecting children into
  arbitrary site DOM breaks `:nth-child` CSS and occupies flex/grid tracks.
  Same reason hiding uses a class (`.dmb-hidden { display:none !important }`)
  rather than removing nodes — removal would break "Show" restore and
  sibling-selector styling.
- Hover highlight is `outline` (via `.dmb-hover`), never `border` — outline
  doesn't affect layout.
- Chip CSS uses `!important` liberally and `all: unset` on buttons because it
  lives inside a hostile stylesheet universe.
- `mouseover`/`mousemove` checks `chip.contains(e.target)` first so the chip
  doesn't dismiss itself while you reach for its buttons.
- `positionChip` clamps with the chip's **measured** `offsetWidth`, which
  requires making it visible *before* positioning (a `display:none` element
  measures 0; same JS task, so no flash). It used to assume a 240px constant,
  and the first added button (Blend) pushed the chip's tail off the canvas
  edge — every hover looked "cut off". Don't reintroduce a width constant.
  Buttons that appear and disappear *while the chip is open* (Shuffle, §5.11)
  must re-run `positionChip` after they change, for the same reason.
- **Vertically the chip is clamped three ways, and all three are load-bearing**
  (§8 #20). It wants to sit just inside the hovered element's top edge; once
  that edge scrolls off it sticks near the top of the viewport so it stays
  reachable on a taller-than-screen widget; and it never goes past the
  element's *bottom* edge, because the chip labels that element and must not
  slide down over whatever follows. The sticky position is offset by
  `topChromeHeight()` — the height of the **store's own** `fixed`/`sticky` top
  chrome, measured by hit-testing `elementsFromPoint` at three x positions
  rather than by selector, since every theme names its header differently but
  they all occupy the same place. Without that offset the chip parks
  underneath the store's header, and reaching for it means crossing onto the
  header, which is not the widget, so the chip dismisses itself: the buttons
  become physically unclickable. Two guards to keep: our own `dmb-` overlay
  elements are skipped (the chip would otherwise measure itself), and a
  measurement taller than a third of the viewport is discarded so a cookie
  wall or modal can't push the chip off-screen — but only when the viewport
  height is actually known, because a frame reporting 0 would otherwise make
  every measurement "too tall" and silently switch the clamp back off.

**Drag & drop** (`setupDragDrop`): gallery cards set
`dataTransfer.setData('text/plain', 'dmb:<moduleId>')`. Plain text is used
because custom MIME types are flaky across the parent-document → iframe
boundary; the `dmb:` prefix is the discriminator, and `drop` ignores anything
without it. During `dragover` (data is unreadable then — HTML5 spec — only
`types` is visible) we compute the insertion point: over all *visible* anchors
(sections + already-inserted demos, document-sorted via
`compareDocumentPosition`), find the nearest top/bottom edge to the pointer's
`clientY`, yielding `{ref, where: before|after}`. A `#dmb-indicator` line is
absolutely positioned at that boundary (`rect + scrollY` — page coordinates,
not viewport). The point is stashed in `state.pendingDrop` because `drop`
needs it after the fact. Insertion is
`ref.parentNode.insertBefore(module, ...)` — the module becomes a real
sibling in the page flow, which is exactly what makes it look native.

### 5.3 CSS adaptation — the headline feature

Every module is a `div.dmb-module.dmb-w-<widget id>` whose entire look flows
through CSS custom
properties (`--dmb-font`, `--dmb-heading-font`, `--dmb-text`, `--dmb-accent`,
`--dmb-accent-contrast`, `--dmb-border`, `--dmb-radius`, `--dmb-bg`,
`--dmb-star`). `DEMO_MODULE_BASE_CSS` declares neutral defaults on
`.dmb-module` (shared by every widget); the widget's own CSS is scoped to the
`.dmb-w-` class (per-widget — §5.8, §8 #18).

**Adapt** = set inline custom-property overrides on the wrapper from the
sampled host palette. **Revert** = `style.removeProperty()` those same
properties, falling back to the stylesheet defaults. That's the whole
mechanism — no second stylesheet, no class swapping, no cloning. If you add a
themable visual attribute to any module, it *must* be routed through a
variable or Revert won't touch it.

`sampleHostStyles(doc)` (once per page):
- **every sanity check is relative to the page's own background** (§8 #11):
  body/html `backgroundColor` (first with alpha ≥ .5, else white) is sampled
  first, and "wrong" means *too little contrast against it* — never a fixed
  luminance cap, which was a light-page assumption that threw away the
  correct white body text and white CTA on dark stores (Death Wish Coffee).
  The background also ships in `host.pageBg` (an `rgb()` string, or null) —
  the dialog paints the preview box matching the loaded page's polarity with
  it when "site styling" is on (§5.10).
- body `font-family` and `color` → `--dmb-font` / `--dmb-text`. Text color is
  sanity-checked (alpha ≥ .5, |luminance − page-bg luminance| ≥ .25) so a
  white-on-hero-image body color can't produce invisible text; falls back to
  `#1f2430`, or `#f4f5f7` when the page is dark (bg luminance < .4).
- first `h1`/`h2`'s `font-family` → `--dmb-heading-font` (brands often pair a
  display serif with a sans body — Brooklinen does).
- **accent**: scan `button, [type=submit], .btn, [class*="add-to-cart"],
  [name=add], a[class*=btn]` in DOM order; take the first with real size
  (≥60×26 — skips icon buttons), opaque background (alpha ≥ .9), and
  |luminance − page-bg luminance| ≥ .15 (skips page-colored buttons: white
  ghosts on light pages, black ones on dark). Near-black **is** accepted on a
  light page: black CTAs are a dominant e-commerce pattern (Allbirds) — and
  white is accepted on a dark page for the same reason. Fallback chain: link
  color (if it contrasts with the page) → `#111111` / `#f5f6f8` (dark page).
- `--dmb-accent-contrast` is computed white/black from accent luminance so
  button text always reads.
- border-radius comes from the sampled button, clamped: `parseFloat` (handles
  the `1.67772e+07px` scientific-notation values pill buttons report — a real
  bug found in testing, see §8) and capped at 24px so cards don't go
  full-pill even when buttons are.
- All computed colors arrive as `rgb()/rgba()` strings; `parseColor` only
  handles that format. Fine for `getComputedStyle` output — don't feed it
  author CSS.

Auto-adapt runs on every insert (`insertModule` calls `toggleAdapt`), because
"instantly looks native" is the demo moment that sells. Revert exists because
inherited fonts/colors occasionally clash with a module's layout; per the
spec, background color survives a revert (it's a separate user choice, not
part of the inherited theme).

Isolation in the other direction — host CSS bleeding *into* modules — is
handled by `all: revert` on `.dmb-module` (kills inherited author styles at
the boundary; safe because `all` doesn't touch custom properties), a
`box-sizing`/`font-family: inherit` reset on descendants, and class-prefixed
(`dmbm-`) selectors that out-specify bare element rules like global `h2 {}`.
This is *containment, not a hard boundary* — a host rule like
`.product-page div { ... }` can still leak in. Shadow DOM would be the real
fix but would break style *inheritance*, which is the app's headline feature.
The pragmatic answer to leaks is the Revert button.

### 5.4 `modules.js` — base CSS, and the empty gallery

**The gallery ships empty** (2026-08, user request: "remove all widgets in the
gallery — I want a blank slate to start adding new ones"). `modules.js` now
holds only `DEMO_MODULE_BASE_CSS` — the `--dmb-*` variable defaults and the
shared `dmbm-` classes (`dmbm-wrap`, `dmbm-h`, `dmbm-btn`, `dmbm-card`,
`dmbm-stars`, `dmbm-muted`) — plus the registry (§5.8). That stylesheet is
injected into **both** documents: the loaded page (so inserted widgets render)
and the parent app (so gallery thumbnails and the dialog preview render). Every
gallery entry arrives at runtime through `registerModule()`.

Emptying it had two halves, because widgets live in two places:
- The 11 built-in literals moved verbatim to `public/sample-modules.js`, whose
  `<script>` tag in `index.html` is **commented out**. Uncomment it and they
  come back through the ordinary file route (`source: "file"`) — the shared
  stylesheet that used to be `DEMO_MODULE_CSS` rides along as every entry's
  `css` (a copy each: widget CSS is scoped per widget since §8 #18, so a
  single carrier entry would style only itself), and the registry scopes and
  injects it like any custom CSS. Verified:
  12 cards, `.dmb-module.dmb-w-rating-summary .dmbm-rs-top` in the scoped
  output, thumbnails styled.
  Nothing else references that file; deleting the literals outright was avoided
  deliberately (no git repo here, and they're the best reference
  implementations we have of the rules below).
- Widgets a rep imported were in `localStorage`, which no code change to the
  gallery would clear, so `WIDGET_STORE_KEY` was bumped
  `dmb.customWidgets.v1` → `.v2` and app.js `removeItem`s v1 once on load.
  **Don't reuse `.v1`** — it would resurrect pre-blank-slate libraries (which
  also pre-date the §8 #8 photo fix). Since the app went hosted neither key is
  a source of widgets: `.v2` is lifted into the account once on first sign-in
  and renamed `.backup` (§5.13), and the gallery is read from Supabase.

Design rules for widgets — the samples follow all of them, and the validator
(§5.8) warns about each:
- **Zero external assets.** Product/UGC imagery is CSS gradients, icons are
  inline SVG with `stroke="currentColor"`, star ratings are the `★` glyph.
  This guarantees modules render offline, instantly, on any host page, with
  no mixed-content or CORS risk.
- All colors/fonts via the `--dmb-*` variables. Stars keep a fixed amber
  (`--dmb-star`) rather than the accent — accent-colored stars look wrong on
  black-accent brands.
- Realistic-but-generic copy (named reviewers, dates, "1,284 reviews") so a
  prospect reads it as a real integration, not lorem ipsum.
- Content HTML goes inside `<div class="dmbm-wrap">` (max-width 1080px,
  centered) so a module dropped into a full-bleed page region doesn't spill
  edge to edge.
- Gallery thumbnails are the *same live HTML* scaled with
  `transform: scale(.30)` inside `.gal-scale` (width 334% ≈ 1/0.30),
  `pointer-events: none`, with a white-fade overlay. There is no separate
  thumbnail asset to maintain — what you see is literally what gets dropped.
- **The gallery is split by product** (2026-08, user request): every widget
  carries `product: "reviews" | "loyalty"` and a Reviews/Loyalty toggle above
  the list shows one product at a time, with per-tab counts in the button
  labels. Below it, a search box filters the visible tab by name on every
  `input` event (live, no Enter). Both are pure *view* state in app.js
  (`galleryProduct` / `galleryQuery`) — `DEMO_MODULES` itself is never
  filtered or reordered. The registry (`normalizeModuleDef`) defaults a
  missing `product` to `"reviews"` so pre-split file widgets and older stored
  libraries don't vanish from a one-product-at-a-time gallery; an *invalid*
  value is a validation error. The ＋ dialog is stricter by design: radios
  start unchecked on a new widget and Save is disabled until one is picked
  (`wzRefresh` injects the error; `wzSave` double-guards). The product choice
  deliberately survives `wzClearFields()` — it classifies the widget being
  imported, it isn't starter scaffolding. After a save the gallery switches to
  the widget's tab so "it's in the gallery" is visibly true.
- An empty gallery tab renders a `.panel-empty` hint — "No Reviews widgets
  yet. Press ＋ …" when the tab is empty, "No … match “q”" when a search
  filtered everything out — and the header count reads "empty" (or "N of M
  widgets" while searching). A blank list with no explanation reads as a bug.
  Keep that when touching `renderGallery()`.
- Adding a widget is never a `DEMO_MODULES` edit: it's `registerModule()` via
  the ＋ dialog or `custom-modules.js` (§5.8, and WIDGETS.md for the authoring
  contract).

### 5.5 Editor panel

The Shopify-theme-editor-style structure view. `renderEditor()` renders a
**tree**: each sibling group (sub-sections with the same `parent`, plus demos
whose *deepest containing tracked section* is that parent —
`deepestSectionAround`) is sorted by live DOM position
(`compareDocumentPosition`), so a dropped module appears **at its actual
location** in the hierarchy — this is what makes the panel trustworthy.
Children render only while their parent is `expanded`; nested rows are
indented 14px per depth with a guide border. Disconnected elements are
filtered out defensively.

- Host rows: caret (▸/▾ expand, spacer once known childless), name, tag
  badge, 👁/🚫 visibility toggle. Hidden rows dim to 45% opacity — as do rows
  whose *ancestor* is hidden (`hasHiddenAncestor`), since they don't render
  either. Toggling visibility is the only way to *un*-hide (the element no
  longer renders, so it can't be hovered) — that's by design, don't add
  placeholder ghosts to the page. The header count shows top-level sections
  only (`!s.parent`).
- Demo rows: highlighted indigo, `demo` badge, color swatch (mirrors the chip
  input via `setModuleBg` updating both), ✦ adapt / ↺ revert toggle, ✕ remove —
  and, on widgets whose import found blendable frozen surfaces
  (`def.flattenable`), a ▧/▩ Blend toggle (§5.9).
- Clicking any visible row scrolls the canvas to the element and flashes an
  amber outline (`flash()` — also used after insert as drop feedback).
- Row action buttons call `e.stopPropagation()` so they don't also trigger
  the row's scroll-to.

### 5.6 Viewport emulation & gallery collapse

**Problem this solves:** with the iframe simply filling its column, a narrow
app window made responsive stores render their *mobile* layout (reported with
brooklynsoap.eu) — the demo looked crammed and unrepresentative.

**Mechanism** (`layoutViewport()` in `app.js`): the iframe always gets a real
device CSS width, because media queries respond to the iframe's own viewport,
which a CSS `transform` does **not** affect:

- **Desktop mode**: if the canvas column is ≥ `DESKTOP_W` (1280), the iframe
  just fills it. If narrower, the iframe is laid out at 1280px and scaled
  down with `transform: scale(col/1280)` (origin top-left); its CSS height is
  inflated by `1/scale` so the scaled result still fills the column. The site
  sees `innerWidth === 1280` and serves its desktop layout, just zoomed out.
- **Mobile mode**: iframe fixed at `MOBILE_W` (390px), centered in a dark
  surround with a phone-ish shadow — the site serves its genuine mobile
  layout. No scaling.

A `ResizeObserver` on `#viewport` re-runs `layoutViewport()` whenever the
column resizes (window resize, gallery collapse) — nothing else needs to know
about geometry. Crucially, **all interaction code is unaffected by the
transform**: pointer events delivered inside the iframe arrive in the
iframe's own coordinate space (the browser maps them through the transform),
and `getBoundingClientRect` inside the iframe is likewise in iframe
coordinates. Don't "fix" coordinates by multiplying by scale — that would
double-apply it. Verified: drops, the indicator line, and the hover chip all
work at scale(0.37).

**Viewport switch → re-detection**: responsive CSS can reveal elements that
were `display:none` at load time (mobile-only bars, etc.). After a toggle,
`redetectSections()` runs (350ms delay for CSS to settle). It is
**append-only** by design: existing entries keep their ids, names, and hidden
flags; inserted demos are untouched; and candidates that contain or are
contained by an already-tracked section are skipped (prevents nested
anchors). Section ids come from `state.hostCounter`, which never resets
within a page load, so re-detection can never collide with existing ids.
`isSignificant` explicitly rejects `data-dmb-kind="demo"` elements — without
that, re-detection would register inserted demo modules as host sections.

**Gallery collapse**: the `›` button in the Gallery header toggles
`.gallery-collapsed` on `.layout`, which switches the grid's third column
from 320px to 38px and hides the gallery content (the button stays, flipped
to `‹`). No JS geometry work — the ResizeObserver picks up the wider canvas
and rescales automatically. The Editor panel intentionally has no collapse
(not requested; add symmetrically if asked).

### 5.7 Debug/automation surface

```js
window.DMB = {
  state, insertModule, setSectionHidden, toggleAdapt, toggleExpand,
  setModuleBg, toggleFlat, loadPage, layoutViewport, redetectSections,
  // widget authoring (§5.8)
  modules, customModules, addWidget, updateWidget, removeWidget,
  openWidgetEditor, renderGallery, scopeModuleCss, validateModuleDef,
  moduleDefToSource,
  // widget import (§5.9)
  captureFromPreview, rewriteCaptureTheme,
  // share links (§5.12) — "the ⤴ button is missing" is an empty def.sourceUrl
  // and "it didn't pre-fill" is the parse rejecting the link; both are pure
  // functions of a URL and neither is visible from the UI
  widgetShareUrl, parseWidgetShareUrl, stripShareParams, shareWidget,
  // import diagnostics (§8 #12) — a failing import is nearly always one of
  // these two disagreeing with the page, so they must stay reachable
  findCaptureRoot, looksRendered, captureMetrics,
  // theme diagnostics (§8 #13) — "it imported but kept the wrong skin" is
  // nearly always an empty sampled theme
  sampleCaptureTheme, captureThemeRoles, captureRadiusRule,
  // frozen-background legibility (§8 #14) — "one card in the widget has
  // invisible text" is this pass either missing the element or mis-reading it
  captureFixedBgRules, captureTextRoleProps,
  // foreground anchoring (§8 #15) — "the small text is invisible on a dark
  // store": the pass and the three inputs it decides from
  anchorCaptureColors, captureVarRoles, captureSourceBg, anchorFgColor,
  // "the appended rules are in cap.css but do nothing" (§8 #16)
  balanceCss,
  // gallery filtering (§5.4)
  setGalleryProduct, setGallerySearch,
  // site imagery (§5.11) — "the toggle did nothing" is nearly always an empty
  // pool or an all-`fill:false` slot list, and neither is visible from the UI
  toggleImagery, shuffleImagery, harvestImagery, imageryTargets,
  imagery: () => state.imagery,
  // the account behind the gallery (§5.13) — "where are my widgets" is nearly
  // always the wrong Google account, which the DOM doesn't show
  user, signOut, reloadGallery,
}
```

`window.IMAGERY` (imagery.js) is a second, independent surface for the same
feature: `harvest`, `stampSlots`, `detectSlots`, `slotsFor`, `matchSlots`,
`applyImagery`, `revertImagery`, plus `classifyPool` / `classifySlot` /
`familyKey` / `upscaleUrl` / `arDistance` and a `tuning` object holding the
live thresholds. Classification disagreements are diagnosed there — "it filled
the wrong thing" is `classifyPool` and `classifySlot` disagreeing with the
page, and both are pure functions you can call on a URL or an element
directly.

This exists because drag-and-drop and iframe hover are near-impossible to
drive from browser automation; all end-to-end verification (§7) goes through
it. Keep it exported.

### 5.8 Widget authoring — the two runtime routes

`DEMO_MODULES` is the live gallery list and starts empty (§5.4): everything in
it was pushed there at runtime by `registerModule()` — from a file that runs
before app.js (`source: "file"` — `public/custom-modules.js`, and
`sample-modules.js` if switched back on) or the in-app ＋ dialog
(`source: "local"`, a row in the signed-in user's `widgets` table — §5.13).
`CUSTOM_MODULES` holds the same entries minus nothing — with no built-ins the
two lists now differ only in that `DEMO_MODULES` defines gallery order.
`MODULE_HOOKS.onChange` is app.js's re-render hook, set *after* stored widgets
load so startup draws once. The `builtin` flag survives as a
`normalizeModuleDef` field (always `false`) because the gallery card and the
duplicate-dialog note still branch on it — harmless, and it keeps the door open
if a shipped widget ever returns. **User-facing manual: WIDGETS.md.**

Why the pieces are shaped this way:

- **`validateModuleDef()` splits errors from warnings.** Errors are things
  that would break the app or collide (`<script>`, duplicate id, missing
  `html`); warnings are things that make a widget look wrong on a *client's*
  page (hardcoded colors → won't adapt, no `dmbm-wrap` → spills full-bleed,
  external asset → may not load, un-prefixed classes → collide). Warnings must
  stay non-blocking: a deliberate fixed color (photo gradients, a brand mark)
  is legitimate. Both are logged `[dmb] widget "<id>": …` and rendered in the
  dialog.
- **`scopeModuleCss()` prefixes every selector with the widget's own scope,
  `.dmb-module.dmb-w-<id>`** (`moduleScopeClass`, stamped by
  `normalizeModuleDef`; the same class goes on the inserted wrapper, the
  gallery thumbnail, and is re-stamped by `wzSave` in case an edit changed the
  id). Two reasons, one per class: the `.dmb-module` half is so an unscoped
  `h2 { … }` can't restyle the *client's* document; the `.dmb-w-<id>` half is
  so one widget's CSS can't restyle *another widget* — every widget's CSS is
  injected into the same two documents, and imported platform widgets keep the
  platform's class names, so any two same-platform captures collide. Real
  failure (§8 #18): one Yotpo instance's `display:flex` override re-laid-out a
  second Yotpo widget's review list from vertical to side-by-side. The scoper
  itself brace-matches (respecting strings and comments) rather
  than regexing rules, recurses into `@media`/`@supports`/`@container`, passes
  `@keyframes`/`@font-face` through untouched, splits selector lists only on
  top-level commas (`:is(a, b)` survives), and rewrites `:root`/`html`/`body`
  to the wrapper. `DEMO_MODULE_BASE_CSS` is *not* run through it — it's
  hand-scoped (to bare `.dmb-module`: it's the shared base every widget gets),
  and re-scoping it would be a no-op at best. Verified against
  `content: "}"`, nested at-rules and pre-scoped selectors. Direct
  `DMB.scopeModuleCss(css)` calls still default to bare `.dmb-module`.
- **Custom CSS lives in its own `<style>` in both documents**
  (`customModuleStyle` in the app, `#dmb-custom-styles` in the iframe, both
  written by `syncCustomCss()`), because it changes at runtime while
  `#dmb-styles` doesn't. `initPage()` calls `syncCustomCss()` after injecting
  `#dmb-styles` so a freshly loaded page gets custom widgets too.
- **Dialog preview CSS is scoped to `#wz-preview .dmb-module`**, not
  `.dmb-module`, so half-typed rules can't restyle the gallery thumbnails.
  `scopeOneSelector` retargets an author-written `.dmb-module` to whatever the
  requested scope is, which is what makes that work.
- **`updateModule()` mutates the def in place** (`Object.assign` on the
  existing entry) so already-inserted instances — which hold `entry.def` by
  reference — stay linked; `wzSave()` then re-renders their `innerHTML`.
  Deleting a widget deliberately leaves inserted instances alone: they're
  independent DOM, and yanking them mid-demo would be worse than harmless
  orphans.
- **Only `source: "local"` widgets get ✎/✕ in the gallery.** File widgets are
  code; the in-app path for them is ⧉ duplicate → edit the copy. `moduleDefToSource()` + the dialog's "Copy as code" is the promotion
  path from one user's gallery to `custom-modules.js` (escapes backticks and
  `${`). A local widget whose id later appears in `custom-modules.js` is
  rejected at load with a console error and a status line — the file wins.
- `applyHostVars` / `clearHostVars` / `ADAPT_VARS` are shared by `toggleAdapt`
  and the dialog's "site styling" preview. If you add a themable variable, add
  it to `ADAPT_VARS` *and* the table in WIDGETS.md §4, or Revert will miss it.
- Card action buttons sit in an absolutely-positioned `.gal-actions` overlay
  that appears on hover. Because the card itself is `draggable`, a `mousedown`
  on a button sets `dragBlocked`, which the card's `dragstart` checks — without
  it, clicking ✎ starts a drag instead.

### 5.9 Widget import — capture from a preview link

The third authoring route, and the one a sales rep actually uses: paste a
platform widget-preview URL into the ＋ dialog's **Import** row, press Import,
and ~3 s later the Name/Description/Id/HTML/CSS fields are filled with a static
reconstruction of that widget, previewed live. Save turns it into an ordinary
`source: "local"` widget — from there it is indistinguishable from a
hand-written one (drag, Adapt/Revert, background color, ✎/✕, Copy as code).
User-facing manual: **WIDGETS.md §1.1**.

**Pressing Import empties the form first** (2026-08, user request: "when I paste
the link, the templated code inserted gets removed immediately after clicking
Import"). The dialog opens prefilled with `STARTER_HTML`/`STARTER_CSS`, which is
scaffolding for *hand-writing* a widget; the instant an import starts it is
neither what the user is building nor what will be saved, and leaving it there
means a savable stranger's widget sits in the preview for the ~4 s the capture
takes. `wzClearFields()` blanks Name/Desc/Id/HTML/CSS and re-renders. Two
consequences to preserve: the clear is skipped while **editing** an existing
widget (`wzEditing`) — that markup is the user's own and stays until a capture
actually replaces it — and `wzRefresh()` answers a wholly empty new-widget form
with one neutral line ("Importing — the captured widget will land here." /
"Paste a preview link above…") instead of the `name is required` /
`html is required` errors, which would otherwise fire about a state the user
never created. `wzImporting` is what distinguishes those two messages; it is
cleared in `wzImport()`'s `finally` and reset by `openWidgetEditor()`.

**Static by design.** The spec is "the widget as it looks right now, forever":
these previews don't change, and a different version of the widget is a
*different gallery entry*, imported separately. So there is no re-fetch, no
stored URL to refresh from, no live embed — one snapshot, frozen. That removes
the entire class of demo-time failures a live embed would add (network, auth,
the platform re-rendering over our edits) and it's why the captured markup is
stored in the widget def like any pasted HTML.

**Why a rendering capture and not a fetch.** A preview page is an empty shell;
the widget is built by a JS loader. So `captureAttempt()` renders it in an
off-screen iframe (`.dmb-capture-frame` — real layout at `DESKTOP_W`, or
`MOBILE_W` when the URL says `is-mobile=true`; **not** `display:none`, or the
widget measures a zero-width viewport) pointed at
`/proxy?url=…&scripts=1&dmb-capture=1&<original query string>`. Same-origin, so
once the loader has run we read `frame.contentDocument` directly. Three details
that are easy to break:

- **The original query string rides along** on the proxy URL as well as inside
  `?url=`, because the shell reads `guid` / `widget_instance_id` / `is-mobile`
  from its own `location.search`.
- **Lazy content must never depend on geometry or tab visibility**, which is why
  `CAPTURE_BOOTSTRAP` stubs `IntersectionObserver` (§5.1). An IO *inside* an
  iframe is clipped by the iframe's intersection with the **top-level**
  viewport, so an off-screen frame fires none — and a document whose tab is
  hidden runs no rendering lifecycle at all, so it fires none there either,
  wherever the frame sits. Yotpo paints each review photo's `background-image`
  (and its size — no stylesheet sizes those buttons) from such a callback, so
  the real IO cost us every review photo: 0 of 6 vs **6 of 6** with the stub
  (§8 #8). Scrolling the frame through the viewport was tried and is *not* the
  fix — it can't work in a hidden tab, and it added ~9 s to every import.
- **`&dmb-capture=1` is what makes the capture non-empty.** Yotpo widgets render
  bundled demo data instead of live-store API calls only when the mount carries
  `mode-preview="true"`, and loaders read mount attributes *at init*, so tagging
  from the parent window is a race. The proxy injects `CAPTURE_BOOTSTRAP`
  (§5.1) as the document's first script; its MutationObserver always wins. The
  100 ms parent-side tagging interval left in `captureAttempt` is only a
  fallback for a server without the bootstrap — don't rely on it, and don't
  remove the content check that backs it up. Measured A/B on instance 1004109:
  tagged **767 elements / 2584 chars** of text, untagged **36 / 81** (§8 #6).

**Settling** (`waitForRender`) polls every 200 ms and resolves `{root, metrics}`
only on a state that both looks rendered and has stopped changing: a
`len/els/txt` signature unchanged for `CAPTURE_QUIET_MS` (1400), never sooner
than `CAPTURE_MIN_WAIT_MS` (1500) after content first appeared, giving up at
`CAPTURE_TIMEOUT_MS` (22000). The content bar is `looksRendered()` —
`els ≥ 8 && (txt ≥ 120 || imgs ≥ 2 || els ≥ 120)`. **Quiescence alone is not
enough**: a mounted-but-dataless skeleton sits perfectly still while its data is
in flight, so a pure DOM-quiet rule happily saves the 36-element shell. That is
the one genuinely bad import outcome (it looks like success and fails in front
of a client), so a run that never clears the bar is **rejected, not saved**.
Note which way that bar is *not* allowed to lean: **element count is a floor
against a lone stray node, never the test** — a fully rendered loyalty card is
*smaller* than the reviews skeleton it has to reject (17 els / 165 chars vs
36 / 81), so text density is the only thing that separates them (§8 #12).
Anything stricter on `els` rejects good compact widgets.
Rejections carry `err.retryable` and `captureFromPreview` runs up to
`CAPTURE_ATTEMPTS` (3) of them: the loader chain occasionally gets fetched but
never executed (seen twice in a row once), and a fresh frame fixes it. To keep
three attempts affordable, every attempt *except the last* bails after
`CAPTURE_DEAD_MS` (7000) once the document is `complete` and nothing has changed
while still short of the content bar — measured ~9 s per bailed attempt, so a
hopeless link reports in ~40 s instead of ~66 s, with the status line narrating
each retry. The **last** attempt is `patient` (no early bail) so a genuinely
slow preview still gets the full 22 s. `abortCapture()` kills the frame and its
intervals *and rejects the pending run* — clearing the interval alone leaves the
promise unsettled, which used to wedge the dialog's Import button (§8 #9);
closing the dialog calls it, as does starting another import.

**`findCaptureRoot()`** tries three things in order, and the order encodes the
difference between the two Yotpo families:

1. `CAPTURE_MOUNT_SELECTORS` — generic mount *containers* the loader **fills**
   (`.yotpo-widget-instance`, `[data-yotpo-instance-id]`). Reviews work this
   way, so a single child is unwrapped to reach the widget's own element.
2. `CAPTURE_ROOT_SELECTORS` — a rendered widget **root**, i.e. the element whose
   own class names the widget (`[class*="yotpo-widget-"]`). The loyalty family
   (referral-share, spotlight…) *replaces* its mount instead of filling it, so
   after render no mount selector matches anything at all. These are never
   unwrapped: the class is what the widget's CSS is scoped to, and document
   order guarantees the outermost match wins.
3. Otherwise descend from `body` through single significant children (≥60×200,
   not fixed/hidden, depth 8) — the same pass-through-wrapper idea as section
   detection.

Step 2 exists because step 3 is actively wrong for a replaced mount: every
level of a loyalty widget's chrome is a single significant child, so the descent
walks *past* the root into the first branching container, dropping the class its
stylesheet is written against (§8 #12). Steps 1 and 2 can both match the same
element pre-render (`.yotpo-widget-instance` contains `yotpo-widget-`), which is
harmless — an empty mount has no `firstElementChild` and both skip it.

**`snapshotHtml()`** serializes the subtree clone and makes it self-contained:
drops `script/noscript/style/link/template/iframe`, absolutizes
`src`/`srcset`/`poster` against `doc.baseURI` (images stay external — accepted,
per the spec, as long as they load), forces `loading=eager`, neutralizes every
`href` to `#` + `onclick="return false"` so a click can't navigate the canvas
mid-demo, strips comments, and promotes SVG `fill`/`stroke`/`stop-color` to
`!important` inline styles (§8 #7). Finally it swaps the platform's literal
theme values for our variables by string replacement — which is what catches
inline custom properties and SVG gradient stops that no stylesheet rule would.
Both comma spellings are swapped because CSSOM serialization normalizes
`rgba(1,2,3,1)` → `rgba(1, 2, 3, 1)`.

**CSS capture** is two passes: `collectSubtreeCss()` keeps only `<style>` blocks
with at least one rule matching the subtree (sheets holding just
`@font-face`/`@keyframes` are kept — they can't match but may be depended on),
and `collectLinkedCss()` fetches cross-origin `<link>` sheets **through
`/proxy`** because `cssRules` is unreadable for them and per-instance overrides
live there. Google Fonts links are skipped (shell chrome, not widget). Captured
CSS goes through `scopeModuleCss()` like any custom CSS, so it can't touch the
client's page.

Every collected chunk is passed through **`balanceCss()`** first, which appends
whatever `}` the author left off. A merchant-authored override sheet really does
ship an unclosed `@media` block: harmless in its own `<style>` element (the CSS
parser closes open blocks at EOF), fatal once we concatenate our own rules after
it, because the bridge, fixed-background and radius rules then sit *inside* the
unclosed block and never reach the CSSOM — the widget silently keeps the source
store's skin with `cap.css` looking perfectly correct (§8 #16). The scan skips
strings and comments (`content: "{"`) and floors the depth at 0 so a stray `}`
can't mask a later open block.

**Theme bridging** is `CAPTURE_THEME_MAP` — platform custom properties →
`--dmb-*` variables (`--primary-color` → `var(--dmb-accent)`, `--stars-color` →
`var(--dmb-star)`, `--background-color` → `transparent` so the wrapper's
`--dmb-bg` shows through, etc.). `sampleCaptureTheme()` reads the platform's
inline properties off the widget; `rewriteCaptureTheme()` applies the map to
both the snapshot HTML and every captured CSS chunk, and a **bridge rule**
appended to the captured CSS re-declares the mapped properties on the widget
root *and* passes the platform's unmapped constants through verbatim, so
unmapped references still resolve. `rewriteCaptureTheme()` works in ROLE terms,
not find-and-replace (§8 #10): mapped properties are rewritten **by name**
(several routinely share one literal value — a white-on-black theme has
primary = text = stars = white, and a value-based swap mis-colors two of the
three); literal colors in declarations are parsed and matched to the sampled
theme **by color** (catches `#000` vs `rgba(0,0,0,1)` vs `rgb(0, 0, 0)`
respellings), then mapped by the property's role — background ↔ foreground —
so store-authored override sheets (`yotpo-widget-override-css`: hardcoded
`background:#000`, `color:#fff`, brand `font-family`) re-theme to the demo
host too. The mapping preserves legibility pairs: theme-background as a
background → `transparent`, as a text color → `var(--dmb-accent-contrast)`
(it's sitting on an inverted, accent-mapped element). Colors matching no theme
color (greys, translucent scrims/shadows, `url(...)` artwork) and `@font-face`
blocks pass through this stage untouched — the anchoring pass below is what
picks the *foregrounds* out of them; a page with no sampled theme is left
entirely to it. Supporting a new platform is normally one row in
`CAPTURE_THEME_MAP` (+ its mount selector in `findCaptureRoot`) — keep it in
sync with the table in WIDGETS.md §1.1.

**Sampling has two routes, because not every widget family declares a theme.**
`sampleCaptureTheme()` first reads inline `--*` custom properties off the widget
(the reviews family stamps them on its mount). The loyalty/referral family
declares *none* — it writes literal `rgb()` values and font names straight into
inline `style` attributes — so that scan returns `{}` and the whole rewrite
used to no-op, leaving the widget frozen in the original store's skin (§8 #13).
The fallback reads the theme where that family actually keeps it: the loader
holds a per-instance `customizations` object on the capture frame's window
(`yotpoWidgetsContainer.guids[guid].config.widgets[id].customizations`, ~148
keys, role-labelled in everything but name). `CAPTURE_CONFIG_ROLES` maps the
unambiguous ones onto the very keys the property route produces, so everything
downstream is unchanged:

| config key(s) | role key |
|---|---|
| `background-color`, `tile-color` | `--background-color` |
| `title-color`, `description-color`, `header-color` | `--text-color` |
| `primary`/`secondary-button-background`/`-text-color` | `--primary-color` |
| `stars-color` | `--stars-color` |
| `fonts-primary-font-name-and-url` | `--primary-font-family` |
| `fonts-secondary-font-name-and-url` | `--secondary-font-family` |

Two consequences to preserve. **A role can hold several colors** — a platform
exposes header, title and description colors separately and they are routinely
different (black header over `rgb(55,51,48)` body copy), yet all are
`--dmb-text`. So role slots are *lists* and `hitsRole()` matches any member;
inline sampling still yields one value per property and `themeValues()`
normalizes both shapes. **Only listed keys are taken**: greys
(`share-headline-text-color`), status colors (`view-table-selected-color`), form
fills and font sizes stay as captured, which is what keeps type hierarchy from
flattening. Font values arrive as `Montserrat@600|https://fonts.googleapis…` —
family only, weight and URL stripped.

**Foreground anchoring** (`anchorCaptureColors()`) runs after the role mapping
and catches everything the mapping *couldn't* attribute to a role. A platform
sheet is full of colors that are nobody's theme value — Yotpo alone ships ~40
palette constants (`--yotpo-black: #373330`, `--yotpo-primary-text-black`,
`--yotpo-medium-grey`, Vue's hashed per-component vars `--v6bd89782`) — and the
ones that paint text were authored against the *source* page's background. Frozen
literally they inherit the source store's polarity, so a widget captured from a
light preview lands on a dark host with invisible filter labels, placeholders and
secondary copy while the themed parts adapt correctly (§8 #15). Same light-page
assumption as §8 #11, one layer further in. The pass re-points them at
`--dmb-text` *at the strength they had*, which is what makes it a general
solution rather than a third special case:

- **Strength, not color.** `captureSourceBg()` walks up from the widget root for
  the first opaque background; `anchorFgColor()` measures each color's brightness
  against that polarity and emits `var(--dmb-text)` at ≥
  `CAPTURE_ANCHOR_SOLID` (.75), `color-mix(in srgb, var(--dmb-text) N%,
  transparent)` in 5% steps below it, and nothing under `CAPTURE_ANCHOR_MIN`
  (.08 — decoration too faint to bother). So a 60% placeholder grey stays a 60%
  placeholder on the host's text color; hierarchy survives. `color-mix` degrades
  gracefully: an engine without it keeps the cascade's previous value.
- **Chromatic colors are never touched.** Saturation above `CAPTURE_ANCHOR_SAT`
  (.3) means a brand or status hue (the amber AI sparkle, the red error text),
  which is content, not theme. Neither are `stop-color` (gradient stops are
  artwork — recoloring them redraws the picture) or `url(...)` values.
- **Glyph colors and hairlines are graded differently.** `CAPTURE_TEXT_PROP_RE`
  (`color`/`fill`/`stroke`) gets one extra promotion the others don't: a color at
  the *opposite* extreme from the source background was authored for the opposite
  surface (`#373330` on a black preview page), so it means "solid body text" and
  maps to `var(--dmb-text)`. Applying that to `border-color`/`outline-color` drew
  heavy black lines across cards where the capture had `#e3e3e3` hairlines —
  those stay strength-mapped.
- **Custom properties are classified by use, not by name.** `captureVarRoles()`
  scans every declaration in the markup and CSS, records whether each `--name` is
  referenced from a foreground property, a background one, or forwarded through
  another custom property, and propagates through those aliases to a fixpoint (4
  passes). Only names used as a foreground and *never* as a background are
  re-pointed; a mixed-role var is left alone, because anchoring it would recolor a
  surface. This is the only reason the pass can touch hashed vars whose names say
  nothing.
- **Order matters.** It runs over the bridge rule too (that rule carries the
  platform's palette constants), but *before* `captureFixedBgRules()` and
  `captureRadiusRule()`, which are ours and already host-anchored — and
  `captureTextRoleProps()` therefore reads the anchored values, keeping each
  re-declaration at its own strength instead of promoting a secondary grey to
  body copy.

**Button shape** is bridged separately by `captureRadiusRule()`, because
platforms bake it into their own CSS where no `--dmb-*` reaches — Yotpo's reset
pins `border-radius: 0` on every button, and its shape variants are whole
classes (`.yotpo-rounded-btn-type{4px}`, `.yotpo-capsule-btn-type{32.6px}`).
Corner radius is one of the four things Adapt promises to inherit (§5.3), so
the rule re-points the real CTAs found in the capture — `button`,
`input[type=submit]`, `[role=button]`, `[class*=btn]`, filtered to ≥60×26 (skips
icon buttons) and to a non-`%` computed radius (a `%` means a circle we must not
turn into a rounded box). Every btn/button class of the element goes into one
compound selector so the rule out-specifies the platform's own
`.widget .yotpo-rounded-btn-type`, and it is pushed **last** so equal-specificity
ties fall our way too.

Compounding classes is still not always enough, so the class-based selectors
carry `!important`: Yotpo pins the review-form CTA from
`#yotpo-reviews-main-widget .yotpo-new-review-btn`, and an id outweighs any
number of classes — that button stayed square on a 24px-radius host (§8 #17).
It's safe because the selector named a real CTA *in this capture*. The tag-name
fallback (a classless button) is emitted as a **separate, non-important rule**
on purpose: it is broad enough to catch chips and pickers whose own shape is
part of the widget's internal hierarchy (§9), and it already wins wherever
nothing else sets a radius.

**Frozen backgrounds** are the one place the role mapping can't keep a
legibility pair together, so `captureFixedBgRules()` repairs it. The bridge
deliberately leaves a color that matches no sampled theme value alone — greys,
artwork, hierarchy colors (§9). But a store's per-instance CSS routinely pins an
opaque *non-theme* background on an inner card (`.yotpo-paragraph-summary
{ background:#F5F2ED }`, the AI review summary) while the text on it stays
themed, so the surface freezes and the text keeps adapting: on a dark host,
white `--dmb-text` on frozen cream (§8 #14). The wrapper's background swatch is
no answer either — it paints the wrapper, not a card three levels in. The pass
walks the captured subtree, and for each element that *introduces* an opaque
non-theme background and carries text it emits a rule re-declaring the text role
against that background (`#1f2430` / `#f4f5f7` by luminance, the same constants
`sampleHostStyles` falls back to). It inherits through the card's subtree,
survives Revert, and leaves everything outside adapting. Two things to keep:

- **`--dmb-text` alone is not enough.** `var()` inside a custom-property value
  resolves at the element the *declaration* sits on, so the root bridge rule's
  `--text-color: var(--dmb-text)` computes to the host color *there* and
  inherits that literal down. Every property the rewrite pointed at
  `--dmb-text` has to be re-declared on the card so it re-evaluates locally —
  which is why `captureTextRoleProps()` reads them back off the finished
  markup/CSS (`--text-color`, plus whatever per-component vars pass 3 caught)
  instead of hardcoding a list. **And the variables alone are not enough
  either** (§8 #19): text with *no* color rule of its own inherits the
  already-*resolved* color from outside the card — re-declared variables can't
  reach it, because inheritance passes down computed values, not `var()`
  references. So every emitted rule also re-declares `color:
  var(--dmb-text)` on the card itself; anything inside with its own rule
  still overrides plain inheritance, so pinned greys and accent text are
  unaffected.
- **Floating labels are found by hit-testing, not by the walk.** Yotpo's
  dropdowns absolutely position their label over a sibling combobox pill, so
  the text's visual backdrop is an element it is *not* a descendant of —
  background inheritance structurally can't connect the pair, and the tree
  walk can't either (§8 #19). A second sweep takes every positioned element
  carrying a direct text node and asks the rendering what's under it
  (`elementsFromPoint`, elements below the label, first opaque background);
  a non-theme, non-ancestor surface gets the label its own rule (ancestor
  surfaces are the walk's job — its card rule inherits into the label).
  `captureAttempt` stretches the capture frame to the document's full
  scrollHeight right before the pass, because `elementsFromPoint` only
  answers inside the frame's own viewport and the stock 1600 px frame covers
  a fraction of a reviews widget.
- **BEM modifiers are dropped from the selector.** A component arrives as
  `.yotpo-simple-tooltip.yotpo-simple-tooltip--right`, and the positional/state
  modifier differs per instance, so the full class list bridged the one element
  we sampled and missed its siblings (§8 #17). A modifier whose base class is
  also present is dropped — but only after the DOM confirms every element the
  shorter selector reaches carries the *same* frozen background, so a `--dark`
  variant of an otherwise transparent card can't drag its siblings' text color
  with it. When they disagree, the compound selector stands.
- **A nested element repeating the color it already sits on is skipped**, and a
  classless card pushes its rule down to the first classed, text-bearing
  descendant (there is nothing else to select on). That keeps the output small —
  8 rules on the reviews widget, 1 (a tooltip) on the §8 #10 dark instance, 0 on
  the loyalty family, whose tile background *is* theme and maps to transparent
  (the overlay sweep adds one more, `.yotpo-dropdown-label--inside`, wherever
  the capture has floating-label dropdowns: 6 total on Rixo `383020`, 7 on
  `1087254`). `CAPTURE_FIXED_BG_MAX` (40) caps it and logs what it dropped.

**The Blend toggle** is the rep-facing escape hatch for those frozen surfaces
(2026-08, user choice — an always-on adaptation of them was considered and
rejected in favor of a per-instance toggle; default is the faithful capture).
For each *subtle* frozen surface — achromatic (`CAPTURE_ANCHOR_SAT`), within
.25 luminance of the source page's own background, no background-image —
`captureFixedBgRules` emits a companion rule gated on `.dmb-flat`, a class
`toggleFlat()` puts on the instance wrapper (chip button "Blend"/"Unblend",
Editor row ▧/▩ — both appear only when `def.flattenable`, i.e. the capture
found any). The companion re-declares the background as the *page-relative
tint the surface had at the source* (`color-mix(in srgb, var(--dmb-text) N%,
transparent)` in 5% steps; a surface that matched the source page becomes
`transparent` — Rixo's cream panels are that case: invisible boxes on their
own store, boxes only when frozen on a dark one) — **and releases the pinned
text in the same rule** (`--dmb-text: inherit`, which makes the pin's
`color: var(--dmb-text)` re-evaluate to the host value). Surface and text
flip as a pair or not at all; a statement surface (chromatic or
high-contrast) has no companion, so its pin stands in both states, and an
overlay label is released only when the surface under it actually blends.
Two hard-won selector details: the background override needs `!important`
**and id parity** — merchants pin these surfaces from 2-id `!important`
selectors (`#yotpo-reviews-main-widget #yotpo-main-widget-btn.…`, the §8 #17
fight again), so `flatSelector()` anchors the companion with the element's
own id plus the nearest ancestor id, bounded to the capture root (an id above
the root belongs to the preview shell, isn't in the snapshot, and would leave
the rule silently dead) and skipping the junk `id="null"` Yotpo templates
emit. `entry.flat` lives per instance and survives a `wzSave` re-render;
old imports have no companions (`flattenable` false, no button) until
re-imported.

An import trips four *warnings* by construction (hardcoded colors, external
assets, un-prefixed classes, size). They're non-blocking on purpose: captured
platform markup legitimately looks like that (§5.8), and the import path is
exactly the case the errors/warnings split was drawn for.

### 5.10 The dialog preview is a polarity pair

The ＋ dialog renders the widget **twice** — against a light store and a dark
one — in two independently scrolling boxes (`.wz-pv`, `data-pol`), plus a
**blend** checkbox and a **Re-capture** button. All three exist for one reason:
the import path's recurring failure is *opposite-polarity legibility* (§8 #10,
#11, #14, #15, #19 are all the same shape), and a single preview box could
never show it. Every one of those bugs was found by dropping the widget on a
real store — i.e. after Save, sometimes in front of a client. The pair moves
that check to the moment of capture, which is the only moment where the answer
is still cheap.

Design points, in the order they matter:

- **One capture, two renderings.** Nothing here re-captures, and nothing forks
  the widget into variants. The frozen/dynamic split is entirely
  post-processing (§5.9), so the polarities are the *same* `def.html`/`def.css`
  rendered under two palettes. Capturing twice would triple the wall time,
  triple the exposure to the loader flakiness `CAPTURE_ATTEMPTS` exists for,
  and — because a platform renders demo data fresh each load — produce two
  snapshots that differ for reasons having nothing to do with polarity, which
  is exactly the comparison the pair is supposed to isolate. If a variant axis
  is ever wanted, derive it from one snapshot.
- **The palettes are the `sampleHostStyles` fallbacks** (`WZ_PREVIEW_PALETTES`
  — `#1f2430`/`#111111` light, `#f4f5f7`/`#f5f6f8` dark), i.e. "an
  unremarkable store of that polarity". Fonts and radius are deliberately left
  at the stylesheet defaults: the pair answers *can you read it*, not *does the
  typography match*, and varying four things at once would make neither
  legible.
- **"Site styling" replaces one box, never both.** With a page loaded, the box
  whose polarity matches it (`wzHostPolarity`, luminance of `host.pageBg` <
  .4 → dark; no `pageBg` means the sample fell back to white, i.e. light) shows
  the *real* sampled palette against that page's own background and relabels
  itself "This page". The other box keeps its generic sample, so the opposite
  polarity stays on screen — losing it is precisely how these bugs shipped.
- **The blend checkbox previews the toggle, it does not choose for the rep.**
  It puts `.dmb-flat` on both wrappers, so a capture's frozen surfaces can be
  seen dissolved before Save; it appears only when the CSS carries `.dmb-flat`
  companions (the same `/\.dmb-flat\b/` test `normalizeModuleDef` uses for
  `flattenable`). Nothing about it is saved — Blend stays a per-instance,
  reversible, page-side decision (§5.9), because whether a frozen panel wants
  dissolving depends on the client's page, which is unknown at import time.
- **Re-capture is a label, not a second code path.** `wzImport` is unchanged;
  once a capture lands, `wzCapturedUrl` holds the URL that produced it and the
  Import button renames itself while the field still matches it. Editing the
  URL flips it back. A capture is a frozen snapshot with no refresh (§5.9), so
  re-running the same link *is* the whole remedy for a flaky render — the
  button just stops making the rep wonder whether pressing it again is allowed.
- `wzPrevHtml` guards the innerHTML write: a ~110 KB capture would otherwise be
  re-parsed into two boxes on every keystroke in the Name field. Everything
  else in `wzRefresh` is cheap enough to redo unconditionally.

What the pair deliberately does **not** do is ask the rep to pick a version.
Adapt/Revert and Blend are runtime, per-instance and reversible on the page
that actually matters; freezing that choice into the stored widget at import
time would trade a reversible decision for an irreversible one made with less
information (§9).

### 5.11 Site imagery — the client's own pictures in our widget

The rep loads a prospect's PDP; the app harvests that page's images; a
per-instance toggle fills the inserted widget's photo frames from them. A
Yotpo review wall then shows the prospect's products instead of the
platform's stock demo photos. Off by default, reversible, per instance.
Everything lives in **`public/imagery.js`** (`window.IMAGERY`) — app.js holds
only call sites, every one of them guarded on `window.IMAGERY` existing, so
deleting the `<script>` tag disables the feature cleanly. Removal instructions:
**ROLLBACK-IMAGERY.md**.

**Harvesting is free, because the browser already did it.** The canvas iframe
is same-origin (§3) and the page has already loaded and decoded its own images
in order to render, so `img.naturalWidth/naturalHeight` yields true intrinsic
aspect ratios for **zero network requests**. What is kept is a *manifest*
(`url → {w, h, role}`), not bytes: the bytes are in the browser's HTTP cache
from rendering the page, and inserted widgets already hotlink the platform CDN
by design (§9), so hotlinking the store's CDN is the established pattern here
rather than a new risk. Two consequences worth stating because both are easy
to undo by accident:

- **Never route harvested images through `/proxy`.** The proxy sends
  `Cache-Control: no-store` on everything (§5.1), so proxying them would
  destroy the caching that makes this free. `/proxy` is used on this path for
  exactly one thing — the Shopify product JSON, which is blocked *data*, not
  an image.
- **Nothing is stored in `localStorage` but the slot manifest.** Base64 image
  bytes would inflate 33% into a ~5 MB budget that already holds ~112 KB
  widget captures (§5.8). If bytes are ever genuinely wanted, that's IndexedDB
  blobs, not this.

Sources, in descending order of trustworthiness: the **Shopify product
endpoint** (`/products/<handle>.js` — the full gallery at full resolution, one
request, and Shopify-family stores are the ones that work best through the
proxy anyway, §9), **JSON-LD `Product.image`** and **`og:image`**, then
`<img>` elements, then a capped computed-style sweep for CSS
`background-image` (where hero and lookbook imagery lives). The sweep is the
only pass that touches every element, so it is bounded by both count
(`SWEEP_MAX_ELS` 2500) and wall time (`SWEEP_BUDGET_MS` 30). Dimensions the
DOM couldn't give us (background images, undecoded `<img>`s) are filled in
afterwards by `probeDimensions()`, which is the only part that can touch the
network and never blocks anything.

**Shape is the tiebreak, not the key — this is the design decision.** Almost
every slot in a platform widget is `object-fit: cover` / `background-size:
cover`, so a wrong-ratio image is merely *cropped*; precision matching buys far
less than intuition suggests. The failure that actually matters is *semantic*,
and it happens in front of a client: a payment-icon sprite in a review photo
strip, or the prospect's hero banner with "SUMMER SALE" burned into the pixels
cropped down to an 82×82 thumbnail, reads as a hack — where the platform's
generic-but-plausible stock photo reads as a real integration. So both sides
are classified into roles first (`POOL_PATTERNS` for the page, `SLOT_PATTERNS`
for the widget), candidates are drawn from the slot kind's preferred roles
(`SLOT_SOURCES`), and aspect ratio only orders what's left — as
`|log(slotAR / imgAR)|`, so 2:1 and 1:2 sit the same distance from square.

**Pool classification is deliberately asymmetric about evidence, and that
asymmetry must survive refactors.** The reject test (`POOL_REJECT` → role
`icon`) runs against the URL and alt text **only**; the positive tests
(`POOL_PATTERNS`) may use the full ancestor-class context. Reason: a false
reject silently deletes good material, while a false positive only reorders
preference among slots that were going to be filled anyway. Ancestor class
lists are a terrible signal on utility-CSS themes — Allbirds' Tailwind build
hangs ~20 layout tokens off every wrapper (`pointer-events-none absolute
inset-0 top-[52%] md:w-[48vw] …`) and a substring match inside that soup threw
away a 1920 px packshot as an "icon". A filename is authored to describe the
picture; `md:top-[42%]` is not. The other portable signal is structural:
an image inside `a[href*="/products/"]` is a product shot whatever the CDN
called the file, which is what rescues Shopify's meaningless
`/cdn/shop/files/…` paths.

**Two slots are never filled, by design.** `SLOT_PATTERNS` marks them
`fill: false`:
- **avatars** — a square frame in a review header is a *face*. We cannot find
  a face in a store's image pool without vision, and a packshot in an avatar
  ring is instantly, obviously wrong.
- **brand marks** — stars, verified ticks, platform iconography. Replacing
  these breaks the widget's own identity, which is the thing the client is
  buying.

**Role preference needs a score term to mean anything — `ROLE_PENALTY`.** The
first cut concatenated candidates in `SLOT_SOURCES` preference order and then
selected purely on crop quality, so the ordering was **inert**: "a UGC frame
wants a lifestyle shot first" never actually happened, and a square packshot
won every square frame. That is the direct cause of the reported "a product
photo lands in the referral widget's experiential frame". Each candidate now
carries the rank of the role it came from and pays `rank * ROLE_PENALTY`
(0.35). Sized to be *beatable*: a second-choice role still wins when the
first-choice crop is meaningfully worse, so a store carrying nothing but
packshots fills its frames rather than going empty. Verified on a synthetic
pool with equal crops on both sides — a `ugc` slot now takes both lifestyle
images, a `product` slot takes both packshots.

**Shuffle** (⟳ on the chip, next to the toggle, visible only while imagery is
on) is the answer to the part role matching structurally cannot solve. Whether
a packshot reads wrong in an experiential frame is a judgment about the
*picture*, and the rep is looking straight at it — so the cheap correct move is
to offer another draw rather than a cleverer matcher. `entry.imageryVariant`
increments per press and `matchSlots` turns it into three dials at once,
because a shuffle that changes one tile reads as broken:

1. **Role emphasis** — rotates the slot kind's preference list, so the next
   press leads with `lifestyle` instead of `product`. This is the dial that
   answers the complaint: it lets the rep walk *out* of the packshots instead
   of re-rolling within them. Rotation only re-orders; no role is excluded.
2. **Pick depth** — how far down each slot's ranked candidates to reach,
   capped by `SHUFFLE_DEPTH` (5). Past a handful the crops get visibly worse,
   and cycling back to the best pick beats offering junk. The offset is
   `variant * (k + 1)` across a group, so a shuffle re-rolls the whole strip
   rather than shifting every tile by the same one place.
3. **Fill pattern** — which slots get filled at all, so a tile the rep
   disliked can go back to stock entirely rather than merely swapping.

Three details that are load-bearing. **Variant 0 reproduces the un-shuffled
match exactly** (every offset is a multiple of `variant`), so Shuffle adds a
path without changing the default. **`paintImagery()` always reverts first** —
a re-apply must start from the captured photos, or a slot the new variant
leaves as stock keeps the *previous* variant's picture and the "original"
recorded on it is a swap rather than the capture. And the **"nothing fits" test
judges crop only** (`bestCrop`, not the picked candidate's score): folding in
the role penalty and the shuffle's deliberate reach for a worse pick would
start rejecting slots the un-shuffled match filled happily. A shuffle that
comes back empty resets to variant 0 rather than stranding the rep on a widget
that lost its photos.

**Partial fill is a feature, not a shortfall.** `FILL_RATIO` (0.6) fills about
two thirds of each same-kind slot group, chosen by *stride* rather than the
first N: filled-filled-stock-filled-stock-filled reads as a real review feed,
six consecutive swaps reads as a product gallery wearing a review widget's
clothes. Lowering it usually improves the demo. Groups of ≤2 are filled
completely (there is no pattern to break up). Reuse is penalized
(`REUSE_PENALTY`) **by picture, not by URL string** — Shopify serves one asset
under both `/cdn/shop/files/` and `/cdn/shop/products/`, which no path dedupe
can safely collapse (two folders really can hold different images of the same
name) but which must still count as used, or the same shoe lands twice in one
strip. And when every candidate is a bad crop (`AR_TOLERANCE`) and nothing has
been used yet, the slot is **left alone**: stock beats a mangled swap.

**Slots are measured at capture time and addressed by a stamped attribute.**
`stampSlots()` runs in `captureAttempt()` *before* `snapshotHtml()`, against
the capture frame's controlled 1280 px layout — the widget's own geometry,
before any host CSS exists to distort it. It writes `data-dmb-slot="N"` onto
the live frame DOM (thrown away moments later, so mutating it is free) and the
attributes ride into the clone; the manifest lands in `def.slots`. Class names
cannot do this job: the six photo thumbnails in a Yotpo strip share every
class, and Yotpo emits junk `id="null"` (§5.9). A slot records `{i, kind,
fill, mode, w, h, ar, fit}`; `mode` is `src` or **`bg`**, and the second is not
optional — Yotpo paints every review photo as an inline `background-image`
from an IntersectionObserver callback (§5.9), so measured on the reference
instance `383020` **all 10 slots are `bg` and zero are `<img>`**. An
`<img>`-only implementation would swap nothing on the exact widget this
feature exists for.

**Application is per-instance and page-side**, the same shape as Adapt/Revert
(§5.3) and Blend (§5.9), for the same reason: the right answer depends on the
client's page, which is unknown at import time. `applyImagery()` writes only
into one instance's DOM — never a def — and records what it overwrote in
`data-dmb-img-orig` so `revertImagery()` is exact. Baking substitutions into
the def at import was considered and rejected twice over: it would break
"static by design, one snapshot, frozen" (§5.9), *and* it would freeze the
widget to whichever store was loaded when it was imported, making it wrong for
the next prospect.

Design points that are load-bearing:

- **Default OFF.** Theme adaptation is on by default because it is reversible
  and essentially always an improvement; imagery replaces *content*, and the
  failure is asymmetric — it happens in front of a client. Same reasoning that
  put Blend behind a toggle (§5.9). Revisit only after watching real matches
  on real stores.
- **The `onerror` restore is a safety net, not a nicety.** Some store CDNs
  refuse cross-origin image loads by Referer (ours is `localhost`), and a
  broken-image icon mid-demo is far worse than the stock photo. Every swapped
  `<img>` gets it. Measured on Allbirds: 7/7 hotlinked images load.
- **`data-dmb-img-orig` is the source of truth for revert, not the manifest.**
  Revert queries the attribute, so it works even if the manifest is stale —
  which it can be, since `wzSave` re-renders an instance's `innerHTML` and
  destroys the nodes the swap was applied to. That path calls
  `refreshImagery()`, which invalidates `entry.slotsCache` and re-applies.
- **`imageryTargets()` is cached per instance** (`entry.slotsCache`).
  `renderEditor()` calls it for every demo row on every render, and the
  fallback path for manifest-less widgets is a `getComputedStyle` walk of the
  whole instance — cheap once, not thirty times during a drag.
- **Widgets imported before this feature still work**, via a live re-walk of
  the inserted instance (`slotsFor`). It is the weaker path — it measures
  inside the host page, where the store's CSS has already had its say — so
  re-import to get a real manifest. `def.slots` survives the database round trip,
  duplicate (⧉), edit, and "Copy as code"; `normalizeSlots()` in modules.js
  sanitizes rather than trusts it, because it round-trips through storage and
  a hand-edited def can carry anything.

**Nothing blocks.** Harvest runs in `requestIdleCallback` after
`initPage()` has finished — section detection is what must feel instant — and
the badge is purely informational: a widget is always droppable, imagery
applies when available and can be switched on after the fact. The one visible
cost this feature *could* have had is pop-in when a swapped image hasn't
decoded, which is why `predecode()` decodes the top `DECODE_TOP_K` of the pool
during idle time. That, not caching bytes, is what preloading effort is for
here.

**The badge** (`#img-badge`, topbar) reports `◐/◉ N site images` while
scanning / when settled, and `○ no site images` when the page yielded nothing
usable — the empty state is deliberately visible, because a silent badge
leaves the rep wondering why the toggle did nothing on a bot-blocked store.
Its tooltip breaks the pool down by role. Clicking it re-scans, which is also
the answer after a viewport switch (the pool is URL-based and unaffected by
viewport, but mobile CSS can reveal images that were `display:none`).

### 5.12 Share links — passing a widget to another rep

The gallery ships empty and every widget in it is private to one account
(§5.4, §5.8), so the second rep who wants a widget re-does the first rep's
import — same link if they can find it, and then re-types the name and re-picks
the product. **⤴** on the gallery card closes that loop: it copies
`def.sourceUrl` with the widget's metadata attached as UTM parameters, and the
importer recognizes its own scheme and pre-fills from it. The four pieces:

- **`def.sourceUrl`** — the preview link a capture came from, added by
  `captureAttempt`, sanitized by `normalizeModuleDef` (http(s) or empty; it
  round-trips through the database and lands in an href-shaped string), and
  carried by `persistLocalWidgets` and `moduleDefToSource`. Nothing renders from
  it, and nothing can re-derive it — drop it from either carrier and every
  imported widget silently loses its ⤴ after one reload. Hand-written widgets
  have none, which is exactly the test for showing the button.
- **`widgetShareUrl()` / `parseWidgetShareUrl()` / `stripShareParams()`**
  (modules.js, next to the registry — they are def↔URL logic used by both the
  card and the importer, and pure enough to test from the console). Standard
  UTM keys rather than private ones, because the link travels through Slack,
  mail and a CRM and should read as what it is:
  `utm_source` our marker · `utm_medium` constant · `utm_campaign` product ·
  `utm_content` name · `utm_term` description.
- **Recognition requires `utm_source`**, and reads only the fields present.
  A preview link may legitimately carry a merchant's own campaign tags, and
  naming a widget "summer-sale" from one is worse than not pre-filling at all.
  Absent fields fall through to the capture's derived meta rather than blanking
  it, so a link shared before a widget had a description still works.
- **The capture URL is stripped first** (`captureFromPreview`), so a shared link
  and the original render the identical widget — the platform shell reads its
  own query string, and a widget that differed by how the link reached you would
  be a nasty surprise mid-demo. It also makes re-sharing idempotent: the stored
  `sourceUrl` is clean, so `widgetShareUrl` re-attaches parameters instead of
  accumulating them. Stripping happens **only** on a link we recognize; a
  merchant's UTM tags on their own preview link are theirs to keep.

Pre-fill order in `wzImport`: shared metadata is applied **immediately**, before
the ~4 s capture (so the rep can see they got the intended widget rather than an
empty form), and again after it, where it out-ranks `suggestCaptureMeta` —
what a person wrote beats what was derived from a class name. Two consequences:

- `wzRefresh`'s neutral-empty-form branch (§5.9) now also fires while
  `wzImporting` with no markup, because those pre-filled fields would otherwise
  summon an "html is required" about a state the user never created — which is
  the exact thing that branch exists to prevent.
- Editing an existing widget, the widget's *own* name and description win over
  both: a re-capture refreshes markup and styles, it does not rename the widget.
  That matters more than it used to, because the dialog now opens with the
  widget's own link in the Import box (labelled **Re-capture**) — which is also
  the only place `sourceUrl` is visible or fixable.

Only metadata and a capture URL travel; hand-edited markup does not (the
recipient re-renders from the platform). Sharing *that* is "Copy as code" into
`custom-modules.js`, which is unchanged and now carries `sourceUrl` too.

### 5.13 Auth and the per-user gallery

The hosted half. Three ES modules and a database table; the app itself barely
noticed.

**The gate is a loader, not a redirect.** `index.html` loads exactly one script,
`boot.js`. It resolves a session, publishes `window.DMB_STORE` / `DMB_USER`,
and only *then* injects `modules.js`, `custom-modules.js`, `imagery.js` and
`app.js` in order. The ordering is the whole point: a redirect fired from
inside `app.js` would still have run `app.js`, and "only accessible after
login" would mean "ran, then left". A consequence to remember — **the script
load list moved out of `index.html` into `APP_SCRIPTS`**, so the §5.4
sample-widget restore switch and the ROLLBACK-IMAGERY.md deletion line both
live in `boot.js` now.

**A `body.booting` shroud** covers the chrome until that finishes, and is
*removed* rather than hidden — a signed-out visitor should not be able to read
the interface underneath.

**Login is its own page and owns the whole OAuth round trip.** `login.html`
sends the user to Google with `redirectTo` pointing back at itself, not at the
app, so the code exchange and the allowlist verdict happen in one place with
one error surface. It is deliberately self-contained: no Tailwind CDN, no
`app.css`, no `app.js` — it is the one page a stranger can reach.

**The allowlist is written three times, and that is not an accident.**
`email_allowed()` exists in `_proxy_core.py` (Python), `auth.js` (browser) and
`schema.sql` (SQL). They cannot share one copy: the proxy function has no
database driver, and the login page needs the rules before a session exists.
Only one of the three is a security boundary — **the SQL one**, via RLS. The
Python copy is abuse control on the proxy; the JS copy exists solely so the
login page can say *why* it turned someone away. When editing any of them,
check the other two, and keep the '@' on domain patterns — `@yotpo.com` without
it also matches `evil@notyotpo.com`.

**Row-level security is the actual privacy mechanism.** Every query in
`store.js` runs as the signed-in user and none of them mentions `user_id`; the
column defaults to `auth.uid()` and four policies enforce it. Do not "tidy" a
`.eq("user_id", …)` in and conclude the policy is redundant — the property
worth keeping is that a query which forgets the filter is still safe.

**Config comes from `/api/config` at runtime**, not from a committed file,
because a no-build-step static site has no deploy step in which to bake
environment variables. The anon key it serves is public by design.

**The proxy is gated by a cookie, not a header**, because the canvas loads
`/proxy` as an iframe *document* — a navigation carries cookies and nothing
else. `auth.js` mirrors the access token into `dmb-session` and refreshes it on
`onAuthStateChange`, since tokens roll roughly hourly and a stale cookie means
the canvas starts 401ing mid-demo while the app still looks signed in.
Verification is one call to Supabase's `/auth/v1/user`, memoized per warm
instance for 5 minutes so a capture's dozen CSS fetches cost one round trip.

**Writes are fire-and-forget, and therefore loud on failure.** `saveWidgetRemote`
does not block the dialog on a network round trip — that would stall a live
demo, and the widget is already registered in memory. The cost is that a failed
save looks exactly like a successful one, which is why the failure path sets a
red status saying the widget is in this session only. Keep that.

**Pre-hosting libraries are adopted once.** `migrateLocalWidgets()` lifts
`dmb.customWidgets.v2` into the account on first sign-in and renames the key to
`.backup` rather than deleting it. Without this, the cutover would look exactly
like "the app lost my widgets".

---

---

## 6. State model (all in `app.js`)

```js
state = {
  doc, win,        // iframe contentDocument / contentWindow (same-origin)
  sections: [{ id: "host-N", el, name, tag, hidden,
               parent,      // parent section entry (null = top level) — the tree
               depth,       // 0 for top level, parent.depth+1 below
               expanded,    // Editor shows this entry's children
               subsChecked }], // sub-detection already ran (runs once, lazily)
  demos:    [{ id: "demo-N", el, def, adapted, bg,
               flat,         // Blend toggle on (§5.9) — .dmb-flat on el; def = DEMO_MODULES entry
               imagery,      // site-imagery swap applied to this instance (§5.11)
               imageryVariant, // which draw the Shuffle button is on; 0 = the default match
               slotsCache }],// memoized imageryTargets() — renderEditor calls it per row
  host,            // sampled palette {font, headingFont, text, accent, contrast, radius, pageBg}
  imagery,         // site-image pool (§5.11): {pool, all, scanning, byRole}; null before
                   //   the first load, and whenever imagery.js isn't loaded at all
  counter,         // demo id sequence
  hostCounter,     // section id sequence — reset only by detectSections (fresh load)
  pendingDrop,     // {ref, where, rect} captured during dragover
  viewMode,        // "desktop" | "mobile" — survives page loads deliberately
}
```

Everything resets on `loadPage()`. Entries are distinguished by the presence
of `def` (demo) vs `name` (host) — `findEntry(id)` searches both arrays.
There is no persistence; a reload loses the demo (listed as future work in
the original spec: saving/sharing configurations).

---

## 7. How to verify changes (manual E2E)

0. **Decide which build you are testing.** Without a `.env.local`,
   `python3 server.py` runs the app open — no login, no saved gallery — and
   every check below works except 5h. With one, you get the hosted behaviour
   locally, including the login redirect and the proxy's session gate. Set
   `REQUIRE_AUTH=0` to keep the gate off while the rest is configured; that is
   the setting to reach for when the canvas unexpectedly renders
   "Not signed in" instead of a store page.
1. Start server (see §2 for the Claude-specific launch dance). Open the app.
   The gallery is **empty** by design (§5.4), so anything that inserts a widget
   needs one first: either import one (5c), register a scratch one
   (`DMB.addWidget({id:'t', name:'T', html:'<div class="dmbm-wrap">hi</div>'})`),
   or uncomment the `sample-modules.js` entry in **boot.js**'s `APP_SCRIPTS`
   for the run and re-comment it after (it moved out of `index.html` — §5.13).
2. Load the **Allbirds** sample. Expect: status "17 modules detected" (±2 if
   the theme changed), meaningful Editor names, product page visible with
   images. (2026-08: their current theme detects as **9** top-level sections
   — verified identical under the pre-sub-section detection logic, so a count
   near 9 is the site, not a regression. It has also measured 11 with scripts
   off on an earlier theme revision; 2026-08-11 it is **9 either way**, so the
   count no longer distinguishes the two paths — check `scriptTags` and store
   globals for that, per 2b.) The **JS** box is
   **ticked** by default again (§3.1 item 1), so the canvas URL ends
   `&scripts=1`, the frame's `sandbox` carries both tokens and is therefore
   inert by spec, and the store runs its own code — expect its own console
   errors (Allbirds' cart drawer fails to fetch cross-origin), theirs, not
   ours. Untick JS and reload for the sandboxed canvas.
2b. **The sandbox is a security claim, so test it as one** (§3.1). Untick JS
   and reload first — this is no longer the default path, so it is the one
   most likely to rot unnoticed. With JS off:
   ```js
   const cv = document.getElementById('canvas');
   cv.getAttribute('sandbox')                    // "allow-same-origin" — no allow-scripts
   !!cv.contentDocument.body                     // true: DOM access survives, which is the point
   cv.contentDocument.querySelectorAll('script').length          // 0
   !!(cv.contentWindow.Shopify || cv.contentWindow.dataLayer)    // false: nothing executed
   ```
   With JS ticked, the same four read
   `"allow-same-origin allow-scripts allow-forms allow-popups"`, true, ~93 and
   **true** — the sandbox is disabled by spec when both tokens are present, and
   that is the opt-in working, not a hole. A `sandbox` that stays on the frame
   while scripts run means `applyCanvasSandbox()` was called *after*
   `iframe.src`; the attribute is only read on navigation.
3. In the app console, drive the API (`'t'` = the scratch widget from step 1):
   ```js
   DMB.setSectionHidden(DMB.state.sections[1], true)          // hide
   const ref = DMB.state.sections[6];
   DMB.insertModule('t', {ref: ref.el, where: 'before'})
   DMB.state.host                    // sanity-check sampled palette
   DMB.setModuleBg(DMB.state.demos[0], '#f0ede4')
   DMB.toggleAdapt(DMB.state.demos[0])                        // revert
   // Sub-sections (reference page: bedrop.de/products/bee-cream-mit-bienengift
   // — expanding the product section → buy box exposes its star-rating line):
   DMB.toggleExpand(DMB.state.sections[1])
   DMB.state.sections.filter(s => s.parent === DMB.state.sections[1])
   ```
4. Synthetic drop (exercises the real dragover/drop path):
   ```js
   const d = document.getElementById('canvas').contentDocument;
   const dt = new DataTransfer(); dt.setData('text/plain', 'dmb:t');
   d.body.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, clientY:300, dataTransfer:dt}));
   d.body.dispatchEvent(new DragEvent('drop',     {bubbles:true, cancelable:true, clientY:300, dataTransfer:dt}));
   ```
5. Repeat on **Brooklinen** (different theme family: serif headings, navy
   accent, 20 sections) — adaptation should visibly differ from Allbirds.
   Then on **Death Wish Coffee** (the dark pole, third sample button): expect
   `DMB.state.host` ≈ `{text: rgb(255,255,255), accent: rgb(225,39,39),
   pageBg: rgb(0,0,0)}` — white text and the brand red accepted, *not* the
   light-page fallbacks (§8 #11). An inserted, adapted widget must be
   readable on the black page.
5b. Widget routes (§5.8), all drivable from the app console:
   ```js
   DMB.addWidget({id:'t', name:'T', html:'<div class="dmbm-wrap">hi</div>', css:'h2{color:red}'})
   DMB.modules.length                                  // gallery grew by 1
   DMB.scopeModuleCss('h2 { color: red }')             // → '.dmb-module h2 …'
   DMB.insertModule('t', {ref: DMB.state.sections[3].el, where: 'after'})
   // then: host h2s must still be their own color (scoping didn't leak),
   // and #dmb-custom-styles must exist inside the canvas document.
   DMB.updateWidget('t', {html:'<div class="dmbm-wrap">edited</div>'})  // instance re-renders
   DMB.removeWidget('t')                               // instance survives, card goes
   ```
   Gallery filtering (§5.4): register one widget per product
   (`DMB.addWidget({id:'l', name:'L', product:'loyalty', html:'…'})`), then
   `DMB.setGalleryProduct('loyalty')` shows only it, toggle labels read
   "Reviews (N) / Loyalty (1)", `DMB.setGallerySearch('zz')` shows the
   no-match hint and the count "0 of 1 widgets", and typing in the real
   `#gallery-search` box filters per keystroke. In the ＋ dialog, a new widget
   must show the "product is required" error with Save disabled until a radio
   is picked; saving must land the gallery on that widget's tab. A def with
   `product:'points'` must be rejected; one with no `product` must register
   as reviews.
   Also uncomment the example in `public/custom-modules.js` once after
   touching the registry — that's the only check of the file route's
   script-tag wiring — then re-comment it. Same for `sample-modules.js`
   (§5.4): with its `<script>` on, expect 11 cards,
   `.dmb-module.dmb-w-rating-summary .dmbm-rs-top` in
   `DMB.modules[0].scopedCss`, and thumbnails that are actually styled (the
   `.dmbm-rs-num` numeral computes to 52px) — that proves the restore path and
   that the old built-in CSS still lands via the registry.
   Cross-widget isolation (§8 #18): with two widgets registered, widget A's
   `scopedCss` must never apply to widget B's DOM — insert both on one page
   and check a class they share (any two Yotpo imports share
   `.yotpo-reviews-list-wrapper`; 383020 must compute `display: block` while
   1087254 computes `flex` beside it). Every inserted wrapper and every
   gallery thumbnail carries `dmb-module dmb-w-<id>`.
   An empty gallery must show its `.panel-empty` hint and the header count
   "empty". Storage keys after a fresh load: no `dmb.customWidgets.v1` (app.js
   drops it) and no `.v2` (lifted into the account and renamed `.backup` on
   first sign-in, §5.13) — a widget you save appears as a row in Supabase, not
   in `localStorage`.
5c. Widget import (§5.9). Do this in a **foreground** tab — a backgrounded tab
   throttles the poll interval (and after a few minutes aligns timers to the
   minute), which stretches a 22 s timeout into minutes. Reference URL: the
   Yotpo preview for instance `1004109`.
   ```js
   const cap = await DMB.captureFromPreview("<preview url>", console.log)
   cap.metrics                  // must clear looksRendered: ~767 els / ~2584 txt
   cap.html.length              // ~112 KB — a ~9 KB capture is the §8 #6 skeleton
   /\bvar\(--dmb-star\)/.test(cap.html)   // theme swap happened
   // Lazy photos (§8 #8): every thumbnail button must carry a background-image.
   const th = cap.html.match(/<button[^>]*image-thumbnail-\d+"[^>]*/g)
   th.length + "/" + th.filter(t => /background-image/.test(t)).length  // 15/15 desktop, 14/14 mobile
   DMB.addWidget(cap); DMB.insertModule(cap.id, {ref: DMB.state.sections[6].el, where:'before'})
   ```
   Then, on the canvas: stars amber (not the host accent), review photo strips
   84 px tall with 82×82 photos that actually load, Adapt → Revert → Adapt,
   background swatch, and Mobile 390 px with no horizontal overflow.
   **Re-import between runs, don't reuse a stored widget** — `addWidget` refuses
   a duplicate id and suffixes the new one, so `insertModule(cap.id)` then drops
   the *stale* def from your saved gallery and you measure the previous build. Delete
   your gallery's copy (or check `DMB.modules.map(m => m.id)`) before
   believing a fix landed.
   **Structural checks first, on every import** — these three cost nothing and
   they are what the §8 #15–#17 failures actually looked like. Two of them
   ("the rules are in `cap.css` but do nothing") are invisible from the markup
   and from the screenshot alike, so run them before diagnosing any *color*:
   ```js
   // 1. Braces balance — an unclosed author @media swallows every rule the
   //    importer appends after it (§8 #16). Must be 0, not "probably fine".
   (() => { let n = 0; for (const c of cap.css) { if (c === "{") n++; else if (c === "}") n--; } return n })()
   // 2. No corrupted var() references (§8 #15). Must be null.
   (cap.html + cap.css).match(/var\(--[\w-]*var\(/g)
   // 3. The appended rules really reached the CSSOM, in order. After inserting:
   const d = document.getElementById("canvas").contentDocument;
   const rs = d.getElementById("dmb-custom-styles").sheet.cssRules;
   [rs.length, rs[rs.length - 1].cssText]   // ~493, and the radius rule last
   ```
   Check 1 is the cheap standalone version of `DMB.balanceCss`; test that
   directly on synthetics too — `"a{b:c"` → one `}` appended, `"a{/*}*/}"` and
   `"a{content:'}'}"` → unchanged (comments and strings skipped), `"}a{b:c"` →
   still one `}` appended (a stray close must not mask a later open), and an
   already-balanced sheet → byte-identical.
   Frozen-background legibility (§8 #14, reference: instance `1087254`, guid
   `V57H595IdhpNCU7nuEaiMrC1XHtSnaLGO8q27kEW` — a store that pins a cream
   background on the AI summary card). On **Death Wish Coffee**, which is where
   the pair splits:
   ```js
   cap.css.match(/\.[^{}]*\{\s*--dmb-text:[^}]*\}/g).length   // 7 rules (§8 #19 added the floating-label one)
   // …of which the .dmb-flat COMPANIONS must be excluded before the next
   // check: a companion is `--dmb-text: inherit` and deliberately carries no
   // color declaration — releasing the pin is its whole job (§5.9). Including
   // them made this read false on a perfectly healthy capture.
   cap.css.match(/\.[^{}]*\{\s*--dmb-text:[^}]*\}/g)
     .filter(r => !/\.dmb-flat\b/.test(r))
     .every(r => /color:\s*var\(--dmb-text\)/.test(r))  // true — §8 #19
   cap.css.match(/--(?:primary|secondary)-font-family\s*:\s*[^;}]*/g)
   // → all clean var(--dmb-*); a stray `var(--dmb-heading-font)"Manrope"` is the
   //   pass-1 truncation, and it renders as the wrong font, not as nothing
   ```
   The `.yotpo-paragraph-summary` card must stay `rgb(245,242,237)` with its
   title and `.yotpo-ai-text` at `rgb(31,36,48)` — the title in the host's
   *heading* font (`Revans-Bold`, not the body `Fenomen-Sans-Book`) — while
   `.yotpo-headline` outside the card is still white. Adapt → Revert → Adapt must
   leave the card dark-on-cream in all three states (the surface is frozen, so
   the text is too) and only toggle the text outside it.
   Floating labels (§8 #19, reference: the Rixo reviews instance `383020`, guid
   `HWmChWHhQECiJKD42Pe6YtcLTeqd7BuRPMC4w62d` — cream merchant pills with
   absolutely-positioned labels overlaying a white combobox input). On **Death
   Wish Coffee**, every `.yotpo-dropdown-label` in the inserted widget must
   compute `rgb(31, 36, 48)` (all 10: the nine filter pills + Sort by) while
   `.yotpo-review-content` stays white; `cap.css` must contain a rule keyed
   `.yotpo-dropdown-label.yotpo-dropdown-label--inside`. A label back at white
   means the overlay sweep didn't run — check the capture frame got stretched
   (`elementsFromPoint` sees nothing below the frame's viewport) before
   blaming the sweep itself.
   The same instance is the Blend-toggle reference (§5.9): `cap.css` must hold
   6 `.dmb-module.dmb-flat` companions, every id in their selectors present in
   `cap.html` (`#yotpo-app`, `#yotpo-reviews-container` — never `#null`, never
   a shell id), and `def.flattenable` true. On Death Wish,
   `DMB.toggleFlat(DMB.state.demos[0])` must flip
   `.yotpo-review-left-panel` cream/dark → transparent/white,
   `.yotpo-new-review-btn` likewise (that one proves id parity — its cream is
   pinned by a merchant 2-id `!important` rule), and dropdown labels
   `#1f2430` → white; toggling back must restore the frozen values exactly.
   Review copy stays white in both states, and Blend + Revert leaves labels at
   the default dark (the §9 revert-on-dark caveat, not a bug). Old defs
   (pre-blend imports) must show no Blend button and toggle nothing.
   Dark-theme override bridging (§8 #10, reference: instance `1336947`, guid
   `WOzPOsHxJSUSDd4ojDcVUxd3CWdTjidQCN3KSQDy` — a white-on-black skin with
   per-instance override CSS): after capture, `cap.html + cap.css` must contain
   **zero** `background: #000` / `color: #fff` declarations,
   `--text-color: var(--dmb-text)` and `--stars-color: var(--dmb-star)` inline
   (by-name mapping, not accent for all three), and the two Graphik Compact
   `@font-face` blocks intact while the `.yotpo-headline` font-family is
   `var(--dmb-heading-font)`. Dropped on a light store it must sit on the
   store's own background with dark text. A synthetic check of the rewriter
   itself is `DMB.rewriteCaptureTheme(css, theme, true)` with a hand-built
   theme — greys, `url(...)` values, translucent rgba and `@font-face` must
   come back byte-identical.
   That same instance is the reference for **foreground anchoring** (§8 #15) —
   its filter UI is painted from palette constants the theme map never names, so
   check it on *both* polarities. On **Death Wish Coffee** the "Reviews"
   headline, the "Search…" placeholder, every dropdown label ("Used for",
   "Experience", …) and the review copy must all compute `rgb(255, 255, 255)`;
   on **Allbirds** they must all be dark. A subset going the other way is the
   signature of an unbridged constant, and one *specific* thing to look at is
   the tooltip, whose grey surface is frozen: `.yotpo-simple-tooltip` must carry
   its own local `--dmb-text` (`cap.css` contains
   `.yotpo-simple-tooltip { --dmb-text: …`) and its label must stay light on
   that grey on **both** stores — a rule keyed
   `.yotpo-simple-tooltip.yotpo-simple-tooltip--right` instead is §8 #17, and it
   only breaks the *sibling* tooltips, so check more than one.
   Finally the CTA radius, which needs `!important` to beat the widget's own id
   selector (§8 #17): on Allbirds `.yotpo-new-review-btn` computes **24px** while
   the smart-topic filter chips keep their captured **5px**; on Death Wish the
   button is **0px**. A rounded wrapper around a square button means the rule
   lost the specificity fight.
   Note what is *not* a negative test: a bogus `widget_instance_id` makes Yotpo
   render its **generic default widget**, so the capture legitimately succeeds
   (936 els / 4213 chars, named "Yotpo Base Layout"). The content bar guards
   against an *empty* capture, not against the wrong widget — that's what the
   dialog's live preview is for. To exercise the failure path, point the import
   at a page with no widget (e.g. `https://example.com`): expect a rejection
   with a clear message, nothing saved, and the form left blank showing the
   neutral "Paste a preview link above…" line (§5.9) rather than red
   required-field errors. Through the dialog, the starter template must vanish
   the moment Import is pressed — check `wz-html` is empty while the status
   line still reads "Loading the preview page…".
   Also exercise cancellation (§8 #9),
   which is dialog-only: start an import, press Cancel mid-flight, reopen ＋ and
   import again — the button must return to "Import" (enabled), the capture frame
   must be gone (`document.querySelectorAll("iframe.dmb-capture-frame").length`
   → 0), and the second import must complete normally.
5e. **The preview pair** (§5.10), dialog-only and the cheapest check in this
   list — it needs no store loaded, because the polarities are its own samples.
   After any import, in the app console:
   ```js
   const pv = [...document.querySelectorAll("#wz-preview .wz-pv")];
   pv.map(b => getComputedStyle(b).backgroundColor)   // rgb(255,255,255), rgb(0,0,0)
   // Body copy must INVERT between the boxes; frozen-surface text must NOT.
   pv.map(b => getComputedStyle(b.querySelector(".yotpo-review-content")).color)
   // → rgb(31,36,48) then rgb(244,245,247)
   pv.map(b => getComputedStyle(b.querySelector(".yotpo-paragraph-summary")).backgroundColor)
   // → the frozen cream, twice (§8 #14 — it is pinned, so its text is too)
   ```
   Two colors that fail to invert mean the widget paints its own opaque
   background over the box — check for a captured `body`/`:root` background
   rule, which `scopeOneSelector` maps onto the wrapper by design (§5.8). That
   is the pair reporting the truth (it *will* do that on a dark store), not a
   preview bug.
   With a store loaded and **site styling** ticked, exactly one box must relabel
   to "This page" and carry the sampled palette — the dark box on Death Wish
   Coffee, the light box on Allbirds — while the other keeps its generic sample.
   On a `flattenable` capture the **blend** checkbox must appear (and only
   then); ticking it must dissolve the frozen surface *and* release its text in
   both boxes at once (`--dmb-text: inherit`, §5.9) — a surface that blends
   while its text stays pinned is the pair-splitting bug of §8 #14 returning.
   Nothing about blend may reach the saved def: `DMB.modules.find(…)` after Save
   must show no `.dmb-flat` class on the stored html, and a freshly dropped
   instance must start unblended.
   Finally the button label: after a capture it reads **Re-capture**, editing the
   URL field flips it back to "Import", and pressing Re-capture runs an ordinary
   import (form clears, status narrates, fields refill).
5d. **A loyalty import too** — the two families fail differently and reviews
   alone doesn't cover either half of §8 #12. Reference: referral-share instance
   `1183441`, guid `lovPorYKC8W-Rh20UZd9vw`, on `yap.yotpo.com/preview-wadmin/`
   (note the *different shell path* — the loyalty preview is served there, and
   `yap.yotpo.com/preview/` 302s to `reviews.yotpo.com/preview/`, which is the
   authenticated admin SPA and captures nothing: 174 elements, 0 text. That's a
   wrong link, not a regression — check the shell has a `.yotpo-widget-instance`
   before blaming the code).
   ```js
   const cap = await DMB.captureFromPreview("<loyalty preview url>", console.log)
   cap.metrics        // ~17 els / ~165 txt — clears the bar on TEXT, not els (§8 #12)
   cap.html.slice(0, 80)   // root must be .yotpo-widget-referral-share, not a
                           // .yotpo-container-background three levels in
   ```
   Expect one capture in ~5 s with no retries: the widget renders in ~1.8 s, so
   a retry in the status log means the content bar rejected a good render again.
   `findCaptureRoot` is cheap to test directly on synthetic shapes — build
   same-origin `srcdoc` frames for a filled mount, an empty mount, a multi-child
   mount, a replaced mount and a non-Yotpo wrapper, and assert the first four
   resolve as §5.9 describes.
   Expect the *hardcoded colors*, *literal font* and *un-prefixed classes*
   warnings — captured platform markup legitimately looks like that.
   Then check the **theme actually bridged** (§8 #13), which the metrics can't
   tell you: the markup must contain none of the platform's literals and the
   radius rule must have been emitted.
   ```js
   cap.html.match(/rgb\((?:255, 255, 255|0, 0, 0|55, 51, 48|118, 140, 220)\)/g)  // → null
   cap.css.match(/border-radius: var\(--dmb-radius\)/)   // → the CTA rule, last chunk
   DMB.sampleCaptureTheme(root, frameWin, url)   // → role keys with *lists* of colors
   ```
   Run 5c's three structural checks here too (balance 0, no `var(--…var(`, the
   radius rule last in the CSSOM) — this family appends the same rules and is
   just as exposed to an unbalanced author sheet.
   Drop it on **Allbirds** (`accent rgb(33,33,33)`, `radius 24px`, cream page):
   tile background `rgba(0,0,0,0)` so the store's own background shows through,
   text `rgb(0,0,0)` in Geograph, buttons `rgb(33,33,33)` at **24px** (they
   capture at 0). Revert → indigo `rgb(79,70,229)` at 10px; re-Adapt → back.
   Then on **Death Wish Coffee**, where body and heading fonts differ so the
   two font slots are distinguishable: the title must compute `Revans-Bold`
   (heading slot, from the platform's *primary* font) while body copy is
   `Fenomen-Sans-Book`, text white, buttons brand red at 0px radius. Note the
   widget lands in that store's red band, so a red outline button on red is
   correct-but-invisible — the background swatch is the documented answer
   (§9), not a bug.
5f. **Site imagery** (§5.11). Needs a store loaded *and* a widget with image
   frames — the reviews instance `383020` is the reference on both counts (10
   slots, of which 1 avatar and 9 fillable, and every one of them `bg` mode).
   On **Allbirds**:
   ```js
   DMB.imagery()   // {pool: ~31, scanning: false, byRole: {product: ~23, lifestyle: ~5, other: ~3}}
   // ZERO 'icon' entries is the check that matters here: a 1920px packshot
   // classified as an icon is the utility-CSS false-reject of §5.11 returning.
   DMB.imagery().pool.filter(c => c.role === 'icon').length     // 0
   DMB.imagery().pool.filter(c => c.from === 'shopify').length  // ~7 — the product endpoint answered
   ```
   Then insert the widget and toggle:
   ```js
   const e = DMB.state.demos[DMB.state.demos.length - 1];
   DMB.imageryTargets(e).length            // 10 — from def.slots, not a live walk
   DMB.toggleImagery(e)                    // status: "7 of 10 images from this site"
   e.el.querySelectorAll('[data-dmb-img-orig]').length   // 7 — PARTIAL, not 9 (FILL_RATIO)
   e.el.querySelector('[data-dmb-slot="0"]').hasAttribute('data-dmb-img-orig')  // false — avatar never filled
   ```
   Four things that must hold, each guarding a distinct decision:
   - **The avatar slot is untouched** and so is every `fill:false` slot. A
     packshot in the reviewer's avatar ring is the most visible way this
     feature can embarrass someone.
   - **The fill is partial and spread** — 7 of 9 fillable on this widget, with
     gaps, not the first 7. All-filled means `FILL_RATIO` stopped being
     applied or the stride collapsed.
   - **Revert is byte-exact.** Snapshot the slots' urls, toggle on, toggle
     off, compare: identical, and `[data-dmb-img-orig]` back to 0.
   - **The swapped images actually load.** Background-image slots can't report
     load state, so probe them (`new Image()` per url) — 7/7 on Allbirds. A
     failure here is CDN Referer blocking, which the `onerror` restore is
     supposed to catch; check the slot fell back to its captured photo rather
     than going blank.
   **Shuffle** (⟳ on the chip). `DMB.shuffleImagery(e)` five times in a row must
   produce five *distinct* sets — compare the joined slot URLs, not just the
   count, since the fill pattern moving is half the effect:
   ```js
   const sig = () => [...e.el.querySelectorAll('[data-dmb-slot]')]
     .map(x => (/url\("?([^")]+)/.exec(x.style.backgroundImage)||[])[1] || x.getAttribute('src')).join('|');
   const seen = new Set([sig()]);
   for (let n = 0; n < 4; n++) { DMB.shuffleImagery(e); seen.add(sig()); }
   seen.size          // 5 — every press changed something
   e.imageryVariant   // 4
   ```
   Role preference is what Shuffle rotates, and it is easiest to check on a
   synthetic pool where crop quality is equal on both sides, so *only*
   preference can decide (this is the §5.11 `ROLE_PENALTY` fix — before it,
   preference order was inert and this test returns packshots for both):
   ```js
   const pool = [{url:'p1',key:'p1',role:'product',w:100,h:100},{url:'p2',key:'p2',role:'product',w:100,h:100},
                 {url:'l1',key:'l1',role:'lifestyle',w:100,h:100},{url:'l2',key:'l2',role:'lifestyle',w:100,h:100}];
   const s = (i,kind) => ({i,kind,fill:true,mode:'src',w:100,h:100,ar:1,fit:'cover'});
   IMAGERY.matchSlots([s(0,'ugc'), s(1,'ugc')], pool, {variant:0}).map(a=>a.url)      // ['l1','l2']
   IMAGERY.matchSlots([s(0,'product'), s(1,'product')], pool, {variant:0}).map(a=>a.url) // ['p1','p2']
   ```
   Also: variant 0 must equal the un-shuffled match (toggle off/on after
   shuffling — `e.imageryVariant` resets only on a fresh insert, so compare
   `matchSlots(slots, pool)` against `matchSlots(slots, pool, {variant:0})`),
   and the ⟳ button must be **absent** from the chip while imagery is off.
   **Chip position on a tall widget** (§8 #20) — the check that the chip is
   still *reachable*, which no screenshot will tell you. On Allbirds with a
   full-height widget inserted, hover it, then scroll into it and compare the
   chip against the header **measured at that moment** — do not hardcode the
   header height, Allbirds' sticky header collapses from 48px to 32px once you
   scroll, and a constant makes this test lie in one direction or the other:
   ```js
   const doc = DMB.state.doc, win = DMB.state.win, chip = doc.getElementById('dmb-chip');
   const chromeH = () => { let h = 0;
     for (const fx of [0.5, 0.15, 0.85]) for (const el of (doc.elementsFromPoint(Math.round(win.innerWidth*fx), 2)||[])) {
       const id = el.getAttribute && el.getAttribute('id'); if (id && String(id).startsWith('dmb-')) continue;
       const cs = win.getComputedStyle(el); if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
       const r = el.getBoundingClientRect(); if (r.top <= 4 && r.bottom > h) h = r.bottom;
     } return h; };
   e.el.dispatchEvent(new win.MouseEvent('mouseover', {bubbles:true}));
   const top = e.el.getBoundingClientRect().top + win.scrollY;
   for (const d of [1000, 2000, 3500]) {
     win.scrollTo(0, top + d); doc.dispatchEvent(new win.Event('scroll'));
     console.log(d, parseFloat(chip.style.top) - win.scrollY, '>=', chromeH());
   }
   ```
   Every row must clear (measured: chip at 38 against a 32px collapsed header).
   The old code put it at **6** in all three, i.e. inside the header band, which
   is the bug. Then check the
   other two clamps: with the widget below the fold the chip sits at its top
   edge (`chipTop === widgetTop + 6`), and scrolled *past* the widget the chip
   stops at `widgetBottom − chipHeight − 6` instead of following the scroll.
   Note the automation caveat: the browser pane reports `innerHeight === 0`
   when it isn't displayed, which collapses all this geometry — set
   `canvas.style.height` explicitly before measuring, and reset it plus
   `DMB.layoutViewport()` afterwards.
   Empty-pool degradation, on `https://example.com`: badge reads
   `○ no site images`, and an inserted widget's Editor row shows `▧ ↺ ✕` with
   **no** `▢/▣` — the toggle must not offer itself when there is nothing to
   offer. `DMB.imageryTargets(entry)` → `[]`.
   The capture side is checked by 5c's structural checks, which slot stamping
   must leave untouched: on a fresh `383020` capture, brace balance still 0,
   `corruptedVars` still null, 7 fixed-bg rules, 6 `.dmb-flat` companions,
   radius rule still last — plus `cap.slots.length === 10` and
   `(cap.html.match(/data-dmb-slot=/g) || []).length === 10`.
   The `wzSave` re-render path is worth exercising once directly, since an
   `innerHTML` write destroys the swapped nodes *and* the originals recorded on
   them: toggle imagery on, edit the widget's description, Save — the instance
   must come back with the same number of slots swapped (`refreshImagery`), and
   Revert must still be clean afterwards.
5g. **Share links** (§5.12) — pure functions plus one dialog path, and the whole
   thing is checkable without a store or a real capture:
   ```js
   const u = "https://yap.yotpo.com/preview-wadmin/?guid=abc&widget_instance_id=1183441";
   const def = {name:"Referral Share", desc:"Imported from yap.yotpo.com", product:"loyalty", sourceUrl:u};
   const s = DMB.widgetShareUrl(def);
   DMB.parseWidgetShareUrl(s)          // {name, desc, product} — all three back
   DMB.stripShareParams(s) === u       // true: the capture URL round-trips clean
   DMB.widgetShareUrl({...def, sourceUrl: s}) === s   // re-sharing doesn't accumulate
   DMB.parseWidgetShareUrl("https://x.com/p?utm_source=mailchimp&utm_campaign=summer")  // null
   DMB.stripShareParams("https://x.com/p?utm_source=mailchimp&utm_campaign=summer")     // unchanged
   DMB.widgetShareUrl({name:"hand written", product:"reviews"})   // null — no ⤴ button
   ```
   Then the two UI halves. On the card: register one widget *with* a `sourceUrl`
   and one without, and check only the first shows ⤴ (`[...card.querySelectorAll(
   ".gal-actions .icon-btn")].map(b => b.textContent)` → `["⤴","⧉","✎","✕"]` vs
   `["⧉","✎","✕"]`), that a reload keeps it (`sourceUrl` must survive
   `dmb.customWidgets.v2`), and that ⧉ duplicate carries it. Clipboard denial is
   a real path, not an edge case — under automation `navigator.clipboard` is
   usually blocked, and the button must fall back to logging the link with the
   status line saying so, never fail silently.
   On the dialog, the pre-fill is visible **during** the capture, so point an
   import at a share link over `https://example.com` (which never renders a
   widget) and read the form ~1 s in: Name/Description/Id/product filled from the
   link, `wz-html` still empty, and the issues list showing the single neutral
   "Importing — the captured widget will land here." line — *not* red required-
   field errors (§5.12). In the same breath check the frame is fetching the
   stripped URL:
   ```js
   document.querySelector("iframe.dmb-capture-frame").src
   // …?url=https%3A%2F%2Fexample.com%2Fpreview%3Fguid%3Dzzz&scripts=1&dmb-capture=1&guid=zzz
   // — no utm_* anywhere, and the original query still riding along
   ```
   Finally, opening ✎ on an imported widget must prefill the Import box with its
   own link and label the button **Re-capture**; a hand-written widget's box
   stays empty and says "Import".
5h. **Auth and the per-user gallery** (§5.13). Needs a `.env.local` with real
   Supabase values; everything here is invisible without one.
   - **The gate loads nothing.** Sign out, then open `/index.html` directly: it
     must land on `login.html` with `window.DMB` **undefined** — the app must
     not have run at all. A gate that redirects *after* app.js has executed is
     the failure this design exists to prevent.
   - **The shroud is removed, not hidden**:
     `document.getElementById('boot-shroud')` → `null` once booted.
   - **The chip names the account** — `DMB.user().email` matches the topbar,
     and `Sign out` returns you to `login.html` with the gallery gone on the
     way back in.
   - **Isolation is the whole product claim, so check it against a second
     account**, not by reading the policy: sign in as someone else and confirm
     the gallery is empty, then confirm the first account's widgets are still
     there when you switch back. If both see the same widgets, RLS is off —
     re-run the sanity queries at the bottom of `schema.sql`.
   - **A rejected email is rejected**: sign in with an address on neither list.
     Expect a bounce to `login.html?denied=…`, a readable explanation, and no
     row written.
   - **The proxy is gated too.** With a session, a store page loads normally;
     with the cookie cleared (`document.cookie = "dmb-session=; Max-Age=0; Path=/"`)
     the canvas renders the "Not signed in" page instead. That page appearing
     *unprompted* means the cookie went stale — `auth.js`'s
     `onAuthStateChange` is what keeps it fresh.
   - **Failed saves are loud.** Break the key (`SUPABASE_ANON_KEY=nonsense`,
     restart) and save a widget: the status line must say it is in this session
     only. Silence here is the bug — the widget looks saved either way (§5.13).

6. Proxy smoke test without a browser:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173/proxy?url=https%3A%2F%2Fwww.allbirds.com%2Fproducts%2Fmens-tree-runner-go&scripts=0"
   ```

Known-good hover check: real mouse hover shows the chip; synthetic
`computer`-tool hover does **not** penetrate iframes — dispatch `mouseover`
via JS instead (don't chase this as a bug, it's an automation artifact).

---

## 8. Bugs already found and fixed (don't regress)

1. **`hidden` attribute vs. author CSS** — `.browser-loading { display:flex }`
   overrode the HTML `hidden` attribute (UA `display:none` loses to author
   styles), so the spinner showed permanently. Fix: explicit
   `.browser-empty[hidden], .browser-loading[hidden] { display:none }` in
   `app.css`. If you add more overlay states, repeat this pattern.
2. **Stale CSS after edits** — `SimpleHTTPRequestHandler` sends
   `Last-Modified`, browsers cache aggressively. Fix: global
   `Cache-Control: no-store` via the `end_headers()` override in `server.py`.
3. **Scientific-notation border-radius** — pill buttons compute as e.g.
   `1.67772e+07px`; the original `^\d+px$`-style regex missed it, so the
   radius wasn't clamped. Fix: `parseFloat` + cap at 24px in
   `sampleHostStyles`.
4. **Canvas collapse at narrow widths** — the `290px 1fr 320px` grid squeezed
   the center column to zero in a narrow window. Fix:
   `body { min-width: 1080px; overflow: hidden auto }` — a desktop tool
   scrolls horizontally rather than destroying its layout.
5. **`el.id` is not always a string** — a Shopify buy `<form>` containing
   `<input name="id">` returns that *element* from `form.id`, and inline
   SVG returns an `SVGAnimatedString`; `.startsWith` threw once sub-section
   detection reached those elements (top-level detection never had). Fix:
   `el.getAttribute("id")` in `isSignificant`/`nameFor`, plus
   `tagName.toUpperCase()` so the `SVG` entry in `SKIP_TAGS` actually matches
   inline `<svg>` (lowercase `tagName`).
6. **Silent empty widget imports (the `mode-preview` race)** — imports
   intermittently stored a ~9 KB, star-less widget that *looked* like a success.
   Cause: the Yotpo loader reads `mode-preview` off its mount when it
   initializes, and the parent-side tagging interval sometimes lost that race,
   leaving the widget rendering a dataless skeleton. Proven by A/B: tagged
   **767 elements / 2584 chars / 107,799 bytes**, untagged **36 / 81 / 9,598**.
   Two-part fix, keep both: `CAPTURE_BOOTSTRAP` injected server-side as the
   document's first script (§5.1/§5.9) so the observer can't lose, and the
   `looksRendered()` content bar so a skeleton is rejected instead of saved.
   Note the failure mode when touching settle logic: DOM *quiescence* does not
   imply *rendered* — a skeleton is perfectly quiet.
7. **Imported SVG stars repainted by the host page** — Allbirds has a broad
   `!important` fill rule, and SVG presentation attributes lose to *any* author
   rule, so captured star gradients turned brand navy. A plain inline style
   wasn't enough either. Fix: `snapshotHtml` promotes `fill`/`stroke`/
   `stop-color` to `!important` inline styles, written as raw attribute text so
   the color spellings still match the theme-value swap.
8. **Imported widgets lost their review photos** — every photo strip captured as
   a 2px-tall row of 0×0 buttons with no `background-image`, while the same
   widget shows 82×82 photos on its preview page. Cause: Yotpo paints those from
   an `IntersectionObserver` callback, and an IO inside an iframe only sees the
   iframe's intersection with the *top-level* viewport, so the off-screen capture
   frame fired none. Moving the frame **into** the viewport and scrolling the
   widget through it is a trap: it costs ~9 s per import and still captures
   nothing while the tab is hidden, because a hidden document runs no rendering
   lifecycle and so delivers no IO callbacks at all, wherever the frame sits
   (proven: `requestAnimationFrame` never ran, and thumbnails parked at y=315
   inside the intersecting band stayed empty). Fix: `CAPTURE_BOOTSTRAP` replaces
   `IntersectionObserver` with a stub that reports everything as intersecting,
   so lazy content resolves off a `setTimeout` — no geometry, no visibility
   dependency, and captures become reproducible under automation. Measured on
   instance 1004109 with an off-screen frame in a hidden tab: 14/14 thumbnails
   with images, 6/6 review photos at 82×82, 9 distinct CDN files (was 2), 4.5 s
   total. Keep the stub **async** — page code routinely calls
   `observer.disconnect()` from inside its own callback, using a variable
   assigned after `observe()` returns.
9. **Cancelling an import killed the Import button until a reload** —
   `abortCapture()` cleared the poll interval, which is the only thing that ever
   *checks* `run.cancelled`, so `waitForRender`'s promise never settled;
   `wzImport()` stayed parked on its `await`, its `finally` never ran, and the
   button stayed `disabled` (a disabled button swallows clicks silently, so the
   next Import looked like it did nothing at all). Fix: runs carry an `aborters`
   list and `abortCapture()` rejects them with "Import cancelled" — cancellation
   has to *settle* the promise, not just stop the timers. Starting an import also
   aborts the previous one, whose rejection lands after the new run began, so
   `wzImport()` sequence-stamps its runs and a superseded one may not touch the
   status line, the fields or the button. `closeWidgetEditor()` bumps the same
   counter for the same reason: the killed run's `finally` would otherwise clear
   `wzImporting` and re-render the *next* dialog's form.
10. **Imported dark-theme widgets kept the original store's skin** — a
   white-on-black Yotpo instance (Allies of Skin, 1336947) dropped onto a
   light store as a black slab with invisible text and blank white buttons.
   Two causes, both in the old find-and-replace theme swap: (a) the instance's
   `--primary-color`, `--text-color` and `--stars-color` were all the same
   white, so swapping *values* in map order painted text and stars with the
   accent mapping; (b) the store's per-instance override CSS
   (`yotpo-widget-override-css`) hardcodes the theme as literals spelled
   differently from the sampled values (`#000` / `#fff` vs `rgba(0,0,0,1)`),
   and the swap never touched captured CSS at all — CSSOM respellings
   (`rgb(255, 255, 255)`) slipped through in the HTML too. Fix:
   `rewriteCaptureTheme()` (§5.9) — by-name rewriting for mapped properties,
   color-parsed + role-based (background vs foreground) mapping for literals,
   applied to markup *and* captured CSS. When touching it, keep the role
   pairing (theme-bg as background → `transparent`, theme-bg as text →
   `var(--dmb-accent-contrast)`) — it's what keeps every legible original
   color pair legible after mapping. Widgets imported before this fix carry
   the broken markup in their def — the remedy is re-importing the link, not
   any code path.
11. **Adapted widgets were unreadable on dark stores** — on Death Wish Coffee
   (black page, white body text) every adapted widget got dark text on the
   black background. `sampleHostStyles` assumed a light page: body text with
   luminance > .92 was "sanity-checked" away and replaced with the dark
   fallback `#1f2430`, and the accent scan skipped white buttons — precisely
   the *correct* samples on a dark store. Fix: sample the page background
   first (body → html → white) and measure every check as contrast against
   it, with fallbacks flipped when the page is dark (§5.3). `host.pageBg` was
   added for the dialog preview, which otherwise shows a light-on-dark
   palette against its white box. Affects all widgets, not just imports —
   any adapted module on a dark store had invisible text.
12. **Loyalty widgets could never be imported** — every loyalty/referral preview
   link failed with "no rendered widget was found" after ~40 s of retries, while
   the same link rendered fine in a browser tab. Two independent causes, both
   from calibrating the import on the reviews widget only (reference: Yotpo
   referral-share instance `1183441`, `yap.yotpo.com/preview-wadmin/`):
   - **The content bar was an element-count test.** `looksRendered` required
     `els ≥ 25`, and a *fully rendered* referral card is 17 elements / 165 chars
     — one headline, a subtitle, a paragraph and two buttons. It is **smaller
     than the reviews skeleton** the bar exists to reject (36 els / 81 chars),
     so no element threshold can separate them; only text density can. Fix:
     `els ≥ 8 && (txt ≥ 120 || imgs ≥ 2 || els ≥ 120)` — strictly more
     permissive than before, so no previously-accepted capture changed, and the
     36/81 skeleton is still rejected. Verified against both measured metric
     pairs plus a 3-element / 400-char stray node (rejected).
   - **The mount selectors never matched.** The loyalty family *replaces*
     `.yotpo-widget-instance` with `.yotpo-widget-referral-share` instead of
     filling it, so after render neither mount selector matched and the generic
     single-child descent ran — walking past the widget root down to
     `.yotpo-container-background`, three levels in, losing the class the
     widget's stylesheet is scoped to. Fix: `CAPTURE_ROOT_SELECTORS`
     (§5.9 step 2). Verified with five synthetic DOM shapes: the reviews
     mount paths (filled → unwrapped, empty → null, multi-child → mount kept)
     and the generic descent are byte-identical, and the loyalty shape now
     resolves to its own root.
   Diagnosing this needed `findCaptureRoot` / `looksRendered` / `captureMetrics`
   in the debug surface (§5.7) — "the importer can't load a widget" is nearly
   always one of those two disagreeing with the page, and neither was reachable
   from the console. Keep them exported. **Do not** reach for the settle timings
   when an import fails: this widget rendered in **1.8 s** and then sat perfectly
   still: `CAPTURE_DEAD_MS` firing at 7 s was a *symptom* of the content bar, not
   a slow loader.
13. **Imported loyalty widgets ignored the host styling entirely** — once #12
   let them import, they dropped onto every store frozen in the *original*
   store's skin: indigo outline buttons, Montserrat/Nunito Sans, a white card,
   square corners, on a cream Allbirds page. Not a rewriting bug — the rewriter
   was never given anything to rewrite. Three causes:
   - **Nothing was sampled.** `sampleCaptureTheme` only read inline `--*` custom
     properties, and this family declares **zero** of them (measured on
     `1183441`: 0 custom properties, 8 literal `rgb()` values in inline styles).
     `theme` came back `{}` and `rewriteCaptureTheme` deliberately no-ops on an
     empty theme, so the capture passed through byte-for-byte. Fix: the loader
     config fallback + `CAPTURE_CONFIG_ROLES` (§5.9). The declared theme was
     always there, one object away — `yotpoWidgetsContainer.guids[…].config
     .widgets[…].customizations` in the capture frame.
   - **One color per role wasn't enough.** The platform declares header
     `rgba(0,0,0,1)` *and* title/description `rgba(55,51,48,1)`; a single `text`
     slot maps one and leaves the other literal, which on a dark store is
     invisible text. Fix: role slots are lists (`hitsRole`), `themeValues()`
     normalizes the one-value inline shape into the same form. Reviews-family
     sampling is byte-identical — verified: a synthetic mount with five inline
     properties plus a `--yotpo-pure-black` constant returns the same plain
     strings, and the §8 #10 white-on-black rewrite output is unchanged.
   - **Nothing mapped corner radius, ever.** No `--dmb-radius` bridge existed on
     the import path at all, for either family, even though §5.3 lists radius as
     inherited. Fix: `captureRadiusRule()` (§5.9).
   One trap worth keeping in mind: `outerHTML` writes inline font-family quotes
   as `&quot;`, **which ends in a `;`** — the HTML font pass split mid-entity,
   rewrote `font-family: &quot` and stranded `Nunito Sans&quot;` as a dead
   declaration. Browsers dropped the garbage so it looked like it worked. The
   HTML branch's regex now treats the entity as one token and `firstFontFamily`
   decodes it.
14. **An imported reviews widget rendered its AI summary unreadably** — the
   "Customers say" card came out with an invisible title and AI badge on a dark
   store (Death Wish Coffee), while the paragraph under them read fine.
   Reference: Yotpo reviews instance `1087254`, guid
   `V57H595IdhpNCU7nuEaiMrC1XHtSnaLGO8q27kEW`. Two unrelated causes in the same
   block, and each is a *general* import bug that this widget happened to expose:
   - **A frozen background split a legibility pair.** The store's per-instance
     CSS pins `.yotpo-paragraph-summary { background: #F5F2ED }` — cream, and not
     one of the sampled theme colors, so the bridge correctly left it as
     captured (§9). The text on it *is* themed (`color: var(--text-color)` →
     `--dmb-text`), so on a black page it went white on frozen cream. The
     paragraph survived only because it is pinned `color: #5C5C5C`, a grey the
     bridge also passes through. The background swatch can't fix this: it paints
     the wrapper, not an inner card. Fix: `captureFixedBgRules()` (§5.9) —
     a frozen surface gets frozen-legible text, re-declared on the card so it
     inherits into the subtree while everything outside keeps adapting. Note the
     trap that makes the naive version silently do nothing: overriding
     `--dmb-text` on the card does **not** change `var(--text-color)`, because
     the root bridge rule already resolved `var(--dmb-text)` *at the root* and
     inherits the literal — every text-role property has to be re-declared too.
   - **Pass 1 truncated quoted values.** Its value pattern was `[^;}"']+`, which
     stops at a quote, so the store sheet's
     `--primary-font-family: "Manrope", sans-serif !important` became
     `var(--dmb-heading-font)"Manrope", sans-serif` — a token stream a custom
     property happily *stores* and `font-family` then can't parse, so the title
     silently fell back to the inherited body font instead of the host's heading
     font. Fix: consume `[^;}]+` in the CSS branch; quotes only terminate a value
     in the HTML branch, where they close the style attribute and the value's own
     quotes arrive as entities (the mirror image of #13's `&quot;` trap).
     `!important` is dropped with the old value on purpose — every mapped
     property is rewritten to the same canonical `var()` everywhere, so it buys
     nothing, and keeping it would out-rank the per-card re-declarations above.
   Verified on the dark store: card `rgb(245,242,237)` with title/badge
   `rgb(31,36,48)` in the host's heading font, text outside the card still white,
   and Adapt → Revert → Adapt leaves the card legible in every state. Both halves
   are inert where they should be — 0 fixed-bg rules on the loyalty family (its
   tile *is* theme, so it maps to transparent), 1 tooltip rule on the §8 #10
   instance, whose documented checks all still pass. Widgets imported before this
   fix carry the mangled markup in their def; the remedy is re-importing.
15. **An imported widget's small text was illegible on a dark store** — on the
   Allies of Skin reviews instance (`1336947`) dropped on Death Wish Coffee, the
   "Reviews" heading, the search placeholder and all eight filter dropdown labels
   rendered dark-on-black while the topic chips and review copy were correctly
   white. Two *coupled* pre-existing defects, both from calibrating the theme
   rewrite on the declared theme alone:
   - **Color keywords matched inside identifiers.** The pass-2 token regex ended
     in `\b(?:white|black)\b`, and a hyphen is a word boundary, so it fired inside
     the platform's own palette-constant *names*: `--yotpo-empty-white` came back
     as `var(--yotpo-empty-var(--dmb-accent))`. That is not a valid custom-property
     name, so the declaration was **invalid at computed-value time** and fell back
     to `unset` — `inherit` for `color`, transparent for `background-color`.
     22 corrupted references (5 distinct) in one capture, and it fails *silently*:
     inheriting the parent's color usually looks plausible. Fix: tokenize values so
     `var(` + property name is one atomic token and any other identifier run is
     consumed greedily, so no keyword can be lifted out of the middle of a name.
   - **The platform's palette constants were never bridged.** `--yotpo-black:
     #373330`, `--yotpo-primary-text-black`, `--yotpo-medium-grey`,
     `--yotpo-background-light-black` and Vue's hashed per-component vars are
     nobody's theme value, so the role mapping left them literal — and they were
     authored for a light page. Fix: the foreground-anchoring pass (§5.9).
   Note the coupling, because it explains why the symptom looked new: while the
   names were corrupted those declarations computed to `inherit` and came out
   *white*, i.e. the first defect was masking the second. Fixing either one alone
   makes the widget worse. Diagnosis is `DMB.anchorCaptureColors` /
   `captureVarRoles` / `captureSourceBg` / `anchorFgColor` (§5.7); the quick check
   on any capture is `(cap.html + cap.css).match(/var\(--[\w-]*var\(/g)` → `null`.
16. **Every rule the importer appends could be silently swallowed** — the theme
   bridge rule, all fixed-background rules and the radius rule were present in
   `cap.css`, correct, scoped, and injected into the page, yet the CSSOM stopped
   489 rules short of them and none of them applied. Cause: a merchant-authored
   override sheet in that capture opens `@media screen and (max-width:465px){`
   and never closes it. In its own `<style>` element that is invisible — the CSS
   parser closes open blocks at EOF — but once we concatenate our rules after it,
   they land *inside* the unclosed block. Fix: `balanceCss()` on every collected
   chunk (§5.9). This is the worst failure mode in the importer to date because
   every artifact looks right: the capture, the def, the widget's own CSS text and
   the `<style>` element all check out, and only `sheet.cssRules.length` (or a
   brace-depth count of `cap.css`) reveals it. When an import "kept the wrong
   skin" and the markup looks correctly rewritten, count braces before anything
   else.
17. **Two appended rules matched the wrong elements, or lost** — found auditing
   the whole import path after #15, and both had been shadowed by #16:
   - **The frozen-background rule was keyed on BEM modifiers.**
     `captureFixedBgRules` built its selector from the sampled element's full
     class list, so a tooltip became
     `.yotpo-simple-tooltip.yotpo-simple-tooltip--right` — bridging the one
     instance we happened to walk and missing `--center`/`--left`, which kept
     dark-on-dark-grey text. Fix: drop a modifier whose base class is also
     present, but only after checking in the DOM that every element the shorter
     selector reaches carries the same frozen background (§5.9), so a `--dark`
     variant can't drag its transparent siblings along.
   - **An id selector outweighed the radius rule.** `captureRadiusRule` relies on
     compounding classes for specificity, which loses to Yotpo's
     `#yotpo-reviews-main-widget .yotpo-new-review-btn`: the review CTA stayed
     square on a 24px-radius host while the wrapper around it rounded. Fix:
     `!important` on the class-based selectors only, with the classless tag
     fallback kept as a separate plain rule so chips and pickers keep their own
     shape (§5.9).
18. **One widget's CSS restyled another widget** — a freshly imported Yotpo
   reviews instance (`383020`, a vertical list view) rendered its reviews
   side-by-side the moment it was dropped on a page, on any store. Nothing was
   wrong with the capture: the list stacks via UA defaults (the wrapper is a
   plain `<ul>`/`<li>` with **no** captured layout rule), and the flex layout
   came from a *different* widget in the gallery — instance `1087254`, whose
   merchant override CSS legitimately lays *its* reviews out as horizontal
   cards (`… .yotpo-reviews-list .yotpo-reviews-list-wrapper { display:flex;
   gap:8px }`). All widget CSS was scoped to the shared `.dmb-module` class
   and injected together, so any two same-platform imports — which share the
   platform's class names by construction — restyled each other's instances,
   thumbnails and the dialog preview, whichever happened to be more specific.
   Fix: per-widget scoping — `normalizeModuleDef` scopes each widget's CSS to
   `.dmb-module.dmb-w-<id>` and the same class is stamped on inserted
   wrappers, gallery thumbnails and re-stamped on edit (`wzSave`, in case the
   id changed). §5.4's sample library carries a copy of its shared stylesheet
   on every entry for the same reason. Two diagnostic notes for next time:
   a layout that differs between the capture frame and the canvas with
   *identical* markup is almost never the importer — walk
   `doc.styleSheets` for rules matching the mislaid element and check which
   `/* widget: <id> */` block of `#dmb-custom-styles` the winner sits in; and
   remember the absence of a rule is load-bearing (UA-default layouts have
   nothing scoped to out-specify a leak, which is why the shared-scope bug
   surfaced as *layout*, not colors).
19. **Filter labels on an imported widget were invisible on a dark store** —
   the Rixo reviews instance (`383020`) dropped on Death Wish Coffee showed
   its cream filter pills, reviewer panel and "Sort by" with white text on
   them, while the review copy adapted correctly. The frozen-background pass
   (§8 #14) had correctly found every cream surface and re-declared the
   text-role *variables* on each — but two ways text can get its color slip
   past variable re-declaration:
   - **Inherited resolved color.** An element with no `color` rule of its own
     (`.yotpo-dropdown-label` has none, anywhere) inherits the *computed*
     color from outside the card — the root's `color: var(--text-color)`
     resolved to host-white up there, and inheritance passes down the value,
     not the `var()` reference, so local variable re-declarations are inert.
     Fix: every fixed-bg rule also re-declares `color: var(--dmb-text)` on the
     card, which rule-less text inherits; anything with its own rule still
     overrides inheritance (pinned greys, accent labels unaffected).
   - **Overlay text.** The dropdowns' floating labels are absolutely
     positioned *siblings* of the white combobox pill they visually sit on, so
     no ancestor chain connects text to surface and the tree walk can't see
     the pair at all — the pill got its rule, the label hovering over it got
     nothing. Fix: a hit-testing sweep (`elementsFromPoint` under each
     positioned, direct-text element; first opaque non-ancestor background)
     emits a rule keyed to the label's own classes. Needs the capture frame
     stretched to full content height first — `elementsFromPoint` is blind
     outside the frame's viewport, and the stock frame is 1600 px tall.
   Both fixes bake into the capture, so widgets imported earlier keep the
   broken CSS in their def — the remedy is re-importing the link. Verified on
   `383020`: all 10 floating labels compute `#1f2430` on Death Wish, review
   copy still toggles with Adapt/Revert while frozen-surface text stays
   pinned in all three states; re-capturing `1087254` under the new code
   keeps every §8 #14 marker and additionally fixes its own filter labels.
20. **The hover chip became unclickable on any widget taller than the screen**
   — drop a full-height widget below the fold, scroll into it, and the chip
   parked *underneath* the store's sticky header. Moving the mouse toward it
   crossed onto the header, which carries no `data-dmb-id`, so the chip
   dismissed itself before the pointer arrived: Hide, Blend, Revert, ✕ and the
   imagery toggle were all physically unreachable for the rest of that
   section. Cause: `positionChip` clamped the sticky position to
   `Math.max(win.scrollY + 6, …)` — the raw top of the viewport, which is
   exactly where a sticky header lives. Fix: offset by `topChromeHeight()` and
   bound the chip to the hovered element's own box (§5.2). Measured on
   Allbirds: the chip used to land at viewport y≈6 — inside the header band at
   every scroll depth — and now lands at header+6 (38 against that theme's
   32px collapsed header, 54 against its 48px uncollapsed one; the measurement
   is live per reposition, which is why no constant appears in the code or in
   the §7 check). Note this is **not** an
   imagery bug even though it was found while building §5.11 — it affects
   every chip button on every tall section, and predates that feature.
   Two things worth keeping in mind if this code is touched again: the sticky
   clamp must stay *below* the element-top clamp (a widget that is fully below
   the fold should show its chip at its own top edge, not floating at the top
   of the screen), and the bottom clamp is what stops the chip drifting onto
   the next section once you scroll past the widget.

---

## 9. Known limitations (accepted, not bugs)

- **Bot-blocking stores**: Amazon, Gymshark (404s our UA), Bombas (429)
  reject proxied requests. Shopify-family stores generally work. The proxy
  surfaces the upstream status in a readable error page. A future workaround
  would be a real headless-browser fetch, which is out of scope for a
  stdlib-only build.
  **This gets worse hosted, and it is the biggest product risk of the
  migration.** Locally the fetch originates from the rep's own residential or
  office IP; on Vercel it originates from a well-known datacenter range, which
  Cloudflare, Akamai, PerimeterX and Shopify's own bot rules treat very
  differently. Expect the blocked list to grow substantially. Nothing in this
  repo can fix that — the options (client-side DOM capture, a paste-HTML
  fallback, residential proxy egress, headless fetch) are laid out in
  `MIGRATION-HOSTED.md` §1, and the honest first move is to measure the real
  block rate over a couple of weeks of actual demos before building any of
  them. Local `python3 server.py` remains the escape hatch for a store that
  hosted cannot reach.
- **A store's JavaScript can read the session when the JS toggle is on**
  (§3.1). Not a bug and not fixable inside this architecture — the app depends
  on the proxied page being same-origin. It is confined to an explicit opt-in:
  off by default, browser-enforced by the sandbox, and announced in the status
  line. The residual risk is real, and the widget library is what is at stake.
- **Free-tier ceilings.** Supabase free pauses a project after ~1 week of
  inactivity (it resumes from the dashboard) and gives 500 MB of database —
  roomy against ~112 KB captures, but not unlimited. Vercel Hobby caps function
  duration and response size (4.5 MB), which a very large store page could
  brush against; the proxy's own timeout is set below that ceiling. None of
  these bite at the scale of a sales team, all of them bite eventually.
- **Client-rendered SPAs** show sparse content with scripts stripped; the JS
  checkbox is the escape hatch, with the documented risk that hydration may
  wipe edits.
- **Web-font fidelity**: font *names* are sampled from computed styles; if a
  store's font files are blocked cross-origin or loaded by stripped JS, the
  canvas falls back (Brooklinen's body sampled as `Times`). The demo usually
  still convinces because layout/colors/heading fonts carry it.
- **Session state is ephemeral** — no save/share of a *demo* (hidden sections +
  inserted modules), no screenshots, no before/after view. Still future work
  (§10). The one thing that *does* persist is the custom-widget library added
  via the ＋ dialog (Supabase, §5.13) — widgets now follow the *account* to any
  browser, but the demo built with them still does not survive a reload.
- The color picker only sets a flat background. Gradients/images were
  explicitly out of scope ("the only in-platform customization option").
- **Imported widgets are snapshots, not embeds** (§5.9, by spec): interactivity
  and scripts are dropped, links are neutralized, images stay hotlinked to the
  platform CDN, and the capture is fixed at the width it was taken at (1280, or
  390 for `is-mobile=true`). A widget that changes upstream, or that you want in
  both widths, is a second import — not a refresh.
- **Import needs a preview whose loader runs and populates**. Platforms other
  than Yotpo capture generically, but a widget that only renders with live-store
  data behind auth will trip the content bar and be rejected. Rejection is the
  designed outcome — better than a skeleton in a client demo.
- **Theme bridging needs a theme the platform *declares* somewhere.** Both Yotpo
  families are covered — custom properties for reviews, the loader config for
  loyalty (§5.9) — but a platform that neither exposes `--*` properties nor
  publishes a config object samples as `{}`, and `rewriteCaptureTheme`
  deliberately leaves such a capture's *declared* colors alone: brand colors,
  accents and CTA fills arrive exactly as the preview had them. What still
  works without any sampled theme is the **foreground anchoring** pass (§5.9) —
  black/grey/white text, icons and glyphs are achromatic, so they re-anchor to
  `--dmb-text` on polarity alone and the widget is at least *legible* on a dark
  store. Everything chromatic keeps the source store's color. Inferring roles
  from a widget's own inline palette (guessing which color is the CTA and which
  is body text) is the only route left for those, and it can mis-role a
  palette — not attempted (§10). Note the *warnings* are no guide to this: a bridged import
  still trips hardcoded-colors and literal-font, because `@font-face` names and
  greys legitimately survive. The check is whether the markup still contains the
  source store's literals (§7 5d).
- **What a bridged import inherits is the four themed roles plus achromatic
  foregrounds, not every decision.** Font *sizes*, spacing, background artwork,
  status colors and any *chromatic* non-theme color stay exactly as captured —
  deliberately, since flattening them is how a capture stops looking like the
  widget the client is buying. Greys are the one exception, and only where
  they're *foregrounds*: text, icon and glyph colors (`color`, `fill`, `stroke`,
  and custom properties used that way) re-anchor toward `--dmb-text` at their
  captured strength, because a grey chosen for hierarchy on a white card is
  invisible on a black one (§5.9, §8 #15). Grey *hairlines* — borders, rules,
  shadows — are left alone: they read as structure, not content, and dragging
  them to the text color would outline the widget in white. A widget dropped
  into a colored host band
  can therefore end up correct-but-invisible (an accent-mapped outline button on
  an accent-colored section); the background swatch is the answer. Don't conflate
  that with a *frozen background inside the widget* — an opaque non-theme card
  the store pinned on the widget itself. The swatch can't reach that one, so it
  isn't left to the user: `captureFixedBgRules` re-anchors the text role on it
  (§5.9, §8 #14), and for the *subtle* ones the per-instance **Blend toggle**
  (§5.9) can dissolve the surface into the host entirely — surface and text
  released together, off by default so the faithful capture stays the default
  look. What's still accepted is narrower — only the **text**
  role is re-anchored on a frozen card, so an accent-colored element on it can
  still land badly if the host accent happens to match the card; and a
  chromatic or high-contrast statement surface has no Blend companion at all,
  by design.

- **Site imagery can only be as good as the page's own pictures** (§5.11), and
  three gaps are accepted rather than solved:
  - **Faces are never filled.** Review avatars stay stock, because finding a
    face in a store's image pool needs vision we don't have, and a packshot in
    an avatar ring is worse than an obvious stock portrait. Same for brand
    marks and iconography.
  - **Baked-in text crops badly.** Hero and campaign imagery routinely has
    marketing copy burned into the pixels; cropped into a square thumbnail it
    becomes visible garbage. `POOL_PATTERNS` ranks `lifestyle` *below*
    `product` for exactly this reason, but it cannot see the pixels, so a
    banner-heavy store will occasionally produce one bad tile. The toggle is
    per instance and instant, which is the answer.
  - **A bot-blocked or image-poor store yields nothing**, and that is reported
    (`○ no site images`) rather than silently degraded. Stores that block the
    proxy outright (§9, first bullet) never get this far.
  Note also what imagery does *not* claim: it swaps pictures, not layout. A
  slot captured at 82×82 stays 82×82, and a wrong-ratio source is cropped by
  `cover`, deliberately — resizing the widget's own frames to suit the
  client's photos would stop it looking like the widget they are buying.

---

## 10. Future work backlog (from the original spec)

Save & share demo configurations · screenshot/recording export ·
more customization beyond background color · A/B before/after comparison view ·
non-PDP page types.

On the imagery side (§5.11), in rough order of value: a **manual override** —
click a slot, pick a different pool image — which is the natural next step once
reps start disagreeing with a match; **persisting the choice** with the rest of
a saved demo (`entry.imagery` is one boolean, so it costs nothing once
persistence exists); a **preview of the swap in the ＋ dialog** while a page is
loaded, alongside the polarity pair (§5.10) — deliberately not built for the
same reason blend isn't saved there: imagery is host-dependent and the dialog
is the wrong place to decide it; and **non-Shopify product endpoints**
(WooCommerce and Magento both expose comparable JSON), which is one function
each next to `harvestShopify`. What is *not* on this list is inferring
image content — "is this a face", "does this have text in it" — which is the
only thing that would close the §9 gaps and needs a model, not a heuristic.

Done since: **mobile preview** (§5.6), **user-uploaded custom modules**
(§5.8 — in-app ＋ dialog + `custom-modules.js`) and **import from a widget
preview link** (§5.9).

Sharing an *imported* widget between browsers is **done** (§5.12 — the ⤴ share
link, which travels as metadata plus a capture URL and re-imports on the other
end). What that route deliberately doesn't carry is hand-edited markup: for
those the path is still manual, "Copy as code" into `custom-modules.js`.
Remaining on the widget side: per-instance widget options (deliberately not built; a
variant is a second widget — WIDGETS.md §5).

On the import side specifically: mount selectors + `CAPTURE_THEME_MAP` rows for
other platforms as they come up (one row each, §5.9); optionally re-importing
the same URL at the *other* viewport width in one pass, so a widget arrives with
both a desktop and a mobile entry instead of the rep importing twice.

Checking a capture against both polarities before Save is **done** (§5.10 — the
dialog's preview pair). Note what was considered and rejected with it: capturing
the *same link three times* into frozen/dynamic variants shown as a 3×2 grid, the
rep picking one at Save. Three renders of a widget that renders demo data fresh
each load don't differ only along the axis being compared, they cost three times
the wall clock and three times the flakiness — and the choice itself belongs on
the client's page, where Adapt/Revert and Blend already make it reversibly. One
capture, two renderings, no version fork.

Adapting the loyalty family, which used to be the biggest open gap there, is
**done** (§8 #13) via the loader-config route — the faithful one of the two that
were on the table. The other route, *inferring* roles from a widget's own inline
palette, is still unbuilt and is what a platform with no declared theme
anywhere would need (§9).
Either way the mapping itself already exists — only the sampling is missing.

Implementation hints if picked up: persistence should serialize
`{url, hidden section ids, demos: [{moduleId, anchor dmb-id, where, adapted,
bg}]}` — section ids are deterministic per detection run, so a saved config
replays as long as the page structure hasn't changed. Mobile preview is a
canvas-width toggle plus re-running `detectSections` (thresholds are
viewport-relative).
