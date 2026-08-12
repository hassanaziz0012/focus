#!/usr/bin/env python3
"""Configure and authenticate the local Focus Tasks GNOME extension."""
import argparse
import json
import os
import secrets
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

CONFIG = Path.home() / '.config' / 'focus-tasks' / 'config.json'
REDIRECT_URI = 'http://127.0.0.1:8765/callback'
SCOPE = 'https://www.googleapis.com/auth/tasks'

def load():
    try: return json.loads(CONFIG.read_text())
    except FileNotFoundError: return {}

def save(config):
    CONFIG.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(config, indent=2) + '\n')
    os.chmod(CONFIG, 0o600)

def configure(_):
    config = load()
    config['client_id'] = input('Google OAuth client ID: ').strip()
    config['client_secret'] = input('Google OAuth client secret: ').strip()
    save(config)
    print(f'Saved private configuration to {CONFIG}')

def post(url, data):
    request = urllib.request.Request(url, urllib.parse.urlencode(data).encode(), method='POST')
    with urllib.request.urlopen(request) as response:
        return json.load(response)

def login(_):
    config = load()
    if not config.get('client_id') or not config.get('client_secret'):
        sys.exit('Run configure first.')
    state = secrets.token_urlsafe(24)
    outcome = {}
    class Callback(BaseHTTPRequestHandler):
        def do_GET(self):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            outcome.update({key: values[0] for key, values in query.items()})
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers()
            self.wfile.write(b'<h1>Focus Tasks connected.</h1><p>You can close this tab.</p>')
        def log_message(self, *_): pass
    server = HTTPServer(('127.0.0.1', 8765), Callback)
    params = {'client_id': config['client_id'], 'redirect_uri': REDIRECT_URI, 'response_type': 'code', 'scope': SCOPE, 'access_type': 'offline', 'prompt': 'consent', 'state': state}
    webbrowser.open('https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params))
    print('Waiting for approval in your browser…')
    server.handle_request(); server.server_close()
    if outcome.get('state') != state or not outcome.get('code'):
        sys.exit('Authorization was cancelled or the callback state did not match.')
    token = post('https://oauth2.googleapis.com/token', {'code': outcome['code'], 'client_id': config['client_id'], 'client_secret': config['client_secret'], 'redirect_uri': REDIRECT_URI, 'grant_type': 'authorization_code'})
    config['refresh_token'] = token['refresh_token']; save(config)
    print('Connected. Re-open Focus Tasks and select Refresh tasks.')

def status(_):
    config = load()
    print(f'Configuration: {CONFIG}')
    print('Client configured:', bool(config.get('client_id') and config.get('client_secret')))
    print('Account connected:', bool(config.get('refresh_token')))

def revoke(_):
    config = load(); token = config.pop('refresh_token', None)
    if token:
        try: post('https://oauth2.googleapis.com/revoke', {'token': token})
        except Exception as error: print(f'Could not revoke remotely: {error}', file=sys.stderr)
    save(config); print('Local refresh token removed.')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['configure', 'login', 'status', 'revoke'])
args = parser.parse_args()
{'configure': configure, 'login': login, 'status': status, 'revoke': revoke}[args.command](args)
