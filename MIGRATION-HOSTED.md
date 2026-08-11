# MIGRATION-HOSTED.md — from local tool to globally available app

> ## ⚠️ Superseded in part — read this first
>
> **The app went hosted on 2026-08-11, but not the way this document plans it.**
> The user chose a different stack and a different sharing model, so §0's
> "decisions already made" no longer describe the build:
>
> | This doc says | What was actually built |
> |---|---|
> | Fly.io + Docker + Postgres | **Vercel + Supabase**, no container |
> | Hybrid SQLite/Postgres storage layer | Supabase only; local dev runs with **no** database at all |
> | One global published library + personal drafts | **Private per-user galleries**, no global library |
> | Google SSO for one Workspace domain | Google SSO, **allowlist** of domains + individual addresses |
>
> What is built is described in **CLAUDE.md §3.1 and §5.13**, and set up by
> **DEPLOY.md**. Treat those as authoritative and this file as background.
>
> **What remains fully valid and worth reading:** §1's two risks. Risk 1
> (datacenter IPs get blocked far more than home IPs) is unaddressed and is now
> the biggest open product risk — its mitigation table is still the menu.
> Risk 2 (serving third-party HTML from your own origin) was addressed only
> *partly*: the sandbox, the handler stripping and the JS-off default landed;
> the HttpOnly-cookie session and the widget-HTML sanitizer did not, and the
> latter matters less than it did because galleries are no longer shared
> between users. §5.2's SSRF analysis is also still unimplemented.

**Status:** partly superseded — see the banner above. Sections 0 and 3–7
describe a Fly.io build that was not taken; §1, §5.2 and §5.4 remain relevant.
**Written:** 2026-08-03. **Audience:** the next Claude session (or developer) that
picks this up.

This is the migration plan for turning Yotpo Looks from a
single-user localhost tool into a hosted, authenticated, multi-user app with a
**shared global widget library in a real database**.

Read `CLAUDE.md` first — it explains why the current code is shaped the way it
is. This document assumes that context and only describes *changes*.

---

## 0. Decisions already made

These four were chosen by the user on 2026-08-03. Do not re-litigate them;
build to them.

| Decision | Choice | Consequence |
|---|---|---|
| **Hosting** | **Fly.io, Docker** | Existing Python server runs nearly unchanged in a container. `flyctl` is a single binary — no Node/npm needed, which matters because this machine has neither. |
| **Server stack** | **Hybrid: stdlib-only locally, Postgres in prod** | One storage interface, two backends. `python3 server.py` must keep working on the Mac with **zero installs** (`sqlite3` is stdlib). Postgres driver is installed *only inside the Docker image*. |
| **Auth** | **Google SSO restricted to one Workspace domain** | Real per-user identity → widget authorship, audit trail, per-user rate limits. |
| **Widget DB scope** | **One global published library + personal drafts** | Everyone sees the same gallery; each user also has private drafts they publish when ready. |

Two consequences of "hybrid" worth stating explicitly, because they are easy to
get wrong:

1. **Local dev never runs `pip install`.** SQLite is stdlib. The Postgres
   driver (`psycopg[binary]`) is a line in `deploy/requirements.txt`, installed
   by the Dockerfile only. `store/postgres_store.py` must therefore **import
   `psycopg` lazily inside its constructor**, never at module top level, or
   local startup crashes with `ModuleNotFoundError`.
2. **Python version straddle.** Local is 3.9.6 (system Python). The container
   should run a *supported* Python (3.12-slim) because a hosted service needs
   security updates. So: **keep writing 3.9-compatible syntax** (no `match`,
   no `X | Y` unions, no `dict[str, int]` builtins-as-generics at runtime) and
   run CI on both 3.9 and 3.12. This constraint already exists in CLAUDE.md §2
   — it survives the migration rather than disappearing.

---

## 1. Read this first — the two risks that decide whether hosting is worth it

Everything else in this plan is ordinary engineering. These two are the ones
that can make the hosted version *worse than the local one*, and both need a
decision before Phase 6.

### Risk 1 — Datacenter IPs get blocked far more than home IPs

Today the proxy fetch originates from the rep's own residential/office IP.
Hosted on Fly, it originates from a well-known datacenter range. Cloudflare,
Akamai, PerimeterX and Shopify's own bot rules treat those very differently.
CLAUDE.md §9 already lists Amazon, Gymshark and Bombas as blocked; expect that
list to **grow substantially** — plausibly to a large share of non-Shopify
stores, and some Shopify stores behind Cloudflare Bot Fight Mode.

This is the single biggest product risk of going hosted. Mitigations, roughly
in order of cost:

| Option | Effort | Notes |
|---|---|---|
| **Client-side DOM capture** (browser extension or bookmarklet) | Medium | The rep's own browser captures the fully-rendered DOM and POSTs it to the app. Defeats bot blocking *and* fixes the client-rendered-SPA limitation (CLAUDE.md §9) because the DOM is already hydrated. **Strategically the best answer** — see Phase 8. |
| **Upload/paste HTML fallback** | Low | "Save page as HTML → drop it here." Ugly but unblocks any store, and it's a two-hour feature. Ship this in Phase 6 as the escape hatch. |
| Residential proxy egress (Bright Data, Oxylabs, IPRoyal) | Low code, ongoing $ + ToS questions | Route `fetch()` through an upstream HTTP proxy via `urllib.request.ProxyHandler`. ~$5–15/GB. Read the target sites' ToS. |
| Headless browser fetch (Browserless, or Playwright in a bigger container) | High | Also fixes SPAs. Big container, big memory, ~$0.001–0.01/page. Was explicitly out of scope for a stdlib build; the container makes it *possible*, not cheap. |
| Fly egress IP variety / WireGuard to an office box | Medium | Fly supports dedicated IPv4; an office-based egress node is basically a self-hosted residential proxy. |

**Recommendation:** ship Phase 6 with the paste/upload fallback, measure the
real block rate over two weeks of actual demos, then decide between the
extension (Phase 8) and a residential proxy. Do not build the headless path
speculatively.

### Risk 2 — Serving third-party HTML from your own origin becomes a real vulnerability

The whole architecture rests on the proxied page being **same-origin** with the
app (CLAUDE.md §3) so `iframe.contentDocument` is reachable. On localhost with
one user and no credentials, that is harmless. Hosted, with a session cookie
and an API on the same origin, it is not:

- `rewrite_html()` strips `<script>` tags — but **not inline event handlers**
  (`onerror`, `onclick`, `onload`), **not** `javascript:` URLs, **not**
  `<iframe srcdoc>`. Any of those executes JS in *your* origin.
- Once JS runs in that iframe it is same-origin with the app frame: it can read
  `window.parent`'s JS variables, call `/api/*` with the user's cookie, and
  exfiltrate the entire widget library or the session.
- `&scripts=1` hands the store's own JS that same access, deliberately.

And a second, subtler one introduced by the *global DB itself*: widget HTML is
now **user-generated content from other users**, and it is injected with
`innerHTML` in two places in the **app document** — `buildGalleryCard()`
(`public/app.js:143`) and the widget-editor preview (`public/app.js:1006`).
`innerHTML` does not run `<script>`, but it absolutely does fire
`<img src=x onerror=…>`. A malicious or compromised teammate's widget becomes
**stored XSS in the app origin, on every user's gallery.** Today that risk is
zero because widgets never leave your own browser.

**The fix is layered, and all four layers are cheap:**

1. **`sandbox="allow-same-origin"` on `#canvas`** (one attribute in
   `index.html`). Keeps DOM access, blocks all script execution in the frame.
   Removed only when `scripts=1` is allowed (local mode).
2. **`Content-Security-Policy: script-src 'none'` on every `/proxy` response.**
   Blocks inline handlers too (they need `unsafe-inline`/`unsafe-hashes`).
   Critically, this does **not** restrict the parent frame's JS reaching into
   the iframe — that code runs in the parent's realm, so all of `app.js` keeps
   working unchanged.
3. **Attribute-level sanitization** in `rewrite_html()`: drop `on*=` attributes,
   `javascript:`/`vbscript:`/`data:text/html` URLs, `srcdoc`, `<object>`,
   `<embed>`, `<link rel=import>`. Defense in depth for old browsers and for
   the day someone changes the CSP.
4. **`Content-Security-Policy: script-src 'self'` on the app document itself**,
   which kills `onerror=` in stored widget HTML. This has one concrete
   prerequisite: several built-in widgets use `onclick="return false"` on
   anchors (`ugc-gallery` in `public/modules.js:287`, `STARTER_HTML` in
   `public/app.js:946`, the example in `public/custom-modules.js:55`, and the
   docs in `WIDGETS.md`). Those inline handlers stop working under CSP. Replace
   the anchors with `<span class="dmbm-btn" role="button">` — the widgets are
   non-interactive demo props, so nothing is lost. Plus a server-side HTML
   allowlist sanitizer (§5.4) and, in Phase 7, rendering thumbnails inside
   `<iframe sandbox>` instead of `innerHTML`.

**Consequence for the JS checkbox:** with layers 1–2 in place, `scripts=1` is
fundamentally unsafe on the shared origin — it is a deliberate grant of
same-origin script execution to a third party. **Recommendation: `scripts=1`
becomes local-mode-only**, gated by `DMB_MODE`, with the checkbox hidden and
the query parameter rejected in hosted mode. The genuinely safe hosted version
of that feature is the sandboxed render origin (Phase 8, §12) or client-side
DOM capture (Risk 1) — both of which also solve other problems, which is why
they belong together.

---

## 2. What does **not** change

Scope discipline matters here; this is a plumbing migration, not a rewrite.
The following are untouched, and a diff that touches them should be questioned:

- Section detection (`detectSections`, `runDetection`, `isSignificant`) and all
  its empirically tuned thresholds — 40px/120px, 0.8 pass-through, 1.4×vh,
  depth 6. CLAUDE.md §5.2's warning stands: tune against real pages only.
- Sub-section detection (`runSubDetection`, `toggleExpand`), the `display:
  contents` handling, the single-child drill-down.
- The hover chip, the drop indicator, `insertionPointAt` and its horizontal
  penalty, `insertModule`'s `insertBefore` placement.
- **The whole CSS adaptation mechanism** — `sampleHostStyles`, `ADAPT_VARS`,
  `applyHostVars`/`clearHostVars`, every `--dmb-*` variable, Revert semantics.
- The Editor tree (`renderEditor`, `deepestSectionAround`, `hasHiddenAncestor`).
- Viewport emulation and gallery collapse (CLAUDE.md §5.6), including the
  "don't multiply by scale" rule.
- `<base href>` injection — still correct; the proxy origin changes but the
  mechanism doesn't.
- The 700 ms `initPage()` delay.
- `window.DMB` stays exported (CLAUDE.md §5.7) — it is the only way to E2E-test
  drag-and-drop, and the hosted version needs it *more*, not less.

The **same-origin iframe invariant survives the move**: app at
`https://demo.example.com`, proxy at `https://demo.example.com/proxy`, still
same origin, still `contentDocument`-accessible. That is the good news that
makes this migration a few sessions rather than a few weeks.

---

## 3. Target architecture

```
                    ┌──────────────────────────────────────┐
   rep's browser ──▶│ Fly edge (TLS, HTTP/2, anycast)      │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │ Fly machine: python3 -m dmb          │
                    │  ThreadingHTTPServer, bounded pool   │
                    │  ├── /            static (public/)   │
                    │  ├── /api/*       JSON, session auth │
                    │  ├── /api/auth/*  Google OIDC        │
                    │  ├── /proxy       guarded fetch      │
                    │  └── /healthz /readyz                │
                    └───────┬──────────────────┬───────────┘
                            │                  │
                 ┌──────────▼─────────┐   ┌────▼───────────────────┐
                 │ Postgres (Neon)    │   │ egress → store PDPs    │
                 │ users, widgets,    │   │ (SSRF-guarded, pinned  │
                 │ versions, sessions │   │  IP, 8 MB / 20 s caps) │
                 └────────────────────┘   └────────────────────────┘

  Browser also fetches store CSS/fonts/images DIRECTLY from the store CDN
  (unchanged — that's what <base href> is for).
```

**Two run modes, one codebase**, selected by `DMB_MODE`:

| | `DMB_MODE=local` (default) | `DMB_MODE=hosted` |
|---|---|---|
| Bind | `127.0.0.1:4173` | `0.0.0.0:8080` |
| Store | SQLite file (`./var/dmb.sqlite3`) | Postgres via `DATABASE_URL` |
| Auth | none, or `DMB_DEV_USER=you@corp.com` | Google SSO, domain-restricted |
| `scripts=1` | allowed | rejected (400) |
| iframe sandbox | off | `allow-same-origin` |
| SSL verify bypass | allowed (Apple Python CA quirk) | **hard off** |
| Static caching | `no-store` (CLAUDE.md §8 bug 2) | immutable + hashed filenames |
| Rate limits | off | on |

Keeping local mode first-class is not sentimentality: it is how you develop on
this machine, how you demo on a plane, and the fallback if the hosted proxy is
blocked by a store.

---

## 4. Target file layout

```
server.py                     # thin shim: `python3 server.py` still works
dmb/
  __init__.py
  __main__.py                 # `python3 -m dmb` (container entrypoint)
  config.py                   # env → Config object; validates hosted-mode invariants
  httpapp.py                  # Handler; routes → api / auth / proxy / static
  routes_api.py               # /api/widgets, /api/me, /api/config
  routes_auth.py              # Google OIDC start + callback + logout
  proxy.py                    # fetch loop + rewrite_html (moved from server.py)
  guard.py                    # SSRF: URL policy, DNS resolve+check, pinned connect
  sanitize.py                 # HTML allowlist + CSS sanitizer (widgets AND proxied page)
  validate.py                 # server-side widget validation (error-level only)
  sessions.py                 # opaque tokens, hashed at rest, cookie helpers
  ratelimit.py                # token bucket (in-process) / DB-backed counters
  store/
    __init__.py               # get_store(config) → Store
    base.py                   # Store interface + shared row→dict mapping
    sqlite_store.py           # stdlib sqlite3, WAL, thread-local connections
    postgres_store.py         # lazy `import psycopg` inside __init__
    migrate.py                # numbered-file runner + schema_migrations table
    migrations/
      sqlite/0001_init.sql …
      postgres/0001_init.sql …
public/
  index.html                  # + sign-in gate, sandbox attr, CSP-safe markup
  app.css                     # + auth gate, gallery filters, draft badges
  app.js                      # gallery/widget layer rewired to the API
  modules.js                  # registry gains async load + source:'global'/'draft'
  custom-modules.js            # unchanged (kept as offline/code-owned route)
  api.js                      # NEW — thin fetch wrapper, CSRF header, error mapping
  tests.html                  # NEW — in-browser JS assertions (no npm needed)
tests/
  test_guard.py test_proxy_rewrite.py test_sanitize.py test_validate.py
  test_store_contract.py test_api.py test_auth.py test_builtin_slug_drift.py
  fixtures/widget_validation.json    # shared JS↔Python parity fixtures
deploy/
  Dockerfile  .dockerignore  fly.toml  requirements.txt  entrypoint.sh
scripts/
  smoke.sh                    # post-deploy curl checks
  export_widgets.py           # JSON dump of the library (never trap the data)
.github/workflows/ci.yml
```

`server.py` stays as a 5-line shim (`from dmb.__main__ import main; main()`) so
every instruction in README.md and CLAUDE.md §2 keeps working verbatim. Because
the script's directory is on `sys.path`, `import dmb` resolves with no install.

---

## 5. Component-by-component design

### 5.1 `config.py`

One object, built from env, validated at startup. **Hosted mode must fail fast
rather than boot insecurely.**

| Var | Default | Notes |
|---|---|---|
| `DMB_MODE` | `local` | `local` \| `hosted` |
| `HOST` | `127.0.0.1` | container sets `0.0.0.0` |
| `PORT` | `4173` | container sets `8080` |
| `DATABASE_URL` | — | absent → SQLite; `postgres://…` → Postgres |
| `DMB_SQLITE_PATH` | `./var/dmb.sqlite3` | |
| `GOOGLE_CLIENT_ID` / `_SECRET` | — | required in hosted mode |
| `DMB_ALLOWED_DOMAINS` | — | comma list, e.g. `yourcorp.com`; required in hosted |
| `DMB_ADMIN_EMAILS` | — | comma list; seeded as `role='admin'` on first login |
| `DMB_BASE_URL` | `http://localhost:4173` | for the OAuth redirect URI |
| `DMB_SESSION_TTL_DAYS` | `14` | |
| `DMB_DEV_USER` | — | local-only auth bypass; **assert mode != hosted** |
| `DMB_ALLOW_SCRIPTS_PARAM` | `1` local / `0` hosted | the JS checkbox kill switch |
| `DMB_PROXY_MAX_BYTES` | `8388608` | 8 MB |
| `DMB_PROXY_TIMEOUT_S` | `20` | per hop |
| `DMB_PROXY_MAX_REDIRECTS` | `5` | |
| `DMB_PROXY_RPM` / `_RPH` | `30` / `300` | per user |
| `DMB_ALLOW_INSECURE_TLS` | `1` local / `0` hosted | the CLAUDE.md §5.1 CA fallback |
| `DMB_UPSTREAM_PROXY` | — | optional residential-proxy egress (Risk 1) |
| `DMB_BLOCKED_HOSTS` | — | comma list; abuse/legal blocklist |

Startup assertions in hosted mode: OAuth creds present, `DMB_ALLOWED_DOMAINS`
non-empty, `SESSION_SECRET` present if any signed cookie is used,
`DMB_DEV_USER` unset, `DMB_ALLOW_INSECURE_TLS=0`, `DATABASE_URL` present.

### 5.2 `guard.py` — SSRF, the highest-severity new attack surface

Today `handle_proxy` validates only the URL scheme. Hosted, any authenticated
user (and, if auth ever breaks, anyone) can make your server fetch **any**
URL — including Fly's internal 6PN network and your own Postgres.

Required controls:

```python
BLOCKED_NETS = [ipaddress.ip_network(n) for n in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
    "169.254.0.0/16",            # cloud metadata — the classic SSRF target
    "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16",
    "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
    "::1/128", "::/128", "fc00::/7", "fe80::/10", "ff00::/8",
    "fdaa::/16",                 # Fly.io 6PN private network — reaches your DB
)]
ALLOWED_PORTS = {80, 443}
```

1. Scheme in `{http, https}`; port in `ALLOWED_PORTS`; host not in
   `DMB_BLOCKED_HOSTS`; reject `*.internal` and bare-IP hosts that fail the
   net check.
2. `socket.getaddrinfo()` the host and check **every** returned address against
   `BLOCKED_NETS` *and* `ip.is_global`. One bad address fails the whole fetch.
3. **Pin the validated IP for the actual connection** — otherwise a DNS
   rebinding attack re-resolves to `169.254.169.254` between check and connect:

```python
class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, pinned_ip, **kw):
        super().__init__(host, **kw)
        self._pinned_ip = pinned_ip
    def connect(self):
        self.sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        if self._tunnel_host:
            self._tunnel()
        # SNI + cert validation still use the real hostname
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)
```

4. **Follow redirects manually**, max 5 hops, re-running steps 1–3 on every
   hop. `urlopen`'s automatic redirect handling silently bypasses the guard —
   this is the most commonly missed hole in exactly this kind of proxy. A
   manual `http.client` loop is more code but auditable, and you already need
   it for the pinned connection.
5. **Cap the body**: `resp.read(CAP + 1)` and reject if longer. The current
   `resp.read()` is unbounded — one 500 MB response OOMs the machine and takes
   every other user's demo down with it.
6. Per-hop timeout *and* a total wall-clock budget.
7. Keep the *final* URL for `<base href>` — unchanged behavior, but now it is
   the last validated hop.

`tests/test_guard.py` should be a large table of URL → expect(allow|block):
`http://169.254.169.254/latest/meta-data/`, `http://[::1]:5432/`,
`http://foo.internal/`, `http://127.0.0.1.nip.io/` (resolves to loopback —
catches the getaddrinfo check), `https://store.com:22/`,
`file:///etc/passwd`, `http://10.0.0.5/`, plus a redirect chain that ends at a
private IP, plus a DNS name with mixed public/private A records.

### 5.3 `proxy.py` — rewrite passes and response headers

Keep the five existing regex passes (CLAUDE.md §5.1), add:

6. Strip `on\w+=` attributes (event handlers).
7. Neutralize `href`/`src`/`action`/`formaction`/`xlink:href` values beginning
   `javascript:`, `vbscript:`, or `data:text/html`.
8. Strip `srcdoc=` (srcdoc frames **inherit** the parent's CSP context in ways
   that are easy to get wrong — just remove them).
9. Strip `<object>`, `<embed>`, `<applet>`, `<link rel="import">`.
10. Rewrite `http://` asset URLs to `https://` where the host also serves
    HTTPS — or simply rely on the `upgrade-insecure-requests` CSP directive
    (see below). **This is a genuine new regression**: on `http://localhost` a
    store's `http://` assets load fine; on an HTTPS host they are blocked as
    mixed content and the page renders unstyled.

Regex-over-HTML remains the right call for these shallow passes (CLAUDE.md
§5.1), but pass 6/7 are attribute-level and easier to get wrong. Write them as
narrow, well-tested regexes and treat the CSP as the real control, the regexes
as defense in depth.

Response headers on `/proxy`:

```
Content-Security-Policy:
  default-src 'self' https: data: blob:;
  script-src 'none';
  style-src 'unsafe-inline' https: data:;
  img-src https: data: blob:;
  font-src https: data:;
  object-src 'none';
  form-action 'none';
  base-uri *;                     # we inject <base>; must stay allowed
  upgrade-insecure-requests;
Cache-Control: private, no-store
Vary: Cookie
Referrer-Policy: no-referrer      # also sidesteps naive hotlink protection
X-Robots-Tag: noindex, nofollow
X-Content-Type-Options: nosniff
```

Notes on the CSP, all verified reasoning worth keeping in the code comments:
- `style-src 'unsafe-inline'` is unavoidable — host pages are full of inline
  styles, and `initPage()` injects `<style id="dmb-styles">`.
- `script-src 'none'` does **not** block `app.js` manipulating the iframe's
  DOM. Parent-realm code isn't governed by the child document's CSP.
- `frame-src` is deliberately not `'none'` so video embeds still render; nested
  frames are cross-origin and therefore isolated from us anyway.
- `base-uri *` is required by our own `<base href>` injection. Don't tighten it
  without re-testing asset loading.

### 5.4 `sanitize.py` — widget HTML/CSS from other users

New requirement created by the global DB. Runs **server-side on write** (so bad
content never enters the library) *and* is mirrored by the client validator for
fast feedback.

**HTML: allowlist, not blocklist.** Use `html.parser.HTMLParser` (stdlib) to
re-emit only permitted tags/attributes:

- Tags: `div span p a b strong i em small h2 h3 h4 ul ol li table thead tbody
  tr td th figure figcaption img picture source svg path circle rect line
  polyline polygon g defs linearGradient stop input button label br hr`
- Attributes: `class`, `style` (see below), `href`, `src`, `srcset`, `alt`,
  `title`, `width`, `height`, `viewBox`, `fill`, `stroke`, `stroke-width`,
  `stroke-linecap`, `stroke-linejoin`, `d`, `cx`, `cy`, `r`, `x`, `y`, `x1`,
  `y1`, `x2`, `y2`, `points`, `rx`, `ry`, `type`, `placeholder`, `role`,
  `aria-*`, `data-*`, `offset`, `stop-color`.
- **Never** any `on*`. Reject `href`/`src` not matching
  `^(#|/|https:|data:image/(png|jpe?g|gif|webp|svg\+xml);base64,)`.
- `style` attribute values run through the CSS-declaration sanitizer (below);
  the built-ins legitimately use `style="background:linear-gradient(…)"` and
  `style="width:86%"`, so it cannot simply be dropped.

**CSS.** `scopeModuleCss()` (`public/modules.js:537`) already brace-matches
correctly with string/comment awareness, and I checked the obvious break-out
(`css: "} body { display:none } .x {"` → yields the invalid selector
`.dmb-module } body`, which the CSS parser discards). But there **is** a real
hole: brace-less at-rules. `@import "https://evil/x.css";` sits in a rule's
*prelude*, hits the `head.trim().startsWith("@")` branch, and is emitted
**unscoped** — so an imported sheet's rules escape the `.dmb-module` scope
entirely and every viewer's browser pings the attacker on gallery render.

Server-side, therefore, strip: `@import`, `@charset`, `@namespace`,
`@document`, and any `url()` whose target isn't `data:image/*`. Also cap sizes
(`html` ≤ 64 KB, `css` ≤ 32 KB, `name` ≤ 48, `desc` ≤ 140) — the DB will
happily store a 10 MB widget that then wedges every gallery render.

Add the `@import` case to the client `scopeModuleCss` tests too; it's a latent
bug in today's code, not just a hosted-mode one.

### 5.5 `validate.py` — server-side validation without duplicating the whole validator

`validateModuleDef()` (`public/modules.js:440`) deliberately splits **errors**
(would break or collide) from **warnings** (would look wrong on a client's
page). Warnings are heuristic, opinionated, and non-blocking — they belong in
the authoring UI, not in the API.

**Port only the error-level checks to Python** (~40 lines): id present and
matching `^[a-z0-9][a-z0-9-]{0,39}$`, name present, html present, no
`<script>`, no `<html|head|body>`, size caps, slug not reserved, slug not
already taken. Keep the six warning heuristics client-only.

**Prevent drift with a shared fixture file**, `tests/fixtures/widget_validation.json`:

```json
[
  {"case": "script tag rejected",
   "def": {"id": "x", "name": "X", "html": "<div><script>1</script></div>"},
   "errors": ["script"]},
  {"case": "valid minimal", "def": {"id": "x", "name": "X",
   "html": "<div class=\"dmbm-wrap\">hi</div>"}, "errors": []}
]
```

`tests/test_validate.py` asserts the Python validator against it;
`public/tests.html` asserts the JS validator against the same file. When the
two diverge, CI says so.

### 5.6 Storage layer — one interface, two backends

`store/base.py` defines the interface (plain base class with
`NotImplementedError`; `typing.Protocol` exists in 3.9 but a base class is
simpler to keep 3.9-clean):

```python
class Store:
    # users
    def upsert_user(self, email, name, picture_url, is_admin): ...
    def get_user(self, user_id): ...
    # sessions
    def create_session(self, user_id, token_hash, expires_at, ua, ip_hash): ...
    def get_session(self, token_hash): ...          # → {session, user} or None
    def delete_session(self, token_hash): ...
    def purge_expired(self): ...
    # oauth
    def put_oauth_state(self, state, verifier, redirect_to, expires_at): ...
    def take_oauth_state(self, state): ...          # single-use: read + delete
    # widgets
    def list_widgets(self, viewer_id): ...          # published + viewer's drafts
    def get_widget(self, slug, viewer_id): ...
    def create_widget(self, def_, author_id, status): ...
    def update_widget(self, slug, patch, expected_version, actor_id): ...
    def set_widget_status(self, slug, status, actor_id): ...
    def soft_delete_widget(self, slug, actor_id): ...
    def list_versions(self, slug): ...
    def restore_version(self, slug, version, actor_id): ...
    def is_slug_reserved(self, slug): ...
    # ops
    def log_audit(self, actor_id, action, entity, entity_id, detail): ...
    def log_proxy(self, user_id, host, status, bytes_, ms): ...
    def count_proxy_since(self, user_id, since): ...
    def ping(self): ...
```

**`SqliteStore`** — stdlib `sqlite3`. Non-obvious requirements, all of which
bite under `ThreadingHTTPServer`:
- `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`,
  `PRAGMA foreign_keys=ON`, `PRAGMA synchronous=NORMAL`.
- **One connection per thread** via `threading.local()` — a shared connection
  with `check_same_thread=False` and no locking will corrupt or raise.
- Timestamps as ISO-8601 UTC strings (`datetime.now(timezone.utc).isoformat()`),
  compared lexicographically. Consistent, sortable, dialect-portable.

**`PostgresStore`** — `psycopg` 3, imported lazily:

```python
class PostgresStore(Store):
    def __init__(self, dsn, min_size=1, max_size=8):
        import psycopg_pool          # container-only dependency
        self._pool = psycopg_pool.ConnectionPool(dsn, min_size=min_size, max_size=max_size)
```

Shared discipline so the two don't diverge:
- **Generate all ids in Python** (`uuid.uuid4()`, `secrets.token_urlsafe`) —
  no `gen_random_uuid()`/`AUTOINCREMENT` defaults to reconcile.
- Paramstyle differs (`?` vs `%s`). Either normalize in `base.py` with a tiny
  `q()` rewriter, or keep SQL strings inside each backend. **Keep them
  separate** — clever SQL rewriting is where these projects rot.
- **`desc` is a reserved word in Postgres.** Name the column `description` in
  both schemas and map it to `desc` at the API boundary, where `app.js`
  expects it. Cheap now, painful later.

**Contract tests** (`tests/test_store_contract.py`): one test class,
parametrized over both backends. SQLite always runs; Postgres runs only when
`TEST_DATABASE_URL` is set (so it runs in CI and in the container, and skips on
the Mac). This suite is what makes "hybrid" safe rather than a slow-motion
divergence.

### 5.7 Schema

Postgres (`migrations/postgres/0001_init.sql`); the SQLite version is the same
shape with `text` ids, `text` timestamps, `text` instead of `jsonb`, and
`integer primary key autoincrement` for the log tables.

```sql
create table users (
  id           text primary key,
  email        text not null unique,
  name         text not null default '',
  picture_url  text not null default '',
  role         text not null default 'member',
  created_at   timestamptz not null,
  last_seen_at timestamptz,
  constraint users_role_ck check (role in ('member','admin'))
);

create table widgets (
  id           text primary key,
  slug         text not null,
  name         text not null,
  description  text not null default '',   -- NOT "desc": reserved in Postgres
  html         text not null,
  css          text not null default '',
  status       text not null,
  version      integer not null default 1,
  author_id    text not null references users(id),
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  published_at timestamptz,
  deleted_at   timestamptz,
  constraint widgets_status_ck check (status in ('draft','published','archived'))
);
-- slug is globally unique among live widgets, drafts included: this makes the
-- collision check identical to today's moduleById() check and stops a rep
-- discovering at publish time that someone took their slug.
create unique index widgets_slug_live on widgets (slug) where deleted_at is null;
create index widgets_status_updated on widgets (status, updated_at desc);
create index widgets_author on widgets (author_id);

create table widget_versions (
  id          text primary key,
  widget_id   text not null references widgets(id) on delete cascade,
  version     integer not null,
  name        text not null,
  description text not null default '',
  html        text not null,
  css         text not null default '',
  status      text not null,
  editor_id   text not null references users(id),
  note        text not null default '',
  created_at  timestamptz not null,
  unique (widget_id, version)
);

create table sessions (
  id         text primary key,     -- sha256(token); the raw token is cookie-only
  user_id    text not null references users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  user_agent text not null default '',
  ip_hash    text not null default ''
);
create index sessions_expires on sessions (expires_at);

create table oauth_states (
  state         text primary key,
  code_verifier text not null,
  redirect_to   text not null default '/',
  created_at    timestamptz not null,
  expires_at    timestamptz not null
);

-- Built-in and file-route widget ids, so the API can't hand out a slug that
-- collides with code-owned widgets. Seeded by migration; kept honest by
-- tests/test_builtin_slug_drift.py.
create table reserved_slugs (slug text primary key, reason text not null);

create table audit_log (
  id         bigserial primary key,
  actor_id   text references users(id),
  action     text not null,
  entity     text not null,
  entity_id  text,
  detail     jsonb not null default '{}',
  created_at timestamptz not null
);

create table proxy_log (
  id         bigserial primary key,
  user_id    text references users(id),
  host       text not null,
  status     integer,
  bytes      integer,
  ms         integer,
  created_at timestamptz not null
);
create index proxy_log_user_time on proxy_log (user_id, created_at desc);
```

**Store sessions hashed.** The cookie holds `secrets.token_urlsafe(32)`; the DB
holds `sha256(token)`. A leaked dump then grants nothing.

**Built-ins stay in code, not in the DB.** Rationale: they are the offline
fallback when the API is down mid-demo, their CSS is hand-scoped inside
`DEMO_MODULE_CSS` (CLAUDE.md §5.8 — built-in CSS is deliberately *not* run
through `scopeModuleCss`), and seeding them would create two sources of truth.
The DB holds user widgets only. Precedence on slug collision:
**builtin > file (`custom-modules.js`) > published > own draft**, enforced by
`reserved_slugs` server-side and by `moduleById()` client-side.

`tests/test_builtin_slug_drift.py` regexes `public/modules.js` for
`^\s*id: "([a-z0-9-]+)"` and asserts the set matches the seeded
`reserved_slugs` rows — so adding a 12th built-in without a migration fails CI
instead of silently allowing a collision.

**Migrations** are numbered files applied in order by `store/migrate.py`,
tracked in `schema_migrations (version, applied_at, checksum)`. Forward-only
and additive by default; every migration gets a `-- down:` comment block
documenting the reversal even if it isn't automated. Run on startup in local
mode; run as an explicit `deploy/entrypoint.sh` step before the server binds in
hosted mode (so a bad migration fails the release rather than half-serving).

### 5.8 Auth — Google OIDC with **no cryptography dependency**

The non-obvious part: verifying a Google `id_token` JWT needs RSA signature
verification, which is **not** in the stdlib. The way around it is to never
parse the JWT:

1. `GET /api/auth/google/start`
   - `state = secrets.token_urlsafe(24)`,
     `code_verifier = secrets.token_urlsafe(48)`,
     `code_challenge = b64url(sha256(verifier)).rstrip('=')` — PKCE S256 with
     only `hashlib` + `base64`.
   - Persist `{state, verifier, redirect_to}` in `oauth_states` with a 10-min
     TTL (a DB row rather than a cookie, so it works across machines).
   - 302 to `https://accounts.google.com/o/oauth2/v2/auth` with
     `client_id`, `redirect_uri`, `response_type=code`,
     `scope=openid email profile`, `state`, `code_challenge`,
     `code_challenge_method=S256`, `hd=<domain>` (a UX hint, **not** a
     security control), `prompt=select_account`.
2. `GET /api/auth/google/callback?code=…&state=…`
   - `take_oauth_state(state)` — single-use read-and-delete. Missing/expired →
     400.
   - POST to `https://oauth2.googleapis.com/token` via `urllib` with
     `code`, `client_id`, `client_secret`, `redirect_uri`,
     `grant_type=authorization_code`, `code_verifier`.
   - **Then call `https://openidconnect.googleapis.com/v1/userinfo` with the
     access token** instead of decoding the id_token. The response arrives over
     a TLS connection to Google that we initiated, so it needs no signature
     check — and we skip JWT/RSA entirely. (OIDC Core §3.1.3.7 permits omitting
     id_token signature validation when the client obtains the token directly
     from the token endpoint over TLS.)
   - Require `email_verified === true` and
     `email.split('@')[1] in DMB_ALLOWED_DOMAINS`. Reject otherwise with a
     clear "this app is limited to @yourcorp.com accounts" page.
   - `upsert_user`, `create_session`, set the cookie, 302 to `redirect_to`.

**Cookie:** `__Host-dmb_session=<token>; Secure; HttpOnly; SameSite=Lax;
Path=/`. The `__Host-` prefix forbids a `Domain` attribute, so the cookie is
never sent to subdomains — which matters if you later add per-session render
subdomains (Phase 8). In local mode over plain HTTP the `__Host-` prefix and
`Secure` are invalid, so use a plain `dmb_session` name there; put the naming
in one helper, not scattered.

**Iframe cookie check:** the `/proxy` request from `#canvas` is a *same-site*
subresource navigation, so a `SameSite=Lax` cookie **is** sent. Verified
reasoning, but re-test it in Safari specifically — its ITP has surprised people
here before.

**CSRF:** session cookie is `SameSite=Lax`, and additionally every
state-changing request must (a) carry `Origin`/`Sec-Fetch-Site` matching the
app origin, and (b) send an `X-DMB-CSRF: 1` custom header — a header a
cross-site form cannot set without a preflight. Reject on failure with 403.

**Local dev bypass:** `DMB_DEV_USER=you@corp.com` synthesizes a session on
first request. `config.py` must `assert mode != "hosted"` when it's set.

**Authorization matrix** (`tests/test_api.py` should assert every cell):

| Action | Author | Other member | Admin | Anon |
|---|---|---|---|---|
| list published | ✅ | ✅ | ✅ | ❌ 401 |
| list own drafts | ✅ | n/a | ✅ (own only) | ❌ |
| read others' drafts | n/a | ❌ 404 | ✅ | ❌ |
| create | ✅ | ✅ | ✅ | ❌ |
| update | ✅ | ❌ 403 | ✅ | ❌ |
| publish / unpublish | ✅ | ❌ | ✅ | ❌ |
| delete (soft) | ✅ | ❌ | ✅ | ❌ |
| restore version | ✅ | ❌ | ✅ | ❌ |
| `/proxy` | ✅ | ✅ | ✅ | ❌ 401 |

Others' drafts return **404, not 403** — a 403 leaks that the slug exists.

### 5.9 API

All JSON, all `Cache-Control: no-store`, all require a session except
`/api/config` and the auth endpoints.

```
GET    /api/config                 → {mode, googleSignInUrl, features:{jsMode}}
GET    /api/me                     → {id,email,name,picture,role} | 401
POST   /api/auth/logout            → 204, clears cookie, deletes session row
GET    /api/auth/google/start      → 302
GET    /api/auth/google/callback   → 302

GET    /api/widgets                → {widgets:[…], etag}
POST   /api/widgets                → 201 {widget}        (status defaults to draft)
GET    /api/widgets/:slug          → {widget}
PUT    /api/widgets/:slug          → {widget}   body includes expectedVersion
POST   /api/widgets/:slug/publish  → {widget}
POST   /api/widgets/:slug/unpublish→ {widget}
DELETE /api/widgets/:slug          → 204 (soft)
GET    /api/widgets/:slug/versions → {versions:[…]}
POST   /api/widgets/:slug/restore  → {widget}   body {version}
GET    /api/widgets/export         → JSON dump (admin)

GET    /proxy?url=…[&scripts=1]    → HTML (contract unchanged)
GET    /healthz                    → 200 "ok"  (no DB touch — Fly health check)
GET    /readyz                     → 200 if store.ping() succeeds
```

Widget JSON shape — deliberately a superset of today's def so `insertModule`,
`buildGalleryCard` and `moduleById` keep working:

```json
{
  "id": "loyalty-points",           // slug — the client-facing identity, unchanged
  "name": "Loyalty Points Banner",
  "desc": "Points earned on this purchase",
  "html": "<div class=\"dmbm-wrap\">…</div>",
  "css": ".dmbm-lp { … }",
  "source": "global",               // was: builtin | file | local. Adds: global | draft
  "builtin": false,
  "status": "published",
  "version": 3,
  "author": {"id": "…", "name": "Leonardo V.", "email": "…"},
  "updatedAt": "2026-08-03T10:12:00Z",
  "canEdit": true                   // server-computed; the client must not guess
}
```

`canEdit` computed server-side is the important bit: `buildGalleryCard`
currently gates the ✎/✕ buttons on `def.source === "local"`
(`public/app.js:150`). Replace that with `def.canEdit` rather than reimplementing
the authorization rule in the browser.

**Optimistic concurrency:** `PUT` carries `expectedVersion`; a mismatch returns
`409` with the current widget in the body so the dialog can say "Ana edited
this widget 4 minutes ago" and offer *Overwrite* / *Reload* / *Save as copy*.
Two reps editing the shared library is now a routine event, not an edge case.

**Error envelope:** `{"error": {"code": "slug_taken", "message": "…",
"fields": {"id": "…"}}}` — the widget dialog already renders a list of issues
(`wzIssue`), so server errors should land in the same UI, not an `alert()`.

### 5.10 Client changes

`public/api.js` (new) — a ~60-line wrapper: base URL, `credentials: 'same-origin'`,
`X-DMB-CSRF` header, JSON encode/decode, error mapping, 401 → show sign-in gate.

`public/modules.js`:
- Keep `DEMO_MODULES`, `registerModule`, `updateModule`, `unregisterModule`,
  `validateModuleDef`, `scopeModuleCss` exactly as they are. They already model
  "the gallery list is mutable and rebuilt from a source" — that is precisely
  the seam an API needs, so **the registry does not need rearchitecting.**
- Extend the `source` vocabulary: `builtin | file | local | global | draft`.
- Add `replaceRemoteWidgets(list)` — clears entries whose source is
  `global`/`draft` and re-registers from the API payload, then fires
  `MODULE_HOOKS.onChange` **once**. Startup must still draw the gallery a
  single time (CLAUDE.md §5.8).
- Fix the `@import` scoping hole in `scopeModuleCss` (§5.4).

`public/app.js`:
- `loadStoredWidgets()` → `loadWidgets()`: fetch `/api/widgets`, then
  `replaceRemoteWidgets`. On failure, fall back to the localStorage cache and
  show a non-blocking banner. **Never white-screen mid-demo** — a rep on a call
  with a flaky hotel wifi must still get built-ins plus whatever was cached.
- Cache the last successful payload in `localStorage` under
  `dmb.widgetCache.v1` for exactly that fallback.
- `wzSave()` becomes async: disable the button, spinner, `409` conflict
  handling, server errors rendered through `wzIssue`.
- `deleteWidget()` → `DELETE /api/widgets/:slug`; keep the existing "copies
  already dropped on the page stay where they are" semantics (CLAUDE.md §5.8 —
  yanking a widget mid-demo is worse than an orphan).
- `persistLocalWidgets()` survives, but only as the offline cache writer.
- New: Draft/Published state in the dialog, a **Publish** button, author
  attribution on cards, and gallery filter chips — *All · Published · My
  drafts · Mine*.
- New: sign-in gate. `/api/me` 401 → overlay with a "Sign in with Google"
  button; everything else stays inert behind it.
- Extend `window.DMB` with `api`, `loadWidgets`, `publishWidget`, `me` —
  CLAUDE.md §5.7's rule (this surface is how E2E testing happens) applies
  doubly now that flows are async.

**One-time migration of existing localStorage widgets.** Anyone already using
the tool has widgets in `dmb.customWidgets.v1`. On first authenticated load,
if that key holds entries whose slugs aren't in the API response, show:

> You have 3 widgets saved in this browser. Publish them to the team library?
> [Publish all as drafts] [Keep local] [Ask me later]

POST each as a draft, then set `dmb.customWidgets.migrated.v1`. Do **not**
auto-publish, and do **not** delete the local copies — a rep's private
half-finished widget appearing in the team gallery unannounced is a bad first
impression of the hosted version.

`public/index.html`:
- `<iframe id="canvas" sandbox="allow-same-origin">` in hosted mode (injected
  or toggled from `/api/config`; local mode omits it so `scripts=1` still
  works).
- Sign-in gate markup; user avatar/menu in the topbar; gallery filter chips.
- Hide the JS checkbox when `features.jsMode` is false.
- Remove every inline handler so `script-src 'self'` can be applied (the file
  is already clean — all three `<script src>` tags are external — but the
  **widget HTML** is not; see Risk 2 layer 4).
- Add `<script src="api.js">` before `app.js`.

`public/modules.js` + `custom-modules.js` + `WIDGETS.md`: replace
`onclick="return false"` on demo anchors with
`<span class="dmbm-btn" role="button">`. Add a validator warning for inline
handlers so authored widgets don't reintroduce them.

### 5.11 Serving, caching, concurrency

- `protocol_version = "HTTP/1.1"` on the handler (currently HTTP/1.0 by
  default — every response closes the connection, which is wasteful over the
  internet). **This requires an accurate `Content-Length` on every response**,
  or clients hang. `send_text` already sets it; audit the static-file path and
  every new API response.
- **Split the global `Cache-Control: no-store`.** CLAUDE.md §8 bug 2 exists
  because `SimpleHTTPRequestHandler` sends `Last-Modified` and browsers cache
  aggressively during development. The fix must not be thrown away: keep
  `no-store` for everything in local mode and for `/api/*` + `/proxy` always;
  serve hashed static assets (`app.7f3c1a.js`) with
  `Cache-Control: public, max-age=31536000, immutable` in hosted mode. Hashing
  needs a tiny build step — a stdlib Python script that copies `public/` to
  `public-dist/` with content-hashed names and rewrites the references in
  `index.html`. If that feels like too much for Phase 6, ship
  `max-age=300, must-revalidate` instead and defer hashing to Phase 7.
- **Bound the thread pool.** `ThreadingHTTPServer` spawns an unbounded thread
  per connection and each `/proxy` fetch can hold one for 20 s. Add a
  `threading.BoundedSemaphore` around the proxy handler (e.g. 8 concurrent
  fetches) returning `503` with `Retry-After` when saturated, and set Fly's
  `soft_limit`/`hard_limit` concurrency so the edge queues rather than the
  process melting.
- **Rate limits** (`ratelimit.py`): per-user token bucket on `/proxy`
  (`DMB_PROXY_RPM`/`_RPH`), plus a per-target-host politeness delay. An
  in-process bucket is fine **only with a single machine** — set
  `min_machines_running = 1` and `max_machines = 1` in Phase 6, and if you ever
  scale out, move the counter to the `proxy_log` table
  (`count_proxy_since`) or Redis. Write that caveat in the code, not just here.
- **Optional short-TTL fetch cache** (Phase 7): key on `url + scripts`, 60 s
  TTL, response body only, **no per-user data in the cached value**. Two reps
  demoing the same store stop double-fetching, which also reduces bot-flagging.

### 5.12 Observability & ops

- Structured JSON logs to stdout (Fly aggregates them): `{ts, level, req_id,
  route, user_id, status, ms}`, plus a proxy-specific line `{host, status,
  bytes, ms, blocked_reason}`. Replace `log_message`'s stderr string.
- `/healthz` (no DB) for the Fly TCP/HTTP check; `/readyz` (DB ping) for deploy
  gating.
- Alerts worth having on day one: proxy 5xx rate, proxy *block* rate by host
  (this is your early warning for Risk 1), auth failure rate, DB error rate,
  p95 latency.
- Sentry is optional and container-only (a pip dep) — behind
  `SENTRY_DSN`, imported lazily like psycopg.
- **Backups:** managed PITR from the DB provider **plus** a nightly logical
  dump. Because the whole library is small, the cheapest robust option is a
  GitHub Action that hits `GET /api/widgets/export` with an admin token and
  commits/uploads the JSON. `scripts/export_widgets.py` does the same locally.
  Never let the library be trapped in one Postgres instance.
- **Legal/privacy, briefly but really:** the app fetches and re-serves
  third-party pages — add an internal-use notice, honor a domain blocklist, set
  `X-Robots-Tag: noindex`, and don't persist proxied HTML. You now store user
  emails and IP hashes: add a one-paragraph privacy note and a delete-my-data
  path (`DELETE /api/me`, admin-triggered is fine for a small team).

---

## 6. Managed Postgres choice

Fly Postgres is *unmanaged* — you own failover, backups and upgrades. For a
small sales team, do not accept that operational load.

**Recommendation: Neon** (or Supabase). Both give managed backups/PITR,
connect over public TLS from a Fly machine, and have a free tier that this
workload fits inside comfortably (the whole widget library will be a few MB).
Neon's branching is genuinely useful here: a staging branch of prod data costs
nothing and makes migration rehearsals real. Put the DB in the same region as
the Fly machine and keep `sslmode=require`.

If a later requirement forces the DB inside the private network, the SSRF guard
must block `fdaa::/16` — which §5.2 already does, so that path stays open.

---

## 7. Phases

Each phase is independently shippable and leaves the app working. Effort is in
focused Claude sessions.

### Phase 0 — Repo hygiene (~0.3 session)
**This directory is not a git repository yet.** Nothing else should start
before it is.
- `git init`, initial commit of the current working state (it's a good state —
  commit it before refactoring).
- `.gitignore`: `var/`, `*.sqlite3*`, `.env`, `public-dist/`, `.DS_Store`
  (there's one in the directory now), `__pycache__/`.
- `.env.example` documenting every var from §5.1. **No real secrets in git,
  ever** — Fly secrets and GitHub Actions secrets only.
- Move this file's decisions into CLAUDE.md as a "hosted mode" section stub.

**Acceptance:** `git log` shows one commit; `python3 server.py` still works.

### Phase 1 — Restructure the server, behavior-identical (~1 session)
Split `server.py` into the `dmb/` package (§4) with **zero behavior change**.
`config.py` lands here with local defaults. `store/` is created with the
interface, `SqliteStore`, migration runner, and `0001_init.sql` — but nothing
uses it yet.
- Keep `server.py` as the shim.
- Add `tests/test_proxy_rewrite.py` covering today's five rewrite passes as a
  regression net *before* touching them in Phase 2.

**Acceptance:** `python3 -m unittest discover tests` green on 3.9;
`python3 server.py` → load Allbirds → same section count as before
(CLAUDE.md §7 step 2 — the 2026-08 note says ~9 top-level sections for their
current theme; a count near 9 is the site, not a regression); the proxy smoke
`curl` from CLAUDE.md §7 step 6 returns 200.
**Rollback:** revert the commit; nothing external changed.

### Phase 2 — Security hardening, still local (~1.5 sessions)
`guard.py`, the extra rewrite passes, the CSP headers, `sanitize.py`, size and
time caps, the manual redirect loop, `DMB_ALLOW_INSECURE_TLS` gating, the
iframe `sandbox` attribute, the `onclick="return false"` removal, and the
`@import` scoping fix.

**Acceptance:** `tests/test_guard.py` table green (including the redirect-to-
private-IP and rebinding cases); Allbirds/Brooklinen/Death Wish Coffee all
still render *with images and fonts*; hover chip, drag-drop, adapt/revert all
still work with `sandbox="allow-same-origin"` **and** the CSP applied — this is
the highest-risk regression point in the whole plan, so verify it manually with
a real mouse, not just synthetically (CLAUDE.md §7's hover caveat).
**Rollback:** each control is env-gated; flip off individually.

### Phase 3 — Storage layer live (~1.5 sessions)
Wire `SqliteStore` into a real code path: `reserved_slugs` seeding,
`audit_log`, `proxy_log`, and the migration runner on startup.
`PostgresStore` written in the same session, exercised only by the contract
tests against a `TEST_DATABASE_URL` (a throwaway Neon branch).

**Acceptance:** `test_store_contract.py` green on SQLite locally and on
Postgres in CI; `test_builtin_slug_drift.py` green; migrations apply cleanly
from empty **and** are idempotent on re-run.

### Phase 4 — Auth (~1.5 sessions)
`sessions.py`, `routes_auth.py`, the Google Cloud OAuth client (redirect URIs
for prod *and* `http://localhost:4173` — Google permits http for localhost),
domain restriction, admin seeding, the sign-in gate in the client, CSRF, and
`DMB_DEV_USER`.

**Acceptance:** sign in with an in-domain account → session cookie set,
`/api/me` returns the user; an out-of-domain account is rejected with a clear
message; logout deletes the row; `/proxy` returns 401 anonymously in hosted
mode; the authorization matrix test (§5.8) is green;
`DMB_DEV_USER` + `DMB_MODE=hosted` **refuses to boot**.

### Phase 5 — Widget API + client rewiring (~2 sessions)
All `/api/widgets*` endpoints, `public/api.js`, the async dialog, drafts and
publishing, filter chips, author attribution, `canEdit`, 409 conflict UX, the
offline cache, and the one-time localStorage migration.

**Acceptance:** two browser profiles signed in as different users — A creates a
draft (invisible to B), publishes it (B sees it after refresh), B cannot edit
it (no ✎ button, and a direct `PUT` returns 403), A edits while B has it open
(B gets 409 with the conflict UI); killing the API mid-session leaves the
gallery on built-ins + cache with a banner and no console errors; every
CLAUDE.md §7 step 5b console check still passes against the API-backed
registry.

### Phase 6 — Deploy (~1 session)
`Dockerfile` (python:3.12-slim, non-root user, `requirements.txt` with
`psycopg[binary]` + `psycopg_pool`), `.dockerignore`, `fly.toml`,
`entrypoint.sh` (migrate → serve), Neon project + staging branch, `fly secrets
set …`, custom domain + TLS certificate, `min/max_machines_running = 1`,
health checks, `scripts/smoke.sh`, GitHub Actions CI (unit tests on 3.9 + 3.12,
build, deploy to staging on `main`, manual promote to prod), and the
paste/upload-HTML fallback for blocked stores (Risk 1).

**Acceptance:** staging URL loads over HTTPS, Google sign-in works end-to-end,
a widget created on staging survives a machine restart, `smoke.sh` green, a
deliberate bad migration fails the release *before* traffic shifts,
`fly deploy --image <previous>` rolls back cleanly.

### Phase 7 — Scale & polish (~1.5 sessions)
Gallery search + `IntersectionObserver`-deferred thumbnails (200 widgets ×
live-HTML thumbnails in the DOM will crawl otherwise), ETag/304 on
`/api/widgets`, version history UI + restore, admin view, sandboxed-iframe
thumbnails, hashed static assets + immutable caching, the short-TTL proxy
cache, dashboards/alerts.

### Phase 8 — Optional, decide with real data (~2+ sessions each)
- **Client-side DOM capture** (extension/bookmarklet) — kills Risk 1 *and*
  CLAUDE.md §9's SPA limitation. The strategically best item on this list.
- **Sandboxed render origin** — app shell served from a random per-session
  subdomain that holds no credentials, control frame on the main origin,
  `postMessage` bridge. This is the only genuinely safe way to restore
  `scripts=1` in hosted mode. It deletes CLAUDE.md §3's "single biggest
  simplifier", so it needs a real justification: measured demand for JS mode.
  Requires a wildcard DNS record and a wildcard TLS cert.
- **Saved & shared demos** — the top item in CLAUDE.md §10, and hosting is what
  makes it worth building. The schema is already sketched there: `{url, hidden
  section ids, demos:[{moduleId, anchor dmb-id, where, adapted, bg}]}`. Add a
  `demos` table with a `share_token` and a read-only replay view; a shareable
  "here's what your PDP looks like with our modules" link is a genuinely new
  sales capability, not just a convenience.

**Fast path to a hosted MVP:** Phases 0 → 1 → 2 → 3 → 4 → 5 → 6, roughly
**8–9 sessions**. Full plan through Phase 7: **~10–11**.

---

## 8. Regression watchlist

Things that worked locally and can quietly break hosted. Check each one
explicitly; several are subtle.

| # | Risk | Where | Check |
|---|---|---|---|
| 1 | CSP/sandbox breaks section detection or the hover chip | Phase 2 | Manual real-mouse hover + drag on all three sample stores |
| 2 | `onclick="return false"` widgets break under `script-src 'self'` | Phase 2 | UGC gallery card + STARTER_HTML render and don't jump the page |
| 3 | Mixed content: `http://` store assets blocked on an HTTPS host | Phase 2/6 | Find an http-only store; confirm `upgrade-insecure-requests` handles it |
| 4 | Datacenter IP blocked where home IP wasn't | Phase 6 | Run CLAUDE.md §7's sample set from staging, log the block rate |
| 5 | `Cache-Control` split serves stale JS after deploy | Phase 6 | Hard-reload-free deploy picks up new `app.js` |
| 6 | HTTP/1.1 without correct `Content-Length` hangs clients | Phase 1 | `curl -v` every route; watch for hangs on 204/304 |
| 7 | SQLite threading corruption under `ThreadingHTTPServer` | Phase 3 | Concurrent-write test; assert thread-local connections |
| 8 | `desc` reserved word in Postgres | Phase 3 | Contract tests on both backends |
| 9 | `import psycopg` at module top level breaks local boot | Phase 3 | `python3 server.py` on the Mac with no pip packages |
| 10 | Startup renders the gallery twice (CLAUDE.md §5.8) | Phase 5 | One `renderGallery()` call on load; count it |
| 11 | Async `wzSave` double-submits on fast double-click | Phase 5 | Button disabled while in flight |
| 12 | Live-inserted instances unlink from a def after an API refresh | Phase 5 | `updateModule` must keep mutating **in place** (CLAUDE.md §5.8) |
| 13 | `SameSite=Lax` cookie not sent on the iframe `/proxy` request | Phase 4 | Test in Safari specifically, not just Chrome |
| 14 | 700 ms `initPage()` delay too short over the internet | Phase 6 | Detection quality on a cold cache; raise the delay, don't remove it |
| 15 | Google fonts/CDN CORS differs from localhost | Phase 6 | Brooklinen's serif headings still sample correctly |
| 16 | Unbounded thread growth under concurrent demos | Phase 6 | 10 simultaneous page loads; watch RSS and thread count |
| 17 | Rate-limit counters wrong if Fly scales to 2 machines | Phase 6 | Pin `max_machines_running = 1`, assert it in `fly.toml` |

---

## 9. Testing strategy

**Python (`unittest`, stdlib — no test runner to install):**
`test_guard.py` (the URL table), `test_proxy_rewrite.py` (all rewrite passes,
including the XSS vectors: `<img onerror>`, `javascript:` href, `srcdoc`),
`test_sanitize.py` (HTML allowlist, `@import` stripping, size caps),
`test_validate.py` (against the shared fixtures), `test_store_contract.py`
(both backends), `test_api.py` (the authorization matrix, 409 conflicts, error
envelope), `test_auth.py` (against a fake IdP served by a local
`ThreadingHTTPServer`), `test_builtin_slug_drift.py`.

**JavaScript — there is no npm on this machine**, so use `public/tests.html`:
a plain page that loads `modules.js`, runs assertions for `scopeModuleCss`
(including the `content: "}"`, nested at-rule, pre-scoped and `@import` cases
CLAUDE.md §5.8 mentions), `validateModuleDef` (shared fixtures), and
`slugifyModuleId`, then prints PASS/FAIL and sets `window.__TEST_RESULT__`. It
is human-openable and drivable from the preview tools, and it costs zero
dependencies — which fits this project's ethos better than importing a runner.

**E2E:** extend CLAUDE.md §7's console-driven recipe with an auth step and the
API checks from Phase 5's acceptance criteria. Keep driving through
`window.DMB` — synthetic hover genuinely does not penetrate iframes
(CLAUDE.md §7), so don't chase that as a bug.

**CI:** unit tests on 3.9 **and** 3.12, `python -m compileall` as a syntax
gate, Postgres contract tests against a Neon test branch, Docker build,
`tests.html` in a headless browser if one is available in CI, deploy to
staging on `main`, manual promote to prod.

---

## 10. Cost

| Item | Monthly |
|---|---|
| Fly `shared-cpu-1x`, 1 GB, 1 machine always on | ~$6 |
| Neon (free tier likely sufficient; Launch if not) | $0–19 |
| Domain | ~$1 (amortized) |
| Google OAuth | $0 |
| Sentry (optional, free tier) | $0 |
| **Total** | **~$7–26** |

Residential proxy egress, if Risk 1 forces it, adds $5–15/GB — page HTML is
small (~100–500 KB), so a few hundred demos a month is a few dollars. A
headless-browser service is the expensive branch; don't take it speculatively.

---

## 11. Open questions for the implementing session

Answer these at the start of Phase 6 (they don't block Phases 0–5):

1. **Domain** for the app — e.g. `demo.yourcorp.com`? Who controls its DNS?
2. **Google Workspace domain(s)** for `DMB_ALLOWED_DOMAINS`, and who can create
   the OAuth client in Google Cloud Console (needs project access)?
3. **Initial admin emails** for `DMB_ADMIN_EMAILS`.
4. **Fly region** — put it near the sales team (`iad`, `lhr`, `fra`, …). The
   proxy also benefits from being near the *stores*, but rep latency matters
   more for the UI.
5. **Keep the `custom-modules.js` file route?** Recommendation: yes — it's the
   offline/code-owned escape hatch and the DB's fallback, and it costs nothing
   to keep. Update WIDGETS.md to describe *three* routes with precedence
   builtin > file > published > draft.
6. **Should the library be visible outside the domain** (e.g. a read-only
   public gallery for marketing)? Affects whether `/api/widgets` needs an
   anonymous published-only mode.
7. **Retention:** how long to keep `proxy_log` and `audit_log`? Suggest 90 days
   with a nightly purge, which also keeps the free-tier DB small.

---

## 12. Documentation to update when this lands

- **CLAUDE.md** — §2 gains hosted-mode run instructions and the `DMB_MODE`
  table; §3 gains the security reasoning from Risk 2 (the same-origin
  invariant now has *conditions*, and future sessions must know why the sandbox
  attribute and CSP are load-bearing rather than decorative); §5 gains the new
  components; §6's state model gains `me`/`widgetsSource`; §8 gains the new
  bug list; §9's limitations change materially (bot blocking gets worse, JS
  mode goes away in hosted, session state stops being ephemeral); §10's
  backlog loses "custom modules" and gains the Phase 8 items.
- **README.md** — hosted URL + sign-in as the primary path, `python3 server.py`
  kept as the local/offline path, and the honest note that some stores block
  the hosted proxy where local worked.
- **WIDGETS.md** — three routes and their precedence, drafts vs published, the
  sanitizer's allowlist (authors need to know which tags survive), the new
  inline-handler prohibition, and "your widget is now visible to the whole
  team" as an authoring consideration.
- **This file** — mark phases done as they land, or delete it once CLAUDE.md
  absorbs the content.
