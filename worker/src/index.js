/* 瓜瓜去哪儿 — 即時到站代理（Cloudflare Worker）
 * GET /live → { updated, rows: [{ s: 站碼, d: 終點站(中文), a: 預計進站時刻(毫秒時間戳), e: 預估秒數, st: 狀態 }] }
 *
 * 為什麼要有它：TDX 金鑰不能放在網頁裡，TDX 也有請求頻率限制（連續呼叫會 429）。
 * 所以由 Worker 持有金鑰，每 ≤ FRESH_S 秒才向 TDX 抓一次，所有使用者共用同一份快取。
 * TDX 暫時失敗（含 429）時，回傳最近一次成功的資料（標 stale: true），不讓網頁壞掉。 */

const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const LIVE_URL = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TRTC?%24format=JSON';
const FRESH_S = 20;          // 這段時間內直接用快取
const STALE_S = 600;         // 抓不到時，最久還回傳多舊的資料

let tokenCache = { value: null, exp: 0 };

async function getToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  tokenCache = { value: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 3600) - 120) * 1000 };
  return tokenCache.value;
}

function compact(raw) {
  const rows = [];
  let updated = 0;
  for (const x of raw) {
    const src = Date.parse(x.SrcUpdateTime || x.UpdateTime);
    if (!Number.isFinite(src)) continue;
    updated = Math.max(updated, src);
    rows.push({
      s: x.StationID,
      d: String((x.DestinationStationName && x.DestinationStationName.Zh_tw) || '').replace(/臺/g, '台'),
      a: src + Math.max(0, x.EstimateTime || 0) * 1000,   // EstimateTime 是相對 SrcUpdateTime 的秒數
      e: x.EstimateTime || 0,
      st: x.ServiceStatus
    });
  }
  return { updated, rows };
}

function cors(req, env) {
  const allow = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (origin && allow.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...c, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (req.method !== 'GET' || url.pathname !== '/live') return new Response('Not found', { status: 404, headers: c });
    if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return new Response(JSON.stringify({ error: 'not configured' }), { status: 500, headers: { ...c, 'content-type': 'application/json' } });

    const cache = caches.default, freshKey = new Request(url.origin + '/__fresh'), staleKey = new Request(url.origin + '/__stale');
    const json = (obj, extra = {}) => new Response(JSON.stringify(obj), { headers: { ...c, 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=10', ...extra } });

    const fresh = await cache.match(freshKey);
    if (fresh) return json(await fresh.json());

    try {
      const token = await getToken(env);
      const r = await fetch(LIVE_URL, { headers: { authorization: 'Bearer ' + token } });
      if (r.status === 401) tokenCache = { value: null, exp: 0 };
      if (!r.ok) throw new Error('tdx ' + r.status);
      const data = compact(await r.json());
      const body = JSON.stringify(data);
      ctx.waitUntil(Promise.all([
        cache.put(freshKey, new Response(body, { headers: { 'Cache-Control': `max-age=${FRESH_S}`, 'content-type': 'application/json' } })),
        cache.put(staleKey, new Response(body, { headers: { 'Cache-Control': `max-age=${STALE_S}`, 'content-type': 'application/json' } }))
      ]));
      return json(data);
    } catch (e) {
      const stale = await cache.match(staleKey);
      if (stale) return json({ ...(await stale.json()), stale: true });
      return new Response(JSON.stringify({ error: 'upstream unavailable' }), { status: 502, headers: { ...c, 'content-type': 'application/json' } });
    }
  }
};
