"""Fetch TDX Metro (TRTC) static data into <out_dir>/*.json. Reads credentials from .secret/tdx.env.
Never prints credentials.
usage: python fetch_tdx.py <secret_env> <out_dir>
"""
import json, sys, os, urllib.request, urllib.parse

env_path, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
cfg = {}
for line in open(env_path, encoding='utf-8'):
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.strip().split('=', 1)
        cfg[k.strip()] = v.strip().strip('"\'')
if not cfg.get('TDX_CLIENT_ID') or not cfg.get('TDX_CLIENT_SECRET'):
    sys.exit('TDX_CLIENT_ID / TDX_CLIENT_SECRET not filled in')

body = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': cfg['TDX_CLIENT_ID'],
                               'client_secret': cfg['TDX_CLIENT_SECRET']}).encode()
try:
    req = urllib.request.Request('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
                                 data=body, headers={'content-type': 'application/x-www-form-urlencoded'})
    token = json.load(urllib.request.urlopen(req, timeout=60))['access_token']
    print('token: OK')
except Exception as e:
    sys.exit(f'token: FAILED ({type(e).__name__}: {getattr(e, "code", "")})')

base = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro'
for name in ['S2STravelTime', 'StationExit', 'StationFacility', 'LineTransfer', 'StationTransfer', 'Frequency', 'Station']:
    try:
        r = urllib.request.Request(f'{base}/{name}/TRTC?%24format=JSON', headers={'authorization': f'Bearer {token}'})
        data = json.load(urllib.request.urlopen(r, timeout=90))
        json.dump(data, open(f'{out_dir}/{name}.json', 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'{name}: OK {len(data) if isinstance(data, list) else type(data).__name__}')
    except Exception as e:
        print(f'{name}: FAILED {type(e).__name__} {getattr(e, "code", "")}')
