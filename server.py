#!/usr/bin/env python3
"""Yotpo Looks — local dev server.

Serves the app UI from ./public and proxies external product pages through
/proxy so they can be rendered inside the app's iframe (bypasses
X-Frame-Options / CSP frame-ancestors, which almost every store sends).

The proxy logic itself lives in api/_proxy_core.py, shared verbatim with the
hosted Vercel function (api/proxy.py) so the two can never drift. This file is
the localhost half: `python3 server.py`, no installs, system Python 3.9.

Local dev reads optional Supabase settings from a gitignored `.env.local` in
this directory (see DEPLOY.md). Without one the app runs exactly as it always
has, minus the signed-in gallery.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import json

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
sys.path.insert(0, os.path.join(ROOT, "api"))

PORT = int(os.environ.get("PORT", "4173"))


def load_env_file(path):
    """Minimal KEY=VALUE reader — no dependency, and dotenv isn't stdlib."""
    if not os.path.exists(path):
        return
    with open(path, "r") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_env_file(os.path.join(ROOT, ".env.local"))

from _proxy_core import client_config, handle_proxy  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/proxy":
            self.handle_proxy()
        elif path == "/api/config":
            self.send_bytes(
                200,
                json.dumps(client_config()).encode("utf-8"),
                "application/json; charset=utf-8",
            )
        else:
            super().do_GET()

    def send_bytes(self, code, data, ctype="text/html; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_proxy(self):
        result = handle_proxy(
            urlparse(self.path).query, self.headers.get("Cookie", "")
        )
        self.send_bytes(result.status, result.body, result.ctype)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Yotpo Looks running at http://localhost:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
