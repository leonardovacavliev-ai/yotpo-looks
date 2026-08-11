"""Shared proxy logic — the one implementation behind both entry points.

Two callers, one code path:

  * ``server.py``      — local dev, ``python3 server.py`` on the Mac (§2)
  * ``api/proxy.py``   — the hosted Vercel serverless function

The leading underscore matters: Vercel's Python builder treats ``api/_*.py`` as
an importable helper rather than a route, which is exactly what this is.

Standard library only, and **3.9-compatible syntax** — local is the Mac's
system Python 3.9.6, the container runs 3.12, and the same file has to parse on
both (no ``match``, no ``X | Y`` unions, no builtin generics at runtime).
"""
import gzip
import hashlib
import json
import os
import re
import ssl
import time
import zlib
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

FETCH_TIMEOUT = 20  # under Vercel's function ceiling, with room for the response

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    # br is intentionally excluded: stdlib can't decode brotli
    "Accept-Encoding": "gzip, deflate",
    "Upgrade-Insecure-Requests": "1",
}

SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.I | re.S)
SCRIPT_SELF_CLOSE_RE = re.compile(r"<script\b[^>]*/\s*>", re.I)
META_BLOCK_RE = re.compile(
    r"<meta[^>]+http-equiv\s*=\s*[\"']?(?:content-security-policy|refresh|x-frame-options)[^>]*>",
    re.I,
)
INTEGRITY_RE = re.compile(r"\sintegrity\s*=\s*(\"[^\"]*\"|'[^']*')", re.I)
BASE_RE = re.compile(r"<base\b[^>]*>", re.I)
HEAD_RE = re.compile(r"<head[^>]*>", re.I)
CHARSET_RE = re.compile(r"charset=([\w\-]+)", re.I)

# --- script-free hardening (hosted-only concern, see CLAUDE.md §3.1) ----------
# Stripping <script> never removed the *other* three ways a page can execute JS.
# On localhost that was harmless. Hosted, the proxied page is same-origin with
# an authenticated app, so "scripts off" has to mean no script at all.
#
# The canvas iframe's `sandbox` attribute is the real enforcement — the browser
# guarantees what a regex only approximates. These passes exist because the
# capture frame cannot be sandboxed (the widget loader has to run) and because
# defense that depends on exactly one mechanism is not defense.
INLINE_HANDLER_RE = re.compile(
    r"""\son[a-z]{2,24}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.I
)
JS_URL_RE = re.compile(
    r"""\s(href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)""",
    re.I,
)
SRCDOC_RE = re.compile(r"""\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.I)


def decompress(body, encoding):
    if encoding == "gzip":
        return gzip.decompress(body)
    if encoding == "deflate":
        try:
            return zlib.decompress(body)
        except zlib.error:
            return zlib.decompress(body, -zlib.MAX_WBITS)
    return body


# Injected as the FIRST script of the document when /proxy is called with
# &dmb-capture=1 (the widget-import capture frame — public/app.js). It must run
# before the page's own scripts, for two reasons.
#
# 1. Widget loaders read their mount element's attributes when they initialize:
#    Yotpo renders bundled demo data instead of live-store API calls when the
#    mount carries mode-preview="true", and tagging it from the parent window
#    afterwards is a race we lose whenever the loader gets to it first
#    (produced empty/partial captures). A MutationObserver installed here
#    always wins, since nothing else has run yet.
# 2. IntersectionObserver is replaced by a stub that reports every observed
#    element as intersecting. Lazy content — Yotpo writes each review photo's
#    background-image from an IO callback — otherwise never loads in a capture
#    frame: an IO inside an iframe is clipped by the iframe's intersection with
#    the *top-level* viewport, and a document whose tab is hidden runs no
#    rendering lifecycle at all, so no callback is ever delivered. Both make
#    photo capture depend on where the frame sits and whether the user is
#    looking at the tab. The stub removes both dependencies: everything loads
#    at once, and the capture's quiet-period settling waits for it as usual.
#    Consequences are benign for a snapshot — IO drives lazy loading, reveal
#    animations and view tracking, all of which we *want* eagerly resolved.
CAPTURE_BOOTSTRAP = """<script>(function(){
  var SEL = ".yotpo-widget-instance,[data-yotpo-instance-id]";

  var RealIO = window.IntersectionObserver;
  function EagerIO(cb){ this._cb = cb; }
  EagerIO.prototype.observe = function(el){
    var self = this;
    // Async, like the real thing: callers commonly disconnect() the observer
    // from inside the callback, using a variable assigned after observe().
    setTimeout(function(){
      var r = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      try { r = el.getBoundingClientRect(); } catch (e) {}
      try {
        self._cb([{
          target: el, isIntersecting: true, intersectionRatio: 1,
          boundingClientRect: r, intersectionRect: r, rootBounds: r,
          time: (window.performance && performance.now()) || 0
        }], self);
      } catch (e) { /* the page's callback threw — not our problem */ }
    }, 0);
  };
  EagerIO.prototype.unobserve = function(){};
  EagerIO.prototype.disconnect = function(){};
  EagerIO.prototype.takeRecords = function(){ return []; };
  EagerIO.prototype.root = null;
  EagerIO.prototype.rootMargin = "0px";
  EagerIO.prototype.thresholds = [0];
  if (RealIO) { EagerIO.__real__ = RealIO; window.IntersectionObserver = EagerIO; }

  function tag(root){
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL)) root.setAttribute("mode-preview", "true");
    if (root.querySelectorAll) {
      var n = root.querySelectorAll(SEL);
      for (var i = 0; i < n.length; i++) n[i].setAttribute("mode-preview", "true");
    }
  }
  new MutationObserver(function(muts){
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) tag(added[j]);
      if (muts[i].type === "attributes") tag(muts[i].target);
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-yotpo-instance-id"]
  });
  document.addEventListener("DOMContentLoaded", function(){ tag(document.body); });
})();</script>"""


def rewrite_html(html, base_url, keep_scripts, capture=False):
    if not keep_scripts:
        html = SCRIPT_RE.sub("", html)
        html = SCRIPT_SELF_CLOSE_RE.sub("", html)
        # "No scripts" has to mean the other three execution routes too.
        html = INLINE_HANDLER_RE.sub("", html)
        html = JS_URL_RE.sub(lambda m: ' %s="#"' % m.group(1), html)
        html = SRCDOC_RE.sub("", html)
    html = META_BLOCK_RE.sub("", html)
    html = INTEGRITY_RE.sub("", html)
    html = BASE_RE.sub("", html)
    base_tag = '<base href="%s">' % base_url.replace('"', "%22")
    if capture:
        base_tag += CAPTURE_BOOTSTRAP
    m = HEAD_RE.search(html)
    if m:
        html = html[: m.end()] + base_tag + html[m.end():]
    else:
        html = base_tag + html
    return html


def fetch(url):
    req = Request(url, headers=BROWSER_HEADERS)
    try:
        return urlopen(req, timeout=FETCH_TIMEOUT)
    except URLError as err:
        # Apple's bundled python sometimes lacks usable CA paths; a demo tool
        # rendering public storefronts can fall back to an unverified fetch.
        if isinstance(getattr(err, "reason", None), ssl.SSLCertVerificationError):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return urlopen(req, timeout=FETCH_TIMEOUT, context=ctx)
        raise


# --- who is allowed to use this proxy ----------------------------------------
# Hosted, /proxy is a public URL-fetcher attached to someone's Vercel quota, so
# it is gated on the caller's Supabase session. Local dev has no SUPABASE_URL
# configured and therefore stays open, exactly as it is today — the gate turns
# itself on only where it is needed.
#
# The token arrives as a cookie because the canvas loads /proxy as an iframe
# *document*: there is no fetch() to hang an Authorization header off. The
# verification is one call to Supabase's /auth/v1/user, memoized per process by
# token hash so a capture's dozen CSS fetches cost one round-trip, not a dozen.
AUTH_COOKIE = "dmb-session"
AUTH_TTL = 300
_auth_cache = {}


def auth_required():
    if os.environ.get("REQUIRE_AUTH") == "0":
        return False
    return bool(os.environ.get("SUPABASE_URL"))


def _cookie_value(cookie_header, name):
    for part in (cookie_header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v.strip()
    return ""


def verify_token(token):
    """True when Supabase recognizes this access token. Cached for AUTH_TTL."""
    if not token:
        return False
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    hit = _auth_cache.get(key)
    now = time.time()
    if hit and hit[0] > now:
        return hit[1]

    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY") or ""
    ok = False
    email = ""
    try:
        req = Request(
            base + "/auth/v1/user",
            headers={"Authorization": "Bearer " + token, "apikey": anon},
        )
        with urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        email = (data.get("email") or "").lower()
        ok = bool(email) and email_allowed(email)
    except Exception:  # noqa: BLE001 - an unverifiable token is simply not authorized
        ok = False

    _auth_cache[key] = (now + AUTH_TTL, ok)
    if len(_auth_cache) > 500:  # a warm instance should not grow without bound
        _auth_cache.clear()
    return ok


def allowlist():
    """(domains, emails) permitted to use the app — both lowercase, no '@'."""
    domains = [
        d.strip().lower().lstrip("@")
        for d in (os.environ.get("ALLOWED_EMAIL_DOMAINS") or "").split(",")
        if d.strip()
    ]
    emails = [
        e.strip().lower()
        for e in (os.environ.get("ALLOWED_EMAILS") or "").split(",")
        if e.strip()
    ]
    return domains, emails


def email_allowed(email):
    domains, emails = allowlist()
    if not domains and not emails:
        return True  # nothing configured — do not lock the owner out by default
    email = (email or "").lower().strip()
    if email in emails:
        return True
    _, _, domain = email.partition("@")
    return domain in domains


# --- the request itself ------------------------------------------------------


class Result(object):
    """A complete response, so both entry points only have to write bytes."""

    def __init__(self, status, body, ctype="text/html; charset=utf-8"):
        self.status = status
        self.body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.ctype = ctype


def handle_proxy(query_string, cookie_header=""):
    qs = parse_qs(query_string)
    target = (qs.get("url") or [""])[0].strip()
    keep_scripts = (qs.get("scripts") or ["0"])[0] == "1"
    capture = (qs.get("dmb-capture") or ["0"])[0] == "1"

    if auth_required() and not verify_token(_cookie_value(cookie_header, AUTH_COOKIE)):
        return Result(
            401,
            "<h2>Not signed in</h2><p>This page is loaded through Yotpo Looks. "
            "Sign in again in the main tab, then reload the page.</p>",
        )

    if not target:
        return Result(400, "Missing ?url= parameter")
    parsed = urlparse(target)
    if parsed.scheme not in ("http", "https"):
        return Result(400, "Only http/https URLs are supported")

    try:
        resp = fetch(target)
    except HTTPError as err:
        return Result(
            err.code,
            "<h2>The site responded with HTTP %d</h2><p>%s</p>"
            "<p>Some stores block automated requests. Try another product page.</p>"
            % (err.code, err.reason),
        )
    except Exception as err:  # noqa: BLE001 - report anything to the UI
        return Result(502, "<h2>Could not load page</h2><pre>%s</pre>" % err)

    with resp:
        final_url = resp.geturl()
        headers = resp.headers
        body = resp.read()

    try:
        body = decompress(body, (headers.get("Content-Encoding") or "").lower())
    except Exception as err:  # noqa: BLE001
        return Result(502, "<h2>Could not decode page</h2><pre>%s</pre>" % err)

    ctype = headers.get("Content-Type", "text/html")
    if "html" not in ctype:
        return Result(200, body, ctype)

    charset_match = CHARSET_RE.search(ctype)
    charset = charset_match.group(1) if charset_match else "utf-8"
    try:
        html = body.decode(charset, errors="replace")
    except LookupError:
        html = body.decode("utf-8", errors="replace")

    return Result(200, rewrite_html(html, final_url, keep_scripts, capture))


def client_config():
    """What the browser needs to boot Supabase. Anon key is public by design —
    row-level security is what protects the data, not the key's secrecy."""
    domains, emails = allowlist()
    return {
        "supabaseUrl": os.environ.get("SUPABASE_URL") or "",
        "supabaseAnonKey": os.environ.get("SUPABASE_ANON_KEY") or "",
        "allowedDomains": domains,
        "allowedEmails": emails,
    }
