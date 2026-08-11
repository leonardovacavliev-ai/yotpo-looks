"""Vercel serverless entry point for /api/config.

The app is a no-build-step static site (CLAUDE.md §3), so it cannot read Vercel
environment variables at deploy time — there is no deploy-time step. It reads
them at *runtime* from here instead, which is why the Supabase project URL and
the allowlist live in the Vercel dashboard rather than in a committed file.

Nothing secret is served: the anon key is a public client key by design, and
row-level security is what actually protects a user's gallery.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _proxy_core import client_config  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(client_config()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
