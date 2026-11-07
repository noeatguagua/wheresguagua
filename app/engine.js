/* 捷運無礙行 路線引擎（純函式，不碰 DOM、不發網路請求）
 *
 *   瀏覽器：<script src="data.js"></script><script src="engine.js"></script>
 *           const E = MetroEngine.createEngine(window.METRO_DATA); E.plan({...})
 *   Node  ：const {createEngine} = require('./engine.js'); createEngine(data).plan({...})
 *
 * 輸出契約見 docs/API-spec-v0.md。權重公式與假設值見 docs/ADR-001 §8（v0.3、v0.4）。
 * 輸出只含資料與代碼，不含中文敘述句；官方原文（電梯位置描述）原樣傳回。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MetroEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_VERSION = 'v0';
  const PARAMS_VERSION = '0.4';
  const TZ_OFFSET_MIN = 480; // 臺北時間 UTC+8，不隨執行環境的時區改變

  const MODE = {
    wheel:    { f: 1.6, label: '輪椅' },
    stroller: { f: 1.5, label: '嬰兒車' },
    walk:     { f: 1.2, label: '步行輔具' }
  };
  const CAR_M = 22; // 每節車廂長度（公尺，概估）
  const carsOf = l => (l === '文湖線' ? 4 : 6);

  // ---------- 權重參數（全部是假設值，待現場實測校正）
  const PARAM = {
    WAIT: 3.5,        // 候車（分）
    WALK_SPEED: 1.2,  // 月台步行速度（公尺/秒），再乘以行動方式係數
    XFER_DISC: 0.8,   // 官方轉乘時間已含部分月台步行，打折避免重複計算
    ELEV_WAIT: { wheel: 1.5, stroller: 1.5, walk: 0.5 }, // 轉乘時等電梯（分）
    OVERLAP: 0.8,     // 候車時間中可拿來在月台走動的比例
    BLOCKED: 60,      // 月台沒有可用電梯的排序懲罰（只在放寬搜尋時使用）
    ENTER: 3,         // 進站到月台的固定時間（分）
    CROWD: {
      WAIT: 0.5, ELEV: 1.0, WALK: 0.3,
      SENS: { wheel: 1, stroller: 1, walk: 0.6 }
    }
  };

  const r1 = x => Math.round(x * 10) / 10;
  const pad = n => String(n).padStart(2, '0');
  const normName = s => String(s ?? '').replace(/臺/g, '台').trim();

  // ---------- 臺北時間工具：所有時間以「當天 0 點起算的分鐘」計算，輸出為含 +08:00 的 ISO 8601
  function fromLocalMs(l) {
    const d = new Date(l);
    const Y = d.getUTCFullYear(), M = d.getUTCMonth(), Dd = d.getUTCDate();
    return { dateMs: Date.UTC(Y, M, Dd), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
             date: `${Y}-${pad(M + 1)}-${pad(Dd)}`, weekend: [0, 6].includes(d.getUTCDay()) };
  }
  function parseDepart(x, nowMs) {
    if (x === undefined || x === null || x === '') return fromLocalMs(nowMs + TZ_OFFSET_MIN * 60000);
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(x).trim());
    if (!m) return null;
    const [Y, M, Dd, h, mi, s] = m.slice(1, 7).map(Number), off = m[7];
    let l = Date.UTC(Y, M - 1, Dd, h, mi, s || 0);
    const chk = new Date(l);
    if (M < 1 || M > 12 || h > 23 || mi > 59 || (s || 0) > 59 || chk.getUTCMonth() !== M - 1 || chk.getUTCDate() !== Dd) return null;
    if (off) { // 有時區 → 換算成臺北時間；沒有 → 視為臺北當地時間
      const sign = off[0] === '-' ? -1 : 1, hm = off === 'Z' ? [0, 0] : off.slice(1).replace(':', '').match(/\d{2}/g).map(Number);
      l = l - sign * ((hm[0] || 0) * 60 + (hm[1] || 0)) * 60000 + TZ_OFFSET_MIN * 60000;
    }
    return fromLocalMs(l);
  }
  const isoAt = (dateMs, minutes) => {
    const d = new Date(dateMs + Math.round(minutes) * 60000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}+08:00`;
  };

  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  }

  function createEngine(D) {
    const S = D.stations, ACC = D.access || {};
    const key = (s, l) => s + '|' + l, key3 = (s, l, v) => s + '|' + l + '|' + v;

    // ---------- 路網
    const hav = (a, b) => { const R = 6371, t = Math.PI / 180, dl = (b.lat - a.lat) * t, dn = (b.lng - a.lng) * t;
      const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    const hop = (a, b) => { if (D.hopTime && D.hopTime[a + '|' + b] !== undefined) return D.hopTime[a + '|' + b];
      const A = S[a], B = S[b]; if (!A.lat || !B.lat) return 2.2; return Math.max(1.3, hav(A, B) / 0.55 + 0.7); };
    const nbrs = {}; // 線 → 站 → 相鄰站
    for (const [l, a, b] of D.edges) for (const [x, y] of [[a, b], [b, a]]) ((nbrs[l] ||= {})[x] ||= new Set()).add(y);
    const lineOfStation = n => Object.keys(S[n].lines);
    const xferInfo = (n, l1, l2) => D.lineTransfer?.[n + '|' + l1 + '|' + l2];
    const twalk = (n, l1, l2) => xferInfo(n, l1, l2)?.min ?? D.transferWalk[n] ?? D.transferWalk[n.replace(/站$/, '')] ?? 6;

    // ---------- 電梯風險、人流
    function risk(n, iso) {
      const r = { ano: D.anomalies[n] || null, maint: (D.maint[n] || []).filter(m => m.date === iso) };
      r.pen = (r.ano ? 15 : 0) + (r.maint.length ? 3 : 0); return r;
    }
    function level(n, hour, wk) {
      const a = D.crowd[n] && D.crowd[n][wk ? 'we' : 'wd']; if (!a) return null;
      const t = D.crowdMeta.thresholds, v = a[hour];
      return { v, lv: v < t[0] ? 1 : v < t[1] ? 2 : v < t[2] ? 3 : 4 };
    }
    const crowdG = (n, t, wk) => { const L = level(n, Math.floor(((t % 1440) + 1440) % 1440 / 60), wk); return L ? (L.lv - 1) / 3 : 0; };
    const crowdM = (coef, mode, g) => 1 + coef * PARAM.CROWD.SENS[mode] * g;
    function crowdInfo(n, t, wk) {
      const hour = Math.floor(((t % 1440) + 1440) % 1440 / 60), L = level(n, hour, wk);
      return L ? { level: L.lv, g: r1((L.lv - 1) / 3 * 100) / 100, avgPerHour: L.v, hour } : null;
    }

    // ---------- 車廂與月台步行
    const unkCars = N => (N * N - 1) / (3 * N); // 無標記：與車廂無關的期望距離
    const tau = mode => CAR_M / PARAM.WALK_SPEED / 60 * MODE[mode].f;
    const targets = (acc, mode) => !acc ? [] : (mode === 'walk' ? [...acc.el, ...acc.es] : acc.el);
    const blocked = (acc, mode) => !!acc && !targets(acc, mode).length && (mode === 'walk' ? (acc.elNone && acc.escNone) : acc.elNone);
    const carSet = (acc, mode, flip, N) => targets(acc, mode).map(e => flip ? N + 1 - e.car : e.car);
    const nearest = (set, c) => set.length ? Math.min(...set.map(e => Math.abs(e - c))) : 0;
    function alightAcc(s, l, prev) { // 下車站：列車繼續前進的方向；終點站標記的是離站方向，要反向換算
      const cand = [...(nbrs[l][s] || [])].filter(x => x !== prev);
      if (cand.length) return { acc: cand.map(v => ACC[key3(s, l, v)]).find(Boolean), flip: false };
      return { acc: ACC[key3(s, l, prev)], flip: true };
    }
    function walkCarsAt(acc, flip, c, mode, N) {
      if (!acc) return unkCars(N);
      const set = carSet(acc, mode, flip, N);
      if (set.length) return nearest(set, c);
      return blocked(acc, mode) ? null : unkCars(N);
    }
    function boardCost(acc, c, mode, N, strict, g = 0) {
      const W = PARAM.WAIT * crowdM(PARAM.CROWD.WAIT, mode, g), k = walkCarsAt(acc, false, c, mode, N);
      if (k === null) return strict ? { w: Infinity, p: 0 } : { w: W, p: PARAM.BLOCKED };
      return { w: W + Math.max(0, tau(mode) * crowdM(PARAM.CROWD.WALK, mode, g) * k - PARAM.OVERLAP * W), p: 0 };
    }
    function alightCost(acc, flip, c, mode, N, strict, g = 0) {
      const k = walkCarsAt(acc, flip, c, mode, N);
      if (k === null) return strict ? { w: Infinity, p: 0 } : { w: 0, p: PARAM.BLOCKED };
      return { w: tau(mode) * crowdM(PARAM.CROWD.WALK, mode, g) * k, p: 0 };
    }
    const xferMin = (n, l1, l2, mode, g = 0) =>
      twalk(n, l1, l2) * MODE[mode].f * PARAM.XFER_DISC * crowdM(PARAM.CROWD.WALK, mode, g) + PARAM.ELEV_WAIT[mode] * crowdM(PARAM.CROWD.ELEV, mode, g);

    // ---------- 最短路徑：節點 Q(站,線)、T(站,線,前一站,車廂)；同一段車程車廂不變
    // ctx = {dep: 出發分鐘, wk: 是否假日, iso: 出發日期}；strict=false 時以 BLOCKED 懲罰取代排除
    function dijkstra(from, to, mode, banned, strict, ctx) {
      const gAt = (n, r) => crowdG(n, ctx.dep + r, ctx.wk);
      const dist = {}, real = {}, prev = {}, done = new Set(), heap = new Heap();
      const push = (k, d, r, p) => { if (dist[k] === undefined || d < dist[k] - 1e-9) { dist[k] = d; real[k] = r; prev[k] = p; heap.push([d, k]); } };
      for (const l of lineOfStation(from)) { const w = PARAM.ENTER + risk(from, ctx.iso).pen; push(`Q|${from}|${l}`, w, w, null); }
      while (heap.size) {
        const [d, k] = heap.pop(); if (done.has(k)) continue; done.add(k); if (k === 'END') break;
        const q = k.split('|'), r = real[k];
        if (q[0] === 'Q') {
          const s = q[1], l = q[2], N = carsOf(l), g = gAt(s, r);
          for (const n of nbrs[l][s] || []) {
            const acc = ACC[key3(s, l, n)], h = hop(s, n);
            for (let c = 1; c <= N; c++) { const b = boardCost(acc, c, mode, N, strict, g); if (b.w === Infinity) continue;
              push(`T|${n}|${l}|${s}|${c}`, d + b.w + b.p + h, r + b.w + h, k); }
          }
        } else {
          const s = q[1], l = q[2], pv = q[3], c = +q[4], N = carsOf(l), g = gAt(s, r);
          for (const n of nbrs[l][s] || []) if (n !== pv) { const h = hop(s, n); push(`T|${n}|${l}|${s}|${c}`, d + h, r + h, k); }
          const { acc, flip } = alightAcc(s, l, pv), a = alightCost(acc, flip, c, mode, N, strict, g);
          if (a.w === Infinity) continue;
          if (s === to) push('END', d + a.w + a.p, r + a.w, k);
          else if (s !== from && !banned.has(s))
            for (const l2 of lineOfStation(s)) if (l2 !== l) { const x = xferMin(s, l, l2, mode, g) + risk(s, ctx.iso).pen; push(`Q|${s}|${l2}`, d + a.w + a.p + x, r + a.w + x, k); }
        }
      }
      if (dist.END === undefined) return null;
      const nodes = []; for (let k = prev.END; k; k = prev[k]) nodes.unshift(k);
      const path = nodes.map(k => { const q = k.split('|'); return q[1] + '|' + q[2]; });
      const cars = nodes.map((k, i) => k[0] === 'T' && nodes[i - 1][0] === 'Q' ? +k.split('|')[4] : 0).filter(Boolean);
      return { path, total: real.END, cost: dist.END, cars };
    }
    function segments(path) {
      const segs = []; let cur = null;
      for (const k of path) { const [st, l] = k.split('|');
        if (!cur || cur.line !== l) { cur = { line: l, stops: [st] }; segs.push(cur); } else if (cur.stops[cur.stops.length - 1] !== st) cur.stops.push(st); }
      return segs;
    }
    function termOf(seg) { // 行進方向的終點站
      const ord = D.lineOrder[seg.line] || []; const a = seg.stops[0], b = seg.stops[seg.stops.length - 1];
      const ia = ord.indexOf(a), ib = ord.indexOf(b);
      if (ia < 0 || ib < 0) return b;
      return ib > ia ? ord[ord.length - 1] : ord[0];
    }

    // ---------- 一段車程的車廂建議
    function carPlan(seg, mode, car) {
      const line = seg.line, N = carsOf(line), st = seg.stops; if (st.length < 2) return null;
      const a = st[0], b = st[st.length - 1], p = st[st.length - 2];
      const bAcc = ACC[key3(a, line, st[1])];
      const cand = [...(nbrs[line][b] || [])].filter(x => x !== p);
      let aAcc, flip = false;
      if (cand.length) aAcc = cand.map(v => ACC[key3(b, line, v)]).find(Boolean);
      else { aAcc = ACC[key3(b, line, p)]; flip = true; }
      const bT = targets(bAcc, mode), aT = targets(aAcc, mode).map(e => ({ ...e, car: flip ? N + 1 - e.car : e.car }));
      let rec = null, walk = 0, chosen = [];
      if (aT.length && bT.length) { let best = null; for (const x of aT) for (const y of bT) { const d = Math.abs(x.car - y.car); if (!best || d < best.d) best = { d, x, y }; }
        rec = best.x.car; walk = best.d; chosen = [best.x, best.y]; }
      else if (aT.length) { rec = aT[0].car; chosen = [aT[0]]; }
      else if (bT.length) { rec = bT[0].car; chosen = [bT[0]]; }
      if (car && aT.length && aT.some(e => e.car === car) && rec !== car) { // 成本平手時，以路線規劃選的車廂為準
        rec = car; walk = bT.length ? Math.min(...bT.map(e => Math.abs(e.car - car))) : 0;
        chosen = [aT.find(e => e.car === car), ...(bT.length ? [bT.reduce((m, e) => Math.abs(e.car - car) < Math.abs(m.car - car) ? e : m)] : [])];
      }
      const c0 = rec ?? 1;
      const bWalk = walkCarsAt(bAcc, false, c0, mode, N) ?? 0, aWalk = walkCarsAt(aAcc, flip, c0, mode, N) ?? 0;
      return { N, a, b, bAcc, aAcc, bT, aT, rec, walk, bWalk, aWalk, flip, chosen,
        unsure: chosen.some(e => e.mirrored && !e.verified), warnB: blocked(bAcc, mode), warnA: blocked(aAcc, mode),
        missing: !bAcc && !aAcc };
    }

    // ---------- 站名解析
    const stationNames = Object.keys(S).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    function resolveStation(input) {
      const n = normName(input); if (!n) return { name: null, suggestions: [] };
      for (const c of [n, n.replace(/站$/, ''), n + '站']) if (S[c]) return { name: c };
      const base = n.replace(/站$/, '');
      const sug = stationNames.filter(x => base && (x.includes(base) || base.includes(x.replace(/站$/, '')))).slice(0, 5);
      return { name: null, suggestions: sug };
    }

    // ---------- 組出結構化路線（時間表在這裡算，畫面不再自己算）
    const slimEntry = (e, N, flip) => ({ car: flip ? N + 1 - e.car : e.car, label: (e.label && e.label !== '手扶梯') ? e.label : '',
      unverified: !!(e.mirrored && !e.verified) });
    const dirOfAcc = acc => acc ? acc.dir : null;

    function buildRoute(route, mode, ctx, idx) {
      const segs = segments(route.path), first = segs[0].stops[0], last = segs[segs.length - 1].stops.slice(-1)[0];
      const riskOut = n => { const r = risk(n, ctx.iso); return { anomaly: r.ano ? { time: r.ano.time, text: r.ano.text, line: r.ano.line } : null,
        maintenance: r.maint.map(m => ({ date: m.date, location: m.loc, slot: m.slot, id: m.id })) }; };
      const exitInfo = (n, line) => ({ exitElevatorText: S[n].lines[line]?.exitElev || '',
        elevatorExits: (S[n].elevExits || []).map(x => ({ id: x.id, description: x.desc || '' })), accessibleExits: S[n].accExits || [] });
      const at = t => isoAt(ctx.dateMs, t);
      let clock = ctx.dep + PARAM.ENTER + risk(first, ctx.iso).pen;
      const steps = [], warnings = [], anomalyStations = new Set();
      let unverified = false, platformWalkCars = 0;
      for (const sg of segs) for (const n of sg.stops) if (risk(n, ctx.iso).ano) anomalyStations.add(n);

      steps.push({ type: 'enter', station: first, line: segs[0].line, time: at(ctx.dep), risk: riskOut(first), ...exitInfo(first, segs[0].line) });

      segs.forEach((sg, i) => {
        const a = sg.stops[0], b = sg.stops[sg.stops.length - 1], hops = sg.stops.length - 1, N = carsOf(sg.line);
        let ride = 0; for (let j = 0; j < hops; j++) ride += hop(sg.stops[j], sg.stops[j + 1]);
        const pl = carPlan(sg, mode, route.cars?.[i]);
        const arriveB = clock, gB = crowdG(a, clock, ctx.wk), wB = PARAM.WAIT * crowdM(PARAM.CROWD.WAIT, mode, gB);
        const bWalk = pl?.bWalk || 0;
        clock += wB + Math.max(0, tau(mode) * crowdM(PARAM.CROWD.WALK, mode, gB) * bWalk - PARAM.OVERLAP * wB);
        const boardT = clock; clock += ride;
        const alightT = clock, gA = crowdG(b, clock, ctx.wk), aWalk = pl?.aWalk || 0;
        clock += tau(mode) * crowdM(PARAM.CROWD.WALK, mode, gA) * aWalk;

        if (pl) {
          if (pl.warnB) warnings.push({ code: 'NO_ELEVATOR_PLATFORM', station: a, line: sg.line, role: 'board' });
          if (pl.warnA) warnings.push({ code: 'NO_ELEVATOR_PLATFORM', station: b, line: sg.line, role: 'alight' });
          if (pl.unsure) unverified = true;
          if (!pl.missing && pl.rec) platformWalkCars += pl.walk;
        }
        const basisOf = acc => !acc ? 'none' : (blocked(acc, mode) ? 'blocked' : (targets(acc, mode).length ? 'annotated' : 'unknown'));
        const side = (acc, flip, walkCars, station, extra) => ({
          station, ...extra,
          dataBasis: basisOf(acc),                       // annotated 人工標記｜unknown 有紀錄但無可用位置｜blocked 月台沒有電梯｜none 沒有標記
          walkCars: r1(walkCars), walkMeters: Math.round(walkCars * CAR_M),
          walkAssumed: !acc || (!blocked(acc, mode) && !targets(acc, mode).length), // true＝使用固定期望值，不是實際距離
          elevators: acc ? acc.el.map(e => slimEntry(e, N, flip)) : [],
          escalators: acc ? acc.es.map(e => slimEntry(e, N, flip)) : [],
          elevatorNone: !!acc?.elevatorNone || !!acc?.elNone, escalatorNone: !!acc?.escalatorNone || !!acc?.escNone,
          targetCars: acc ? [...new Set(carSet(acc, mode, flip, N))].sort((x, y) => x - y) : []
        });
        const bAcc = pl?.bAcc, aAcc = pl?.aAcc;
        const car = { recommended: pl?.rec ?? null, total: N,
          basis: !pl || pl.rec === null ? 'none' : (pl.unsure ? 'mirrored' : 'annotated'),
          reason: !pl || pl.rec !== null ? null : (pl.missing ? 'missing' : (pl.warnA || pl.warnB ? 'blocked' : 'no-data')) };
        steps.push({
          type: 'ride', line: sg.line, from: a, to: b, towards: termOf(sg), stops: hops, stopNames: sg.stops, rideMin: r1(ride), car,
          board: side(bAcc, false, bWalk, a, { arrive: at(arriveB), time: at(boardT), waitMin: r1(wB), crowd: crowdInfo(a, arriveB, ctx.wk),
            platformElevatorText: S[a].lines[sg.line]?.platElev || '' }),
          alight: side(aAcc, !!pl?.flip, aWalk, b, { time: at(alightT), terminalFlipped: !!pl?.flip, crowd: crowdInfo(b, alightT, ctx.wk) })
        });
        if (i < segs.length - 1) {
          const nxt = segs[i + 1], xm = xferMin(b, sg.line, nxt.line, mode, gA), pen = risk(b, ctx.iso).pen;
          const base = xferMin(b, sg.line, nxt.line, mode, 0);
          const arriveX = clock; clock += xm + pen;
          steps.push({ type: 'transfer', station: b, fromLine: sg.line, toLine: nxt.line, officialMin: twalk(b, sg.line, nxt.line),
            onSite: xferInfo(b, sg.line, nxt.line)?.onSite ?? null, estimatedMin: r1(xm), elevatorWaitMin: r1(PARAM.ELEV_WAIT[mode] * crowdM(PARAM.CROWD.ELEV, mode, gA)),
            riskPenaltyMin: pen, crowdBonusPct: gA > 0 ? Math.round((xm / base - 1) * 100) : 0,
            arrive: at(arriveX), time: at(clock), crowd: crowdInfo(b, alightT, ctx.wk), risk: riskOut(b) });
        }
      });
      steps.push({ type: 'exit', station: last, line: segs[segs.length - 1].line, time: at(clock), risk: riskOut(last), ...exitInfo(last, segs[segs.length - 1].line) });

      return { id: 'r' + (idx + 1), totalMin: r1(route.total), depart: at(ctx.dep), arrive: at(clock), transfers: segs.length - 1,
        lines: segs.map(s => s.line), rankingCost: r1(route.cost), warnings,
        flags: { unverifiedCars: unverified, anomalyStations: [...anomalyStations] },
        summary: { platformWalkCars, platformWalkMeters: platformWalkCars * CAR_M }, steps };
    }

    // ---------- 公開 API
    function meta() {
      return {
        apiVersion: API_VERSION, paramsVersion: PARAMS_VERSION, dataBuilt: D.built, anomalySnapshot: D.built,
        crowd: { month: D.crowdMeta?.month ?? null, thresholds: D.crowdMeta?.thresholds ?? null, days: D.crowdMeta?.days ?? null },
        scope: { lines: Object.keys(D.lineOrder), excluded: ['環狀線', '小碧潭支線'] },
        modes: Object.fromEntries(Object.entries(MODE).map(([k, v]) => [k, { label: v.label, factor: v.f, elevatorWaitMin: PARAM.ELEV_WAIT[k], crowdSensitivity: PARAM.CROWD.SENS[k], useEscalator: k === 'walk' }])),
        params: { waitMin: PARAM.WAIT, walkSpeedMps: PARAM.WALK_SPEED, carLengthM: CAR_M, transferDiscount: PARAM.XFER_DISC, overlap: PARAM.OVERLAP,
          enterMin: PARAM.ENTER, blockedPenalty: PARAM.BLOCKED, crowd: { wait: PARAM.CROWD.WAIT, elevator: PARAM.CROWD.ELEV, walk: PARAM.CROWD.WALK },
          carsPerTrain: { '文湖線': 4, other: 6 }, assumptions: 'all-estimated' },
        carData: { directions: Object.keys(ACC).length,
          mirroredUnverified: Object.values(ACC).reduce((n, a) => n + [...a.el, ...a.es].filter(e => e.mirrored && !e.verified).length, 0) }
      };
    }
    function stations() {
      return stationNames.map(n => ({ name: n, lines: Object.entries(S[n].lines).map(([line, v]) => ({ line, code: v.code })),
        lat: S[n].lat ?? null, lng: S[n].lng ?? null }));
    }
    function station(input) {
      const rs = resolveStation(input);
      if (!rs.name) return { error: { code: 'UNKNOWN_STATION', message: `Unknown station: ${input}`, suggestions: rs.suggestions } };
      const n = rs.name, s = S[n];
      const prof = k => D.crowd[n] ? D.crowd[n][k].map((v, hour) => ({ hour, avgPerHour: v, level: level(n, hour, k === 'we').lv })) : null;
      return { name: n,
        lines: Object.fromEntries(Object.entries(s.lines).map(([line, v]) => [line, { code: v.code, exitElevatorText: v.exitElev || '', platformElevatorText: v.platElev || '' }])),
        elevatorExits: (s.elevExits || []).map(x => ({ id: x.id, description: x.desc || '' })), accessibleExits: s.accExits || [],
        status: { anomaly: D.anomalies[n] ? { time: D.anomalies[n].time, text: D.anomalies[n].text, line: D.anomalies[n].line } : null,
          maintenance: (D.maint[n] || []).map(m => ({ date: m.date, location: m.loc, slot: m.slot, id: m.id })), snapshot: D.built },
        crowd: D.crowd[n] ? { month: D.crowdMeta.month, weekday: prof('wd'), weekend: prof('we') } : null,
        lat: s.lat ?? null, lng: s.lng ?? null };
    }
    const err = (code, message, extra) => ({ error: { code, message, ...extra } });

    // req = {from, to, mode, depart?, max?}；opts = {now?: 毫秒}（測試用）。回傳 {…} 或 {error:{code,message}}
    function plan(req, opts = {}) {
      req = req || {};
      const mode = req.mode ?? 'wheel';
      if (!MODE[mode]) return err('BAD_MODE', `mode must be one of: ${Object.keys(MODE).join(', ')}`);
      const f = resolveStation(req.from), t = resolveStation(req.to);
      if (!f.name) return err('UNKNOWN_STATION', `Unknown station: ${req.from}`, { field: 'from', suggestions: f.suggestions });
      if (!t.name) return err('UNKNOWN_STATION', `Unknown station: ${req.to}`, { field: 'to', suggestions: t.suggestions });
      if (f.name === t.name) return err('SAME_STATION', 'from and to are the same station');
      const dp = parseDepart(req.depart instanceof Date ? req.depart.toISOString() : req.depart, opts.now ?? Date.now());
      if (!dp) return err('BAD_TIME', 'depart must be ISO 8601, e.g. 2026-11-09T08:00+08:00');
      const max = Math.min(5, Math.max(1, parseInt(req.max ?? 3, 10) || 3));
      const ctx = { dep: dp.minutes, wk: dp.weekend, iso: dp.date, dateMs: dp.dateMs };
      const sigOf = r => segments(r.path).map(s => s.line).join('>') + '#' + segments(r.path).map(s => s.stops[0]).join('>');
      // 候選路線：逐一禁止轉乘站，找出不同的轉乘方案（最多探索 14 組）
      const gen = strict => {
        const routes = [], seen = new Set(), tried = new Set(), queue = [new Set()]; let guard = 0;
        while (queue.length && guard < 14) {
          const banned = queue.shift(), bk = [...banned].sort().join(','); if (tried.has(bk)) continue; tried.add(bk); guard++;
          const r = dijkstra(f.name, t.name, mode, banned, strict, ctx); if (!r) continue;
          if (!seen.has(sigOf(r))) { seen.add(sigOf(r)); routes.push(r); }
          for (const sg of segments(r.path).slice(1)) queue.push(new Set([...banned, sg.stops[0]]));
        }
        return routes;
      };
      let routes = gen(true), searchMode = 'strict';        // 先只找全程都有可用電梯的路線
      if (!routes.length) { routes = gen(false); searchMode = 'relaxed'; } // 找不到才放寬，並附警告
      if (!routes.length) return err('NO_ROUTE', 'no route found');
      routes.sort((a, b) => a.cost - b.cost);
      return {
        meta: { apiVersion: API_VERSION, paramsVersion: PARAMS_VERSION, dataBuilt: D.built, crowdMonth: D.crowdMeta?.month ?? null },
        query: { from: f.name, to: t.name, mode, depart: isoAt(dp.dateMs, dp.minutes), weekend: dp.weekend, max },
        searchMode,
        routes: routes.slice(0, max).map((r, i) => buildRoute(r, mode, ctx, i))
      };
    }

    return { plan, stations, station, meta, resolveStation,
      _internal: { dijkstra, segments, carPlan, PARAM, MODE, tau, parseDepart, isoAt } };
  }

  return { createEngine, API_VERSION, PARAMS_VERSION };
});
