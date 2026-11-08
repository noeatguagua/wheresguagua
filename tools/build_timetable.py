"""把 TDX StationTimeTable 精簡成前端用的 app/timetable.js（只留各站、各方向的發車分鐘）。
usage: python tools/build_timetable.py data/tdx_raw/StationTimeTable.json app/timetable.js

輸出格式：window.TIMETABLE = { <站碼>: [ { d: 方向(0|1), n: 終點站(中文), wd: "分,分,…", sa: "…", su: "…" }, … ] }
- 分鐘＝自 00:00 起算；04:00 以前的班次記為隔天（+1440），屬於前一個營運日。
- wd＝週一至週五、sa＝週六、su＝週日。國定假日不另處理（TDX 以 NationalHolidays 標記，這裡不用）。
- 文湖線（BR）在 TDX 的 StationTimeTable 沒有資料，前端會退回「預估」。
"""
import json, sys, collections

src, out = sys.argv[1], sys.argv[2]
raw = json.load(open(src, encoding='utf-8'))
norm = lambda s: s.replace('臺', '台').strip()


def minutes(hhmm):
    h, m = hhmm.split(':')[:2]
    t = int(h) * 60 + int(m)
    return t + 1440 if t < 240 else t


groups = collections.OrderedDict()   # (站碼, 方向, 終點) -> {wd,sa,su: set}
for r in raw:
    key = (r['StationID'], r['Direction'], norm(r['DestinationStationName']['Zh_tw']))
    g = groups.setdefault(key, {'wd': set(), 'sa': set(), 'su': set()})
    sd = r['ServiceDay']
    days = []
    if any(sd.get(d) for d in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')): days.append('wd')
    if sd.get('Saturday'): days.append('sa')
    if sd.get('Sunday'): days.append('su')
    for tt in r['Timetables']:
        m = minutes(tt['DepartureTime'])
        for d in days:
            g[d].add(m)

tbl = collections.OrderedDict()
for (sid, direc, dest), g in sorted(groups.items()):
    enc = lambda s: ','.join(str(x) for x in sorted(s))
    tbl.setdefault(sid, []).append({'d': direc, 'n': dest, 'wd': enc(g['wd']), 'sa': enc(g['sa']), 'su': enc(g['su'])})

js = ('/* 各站發車時刻（班表）：取自 TDX StationTimeTable，見 DATA_SOURCES.md；由 tools/build_timetable.py 產生。\n'
      ' * 不含文湖線。分鐘自 00:00 起算，04:00 以前為隔天（+1440）。 */\n'
      'window.TIMETABLE=' + json.dumps(tbl, ensure_ascii=False, separators=(',', ':')) + ';\n')
open(out, 'w', encoding='utf-8', newline='').write(js)
print('stations', len(tbl), 'groups', sum(len(v) for v in tbl.values()), 'bytes', len(js.encode('utf-8')))
