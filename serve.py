#!/usr/bin/env python3
"""Dev server for the Kettlebell PWA. Serves this folder on 127.0.0.1:8123."""
import os

APP_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(APP_DIR)

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
    }

    def end_headers(self):
        # Dev server: never cache, so edits show up on reload.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    print(f'Serving {APP_DIR} on http://127.0.0.1:8123')
    ThreadingHTTPServer(('127.0.0.1', 8123), Handler).serve_forever()
