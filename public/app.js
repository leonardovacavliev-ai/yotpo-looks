/* Yotpo Looks — app logic.
 *
 * The loaded page is served through our own /proxy endpoint, so the iframe is
 * same-origin and we can freely inspect and manipulate its DOM from here.
 */

(() => {
  "use strict";

  const iframe = document.getElementById("canvas");
  const urlForm = document.getElementById("url-form");
  const urlInput = document.getElementById("url-input");
  const keepScripts = document.getElementById("keep-scripts");
  const loadBtn = document.getElementById("load-btn");
  const statusEl = document.getElementById("status");
  const editorList = document.getElementById("editor-list");
  const sectionCount = document.getElementById("section-count");
  const galleryList = document.getElementById("gallery-list");
  const gallerySub = document.getElementById("gallery-sub");
  const emptyState = document.getElementById("browser-empty");
  const loadingState = document.getElementById("browser-loading");

  const state = {
    doc: null,
    win: null,
    sections: [],   // host sections (tree): {id, el, name, tag, hidden, parent, depth, expanded, subsChecked}
    demos: [],      // inserted demo modules: {id, el, def, adapted, bg}
    host: null,     // sampled host styles
    counter: 0,
    hostCounter: 0, // section id sequence — never reused within a page load
    pendingDrop: null,
    viewMode: "desktop",
    // Site imagery (§5.11): {pool, all, scanning, byRole} from IMAGERY.harvest,
    // or null before the first page load / when imagery.js isn't loaded.
    imagery: null,
  };

  const DEFAULT_BG = "#ffffff";

  /* ---------------------------------------------------------------- CSS
   * injected into the loaded page: hover outlines, control chip, drop
   * indicator, hidden state. High-value props carry !important so host
   * styles can't distort our UI. */
  const IFRAME_UI_CSS = `
.dmb-hidden { display: none !important; }
[data-dmb-id].dmb-hover { outline: 2px solid #6366f1 !important; outline-offset: -2px !important; }
[data-dmb-id].dmb-flash { outline: 3px solid #f59e0b !important; outline-offset: -3px !important; transition: outline-color .3s; }
#dmb-chip {
  position: absolute !important;
  z-index: 2147483646 !important;
  display: flex !important;
  gap: 6px !important;
  align-items: center !important;
  background: #14161f !important;
  color: #fff !important;
  border-radius: 8px !important;
  padding: 5px 6px 5px 12px !important;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  box-shadow: 0 4px 14px rgba(0,0,0,.35) !important;
  white-space: nowrap !important;
}
#dmb-chip .dmb-chip-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; opacity: .75; font-weight: 500 !important; }
#dmb-chip button {
  all: unset;
  cursor: pointer !important;
  background: #2c3040 !important;
  color: #fff !important;
  border-radius: 6px !important;
  padding: 6px 10px !important;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
}
/* Glyph-only buttons (⟳ Shuffle): the character's drawn height is ~60% of its
   font-size, so at the chip's 12px it reads much smaller than the lettered
   buttons beside it. Scale the glyph up but pin line-height to 12px so the
   button box stays exactly as tall as its siblings — the glyph just paints
   into the padding. */
#dmb-chip button.dmb-glyph { font-size: 17px !important; line-height: 12px !important; padding: 6px 9px !important; }
#dmb-chip button:hover { background: #6366f1 !important; }
#dmb-chip button.dmb-danger:hover { background: #dc2626 !important; }
#dmb-chip input[type="color"] {
  width: 26px; height: 26px; padding: 0; border: none; border-radius: 6px;
  background: #2c3040; cursor: pointer;
}
#dmb-indicator {
  position: absolute !important;
  z-index: 2147483645 !important;
  height: 4px !important;
  background: #6366f1 !important;
  border-radius: 99px !important;
  box-shadow: 0 0 0 3px rgba(99,102,241,.3) !important;
  pointer-events: none !important;
  display: none;
}
`;

  /* ------------------------------------------------------------ status */
  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (cls ? " " + cls : "");
  }

  /* ------------------------------------------------------------ gallery */
  const escapeHtml = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // The module base stylesheet (variable defaults + shared dmbm- classes) also
  // lives in the parent document so gallery thumbnails and the widget-editor
  // preview render.
  const builtinModuleStyle = document.createElement("style");
  const customModuleStyle = document.createElement("style");
  builtinModuleStyle.textContent = DEMO_MODULE_BASE_CSS +
    ".gal-thumb .dmb-module { padding: 20px 16px; background: #fff; }";
  document.head.append(builtinModuleStyle, customModuleStyle);

  /* Custom-widget CSS is a separate sheet because it changes at runtime (a
   * widget added, edited or deleted). It has to reach both documents: the app
   * (thumbnails + preview) and the loaded page (inserted instances). */
  function syncCustomCss() {
    const css = customModuleCss();
    customModuleStyle.textContent = css;
    if (!state.doc) return;
    let s = state.doc.getElementById("dmb-custom-styles");
    if (!s) {
      s = state.doc.createElement("style");
      s.id = "dmb-custom-styles";
      (state.doc.head || state.doc.body).appendChild(s);
    }
    s.textContent = css;
  }

  let dragBlocked = false; // pointer went down on a card's action button
  document.addEventListener("mouseup", () => { dragBlocked = false; });

  function cardButton(label, title, onClick, extraClass) {
    const b = document.createElement("button");
    b.className = "icon-btn" + (extraClass ? " " + extraClass : "");
    b.textContent = label;
    b.title = title;
    b.addEventListener("mousedown", () => { dragBlocked = true; });
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }

  /* Clipboard with a console fallback — `navigator.clipboard` is absent on
   * insecure origins and can be denied outright, and a share button that
   * silently does nothing is worse than one that logs the link. */
  function copyText(text, onDone) {
    const done = (ok) => onDone(ok);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => { console.log(text); done(false); });
    } else {
      console.log(text);
      done(false);
    }
  }

  /* ⤴ on a gallery card: the link the widget was captured from, with its
   * name, description and product attached as UTM parameters (modules.js).
   * Pasting it into another rep's ＋ dialog re-imports the same widget with
   * the same metadata already filled in. */
  function shareWidget(def, btn) {
    const url = widgetShareUrl(def);
    if (!url) return;
    copyText(url, (ok) => {
      if (btn) {
        btn.textContent = ok ? "✓" : "⎘";
        setTimeout(() => { btn.textContent = "⤴"; }, 1600);
      }
      setStatus(
        ok
          ? `Share link for “${def.name}” copied — paste it into ＋ Import to rebuild this widget`
          : `Clipboard unavailable — the share link for “${def.name}” is in the console`,
        ok ? "ok" : "err"
      );
    });
  }

  function buildGalleryCard(def) {
    const card = document.createElement("div");
    card.className = "gal-card" + (def.builtin ? "" : " custom-card");
    card.draggable = true;
    card.dataset.moduleId = def.id;
    const badge = def.builtin
      ? ""
      : `<span class="gal-badge">${def.source === "local" ? "custom" : "custom · file"}</span>`;
    card.innerHTML = `
      <div class="gal-thumb"><div class="gal-scale"><div class="dmb-module ${def.scopeClass}">${def.html}</div></div></div>
      <div class="gal-meta"><strong>${escapeHtml(def.name)}</strong><span>${escapeHtml(def.desc)}</span>${badge}</div>`;

    const actions = document.createElement("div");
    actions.className = "gal-actions";
    // Share is first — it is the one action that leaves the app, and only
    // imported widgets have anything to share (a hand-written widget has no
    // link; "Copy as code" in the dialog is its route out).
    const shareUrl = widgetShareUrl(def);
    if (shareUrl) {
      actions.appendChild(cardButton("⤴", "Copy a share link — the preview link plus this widget's name, description and product", (btn) => shareWidget(def, btn)));
    }
    actions.appendChild(cardButton("⧉", "Duplicate into an editable copy", () => openWidgetEditor({ from: def })));
    if (def.source === "local") {
      // Only browser-stored widgets are editable here; file-based ones are code
      // (public/custom-modules.js, sample-modules.js) — see WIDGETS.md.
      actions.appendChild(cardButton("✎", "Edit this widget", () => openWidgetEditor({ edit: def })));
      actions.appendChild(cardButton("✕", "Delete this widget", () => deleteWidget(def), "danger"));
    }
    card.appendChild(actions);

    card.addEventListener("dragstart", (e) => {
      if (dragBlocked) { e.preventDefault(); return; }
      e.dataTransfer.setData("text/plain", "dmb:" + def.id);
      e.dataTransfer.effectAllowed = "copy";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    return card;
  }

  /* The gallery shows one product line at a time (Reviews | Loyalty toggle)
   * and filters by name as you type — no Enter needed, `input` fires per
   * keystroke. Both are pure view state: DEMO_MODULES itself never changes. */
  let galleryProduct = "reviews";
  let galleryQuery = "";
  const productToggle = document.getElementById("product-toggle");
  const gallerySearch = document.getElementById("gallery-search");

  function setGalleryProduct(product) {
    if (!MODULE_PRODUCTS.includes(product)) return;
    galleryProduct = product;
    for (const b of productToggle.querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.product === product);
    }
    renderGallery();
  }

  function renderGallery() {
    const q = galleryQuery.trim().toLowerCase();
    const inProduct = DEMO_MODULES.filter((m) => m.product === galleryProduct);
    const shown = q ? inProduct.filter((m) => m.name.toLowerCase().includes(q)) : inProduct;

    // Per-product counts on the toggle so the other tab's content is visible
    // at a glance ("Loyalty (3)") even while you're looking at Reviews.
    for (const b of productToggle.querySelectorAll("button")) {
      const n = DEMO_MODULES.filter((m) => m.product === b.dataset.product).length;
      b.textContent = MODULE_PRODUCT_LABELS[b.dataset.product] + (n ? ` (${n})` : "");
    }

    galleryList.innerHTML = "";
    for (const def of shown) galleryList.appendChild(buildGalleryCard(def));
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "panel-empty";
      p.textContent = q
        ? `No ${MODULE_PRODUCT_LABELS[galleryProduct]} widgets match “${galleryQuery.trim()}”.`
        : `No ${MODULE_PRODUCT_LABELS[galleryProduct]} widgets yet. Press ＋ to import one from a preview link or paste your own HTML — it saves to your gallery.`;
      galleryList.appendChild(p);
    }
    gallerySub.textContent = inProduct.length
      ? (q ? `${shown.length} of ${inProduct.length}` : String(inProduct.length)) +
        (inProduct.length === 1 && !q ? " widget" : " widgets")
      : "empty";
    gallerySub.title = "Drag a widget onto the page · ＋ adds your own";
  }

  productToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-product]");
    if (btn) setGalleryProduct(btn.dataset.product);
  });
  gallerySearch.addEventListener("input", () => {
    galleryQuery = gallerySearch.value;
    renderGallery();
  });

  /* ------------------------------------------------------- page loading */
  urlForm.addEventListener("submit", (e) => {
    e.preventDefault();
    let url = urlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    urlInput.value = url;
    loadPage(url);
  });

  document.getElementById("samples").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-url]");
    if (!btn) return;
    urlInput.value = btn.dataset.url;
    loadPage(btn.dataset.url);
  });

  function loadPage(url) {
    state.sections = [];
    state.demos = [];
    state.host = null;
    emptyState.hidden = true;
    loadingState.hidden = false;
    loadBtn.disabled = true;
    setStatus("Loading " + new URL(url).hostname + "…");
    renderEditor();
    applyCanvasSandbox(keepScripts.checked);
    iframe.src = "/proxy?url=" + encodeURIComponent(url) + "&scripts=" + (keepScripts.checked ? "1" : "0");
  }

  /* The proxied page is same-origin with this app by design — that is the one
   * decision everything else hangs on (CLAUDE.md §3), and it is what makes
   * iframe.contentDocument reachable. Hosted, it is also what lets a store's
   * own JavaScript read this app's session, so "scripts off" has to be
   * enforced by the browser rather than by a regex over their HTML.
   *
   * allow-same-origin WITHOUT allow-scripts is exactly the shape we want: we
   * keep full DOM access to the page, and nothing in it can execute — not
   * inline handlers, not javascript: URLs, not srcdoc. The server-side strip
   * in _proxy_core.py stays as a second layer.
   *
   * With the JS toggle on, both tokens are present, which by spec removes the
   * sandbox entirely. That is the honest representation of the trade: the rep
   * has asked for the store's JavaScript, and it runs with this app's access.
   *
   * The attribute is only read when the frame navigates, so this must be set
   * *before* iframe.src, never after. */
  function applyCanvasSandbox(keepScriptsOn) {
    iframe.setAttribute(
      "sandbox",
      keepScriptsOn
        ? "allow-same-origin allow-scripts allow-forms allow-popups"
        : "allow-same-origin"
    );
  }

  // Turning the store's JS on is a security decision, not just a fidelity one,
  // so it is stated once per switch-on rather than buried in a title attribute.
  keepScripts.addEventListener("change", () => {
    if (keepScripts.checked) {
      setStatus("JS on: the store's own scripts will run with this app's access. Reload the page to apply.", "warn");
    } else {
      setStatus("JS off: the store's scripts are blocked. Reload the page to apply.");
    }
  });

  iframe.addEventListener("load", () => {
    if (!iframe.src || iframe.src === "about:blank") return;
    // Give the page a beat to lay out (fonts/images affect section geometry).
    setTimeout(() => {
      try {
        initPage();
      } catch (err) {
        console.error(err);
        setStatus("Failed to analyze page: " + err.message, "err");
      }
      loadingState.hidden = true;
      loadBtn.disabled = false;
    }, 700);
  });

  /* ------------------------------------------------------ page analysis */
  function initPage() {
    const doc = iframe.contentDocument;
    if (!doc || !doc.body) {
      setStatus("Could not access the loaded page", "err");
      return;
    }
    state.doc = doc;
    state.win = iframe.contentWindow;

    const style = doc.createElement("style");
    style.id = "dmb-styles";
    style.textContent = IFRAME_UI_CSS + DEMO_MODULE_BASE_CSS;
    doc.head ? doc.head.appendChild(style) : doc.body.appendChild(style);
    syncCustomCss(); // custom widgets' CSS goes into its own sheet

    fixLazyImages(doc);
    detectSections(doc);
    state.host = sampleHostStyles(doc);
    setupChip(doc);
    setupDragDrop(doc);
    renderEditor();

    const n = state.sections.length;
    setStatus(n ? `${n} modules detected — hover the page to hide, drag from the gallery to insert` : "Page loaded, but no sections detected", n ? "ok" : "err");

    harvestImagery(); // §5.11 — deferred to idle, never blocks the above
  }

  /* ------------------------------------------------- site imagery (§5.11)
   * Harvesting is a DOM read of an already-rendered document, but it runs in
   * idle time anyway: section detection is what has to feel instant, and
   * nothing downstream of this is on the critical path to a demo. */
  function harvestImagery() {
    if (!window.IMAGERY || !state.doc) return;
    state.imagery = null;
    renderImageryBadge();
    const go = () => {
      if (!state.doc) return;
      try {
        state.imagery = IMAGERY.harvest(state.doc, state.win, renderImageryBadge);
      } catch (err) {
        console.warn("[dmb] imagery: harvest failed", err);
        state.imagery = null;
      }
      renderImageryBadge();
      renderEditor(); // the per-instance toggle appears once a pool exists
    };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2000 });
    else setTimeout(go, 120);
  }

  const imgBadge = document.getElementById("img-badge");

  /* The badge reports; it never gates. A rep can always drag a widget onto the
   * page — imagery applies when it is available and can be switched on after
   * the fact, so there is nothing to wait for and nothing to block. */
  function renderImageryBadge() {
    if (!imgBadge) return;
    const im = state.imagery;
    if (!window.IMAGERY || !state.doc) { imgBadge.hidden = true; return; }
    imgBadge.hidden = false;

    if (!im) {
      imgBadge.className = "img-badge scanning";
      imgBadge.textContent = "◌ reading images…";
      imgBadge.title = "Collecting usable images from this page";
      return;
    }
    const n = im.pool.length;
    const roles = Object.keys(im.byRole).sort().map((k) => `${im.byRole[k]} ${k}`).join(" · ");
    if (!n) {
      imgBadge.className = "img-badge none";
      imgBadge.textContent = im.scanning ? "◌ reading images…" : "○ no site images";
      imgBadge.title = im.scanning
        ? "Collecting usable images from this page"
        : (im.all.length
            ? `All ${im.all.length} images on this page were rejected — too small, vector, or blocked. `
            : "This page has no images we can use. ") +
          "Widgets keep their captured photos. Click to scan again.";
      return;
    }
    imgBadge.className = "img-badge ready" + (im.scanning ? " scanning" : "");
    imgBadge.textContent = (im.scanning ? "◐ " : "◉ ") + n + " site images";
    imgBadge.title = `${n} usable images from this page${roles ? " — " + roles : ""}.\n` +
      "Turn one on per widget with ▣ in the Editor row or “Site photos” on the hover chip. Click to scan again.";
  }

  if (imgBadge) imgBadge.addEventListener("click", harvestImagery);

  /* Pages served without their JS never resolve lazy-loaded images; promote
   * the common data-* fallbacks so the canvas doesn't look broken. */
  function fixLazyImages(doc) {
    doc.querySelectorAll("img").forEach((img) => {
      const dataSrc = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
      const src = img.getAttribute("src") || "";
      if (dataSrc && (!src || src.startsWith("data:"))) img.setAttribute("src", dataSrc);
      const dataSrcset = img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset");
      if (dataSrcset && !img.getAttribute("srcset")) img.setAttribute("srcset", dataSrcset);
      img.loading = "eager";
    });
    doc.querySelectorAll("source[data-srcset]").forEach((s) => {
      if (!s.getAttribute("srcset")) s.setAttribute("srcset", s.getAttribute("data-srcset"));
    });
  }

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "IFRAME", "SVG"]);

  function isSignificant(el, win, minH = 40, minW = 120) {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return false; // inline <svg> reports lowercase
    // el.id isn't reliably a string (form controls named "id", SVGAnimatedString).
    const elId = el.getAttribute("id");
    if (elId && elId.startsWith("dmb-")) return false;
    if (el.getAttribute && el.getAttribute("data-dmb-kind") === "demo") return false;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (cs.position === "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.height >= minH && r.width >= minW;
  }

  function runDetection(doc) {
    const win = doc.defaultView;
    const vh = Math.max(doc.documentElement.clientHeight, 600);
    const found = [];

    function walk(el, depth) {
      for (const child of Array.from(el.children)) {
        if (!isSignificant(child, win)) continue;
        const rect = child.getBoundingClientRect();
        const sigKids = Array.from(child.children).filter((k) => isSignificant(k, win));
        const isStructuralTag = ["MAIN", "ARTICLE", "FORM"].includes(child.tagName);
        const singlePassThrough =
          sigKids.length === 1 && sigKids[0].getBoundingClientRect().height > rect.height * 0.8;
        const hugeContainer = rect.height > vh * 1.4 && sigKids.length >= 2;
        if (depth < 6 && sigKids.length && (isStructuralTag || singlePassThrough || hugeContainer)) {
          walk(child, depth + 1);
        } else {
          found.push(child);
        }
      }
    }
    walk(doc.body, 0);
    return found;
  }

  function makeSectionEntry(el) {
    const id = "host-" + state.hostCounter;
    el.setAttribute("data-dmb-id", id);
    el.setAttribute("data-dmb-kind", "host");
    return {
      id, el, name: nameFor(el, state.hostCounter++), tag: el.tagName.toLowerCase(), hidden: false,
      parent: null, depth: 0, expanded: false, subsChecked: false,
    };
  }

  function detectSections(doc) {
    state.hostCounter = 0;
    state.sections = runDetection(doc).map(makeSectionEntry);
  }

  /* After a viewport switch, responsive CSS can reveal elements that were
   * display:none at load time. Append-only: existing entries (ids, hidden
   * flags, inserted demos) stay untouched, and candidates nested inside or
   * around an already-tracked section are skipped. */
  function redetectSections() {
    if (!state.doc || !state.doc.body) return;
    const known = state.sections.map((s) => s.el);
    const fresh = runDetection(state.doc).filter(
      (el) => !known.some((k) => k === el || k.contains(el) || el.contains(k))
    );
    if (fresh.length) {
      state.sections.push(...fresh.map(makeSectionEntry));
      renderEditor();
    }
  }

  /* ---- sub-sections: expanding a section reveals the blocks inside it ----
   * One detection level per expand (the Editor drills down a tree), with
   * smaller thresholds than the top level so compact rows — star ratings,
   * price lines — qualify. Sub-sections are ordinary host entries: the hover
   * chip, Hide and drag-drop anchoring work on them with no special cases. */
  const SUB_MIN_H = 18;
  const SUB_MIN_W = 60;

  function runSubDetection(root, win) {
    let found = [];
    function walk(el, depth) {
      for (const child of Array.from(el.children)) {
        if (child.hasAttribute("data-dmb-id")) continue; // already tracked (host or demo)
        if (SKIP_TAGS.has(child.tagName)) continue;
        // Boxless wrappers (Shopify custom elements love display:contents)
        // have a 0×0 rect; their children are the real content.
        if (win.getComputedStyle(child).display === "contents") {
          walk(child, depth);
          continue;
        }
        if (!isSignificant(child, win, SUB_MIN_H, SUB_MIN_W)) continue;
        const rect = child.getBoundingClientRect();
        const sigKids = Array.from(child.children).filter(
          (k) => !k.hasAttribute("data-dmb-id") && isSignificant(k, win, SUB_MIN_H, SUB_MIN_W)
        );
        const singlePassThrough =
          sigKids.length === 1 && sigKids[0].getBoundingClientRect().height > rect.height * 0.8;
        if (depth < 4 && singlePassThrough) walk(child, depth + 1);
        else found.push(child);
      }
    }
    walk(root, 0);
    // A single sub-section spanning the parent is a useless level to offer —
    // drill into it until expanding actually splits something.
    for (let guard = 0; found.length === 1 && guard < 4; guard++) {
      const only = found[0];
      found = [];
      walk(only, 0);
      if (!found.length) return [only];
    }
    return found;
  }

  function makeSubEntry(el, parent) {
    const entry = makeSectionEntry(el);
    entry.parent = parent;
    entry.depth = parent.depth + 1;
    return entry;
  }

  function sectionChildren(entry) {
    return state.sections.filter((s) => s.parent === entry);
  }

  /* Deepest tracked host section whose element contains `el` (null if none) —
   * how inserted demos are attached to their place in the Editor tree. */
  function deepestSectionAround(el) {
    let best = null;
    for (const s of state.sections) {
      if (s.el !== el && s.el.contains(el) && (!best || best.el.contains(s.el))) best = s;
    }
    return best;
  }

  function hasHiddenAncestor(entry) {
    let p = entry.def ? deepestSectionAround(entry.el) : entry.parent;
    for (; p; p = p.parent) if (p.hidden) return true;
    return false;
  }

  function toggleExpand(entry) {
    if (!entry.expanded && !entry.subsChecked) {
      entry.subsChecked = true;
      state.sections.push(...runSubDetection(entry.el, state.win).map((el) => makeSubEntry(el, entry)));
    }
    const kids =
      sectionChildren(entry).length +
      state.demos.filter((d) => deepestSectionAround(d.el) === entry).length;
    if (!kids) {
      entry.expanded = false;
      setStatus(`No sub-sections detected inside “${entry.name}”`);
      renderEditor();
      return;
    }
    entry.expanded = !entry.expanded;
    renderEditor();
  }

  const NAME_PATTERNS = [
    [/announc|promo-bar|top-bar|topbar/, "Announcement bar"],
    [/breadcrumb/, "Breadcrumbs"],
    [/review|rating|stars|yotpo|okendo|judgeme|stamped|trustpilot|loox/, "Reviews"],
    [/header|masthead/, "Header"],
    [/nav|menu/, "Navigation"],
    [/footer/, "Footer"],
    [/gallery|media|carousel|slideshow|thumbnail/, "Product gallery"],
    [/product-info|product-form|product-detail|buy-box|purchase|add-to-cart/, "Product info & buy box"],
    [/product/, "Product section"],
    [/recommend|related|upsell|cross-sell|also-like|complementary/, "Recommendations"],
    [/testimonial|quote/, "Testimonials"],
    [/faq|accordion|question/, "FAQ"],
    [/newsletter|subscribe|signup|klaviyo/, "Newsletter signup"],
    [/instagram|ugc|social|community/, "Social / UGC"],
    [/trust|badge|guarantee|benefit|icon-bar|value-prop/, "Trust badges"],
    [/hero|banner/, "Banner"],
    [/description|details|specs|feature/, "Product description"],
    [/video/, "Video"],
    [/size|fit/, "Size guide"],
    [/shipping|delivery|returns/, "Shipping & returns"],
    [/cart|drawer|modal|popup/, "Overlay / drawer"],
  ];

  function nameFor(el, i) {
    // A heading emitted as its own (sub-)section is best named by its text.
    if (/^H[1-6]$/.test(el.tagName)) {
      const t = el.textContent.trim().replace(/\s+/g, " ");
      if (t) return t.slice(0, 42);
    }
    const hint = ((el.getAttribute("id") || "") + " " + (typeof el.className === "string" ? el.className : "") + " " + el.tagName).toLowerCase();
    for (const [re, label] of NAME_PATTERNS) {
      if (re.test(hint)) return label;
    }
    const h = el.querySelector("h1, h2, h3, [role='heading']");
    const headingText = h && h.textContent.trim().replace(/\s+/g, " ");
    if (headingText) return headingText.slice(0, 42);
    const tagNames = { HEADER: "Header", FOOTER: "Footer", NAV: "Navigation", ASIDE: "Sidebar" };
    return tagNames[el.tagName] || "Section " + (i + 1);
  }

  /* --------------------------------------------------- host style sample */
  function parseColor(str) {
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(str || "");
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  const luminance = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

  function sampleHostStyles(doc) {
    const win = doc.defaultView;
    const bodyCS = win.getComputedStyle(doc.body);
    const font = bodyCS.fontFamily;

    // The page's own background steers every sanity check below. The checks
    // used to assume a light page (reject text lighter than 0.92, reject
    // white-ish buttons) — on a dark store that threw away the *correct*
    // white body text and white CTA, and the fallbacks painted dark-on-dark
    // (§8 #11, Death Wish Coffee). "Wrong" is now measured as too little
    // contrast against the page background, whichever side it's on.
    let bgC = null;
    for (const el of [doc.body, doc.documentElement]) {
      const c = parseColor(win.getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.5) { bgC = c; break; }
    }
    const bgLum = bgC ? luminance(bgC) : 1; // nothing painted = white canvas
    const darkPage = bgLum < 0.4;

    let text = bodyCS.color;
    const textC = parseColor(text);
    if (!textC || textC.a < 0.5 || Math.abs(luminance(textC) - bgLum) < 0.25) {
      text = darkPage ? "#f4f5f7" : "#1f2430";
    }

    const h = doc.querySelector("main h1, h1, h2");
    const headingFont = h ? win.getComputedStyle(h).fontFamily : font;

    let accent = null;
    let radius = null;
    const btnSel = 'button, input[type="submit"], [type="button"], .btn, .button, [class*="add-to-cart" i], [name="add"], a[class*="btn" i]';
    for (const el of doc.querySelectorAll(btnSel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 26) continue;
      const cs = win.getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);
      if (!bg || bg.a < 0.9) continue;
      // A page-colored button (white ghost on a light page, black on a dark
      // one) can't serve as the accent — it wouldn't stand out on the page.
      if (Math.abs(luminance(bg) - bgLum) < 0.15) continue;
      accent = cs.backgroundColor;
      radius = cs.borderRadius;
      break;
    }
    if (!accent) {
      const a = doc.querySelector("main a[href], a[href]");
      if (a) {
        const c = parseColor(win.getComputedStyle(a).color);
        if (c && Math.abs(luminance(c) - bgLum) >= 0.25 && win.getComputedStyle(a).color !== text) accent = win.getComputedStyle(a).color;
      }
    }
    if (!accent) accent = darkPage ? "#f5f6f8" : "#111111";
    const accentC = parseColor(accent);
    const contrast = accentC && luminance(accentC) > 0.55 ? "#111111" : "#ffffff";

    // Pill buttons report huge radii (even 1.6e7px); clamp so cards stay sane.
    const rv = parseFloat(radius);
    if (isNaN(rv)) radius = null;
    else if (rv > 24) radius = "24px";
    return {
      font, headingFont, text, accent, contrast, radius: radius || null,
      pageBg: bgC ? "rgb(" + bgC.r + ", " + bgC.g + ", " + bgC.b + ")" : null,
    };
  }

  /* -------------------------------------------------------- hover chip */
  function setupChip(doc) {
    const chip = doc.createElement("div");
    chip.id = "dmb-chip";
    chip.style.display = "none";
    doc.body.appendChild(chip);

    let current = null;

    function hideChip() {
      chip.style.display = "none";
      if (current) current.el.classList.remove("dmb-hover");
      current = null;
    }

    function showChip(entry) {
      if (current && current.el === entry.el) return;
      if (current) current.el.classList.remove("dmb-hover");
      current = entry;
      entry.el.classList.add("dmb-hover");
      chip.innerHTML = "";

      const name = doc.createElement("span");
      name.className = "dmb-chip-name";
      name.textContent = entry.def ? entry.def.name : entry.name;
      chip.appendChild(name);

      if (entry.def) {
        // Inserted demo module: color, revert/adapt, remove.
        const color = doc.createElement("input");
        color.type = "color";
        color.value = entry.bg || DEFAULT_BG;
        color.title = "Background color";
        color.addEventListener("input", () => setModuleBg(entry, color.value));
        chip.appendChild(color);

        const revert = doc.createElement("button");
        revert.textContent = entry.adapted ? "Revert CSS" : "Adapt CSS";
        revert.addEventListener("click", () => {
          toggleAdapt(entry);
          revert.textContent = entry.adapted ? "Revert CSS" : "Adapt CSS";
        });
        chip.appendChild(revert);

        if (entry.def.flattenable) {
          const flat = doc.createElement("button");
          const flatSync = () => {
            flat.textContent = entry.flat ? "Unblend" : "Blend";
            flat.title = entry.flat
              ? "Restore the widget's own box colors"
              : "Blend the widget's fixed box colors into the site";
          };
          flatSync();
          flat.addEventListener("click", () => { toggleFlat(entry); flatSync(); });
          chip.appendChild(flat);
        }

        // Site imagery (§5.11) — shown only when this page yielded a pool and
        // the widget has fillable frames.
        if (imageryTargets(entry).length) {
          const img = doc.createElement("button");
          // Shuffle sits next to the toggle and only exists while imagery is
          // on — it is a sub-action of it, and a shuffle button on a widget
          // showing its captured photos has nothing to shuffle.
          const shuffle = doc.createElement("button");
          shuffle.className = "dmb-glyph";
          shuffle.textContent = "⟳";
          shuffle.title = "Try a different set of photos from this site";
          const imgSync = () => {
            img.textContent = entry.imagery ? "Stock photos" : "Site photos";
            img.title = entry.imagery
              ? "Put the widget's captured photos back"
              : "Fill the widget's photos with images from this site";
            shuffle.style.display = entry.imagery ? "" : "none";
          };
          imgSync();
          img.addEventListener("click", () => {
            toggleImagery(entry);
            imgSync();
            // The chip's width changes when Shuffle appears or goes; re-clamp
            // so the tail can't end up off the canvas edge (§5.2).
            positionChip(entry.el);
          });
          shuffle.addEventListener("click", () => shuffleImagery(entry));
          chip.append(img, shuffle);
        }

        const remove = doc.createElement("button");
        remove.className = "dmb-danger";
        remove.textContent = "✕";
        remove.title = "Remove module";
        remove.addEventListener("click", () => {
          removeModule(entry);
          hideChip();
        });
        chip.appendChild(remove);
      } else {
        const hide = doc.createElement("button");
        hide.className = "dmb-danger";
        hide.textContent = "Hide";
        hide.addEventListener("click", () => {
          setSectionHidden(entry, true);
          hideChip();
        });
        chip.appendChild(hide);
      }

      // Visible before positioning: the clamp needs the chip's real width
      // (a display:none element measures 0, and a guessed constant clips the
      // tail buttons off the viewport edge once the chip grew — the Blend
      // button made that visible). Same JS task, so no flash of the chip at
      // its old position.
      chip.style.display = "flex";
      positionChip(entry.el);
    }

    /* How much of the top of the viewport the *store's* own fixed chrome
     * occupies. Measured by hit-testing rather than by selector, because every
     * theme names its header differently but they all sit in the same place —
     * the same reasoning as the overlay sweep in §5.9.
     *
     * Needed because the chip sticks to the top of the viewport while you
     * scroll through a taller-than-screen widget, and a sticky store header
     * sits exactly there: the chip ended up *underneath* it, and reaching for
     * it meant crossing onto the header, which is not the widget, so the chip
     * dismissed itself. Unreachable buttons (§8 #20). */
    function topChromeHeight() {
      const win = doc.defaultView;
      let h = 0;
      // Three probes: a centred header is the common case, but plenty of themes
      // put a fixed announcement bar or utility rail at one edge only.
      for (const fx of [0.5, 0.15, 0.85]) {
        const x = Math.round(win.innerWidth * fx);
        let stack = [];
        try { stack = doc.elementsFromPoint(x, 2) || []; } catch (err) { continue; }
        for (const el of stack) {
          if (!el || el.nodeType !== 1) continue;
          const id = el.getAttribute && el.getAttribute("id");
          if (id && id.startsWith("dmb-")) continue;         // our own overlay UI
          let pos;
          try { pos = win.getComputedStyle(el).position; } catch (err) { continue; }
          if (pos !== "fixed" && pos !== "sticky") continue;
          const rect = el.getBoundingClientRect();
          // Only chrome that actually hugs the top; a fixed cart drawer or
          // chat bubble further down the viewport is not in our way.
          if (rect.top <= 4 && rect.bottom > h) h = rect.bottom;
        }
      }
      // A full-bleed fixed overlay (cookie wall, modal) must not push the chip
      // off the screen entirely — past a third of the viewport, ignore it.
      // Only when the viewport height is actually known: a frame that reports 0
      // (an undisplayed/offscreen pane does) would otherwise make every
      // measurement "too tall" and silently switch the clamp back off.
      const vh = win.innerHeight || doc.documentElement.clientHeight || 0;
      return vh && h > vh / 3 ? 0 : h;
    }

    function positionChip(el) {
      const r = el.getBoundingClientRect();
      const win = doc.defaultView;
      const chipW = chip.offsetWidth || 240;
      const chipH = chip.offsetHeight || 32;

      // Where the chip would like to sit: just inside the widget's own top
      // edge, in page coordinates.
      const atElement = r.top + win.scrollY + 6;
      // Where it sticks to once that edge has scrolled off: below the store's
      // fixed chrome, not at the raw top of the viewport.
      const sticky = win.scrollY + topChromeHeight() + 6;
      // …but never past the widget's bottom edge. The chip labels this element,
      // so it must stay on it — sliding down over whatever follows would be
      // both wrong and confusing.
      const floor = r.bottom + win.scrollY - chipH - 6;

      const top = Math.max(atElement, Math.min(sticky, floor));
      const left = Math.max(6, Math.min(r.right + win.scrollX - chipW - 8, win.scrollX + win.innerWidth - chipW - 20));
      chip.style.top = top + "px";
      chip.style.left = left + "px";
    }

    doc.addEventListener("mouseover", (e) => {
      if (chip.contains(e.target)) return;
      const secEl = e.target.closest && e.target.closest("[data-dmb-id]");
      if (!secEl) return;
      const entry = findEntry(secEl.getAttribute("data-dmb-id"));
      if (entry) showChip(entry);
    });

    doc.addEventListener("mousemove", (e) => {
      if (!current) return;
      if (chip.contains(e.target)) return;
      const secEl = e.target.closest && e.target.closest("[data-dmb-id]");
      if (!secEl || secEl !== current.el) {
        if (!secEl) hideChip();
      }
    });

    doc.addEventListener("scroll", () => { if (current) positionChip(current.el); }, { passive: true });
  }

  function findEntry(id) {
    return state.sections.find((s) => s.id === id) || state.demos.find((d) => d.id === id) || null;
  }

  /* -------------------------------------------------------- drag & drop */
  function setupDragDrop(doc) {
    const indicator = doc.createElement("div");
    indicator.id = "dmb-indicator";
    doc.body.appendChild(indicator);

    function anchors() {
      return [...state.sections.filter((s) => !s.hidden), ...state.demos]
        .map((e) => e.el)
        .filter((el) => el.isConnected)
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    }

    function insertionPointAt(clientX, clientY) {
      const els = anchors();
      if (!els.length) return null;
      let best = null;
      let bestDist = Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        const mid = r.top + r.height / 2;
        const where = clientY < mid ? "before" : "after";
        const edge = where === "before" ? r.top : r.bottom;
        // Horizontal penalty: sub-sections put anchors in side-by-side
        // columns whose edges share a Y — prefer the column under the pointer.
        const xPenalty = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
        const dist = Math.abs(clientY - edge) + xPenalty;
        if (dist < bestDist) {
          bestDist = dist;
          best = { ref: el, where, rect: r };
        }
      }
      return best;
    }

    doc.addEventListener("dragover", (e) => {
      if (!Array.from(e.dataTransfer.types).includes("text/plain")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const pt = insertionPointAt(e.clientX, e.clientY);
      state.pendingDrop = pt;
      if (pt) {
        const win = doc.defaultView;
        const y = (pt.where === "before" ? pt.rect.top : pt.rect.bottom) + win.scrollY - 2;
        indicator.style.display = "block";
        indicator.style.top = y + "px";
        indicator.style.left = Math.max(8, pt.rect.left + win.scrollX) + "px";
        indicator.style.width = Math.max(120, pt.rect.width - 16) + "px";
      }
    });

    doc.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget) indicator.style.display = "none";
    });

    doc.addEventListener("drop", (e) => {
      indicator.style.display = "none";
      const data = e.dataTransfer.getData("text/plain") || "";
      if (!data.startsWith("dmb:")) return;
      e.preventDefault();
      insertModule(data.slice(4), state.pendingDrop);
      state.pendingDrop = null;
    });
  }

  /* ----------------------------------------------------- module actions */
  function insertModule(moduleId, point) {
    const def = DEMO_MODULES.find((m) => m.id === moduleId);
    if (!def || !state.doc) return;

    const el = state.doc.createElement("div");
    // The scope class is what connects this instance to *its own* CSS —
    // widget CSS is scoped per widget (.dmb-module.dmb-w-<id>, modules.js).
    el.className = "dmb-module " + def.scopeClass;
    el.innerHTML = def.html;
    const id = "demo-" + state.counter++;
    el.setAttribute("data-dmb-id", id);
    el.setAttribute("data-dmb-kind", "demo");

    if (point && point.ref.isConnected) {
      point.ref.parentNode.insertBefore(el, point.where === "before" ? point.ref : point.ref.nextSibling);
    } else {
      (state.doc.querySelector("main") || state.doc.body).appendChild(el);
    }

    // imagery starts OFF (§5.11): theme adaptation is on by default because it
    // is reversible and always an improvement; imagery replaces *content*, and
    // a wrong swap fails in front of a client. The rep opts in per instance.
    const entry = { id, el, def, adapted: false, bg: null, flat: false,
                    imagery: false, imageryVariant: 0 };
    state.demos.push(entry);
    // Expand the sections around the drop point so the new row is visible.
    for (let p = deepestSectionAround(el); p; p = p.parent) p.expanded = true;
    toggleAdapt(entry); // auto-adapt to host styling on insert
    renderEditor();
    flash(el);
    setStatus(`Inserted “${def.name}” — styled to match the site`, "ok");
  }

  /* The adaptation contract: every themable attribute of a module is one of
   * these variables, so Adapt is "set them from the host palette" and Revert
   * is "remove them" (the stylesheet defaults take over). A widget that
   * hardcodes a color/font can't participate — see WIDGETS.md. */
  const ADAPT_VARS = ["--dmb-font", "--dmb-heading-font", "--dmb-text", "--dmb-accent", "--dmb-accent-contrast", "--dmb-radius"];

  function applyHostVars(el) {
    const h = state.host;
    if (!h) return;
    el.style.setProperty("--dmb-font", h.font);
    el.style.setProperty("--dmb-heading-font", h.headingFont);
    el.style.setProperty("--dmb-text", h.text);
    el.style.setProperty("--dmb-accent", h.accent);
    el.style.setProperty("--dmb-accent-contrast", h.contrast);
    if (h.radius) el.style.setProperty("--dmb-radius", h.radius);
  }

  function clearHostVars(el) {
    ADAPT_VARS.forEach((p) => el.style.removeProperty(p));
  }

  function toggleAdapt(entry) {
    if (entry.adapted) {
      clearHostVars(entry.el);
      entry.adapted = false;
    } else if (state.host) {
      applyHostVars(entry.el);
      entry.adapted = true;
    }
    renderEditor();
  }

  function setModuleBg(entry, color) {
    entry.bg = color;
    entry.el.style.setProperty("--dmb-bg", color);
    const row = editorList.querySelector(`[data-row="${entry.id}"] input[type=color]`);
    if (row) row.value = color;
  }

  /* Blend toggle (§5.9): dissolve the widget's *subtle* frozen surfaces into
   * the host page and release their pinned text back to the theme — or put
   * both back. Only does anything for imports whose capture emitted .dmb-flat
   * companion rules (def.flattenable); default is off, the faithful capture. */
  function toggleFlat(entry) {
    entry.flat = !entry.flat;
    entry.el.classList.toggle("dmb-flat", entry.flat);
    renderEditor();
  }

  /* ---- site imagery, per instance (§5.11) ----
   * The same shape as Adapt and Blend: page-side, per-instance, reversible,
   * off by default. Nothing here writes to the widget def, so the gallery
   * card, the dialog preview and every other instance are untouched. */

  /* Can this instance offer the toggle? Needs both halves — a pool harvested
   * from the loaded page, and image frames in the widget. Either can be
   * legitimately empty (a bot-blocked store, a text-only loyalty card), and
   * then there is nothing to offer.
   *
   * Cached per instance because renderEditor() calls this for every demo row
   * on every render, and the fallback path for manifest-less widgets is a
   * getComputedStyle walk of the whole instance — cheap once, not 30 times a
   * drag. Invalidated wherever the instance's markup is replaced. */
  function imageryTargets(entry) {
    if (!window.IMAGERY || !state.imagery || !state.imagery.pool.length) return [];
    if (!entry.slotsCache) entry.slotsCache = IMAGERY.slotsFor(entry.def, entry.el, state.win);
    return entry.slotsCache;
  }

  /* Lay this instance's current variant over its slots. Always reverts first:
   * a re-apply must start from the captured photos, or a slot the new variant
   * leaves as stock would keep the *previous* variant's picture and the
   * original recorded on it would be a swap rather than the capture. */
  function paintImagery(entry) {
    IMAGERY.revertImagery(entry.el);
    const slots = imageryTargets(entry);
    const filled = IMAGERY.applyImagery(entry.el, slots, state.imagery ? state.imagery.pool : [],
      { variant: entry.imageryVariant || 0 });
    return { slots: slots, filled: filled };
  }

  function toggleImagery(entry) {
    if (!window.IMAGERY) return;
    if (entry.imagery) {
      IMAGERY.revertImagery(entry.el);
      entry.imagery = false;
      setStatus(`“${entry.def.name}” — back to its captured photos`);
    } else {
      const res = paintImagery(entry);
      entry.imagery = res.filled > 0;
      // Nothing matched: say so rather than leave the rep toggling a dead
      // button. Usually the pool has no image shaped like the widget's frames,
      // or every frame is an avatar/brand slot we deliberately never fill.
      setStatus(
        res.filled
          ? `“${entry.def.name}” — ${res.filled} of ${res.slots.length} images from this site`
          : `“${entry.def.name}” — no image on this page fits the widget's frames`,
        res.filled ? "ok" : "err"
      );
    }
    renderEditor();
  }

  /* Draw again (§5.11). Role matching gets a slot into the right neighbourhood
   * but cannot judge whether a packshot reads wrong in an experiential frame —
   * the rep is looking straight at it, so the cheapest good answer is another
   * roll rather than a cleverer matcher. Each press advances the variant, which
   * rotates role emphasis, pick depth and the fill pattern together. */
  function shuffleImagery(entry) {
    if (!window.IMAGERY || !entry.imagery) return;
    entry.imageryVariant = (entry.imageryVariant || 0) + 1;
    const res = paintImagery(entry);
    if (!res.filled) {
      // The variant walked somewhere with nothing to show. Don't strand the rep
      // on an empty widget — go back to the draw that worked.
      entry.imageryVariant = 0;
      paintImagery(entry);
      setStatus(`“${entry.def.name}” — back to the first set, this page has no other fit`, "err");
      return;
    }
    setStatus(`“${entry.def.name}” — new set of ${res.filled} site photos (#${entry.imageryVariant + 1})`, "ok");
  }

  /* Re-apply after something rewrote the instance's markup (a widget edit
   * re-renders innerHTML, which drops both the swap and the data-dmb-img-orig
   * originals recorded against the old nodes). Keeps the rep's chosen variant. */
  function refreshImagery(entry) {
    entry.slotsCache = null;   // the nodes the old manifest addressed are gone
    if (!entry.imagery || !window.IMAGERY) return;
    entry.imagery = paintImagery(entry).filled > 0;
  }

  function removeModule(entry) {
    entry.el.remove();
    state.demos = state.demos.filter((d) => d !== entry);
    renderEditor();
  }

  function setSectionHidden(entry, hidden) {
    entry.hidden = hidden;
    entry.el.classList.toggle("dmb-hidden", hidden);
    entry.el.classList.remove("dmb-hover");
    renderEditor();
  }

  function flash(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("dmb-flash");
    setTimeout(() => el.classList.remove("dmb-flash"), 1400);
  }

  /* ------------------------------------------------------- editor panel
   * A tree: top-level sections in document order; expanding a section nests
   * its sub-sections (and any demos dropped inside it) indented below it. */
  function renderEditor() {
    editorList.innerHTML = "";
    const topCount = state.sections.filter((s) => !s.parent).length;
    sectionCount.textContent = topCount || state.demos.length
      ? `${topCount} sections · ${state.demos.length} inserted`
      : "";

    if (!state.sections.length && !state.demos.length) {
      editorList.innerHTML = '<p class="panel-empty">Page structure will appear here once a product page is loaded.</p>';
      return;
    }

    const docOrder = (a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    const liveDemos = state.demos.filter((d) => d.el.isConnected);

    function renderLevel(parentEntry, depth) {
      const group = [
        ...state.sections.filter((s) => s.parent === parentEntry && s.el.isConnected),
        ...liveDemos.filter((d) => deepestSectionAround(d.el) === parentEntry),
      ].sort(docOrder);
      for (const entry of group) {
        editorList.appendChild(buildRow(entry, depth));
        if (!entry.def && entry.expanded) renderLevel(entry, depth + 1);
      }
    }
    renderLevel(null, 0);
  }

  function buildRow(entry, depth) {
    const isDemo = !!entry.def;
    const dimmed = entry.hidden || hasHiddenAncestor(entry);
    const row = document.createElement("div");
    row.className = "ed-row" + (isDemo ? " demo-row" : "") + (dimmed ? " hidden-row" : "") + (depth ? " sub-row" : "");
    row.dataset.row = entry.id;
    if (depth) row.style.marginLeft = depth * 14 + "px";

    if (!isDemo) {
      // Caret until proven childless; a spacer after that keeps names aligned.
      const expandable =
        !entry.subsChecked ||
        sectionChildren(entry).length ||
        state.demos.some((d) => deepestSectionAround(d.el) === entry);
      const caret = document.createElement(expandable ? "button" : "span");
      caret.className = "caret" + (expandable ? " icon-btn" : " caret-spacer");
      if (expandable) {
        caret.textContent = entry.expanded ? "▾" : "▸";
        caret.title = entry.expanded ? "Collapse" : "Expand sub-sections";
        caret.addEventListener("click", (e) => { e.stopPropagation(); toggleExpand(entry); });
      }
      row.appendChild(caret);
    }

    const name = document.createElement("span");
    name.className = "ed-name";
    name.textContent = isDemo ? entry.def.name : entry.name;
    name.title = name.textContent;

    const tag = document.createElement("span");
    tag.className = "ed-tag";
    tag.textContent = isDemo ? "demo" : entry.tag;

    const actions = document.createElement("span");
    actions.className = "ed-actions";

    if (isDemo) {
      const color = document.createElement("input");
      color.type = "color";
      color.className = "ed-color";
      color.title = "Background color";
      color.value = entry.bg || DEFAULT_BG;
      color.addEventListener("click", (e) => e.stopPropagation());
      color.addEventListener("input", () => setModuleBg(entry, color.value));

      const revert = document.createElement("button");
      revert.className = "icon-btn";
      revert.title = entry.adapted ? "Revert to default module styling" : "Adapt to site styling";
      revert.textContent = entry.adapted ? "↺" : "✦";
      revert.addEventListener("click", (e) => { e.stopPropagation(); toggleAdapt(entry); });

      const del = document.createElement("button");
      del.className = "icon-btn danger";
      del.title = "Remove module";
      del.textContent = "✕";
      del.addEventListener("click", (e) => { e.stopPropagation(); removeModule(entry); });

      // Optional per-instance toggles sit between the swatch and ✦/✕, each
      // shown only when the widget can actually do the thing.
      const extras = [];

      if (entry.def.flattenable) {
        const flat = document.createElement("button");
        flat.className = "icon-btn";
        flat.title = entry.flat
          ? "Restore the widget's own box colors"
          : "Blend the widget's fixed box colors into the site";
        flat.textContent = entry.flat ? "▩" : "▧";
        flat.addEventListener("click", (e) => { e.stopPropagation(); toggleFlat(entry); });
        extras.push(flat);
      }

      // Site imagery (§5.11). Deliberately distinct glyphs from Blend's ▧/▩.
      if (imageryTargets(entry).length) {
        const pics = document.createElement("button");
        pics.className = "icon-btn";
        pics.title = entry.imagery
          ? "Put the widget's captured photos back"
          : "Fill the widget's photos with images from this site";
        pics.textContent = entry.imagery ? "▣" : "▢";
        pics.addEventListener("click", (e) => { e.stopPropagation(); toggleImagery(entry); });
        extras.push(pics);
      }

      actions.append(color, ...extras, revert, del);
    } else {
      const eye = document.createElement("button");
      eye.className = "icon-btn" + (entry.hidden ? " danger" : "");
      eye.title = entry.hidden ? "Show section" : "Hide section";
      eye.textContent = entry.hidden ? "🚫" : "👁";
      eye.addEventListener("click", (e) => { e.stopPropagation(); setSectionHidden(entry, !entry.hidden); });
      actions.append(eye);
    }

    row.append(name, tag, actions);
    row.addEventListener("click", () => { if (!dimmed) flash(entry.el); });
    return row;
  }

  /* --------------------------------------------- viewport emulation
   * The iframe always gets a real desktop (or phone) CSS width so the site's
   * responsive breakpoints see that width — a narrow app window must never
   * push the site into its mobile layout. When the canvas column is narrower
   * than DESKTOP_W, the iframe is rendered at DESKTOP_W and scaled down to
   * fit (transform doesn't affect the iframe's internal viewport). */
  const viewportEl = document.getElementById("viewport");
  const vpToggle = document.getElementById("vp-toggle");
  const DESKTOP_W = 1280;
  const MOBILE_W = 390;

  function layoutViewport() {
    const bw = viewportEl.clientWidth;
    const bh = viewportEl.clientHeight;
    if (!bw || !bh) return;
    if (state.viewMode === "mobile") {
      viewportEl.classList.add("mobile");
      iframe.style.width = Math.min(MOBILE_W, bw) + "px";
      iframe.style.height = "100%";
      iframe.style.transform = "";
    } else {
      viewportEl.classList.remove("mobile");
      if (bw >= DESKTOP_W) {
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.transform = "";
      } else {
        const s = bw / DESKTOP_W;
        iframe.style.width = DESKTOP_W + "px";
        iframe.style.height = Math.round(bh / s) + "px";
        iframe.style.transform = "scale(" + s + ")";
        iframe.style.transformOrigin = "top left";
      }
    }
  }

  vpToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn || btn.dataset.mode === state.viewMode) return;
    state.viewMode = btn.dataset.mode;
    vpToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    layoutViewport();
    // Give responsive CSS a beat to settle, then pick up newly-visible sections.
    if (state.doc) setTimeout(redetectSections, 350);
  });

  new ResizeObserver(layoutViewport).observe(viewportEl);
  layoutViewport();

  /* ------------------------------------------------- gallery collapse */
  const layoutRoot = document.querySelector(".layout");
  const galleryToggle = document.getElementById("gallery-toggle");
  galleryToggle.addEventListener("click", () => {
    const collapsed = layoutRoot.classList.toggle("gallery-collapsed");
    galleryToggle.textContent = collapsed ? "‹" : "›";
    galleryToggle.title = collapsed ? "Expand gallery" : "Collapse gallery";
    // ResizeObserver rescales the canvas automatically as the column grows.
  });

  /* ====================================== import a widget from a preview link
   * The user pastes a widget-preview URL (e.g. a Yotpo yap.yotpo.com preview).
   * Those pages are empty shells rendered by a JS loader, so a plain fetch
   * captures nothing. Instead we render the preview in a hidden iframe served
   * through our own /proxy with &scripts=1 — same-origin, so once the loader
   * has run we can read the fully rendered DOM and snapshot it into a static
   * widget def (HTML + the style rules that actually apply to it).
   *
   * Two tricks make the capture faithful:
   * 1. The original URL's query string is appended to the proxy URL too, so
   *    the shell page finds its params (guid, widget_instance_id…) in
   *    location.search exactly as it would on the real origin.
   * 2. Yotpo widgets choose static demo data over live-store API calls when
   *    their mount element has mode-preview="true" (verified in the widget
   *    bundle: `isPreview || isReadOnly` selects demoData*.json). The real
   *    preview origin gets that state via wadmin plumbing we don't have, so
   *    `&dmb-capture=1` makes the proxy inject a MutationObserver as the
   *    document's first script (CAPTURE_BOOTSTRAP in server.py) that tags
   *    every mount before any page script runs. Tagging from here instead is
   *    a race we lose whenever the loader initializes first, and losing it is
   *    silent: the widget renders a ~36-element skeleton with no reviews.
   *    Measured A/B on instance 1004109 — tagged: 767 elements / 2584 chars
   *    of text; untagged: 36 / 81.
   * 3. That same bootstrap replaces IntersectionObserver with a stub that
   *    reports everything as intersecting, so lazy content (Yotpo paints each
   *    review photo's background-image from an IO callback) loads without ever
   *    being on screen. Nothing here may depend on the frame's position or on
   *    the tab being visible: an IO inside an iframe is clipped by the iframe's
   *    intersection with the top-level viewport, and a hidden tab runs no
   *    rendering lifecycle at all, so callbacks would simply never arrive.
   *    Measured on the same instance: 0 of 6 review photos captured with the
   *    real IO in an off-screen frame, 6 of 6 with the stub.
   *
   * The snapshot is deliberately static: the spec for imports is "the widget
   * as it looks right now, forever". A new version = a new import.
   *
   * Note what this can NOT decide: whether the rendered widget is the one the
   * user meant. A preview URL with an unknown widget_instance_id renders the
   * platform's generic default widget — a real capture of the wrong thing. The
   * dialog's live preview is the guard for that; the checks here only guarantee
   * we never save an *empty* one. */
  const CAPTURE_TIMEOUT_MS = 22000; // give one load attempt this long overall
  const CAPTURE_QUIET_MS = 1400;    // DOM unchanged this long = render settled
  const CAPTURE_MIN_WAIT_MS = 1500; // …but never settle sooner than this
  const CAPTURE_POLL_MS = 200;
  const CAPTURE_ATTEMPTS = 3;       // a loader chain that stalls is retryable
  // A widget mounts within ~1.5s of the shell being ready. When the document is
  // done and *nothing* has appeared this long after, the loader was fetched but
  // never executed (observed occasionally, twice in a row once) — a fresh frame
  // fixes it, so bail early instead of sitting out the full timeout. Only the
  // last attempt waits patiently, so a genuinely slow preview still gets 22s.
  const CAPTURE_DEAD_MS = 7000;

  /* Platform theme custom-properties → app variables. Applied by literal
   * value-swap in the captured markup (covers inline styles and SVG
   * stop-color attributes) and re-declared in a bridge rule as a fallback.
   * Unknown platforms simply match nothing and keep their fixed colors. */
  const CAPTURE_THEME_MAP = [
    { key: "--primary-color",         to: "var(--dmb-accent)" },
    { key: "--stars-color",           to: "var(--dmb-star)" },
    { key: "--text-color",            to: "var(--dmb-text)" },
    { key: "--background-color",      to: "transparent" }, // wrapper carries --dmb-bg
    { key: "--primary-font-family",   to: "var(--dmb-heading-font)" },
    { key: "--secondary-font-family", to: "var(--dmb-font)" },
  ];

  /* ---- theme rewriting (capture → --dmb-* variables) --------------------
   * Stores customize widgets two ways, and both must be bridged or the
   * capture keeps the *original* store's skin instead of taking the demo
   * host's (§8 #10, seen on a white-on-black Yotpo instance):
   *
   *   1. Theme properties (--primary-color: …) — but several properties
   *      routinely share one literal value (a white-on-black theme has
   *      primary = text = stars = white), so values must be rewritten by
   *      PROPERTY NAME, never by find-and-replace of the value.
   *   2. Per-instance override CSS (the `yotpo-widget-override-css` sheet a
   *      platform writes for a store) — literal `background:#000`,
   *      `color:#fff`, brand font-families, spelled differently from the
   *      theme values (`#000` vs `rgba(0,0,0,1)`). Bridged by parsing color
   *      tokens and matching them to the sampled theme BY COLOR, then mapping
   *      by the property's role. The mapping preserves legibility pairs:
   *      text-on-background → --dmb-text on the host page's own background,
   *      inverted elements (background = theme text color, text = theme
   *      background color) → --dmb-accent + --dmb-accent-contrast.
   *
   * Colors that match no sampled theme color (greys, shadows, translucent
   * overlays, data-URI artwork) pass through untouched. A page with no
   * sampled theme (non-Yotpo platforms) is left entirely as captured. */
  const CAPTURE_BG_PROP_RE = /^background(?:-color)?$/i;
  const CAPTURE_FG_PROP_RE = /^(?:color|fill|stroke|stop-color|caret-color|text-decoration-color|column-rule-color|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?)$/i;
  /* Of those, the ones that actually paint glyphs. Separated because a
   * near-white `color` on a light page is text sitting on an inverted element
   * (so it must follow the host), while a near-white `border-color` is a
   * hairline separator (so it must not) — see anchorFgColor. */
  const CAPTURE_TEXT_PROP_RE = /^(?:color|fill|stroke)$/i;
  /* Gradient stops are artwork, not text: recoloring them redraws the picture. */
  const CAPTURE_NO_ANCHOR_RE = /^stop-color$/i;

  /* Color tokens inside a declaration value. `var(` plus the property name it
   * references is consumed as ONE atomic token, and any other identifier run is
   * consumed greedily, so a color keyword can never be extracted from the middle
   * of a name. A bare /\b(white|black)\b/ could: hyphens are word boundaries, and
   * a platform's palette constants are called things like --yotpo-empty-white and
   * --yotpo-primary-text-black, which came back rewritten as
   * `var(--yotpo-empty-var(--dmb-accent))` — not a valid custom-property name, so
   * the whole declaration was invalid at computed-value time and fell back to
   * `unset` (inherit for color, transparent for background). 22 references in one
   * capture, silently (§8 #15). */
  const CAPTURE_COLOR_TOKEN_RE =
    /var\(\s*--[\w-]+|#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|[-\w]+/g;

  /* #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(), white/black → [r,g,b,a] or null.
   * (parseColor above only handles getComputedStyle's rgb() output; captured
   * author CSS needs hex and keywords too.) */
  function parseAnyColor(str) {
    if (!str) return null;
    const s = String(str).trim().toLowerCase();
    if (s === "white") return [255, 255, 255, 1];
    if (s === "black") return [0, 0, 0, 1];
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
      if (h.length === 6) h += "ff";
      if (h.length !== 8) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
              parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
    }
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      if (p.length < 3 || p.slice(0, 3).some(isNaN)) return null;
      return [p[0], p[1], p[2], p.length > 3 && !isNaN(p[3]) ? p[3] : 1];
    }
    return null;
  }

  function sameColor(a, b) {
    return !!(a && b) &&
      Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 &&
      Math.abs(a[2] - b[2]) <= 2 && Math.abs(a[3] - b[3]) <= 0.02;
  }

  /* Inline styles reach us through outerHTML, where the quotes around a
   * multi-word family are entities — and `&quot;` contains a `;`, so a naive
   * declaration split lands mid-entity. Decode before comparing. */
  function firstFontFamily(v) {
    const f = String(v == null ? "" : v)
      .replace(/&quot;|&#0?34;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
      .split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
    return f || null;
  }

  /* A role can hold more than one declared color: platforms expose several
   * text colors (header vs title vs description) that must all map to
   * --dmb-text. Inline sampling yields one string per property, the loader
   * config yields a list — normalize both to a list. */
  function themeValues(v) {
    return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
  }

  function hitsRole(list, c) {
    return list.some((x) => sameColor(x, c));
  }

  function captureThemeRoles(theme) {
    const colors = (key) => themeValues(theme[key]).map(parseAnyColor).filter(Boolean);
    const roles = {
      bg: colors("--background-color"),
      text: colors("--text-color"),
      accent: colors("--primary-color"),
      stars: colors("--stars-color"),
      headFont: firstFontFamily(themeValues(theme["--primary-font-family"])[0]),
      bodyFont: firstFontFamily(themeValues(theme["--secondary-font-family"])[0]),
    };
    // When the theme paints stars the same color as text/accent (white-on-dark
    // themes do), a bare literal can't be told apart — text/accent win, and
    // star elements keep their var(--stars-color) route to --dmb-star.
    roles.starsDistinct = roles.stars.length > 0 &&
      !roles.stars.some((s) => hitsRole(roles.text, s) || hitsRole(roles.accent, s));
    return roles;
  }

  /* ---- foreground anchoring ---------------------------------------------
   * Role mapping only reaches colors the platform *declared* as theme. Its own
   * palette constants are a second, larger set — --yotpo-black: #373330,
   * --yotpo-primary-text-black: #2C2C2C, --yotpo-medium-grey: #60646C,
   * --yotpo-separator-line-grey: #e3e3e3 — and so is every grey a store's
   * override sheet hardcodes. Leaving them literal is right for backgrounds,
   * artwork and status hues, and wrong for anything that paints text: they are
   * all near-black *because the source page was light*, so on a dark host every
   * one of them is invisible and no swatch reaches them (§8 #15 — the same
   * light-page assumption as §8 #11, one layer further in).
   *
   * So: re-point achromatic foregrounds at --dmb-text, preserving how strong
   * each one was. Strength is the color's distance from the source page's own
   * background — a faithful translation, not a flattening: #2C2C2C body copy
   * arrives as var(--dmb-text), #60646C secondary copy as 60% of it, #e3e3e3
   * hairlines as 10%. A chromatic color (brand blue, error red, a star amber the
   * theme didn't name) is left alone, because its hue *is* the information. */
  const CAPTURE_ANCHOR_SAT = 0.3;    // above this the color is a hue, not a grey
  const CAPTURE_ANCHOR_SOLID = 0.75; // at/above this strength it *is* body text
  const CAPTURE_ANCHOR_MIN = 0.08;   // below it, decoration too faint to bother

  function colorSaturation(c) {
    const max = Math.max(c[0], c[1], c[2]);
    return max <= 0 ? 0 : (max - Math.min(c[0], c[1], c[2])) / max;
  }

  /* anchor = {dark} for the page the widget was captured on; isText marks the
   * properties that paint glyphs rather than lines (CAPTURE_TEXT_PROP_RE).
   * A glyph color at the *opposite* extreme from the source background is text
   * on an inverted element (a black chip on a light page, a white search box on
   * a dark one), which must follow the host too — captureFixedBgRules then
   * re-anchors --dmb-text inside whichever of those surfaces stayed frozen.
   * Borders get no such promotion: a near-white border on a light page is a
   * hairline, and promoting it would draw a full-strength line across the card. */
  function anchorFgColor(c, anchor, isText) {
    if (colorSaturation(c) > CAPTURE_ANCHOR_SAT) return null;
    const lum = luminance({ r: c[0], g: c[1], b: c[2] });
    const strength = anchor.dark ? lum : 1 - lum;
    if (strength >= CAPTURE_ANCHOR_SOLID) return "var(--dmb-text)";
    if (isText && 1 - strength >= CAPTURE_ANCHOR_SOLID) return "var(--dmb-text)";
    if (strength < CAPTURE_ANCHOR_MIN) return null;
    return "color-mix(in srgb, var(--dmb-text) " +
      Math.round(strength * 20) * 5 + "%, transparent)";
  }

  function mapCaptureColor(token, roles, isBg, anchor, isText) {
    const c = parseAnyColor(token);
    if (!c || c[3] < 0.95) return null; // translucent = overlay/scrim, not theme
    if (isBg) {
      if (hitsRole(roles.bg, c)) return "transparent"; // host page shows through
      if (hitsRole(roles.text, c) || hitsRole(roles.accent, c)) return "var(--dmb-accent)";
      return null; // a frozen surface — captureFixedBgRules keeps its text legible
    }
    if (roles.starsDistinct && hitsRole(roles.stars, c)) return "var(--dmb-star)";
    if (hitsRole(roles.text, c)) return "var(--dmb-text)";
    if (hitsRole(roles.accent, c)) return "var(--dmb-accent)";
    if (hitsRole(roles.bg, c)) return "var(--dmb-accent-contrast)"; // text on an inverted element
    return anchor ? anchorFgColor(c, anchor, isText) : null;
  }

  function mapCaptureValue(value, roles, isBg, anchor, isText) {
    if (/url\(/i.test(value)) return value; // never recolor data-URI artwork
    return value.replace(CAPTURE_COLOR_TOKEN_RE, (tok) =>
      (tok.charAt(0) === "v" ? null : mapCaptureColor(tok, roles, isBg, anchor, isText)) || tok);
  }

  /* Rewrite one blob — captured CSS (isCss) or serialized snapshot HTML,
   * where the same declaration shapes live inside style="…" attributes. */
  function rewriteCaptureTheme(text, theme, isCss) {
    const roles = captureThemeRoles(theme);

    // 1. Mapped platform properties, by NAME — immune to shared values.
    //    The value has to be consumed WHOLE, or its tail survives the
    //    substitution as garbage: a store sheet's quoted family
    //    (`--primary-font-family: "Manrope", sans-serif !important`) used to
    //    stop the match at the opening quote, leaving
    //    `var(--dmb-heading-font)"Manrope", sans-serif` — a token stream a
    //    custom property happily stores and `font-family` then can't parse, so
    //    the text silently fell back to the inherited font (§8 #14). Quotes end
    //    a value only in the HTML branch, where they close the style attribute;
    //    there the value's own quotes arrive as entities, so those are part of
    //    it (the same `&quot;`-contains-a-`;` trap as §8 #13).
    //    `!important` is deliberately dropped along with the old value: every
    //    mapped property is rewritten to the same canonical var() everywhere,
    //    so it buys nothing, and keeping it would out-rank the per-card text
    //    re-declarations that captureFixedBgRules emits.
    const value = isCss ? "[^;}]+" : "(?:&quot;|&#0?34;|&apos;|&#0?39;|[^;}\"'])+";
    for (const map of CAPTURE_THEME_MAP) {
      if (theme[map.key] === undefined) continue;
      text = text.replace(
        new RegExp("(^|[^-\\w])(" + map.key + "\\s*:\\s*)" + value, "g"),
        "$1$2" + map.to
      );
    }

    // 2. Literal colors on ordinary declarations, by property role.
    text = text.replace(/([;{"']\s*|^\s*)([a-zA-Z][a-zA-Z-]*)(\s*:\s*)([^;}"']+)/g,
      (all, pre, prop, sep, val) => {
        const isBg = CAPTURE_BG_PROP_RE.test(prop);
        if (!isBg && !CAPTURE_FG_PROP_RE.test(prop)) return all;
        return pre + prop + sep + mapCaptureValue(val, roles, isBg);
      });

    // 3. Unmapped custom properties whose value is VERBATIM a theme value
    //    (frameworks stamp the theme into per-component vars). Verbatim, not
    //    color-equal: the platform's own palette constants (--yotpo-pure-black
    //    etc.) coincide with theme colors by value but are not theme.
    const rawRoles = [];
    const pushRaw = (key, to) => {
      if (to) themeValues(theme[key]).forEach((v) => rawRoles.push([v, to]));
    };
    pushRaw("--stars-color", roles.starsDistinct ? "var(--dmb-star)" : null);
    pushRaw("--text-color", "var(--dmb-text)");
    pushRaw("--primary-color", "var(--dmb-accent)");
    pushRaw("--background-color", "transparent");
    text = text.replace(/(--[\w-]+)(\s*:\s*)([^;}"']+)/g, (all, prop, sep, val) => {
      if (CAPTURE_THEME_MAP.some((m) => m.key === prop)) return all; // pass 1 owns these
      const v = val.trim();
      for (const r of rawRoles) {
        if (r[1] && r[0] !== undefined && v === String(r[0]).trim()) return prop + sep + r[1];
      }
      return all;
    });

    // 4. Fonts. The platform's theme fonts map by which slot they filled;
    //    any other literal family is the original store's brand font from
    //    override CSS — retheme it like the colors (icon fonts excepted).
    if (roles.headFont || roles.bodyFont) {
      const mapFont = (val, headingish) => {
        if (/var\(|inherit|initial|unset/i.test(val)) return null;
        const fam = firstFontFamily(val);
        if (!fam || /icon|awesome|material|glyph|emoji|monospace/i.test(fam)) return null;
        if (fam === roles.headFont) return "var(--dmb-heading-font)";
        if (fam === roles.bodyFont) return "var(--dmb-font)";
        return headingish ? "var(--dmb-heading-font)" : "var(--dmb-font)";
      };
      const rewriteDecl = (m, p, v, headingish) => {
        const t = mapFont(v, headingish);
        return t ? p + t + (/!important/i.test(v) ? " !important" : "") : m;
      };
      if (isCss) {
        text = text.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, body) => {
          if (/@font-face/i.test(sel)) return all; // faces must keep their name
          const headingish = /head|title|h[1-6]/i.test(sel);
          return sel + "{" +
            body.replace(/(font-family\s*:\s*)([^;}]+)/gi, (m, p, v) => rewriteDecl(m, p, v, headingish)) +
            "}";
        });
      } else {
        // Serialized inline styles quote families with entities, and `&quot;`
        // ends in a `;` — treat the entity as one token or the value is cut
        // to `&quot` and the family text is left stranded after the rewrite.
        text = text.replace(/(font-family\s*:\s*)((?:&quot;|&#0?3[49];|&apos;|[^;"])+)/gi,
          (m, p, v) => rewriteDecl(m, p, v, false));
      }
    }
    return text;
  }

  /* Which role a palette constant plays, inferred from how the captured CSS
   * *uses* it: `color: var(--x)` makes --x a foreground, `background: var(--x)` a
   * background. Usage is the only signal available — the declaration itself is
   * just a name and a hex — and a constant used both ways, or never used, is
   * deliberately left alone. A reference from inside another custom property is
   * an alias (component vars routinely just forward a palette constant), so
   * roles propagate along those edges to a fixpoint. */
  function captureVarRoles(blobs) {
    const use = new Map();   // --name -> {fg, bg, text}
    const alias = new Map(); // --owner -> Set(--name it forwards)
    const bump = (name, key, n) => {
      const e = use.get(name) || { fg: 0, bg: 0, text: 0 };
      e[key] += n;
      use.set(name, e);
    };
    for (const blob of blobs) {
      const re = /(^|[;{}"'\s])(--[\w-]+|[a-zA-Z][a-zA-Z-]*)\s*:\s*([^;}"']+)/g;
      let m;
      while ((m = re.exec(blob))) {
        const prop = m[2];
        const refs = m[3].match(/var\(\s*--[\w-]+/g);
        if (!refs) continue;
        const isFg = CAPTURE_FG_PROP_RE.test(prop) && !CAPTURE_NO_ANCHOR_RE.test(prop);
        const isBg = CAPTURE_BG_PROP_RE.test(prop);
        for (const ref of refs) {
          const name = ref.replace(/^var\(\s*/, "");
          if (isFg) {
            bump(name, "fg", 1);
            if (CAPTURE_TEXT_PROP_RE.test(prop)) bump(name, "text", 1);
          } else if (isBg) {
            bump(name, "bg", 1);
          } else if (prop.startsWith("--")) {
            if (!alias.has(prop)) alias.set(prop, new Set());
            alias.get(prop).add(name);
          }
        }
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      for (const entry of alias) {
        const e = use.get(entry[0]);
        if (!e) continue;
        for (const name of entry[1]) {
          bump(name, "fg", e.fg); bump(name, "bg", e.bg); bump(name, "text", e.text);
        }
      }
    }
    const roles = new Map();
    for (const entry of use) {
      const e = entry[1];
      if (e.fg && !e.bg) roles.set(entry[0], e.text ? "text" : "fg");
    }
    return roles;
  }

  /* Second rewrite pass over one blob, run after rewriteCaptureTheme: everything
   * the theme bridge could not attribute to a role is still literal, and the
   * subset of that which paints text has to follow the host page (see
   * anchorFgColor). Kept separate from the theme rewrite so that stays a pure
   * by-name/by-role mapping, testable on its own. `anchor` is null for a capture
   * whose source background could not be read, which leaves the blob untouched. */
  function anchorCaptureColors(text, anchor, varRoles, isCss) {
    if (!anchor) return text;
    const noRoles = { bg: [], text: [], accent: [], stars: [], starsDistinct: false };
    const anchored = (val, isText) => /var\(\s*--dmb-/.test(val)
      ? val // already host-anchored by the theme bridge
      : mapCaptureValue(val, noRoles, false, anchor, isText);

    text = text.replace(/([;{"']\s*|^\s*)([a-zA-Z][a-zA-Z-]*)(\s*:\s*)([^;}"']+)/g,
      (all, pre, prop, sep, val) => {
        if (!CAPTURE_FG_PROP_RE.test(prop) || CAPTURE_NO_ANCHOR_RE.test(prop)) return all;
        return pre + prop + sep + anchored(val, CAPTURE_TEXT_PROP_RE.test(prop));
      });

    if (varRoles) {
      text = text.replace(/(--[\w-]+)(\s*:\s*)([^;}"']+)/g, (all, prop, sep, val) => {
        const role = varRoles.get(prop);
        return role ? prop + sep + anchored(val, role === "text") : all;
      });
    }

    // Bare SVG presentation attributes sit outside any declaration.
    if (!isCss) {
      text = text.replace(/\b(fill|stroke)="([^"]+)"/g,
        (m, attr, v) => attr + '="' + anchored(v, true) + '"');
    }
    return text;
  }

  /* The background the widget was captured against — the polarity every
   * strength in anchorFgColor is measured from. First opaque background at or
   * above the widget root; a shell that declares none is a white page. */
  function captureSourceBg(win, root) {
    for (let el = root; el; el = el.parentElement) {
      const c = parseAnyColor(win.getComputedStyle(el).backgroundColor);
      if (c && c[3] >= 0.5) return c;
    }
    return [255, 255, 255, 1];
  }

  let captureRun = null; // {frame, ivs: [intervalIds], cancelled}

  /* Cancelling must *settle* the pending capture, not just stop its timers:
   * clearing the poll interval means the run.cancelled check inside it never
   * gets to fire, so the promise would hang forever and the dialog's Import
   * button — disabled until its await returns — stayed dead until a reload. */
  function abortCapture() {
    if (!captureRun) return;
    const run = captureRun;
    captureRun = null;
    run.cancelled = true;
    run.ivs.forEach(clearInterval);
    run.frame.remove();
    run.aborters.forEach((reject) => reject(new Error("Import cancelled")));
  }

  /* Generic mount containers: the platform *fills* these, so the widget itself
   * is the single child and unwrapping gets us the element the widget's own CSS
   * is written against (Yotpo reviews). */
  const CAPTURE_MOUNT_SELECTORS = [".yotpo-widget-instance", "[data-yotpo-instance-id]"];
  /* Rendered widget roots: the element whose own class names the widget. The
   * loyalty family (referral-share, spotlight…) *replaces* its mount with one
   * of these, so once it has rendered no mount selector matches anything at all
   * and only the generic descent was left — which walks straight past the root
   * into the first branching container, dropping the class the widget's CSS is
   * scoped to. Matched roots are never unwrapped for that reason. Ancestors
   * come first in document order, so the outermost `yotpo-widget-*` wins. */
  const CAPTURE_ROOT_SELECTORS = ['[class*="yotpo-widget-"]'];

  /* Walk down from body to the element that *is* the widget: prefer known
   * platform mounts, then a rendered widget root, else descend through
   * single-child wrappers. */
  function findCaptureRoot(doc) {
    for (const sel of CAPTURE_MOUNT_SELECTORS) {
      const mount = doc.querySelector(sel);
      if (mount && mount.firstElementChild) {
        return mount.children.length === 1 ? mount.firstElementChild : mount;
      }
    }
    for (const sel of CAPTURE_ROOT_SELECTORS) {
      const root = doc.querySelector(sel);
      if (root && root.firstElementChild) return root;
    }
    // Generic previews: skip fixed/hidden chrome, follow the dominant child.
    const significant = (el) => {
      const cs = doc.defaultView.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return false;
      const r = el.getBoundingClientRect();
      return r.height >= 60 && r.width >= 200;
    };
    let node = doc.body;
    for (let depth = 0; depth < 8; depth++) {
      const kids = Array.from(node.children).filter(significant);
      if (kids.length !== 1) break;
      node = kids[0];
    }
    return node === doc.body ? null : node;
  }

  /* Cheap "is this actually rendered?" measure of a candidate root. Used both
   * to decide when the render has settled and to reject a capture that would
   * store an empty shell. Calibrated on the Yotpo reviews widget, where the
   * two states are far apart: rendered = 767 elements / 2584 chars of text,
   * un-populated shell = 36 elements / 81 chars. */
  function captureMetrics(root) {
    if (!root) return { len: 0, els: 0, txt: 0, imgs: 0 };
    return {
      len: root.outerHTML.length,
      els: root.querySelectorAll("*").length,
      txt: root.textContent.replace(/\s+/g, " ").trim().length,
      imgs: root.querySelectorAll("img, picture, video").length,
    };
  }

  /* A widget that mounted but never got its data renders a small skeleton, and
   * saving that is the one genuinely bad outcome of an import — it looks like
   * a success and fails silently in front of a client. Text is the strongest
   * signal; images and sheer element count cover image-led widgets that carry
   * little copy.
   *
   * Element count is only a floor against a lone stray node, never the test:
   * a fully rendered loyalty/referral card is *smaller* than the reviews
   * skeleton this bar exists to reject. Measured — Yotpo referral-share 1183441
   * rendered: 17 elements / 165 chars; reviews 1004109 skeleton: 36 elements /
   * 81 chars (§8 #12). The two are only separable by text density, so an
   * els >= 25 gate rejected the good compact widget and passed neither. */
  function looksRendered(m) {
    return m.els >= 8 && (m.txt >= 120 || m.imgs >= 2 || m.els >= 120);
  }

  /* Resolves with {root, metrics} once the render has settled. Rejects with
   * err.retryable when nothing usable appeared — the loader chain occasionally
   * fetches but never executes, which a fresh load fixes. */
  function waitForRender(frame, run, onStatus, patient) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      let sig = "";
      let lastChange = Date.now();
      let firstContent = 0;
      let announced = 0;
      const iv = setInterval(() => {
        if (run.cancelled) { clearInterval(iv); reject(new Error("Import cancelled")); return; }
        let root = null;
        try { root = frame.contentDocument && findCaptureRoot(frame.contentDocument); } catch (err) { /* navigating */ }
        const m = captureMetrics(root);
        const now = Date.now();
        const nextSig = m.len + "/" + m.els + "/" + m.txt;
        if (nextSig !== sig) { sig = nextSig; lastChange = now; }
        if (root && !firstContent) firstContent = now;

        const ready = looksRendered(m);
        if (root && announced < 1) { announced = 1; onStatus("Widget found — waiting for it to render…"); }
        if (ready && announced < 2) { announced = 2; onStatus("Content loaded — waiting for it to settle…"); }

        // Settle only on a state that looks rendered: the skeleton can sit
        // unchanged for longer than the quiet window while data is in flight.
        if (ready && now - firstContent >= CAPTURE_MIN_WAIT_MS && now - lastChange >= CAPTURE_QUIET_MS) {
          clearInterval(iv);
          resolve({ root: root, metrics: m });
          return;
        }
        // Stuck: document finished and nothing has changed for a while, with
        // still no real content. Retry on a fresh frame instead of sitting out
        // the whole timeout (the last attempt stays patient and does wait).
        if (!patient && !ready && now - t0 > CAPTURE_DEAD_MS && now - lastChange > CAPTURE_DEAD_MS) {
          let done = false;
          try { done = frame.contentDocument && frame.contentDocument.readyState === "complete"; } catch (err) { /* navigating */ }
          if (done) {
            clearInterval(iv);
            const dead = new Error(root
              ? "The widget mounted but never loaded its content."
              : "The preview page loaded but the widget never started rendering.");
            dead.retryable = true;
            reject(dead);
            return;
          }
        }
        if (now - t0 > CAPTURE_TIMEOUT_MS) {
          clearInterval(iv);
          if (ready) { resolve({ root: root, metrics: m }); return; }
          const err = new Error(root
            ? "Nothing that looks like a rendered widget appeared. If this is a widget preview link, it mounted but never loaded its content — open it in a browser tab to check it renders there."
            : "The page loaded but no rendered widget was found. Is this a widget preview link?");
          err.retryable = true;
          reject(err);
        }
      }, CAPTURE_POLL_MS);
      run.ivs.push(iv);
      run.aborters.push((err) => { clearInterval(iv); reject(err); });
    });
  }

  /* Serialize the rendered widget subtree into self-contained static HTML. */
  function snapshotHtml(doc, root, theme) {
    const clone = root.cloneNode(true);
    for (const el of clone.querySelectorAll("script, noscript, style, link, template, iframe")) el.remove();

    const abs = (u) => { try { return new URL(u, doc.baseURI).href; } catch (err) { return u; } };
    for (const el of clone.querySelectorAll("[src]")) {
      const v = el.getAttribute("src");
      if (v && !/^(data:|blob:)/.test(v)) el.setAttribute("src", abs(v));
    }
    for (const el of clone.querySelectorAll("[srcset]")) {
      const v = el.getAttribute("srcset");
      el.setAttribute("srcset", v.split(",").map((part) => {
        const bits = part.trim().split(/\s+/);
        bits[0] = abs(bits[0]);
        return bits.join(" ");
      }).join(", "));
    }
    for (const el of clone.querySelectorAll("[poster]")) el.setAttribute("poster", abs(el.getAttribute("poster")));
    for (const el of clone.querySelectorAll("[loading]")) el.setAttribute("loading", "eager");
    // Links must not navigate the canvas mid-demo (the onclick="return false"
    // pattern hand-written widgets use — WIDGETS.md §4).
    for (const a of clone.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("#")) { a.setAttribute("href", "#"); a.setAttribute("onclick", "return false"); }
    }

    // SVG presentation attributes lose to ANY author CSS rule, so a host-page
    // rule as broad as `path { fill: … }` repaints imported stars and icons
    // (seen on Allbirds: star gradients overridden to brand navy — with
    // !important, so a plain inline style wasn't enough either). Promote
    // gradient references and gradient stops to `!important` inline styles,
    // which nothing in the host sheet can beat. Written as raw attribute text
    // (not via CSSOM) so color values keep their original spelling for the
    // theme-value swap below. Plain literal fills are left alone — if they
    // render on the original preview as attributes, no captured rule targets
    // them, but promoting them could still flip edge cases we can't see.
    for (const el of clone.querySelectorAll("svg, svg *")) {
      for (const attr of ["fill", "stroke", "stop-color"]) {
        const v = el.getAttribute(attr);
        const protect = v && (/url\(|var\(/.test(v) || attr === "stop-color");
        if (protect && !(el.getAttribute("style") || "").includes(attr + ":")) {
          const prev = el.getAttribute("style") || "";
          el.setAttribute("style", (prev && !prev.trim().endsWith(";") ? prev + "; " : prev) +
            attr + ": " + v + " !important;");
        }
      }
    }

    let html = clone.outerHTML.replace(/<!--[\s\S]*?-->/g, "");
    // Rewire the platform theme to our variables: mapped properties by name,
    // literal colors by role — inline style declarations and the !important
    // SVG styles promoted above are all style="…" content, one pass covers
    // them (color-parsing also catches respellings the old find-and-replace
    // missed: CSSOM serializes rgba(255,255,255,1) as rgb(255, 255, 255)).
    html = rewriteCaptureTheme(html, theme, false);
    // Bare SVG presentation attributes sit outside style="…" — same mapping.
    const roles = captureThemeRoles(theme);
    html = html.replace(/\b(fill|stroke|stop-color)="([^"]+)"/g,
      (m, attr, v) => attr + '="' + mapCaptureValue(v, roles, false) + '"');
    return html;
  }

  /* Loyalty/referral widgets declare no CSS custom properties at all — the
   * platform writes literal colors and font names straight into inline styles,
   * so property sampling finds nothing and the whole theme rewrite no-ops
   * (the widget arrives frozen in the *original* store's skin). Their declared
   * theme is still available: the loader keeps a per-instance `customizations`
   * object on the capture frame's window, role-labelled in everything but
   * name. Map the unambiguous roles onto the same keys the property path uses
   * and every by-name/by-role pass downstream works unchanged. Keys not listed
   * here (greys, status colors, form fills, font sizes) stay as captured. */
  const CAPTURE_CONFIG_ROLES = [
    { re: /^(?:background|tile)-color$/,                              key: "--background-color" },
    { re: /^(?:title|description|header)-color$/,                     key: "--text-color" },
    { re: /^(?:primary|secondary)-button-(?:background|text)-color$/, key: "--primary-color" },
    { re: /^stars?-color$/,                                           key: "--stars-color" },
    // "Montserrat@600|https://fonts.googleapis.com/…" — family, weight, URL.
    { re: /^fonts-primary-font-name-and-url$/,   key: "--primary-font-family",   font: true },
    { re: /^fonts-secondary-font-name-and-url$/, key: "--secondary-font-family", font: true },
  ];

  /* The loader's customizations for the instance being captured. Reaching into
   * foreign page objects, so every step is guarded. */
  function captureConfigCustomizations(win, rawUrl) {
    try {
      const guids = win && win.yotpoWidgetsContainer && win.yotpoWidgetsContainer.guids;
      if (!guids) return null;
      let wanted = "";
      try { wanted = new URL(rawUrl).searchParams.get("widget_instance_id") || ""; }
      catch (err) { /* no instance in the URL — take the only one */ }
      const found = [];
      for (const guid of Object.keys(guids)) {
        const widgets = ((guids[guid] || {}).config || {}).widgets || {};
        for (const id of Object.keys(widgets)) {
          const cu = widgets[id] && widgets[id].customizations;
          if (cu && Object.keys(cu).length) found.push([String(id), cu]);
        }
      }
      const hit = found.find((f) => f[0] === wanted) || found[0];
      return hit ? hit[1] : null;
    } catch (err) {
      console.warn("[dmb] import: could not read the loader config", err);
      return null;
    }
  }

  function sampleConfigTheme(win, rawUrl) {
    const cu = captureConfigCustomizations(win, rawUrl);
    const theme = {};
    if (!cu) return theme;
    for (const raw of Object.keys(cu)) {
      const role = CAPTURE_CONFIG_ROLES.find((r) => r.re.test(raw));
      if (!role) continue;
      let v = String(cu[raw] == null ? "" : cu[raw]).trim();
      if (role.font) v = v.split("|")[0].split("@")[0].trim();
      if (!v) continue;
      const list = theme[role.key] || (theme[role.key] = []);
      if (!list.includes(v)) list.push(v);
    }
    return theme;
  }

  /* Read the platform's theme (inline CSS custom properties) off the widget,
   * falling back to the loader config for families that don't declare any. */
  function sampleCaptureTheme(root, win, rawUrl) {
    const els = [root].concat(Array.from(root.querySelectorAll("[style]")));
    const themed = els.find((el) => (el.getAttribute("style") || "").includes("--primary-color")) ||
      els.find((el) => (el.getAttribute("style") || "").includes("--"));
    const theme = {};
    for (const part of ((themed && themed.getAttribute("style")) || "").split(";")) {
      const i = part.indexOf(":");
      if (i > 0) {
        const k = part.slice(0, i).trim();
        if (k.startsWith("--")) theme[k] = part.slice(i + 1).trim();
      }
    }
    return Object.keys(theme).length ? theme : sampleConfigTheme(win, rawUrl);
  }

  /* Corner radius is one of the four things Adapt promises to inherit (§5.3),
   * but platforms bake button shape into their own CSS where no --dmb-*
   * variable reaches — Yotpo's reset even pins `border-radius:0` on every
   * button, so a captured widget keeps square (or 4px, or capsule) corners on
   * a host with pill CTAs. Re-point it for the real CTAs present in the
   * capture: big enough not to be an icon, and a length rather than a % (which
   * means a circle we must not turn into a rounded box). Every btn/button
   * class of the element goes into one compound selector so the rule out-
   * specifies the platform's own `.widget .yotpo-rounded-btn-type` rules; it
   * is appended last so equal-specificity ties fall our way too.
   *
   * Class-based selectors additionally get `!important`, because compounding
   * classes is not always enough: Yotpo's reset pins the review-form CTA from
   * `#yotpo-reviews-main-widget .yotpo-new-review-btn`, and an id outweighs any
   * number of classes — the button stayed square on a 24px-radius host. It is
   * safe here because the selector named a real CTA in this capture. The
   * tag-name fallback (a classless button) stays non-important on purpose: it
   * is broad enough to catch chips and pickers whose own shape is part of the
   * widget's internal hierarchy (§9), and it already wins where nothing else
   * sets a radius. */
  const CAPTURE_BTN_SELECTOR = 'button, input[type="submit"], [role="button"], [class*="btn" i]';

  function captureRadiusRule(win, root) {
    const sels = [];
    const tags = [];
    for (const el of root.querySelectorAll(CAPTURE_BTN_SELECTOR)) {
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 26) continue;
      if (win.getComputedStyle(el).borderRadius.includes("%")) continue;
      const classes = (el.getAttribute("class") || "").split(/\s+/)
        .filter((c) => c && /btn|button/i.test(c));
      const list = classes.length ? sels : tags;
      const sel = classes.length ? "." + classes.join(".") : el.tagName.toLowerCase();
      if (!list.includes(sel)) list.push(sel);
    }
    const rules = [];
    if (sels.length) {
      rules.push(sels.join(",\n") + " {\n  border-radius: var(--dmb-radius) !important;\n}");
    }
    if (tags.length) {
      rules.push(tags.join(",\n") + " {\n  border-radius: var(--dmb-radius);\n}");
    }
    return rules.length ? rules.join("\n\n") : null;
  }

  /* A store's per-instance CSS routinely pins an opaque background on an inner
   * card — `.yotpo-paragraph-summary { background: #F5F2ED }` for the AI review
   * summary — in a color that is *not* part of the declared theme. The theme
   * bridge leaves it alone, correctly (§9: greys, artwork and hierarchy colors
   * stay as captured). But the text on that card usually *is* themed
   * (`color: var(--text-color)` → `--dmb-text`), so the legibility pair splits:
   * dropped on a dark store the text goes white on a frozen cream card, i.e.
   * invisible (§8 #14). The background swatch can't rescue it either — that
   * paints the wrapper, not a card three levels in.
   *
   * A frozen surface needs frozen-legible text, so re-declare the text role on
   * the card itself, computed against that background. It inherits through the
   * card's subtree while everything outside keeps adapting, and it survives
   * Revert. Only elements that actually carry text qualify, and a nested
   * element repeating the color it already sits on is skipped.
   *
   * Overriding `--dmb-text` alone is NOT enough: `var()` in a custom-property
   * value resolves at the element the *declaration* sits on, so the root bridge
   * rule's `--text-color: var(--dmb-text)` computes to the host color there and
   * inherits that literal down. Every property bridged to the text role has to
   * be re-declared here too, so it re-evaluates against the local value. */
  const CAPTURE_FIXED_BG_MAX = 40;

  /* Custom properties the rewrite pointed at the text role, read back off the
   * finished markup/CSS so this stays platform-agnostic (--text-color, whatever
   * per-component vars pass 3 caught, and whatever anchorCaptureColors
   * re-pointed). The whole value is kept, not just the property name: an
   * anchored secondary grey is a color-mix() at its own strength, and
   * re-declaring it as a bare var(--dmb-text) would promote it to body copy. */
  function captureTextRoleProps(blobs) {
    const props = new Map();
    for (const blob of blobs) {
      blob.replace(/(--[\w-]+)\s*:\s*([^;}"']*var\(\s*--dmb-text\s*\)[^;}"']*)/g, (m, p, v) => {
        if (!props.has(p)) props.set(p, v.trim());
        return m;
      });
    }
    return Array.from(props, (e) => ({ prop: e[0], value: e[1] }));
  }

  function captureFixedBgRules(win, root, theme, textProps) {
    const roles = captureThemeRoles(theme);
    // Theme colors are already remapped (to transparent / accent / …) — only a
    // color the bridge left as a literal is actually frozen.
    const isThemeColor = (c) => hitsRole(roles.bg, c) || hitsRole(roles.text, c) ||
      hitsRole(roles.accent, c) || hitsRole(roles.stars, c);
    const rules = [];
    const seen = new Set();
    let capped = 0;

    /* Blend-toggle companions (.dmb-flat on the instance wrapper, §5.9): a
     * *subtle* frozen surface — achromatic, close to the source page's own
     * background, no artwork — can optionally dissolve into the host instead
     * of staying frozen: its background becomes the same page-relative tint
     * it was at the source (a 5%-of-text mix; a surface that matched the page
     * becomes transparent), and the pinned text on it is released back to the
     * theme (`--dmb-text: inherit` — the pin rule's `color: var(--dmb-text)`
     * then re-evaluates against the host value, so black-pinned text on a
     * white box turns store-white the moment the box goes). Surface and text
     * flip together or not at all — releasing one without the other is
     * exactly the illegibility §8 #14/#19 fixed. Statement surfaces (high
     * contrast or chromatic) never blend; their pins stand in both states. */
    const flatRules = [];
    const flatSeen = new Set();
    const srcBg = captureSourceBg(win, root);
    const srcLum = luminance({ r: srcBg[0], g: srcBg[1], b: srcBg[2] });
    const flattenValue = (el, c) => {
      if (colorSaturation(c) > CAPTURE_ANCHOR_SAT) return null; // a hue is brand, not surface
      if (win.getComputedStyle(el).backgroundImage !== "none") return null; // artwork
      const diff = Math.abs(luminance({ r: c[0], g: c[1], b: c[2] }) - srcLum);
      if (diff >= 0.25) return null; // statement panel — stays frozen
      const pct = Math.round(diff * 20) * 5; // 5% steps, like anchorFgColor
      return pct <= 0 ? "transparent"
        : "color-mix(in srgb, var(--dmb-text) " + pct + "%, transparent)";
    };
    const pushFlat = (sel, decls) => {
      if (flatSeen.has(sel)) return;
      flatSeen.add(sel);
      flatRules.push(".dmb-module.dmb-flat " + sel + " {\n" + decls.join("\n") + "\n}");
    };
    // Merchant sheets pin surface backgrounds from id-weighted, !important
    // selectors (`#yotpo-reviews-main-widget #yotpo-main-widget-btn.…`) — the
    // background edition of §8 #17's specificity fight, and ids beat any
    // number of classes. Anchor the blend selector to the ids the capture
    // actually has (the element's own, plus the nearest ancestor's) so it
    // fights with the same weapons; class count then breaks the tie our way.
    // "null"/"undefined" are junk-value template artifacts (Yotpo really ships
    // a wrapper with id="null") — skip them so the anchor is a meaningful id.
    const idSafe = (v) =>
      (v && /^[A-Za-z][\w-]*$/.test(v) && v !== "null" && v !== "undefined" ? v : null);
    const flatSelector = (el, classSel) => {
      const own = idSafe(el.getAttribute("id"));
      let sel = (own ? "#" + own : "") + classSel;
      // Bounded to the capture root: an id above it belongs to the preview
      // shell, doesn't exist in the snapshot, and would leave the rule
      // silently matching nothing.
      for (let a = el.parentElement; a && root.contains(a); a = a.parentElement) {
        const aid = idSafe(a.getAttribute("id"));
        if (aid) { sel = "#" + aid + " " + sel; break; }
      }
      return sel;
    };

    const walk = (el, frozen, needsRule, surfaceEl) => {
      const own = parseAnyColor(win.getComputedStyle(el).backgroundColor);
      if (own && own[3] >= 0.9 && !isThemeColor(own) && !sameColor(own, frozen)) {
        frozen = own;
        needsRule = true;
        surfaceEl = el;
      }
      const classes = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
      // A classless card can't be targeted; carry the rule down to the first
      // classed, text-bearing descendant instead of dropping it.
      if (needsRule && classes.length && el.textContent.trim()) {
        let sel = "." + classes.join(".");
        /* Component classes arrive with BEM state/position modifiers
         * (`.yotpo-simple-tooltip.yotpo-simple-tooltip--right`) that differ
         * between instances of the same component, so the full-class selector
         * bridges the one element we sampled and misses its siblings. Drop
         * modifiers whose base class is also present — but only once the DOM
         * confirms every element the shorter selector reaches carries the same
         * frozen background, so a `--dark` variant of an otherwise transparent
         * card can't drag its siblings' text color with it. */
        const base = classes.filter((c) => {
          const cut = c.indexOf("--");
          return cut <= 0 || classes.indexOf(c.slice(0, cut)) < 0;
        });
        if (base.length && base.length < classes.length) {
          const short = "." + base.join(".");
          let uniform = true;
          try {
            for (const other of root.querySelectorAll(short)) {
              if (!sameColor(parseAnyColor(win.getComputedStyle(other).backgroundColor), frozen)) {
                uniform = false;
                break;
              }
            }
          } catch (err) { uniform = false; }
          if (uniform) sel = short;
        }
        const light = luminance({ r: frozen[0], g: frozen[1], b: frozen[2] }) > 0.5;
        const key = sel + "|" + light;
        needsRule = false;
        if (!seen.has(key)) {
          seen.add(key);
          if (rules.length < CAPTURE_FIXED_BG_MAX) {
            const value = light ? "#1f2430" : "#f4f5f7";
            // `color` itself is re-declared alongside the variables: text with
            // no color rule of its own inherits the *resolved* color from
            // outside the card (the var re-declarations can't reach it —
            // inheritance passes down the computed value, not the var()
            // reference), so a rule-less label stayed host-colored on the
            // frozen surface (§8 #19). Anything inside with its own rule
            // still overrides plain inheritance.
            const decls = ["  --dmb-text: " + value + ";", "  color: var(--dmb-text);"]
              .concat(textProps.map((p) => "  " + p.prop + ": " + p.value + ";"));
            rules.push(sel + " {\n" + decls.join("\n") + "\n}");
            // The blend companion — only when this rule sits on the surface
            // element itself: a classless card pushed its pin down to a
            // descendant, and repainting the descendant would leave the real
            // surface frozen behind it.
            const flat = surfaceEl === el && flattenValue(el, frozen);
            if (flat) {
              // !important: the original background may be pinned from an
              // id-weighted merchant selector or an inline style.
              pushFlat(flatSelector(el, sel), ["  background-color: " + flat + " !important;",
                "  --dmb-text: inherit;"]);
            }
          } else {
            capped++;
          }
        }
      }
      for (const kid of el.children) walk(kid, frozen, needsRule, surfaceEl);
    };
    walk(root, null, false, null);

    /* Floating labels: text absolutely positioned over a surface it is not a
     * DOM descendant of — Yotpo's dropdowns overlay their label on a sibling
     * combobox pill (§8 #19). Background never *inherits* into an overlay, so
     * the tree walk above structurally can't see the pair; the only truth is
     * the rendering, so hit-test the frame under each positioned text element
     * (the caller stretches the capture frame to full content height first —
     * elementsFromPoint answers only inside the frame's own viewport). Only
     * elements carrying a direct text node qualify; anything deeper resolves
     * through its own rules against the surface's rule from the walk. */
    const doc = root.ownerDocument;
    if (doc.elementsFromPoint) {
      for (const el of root.querySelectorAll("*")) {
        const classes = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
        if (!classes.length) continue;
        const pos = win.getComputedStyle(el).position;
        if (pos !== "absolute" && pos !== "fixed") continue;
        if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        const stack = doc.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        // Everything under the label at that point (the label and its children
        // may be missing from the stack entirely — pointer-events: none).
        const idx = stack.indexOf(el);
        const below = (idx >= 0 ? stack.slice(idx + 1) : stack)
          .filter((u) => u !== el && !el.contains(u));
        const surface = below.find((u) => {
          const c = parseAnyColor(win.getComputedStyle(u).backgroundColor);
          return c && c[3] >= 0.9;
        });
        // An ancestor backdrop is the walk's job (rules inherit into el).
        if (!surface || surface.contains(el)) continue;
        const c = parseAnyColor(win.getComputedStyle(surface).backgroundColor);
        if (isThemeColor(c)) continue; // the surface adapts — leave the label themed
        const light = luminance({ r: c[0], g: c[1], b: c[2] }) > 0.5;
        const sel = "." + classes.join(".");
        // First observation wins — don't emit a conflicting polarity for the
        // same selector.
        if (seen.has(sel + "|" + light) || seen.has(sel + "|" + !light)) continue;
        seen.add(sel + "|" + light);
        if (rules.length < CAPTURE_FIXED_BG_MAX) {
          const value = light ? "#1f2430" : "#f4f5f7";
          const decls = ["  --dmb-text: " + value + ";", "  color: var(--dmb-text);"]
            .concat(textProps.map((p) => "  " + p.prop + ": " + p.value + ";"));
          rules.push(sel + " {\n" + decls.join("\n") + "\n}");
          // Blend companions, as a pair or not at all: the label may only be
          // released back to the theme if its surface actually dissolves —
          // and the surface may not have been seen by the tree walk (it can
          // be textless), so it gets its own blend rule here. A classless or
          // unblendable surface keeps the label pinned in both states.
          const flat = flattenValue(surface, c);
          const surfClasses = (surface.getAttribute("class") || "").split(/\s+/).filter(Boolean);
          if (flat && surfClasses.length) {
            pushFlat(flatSelector(surface, "." + surfClasses.join(".")),
              ["  background-color: " + flat + " !important;", "  --dmb-text: inherit;"]);
            pushFlat(sel, ["  --dmb-text: inherit;"]);
          }
        } else {
          capped++;
        }
      }
    }

    if (capped) {
      console.warn("[dmb] import: " + capped + " more fixed-background element(s) " +
        "left un-bridged (cap " + CAPTURE_FIXED_BG_MAX + ") — text on them may not " +
        "adapt to a dark host page");
    }
    return rules.concat(flatRules);
  }

  /* A merchant-authored override sheet can ship an unbalanced block: a real one
   * on a live instance opens `@media screen and (max-width:465px){` and never
   * closes it. Inside its own <style> element that is harmless — the CSS parser
   * closes every open block at EOF. Concatenated with the rules the importer
   * appends it is fatal: the bridge rule, the fixed-background rules and the
   * radius rule all land *inside* the unclosed block, so they never reach the
   * CSSOM and the widget silently stops adapting (§8 #16). Close what the
   * author left open, exactly as the parser would. */
  function balanceCss(text) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        i = end < 0 ? text.length : end + 1;
      } else if (ch === '"' || ch === "'") {
        for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth = Math.max(0, depth - 1); // a stray } must not mask a later open block
      }
    }
    return depth ? text + "\n" + "}".repeat(depth) : text;
  }

  /* Keep only the <style> blocks with at least one rule that matches the
   * widget subtree. Sheets holding only @font-face/@keyframes are kept —
   * they can't "match" but the widget's rules may depend on them. */
  function collectSubtreeCss(doc, root) {
    const matchesSubtree = (sel) => {
      const clean = sel.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "").trim();
      if (!clean) return true; // selector was all pseudo — keep, cheap
      try { return root.matches(clean) || !!root.querySelector(clean); }
      catch (err) { return true; } // unparseable after cleaning — keep, safe side
    };
    const ruleMatches = (rule) => {
      if (rule.selectorText) return rule.selectorText.split(",").some(matchesSubtree);
      if (rule.cssRules) return Array.from(rule.cssRules).some(ruleMatches); // @media etc.
      return false;
    };
    const chunks = [];
    for (const st of doc.querySelectorAll("style")) {
      let rules = null;
      try { rules = st.sheet && st.sheet.cssRules; } catch (err) { /* unreadable */ }
      if (!rules || !rules.length) continue;
      const arr = Array.from(rules);
      const anchored = arr.filter((r) => r.selectorText || r.cssRules);
      const keep = anchored.length ? anchored.some(ruleMatches) : true;
      if (keep) chunks.push(st.textContent.trim());
    }
    return chunks;
  }

  /* Cross-origin <link> stylesheets (per-instance CSS overrides live there on
   * Yotpo previews) can't be read via cssRules — fetch them through /proxy. */
  async function collectLinkedCss(doc) {
    const out = [];
    for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      let readable = false;
      try { readable = !!(link.sheet && link.sheet.cssRules); } catch (err) { /* cross-origin */ }
      if (readable) continue; // inline <style> pass already covers same-origin CSS
      const href = link.href;
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(href)) continue; // shell chrome font
      try {
        const resp = await fetch("/proxy?url=" + encodeURIComponent(href));
        if (resp.ok) {
          const text = await resp.text();
          if (text.length < 400000) out.push("/* from " + href + " */\n" + text.trim());
        }
      } catch (err) { console.warn("[dmb] import: could not fetch stylesheet", href, err); }
    }
    return out;
  }

  function suggestCaptureMeta(root, rawUrl) {
    let host = "preview";
    let instance = "";
    try {
      const u = new URL(rawUrl);
      host = u.hostname;
      instance = u.searchParams.get("widget_instance_id") || "";
    } catch (err) { /* keep defaults */ }
    const cls = (root.getAttribute("class") || "").split(/\s+/)[0] || root.tagName.toLowerCase();
    const words = cls.replace(/[-_]+/g, " ")
      .replace(/\b(widget|instance|container|wrapper|main)\b/gi, " ")
      .replace(/\s+/g, " ").trim() || "imported widget";
    const name = words.replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      name: name,
      id: slugifyModuleId(name + (instance ? "-" + instance : "")),
      desc: "Imported from " + host + (instance ? " · instance " + instance : ""),
    };
  }

  /* One load attempt. Rejects with err.retryable when the render never
   * produced usable content — captureFromPreview then tries a fresh frame. */
  async function captureAttempt(url, qs, onStatus, patient) {
    const frame = document.createElement("iframe");
    frame.className = "dmb-capture-frame";
    // Deliberately NOT sandboxed, unlike the canvas: an import only works if
    // the platform's loader actually runs (&scripts=1 is not optional here),
    // and reading the rendered result back needs same-origin. Those two
    // together are precisely the combination that has no sandbox. What limits
    // the exposure is that this frame is short-lived, points at a URL the rep
    // typed themselves, and is torn down by abortCapture() — not the sandbox.
    //
    // The canvas renders desktop pages at DESKTOP_W, so capture at the same
    // width — the widget's own breakpoint classes are baked into the snapshot.
    frame.style.width = (/is-mobile=true/i.test(qs) ? MOBILE_W : DESKTOP_W) + "px";
    frame.src = "/proxy?url=" + encodeURIComponent(url) +
      "&scripts=1&dmb-capture=1" + (qs ? "&" + qs : "");
    document.body.appendChild(frame);

    const run = { frame: frame, ivs: [], aborters: [], cancelled: false };
    captureRun = run;
    // Fallback for a server without the &dmb-capture bootstrap: same intent,
    // but it can lose the race, so the content check below is what guarantees
    // we never save a skeleton.
    run.ivs.push(setInterval(() => {
      try {
        frame.contentDocument &&
          frame.contentDocument.querySelectorAll(".yotpo-widget-instance:not([mode-preview])")
            .forEach((el) => el.setAttribute("mode-preview", "true"));
      } catch (err) { /* frame navigating */ }
    }, 100));

    try {
      onStatus("Loading the preview page…");
      const settled = await waitForRender(frame, run, onStatus, patient);
      const root = settled.root;
      onStatus("Capturing markup & styles…");
      const doc = frame.contentDocument;
      const theme = sampleCaptureTheme(root, frame.contentWindow, url);
      // Site-imagery slots (§5.11), measured HERE and not at insert time: this
      // frame is the widget's own controlled 1280px layout, before any host
      // CSS exists to distort it. Stamping the live DOM (data-dmb-slot="N")
      // rather than the clone is what carries the addressing into the
      // snapshot — snapshotHtml clones immediately below. The frame is thrown
      // away moments later, so mutating it costs nothing.
      const slots = window.IMAGERY ? IMAGERY.stampSlots(frame.contentWindow, root) : [];
      let html = snapshotHtml(doc, root, theme);
      // The captured CSS gets the same theme rewrite as the markup — this is
      // where store-authored override sheets (literal colors/fonts spelled
      // their own way) are bridged to --dmb-* (§8 #10). Before the bridge
      // rule below, which re-declares theme constants that must stay verbatim.
      let cssChunks = collectSubtreeCss(doc, root).concat(await collectLinkedCss(doc))
        .map((c) => rewriteCaptureTheme(balanceCss(c), theme, true));
      if (run.cancelled) throw new Error("Import cancelled");

      // Bridge rule: re-declare the theme on the widget root so anything the
      // literal swap missed still follows Adapt/Revert; carry the platform's
      // own palette constants (--yotpo-* and friends) so unmapped references
      // keep resolving. scopeModuleCss prefixes this with .dmb-module later.
      const rootSel = "." + ((root.getAttribute("class") || "").split(/\s+/)[0] || "").trim();
      if (rootSel !== ".") {
        const mapped = CAPTURE_THEME_MAP
          .filter((m) => theme[m.key] !== undefined)
          .map((m) => "  " + m.key + ": " + m.to + ";");
        const constants = Object.keys(theme)
          .filter((k) => !CAPTURE_THEME_MAP.some((m) => m.key === k))
          .map((k) => "  " + k + ": " + themeValues(theme[k])[0] + ";");
        // A platform with no theme at all (§5.9) sampled nothing — skip the
        // rule rather than emit an empty one.
        const decls = mapped.concat(constants);
        if (decls.length) cssChunks.push(rootSel + " {\n" + decls.join("\n") + "\n}");
      }

      // Everything the theme bridge could not attribute to a role is still a
      // literal from the source page. Re-point the part of it that paints text
      // at --dmb-text, at the strength it had there (§8 #15). Runs over the
      // bridge rule too — that carries the platform's palette constants — but
      // before the two rules below, which are ours and already host-anchored.
      const srcBg = captureSourceBg(frame.contentWindow, root);
      const anchor = { dark: luminance({ r: srcBg[0], g: srcBg[1], b: srcBg[2] }) < 0.5 };
      const varRoles = captureVarRoles(cssChunks.concat(html));
      cssChunks = cssChunks.map((c) => anchorCaptureColors(c, anchor, varRoles, true));
      html = anchorCaptureColors(html, anchor, varRoles, false);

      // Re-legibilize text sitting on backgrounds the theme bridge froze. Runs
      // after the rewrite, because which properties carry the text role is read
      // back off the finished markup/CSS (§8 #14). The pass hit-tests floating
      // labels, and elementsFromPoint answers only inside the frame's own
      // viewport — stretch the frame to the full rendered height first (the
      // stock 1600px covers a fraction of a reviews widget).
      try {
        frame.style.height = frame.contentDocument.documentElement.scrollHeight + "px";
      } catch (err) { /* navigating — the pass degrades to the tree walk */ }
      captureFixedBgRules(frame.contentWindow, root, theme,
        captureTextRoleProps(cssChunks.concat(html)))
        .forEach((rule) => cssChunks.push(rule));

      const radiusRule = captureRadiusRule(frame.contentWindow, root);
      if (radiusRule) cssChunks.push(radiusRule);

      const meta = suggestCaptureMeta(root, url);
      return {
        id: meta.id,
        name: meta.name,
        desc: meta.desc,
        html: '<div class="dmbm-wrap">' + html + "</div>",
        css: cssChunks.join("\n\n"),
        slots: slots,
        // The link this capture came from, so the widget can be shared on (⤴).
        // Already stripped of our own share parameters by captureFromPreview —
        // widgetShareUrl re-attaches them fresh from the def's own metadata.
        sourceUrl: url,
        metrics: settled.metrics,
      };
    } finally {
      if (captureRun === run) abortCapture();
      else { run.ivs.forEach(clearInterval); frame.remove(); }
    }
  }

  async function captureFromPreview(rawUrl, onStatus) {
    onStatus = onStatus || (() => {});
    // A shared link (⤴) is the original preview link plus our UTM metadata;
    // capture the link without it, so a widget renders identically however it
    // reached the rep and the shared-on link never accumulates parameters.
    const url = stripShareParams(String(rawUrl || "").trim());
    if (!/^https?:\/\//i.test(url)) throw new Error("Paste a full http(s) preview URL");
    abortCapture();

    // The shell page reads guid / widget_instance_id / is-mobile from
    // location.search, so the original query string rides along on the proxy
    // URL as well as inside ?url=.
    const qs = url.split("?").slice(1).join("?");
    let lastErr = null;
    for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
      try {
        return await captureAttempt(url, qs, onStatus, attempt === CAPTURE_ATTEMPTS);
      } catch (err) {
        lastErr = err;
        if (!err.retryable || attempt === CAPTURE_ATTEMPTS) throw err;
        console.warn("[dmb] capture attempt " + attempt + " failed, retrying:", err.message);
        onStatus("The widget didn't finish loading — retrying…");
      }
    }
    throw lastErr;
  }

  /* ============================================ widget editor (＋ / ⧉ / ✎)
   * Authors a gallery widget from pasted HTML/CSS. Widgets created here are
   * kept in the signed-in user's Supabase gallery and re-registered on every
   * load; “Copy as code” emits the registerModule() snippet for
   * public/custom-modules.js, which is how a widget becomes part of the repo
   * rather than one person's library. File-based widgets are code, so they are
   * not editable here — duplicate (⧉) and edit the copy. See WIDGETS.md. */
  // v1 is the library from before the gallery was emptied. The key bump is what
  // gave every browser the blank slate; v2 is now migrated into the account on
  // first sign-in (store.js) rather than read on every load, so neither key is
  // a source of widgets any more. Dropping v1 keeps it from coming back.
  try { localStorage.removeItem("dmb.customWidgets.v1"); } catch (err) { /* private mode */ }

  const STARTER_HTML = `<div class="dmbm-wrap">
  <h2 class="dmbm-h">Section title</h2>
  <div class="dmbm-demo-row">
    <div class="dmbm-card">
      <div class="dmbm-stars">★★★★★</div>
      <p class="dmbm-muted">Short supporting line of copy.</p>
    </div>
    <a class="dmbm-btn" href="#" onclick="return false">Call to action</a>
  </div>
</div>`;

  const STARTER_CSS = `.dmbm-demo-row {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
}
.dmbm-demo-row .dmbm-card { flex: 1; min-width: 240px; }`;

  const wz = {
    overlay: document.getElementById("widget-editor"),
    title: document.getElementById("wz-title"),
    note: document.getElementById("wz-note"),
    name: document.getElementById("wz-name"),
    desc: document.getElementById("wz-desc"),
    id: document.getElementById("wz-id"),
    idNote: document.getElementById("wz-id-note"),
    html: document.getElementById("wz-html"),
    css: document.getElementById("wz-css"),
    // The preview is a polarity pair — the same widget rendered against a
    // light and a dark store (§5.9) so an opposite-polarity legibility bug
    // is visible before Save, not on a client call.
    previews: Array.from(document.querySelectorAll("#wz-preview .wz-pv")).map((box) => ({
      box,
      pol: box.dataset.pol,
      tag: box.querySelector(".wz-pv-tag"),
      wrapper: box.querySelector(".dmb-module"),
    })),
    adapt: document.getElementById("wz-adapt"),
    blend: document.getElementById("wz-blend"),
    blendWrap: document.getElementById("wz-blend-wrap"),
    issues: document.getElementById("wz-issues"),
    save: document.getElementById("wz-save"),
    del: document.getElementById("wz-delete"),
    code: document.getElementById("wz-code"),
    importUrl: document.getElementById("wz-import-url"),
    importBtn: document.getElementById("wz-import-btn"),
    importStatus: document.getElementById("wz-import-status"),
    productWrap: document.getElementById("wz-product"),
  };

  /* Product radios: null while nothing is chosen — the dialog treats that as
   * an error (unlike the registry, which defaults) so every widget added here
   * is filed deliberately. */
  function wzProduct() {
    const r = wz.productWrap.querySelector("input:checked");
    return r ? r.value : null;
  }
  function wzSetProduct(v) {
    for (const r of wz.productWrap.querySelectorAll("input")) r.checked = r.value === v;
  }

  const wzPreviewStyle = document.createElement("style");
  document.head.appendChild(wzPreviewStyle);

  let wzEditing = null;    // def being edited (null while creating)
  let wzIdTouched = false; // the id field stops auto-following the name
  let wzImporting = false; // a capture is in flight; the form is blank for it

  /* The site-imagery slot manifest for the widget being edited (§5.11). It has
   * no form field — it is measured by the capture, not authored — so it rides
   * in a dialog-scoped variable and is folded back in here. Without this,
   * saving an imported widget (or merely renaming one) would drop its
   * manifest and quietly demote it to the weaker live-walk path. */
  let wzSlots = [];

  /* Likewise the capture's source link (used by the gallery's ⤴ share button).
   * It has no form field of its own on purpose: the Import box above holds
   * whatever the rep is *about* to capture, which is not the same thing — a
   * pasted-but-not-imported link must not become the widget's provenance. Only
   * a successful capture writes here. */
  let wzSourceUrl = "";

  function wzValues() {
    return {
      id: wz.id.value.trim(),
      name: wz.name.value.trim(),
      desc: wz.desc.value.trim(),
      html: wz.html.value,
      css: wz.css.value,
      product: wzProduct(),
      slots: wzSlots,
      sourceUrl: wzSourceUrl,
    };
  }

  function wzIssue(cls, text) {
    const d = document.createElement("div");
    d.className = "wz-issue " + cls;
    d.textContent = text;
    wz.issues.appendChild(d);
  }

  /* Sample palettes for the preview pair — the same constants
   * sampleHostStyles falls back to (§5.3), i.e. "an unremarkable store of
   * that polarity". Fonts and radius stay at the stylesheet defaults: the
   * pair exists to check legibility, not typography. */
  const WZ_PREVIEW_PALETTES = {
    light: { text: "#1f2430", accent: "#111111", contrast: "#ffffff" },
    dark: { text: "#f4f5f7", accent: "#f5f6f8", contrast: "#111111" },
  };

  /* Which preview box the sampled host palette belongs in. No pageBg means
   * the sample fell back to white — a light page (§5.3). */
  function wzHostPolarity(host) {
    const bg = parseColor(host.pageBg);
    return bg && luminance(bg) < 0.4 ? "dark" : "light";
  }

  // Re-writing two ~100 KB captures into the DOM on every keystroke of the
  // Name field is wasted work — only touch innerHTML when the markup changed.
  let wzPrevHtml = null;

  function wzRefresh() {
    const def = wzValues();
    // The id auto-fills from the name on save, so don't nag about it here.
    if (!wzEditing && !def.id) def.id = slugifyModuleId(def.name);
    // Preview CSS is scoped to the preview box, not to `.dmb-module` at large,
    // so an in-progress rule can't restyle the gallery thumbnails.
    wzPreviewStyle.textContent = def.css ? scopeModuleCss(def.css, "#wz-preview .dmb-module") : "";
    if (def.html !== wzPrevHtml) {
      for (const pv of wz.previews) pv.wrapper.innerHTML = def.html;
      wzPrevHtml = def.html;
    }
    // The Blend preview only exists where the capture emitted .dmb-flat
    // companions — same test normalizeModuleDef uses for def.flattenable.
    const flattenable = /\.dmb-flat\b/.test(def.css);
    wz.blendWrap.hidden = !flattenable;
    if (!flattenable) wz.blend.checked = false;
    // With "site styling" on, the sampled palette takes over the box matching
    // the host page's polarity (against that page's own background — a dark
    // host palette in a white box would show white-on-white); the other box
    // keeps its sample so the opposite polarity is always in view.
    const host = wz.adapt.checked && state.host ? state.host : null;
    const hostPol = host ? wzHostPolarity(host) : null;
    for (const pv of wz.previews) {
      clearHostVars(pv.wrapper);
      pv.wrapper.classList.toggle("dmb-flat", wz.blend.checked);
      if (pv.pol === hostPol) {
        applyHostVars(pv.wrapper);
        pv.box.style.background = host.pageBg || "";
        pv.tag.textContent = "This page";
      } else {
        const p = WZ_PREVIEW_PALETTES[pv.pol];
        pv.wrapper.style.setProperty("--dmb-text", p.text);
        pv.wrapper.style.setProperty("--dmb-accent", p.accent);
        pv.wrapper.style.setProperty("--dmb-accent-contrast", p.contrast);
        pv.box.style.background = "";
        pv.tag.textContent = pv.pol === "dark" ? "Dark store" : "Light store";
      }
    }

    const res = validateModuleDef(def, { ignoreId: wzEditing ? wzEditing.id : null });
    // Registry-level registration would default a missing product to Reviews;
    // in the dialog the choice is mandatory so nothing gets filed by accident.
    if (!def.product) res.errors.unshift("product is required — choose Reviews or Loyalty above");
    wz.issues.innerHTML = "";
    // An empty form is a starting point, not a mistake: after the starter
    // template is cleared for an import there is nothing to complain about yet,
    // so say what to do instead of listing required fields. A shared link
    // pre-fills the name and product before the capture lands (§5.9), so an
    // import in flight is judged on its markup alone — otherwise those
    // pre-filled fields would summon an "html is required" about a state the
    // user never created, which is exactly what this branch exists to prevent.
    if (!wzEditing && !def.html.trim() && (wzImporting || (!def.name && !def.css.trim()))) {
      wzIssue("", wzImporting
        ? "Importing — the captured widget will land here."
        : "Paste a preview link above to import a widget, or write the HTML yourself.");
      wz.save.disabled = true;
      return;
    }
    res.errors.forEach((e) => wzIssue("err", "✕ " + e));
    res.warnings.forEach((w) => wzIssue("warn", "! " + w));
    if (!res.errors.length && !res.warnings.length && def.html.trim()) {
      wzIssue("ok", "✓ Ready — self-contained, wrapped, and fully themable.");
    }
    wz.save.disabled = res.errors.length > 0;
  }

  function openWidgetEditor(opts) {
    opts = opts || {};
    const src = opts.edit || opts.from || null;
    wzEditing = opts.edit || null;
    wzIdTouched = !!wzEditing;

    wz.title.textContent = wzEditing ? "Edit widget" : "New widget";
    wz.note.textContent = wzEditing
      ? "Saved to your gallery — use “Copy as code” to move it into public/custom-modules.js for everyone"
      : opts.from
        // A widget can carry no CSS of its own (the samples share one sheet
        // attached to the first entry), so say so rather than look broken.
        ? "Copy of “" + opts.from.name + "” — the original stays untouched" +
          ((opts.from.css || "").trim() ? "" : " (it carries no CSS of its own, so the CSS box starts empty)")
        : "";

    wz.name.value = src ? (wzEditing ? src.name : src.name + " copy") : "";
    wz.desc.value = src ? src.desc || "" : "";
    wz.id.value = wzEditing ? src.id : src ? slugifyModuleId(src.id + "-copy") : "";
    wz.id.disabled = !!wzEditing;
    wz.idNote.textContent = wzEditing ? "fixed after the first save" : "auto from name";
    wz.html.value = src ? src.html.trim() : STARTER_HTML;
    wz.css.value = src ? src.css || "" : STARTER_CSS;
    // New widgets start with no product chosen — picking one is required.
    wzSetProduct(src ? src.product : null);
    wz.del.hidden = !wzEditing;
    wz.adapt.checked = !!state.host;
    wz.blend.checked = false;
    // A duplicate (⧉) inherits the original's slot manifest along with its
    // markup — the data-dmb-slot attributes are in the html being copied, so
    // the manifest that addresses them has to come too.
    wzSlots = src && Array.isArray(src.slots) ? src.slots : [];
    // An imported widget opens with its own capture link in the Import box,
    // labelled "Re-capture": it is the only place that link is visible, and
    // re-running it is the whole remedy for a stale or flaky capture (§5.10).
    wzSourceUrl = (src && src.sourceUrl) || "";
    wz.importUrl.value = wzSourceUrl;
    wzImporting = false;
    wzCapturedUrl = wzSourceUrl || null;
    wz.importBtn.disabled = false;
    wzSetImportLabel();
    wzImportStatus("");

    wz.overlay.hidden = false;
    wzRefresh();
    wz.name.focus();
  }

  function closeWidgetEditor() {
    abortCapture(); // a capture in flight dies with the dialog
    wzImportSeq++;  // …and its rejection must not write into the next dialog
    wz.overlay.hidden = true;
    wzPreviewStyle.textContent = "";
    wzEditing = null;
  }

  function wzImportStatus(text, cls) {
    wz.importStatus.hidden = !text;
    wz.importStatus.textContent = text || "";
    wz.importStatus.className = "wz-import-status" + (cls ? " " + cls : "");
  }

  // Starting an import aborts any run still in flight, and the aborted one then
  // rejects — later than the new one started. Sequence-stamp the runs so a
  // superseded attempt can't write status, fields or button state under the
  // live one.
  let wzImportSeq = 0;

  /* After a capture lands, the Import button becomes "Re-capture" while the
   * field still holds the captured link — same handler, honest label: a
   * capture is a frozen snapshot (§5.9), so the fix for a flaky render or a
   * stale look is simply running the same link again. Editing the URL flips
   * it back to "Import". */
  let wzCapturedUrl = null;

  function wzSetImportLabel() {
    const re = !wzImporting && wzCapturedUrl && wz.importUrl.value.trim() === wzCapturedUrl;
    wz.importBtn.textContent = re ? "Re-capture" : "Import";
    wz.importBtn.title = re
      ? "Render the same link again — a fresh capture replaces the fields below"
      : "Render the preview and capture the widget as it looks right now";
  }

  /* The dialog opens prefilled with the starter template, which is scaffolding
   * for hand-writing a widget — the moment an import starts it is not what the
   * user is building. Clear it right away so the preview shows the capture (or
   * nothing) rather than a widget they never authored, which would otherwise sit
   * there looking savable while the import runs. Editing an existing widget is
   * the exception: its own markup stays until the capture actually replaces it. */
  function wzClearFields() {
    wz.name.value = "";
    wz.desc.value = "";
    wz.id.value = "";
    wzIdTouched = false;
    wz.html.value = "";
    wz.css.value = "";
    // The manifest describes markup that is being discarded, so it goes with
    // it — the incoming capture brings its own. Same for the source link: it
    // is the provenance of markup that no longer exists.
    wzSlots = [];
    wzSourceUrl = "";
    // The product choice survives the clear: it classifies the widget being
    // imported, it isn't part of the starter scaffolding being discarded.
    wzRefresh();
  }

  async function wzImport() {
    const url = wz.importUrl.value.trim();
    if (!url) { wz.importUrl.focus(); return; }
    const seq = ++wzImportSeq;
    const stale = () => seq !== wzImportSeq;
    wzImporting = true;
    // A link shared from another rep's gallery (⤴) carries the widget's name,
    // description and product. Fill them in *now*, before the ~4 s capture, so
    // the rep can see they got the intended widget rather than an empty form —
    // and so the derived meta below can't quietly overwrite what was shared.
    const shared = parseWidgetShareUrl(url);
    if (!wzEditing) wzClearFields();
    if (shared && !wzEditing) {
      if (shared.name) { wz.name.value = shared.name; wz.id.value = slugifyModuleId(shared.name); wzIdTouched = false; }
      if (shared.desc) wz.desc.value = shared.desc;
      if (shared.product) wzSetProduct(shared.product);
      wzRefresh();
    }
    wz.importBtn.disabled = true;
    wz.importBtn.textContent = "Importing…";
    wzImportStatus(shared ? "Shared widget details recognized — starting…" : "Starting…");
    try {
      const def = await captureFromPreview(url, (t) => { if (!stale()) wzImportStatus(t); });
      if (stale()) return;
      // Metadata precedence: what a person wrote beats what the capture derived
      // from class names. Editing an existing widget, that's its current name
      // and description (a re-capture refreshes the markup, it doesn't rename
      // the widget); importing a shared link, it's what the link carried.
      const shareName = shared && shared.name;
      wz.name.value = (wzEditing ? wz.name.value : shareName) || def.name;
      wz.desc.value = (wzEditing ? wz.desc.value : shared && shared.desc) || def.desc;
      if (!wzEditing) {
        wz.id.value = shareName ? slugifyModuleId(shareName) : def.id;
        wzIdTouched = false;
        if (shared && shared.product) wzSetProduct(shared.product);
      }
      wz.html.value = def.html;
      wz.css.value = def.css;
      wzSlots = def.slots || [];
      wzSourceUrl = def.sourceUrl || "";
      wzCapturedUrl = url;
      const m = def.metrics || {};
      const fillable = wzSlots.filter((s) => s.fill).length;
      wzImportStatus(
        "✓ Captured " + (m.els || 0) + " elements (" +
        Math.round(def.html.length / 1024) + " KB markup, " +
        Math.round(def.css.length / 1024) + " KB styles" +
        (fillable ? ", " + fillable + " image slots" : "") +
        ")" + (shared ? ", details from the shared link" : "") +
        " — check both previews, rename if you like, then Save.",
        "ok"
      );
      wzRefresh();
    } catch (err) {
      if (!stale() && err && err.message !== "Import cancelled") wzImportStatus("✕ " + err.message, "err");
    } finally {
      if (!stale()) {
        wzImporting = false;
        wz.importBtn.disabled = false;
        wzSetImportLabel();
        wzRefresh();
      }
    }
  }

  function wzSave() {
    const vals = wzValues();
    // The registry would default a missing product; the dialog must not.
    if (!vals.product) { wzRefresh(); return; }
    if (!vals.id) vals.id = slugifyModuleId(vals.name);
    const res = wzEditing ? updateModule(wzEditing.id, vals) : registerModule(vals, "local");
    if (!res.ok) { wzRefresh(); return; } // errors are already listed in the dialog
    saveWidgetRemote(res.def);
    // Instances already on the page share the def object — re-render them.
    // The id (and with it the scope class the instance's CSS is keyed on)
    // can be edited, so re-stamp the wrapper class too.
    if (wzEditing) {
      for (const d of state.demos) if (d.def === res.def) {
        d.el.innerHTML = res.def.html;
        d.el.className = "dmb-module " + res.def.scopeClass + (d.flat ? " dmb-flat" : "");
        // The innerHTML write replaced the nodes an imagery swap was applied
        // to, along with the originals recorded on them — re-run it against
        // the new markup so the toggle keeps telling the truth (§5.11).
        refreshImagery(d);
      }
    }
    // Land on the tab the widget was filed under — "it's in the gallery" must
    // be visibly true, even if the other product was showing.
    setGalleryProduct(res.def.product);
    setStatus((wzEditing ? "Updated" : "Added") + ` widget “${res.def.name}” — it's in the gallery`, "ok");
    closeWidgetEditor();
  }

  function deleteWidget(def) {
    const msg = `Delete the widget “${def.name}”?\n\nCopies already dropped on the page stay where they are.`;
    if (!window.confirm(msg)) return;
    unregisterModule(def.id);
    removeWidgetRemote(def.id);
    if (wzEditing && wzEditing.id === def.id) closeWidgetEditor();
    setStatus(`Deleted widget “${def.name}”`);
  }

  /* ---- persistence: the signed-in user's Supabase gallery ----
   * boot.js hands over window.DMB_STORE, already bound to the authenticated
   * client, so nothing in this file knows Supabase exists. Row-level security
   * is what scopes a read to one user (supabase/schema.sql) — there is no
   * user id anywhere below, and there should not be.
   *
   * Writes are fire-and-forget on purpose: a save that blocked the dialog on a
   * network round trip would stall a live demo, and the widget is already
   * registered in memory by the time we get here. The failure path therefore
   * has to be loud, because the widget will look saved either way — that is
   * what the "this session only" status is for. */
  function widgetStore() {
    return window.DMB_STORE || null;
  }

  // `slots` rides along (§5.11): it is measured at capture time and cannot be
  // recovered from the stored markup, so dropping it would silently demote
  // every widget to the live-walk fallback after one reload. `sourceUrl` rides
  // along for the same reason: nothing can re-derive where a capture came
  // from, and without it the ⤴ share button disappears from every imported
  // widget after one reload.
  function saveWidgetRemote(def) {
    const store = widgetStore();
    if (!store) {
      // Deferred deliberately. Callers set their own "Added widget …" status
      // *after* calling this, synchronously, so a synchronous warning here
      // would be overwritten within the same tick and the user would never see
      // it. The network-failure path below lands late for free; this one has
      // to be pushed past the caller by hand.
      return Promise.resolve().then(() => {
        setStatus(`Widget “${def.name}” is in this session only — not signed in to a gallery`, "warn");
        return false;
      });
    }
    const { id, name, desc, html, css, product, slots, sourceUrl } = def;
    return store.save({ id, name, desc, html, css, product, slots, sourceUrl }).then(
      () => true,
      (err) => {
        console.error("[dmb] widget save failed:", err);
        setStatus(`“${def.name}” is in this session only — saving to your gallery failed: ${err.message}`, "err");
        return false;
      }
    );
  }

  function removeWidgetRemote(id) {
    const store = widgetStore();
    if (!store) return Promise.resolve(false);
    return store.remove(id).then(
      () => true,
      (err) => {
        console.error("[dmb] widget delete failed:", err);
        setStatus(`Removed from this session, but deleting from your gallery failed: ${err.message}`, "err");
        return false;
      }
    );
  }

  async function loadStoredWidgets() {
    const store = widgetStore();
    if (!store) return;
    let list = [];
    try {
      // Widgets from a pre-hosting localStorage library are adopted into the
      // account once, on first sign-in, so a cutover doesn't read as "the app
      // lost my widgets" (store.js).
      const moved = await store.migrate();
      list = await store.list();
      if (moved) setStatus(`Moved ${moved} widget(s) from this browser into your gallery`, "ok");
    } catch (err) {
      console.error("[dmb] could not load your gallery:", err);
      setStatus("Could not load your widget gallery: " + err.message, "err");
      return;
    }
    const skipped = [];
    for (const def of list) {
      const res = registerModule(def, "local");
      if (!res.ok) skipped.push((def && def.id) || "?");
    }
    if (skipped.length) {
      setStatus(`${skipped.length} stored widget(s) skipped — see the console (${skipped.join(", ")})`, "err");
    }
  }

  document.getElementById("widget-new").addEventListener("click", () => openWidgetEditor());
  document.getElementById("wz-close").addEventListener("click", closeWidgetEditor);
  document.getElementById("wz-cancel").addEventListener("click", closeWidgetEditor);
  wz.save.addEventListener("click", wzSave);
  wz.importBtn.addEventListener("click", wzImport);
  wz.importUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); wzImport(); }
  });
  wz.importUrl.addEventListener("input", () => { if (!wzImporting) wzSetImportLabel(); });
  wz.del.addEventListener("click", () => { if (wzEditing) deleteWidget(wzEditing); });
  wz.adapt.addEventListener("change", wzRefresh);
  wz.blend.addEventListener("change", wzRefresh);
  wz.productWrap.addEventListener("change", wzRefresh);
  [wz.desc, wz.id, wz.html, wz.css].forEach((el) => el.addEventListener("input", wzRefresh));
  wz.id.addEventListener("input", () => { wzIdTouched = true; });
  wz.name.addEventListener("input", () => {
    if (!wzEditing && !wzIdTouched) wz.id.value = slugifyModuleId(wz.name.value);
    wzRefresh();
  });
  wz.overlay.addEventListener("mousedown", (e) => { if (e.target === wz.overlay) closeWidgetEditor(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wz.overlay.hidden) closeWidgetEditor();
  });

  wz.code.addEventListener("click", () => {
    const vals = wzValues();
    if (!vals.id) vals.id = slugifyModuleId(vals.name);
    const src = moduleDefToSource(vals);
    const done = (label) => {
      wz.code.textContent = label;
      setTimeout(() => (wz.code.textContent = "Copy as code"), 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(src).then(
        () => done("Copied ✓ → custom-modules.js"),
        () => { console.log(src); done("See console"); }
      );
    } else {
      console.log(src);
      done("See console");
    }
  });

  /* Exposed for debugging/automation. */
  window.DMB = {
    state, insertModule, setSectionHidden, toggleAdapt, toggleExpand, setModuleBg,
    toggleFlat,
    // site imagery (§5.11) — "the button did nothing" is nearly always an
    // empty pool or an all-skip slot list, and both are only visible from here
    toggleImagery, shuffleImagery, harvestImagery, imageryTargets, imagery: () => state.imagery,
    loadPage, layoutViewport, redetectSections,
    // widget authoring
    modules: DEMO_MODULES, customModules: CUSTOM_MODULES,
    addWidget: (def) => { const r = registerModule(def, "local"); if (r.ok) saveWidgetRemote(r.def); return r; },
    updateWidget: (id, patch) => { const r = updateModule(id, patch); if (r.ok) saveWidgetRemote(r.def); return r; },
    removeWidget: (id) => { const ok = unregisterModule(id); if (ok) removeWidgetRemote(id); return ok; },
    // The signed-in account behind the gallery — "why can't I see my widgets"
    // is nearly always the wrong Google account, and that is invisible from
    // the DOM alone.
    user: () => window.DMB_USER || null,
    signOut: () => window.DMB_SIGNOUT && window.DMB_SIGNOUT(),
    reloadGallery: loadStoredWidgets,
    openWidgetEditor, renderGallery, scopeModuleCss, validateModuleDef,
    moduleDefToSource, captureFromPreview, rewriteCaptureTheme,
    // sharing (⤴): "the button is missing" is an empty def.sourceUrl, and
    // "it didn't pre-fill" is the parse rejecting the link — both are pure
    // functions of a URL and neither is visible from the UI
    widgetShareUrl, parseWidgetShareUrl, stripShareParams, shareWidget,
    // import diagnostics: "it can't load a widget" is nearly always one of
    // these two disagreeing with the page (§8 #12)
    findCaptureRoot, looksRendered, captureMetrics,
    // "it imported but kept the wrong skin" is nearly always an empty theme
    sampleCaptureTheme, captureThemeRoles, captureRadiusRule,
    captureFixedBgRules, captureTextRoleProps,
    // "it imported but the small text is invisible on a dark store" — the
    // foreground-anchoring pass and the three inputs it decides from (§8 #15)
    anchorCaptureColors, captureVarRoles, captureSourceBg, anchorFgColor,
    // "the appended rules are in cap.css but do nothing" — an unbalanced
    // author sheet swallowing everything after it (§8 #16)
    balanceCss,
    // gallery filtering
    setGalleryProduct,
    setGallerySearch: (q) => { gallerySearch.value = q || ""; galleryQuery = gallerySearch.value; renderGallery(); },
  };

  // Widgets from custom-modules.js are already registered (that file runs
  // before this one), so draw those immediately — then fetch the account's
  // gallery. The order is reversed from the localStorage days for one reason:
  // the fetch is a network round trip now, and the onChange hook has to be
  // live before it lands or the widgets register into a gallery nobody
  // redraws. Each registration triggers a redraw; the list is small.
  MODULE_HOOKS.onChange = () => { syncCustomCss(); renderGallery(); };
  syncCustomCss();
  renderGallery();
  loadStoredWidgets();
})();
