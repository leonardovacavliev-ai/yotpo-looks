/* Demo module library.
 *
 * Every module renders inside a `.dmb-module` wrapper. All colors/fonts flow
 * through CSS variables so the app can either adapt them to the host site
 * (inline variable overrides) or revert to the defaults declared below.
 *
 * The gallery ships **empty** — there are no built-in widgets. Everything in
 * it arrives through `registerModule()` (the registry further down), from one
 * of three routes: an imported widget-preview link or pasted HTML/CSS via the
 * in-app “＋ Add widget” dialog (per-user, Supabase), or
 * `public/custom-modules.js` (committed, shared with the team). See WIDGETS.md.
 *
 * The eleven widgets the app used to ship with still exist, in
 * `public/sample-modules.js` — nothing loads that file; uncommenting its
 * <script> tag in index.html puts them back.
 */

const DEMO_MODULE_BASE_CSS = `
.dmb-module {
  --dmb-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --dmb-heading-font: var(--dmb-font);
  --dmb-text: #1f2430;
  --dmb-muted: #6b7280;
  --dmb-accent: #4f46e5;
  --dmb-accent-contrast: #ffffff;
  --dmb-border: #e5e7eb;
  --dmb-radius: 10px;
  --dmb-bg: transparent;
  --dmb-star: #f6a723;
  all: revert;
  box-sizing: border-box;
  font-family: var(--dmb-font);
  color: var(--dmb-text);
  background: var(--dmb-bg);
  font-size: 15px;
  line-height: 1.5;
  text-align: left;
  padding: 36px 24px;
  margin: 0;
}
.dmb-module *, .dmb-module *::before, .dmb-module *::after {
  box-sizing: border-box;
  font-family: inherit;
}
.dmb-module .dmbm-wrap { max-width: 1080px; margin: 0 auto; }
.dmb-module h2.dmbm-h {
  font-family: var(--dmb-heading-font);
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 18px;
  color: var(--dmb-text);
  letter-spacing: 0;
  text-transform: none;
}
.dmb-module .dmbm-muted { color: var(--dmb-muted); font-size: 13px; }
.dmb-module .dmbm-stars { color: var(--dmb-star); letter-spacing: 2px; font-size: 16px; white-space: nowrap; }
.dmb-module .dmbm-btn {
  display: inline-block;
  background: var(--dmb-accent);
  color: var(--dmb-accent-contrast);
  border: 0;
  border-radius: var(--dmb-radius);
  padding: 11px 22px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  line-height: 1.3;
}
.dmb-module .dmbm-btn.dmbm-btn-ghost {
  background: transparent;
  color: var(--dmb-accent);
  border: 1.5px solid var(--dmb-accent);
}
.dmb-module .dmbm-card {
  border: 1px solid var(--dmb-border);
  border-radius: var(--dmb-radius);
  padding: 18px;
  background: rgba(255,255,255,.65);
}
.dmb-module svg { display: block; }
`;

/* ======================================================================== *
 * Widget registry
 *
 * `DEMO_MODULES` is the live gallery list — the app renders whatever is in
 * it, in order. It starts empty; every entry arrives through
 * `registerModule()`, from either:
 *
 *   source: "file"   public/custom-modules.js (or sample-modules.js if you
 *                    switch it back on) — committed, shared with the team,
 *                    survives clearing browser data.
 *   source: "local"  the in-app “＋ Add widget” dialog, including widgets
 *                    imported from a preview link — stored in the signed-in user's
 *                    Supabase gallery only.
 *
 * Both routes share one validator and one CSS scoper, so a widget behaves
 * identically no matter where it came from. Authoring rules: WIDGETS.md.
 * ======================================================================== */

const DEMO_MODULES = [];                       // live gallery list, in order
const CUSTOM_MODULES = [];                     // registered at runtime, in order
const MODULE_HOOKS = { onChange: null };       // app.js hooks in to re-render
const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/* Every widget belongs to one product line; the gallery shows one at a time.
 * The ＋ dialog makes the choice mandatory; widgets registered from code or
 * from an older stored library default to "reviews" (normalizeModuleDef). */
const MODULE_PRODUCTS = ["reviews", "loyalty"];
const MODULE_PRODUCT_LABELS = { reviews: "Reviews", loyalty: "Loyalty" };

/* ------------------------------------------------------------ share links
 * A widget imported from a preview link keeps that link in `def.sourceUrl`,
 * and the gallery's ⤴ button hands it to a colleague with the widget's own
 * metadata riding along as UTM parameters. The receiving end is the ＋
 * dialog's Import: it recognizes our marker, pre-fills name/description/
 * product from the link, and captures the *clean* URL — so what the colleague
 * imports is byte-for-byte the widget that was shared, filed the same way,
 * without anyone re-typing it.
 *
 * Standard UTM keys are used rather than private ones so the link survives
 * the tools it will actually travel through (Slack, mail, a CRM) and shows up
 * in analytics as what it is. The mapping:
 *
 *   utm_source    our marker — the recognition signal, nothing is read without it
 *   utm_medium    constant, so a shared link is identifiable at a glance
 *   utm_campaign  product line ("reviews" | "loyalty")
 *   utm_content   widget name
 *   utm_term      widget description (omitted when empty)
 *
 * Recognition requires utm_source to match: a preview link may legitimately
 * carry a merchant's own campaign tags, and pre-filling a widget's name from
 * "summer-sale" would be worse than not pre-filling at all. */
const SHARE_SOURCE = "demo-modules-app";
const SHARE_MEDIUM = "widget-share";
const SHARE_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/* The link to hand someone: the capture URL plus this widget's metadata.
 * Null when the widget wasn't imported (hand-written widgets have no link to
 * share) or its stored URL is unusable. */
function widgetShareUrl(def) {
  if (!def || !def.sourceUrl) return null;
  let u;
  try { u = new URL(def.sourceUrl); } catch (err) { return null; }
  for (const k of SHARE_PARAMS) u.searchParams.delete(k);
  u.searchParams.set("utm_source", SHARE_SOURCE);
  u.searchParams.set("utm_medium", SHARE_MEDIUM);
  u.searchParams.set("utm_campaign", def.product || "reviews");
  u.searchParams.set("utm_content", def.name || "");
  if (def.desc) u.searchParams.set("utm_term", def.desc);
  return u.href;
}

/* The metadata carried by a shared link, or null if this isn't one of ours.
 * Only fields actually present come back — a link shared before a widget had
 * a description must not blank the description the capture derives. */
function parseWidgetShareUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || "").trim()); } catch (err) { return null; }
  const p = u.searchParams;
  if ((p.get("utm_source") || "").trim().toLowerCase() !== SHARE_SOURCE) return null;
  const out = {};
  const name = (p.get("utm_content") || "").trim();
  const desc = (p.get("utm_term") || "").trim();
  const product = (p.get("utm_campaign") || "").trim().toLowerCase();
  if (name) out.name = name.slice(0, 120);
  if (desc) out.desc = desc.slice(0, 240);
  if (MODULE_PRODUCTS.includes(product)) out.product = product;
  return Object.keys(out).length ? out : null;
}

/* Our own parameters back off before the capture runs, so a shared link and
 * the original preview link render the identical widget — the platform shell
 * reads its own query string (guid, widget_instance_id, is-mobile), and a
 * capture that differed by how the link reached you would be a nasty surprise.
 * Only *our* keys go, and only from a link we recognize: a merchant's UTM tags
 * on their own preview link are theirs to keep. */
function stripShareParams(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!parseWidgetShareUrl(url)) return url;
  const u = new URL(url);
  for (const k of SHARE_PARAMS) u.searchParams.delete(k);
  return u.href;
}

function notifyModulesChanged() {
  if (typeof MODULE_HOOKS.onChange === "function") MODULE_HOOKS.onChange();
}

function moduleById(id) {
  return DEMO_MODULES.find((m) => m.id === id) || null;
}

/* Per-widget scope class. Widget CSS is scoped to `.dmb-module.dmb-w-<id>`,
 * not to `.dmb-module` at large — every registered widget's CSS is injected
 * into the same two documents, so a shared scope lets one widget restyle
 * another. That is not hypothetical: imported platform widgets keep the
 * platform's class names, so any two captures from the same platform collide
 * (two Yotpo instances both have `.yotpo-reviews-list-wrapper`, and one
 * store's `display:flex` override re-laid-out the other widget's review list).
 * Ids already match MODULE_ID_RE; the replace is a belt-and-braces guard. */
function moduleScopeClass(id) {
  return "dmb-w-" + String(id).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

/* "Loyalty Points Banner" → "loyalty-points-banner", uniquified. */
function slugifyModuleId(name) {
  const base =
    String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) ||
    "widget";
  let id = base;
  for (let n = 2; moduleById(id); n++) id = base + "-" + n;
  return id;
}

/* ------------------------------------------------------------- validation
 * Errors block registration (the widget would be broken or would collide);
 * warnings are advisory — they flag the things that make a widget *look*
 * wrong on a client's page (won't adapt, spills full-bleed, needs the
 * network). Both are surfaced in the console and in the editor dialog. */
function validateModuleDef(def, opts) {
  const ignoreId = (opts && opts.ignoreId) || null;
  const errors = [];
  const warnings = [];
  if (!def || typeof def !== "object") return { errors: ["Widget definition must be an object"], warnings };

  const id = def.id === undefined || def.id === null ? "" : String(def.id);
  const name = def.name === undefined || def.name === null ? "" : String(def.name).trim();
  const html = def.html === undefined || def.html === null ? "" : String(def.html);
  const css = def.css === undefined || def.css === null ? "" : String(def.css);

  if (!id) errors.push('id is required — a stable lowercase slug, e.g. "loyalty-points"');
  else if (!MODULE_ID_RE.test(id)) errors.push('id "' + id + '" is invalid — lowercase letters, digits and hyphens only, max 40 chars');
  else if (id !== ignoreId && moduleById(id)) errors.push('id "' + id + '" is already used by “' + moduleById(id).name + '”');

  if (def.product != null && !MODULE_PRODUCTS.includes(def.product)) {
    errors.push('product "' + def.product + '" is invalid — must be "reviews" or "loyalty"');
  }

  if (!name) errors.push("name is required — it labels the gallery card and the Editor row");
  else if (name.length > 48) warnings.push("name is longer than 48 characters and will be clipped on the gallery card");

  if (!html.trim()) errors.push("html is required — the widget's markup fragment");
  if (/<\s*script/i.test(html)) errors.push("html must not contain <script> — inserted markup never executes (page JS is stripped by design)");
  if (/<\s*(html|head|body)\b/i.test(html)) errors.push("html must be a fragment — no <html>, <head> or <body> tags");
  if (/class\s*=\s*["'][^"']*\bdmb-module\b/i.test(html)) warnings.push("html declares its own .dmb-module wrapper — the app adds one, so this nests two (double padding, double background)");
  if (!/\bdmbm-wrap\b/.test(html)) warnings.push('content is not wrapped in <div class="dmbm-wrap"> — it will run edge-to-edge when dropped into a full-bleed page region');

  const external = /(?:src|href)\s*=\s*["']?https?:|url\(\s*["']?https?:/i;
  if (external.test(html) || external.test(css)) warnings.push("references an external asset over http(s) — widgets should be self-contained (inline SVG, CSS gradients) so they render instantly and can't fail on a client's page");
  if (/font-family\s*:\s*(?!\s*var\()/i.test(css)) warnings.push("css sets font-family to a literal font — use var(--dmb-font) / var(--dmb-heading-font) or Adapt/Revert won't reach it");
  const LITERAL_COLOR_RE =
    /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline(?:-color)?|fill|stroke)\s*:\s*[^;}]*?(?:#[0-9a-f]{3}|rgba?\(|hsla?\(|\b(?:red|blue|green|black|white|orange|purple|pink|yellow|gray|grey|navy|teal|brown|gold|silver|beige)\b)/i;
  if (LITERAL_COLOR_RE.test(css)) warnings.push("css contains literal colors — prefer var(--dmb-text) / var(--dmb-accent) / var(--dmb-border) so the widget picks up the client's brand (literal colors are fine only when deliberately fixed, e.g. photo gradients)");

  const classes = css.match(/\.[a-zA-Z_][\w-]*/g) || [];
  const unprefixed = Array.from(new Set(classes.filter((c) => !/^\.dmbm?-/.test(c))));
  if (unprefixed.length) warnings.push("css targets un-prefixed class" + (unprefixed.length > 1 ? "es " : " ") + unprefixed.slice(0, 4).join(", ") + " — prefix widget classes with dmbm- so they can never collide with the client's own CSS");

  return { errors, warnings };
}

/* ----------------------------------------------------------- CSS scoping
 * A widget's CSS is injected into the *client's* document, so an unscoped
 * rule (`h2 { color: red }`, `.card { border: 0 }`) would restyle their
 * page. Every selector is therefore prefixed with `.dmb-module`, which also
 * out-specifies the host's bare element rules. @keyframes/@font-face pass
 * through untouched; @media/@supports/@container bodies are scoped inside. */
const NESTED_AT_RE = /^@(?:media|supports|container|layer|scope)\b/i;

function skipCssString(css, i) {
  const q = css[i];
  for (let j = i + 1; j < css.length; j++) {
    if (css[j] === "\\") { j++; continue; }
    if (css[j] === q) return j;
  }
  return css.length;
}

function matchCssBrace(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") { i = skipCssString(css, i); continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return css.length;
}

/* Split a selector list on top-level commas only — `:is(a, b)` stays whole. */
function splitCssSelectors(sel) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of sel) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function scopeOneSelector(sel, scope) {
  const s = sel.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!s) return null;
  // Author already wrote the wrapper class — retarget instead of nesting.
  if (s.includes(".dmb-module")) return scope === ".dmb-module" ? s : s.replace(/\.dmb-module/g, scope);
  // Page-level selectors can't mean the page here; they mean the wrapper.
  if (/^(?::root|html|body)$/i.test(s)) return scope;
  if (s.startsWith("&")) return scope + s.slice(1);
  return scope + " " + s;
}

function scopeModuleCss(css, scope) {
  scope = scope || ".dmb-module";
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) { out += css.slice(i); break; }
    const prelude = css.slice(i, open);
    const close = matchCssBrace(css, open);
    const body = css.slice(open + 1, close);
    const lead = prelude.match(/^\s*/)[0];
    const head = prelude.slice(lead.length);
    if (NESTED_AT_RE.test(head.trim())) {
      out += prelude + "{" + scopeModuleCss(body, scope) + "}";
    } else if (head.trim().startsWith("@")) {
      out += prelude + "{" + body + "}";
    } else {
      const scoped = splitCssSelectors(head)
        .map((s) => scopeOneSelector(s, scope))
        .filter(Boolean)
        .join(", ");
      out += lead + (scoped || scope) + " {" + body + "}";
    }
    i = close + 1;
  }
  return out;
}

/* Concatenated CSS of every runtime-registered widget, ready to inject. */
function customModuleCss() {
  return CUSTOM_MODULES.filter((m) => m.scopedCss)
    .map((m) => "/* widget: " + m.id + " */\n" + m.scopedCss)
    .join("\n");
}

function normalizeModuleDef(def, source) {
  const entry = {
    id: String(def.id),
    name: String(def.name).trim(),
    desc: def.desc ? String(def.desc).trim() : "",
    html: String(def.html),
    css: def.css ? String(def.css) : "",
    // Pre-product widgets (custom-modules.js, an older stored library) land in
    // Reviews rather than vanish from a gallery that only shows one product.
    product: MODULE_PRODUCTS.includes(def.product) ? def.product : "reviews",
    builtin: false,
    source: source || def.source || "file",
    // The preview link this widget was captured from (empty for hand-written
    // ones). Not used to render anything — it exists so the gallery's ⤴ button
    // can hand the widget to a colleague. Sanitized rather than trusted: it
    // round-trips through the database and lands in an href-shaped string.
    sourceUrl: /^https?:\/\//i.test(String(def.sourceUrl || "")) ? String(def.sourceUrl).trim() : "",
  };
  entry.scopeClass = moduleScopeClass(entry.id);
  entry.scopedCss = entry.css ? scopeModuleCss(entry.css, ".dmb-module." + entry.scopeClass) : "";
  // Imports whose CSS carries .dmb-flat blend companions (frozen surfaces the
  // rep may dissolve into the host) get the Blend toggle in the chip/Editor.
  entry.flattenable = /\.dmb-flat\b/.test(entry.css);
  // Site-imagery slot manifest (CLAUDE.md §5.11): the image frames the capture
  // measured, addressed by the data-dmb-slot="N" attributes stamped into
  // entry.html. Pure metadata — it changes nothing about how the widget
  // renders, and a widget without it still gets imagery via a live re-walk of
  // the inserted instance. Sanitized rather than trusted: it round-trips
  // through the database as jsonb, and a hand-edited def can carry anything.
  entry.slots = normalizeSlots(def.slots);
  return entry;
}

/* Keep only the shape applyImagery() reads, with sane numbers. A malformed
 * manifest must degrade to "no slots" (imagery falls back to a live walk),
 * never to a broken swap on a client's page. */
function normalizeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  const out = [];
  for (const s of slots.slice(0, 200)) {
    if (!s || typeof s !== "object") continue;
    const i = Number(s.i);
    const w = Number(s.w);
    const h = Number(s.h);
    if (!Number.isFinite(i) || i < 0) continue;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
    out.push({
      i: Math.floor(i),
      kind: String(s.kind || "generic"),
      fill: s.fill !== false,
      mode: s.mode === "bg" ? "bg" : "src",
      w: Math.round(w),
      h: Math.round(h),
      ar: Number.isFinite(Number(s.ar)) && Number(s.ar) > 0 ? Number(s.ar) : w / h,
      fit: String(s.fit || "cover"),
    });
  }
  return out;
}

function logModuleIssues(id, res) {
  for (const e of res.errors) console.error('[dmb] widget "' + id + '" rejected: ' + e);
  for (const w of res.warnings) console.warn('[dmb] widget "' + id + '": ' + w);
}

/* Add a widget to the gallery. Returns {ok, errors, warnings, def}. */
function registerModule(def, source) {
  const res = validateModuleDef(def);
  logModuleIssues(def && def.id, res);
  if (res.errors.length) return { ok: false, errors: res.errors, warnings: res.warnings, def: null };
  const entry = normalizeModuleDef(def, source);
  CUSTOM_MODULES.push(entry);
  DEMO_MODULES.push(entry);
  notifyModulesChanged();
  return { ok: true, errors: [], warnings: res.warnings, def: entry };
}

/* Edit a registered widget in place. The def object identity is preserved so
 * already-inserted instances (which hold a reference) stay linked to it. */
function updateModule(id, patch) {
  const entry = CUSTOM_MODULES.find((m) => m.id === id);
  if (!entry) return { ok: false, errors: ['no custom widget with id "' + id + '"'], warnings: [], def: null };
  const merged = Object.assign({}, entry, patch);
  const res = validateModuleDef(merged, { ignoreId: id });
  logModuleIssues(merged.id, res);
  if (res.errors.length) return { ok: false, errors: res.errors, warnings: res.warnings, def: null };
  Object.assign(entry, normalizeModuleDef(merged, entry.source));
  notifyModulesChanged();
  return { ok: true, errors: [], warnings: res.warnings, def: entry };
}

/* Remove a widget from the gallery. Instances already dropped on the page
 * are independent DOM and stay where they are. */
function unregisterModule(id) {
  const i = CUSTOM_MODULES.findIndex((m) => m.id === id);
  if (i === -1) return false;
  CUSTOM_MODULES.splice(i, 1);
  const j = DEMO_MODULES.findIndex((m) => m.id === id);
  if (j !== -1) DEMO_MODULES.splice(j, 1);
  notifyModulesChanged();
  return true;
}

/* Render a def as a registerModule() call — how a widget authored in the
 * dialog gets promoted into public/custom-modules.js. */
function moduleDefToSource(def) {
  const lit = (s) =>
    "`" + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
  const lines = [
    "registerModule({",
    "  id: " + JSON.stringify(def.id) + ",",
    "  name: " + JSON.stringify(def.name) + ",",
    "  desc: " + JSON.stringify(def.desc || "") + ",",
    "  product: " + JSON.stringify(def.product || "reviews") + ",",
    "  html: " + lit(def.html) + ",",
  ];
  if (def.css && def.css.trim()) lines.push("  css: " + lit(def.css) + ",");
  // Carried so a promoted widget can still be shared (⤴) — it is the only
  // record of where the capture came from, and nothing can re-derive it.
  if (def.sourceUrl) lines.push("  sourceUrl: " + JSON.stringify(def.sourceUrl) + ",");
  // The site-imagery manifest (CLAUDE.md §5.11) is measured by the capture and
  // cannot be re-derived from the markup, so promotion to custom-modules.js
  // has to carry it or the widget silently loses its slots. One line: it is
  // reference data, not something anyone edits by hand.
  if (Array.isArray(def.slots) && def.slots.length) {
    lines.push("  slots: " + JSON.stringify(def.slots) + ",");
  }
  lines.push("});");
  return lines.join("\n");
}
