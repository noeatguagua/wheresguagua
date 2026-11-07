"""Build app/data.js from public data.taipei datasets (no API keys needed).
usage: python build_data.py <raw_dir> <od_csv_or_-> <out_js>
raw_dir must contain elevator.csv, maint.csv (Big5 / cp950). Other datasets are fetched live.
"""
import csv, json, re, sys, collections, datetime, urllib.request

raw, od_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
norm = lambda s: s.replace('臺', '台').strip()


def api(rid, limit=1000):
    url = f"https://data.taipei/api/v1/dataset/{rid}?scope=resourceAquire&limit={limit}"
    return json.load(urllib.request.urlopen(url, timeout=60))['result']['results']


LINES = {'BR': '文湖線', 'R': '淡水信義線', 'G': '松山新店線', 'O': '中和新蘆線', 'BL': '板南線'}  # 環狀線（新北捷運）不在範圍內
LINE_ALL = list(LINES.values())

# ---- elevators (one row per station per line)
el = list(csv.DictReader(open(f'{raw}/elevator.csv', encoding='cp950')))
K = list(el[0].keys())
rows = []
for r in el:
    line_cn, name, code, text = r[K[0]], norm(r[K[1]]), r[K[2]].strip(), r[K[3]]
    if code == 'BF12':
        code = 'BR12'  # typo in source (中山國中)
    if code == 'G03A' and name == '七張':
        code = 'G03'  # typo in source
    m = re.match(r'([A-Z]+)(\d+)([A-Z]?)', code)
    if m.group(1) not in LINES:  # 略過環狀線等不在範圍內的線
        continue
    rows.append(dict(line=m.group(1), num=int(m.group(2)), suf=m.group(3), code=code, name=name, text=text))


def section(text, key):
    t = text.replace('月台', '月臺')
    i = t.find(key)
    if i < 0:
        return ''
    seg = t[i + len(key):]
    seg = re.split(r'\n\s*\d\.\s*(?:出口電梯|月臺電梯|轉乘電梯)', seg)[0]
    return seg.lstrip('：:').strip()


def pick(seg, line_cn):
    # transfer stations: a section may hold "<線名>：..." sub-blocks for several lines
    parts = re.split('(' + '|'.join(LINE_ALL) + ')：', seg)
    if len(parts) < 3:
        return seg
    d = {parts[i]: parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
    return d.get(line_cn, '')


stations = {}
chains = collections.defaultdict(list)
for r in rows:
    line_cn = LINES[r['line']]
    t = r['text'].replace('月台', '月臺')
    blocks = re.split('(' + '|'.join(LINE_ALL) + r')：\s*\n', t)
    if len(blocks) >= 3:
        d = {blocks[i]: blocks[i + 1] for i in range(1, len(blocks) - 1, 2)}
        t = d.get(line_cn, t)
    ex = pick(section(t, '出口電梯'), line_cn)
    pl = pick(section(t, '月臺電梯'), line_cn)
    if not ex and not pl:
        ex = t.strip()
    s = stations.setdefault(r['name'], dict(name=r['name'], codes={}, lines={}))
    s['codes'][r['line']] = r['code']
    s['lines'][line_cn] = dict(code=r['code'], exitElev=ex, platElev=pl, raw=r['text'].strip())
    chains[(r['line'], 'branch' if r['num'] >= 50 or r['suf'] else 'main')].append((r['num'], r['suf'], r['name']))

# ---- adjacency edges (by line)
edges = []
for (ln, kind), lst in chains.items():
    if kind == 'branch' and ln in ('R', 'G'):  # R22A / G03A hang off 北投 / 七張
        for _, _, n in lst:
            edges.append((LINES[ln], {'R': '北投', 'G': '七張'}[ln], n))
        continue
    lst.sort()
    for a, b in zip(lst, lst[1:]):
        edges.append((LINES[ln], a[2], b[2]))
edges.append((LINES['O'], '三重', '三重國小'))  # 蘆洲支線 branches off at 三重
line_order = {LINES[ln]: [n for _, _, n in sorted(lst)] for (ln, k), lst in chains.items() if k == 'main'}

# ---- station coordinates from exits (+ accessible exits)
exs = api('307a7f61-e302-4108-a817-877ccbfca7c1', 1000)
acc = collections.defaultdict(list)
pos = collections.defaultdict(list)
for r in exs:
    nm = norm(re.sub(r'出口.*$', '', r['出入口名稱']))
    key = next((c for c in (nm, nm.rstrip('站'), nm + '站') if c in stations), None)
    if not key:
        continue
    pos[key].append((float(r['緯度']), float(r['經度'])))
    if r['是否為無障礙用'] == '是':
        acc[key].append(r['出入口編號'])
for n, s in stations.items():
    if pos.get(n):
        s['lat'] = sum(p[0] for p in pos[n]) / len(pos[n])
        s['lng'] = sum(p[1] for p in pos[n]) / len(pos[n])
    s['accExits'] = sorted(set(acc.get(n, [])), key=lambda x: (len(x), x))

# ---- transfer walking minutes
tw = {}
for r in api('14fd1af0-dc2b-4174-87d4-fcb9de783496'):
    tw[norm(re.sub(r'^捷運|站$', '', r['station']))] = int(r['time'])

# ---- elevator maintenance schedule
mt = list(csv.DictReader(open(f'{raw}/maint.csv', encoding='cp950')))
MK = list(mt[0].keys())
maint = collections.defaultdict(list)
code2name = {c: s['name'] for s in stations.values() for c in s['codes'].values()}
for r in mt:
    d = r[MK[0]]
    iso = f"{int(d[:3]) + 1911}-{d[3:5]}-{d[5:7]}"
    code = r[MK[2]].split('(')[0]
    nm = code2name.get('BR12' if code == 'BF12' else code)
    if nm:
        maint[nm].append(dict(date=iso, loc=r[MK[3]].split('(')[0], slot=r[MK[6]].split('(')[0], id=r[MK[4]]))

# ---- elevator abnormality announcements (snapshot)
ano = sorted(api('649c44eb-60b5-4746-a353-cbdc6651fc09', 500), key=lambda r: r['日期時間'])
last = {}
for r in ano:
    nm = norm(re.sub(r'站$', '', r['車站']))
    ok = bool(re.search(r'修復|恢復|開放使用', r['說明']))
    last[nm] = dict(time=r['日期時間'], ok=ok, text=r['說明'].strip(), line=r['路線'])
anomalies = {k: v for k, v in last.items() if not v['ok']}

# ---- historic crowd profile from OD month
crowd = {}
meta_crowd = None
if od_path != '-':
    tot = collections.defaultdict(float)
    days = {'wd': set(), 'we': set()}
    with open(od_path, encoding='utf-8-sig') as f:
        next(f)
        for line in f:
            d, h, a, b, n = line.rstrip('\n').split(',')
            k = 'we' if datetime.date.fromisoformat(d).weekday() >= 5 else 'wd'
            days[k].add(d)
            n = int(n)
            h = int(h)
            tot[(norm(a), k, h)] += n
            tot[(norm(b), k, h)] += n
    vals = sorted(v / max(len(days['wd']), 1) for (s, k, h), v in tot.items() if k == 'wd' and s in stations)
    q = lambda p: vals[int(len(vals) * p)]
    th = [q(.5), q(.8), q(.95)]
    for n in stations:
        crowd[n] = {k: [round(tot.get((n, k, h), 0) / max(len(days[k]), 1)) for h in range(24)] for k in ('wd', 'we')}
    meta_crowd = dict(thresholds=[round(x) for x in th], month=od_path[-10:-4], days={k: len(v) for k, v in days.items()})


# ---- optional: TDX official data (run tools/fetch_tdx.py first)
hop_time, line_transfer, elev_exits = {}, {}, {}
if len(sys.argv) > 4:
    tdx = sys.argv[4]
    LN = {k: v for k, v in LINES.items()}
    tmp = collections.defaultdict(list)
    for route in json.load(open(f'{tdx}/S2STravelTime.json', encoding='utf-8')):
        for t in route['TravelTimes']:
            a, b = code2name.get(t['FromStationID']), code2name.get(t['ToStationID'])
            if a and b:
                tmp[(a, b)].append((t['RunTime'] + t['StopTime']) / 60)
                tmp[(b, a)].append((t['RunTime'] + t['StopTime']) / 60)
    hop_time = {f'{a}|{b}': round(sum(v) / len(v), 2) for (a, b), v in tmp.items()}
    for r in json.load(open(f'{tdx}/LineTransfer.json', encoding='utf-8')):
        n = norm(r['FromStationName']['Zh_tw'])
        fl, tl = LN.get(r['FromLineNo']), LN.get(r['ToLineNo'])
        if n in stations and fl and tl and fl != tl:
            line_transfer[f'{n}|{fl}|{tl}'] = dict(min=r['TransferTime'], onSite=bool(r['IsOnSiteTransfer']))
    for r in json.load(open(f'{tdx}/StationExit.json', encoding='utf-8')):
        n = norm(r['StationName']['Zh_tw'])
        if n in stations and r.get('Elevator'):
            elev_exits.setdefault(n, {})[r['ExitID']] = r.get('LocationDescription', '')
    for n, s in stations.items():
        s['elevExits'] = [dict(id=k, desc=v) for k, v in sorted(elev_exits.get(n, {}).items(), key=lambda x: (len(x[0]), x[0]))]
    print('TDX: hop', len(hop_time), 'transfer', len(line_transfer), 'stations with elevator exits', len(elev_exits))

# ---- 人工標記：電梯／手扶梯 ↔ 車廂（annotator 產生的 data/annotations.json）
access = {}
if len(sys.argv) > 5:
    SKIP = {'松山新店線|小碧潭'}
    doc = json.load(open(sys.argv[5], encoding='utf-8'))
    for k, it in doc['items'].items():
        s_, l_, v_ = k.split('|')
        if s_ not in stations or l_ not in LINES.values() or f'{l_}|{s_}' in SKIP or f'{l_}|{v_}' in SKIP:
            continue
        slim = lambda e: {x: e[x] for x in ('car', 'label', 'door', 'flow', 'mirrored', 'verified', 'source') if e.get(x) not in (None, '', False)}
        access[k] = dict(dir=it['dir'],
                         el=[slim(e) for e in it['entries'] if e['type'] == 'elevator' and e.get('car')],
                         es=[slim(e) for e in it['entries'] if e['type'] == 'escalator' and e.get('car')],
                         elNone=bool(it.get('elevatorNone')), escNone=bool(it.get('escalatorNone')))
    print('access directions', len(access), 'mirrored entries', sum(1 for a in access.values() for e in a['el'] + a['es'] if e.get('mirrored')))

MANUAL = {'台北車站': (25.0478, 121.5170)}
for n, (la, lo) in MANUAL.items():
    if n in stations and 'lat' not in stations[n]:
        stations[n]['lat'], stations[n]['lng'] = la, lo
data = dict(built=datetime.datetime.now().isoformat(timespec='minutes'), stations=stations, edges=edges,
            lineOrder=line_order, hopTime=hop_time, lineTransfer=line_transfer, transferWalk=tw, maint=maint,
            anomalies=anomalies, crowd=crowd, crowdMeta=meta_crowd, access=access)
open(out, 'w', encoding='utf-8').write('window.METRO_DATA=' + json.dumps(data, ensure_ascii=False) + ';')
print('stations', len(stations), 'edges', len(edges), 'noPos', [n for n, s in stations.items() if 'lat' not in s])
print('multi-line', [n for n, s in stations.items() if len(s['lines']) > 1])
print('transferWalk missing', [n for n, s in stations.items() if len(s['lines']) > 1 and n not in tw])
print('anomalies', list(anomalies), 'maint stations', len(maint), 'crowd', bool(crowd))
