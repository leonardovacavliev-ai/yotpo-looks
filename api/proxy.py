"""Vercel serverless entry point for /proxy.

`vercel.json` rewrites /proxy -> /api/proxy, so the client keeps calling the
same URL it always has and every §7 verification step still reads true.

All the logic is in _proxy_core; this file only turns a Result into bytes.
"""
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _proxy_core import handle_proxy  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        result = handle_proxy(
            urlparse(self.path).query, self.headers.get("Cookie", "")
        )
        self.send_response(result.status)
        self.send_header("Content-Type", result.ctype)
        self.send_header("Content-Length", str(len(result.body)))
        self.send_header("Cache-Control", "no-store")
        # The proxied document is same-origin by design (CLAUDE.md §3) but it is
        # third-party HTML: never let it be framed by anyone but us, and never
        # let a browser second-guess its content type.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(result.body)
