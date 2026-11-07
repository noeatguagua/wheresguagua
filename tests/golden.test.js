/* 引擎測試：黃金測試（固定輸入 → 固定輸出）＋ 即時資料的不變量檢查
 *
 * 執行（在專案根目錄）：
 *   node --test tests/                          # 一般情況
 *   UPDATE_GOLDEN=1 node --test tests/          # 有意改變輸出時，重新產生黃金檔，並檢查 git diff
 * 若 Node 在含中文的資料夾路徑下載入檔案會當機（Node 22.13 on Windows 實測），改用標準輸入執行：
 *   bash:        node - < tests/golden.test.js
 *   PowerShell:  Get-Content -Raw tests/golden.test.js | node -
 *
 * 黃金測試用凍結的資料快照 tests/fixtures/data.frozen.js，所以重建 app/data.js 不會讓它失敗；
 * 它只會在「引擎行為改變」時失敗。不變量測試用 app/data.js（即時資料），資料重建後仍要通過。
 * 本檔刻意不用 require 載入專案檔案（只用 fs + vm），避免上述路徑問題。
 */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const ROOT = process.env.MRT_ROOT || process.cwd();
const P = (...a) => [ROOT, ...a].join('/');

function loadEngine() {
  const mod = { exports: {} };
  vm.runInThisContext('(function(module,exports,self){' + fs.readFileSync(P('app/engine.js'), 'utf8') + '\n})', { filename: 'engine.js' })(mod, mod.exports, undefined);
  return mod.exports;
}
function loadData(file) {
  const win = {}; new Function('window', fs.readFileSync(file, 'utf8'))(win);
  return JSON.parse(JSON.stringify(win.METRO_DATA)); // 深拷貝，測試可以自由改
}
const { createEngine } = loadEngine();
// 車廂標記資料不公開：凍結快照與黃金檔只存在於有私有資料的機器上。公開庫沒有它們時整組測試略過。
if (!fs.existsSync(P('tests/fixtures/data.frozen.js'))) {
  console.log('# 略過：缺少私有測試資料（tests/fixtures/data.frozen.js、tests/golden/；車廂標記資料不公開）');
  process.exit(0);
}
const FROZEN = loadData(P('tests/fixtures/data.frozen.js'));
const LIVE = loadData(P('app/data.js'));
if (fs.existsSync(P('app/data.private.js'))) { const w = { METRO_DATA: LIVE }; new Function('window', fs.readFileSync(P('app/data.private.js'), 'utf8'))(w); }
const clone = o => JSON.parse(JSON.stringify(o));

const E = createEngine(FROZEN);
const withAnomaly = clone(FROZEN); // 注入電梯異常與當日檢修，涵蓋 risk 路徑（凍結快照本身沒有異常資料）
withAnomaly.anomalies = { '忠孝復興': { time: '2026-11-08 06:00', ok: false, text: '測試：月臺電梯故障', line: '板南線' } };
withAnomaly.maint = { '台北車站': [{ date: '2026-11-09', loc: '測試電梯', slot: '10:00-12:00', id: 'T1' }] };
const unmarked = clone(FROZEN); unmarked.access = {}; // 全部無標記，涵蓋「與車廂無關的固定步行」路徑
const ENGINES = { frozen: E, anomaly: createEngine(withAnomaly), unmarked: createEngine(unmarked) };

// ---------- 黃金案例（name → 引擎、請求）。2026-11-09 是星期一，2026-11-07 是星期六
const MON8 = '2026-11-09T08:00+08:00';
const CASES = [
  ['wheel_banqiao_zhongshanguozhong_mon0800', 'frozen', { from: '板橋', to: '中山國中', mode: 'wheel', depart: MON8 }],
  ['wheel_banqiao_zhongshanguozhong_mon2300', 'frozen', { from: '板橋', to: '中山國中', mode: 'wheel', depart: '2026-11-09T23:00+08:00' }],
  ['stroller_tamsui_xiangshan_sat1400', 'frozen', { from: '淡水', to: '象山', mode: 'stroller', depart: '2026-11-07T14:00+08:00' }],
  ['wheel_zhongxiao_taipeistation_mon0800', 'frozen', { from: '忠孝復興', to: '台北車站', mode: 'wheel', depart: MON8 }],
  ['wheel_zoo_taipeistation_relaxed', 'frozen', { from: '動物園', to: '台北車站', mode: 'wheel', depart: MON8 }],
  ['walk_zoo_taipeistation', 'frozen', { from: '動物園', to: '台北車站', mode: 'walk', depart: MON8 }],
  ['walk_xindian_luzhou_mon1730', 'frozen', { from: '新店', to: '蘆洲', mode: 'walk', depart: '2026-11-09T17:30+08:00' }],
  ['wheel_nangang_dingpu_mon0800', 'frozen', { from: '南港展覽館', to: '頂埔', mode: 'wheel', depart: MON8 }],
  ['stroller_songshan_huilong_max1', 'frozen', { from: '松山', to: '迴龍', mode: 'stroller', depart: MON8, max: 1 }],
  ['wheel_midnight_crossing', 'frozen', { from: '淡水', to: '象山', mode: 'wheel', depart: '2026-11-09T23:40+08:00' }],
  ['wheel_banqiao_zhongshanguozhong_anomaly', 'anomaly', { from: '板橋', to: '中山國中', mode: 'wheel', depart: MON8 }],
  ['wheel_banqiao_taipeistation_maintenance', 'anomaly', { from: '板橋', to: '台北車站', mode: 'wheel', depart: '2026-11-09T10:00+08:00' }],
  ['wheel_banqiao_zhongshanguozhong_unmarked', 'unmarked', { from: '板橋', to: '中山國中', mode: 'wheel', depart: MON8 }],
  ['tz_utc_input_same_as_taipei', 'frozen', { from: '板橋', to: '中山國中', mode: 'wheel', depart: '2026-11-09T00:00Z' }],
  ['name_normalization', 'frozen', { from: '臺北車站', to: '板橋站', mode: 'wheel', depart: MON8, max: 1 }],
  ['err_unknown_station', 'frozen', { from: '板橋X', to: '中山國中' }],
  ['err_unknown_station_suggest', 'frozen', { from: '台北', to: '淡水', depart: MON8 }],
  ['err_same_station', 'frozen', { from: '板橋', to: '板橋' }],
  ['err_bad_mode', 'frozen', { from: '板橋', to: '淡水', mode: 'car' }],
  ['err_bad_time', 'frozen', { from: '板橋', to: '淡水', depart: 'tomorrow' }],
  ['err_bad_time_calendar', 'frozen', { from: '板橋', to: '淡水', depart: '2026-02-30T08:00' }]
];
const OTHER = [
  ['meta', () => E.meta()],
  ['stations', () => E.stations()],
  ['station_taipeistation', () => E.station('台北車站')],
  ['station_unknown', () => E.station('不存在站')]
];

function golden(name, actual) {
  const file = P('tests/golden', name + '.json');
  const got = JSON.parse(JSON.stringify(actual));
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n'); return; }
  assert.deepStrictEqual(got, JSON.parse(fs.readFileSync(file, 'utf8')), `黃金檔不符：tests/golden/${name}.json（若是有意的改變，用 UPDATE_GOLDEN=1 重新產生並檢查 git diff）`);
}

for (const [name, eng, req] of CASES) test('golden: ' + name, () => golden(name, { request: req, response: ENGINES[eng].plan(req) }));
for (const [name, fn] of OTHER) test('golden: ' + name, () => golden(name, fn()));

// ---------- 不變量（即時資料，資料重建後仍要成立）
const mins = iso => { const [d, t] = iso.slice(0, 16).split('T'); const [Y, M, D] = d.split('-').map(Number), [h, m] = t.split(':').map(Number); return Date.UTC(Y, M - 1, D, h, m) / 60000; };
function checkRoute(route, res, label) {
  const ride = route.steps.filter(s => s.type === 'ride'), tr = route.steps.filter(s => s.type === 'transfer');
  assert.equal(route.steps[0].type, 'enter', label); assert.equal(route.steps.at(-1).type, 'exit', label);
  const seq = route.steps.slice(1, -1).map(s => s.type).join(',');
  assert.equal(seq, ride.map((_, i) => i < ride.length - 1 ? 'ride,transfer' : 'ride').join(','), label + ' 步驟順序');
  assert.equal(route.transfers, tr.length, label);
  assert.deepEqual(route.lines, ride.map(r => r.line), label);
  // 時間不遞減（同格式 ISO 字串可直接比大小）
  const times = [];
  for (const s of route.steps) {
    if (s.type === 'ride') times.push(s.board.arrive, s.board.time, s.alight.time);
    else if (s.type === 'transfer') times.push(s.arrive, s.time);
    else times.push(s.time);
  }
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1], `${label} 時間倒退 ${times[i - 1]} → ${times[i]}`);
  // 總時間 = 抵達 − 出發（出發、抵達各自四捨五入到分，容許 1 分誤差）
  assert.ok(Math.abs(mins(route.arrive) - mins(route.depart) - route.totalMin) <= 1.01, `${label} total=${route.totalMin} 但 ${route.depart}→${route.arrive}`);
  for (const r of ride) {
    const N = r.car.total;
    assert.ok(r.car.recommended === null || (r.car.recommended >= 1 && r.car.recommended <= N), label + ' 車廂超出範圍');
    for (const side of [r.board, r.alight]) {
      assert.ok(side.targetCars.every(c => c >= 1 && c <= N), label + ' 電梯車廂超出範圍');
      assert.ok(side.walkCars >= 0 && side.walkCars <= N, label + ' 步行節數異常');
    }
    if (r.car.recommended !== null) { // 上下車同一節：下車端有標記時，搭乘車廂必在下站電梯（成本最低）
      if (r.alight.dataBasis === 'annotated') assert.ok(r.alight.targetCars.includes(r.car.recommended), label + ' 搭乘車廂不在下站電梯');
    }
  }
  if (res.searchMode === 'strict') assert.equal(route.warnings.length, 0, label + ' strict 不應有無電梯警告');
}
const MODES = ['wheel', 'stroller', 'walk'], TIMES = ['2026-11-09T08:00+08:00', '2026-11-09T17:30+08:00', '2026-11-07T23:30+08:00'];
const EL = createEngine(LIVE);

test('invariants: 代表性起訖站 × 三種行動方式 × 三個時段', () => {
  const pairs = [['板橋', '中山國中'], ['淡水', '象山'], ['動物園', '台北車站'], ['南港展覽館', '頂埔'], ['新店', '蘆洲'], ['松山', '迴龍'], ['北投', '新北投'], ['七張', '小碧潭']];
  let n = 0;
  for (const mode of MODES) for (const [a, b] of pairs) for (const depart of TIMES) {
    if (!LIVE.stations[a] || !LIVE.stations[b]) continue;
    const res = EL.plan({ from: a, to: b, mode, depart });
    if (res.error) { assert.ok(['NO_ROUTE', 'UNKNOWN_STATION'].includes(res.error.code), `${a}→${b} ${res.error.code}`); continue; }
    assert.ok(res.routes.length >= 1 && res.routes.length <= 3);
    for (let i = 1; i < res.routes.length; i++) assert.ok(res.routes[i].rankingCost >= res.routes[i - 1].rankingCost, '路線未依成本排序');
    res.routes.forEach((r, i) => { assert.equal(r.id, 'r' + (i + 1)); checkRoute(r, res, `${mode} ${a}→${b} ${depart} r${i + 1}`); }); n++;
  }
  assert.ok(n > 40, '有效查詢太少：' + n);
});

test('invariants: 從板橋到所有站（輪椅，平日 08:00）都有結果，且不當機', () => {
  const names = Object.keys(LIVE.stations).filter(s => s !== '板橋');
  let bad = [];
  for (const to of names) {
    const res = EL.plan({ from: '板橋', to, mode: 'wheel', depart: TIMES[0] });
    if (res.error) { bad.push(to + ':' + res.error.code); continue; }
    checkRoute(res.routes[0], res, '板橋→' + to);
  }
  assert.deepEqual(bad, [], '找不到路線的站');
});

test('決定性：同一請求兩次結果完全相同', () => {
  const req = { from: '新店', to: '蘆洲', mode: 'walk', depart: TIMES[1] };
  assert.deepEqual(EL.plan(req), EL.plan(req));
});

test('時區：UTC 輸入與臺北時間輸入結果相同；沒有時區的輸入視為臺北時間', () => {
  const base = { from: '板橋', to: '中山國中', mode: 'wheel' };
  const a = E.plan({ ...base, depart: '2026-11-09T00:00Z' }), b = E.plan({ ...base, depart: '2026-11-09T08:00+08:00' }), c = E.plan({ ...base, depart: '2026-11-09T08:00' });
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.equal(a.query.depart, '2026-11-09T08:00+08:00');
});

test('時區：不傳 depart 時用 opts.now（UTC 毫秒）換算成臺北時間', () => {
  const res = E.plan({ from: '板橋', to: '中山國中' }, { now: Date.UTC(2026, 10, 9, 0, 0) });
  assert.equal(res.query.depart, '2026-11-09T08:00+08:00');
});

test('跨午夜：抵達時間日期正確進位', () => {
  const res = E.plan({ from: '淡水', to: '象山', mode: 'wheel', depart: '2026-11-09T23:40+08:00' });
  assert.equal(res.routes[0].arrive.slice(0, 10), '2026-11-10');
});

test('人流：深夜與尖峰的總時間不同，且尖峰較長', () => {
  const peak = E.plan({ from: '新店', to: '蘆洲', mode: 'wheel', depart: MON8 }).routes[0].totalMin;
  const night = E.plan({ from: '新店', to: '蘆洲', mode: 'wheel', depart: '2026-11-09T23:00+08:00' }).routes[0].totalMin;
  assert.ok(peak > night, `尖峰 ${peak} 應大於深夜 ${night}`);
});

test('無標記：成本與車廂無關（不給車廂建議，步行為固定期望值）', () => {
  const res = ENGINES.unmarked.plan({ from: '板橋', to: '中山國中', mode: 'wheel', depart: MON8 });
  for (const r of res.routes[0].steps.filter(s => s.type === 'ride')) {
    assert.equal(r.car.recommended, null); assert.equal(r.board.walkAssumed, true);
    const N = r.car.total; assert.ok(Math.abs(r.board.walkCars - Math.round((N * N - 1) / (3 * N) * 10) / 10) < 1e-9);
  }
});

test('放寬搜尋：動物園（月台沒有電梯）輪椅回 relaxed 並附警告', () => {
  const res = E.plan({ from: '動物園', to: '台北車站', mode: 'wheel', depart: MON8 });
  assert.equal(res.searchMode, 'relaxed');
  assert.ok(res.routes[0].warnings.some(w => w.code === 'NO_ELEVATOR_PLATFORM' && w.station === '動物園'));
});
