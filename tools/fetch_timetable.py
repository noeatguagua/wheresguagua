"""抓 TDX 臺北捷運「各站時刻表」(StationTimeTable)，存成原始 JSON（不進版控，體積大）。
金鑰讀 .secret/tdx.env，不會印出。
usage: python tools/fetch_timetable.py .secret/tdx.env data/tdx_raw/StationTimeTable.json
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

env_path, out = sys.argv[1], sys.argv[2]
cfg = {}
for line in open(env_path, encoding='utf-8'):
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.strip().split('=', 1)
        cfg[k.strip()] = v.strip().strip('"\'')
body = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': cfg['TDX_CLIENT_ID'],
                               'client_secret': cfg['TDX_CLIENT_SECRET']}).encode()
req = urllib.request.Request('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
                             data=body, headers={'content-type': 'application/x-www-form-urlencoded'})
token = json.load(urllib.request.urlopen(req, timeout=60))['access_token']
print('token: OK')

url = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/StationTimeTable/TRTC?%24format=JSON'
for attempt in range(4):
    try:
        r = urllib.request.Request(url, headers={'authorization': f'Bearer {token}'})
        data = json.load(urllib.request.urlopen(r, timeout=180))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
        print('StationTimeTable: OK', len(data), 'records ->', out)
        break
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, '(retry)')
        time.sleep(15 * (attempt + 1))
else:
    sys.exit('failed')
