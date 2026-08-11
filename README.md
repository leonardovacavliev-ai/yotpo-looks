# Yotpo Looks

An interactive demo tool for sales teams: load any e-commerce product detail
page (PDP), hide competitor modules, and drag & drop your own demo modules onto
the client's real page — automatically styled to match their brand.

## Use it

The app is hosted — sign in with your Google account and your widget gallery is
waiting for you. Ask the owner to add your address if you are turned away at
the door.

## Run it locally

No installs needed — the app uses only Python 3, which ships with macOS:

```bash
python3 server.py
```

Then open **http://localhost:4173** in your browser. Local runs skip the login
and keep the gallery in memory; to develop against the real database, copy
`.env.local.example` to `.env.local` and fill it in.

Deploying your own copy — GitHub, Vercel, Supabase and the Google OAuth client
— is **[DEPLOY.md](DEPLOY.md)**.

## Signing in

Access is limited to an allowlist, so the app can sit on a public URL without
being a public service. Each person's gallery is private to their account:
widgets you import follow you to any browser you sign in from, and nobody else
can see them. Sharing a widget with a colleague is still the **⤴** button,
which sends them a link that rebuilds it in their own gallery.

**One thing worth knowing:** the **JS** checkbox in the top bar runs the
client's own JavaScript inside the app. It is off by default, which is the safe
setting and the right one for most pages. Tick it when a page renders empty
without it — that is what it is for — and know that you are choosing to run
that store's code with the app's access.

## How it works

- **Top bar** — paste a PDP URL and click *Load page*. The local server fetches
  the page, removes frame-blocking headers/scripts, and renders it in the
  central Browser canvas. The **Desktop/Mobile** toggle switches the canvas
  viewport: Desktop always renders the site at full desktop width (scaled
  down to fit a narrow window instead of triggering the site's mobile
  layout); Mobile shows the genuine phone layout in a 390px frame.
- **Editor (left)** — the detected page structure, like a theme editor. Toggle
  visibility (👁), jump to a section by clicking it, and manage inserted demo
  modules (background color, adapt/revert CSS ✦/↺, remove ✕). Click a row's
  **▸ arrow** to expand the section and reveal the smaller blocks inside it —
  e.g. just the star-rating line inside a product buy box — each of which can
  be hidden individually or used as a drop target for gallery modules.
- **Browser (center)** — hover any detected section for a control chip with a
  **Hide** button. Drag gallery modules here; an insertion line shows where the
  module will land.
- **Gallery (right)** — your widget library. It starts **empty**: fill it with
  the widgets you actually demo. **＋** adds one — paste a **widget-preview link** and
  Import to capture a real widget as it looks right now, or paste HTML/CSS by
  hand; either way you get a live preview before saving. Hover a card for
  **⧉** duplicate, and **✎ / ✕** on your own widgets to edit or delete.
  Everything you add is saved to your account, not to this browser.
  Imported widgets also get **⤴**, which copies a link that rebuilds the widget
  — name, description and product included — in a colleague's ＋ Import box. The `›`
  arrow in its header collapses the panel for more canvas space; `‹` expands it
  again.

Inserted modules automatically inherit the host site's fonts, text color,
accent/button color and corner radius. **Revert CSS** restores the module's
default styling if the adaptation clashes; the color swatch changes the
module's background.

## Site photos

When a page loads, the app collects the usable images on it — product shots
first — and the top bar shows how many it found (**◉ 24 site images**). Any
inserted widget with photos then gets a **▣** button in its Editor row (and
**Site photos** on the hover chip) that fills the widget's picture frames with
the client's own imagery.

It's per widget, off until you press it, and one press puts the original
photos back.

Once it's on, a **⟳** button appears next to it on the hover chip: press it to
draw a different set. Matching can tell a product frame from a customer-photo
frame, but it can't tell that a packshot looks wrong in a referral widget's
lifestyle slot — so if a picture reads off, just shuffle until one works and
carry on with the demo. Each press changes which photos are used, which frames
get filled at all, and whether it leans toward product shots or lifestyle
imagery.

A few deliberate behaviours so the result reads as real:

- **Reviewer avatars and brand marks are never replaced** — a product shot in
  a face's place is the fastest way to make a demo look fake.
- **Only about two thirds of a photo strip is swapped.** A review wall where
  every single photo is one catalog looks like a product gallery; a mix looks
  like customers.
- If nothing on the page fits a frame, that frame keeps what it had.

Nothing is downloaded or stored — the widget points at the store's own image
URLs, the same way it already points at the platform's. If the badge reads
**○ no site images**, the page had nothing usable (some stores block us, some
only ship tiny thumbnails) and widgets simply keep their captured photos.

## Adding your own widgets

Three routes — **import from a preview link** (fastest: paste the URL in the ＋
dialog, press Import, save), the in-app **＋** dialog with hand-written HTML/CSS
(both saved in your browser), or the committed `public/custom-modules.js` file
for widgets the whole team should get. Imported widgets are static
snapshots on purpose — a new version of a widget is a new import, so both stay
available in the gallery. Rules a widget must follow to render and adapt
correctly, plus what to send when you ask someone to build one for you:
**[WIDGETS.md](WIDGETS.md)**.

The eleven sample modules the app used to ship with (reviews, trust badges,
testimonials, UGC, Q&A, urgency, guarantee, press, cross-sell, newsletter) are
parked in `public/sample-modules.js` — uncomment its `<script>` line in
`public/index.html` to put them back in the gallery, or copy one as a starting
point for a widget of your own.

## Notes & limitations

- **JS** next to the URL bar is on by default, so the page runs its own scripts
  and looks like the real thing (client-rendered content shows up, lazy images
  load). Untick it if the site re-renders over your edits — inserted modules
  vanishing or hidden sections coming back is the sign.
- Server-rendered stores (Shopify, WooCommerce, Magento, etc.) work best.
  A few sites (e.g. Amazon) aggressively block automated requests.
- Everything runs locally; nothing is uploaded anywhere.
