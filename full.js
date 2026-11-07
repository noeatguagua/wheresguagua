
const D = window.METRO_DATA, S = D.stations, ACC = D.access || {};
const LINE_COLOR = {'文湖線':'#c48c31','淡水信義線':'#e3002c','松山新店線':'#008659','中和新蘆線':'#f8b61c','板南線':'#0070bd'};
const LINE_DARK_TEXT = new Set(['中和新蘆線']);
const carsOf = l => l==='文湖線' ? 4 : 6;
const CAR_M = 22; // 每節車廂長度（公尺，概估）
const MODE = {wheel:{f:1.6,label:'輪椅'},stroller:{f:1.5,label:'嬰兒車'},walk:{f:1.2,label:'步行輔具'}};
// ---------- 路線權重參數（全部是假設值，待現場實測校正；見 ADR-001 §9）
const PARAM = {
  WAIT: 3.5,        // 候車（分）；之後改用 TDX Frequency 班距的一半
  WALK_SPEED: 1.2,  // 月台步行速度（公尺/秒），再乘以行動方式係數
  XFER_DISC: 0.8,   // 官方轉乘時間已含一段月台步行，打折避免和月台步行重複計算
  ELEV_WAIT: {wheel:1.5, stroller:1.5, walk:0.5}, // 轉乘時等電梯（分）；步行輔具可改走手扶梯，故較低
  OVERLAP: 0.5,     // 候車時間中，可以拿來在月台走動的比例
  BLOCKED: 60       // 月台沒有可用電梯；只有找不到全程可行路線時才退而求其次，並顯示警告
};
// 無標記：假設出車廂後到電梯／手扶梯的距離一致，與搭哪一節無關。
// 距離取「兩端位置隨機」時的期望節數 (N²−1)/(3N)：6 節≈1.94、4 節≈1.25，不另設參數、也不加排序懲罰。
const unkCars = N => (N*N-1)/(3*N);
// 走過一節車廂要幾分鐘（22m ÷ 步行速度 × 行動方式係數）：輪椅≈0.49、嬰兒車≈0.46、步行輔具≈0.37
const tau = mode => CAR_M / PARAM.WALK_SPEED / 60 * MODE[mode].f;
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const esc = s => (s??'').toString().replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fmt = m => { m=Math.round(m)%1440; return `${pad(Math.floor(m/60))}:${pad(m%60)}`; };
const names = Object.keys(S).sort((a,b)=>a.localeCompare(b,'zh-Hant'));
$('stl').innerHTML = names.map(n=>`<option value="${n}">`).join('');
function setNow(){const d=new Date();d.setSeconds(0,0);$('when').value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
setNow();

// ---------- graph
const hav=(a,b)=>{const R=6371,t=Math.PI/180,dl=(b.lat-a.lat)*t,dn=(b.lng-a.lng)*t;
  const x=Math.sin(dl/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
const hop=(a,b)=>{if(D.hopTime&&D.hopTime[a+'|'+b]!==undefined)return D.hopTime[a+'|'+b];const A=S[a],B=S[b];if(!A.lat||!B.lat)return 2.2;return Math.max(1.3,hav(A,B)/0.55+0.7);};
const adj={}, nbrs={}; // adj: 站|線 → [[站|線, 分鐘]]；nbrs: 線 → 站 → 相鄰站
const key=(s,l)=>s+'|'+l, key3=(s,l,v)=>s+'|'+l+'|'+v;
for(const [l,a,b] of D.edges){
  for(const [x,y] of [[a,b],[b,a]]){(adj[key(x,l)] ||= []).push([key(y,l),hop(x,y)]);((nbrs[l] ||= {})[x] ||= new Set()).add(y);}
}
const lineOfStation = n => Object.keys(S[n].lines);
const twalk = (n,l1,l2) => D.lineTransfer?.[n+'|'+l1+'|'+l2]?.min ?? D.transferWalk[n] ?? D.transferWalk[n.replace(/站$/,'')] ?? 6;

function risk(n, iso){ // 電梯風險：異常公告、當日預排檢修
  const r={ano:D.anomalies[n]||null, maint:(D.maint[n]||[]).filter(m=>m.date===iso)};
  r.pen=(r.ano?15:0)+(r.maint.length?3:0);return r;
}
// ---------- 加權圖：節點帶「車廂」狀態，同一段車程車廂編號不變（人無法在車廂內移動）
//  Q(s,L)          在 s 站、準備搭 L 線（進站或轉乘完成）
//  T(s,L,prev,c)   在第 c 節車廂，列車停在 s 站、從 prev 來
//  邊：
//   上車  Q(s,L)→T(n,L,s,c)   WAIT + max(0, τ·|c−最近的上車電梯| − OVERLAP·WAIT) + 行駛(s,n)
//   行駛  T(s,L,p,c)→T(n,L,s,c)  行駛(s,n)                       ← c 不變
//   下車  T(s,L,p,c)→END 或 Q(s,L')  τ·|c−最近的下車電梯|  [+ 轉乘：官方×係數×XFER_DISC + 等電梯 + 電梯風險]
//  起點  Q(from,L) 成本 3 + 電梯風險
const targets=(acc,mode)=>!acc?[]:(mode==='walk'?[...acc.el,...acc.es]:acc.el);
const blocked=(acc,mode)=>!!acc&&!targets(acc,mode).length&&(mode==='walk'?(acc.elNone&&acc.escNone):acc.elNone);
const carSet=(acc,mode,flip,N)=>targets(acc,mode).map(e=>flip?N+1-e.car:e.car);
const nearest=(set,c)=>set.length?Math.min(...set.map(e=>Math.abs(e-c))):0;
function alightAcc(s,l,prev){ // 下車站：列車繼續前進的方向；終點站標記的是離站方向，要反向換算
  const cand=[...(nbrs[l][s]||[])].filter(x=>x!==prev);
  if(cand.length) return {acc:cand.map(v=>ACC[key3(s,l,v)]).find(Boolean),flip:false};
  return {acc:ACC[key3(s,l,prev)],flip:true};
}
// 月台步行節數：有標記→到最近電梯的距離；無標記→與車廂無關的固定值 unkCars(N)；月台沒有電梯→null（不可行）
function walkCarsAt(acc,flip,c,mode,N){
  if(!acc) return unkCars(N);
  const set=carSet(acc,mode,flip,N);
  if(set.length) return nearest(set,c);
  return blocked(acc,mode)?null:unkCars(N);
}
// 回傳 {w:實際分鐘, p:排序用懲罰}；w=Infinity 表示不可行
function boardCost(acc,c,mode,N,strict){
  const W=PARAM.WAIT, k=walkCarsAt(acc,false,c,mode,N);
  if(k===null) return strict?{w:Infinity,p:0}:{w:W,p:PARAM.BLOCKED};
  return {w:W+Math.max(0,tau(mode)*k-PARAM.OVERLAP*W),p:0};
}
function alightCost(acc,flip,c,mode,N,strict){
  const k=walkCarsAt(acc,flip,c,mode,N);
  if(k===null) return strict?{w:Infinity,p:0}:{w:0,p:PARAM.BLOCKED};
  return {w:tau(mode)*k,p:0};
}
const xferMin=(n,l1,l2,mode)=>twalk(n,l1,l2)*MODE[mode].f*PARAM.XFER_DISC+PARAM.ELEV_WAIT[mode];
class Heap{constructor(){this.a=[];}get size(){return this.a.length;}
  push(x){const a=this.a;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[p],a[i]]=[a[i],a[p]];i=p;}}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;
    if(l<a.length&&a[l][0]<a[m][0])m=l;if(r<a.length&&a[r][0]<a[m][0])m=r;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m;}}return top;}}
// strict=true：月台沒有可用電梯的方向直接排除；false：改以 BLOCKED 懲罰（只在 strict 找不到路線時使用）
function dijkstra(from,to,mode,iso,banned,strict=true){
  const dist={}, real={}, prev={}, done=new Set(), heap=new Heap();
  const push=(k,d,r,p)=>{if(dist[k]===undefined||d<dist[k]-1e-9){dist[k]=d;real[k]=r;prev[k]=p;heap.push([d,k]);}};
  for(const l of lineOfStation(from)){const w=3+risk(from,iso).pen; push(`Q|${from}|${l}`,w,w,null);}
  while(heap.size){
    const [d,k]=heap.pop(); if(done.has(k))continue; done.add(k); if(k==='END')break;
    const q=k.split('|'), r=real[k];
    if(q[0]==='Q'){
      const s=q[1], l=q[2], N=carsOf(l);
      for(const n of nbrs[l][s]||[]){
        const acc=ACC[key3(s,l,n)], h=hop(s,n);
        for(let c=1;c<=N;c++){const b=boardCost(acc,c,mode,N,strict); if(b.w===Infinity)continue;
          push(`T|${n}|${l}|${s}|${c}`,d+b.w+b.p+h,r+b.w+h,k);}
      }
    }else{
      const s=q[1], l=q[2], pv=q[3], c=+q[4], N=carsOf(l);
      for(const n of nbrs[l][s]||[]) if(n!==pv){const h=hop(s,n); push(`T|${n}|${l}|${s}|${c}`,d+h,r+h,k);}
      const {acc,flip}=alightAcc(s,l,pv), a=alightCost(acc,flip,c,mode,N,strict);
      if(a.w===Infinity) continue;
      if(s===to) push('END',d+a.w+a.p,r+a.w,k);
      else if(s!==from && !banned.has(s))
        for(const l2 of lineOfStation(s)) if(l2!==l){const x=xferMin(s,l,l2,mode)+risk(s,iso).pen; push(`Q|${s}|${l2}`,d+a.w+a.p+x,r+a.w+x,k);}
    }
  }
  if(dist.END===undefined) return null;
  const nodes=[]; for(let k=prev.END;k;k=prev[k]) nodes.unshift(k);
  const path=nodes.map(k=>{const q=k.split('|');return q[1]+'|'+q[2];});
  const cars=nodes.map((k,i)=>k[0]==='T'&&nodes[i-1][0]==='Q'?+k.split('|')[4]:0).filter(Boolean);
  return {path,total:real.END,cost:dist.END,cars};
}
function segments(path){
  const segs=[]; let cur=null;
  for(const k of path){const [st,l]=k.split('|');
    if(!cur||cur.line!==l){cur={line:l,stops:[st]};segs.push(cur);} else if(cur.stops[cur.stops.length-1]!==st) cur.stops.push(st);}
  return segs;
}
function termOf(seg){ // 行進方向的終點站名稱
  const ord=D.lineOrder[seg.line]||[]; const a=seg.stops[0], b=seg.stops[seg.stops.length-1];
  const ia=ord.indexOf(a), ib=ord.indexOf(b);
  if(ia<0||ib<0) return b;
  return ib>ia?ord[ord.length-1]:ord[0];
}

// ---------- 車廂建議（依人工標記的電梯／手扶梯位置）
const carList=arr=>[...new Set(arr.map(e=>e.car))].sort((a,b)=>a-b);
function carPlan(seg,mode,car){ // car：Dijkstra 選定的車廂（若有，且合理就沿用，讓畫面和路線成本一致）
  const line=seg.line, N=carsOf(line), st=seg.stops; if(st.length<2)return null;
  const a=st[0], b=st[st.length-1], p=st[st.length-2];
  const bAcc=ACC[key3(a,line,st[1])];                       // 上車：列車往下一站前進
  const cand=[...(nbrs[line][b]||[])].filter(x=>x!==p);      // 下車：列車繼續往前的方向
  let aAcc,flip=false;
  if(cand.length) aAcc=cand.map(v=>ACC[key3(b,line,v)]).find(Boolean);
  else{aAcc=ACC[key3(b,line,p)];flip=true;}                 // 終點站：標記的是離站方向，到站要反向換算
  const bT=targets(bAcc,mode), aT=targets(aAcc,mode).map(e=>({...e,car:flip?N+1-e.car:e.car}));
  let rec=null,walk=0,chosen=[];
  if(aT.length&&bT.length){let best=null;for(const x of aT)for(const y of bT){const d=Math.abs(x.car-y.car);if(!best||d<best.d)best={d,x,y};}
    rec=best.x.car;walk=best.d;chosen=[best.x,best.y];}
  else if(aT.length){rec=aT[0].car;chosen=[aT[0]];}
  else if(bT.length){rec=bT[0].car;chosen=[bT[0]];}
  if(car&&aT.length&&aT.some(e=>e.car===car)&&rec!==car){ // 成本相同的平手情況，以路線規劃選的車廂為準
    rec=car; walk=bT.length?Math.min(...bT.map(e=>Math.abs(e.car-car))):0;
    chosen=[aT.find(e=>e.car===car),...(bT.length?[bT.reduce((m,e)=>Math.abs(e.car-car)<Math.abs(m.car-car)?e:m)]:[])];
  }
  const c0=rec??1; // 計時用的月台步行節數（與路線成本同一個函式；無標記＝固定值，月台沒電梯＝不計）
  const bWalk=walkCarsAt(bAcc,false,c0,mode,N)??0, aWalk=walkCarsAt(aAcc,flip,c0,mode,N)??0;
  return {N,a,b,bAcc,aAcc,bT,aT,rec,walk,bWalk,aWalk,flip,chosen,
    unsure:chosen.some(e=>e.mirrored&&!e.verified), warnB:blocked(bAcc,mode), warnA:blocked(aAcc,mode),
    missing:!bAcc&&!aAcc};
}
function trainHTML(pl){
  const up=new Set(carList(pl.bT)), dn=new Set(carList(pl.aT));
  return `<div class="train" role="img" aria-label="車廂示意，建議第 ${pl.rec} 節，車頭在左">`+
   Array.from({length:pl.N},(_,i)=>{const c=i+1;
     return `<div class="car ${c===pl.rec?'rec':''}">${c}<small>${up.has(c)?'<span class="up">▲上</span>':''}${up.has(c)&&dn.has(c)?' ':''}${dn.has(c)?'<span class="dn">▼下</span>':''}</small></div>`;}).join('')+
   `</div><div class="small">← 車頭（行進方向）　車尾 →　　▲上＝上車站電梯　▼下＝下車站電梯　亮色＝建議車廂</div>`;
}
function describe(acc,mode,flipN){
  if(!acc) return '（沒有標記資料）';
  const part=(arr,name)=>arr.length?`${name}在`+arr.map(e=>`第 ${flipN?flipN+1-e.car:e.car} 節${e.label&&e.label!=='手扶梯'?'（'+esc(e.label)+'）':''}`).join('、'):'';
  const txt=[part(acc.el,'電梯'),mode==='walk'?part(acc.es,'手扶梯'):''].filter(Boolean).join('；');
  return txt||(acc.elNone?'這個方向的月台沒有電梯':'（沒有標記資料）');
}

// ---------- 人流（歷史）
function level(n,hour,wk){
  const a=D.crowd[n]&&D.crowd[n][wk?'we':'wd'];if(!a)return null;const t=D.crowdMeta.thresholds,v=a[hour];
  return {v,lv:v<t[0]?1:v<t[1]?2:v<t[2]?3:4};
}
const LVT=['','舒適','普通','偏擠','很擠'];
const LVC=['','var(--c1)','var(--c2)','var(--c3)','var(--c4)'];
function bars(n,hour,wk){
  const a=D.crowd[n][wk?'we':'wd']; const mx=Math.max(...a,1);
  return `<div class="bars" role="img" aria-label="${n}站 24 小時歷史人流">`+a.map((v,h)=>{
    const L=level(n,h,wk).lv; return `<i class="${h===hour?'now':''}" style="height:${Math.max(6,v/mx*100)}%;background:${LVC[L]}" title="${h}時"></i>`;}).join('')+'</div>'+
    `<div class="small">0 時 ─ 23 時（粗框＝出發時段）</div>`;
}
const crowdLine=(n,hour,wk,label)=>{const L=level(n,hour,wk);return L?`<div class="small"><span class="lv" style="background:${LVC[L.lv]}"></span>${label}此時段歷史人流：<b>${LVT[L.lv]}</b>（平均約 ${L.v.toLocaleString()} 人次/小時）</div>`:'';};

const badge=l=>`<span class="badge" style="background:${LINE_COLOR[l]};${LINE_DARK_TEXT.has(l)?'color:#222':''}">${l}</span>`;
function exitsHTML(s){
  if(s.elevExits&&s.elevExits.length) return `<div class="small">有電梯的出口：${s.elevExits.map(x=>'出口'+x.id+(x.desc?'（'+esc(x.desc)+'）':'')).join('、')}</div>`;
  return s.accExits.length?`<div class="small">無障礙出入口：${s.accExits.map(x=>'出口'+x).join('、')}</div>`:'';
}
function stationRisk(n,iso){
  const r=risk(n,iso); let h='';
  if(r.ano) h+=`<span class="chip bad">⚠ 目前公告異常：${esc(r.ano.text).slice(0,60)}</span> `;
  if(r.maint.length){const locs=[...new Set(r.maint.map(m=>m.loc))].join('、');h+=`<span class="chip warn">當日預排電梯檢修（${locs}）</span> `;}
  return h;
}

// ---------- 渲染一條路線
function render(route,mode,dep,iso,wk,idx){
  const segs=segments(route.path), depMin=dep.getHours()*60+dep.getMinutes(); let clock=depMin+3;
  const transfers=segs.length-1; let html='', walkCars=0, unsure=false, warnings=[];
  const first=segs[0].stops[0], last=segs[segs.length-1].stops.slice(-1)[0];
  html+=`<div class="step"><div><div class="dot"></div></div><div><b>${first}站　進站</b>
    ${stationRisk(first,iso)}${exitsHTML(S[first])}
    <div class="elev">出口電梯：\n${esc(S[first].lines[segs[0].line]?.exitElev||'（官方資料無描述）')}</div></div></div>`;
  segs.forEach((sg,i)=>{
    const a=sg.stops[0], b=sg.stops[sg.stops.length-1], hops=sg.stops.length-1;
    let ride=0; for(let j=0;j<hops;j++) ride+=hop(sg.stops[j],sg.stops[j+1]);
    const pl=carPlan(sg,mode,route.cars?.[i]); let planHTML='';
    const hourB=Math.floor((clock%1440)/60);
    clock+=PARAM.WAIT+Math.max(0,tau(mode)*(pl?.bWalk||0)-PARAM.OVERLAP*PARAM.WAIT); // 候車；月台走動與候車重疊
    const board=clock; clock+=ride; const hourA=Math.floor((clock%1440)/60);
    const alight=clock; clock+=tau(mode)*(pl?.aWalk||0); // 下車後走到電梯
    if(pl&&!pl.missing){
      if(pl.warnB) warnings.push(`${a}站（${sg.line}）此方向月台沒有電梯`);
      if(pl.warnA) warnings.push(`${b}站（${sg.line}）此方向月台沒有電梯`);
      unsure=unsure||pl.unsure; walkCars+=pl.walk;
      const lines=[];
      if(pl.rec){
        lines.push(`<p><b>建議搭第 ${pl.rec} 節車廂</b>${pl.unsure?' <span class="chip warn" title="這筆是由另一個方向鏡射推算，尚未現場核對">鏡射推算</span>':''}</p>`);
        const vt=mode==='walk'?'電梯或手扶梯':'電梯';
        lines.push(`<p>▲ ${a}站上車：${describe(pl.bAcc,mode)}。${pl.bT.length?(pl.walk?`到月台後往第 ${pl.rec} 節走（約 ${pl.walk} 節，${pl.walk*CAR_M} 公尺）候車。`:`${vt}就在第 ${pl.rec} 節車廂附近，直接在這裡候車。`):`請到第 ${pl.rec} 節車廂門口候車。`}</p>`);
        lines.push(`<p>▼ ${b}站下車：${describe(pl.aAcc,mode,pl.flip?pl.N:0)}。${pl.flip?'<span class="small">（終點站，已依到站方向換算）</span>':''}</p>`);
      }else lines.push(`<p>${pl.warnA||pl.warnB?'這段的月台沒有可用的電梯，請洽站務人員協助。':'沒有可用的電梯位置資料。'}</p>`);
      planHTML=`<div class="plan">${lines.join('')}${pl.rec?trainHTML(pl):''}</div>`;
    }else planHTML=`<div class="plan"><p>尚無這段的車廂標記資料，請依現場指標與站務人員協助。</p><div class="small">${a}站月台電梯：${esc(S[a].lines[sg.line]?.platElev||'無描述')}</div></div>`;
    html+=`<div class="step"><div><div class="dot" style="border-color:${LINE_COLOR[sg.line]}"></div></div><div>
      <div>${badge(sg.line)}<b>${a}</b> → <b>${b}</b>　往${termOf(sg)}方向，${hops} 站，約 ${Math.round(ride)} 分</div>
      <div class="small">約 ${fmt(board)} 上車　${fmt(alight)} 下車</div>
      ${crowdLine(a,hourB,wk,a+'站')}${planHTML}</div></div>`;
    if(i<segs.length-1){
      const nxt=segs[i+1], f=MODE[mode].f, xm=xferMin(b,sg.line,nxt.line,mode);
      clock+=xm;
      html+=`<div class="step"><div><div class="dot" style="border-style:dashed"></div></div><div>
        <b>${b}站　轉乘</b>：${badge(sg.line)}→${badge(nxt.line)}
        <div class="small">官方轉乘時間約 ${twalk(b,sg.line,nxt.line)} 分${D.lineTransfer?.[b+'|'+sg.line+'|'+nxt.line]?.onSite===false?'（需出站轉乘）':''}，依${MODE[mode].label}乘以 ${f}、再乘 ${PARAM.XFER_DISC}（官方時間已含部分月台步行），加電梯等候 ${PARAM.ELEV_WAIT[mode]} 分，預估 ${Math.round(xm)} 分；候車另計</div>
        ${stationRisk(b,iso)}${crowdLine(b,hourA,wk,b+'站')}</div></div>`;
    }
  });
  html+=`<div class="step"><div><div class="dot" style="background:var(--accent)"></div></div><div><b>${last}站　出站</b>　<span class="small">預計 ${fmt(clock)} 抵達</span>
    ${stationRisk(last,iso)}${exitsHTML(S[last])}
    <div class="elev">出口電梯：\n${esc(S[last].lines[segs[segs.length-1].line]?.exitElev||'（官方資料無描述）')}</div></div></div>`;
  const hasWarn=segs.flatMap(s=>s.stops).some(n=>risk(n,iso).ano);
  const arrive=depMin+route.total;
  return `<article class="card"><div class="total"><b>約 ${Math.round(route.total)} 分</b><span>${fmt(depMin)} 出發 → ${fmt(arrive)} 抵達</span></div>
    <div class="chips"><span class="chip">${transfers===0?'免轉乘':'轉乘 '+transfers+' 次'}</span>
      ${walkCars?`<span class="chip">月台上共走約 ${walkCars} 節車廂（${walkCars*CAR_M} 公尺）</span>`:`<span class="chip ok">月台上幾乎不用走</span>`}
      <span class="chip ${hasWarn?'bad':'ok'}">${hasWarn?'路線上有公告異常的電梯':'目前無未修復的電梯異常公告'}</span>
      ${unsure?'<span class="chip warn">部分車廂為鏡射推算</span>':''}
      ${warnings.map(w=>`<span class="chip bad">⚠ ${esc(w)}</span>`).join('')}</div>
    <div class="small" style="margin-top:6px">路線 ${idx+1}：${segs.map(s=>s.line).join(' → ')}</div>${html}
    <details><summary>起站 24 小時歷史人流（${wk?'假日':'平日'}）</summary>${D.crowd[first]?bars(first,dep.getHours(),wk):''}</details></article>`;
}

function plan(){
  const from=$('from').value.trim(), to=$('to').value.trim(), mode=$('mode').value;
  const out=$('out');
  if(!S[from]||!S[to]){out.innerHTML=`<div class="card"><b>請從清單選擇正確的站名。</b><div class="small">例如：板橋、中山國中、台北車站（本資料使用「台」字）。</div></div>`;return;}
  if(from===to){out.innerHTML='<div class="card">起訖站相同。</div>';return;}
  try{localStorage.setItem('mrt-last',JSON.stringify({from,to,mode}));}catch(e){}
  const dep=new Date($('when').value||Date.now()); const iso=`${dep.getFullYear()}-${pad(dep.getMonth()+1)}-${pad(dep.getDate())}`;
  const wk=[0,6].includes(dep.getDay());
  const sigOf=r=>segments(r.path).map(s=>s.line).join('>')+'#'+segments(r.path).map(s=>s.stops[0]).join('>');
  // 產生候選路線：逐一禁止轉乘站，找出不同的轉乘方案（最多探索 14 組）
  const gen=strict=>{
    const routes=[], seen=new Set(), tried=new Set(), queue=[new Set()]; let guard=0;
    while(queue.length&&guard<14){
      const banned=queue.shift(), bk=[...banned].sort().join(','); if(tried.has(bk))continue; tried.add(bk); guard++;
      const r=dijkstra(from,to,mode,iso,banned,strict); if(!r)continue;
      if(!seen.has(sigOf(r))){seen.add(sigOf(r));routes.push(r);}
      for(const sg of segments(r.path).slice(1)) queue.push(new Set([...banned,sg.stops[0]]));
    }
    return routes;
  };
  // 先只找「全程都有可用電梯」的路線；找不到才放寬，並在畫面上警告
  let routes=gen(true);
  if(!routes.length) routes=gen(false);
  if(!routes.length){out.innerHTML='<div class="card">找不到路線。</div>';return;}
  for(const r of routes){r.warn=0; for(const sg of segments(r.path)){const p=carPlan(sg,mode);if(p){r.warn+=(p.warnA?1:0)+(p.warnB?1:0);}}}
  routes.sort((a,b)=>a.cost-b.cost); // cost 含缺資料與無電梯懲罰；total 是實際預估分鐘
  const shown=routes.slice(0,3);
  out.innerHTML=`<div class="tabs" role="group" aria-label="路線選項">${shown.map((r,i)=>`<button class="ghost" data-i="${i}" aria-pressed="${i===0}">路線 ${i+1}：約 ${Math.round(r.total)} 分${r.warn?' ⚠':''}</button>`).join('')}</div><div id="rt"></div>
   <div class="actions"><button class="ghost" id="share">複製這個查詢的連結</button></div>
   <p class="small">站間時間與轉乘時間採用 TDX 官方資料；候車、月台步行、轉乘係數與電梯等候為估計值；車廂位置為人工標記（來源：捷運Go、現場），標示「鏡射推算」者尚未核對；人流為 ${D.crowdMeta.month} 的歷史平均，不是即時擁擠度。電梯臨時故障請以車站現場公告為準。</p>`;
  const show=i=>{ $('rt').innerHTML=render(shown[i],mode,dep,iso,wk,i); out.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.i===i))); };
  out.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>show(+b.dataset.i)); show(0);
  $('share').onclick=async()=>{const u=new URL(location.href);u.search=new URLSearchParams({from,to,mode}).toString();
    try{await navigator.clipboard.writeText(u.toString());$('share').textContent='已複製 ✓';}catch(e){prompt('複製這個連結：',u.toString());}};
}
$('go').onclick=plan;
$('swap').onclick=()=>{const a=$('from').value;$('from').value=$('to').value;$('to').value=a;};
$('now').onclick=setNow;
document.querySelectorAll('[data-ex]').forEach(b=>b.onclick=()=>{const [a,c]=b.dataset.ex.split('|');$('from').value=a;$('to').value=c;plan();});
// 還原上次查詢，或讀取網址參數（?from=&to=&mode=）
(function(){
  let last={}; try{last=JSON.parse(localStorage.getItem('mrt-last')||'{}');}catch(e){}
  const q=new URLSearchParams(location.search);
  const from=q.get('from')||last.from, to=q.get('to')||last.to, mode=q.get('mode')||last.mode;
  if(mode&&MODE[mode])$('mode').value=mode;
  if(from&&S[from])$('from').value=from; if(to&&S[to])$('to').value=to;
  if(q.get('from')&&q.get('to'))plan();
})();
const mirrored=Object.values(ACC).reduce((n,a)=>n+[...a.el,...a.es].filter(e=>e.mirrored&&!e.verified).length,0);
$('foot').innerHTML=`資料來源：交通部 TDX（站間行駛時間、轉乘時間、出口電梯）、臺北捷運公司／臺北市政府資料大平台（電梯位置、電梯維修預排、無障礙設施異常公告、出入口座標、每日分時各站 OD 流量），授權：政府資料開放授權條款；電梯／手扶梯對應車廂為人工標記（${Object.keys(ACC).length} 個行車方向，其中 ${mirrored} 筆為鏡射推算）。<br>範圍：臺北捷運高運量五線（不含環狀線、小碧潭支線）。資料建立時間：${D.built.replace('T',' ')}（異常公告為建立當下的快照）。`;
