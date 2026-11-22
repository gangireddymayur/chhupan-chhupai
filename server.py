#!/usr/bin/env python3
"""Serves the game, and on a Mac speaks the agents' lines with the Mac's own voices.

    python3 server.py            then open http://127.0.0.1:8790

  GET  /health                        what voices this Mac can use
  GET  /tts?voice=m|f&text=...        a WAV of the line, made with the macOS `say` command (voice m = boy, f = girl)
  POST /save?name=x.mp4               saves a file into video/ (used by the video recorder)

Why: some browsers' built-in speech stays silent. The Mac's `say` always works, and it is what the video uses.
Listens on 127.0.0.1 only. Text is passed to `say` as an argument (never through a shell) and limited in length.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8790
PREFER = {'m': ['Rishi (Enhanced)', 'Rishi (English (India))', 'Rishi', 'Aman', 'Daniel'], 'f': ['Isha (Premium)', 'Isha (Enhanced)', 'Isha', 'Tara', 'Veena', 'Lekha (Hindi (India))', 'Samantha']}
SAY = shutil.which('say')
CACHE_DIR = tempfile.mkdtemp(prefix='chhupan-tts-')


def installed_voices():
    if not SAY:
        return set()
    out = subprocess.run([SAY, '-v', '?'], capture_output=True, text=True).stdout
    return {m.group(1).strip() for m in (re.match(r'^(.+?)\s{2,}\S+\s+#', line) for line in out.splitlines()) if m}


VOICES = installed_voices()


def choose(kind):
    for name in PREFER.get(kind, []):
        if name in VOICES:
            return name
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _send(self, code, body=b'', ctype='text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/health':
            return self._send(200, json.dumps({'say': bool(SAY), 'voices': {k: choose(k) for k in PREFER}}).encode(), 'application/json')
        if url.path == '/tts':
            q = parse_qs(url.query)
            kind = (q.get('voice', ['f'])[0] or 'f')[:1]
            text = (q.get('text', [''])[0] or '').strip()[:400]
            voice = choose(kind)
            if not SAY or not voice or not text:
                return self._send(400, b'no voice or no text')
            rate = q.get('rate', [''])[0]
            rate = rate if rate.isdigit() and 90 <= int(rate) <= 600 else ''
            key = hashlib.sha1(f'{voice}|{rate}|{text}'.encode()).hexdigest()
            path = os.path.join(CACHE_DIR, key + '.wav')
            if not os.path.exists(path):
                cmd = [SAY, '-v', voice, '-o', path, '--file-format=WAVE', '--data-format=LEI16@24000']
                if rate:
                    cmd += ['-r', rate]
                subprocess.run(cmd + ['--', text], check=True)
            with open(path, 'rb') as f:
                return self._send(200, f.read(), 'audio/wav')
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != '/save':
            return self._send(404)
        name = os.path.basename(parse_qs(url.query).get('name', ['out.bin'])[0])
        if os.path.splitext(name)[1].lower() not in {'.mp4', '.webm', '.png', '.json'}:
            return self._send(400)
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(os.path.join(ROOT, 'video'), exist_ok=True)
        with open(os.path.join(ROOT, 'video', name), 'wb') as f:
            f.write(data)
        return self._send(200, f'saved {name} {len(data)}'.encode())

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    print(f'Chhupan Chhupai: http://127.0.0.1:{PORT}   (voices: boy = {choose("m")}, girl = {choose("f")})')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
