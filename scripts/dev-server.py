#!/usr/bin/env python3
"""Local preview server.

python -m http.server sends no cache headers, so browsers guess how long to
keep files and you end up staring at an old build. This sends no-store, which
makes every reload honest. Development only; GitHub Pages handles caching
properly on its own.

    python3 scripts/dev-server.py [port]
"""
import functools
import http.server
import pathlib
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8750
ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=str(ROOT))
    with Server(("", PORT), handler) as httpd:
        print(f"KTFCSA app on http://localhost:{PORT} (no-store, serving {ROOT})")
        httpd.serve_forever()
