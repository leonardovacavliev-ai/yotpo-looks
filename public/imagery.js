/* Yotpo Looks — site imagery.
 *
 * Fills an inserted widget's image slots with pictures harvested from the
 * store being demoed, so a Yotpo review wall shows the prospect's own
 * products instead of the platform's stock demo photos.
 *
 * ===========================================================================
 * THE THREE IDEAS THIS FILE IS BUILT ON (read before changing anything)
 * ===========================================================================
 *
 * 1. HARVESTING COSTS NOTHING, BECAUSE THE BROWSER ALREADY DID IT.
 *    The canvas iframe is same-origin (CLAUDE.md §3), and the page has
 *    already loaded and decoded its own images in order to render. So
 *    `img.naturalWidth/naturalHeight` hands us true intrinsic aspect ratios
 *    for **zero network requests**. What we keep is a *manifest*
 *    (url → {w, h, role}), not bytes: the bytes are in the browser's HTTP
 *    cache from rendering the page, and inserted widgets already hotlink the
 *    Yotpo CDN by design (CLAUDE.md §9), so hotlinking the store's CDN is the
 *    established pattern here, not a new risk.
 *
 *    Corollary — do NOT route harvested images through /proxy. The proxy
 *    sends `Cache-Control: no-store` on everything (server.py), so proxying
 *    them would actively destroy the caching that makes this feature free.
 *    /proxy is used here for exactly one thing: the Shopify product JSON,
 *    which is same-origin-blocked data, not an image.
 *
 * 2. ASPECT RATIO IS THE TIEBREAK, NOT THE KEY.
 *    Almost every slot in a platform widget is `object-fit: cover` /
 *    `background-size: cover`, so a wrong-ratio image is merely *cropped* —
 *    precision matching buys far less than it seems. The failure that
 *    actually matters is SEMANTIC, and it happens in front of a client: a
 *    payment-icon sprite in a review photo strip, or the prospect's hero
 *    banner with "SUMMER SALE" burned into it cropped down to a 82×82
 *    thumbnail, reads as a hack. The platform's generic-but-plausible stock
 *    photo reads as a real integration.
 *    So both sides are classified into ROLES first (SLOT_PATTERNS below,
 *    POOL_PATTERNS for the page), matching happens within a role, and aspect
 *    ratio only breaks ties inside it.
 *
 * 3. NEVER FILL EVERY SLOT.
 *    Two of six review photos as product shots, spread out, reads as a real
 *    review feed. Six of six from one catalog reads as a product gallery
 *    wearing a review widget's clothes. FILL_RATIO exists for that, and
 *    lowering it usually improves the demo. Same instinct behind the two
 *    hard skips: faces and logos are never filled (see SLOT_PATTERNS).
 *
 * ===========================================================================
 * WHERE THIS RUNS
 * ===========================================================================
 *
 * Two phases, deliberately far apart:
 *
 *   CAPTURE TIME (app.js captureAttempt) — `stampSlots()` measures the
 *   widget's image frames in the capture frame's controlled 1280px layout and
 *   writes `data-dmb-slot="N"` onto each, so the attribute rides along into
 *   the stored snapshot. The manifest lands in `def.slots`.
 *
 *   INSERT TIME (app.js toggleImagery) — `applyImagery()` matches this
 *   store's pool against those slots and swaps the URLs on ONE INSTANCE.
 *
 * The split matters. Baking substitutions into the def at import would break
 * "static by design, one snapshot, frozen" (CLAUDE.md §5.9) *and* would tie
 * the widget to whichever store happened to be loaded when it was imported —
 * wrong for the next prospect. So imagery is a per-instance, reversible,
 * page-side layer, exactly like Adapt/Revert (§5.3) and Blend (§5.9), and for
 * the same reason: the right answer depends on the client's page, which is
 * unknown at import time.
 *
 * Nothing here ever mutates a widget def. `applyImagery` writes only to the
 * instance's own DOM, and records what it overwrote in `data-dmb-img-orig` so
 * `revertImagery` is exact.
 */

(() => {
  "use strict";

  /* ------------------------------------------------------------- tuning
   * All empirical. Tune against real stores, not in the abstract — the same
   * warning that applies to the section-detection thresholds (CLAUDE.md §5.2)
   * applies here: a change that helps one theme regularly hurts another. */

  // Pool filters. An image below these is a logo, an icon or a tracking pixel,
  // and cropping it into a widget frame looks broken.
  const MIN_DIM = 160;          // px on the shorter side
  const MIN_AREA = 40000;       // px² — kills 300×20 banner strips
  const MAX_POOL = 120;         // harvest cap; a big PDP has ~40 usable images

  // Harvest budget. The computed-style sweep for background-images is the only
  // part that touches every element, so it is both capped and timed.
  const SWEEP_MAX_ELS = 2500;
  const SWEEP_BUDGET_MS = 30;

  // Matching.
  const FILL_RATIO = 0.6;       // fraction of a same-role slot group to fill (idea 3)
  const REUSE_PENALTY = 0.55;   // added per prior use — reuse only when short
  const AR_TOLERANCE = 0.9;     // |log(ar1/ar2)| above this is a bad crop
  const DECODE_TOP_K = 12;      // images pre-decoded so the swap paints instantly
  // How deep into the ranked candidates Shuffle is allowed to reach. Small on
  // purpose: past the first handful the matches get visibly worse, and a
  // shuffle that walks into bad crops is worse than no shuffle. Cycling back
  // round to the best pick beats offering junk.
  const SHUFFLE_DEPTH = 5;
  // Score penalty per step down a slot kind's role preference list
  // (SLOT_SOURCES). This is what MAKES that list mean anything: without it,
  // preference order was inert — candidates were concatenated in preference
  // order but then selected purely on crop quality, so "a UGC frame wants a
  // lifestyle shot first" never actually happened and a square packshot won
  // every square frame. Sized to be beatable: a second-choice role still wins
  // if the first-choice crop is meaningfully worse, so a store with only
  // product photos fills its frames instead of going empty.
  const ROLE_PENALTY = 0.35;

  /* --------------------------------------------------------- pool roles
   *
   * Classification is deliberately ASYMMETRIC about which evidence it trusts,
   * and that asymmetry is the whole design — don't "simplify" it back into one
   * context string.
   *
   * The REJECT test runs against the URL and alt text ONLY. A false reject
   * silently deletes good material from the pool, and ancestor class lists are
   * a terrible signal on utility-CSS themes: Allbirds' Tailwind build hangs
   * ~20 layout tokens off every wrapper (`pointer-events-none absolute inset-0
   * top-[52%] md:w-[48vw] …`), and a substring match inside that soup threw
   * away a 1920px packshot as an "icon". A filename is authored to describe
   * the picture; `md:top-[42%]` is not.
   *
   * The POSITIVE tests may use the full ancestor context, because a wrong
   * guess there only reorders preference among slots we were going to fill
   * anyway — benign, where a wrong reject is not. */
  const POOL_REJECT =
    /logo|favicon|sprite|payment|visa|mastercard|paypal|klarna|amex|apple-?pay|badge|trustpilot|social|flag-|icon[-_.]/i;

  const POOL_PATTERNS = [
    // Clean packshots — the best material we have. Structured sources
    // (og:image, JSON-LD, Shopify product JSON) are tagged 'product' directly.
    // `_PDP_` is Shopify merchandising convention for a product-detail shot.
    { re: /product|packshot|\/products?\/|[-_]pdp[-_]/i, role: "product" },
    // Wide editorial imagery. Usable, but riskier: hero banners routinely have
    // marketing copy burned into the pixels, which crops into garbage.
    { re: /hero|banner|slide|lifestyle|campaign|editorial|lookbook|collection/i, role: "lifestyle" },
  ];

  /* An image inside a link to a product page is a product shot whatever the
   * CDN chose to call the file. The most portable signal there is on Shopify,
   * where asset paths are `/cdn/shop/files/…` and say nothing at all. */
  const PRODUCT_LINK = 'a[href*="/products/"]';

  /* --------------------------------------------------------- slot roles
   * Matched against the slot element's class + id + alt, plus its ancestors
   * inside the widget. Yotpo's class names are unusually legible, which is
   * what makes this table short; the same trick as NAME_PATTERNS in app.js.
   *
   * `fill: false` is a HARD SKIP and the most important column here:
   *   - avatar — a square frame in a review header is a FACE. We cannot find a
   *     face in a store's image pool without vision, and a packshot in an
   *     avatar ring is instantly, obviously wrong. Leave it stock.
   *   - brand  — stars, verified ticks, platform marks. Replacing these breaks
   *     the widget's own iconography, which is the thing the client is buying.
   */
  const SLOT_PATTERNS = [
    { re: /avatar|initial|profile|reviewer[-_]?(img|image|photo)|user[-_]?(img|image|pic)/i, kind: "avatar", fill: false },
    { re: /logo|verified|badge|star|rating|icon|chevron|arrow|caret|close|search|sprite/i,   kind: "brand",  fill: false },
    { re: /review[-_]?(image|photo|media)|image[-_]?thumbnail|ugc|gallery[-_]?item|media[-_]?item|customer[-_]?photo/i, kind: "ugc", fill: true },
    { re: /product|item[-_]?image|cross[-_]?sell|upsell|thumb/i,                              kind: "product", fill: true },
  ];

  // Slots smaller than this are iconography whatever they are called.
  const MIN_SLOT = 40;

  /* Which pool roles feed which slot kind, in preference order. A UGC frame
   * wants a lifestyle shot first (a customer photo is a scene, not a
   * packshot); a product frame wants the packshot. */
  const SLOT_SOURCES = {
    ugc:     ["lifestyle", "product", "other"],
    product: ["product", "lifestyle", "other"],
    generic: ["product", "lifestyle", "other"],
  };

  /* ==================================================================== *
   *  HARVEST                                                             *
   * ==================================================================== */

  const seen = () => new Set();

  /* Shopify serves one image at a dozen sizes: `shoe_200x.jpg?v=1`,
   * `shoe_1024x1024.jpg`, `shoe.jpg?width=400`. Those are the SAME picture and
   * must collapse to one pool entry, or a review wall fills with six
   * resolutions of one shoe. Family key = path with the size markers removed. */
  function familyKey(url) {
    let u;
    try { u = new URL(url); } catch (err) { return url; }
    const path = u.pathname
      // Both spellings are live on one Shopify store: the theme renders
      // `shoe_1024x1024.png` while the same asset is uploaded as
      // `shoe-2000x2000.png`. Missing either puts one picture in the pool
      // twice, and a review wall then shows two resolutions of one shoe.
      .replace(/[-_](\d+)x(\d*)(_crop_[a-z]+)?(?=\.[a-z]+$)/i, "")  // _1024x1024, -2000x2000, _200x
      .replace(/@\dx(?=\.[a-z]+$)/i, "");                           // @2x
    return u.host + path;
  }

  /* Ask a Shopify CDN for a big version of an image we only saw as a thumb.
   * Deliberately narrow: only for URLs we can positively identify as Shopify's
   * image pipeline, because a `width=` param means nothing to a random CDN and
   * a wrong guess is a broken image in a live demo. */
  function upscaleUrl(url, want) {
    if (!/cdn\.shopify\.com|\/cdn\/shop\//i.test(url)) return url;
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/_(\d+)x(\d*)(?=\.[a-z]+$)/i, "");
      u.searchParams.set("width", String(want || 1200));
      return u.href;
    } catch (err) { return url; }
  }

  /* Text a role decision is made from: the URL, the alt text, the element's
   * own class/id, and its nearest ancestors (a bare <img> inside
   * `.product-gallery__slide` is a product shot, and only the ancestor says
   * so). Bounded to 4 levels — beyond that every element is inside
   * `.page-wrapper` and the context stops meaning anything. */
  function roleContext(el, url, levels) {
    let text = String(url || "");
    if (el) {
      text += " " + (el.getAttribute("alt") || "");
      let n = el;
      for (let i = 0; i < (levels || 4) && n && n.nodeType === 1; i++, n = n.parentElement) {
        text += " " + (n.getAttribute("class") || "") + " " + (n.getAttribute("id") || "");
      }
    }
    return text;
  }

  function classifyPool(el, url, forced) {
    if (forced) return forced;                    // structured source — authoritative
    const own = String(url || "") + " " + (el && el.getAttribute ? el.getAttribute("alt") || "" : "");
    if (POOL_REJECT.test(own)) return "icon";     // narrow evidence, on purpose (see above)
    try {
      if (el && el.closest && el.closest(PRODUCT_LINK)) return "product";
    } catch (err) { /* detached node */ }
    const text = roleContext(el, url);
    for (const p of POOL_PATTERNS) if (p.re.test(text)) return p.role;
    return "other";
  }

  function addCandidate(list, keys, url, opts) {
    if (!url || /^(data:|blob:|about:)/i.test(url)) return;
    if (/\.svg(\?|#|$)/i.test(url)) return;   // vector — a logo or an icon in practice
    const key = familyKey(url);
    const prev = keys.get(key);
    const cand = {
      url: url,
      // Carried onto the candidate because matching penalizes reuse by
      // PICTURE, not by URL string: Shopify serves one asset under both
      // /cdn/shop/files/ and /cdn/shop/products/, which no path-based dedupe
      // can safely collapse (two folders really can hold different images of
      // the same name) but which must still count as "already used" or the
      // same shoe lands twice in one review strip.
      key: key,
      w: (opts && opts.w) || 0,
      h: (opts && opts.h) || 0,
      role: classifyPool(opts && opts.el, url, opts && opts.role),
      from: (opts && opts.from) || "dom",
    };
    // Same picture seen twice: keep whichever variant we know most about, and
    // prefer the larger one — the pool wants the best copy of each image, not
    // the first one the walk happened to reach.
    if (prev) {
      if (cand.w * cand.h > prev.w * prev.h) Object.assign(prev, cand);
      // A structured source (product JSON / JSON-LD) is authoritative about
      // role even when the DOM copy is bigger.
      if (cand.from !== "dom" && prev.from === "dom") prev.role = cand.role;
      return;
    }
    keys.set(key, cand);
    list.push(cand);
  }

  /* <img> elements. The cheap, high-yield source: fixLazyImages() has already
   * promoted data-src and forced loading=eager (app.js), so by the time we run
   * most of these are decoded and naturalWidth is real. */
  function harvestImgs(doc, list, keys) {
    for (const img of doc.querySelectorAll("img")) {
      if (img.closest("[data-dmb-kind='demo'], #dmb-chip")) continue; // our own DOM
      const url = img.currentSrc || img.src;
      addCandidate(list, keys, url, {
        el: img,
        w: img.naturalWidth || parseInt(img.getAttribute("width"), 10) || 0,
        h: img.naturalHeight || parseInt(img.getAttribute("height"), 10) || 0,
      });
    }
  }

  /* Elements painted with a CSS background-image — where hero and lookbook
   * imagery usually lives. This is the only pass that touches every element,
   * so it is capped by count AND wall time. It has no intrinsic dimensions to
   * read; probeDimensions() fills those in afterwards. */
  function harvestBackgrounds(doc, win, list, keys) {
    const t0 = (win.performance || performance).now();
    const all = doc.body.querySelectorAll("*");
    const n = Math.min(all.length, SWEEP_MAX_ELS);
    for (let i = 0; i < n; i++) {
      if ((i & 63) === 0 && (win.performance || performance).now() - t0 > SWEEP_BUDGET_MS) break;
      const el = all[i];
      const inline = el.getAttribute("style") || "";
      // getComputedStyle is the expensive call — skip elements that plainly
      // cannot have one (no inline background, no class to hang a rule on).
      if (!/background/i.test(inline) && !el.getAttribute("class")) continue;
      let bg;
      try { bg = win.getComputedStyle(el).backgroundImage; } catch (err) { continue; }
      if (!bg || bg === "none") continue;
      const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
      if (!m) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;  // a background this small is a bullet or an icon
      addCandidate(list, keys, m[1], { el: el });
    }
  }

  /* og:image and JSON-LD Product.image. Small, authoritative, and role-tagged
   * 'product' by construction: this is the picture the store itself considers
   * to represent the page. Best material in the pool. */
  function harvestStructured(doc, list, keys) {
    for (const meta of doc.querySelectorAll('meta[property="og:image"], meta[name="og:image"], meta[property="og:image:secure_url"]')) {
      addCandidate(list, keys, meta.getAttribute("content"), { role: "product", from: "og" });
    }
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch (err) { continue; } // stores ship broken JSON-LD constantly
      const urls = [];
      const dig = (node, depth) => {
        if (!node || depth > 6) return;
        if (Array.isArray(node)) return node.forEach((v) => dig(v, depth + 1));
        if (typeof node !== "object") return;
        const img = node.image || node.contentUrl || node.thumbnailUrl;
        if (typeof img === "string") urls.push(img);
        else if (Array.isArray(img)) img.forEach((v) => { if (typeof v === "string") urls.push(v); else dig(v, depth + 1); });
        else if (img) dig(img, depth + 1);
        for (const k of Object.keys(node)) if (k !== "image") dig(node[k], depth + 1);
      };
      dig(data, 0);
      for (const u of urls) addCandidate(list, keys, u, { role: "product", from: "ld" });
    }
  }

  /* Shopify's product endpoint returns the full gallery at full resolution —
   * richer and cleaner than whatever the theme happened to render, and one
   * request. Shopify-family stores are the ones that work best through the
   * proxy anyway (CLAUDE.md §9), so this is where the payoff is.
   *
   * The document's baseURI is the real store URL (the proxy injects <base>),
   * so we can reconstruct the endpoint. Fetched through /proxy because the app
   * origin is localhost. Entirely best-effort: any failure just means the pool
   * is whatever the DOM gave us. */
  async function harvestShopify(doc, list, keys) {
    let u;
    try { u = new URL(doc.baseURI); } catch (err) { return; }
    const m = /\/products\/([^/?#]+)/.exec(u.pathname);
    if (!m) return;
    const endpoint = u.origin + u.pathname.split("?")[0].replace(/\/$/, "") + ".js";
    try {
      const resp = await fetch("/proxy?url=" + encodeURIComponent(endpoint));
      if (!resp.ok) return;
      const text = await resp.text();
      if (!/^\s*[{[]/.test(text)) return;   // an HTML error page, not the JSON
      const data = JSON.parse(text);
      const imgs = [].concat(data.images || [], (data.media || []).map((x) => x && x.src).filter(Boolean));
      for (const src of imgs) {
        const abs = /^https?:/i.test(src) ? src : (src.startsWith("//") ? u.protocol + src : u.origin + src);
        addCandidate(list, keys, upscaleUrl(abs, 1200), { role: "product", from: "shopify" });
      }
    } catch (err) {
      // Not a Shopify store, blocked, or bad JSON — all expected.
    }
  }

  /* Fill in dimensions we could not read from the DOM (background images, and
   * <img>s that had not decoded yet). These are cache hits, so it is fast —
   * but it IS the only part of harvesting that can touch the network, so it
   * runs after the pool is already usable and never blocks anything. */
  function probeDimensions(list, onProgress) {
    const pending = list.filter((c) => !c.w || !c.h);
    if (!pending.length) return Promise.resolve();
    let left = pending.length;
    return new Promise((resolve) => {
      const done = () => { if (--left <= 0) resolve(); };
      for (const cand of pending) {
        const probe = new Image();
        probe.onload = () => {
          cand.w = probe.naturalWidth;
          cand.h = probe.naturalHeight;
          if (onProgress) onProgress();
          done();
        };
        probe.onerror = () => { cand.broken = true; done(); };
        probe.src = cand.url;
      }
      // A CDN that never answers must not leave the pool "scanning" forever.
      setTimeout(resolve, 6000);
    });
  }

  /* Decode the images most likely to be used, so the swap paints in the same
   * frame instead of flashing empty in front of a client. This — not caching
   * bytes — is what preloading effort is actually for here. */
  function predecode(pool) {
    for (const cand of pool.slice(0, DECODE_TOP_K)) {
      const img = new Image();
      img.src = cand.url;
      if (img.decode) img.decode().catch(() => {});
    }
  }

  function usable(c) {
    return !c.broken && c.w >= MIN_DIM && c.h >= MIN_DIM && c.w * c.h >= MIN_AREA;
  }

  /* Harvest the loaded page into a ranked pool. Resolves twice-over: the
   * returned object is filled in place, so a caller can render a count
   * immediately and watch it grow as probes land. */
  function harvest(doc, win, onUpdate) {
    const list = [];
    const keys = new Map();
    const result = { pool: [], all: list, scanning: true, byRole: {} };

    const rank = () => {
      result.pool = list.filter(usable).sort((a, b) => {
        // Structured sources first (they are the store's own idea of its
        // product), then by pixel area — a bigger source crops better.
        const w = (c) => (c.from === "dom" ? 0 : 1);
        return (w(b) - w(a)) || (b.w * b.h - a.w * a.h);
      }).slice(0, MAX_POOL);
      result.byRole = result.pool.reduce((acc, c) => {
        acc[c.role] = (acc[c.role] || 0) + 1;
        return acc;
      }, {});
      if (onUpdate) onUpdate(result);
    };

    try {
      harvestStructured(doc, list, keys);
      harvestImgs(doc, list, keys);
      harvestBackgrounds(doc, win, list, keys);
    } catch (err) {
      console.warn("[dmb] imagery: harvest failed", err);
    }
    rank();

    // Everything below is network-touching and strictly an upgrade: the pool
    // above is already usable, and nothing waits on this.
    Promise.resolve()
      .then(() => harvestShopify(doc, list, keys))
      .then(() => { rank(); return probeDimensions(list, null); })
      .then(() => {
        result.scanning = false;
        rank();
        predecode(result.pool);
      })
      .catch((err) => {
        result.scanning = false;
        console.warn("[dmb] imagery: enrichment failed", err);
        rank();
      });

    return result;
  }

  /* ==================================================================== *
   *  SLOTS                                                               *
   * ==================================================================== */

  function classifySlot(el) {
    const text = roleContext(el, "", 3);
    for (const p of SLOT_PATTERNS) if (p.re.test(text)) return p;
    return { kind: "generic", fill: true };
  }

  /* Is this element an image frame? Two shapes, and the second is not
   * optional: Yotpo paints every review photo as an inline background-image
   * from an IntersectionObserver callback (CLAUDE.md §5.9), so a swap that
   * only handles <img> misses the exact slots this feature exists for. */
  function slotShape(el, win) {
    if (el.tagName === "IMG") return { mode: "src", url: el.currentSrc || el.src || "" };
    let bg;
    try { bg = win.getComputedStyle(el).backgroundImage; } catch (err) { return null; }
    if (!bg || bg === "none") return null;
    const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (!m) return null;
    // A gradient stacked with an image is decoration, not a photo frame.
    if (/gradient/i.test(bg)) return null;
    return { mode: "bg", url: m[1] };
  }

  /* Find the widget's image frames and describe each one.
   *
   * Called at CAPTURE time against the capture frame (a controlled 1280px
   * layout, before any host CSS exists), and as a fallback at INSERT time
   * against a live instance. Capture-time is the better measurement, which is
   * why def.slots is preferred over re-walking; the live fallback exists so
   * widgets imported before this feature still work.
   *
   * `stamp` writes data-dmb-slot="N" so the manifest index survives
   * serialization. Class names cannot do that job: the six photo thumbnails in
   * a Yotpo strip share every class, and Yotpo emits junk id="null". */
  function detectSlots(win, root, stamp) {
    const out = [];
    const nodes = root.querySelectorAll("img, [style*='background'], [class]");
    for (const el of nodes) {
      if (out.length >= 200) break;
      const shape = slotShape(el, win);
      if (!shape) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SLOT || r.height < MIN_SLOT) continue;
      // A frame whose own child is also a frame is a container; the child is
      // the real slot.
      if (el.tagName !== "IMG" && el.querySelector("img")) continue;

      const cls = classifySlot(el);
      let fit = "cover";
      try {
        const cs = win.getComputedStyle(el);
        fit = shape.mode === "src" ? (cs.objectFit || "fill") : (cs.backgroundSize || "auto");
      } catch (err) { /* keep the default */ }

      const slot = {
        i: out.length,
        kind: cls.kind,
        fill: cls.fill !== false,
        mode: shape.mode,
        w: Math.round(r.width),
        h: Math.round(r.height),
        ar: r.height ? r.width / r.height : 1,
        fit: fit,
      };
      if (stamp) el.setAttribute("data-dmb-slot", String(slot.i));
      out.push(slot);
    }
    return out;
  }

  /* Capture-time entry point: stamp the live capture-frame DOM so the
   * attributes are cloned into the snapshot, and hand back the manifest.
   * Called from captureAttempt() BEFORE snapshotHtml(). */
  function stampSlots(win, root) {
    try {
      return detectSlots(win, root, true);
    } catch (err) {
      console.warn("[dmb] imagery: slot detection failed", err);
      return [];
    }
  }

  /* ==================================================================== *
   *  MATCHING                                                            *
   * ==================================================================== */

  // Log-ratio so 2:1 and 1:2 sit the same distance from square. A raw
  // difference would treat "twice as wide" and "half as wide" asymmetrically.
  const arDistance = (a, b) => Math.abs(Math.log((a || 1) / (b || 1)));

  /* Decide which pool image goes in which slot.
   *
   * Returns a sparse array: assignments[i] is the image for slot i, or
   * undefined to leave that slot's captured photo alone. Sparseness is the
   * point — see idea 3 at the top of this file.
   *
   * `opts.variant` drives the Shuffle button. Role classification gets a slot
   * into the right *neighbourhood*, but it cannot tell that a packshot reads
   * wrong in a referral widget's experiential frame — that is a judgment about
   * the picture, and the rep is looking right at it. So rather than trying to
   * be cleverer, offer another draw. Each variant moves three dials at once,
   * because a shuffle that changes one tile reads as broken:
   *
   *   1. ROLE EMPHASIS — rotates the slot kind's preference list, so the next
   *      press leads with `lifestyle` instead of `product`. This is the dial
   *      that answers the actual complaint: it lets the rep walk *out* of the
   *      packshots rather than re-rolling within them. Rotation only re-orders
   *      preference (ROLE_PENALTY); no role is ever excluded, so a store with
   *      nothing but product photos still fills.
   *   2. PICK DEPTH — how far down each slot's ranked candidates to reach.
   *   3. FILL PATTERN — which slots in a group get filled at all, so a tile the
   *      rep disliked can go back to stock entirely.
   *
   * Variant 0 must reproduce the un-shuffled result exactly — every offset
   * below is a multiple of `variant`, so at 0 they all collapse to "best". */
  function matchSlots(slots, pool, opts) {
    opts = opts || {};
    const ratio = opts.fillRatio == null ? FILL_RATIO : opts.fillRatio;
    const variant = Math.max(0, Math.floor(opts.variant || 0));
    const assignments = [];
    if (!pool || !pool.length) return assignments;

    const uses = new Map();
    const byRole = (role) => pool.filter((c) => c.role === role);

    // Group by kind, so "fill 60% of the review photos" is a decision about
    // that strip rather than about the widget as a whole.
    const groups = new Map();
    for (const s of slots) {
      if (!s.fill) continue;                       // avatars, brand marks — never
      if (!groups.has(s.kind)) groups.set(s.kind, []);
      groups.get(s.kind).push(s);
    }

    for (const [kind, group] of groups) {
      // Dial 1: role emphasis, rotated by the variant. Each candidate carries
      // the rank of the role it came from so preference can bias the score
      // (ROLE_PENALTY) without excluding anything.
      const pref = SLOT_SOURCES[kind] || SLOT_SOURCES.generic;
      const rot = pref.length ? variant % pref.length : 0;
      const sources = pref.slice(rot).concat(pref.slice(0, rot));
      const candidates = [];
      sources.forEach((role, rank) => {
        for (const c of byRole(role)) candidates.push({ cand: c, rank: rank });
      });
      if (!candidates.length) continue;

      // How many of this group to fill, and which ones. Stride rather than the
      // first N: a filled-filled-stock-filled-stock-stock strip looks like a
      // real feed, six consecutive swaps looks like a catalog.
      const want = group.length <= 2 ? group.length : Math.max(1, Math.ceil(group.length * ratio));
      const stride = group.length / want;
      // Shuffling rotates the fill pattern too, so a tile the rep disliked can
      // go back to stock entirely rather than merely swapping to another photo.
      const offset = variant % group.length;
      const taken = new Set();
      const chosen = [];
      for (let k = 0; k < want; k++) {
        let at = (Math.round(k * stride) + offset) % group.length;
        while (taken.has(at)) at = (at + 1) % group.length;
        taken.add(at);
        chosen.push(group[at]);
      }

      chosen.forEach((slot, k) => {
        // Rank every candidate for this slot *now*, so the reuse penalties
        // accumulated by earlier slots are already reflected.
        const ranked = candidates
          .map((entry) => {
            const ar = arDistance(slot.ar, entry.cand.w / entry.cand.h);
            return {
              cand: entry.cand,
              ar: ar,
              score: ar +
                     (uses.get(entry.cand.key || entry.cand.url) || 0) * REUSE_PENALTY +
                     entry.rank * ROLE_PENALTY,
            };
          })
          .sort((a, b) => a.score - b.score);
        if (!ranked.length) return;
        // The "nothing here fits" test is about CROP ONLY — the best shape the
        // pool can offer. Judging it on `score` would fold in the role penalty
        // and the shuffle's deliberate reach for a worse pick, and would start
        // rejecting slots the un-shuffled match filled happily.
        const bestCrop = ranked.reduce((m, r) => (r.ar < m ? r.ar : m), Infinity);

        // variant * (k + 1) spreads the slots of one group across different
        // depths, so a shuffle re-rolls the whole strip rather than shifting
        // every tile by the same one place. At variant 0 this is always 0.
        const depth = Math.min(SHUFFLE_DEPTH, ranked.length);
        const pick = ranked[(variant * (k + 1)) % depth];

        // Every candidate is a bad crop and none has been used yet: the pool
        // simply has nothing shaped like this frame. Stock beats a mangled
        // swap, so leave it.
        if (bestCrop > AR_TOLERANCE && !uses.size) return;
        assignments[slot.i] = pick.cand;
        const key = pick.cand.key || pick.cand.url;
        uses.set(key, (uses.get(key) || 0) + 1);
      });
    }
    return assignments;
  }

  /* ==================================================================== *
   *  APPLY / REVERT                                                      *
   * ==================================================================== */

  const ORIG_ATTR = "data-dmb-img-orig";

  function recordOriginal(el, mode) {
    if (el.hasAttribute(ORIG_ATTR)) return;   // already swapped once — keep the first truth
    const o = mode === "src"
      ? { src: el.getAttribute("src"), srcset: el.getAttribute("srcset"), fit: el.style.objectFit || "" }
      : {
          bi: el.style.backgroundImage || "",
          bs: el.style.backgroundSize || "",
          bp: el.style.backgroundPosition || "",
        };
    el.setAttribute(ORIG_ATTR, JSON.stringify(o));
  }

  /* Put the captured photo back. Mandatory safety net, not just a UI feature:
   * some store CDNs refuse cross-origin loads by Referer (ours is localhost),
   * and a broken-image icon in a live demo is worse than the stock photo. Every
   * swapped <img> gets this wired to onerror. */
  function restore(el) {
    const raw = el.getAttribute(ORIG_ATTR);
    if (raw == null) return;
    let o;
    try { o = JSON.parse(raw); } catch (err) { el.removeAttribute(ORIG_ATTR); return; }
    if (el.tagName === "IMG") {
      if (o.src == null) el.removeAttribute("src"); else el.setAttribute("src", o.src);
      if (o.srcset == null) el.removeAttribute("srcset"); else el.setAttribute("srcset", o.srcset);
      el.style.objectFit = o.fit || "";
    } else {
      el.style.backgroundImage = o.bi || "";
      el.style.backgroundSize = o.bs || "";
      el.style.backgroundPosition = o.bp || "";
    }
    el.removeAttribute(ORIG_ATTR);
  }

  /* Swap this instance's slots to the store's imagery.
   *
   * `slots` is def.slots when the widget was imported with a manifest, and a
   * live re-walk otherwise. Writes only to `moduleEl`'s subtree — the def is
   * never touched, so the gallery card, the dialog preview and every other
   * instance are unaffected. Returns the number of slots actually filled. */
  function applyImagery(moduleEl, slots, pool, opts) {
    if (!moduleEl || !slots || !slots.length) return 0;
    const assignments = matchSlots(slots, pool, opts);
    let filled = 0;

    for (const slot of slots) {
      const pick = assignments[slot.i];
      if (!pick) continue;
      const el = moduleEl.querySelector('[data-dmb-slot="' + slot.i + '"]');
      if (!el) continue;

      recordOriginal(el, slot.mode);
      if (slot.mode === "src") {
        // srcset would win over src and re-serve the captured photo.
        el.removeAttribute("srcset");
        el.addEventListener("error", function onErr() {
          el.removeEventListener("error", onErr);
          restore(el);
        }, { once: true });
        el.setAttribute("src", pick.url);
        // The captured frame was sized for its own photo; anything else needs
        // cover or it letterboxes. Only forced where the capture wasn't
        // already doing something deliberate.
        if (!/cover|contain/.test(slot.fit)) el.style.objectFit = "cover";
      } else {
        el.style.backgroundImage = 'url("' + pick.url.replace(/"/g, '\\"') + '")';
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
      }
      filled++;
    }
    return filled;
  }

  function revertImagery(moduleEl) {
    if (!moduleEl) return 0;
    const els = moduleEl.querySelectorAll("[" + ORIG_ATTR + "]");
    els.forEach(restore);
    return els.length;
  }

  /* The slots for an inserted instance: the capture-time manifest when there
   * is one, otherwise a live walk of the instance itself. The live path is why
   * widgets imported before this feature still get the toggle — but it
   * measures inside the host page, where the store's CSS has already had its
   * say, so it is the weaker of the two. Re-import to get a real manifest. */
  function slotsFor(def, moduleEl, win) {
    if (def && Array.isArray(def.slots) && def.slots.length) return def.slots;
    if (!moduleEl || !win) return [];
    try {
      // Stamping the live instance is safe: it is our own DOM, and the
      // attributes are what applyImagery addresses slots by.
      return detectSlots(win, moduleEl, true);
    } catch (err) {
      console.warn("[dmb] imagery: live slot detection failed", err);
      return [];
    }
  }

  window.IMAGERY = {
    harvest, stampSlots, detectSlots, slotsFor,
    matchSlots, applyImagery, revertImagery,
    // Exposed for diagnosis — "it filled nothing" is almost always an empty
    // pool or an all-`fill:false` slot list, and "it filled the wrong thing"
    // is a classifyPool/classifySlot disagreement (see CLAUDE.md §7 5f).
    classifyPool, classifySlot, familyKey, upscaleUrl, arDistance,
    tuning: { MIN_DIM, MIN_AREA, MAX_POOL, FILL_RATIO, REUSE_PENALTY, AR_TOLERANCE, MIN_SLOT,
              SHUFFLE_DEPTH, ROLE_PENALTY },
  };
})();
