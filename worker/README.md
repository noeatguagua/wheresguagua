# 即時到站 Worker（Cloudflare Workers）

代替網頁去呼叫 TDX 的「臺北捷運列車即時到離站」（`Rail/Metro/LiveBoard/TRTC`），把結果快取後提供給手機版使用。

**為什麼需要它**
- TDX 金鑰不能放在網頁裡（任何人都看得到）。
- TDX 有請求頻率限制，連續呼叫會回 429。Worker 每 20 秒才向 TDX 抓一次，所有使用者共用同一份快取，所以不管多少人用，對 TDX 的請求量都固定。
- TDX 暫時失敗時，回傳最近一次成功的資料（`stale: true`），網頁不會壞。

**回傳格式** `GET /live`

```json
{ "updated": 1794099600000, "rows": [ { "s": "BL18", "d": "南港展覽館", "a": 1794099690000, "e": 90, "st": 0 } ] }
```
`s` 站碼、`d` 終點站、`a` 預計進站時刻（毫秒時間戳）、`e` 預估秒數、`st` 服務狀態。**只有列車即將進站的站才會有資料**，不是每站每方向都有；沒有時網頁會退回班表。

## 部署（約 10 分鐘）

需要 [Node.js](https://nodejs.org) 與免費的 Cloudflare 帳號。

```bash
cd worker
npx wrangler login
```

設定金鑰（會在終端機提示你貼上，**不會**存進檔案或程式庫）：

```bash
npx wrangler secret put TDX_CLIENT_ID
```

```bash
npx wrangler secret put TDX_CLIENT_SECRET
```

部署：

```bash
npx wrangler deploy
```

完成後會印出網址，例如 `https://guagua-live.<你的帳號>.workers.dev`。把 `<網址>/live` 填進 [app/config.js](../app/config.js) 的 `liveUrl`，commit 並推送，手機版就會開始使用即時資料。

**允許的網站來源**在 `wrangler.toml` 的 `ALLOWED_ORIGINS`；網站網址不同時要改。

## 用量
- Cloudflare 免費方案每天 10 萬次請求；快取命中也算一次請求。手機版每 15 秒查一次，一位使用者停留一小時約 240 次。
- 對 TDX 的請求最多每 20 秒一次（一天約 4,300 次，TDX 每 1,500 次扣 1 點）。

## 限制
- 取用的是 TDX 公開資料，更新約 25 到 30 秒一次，不是列車精確位置。
- 目前只有第 1 段（使用者所在的起站）使用即時資料，之後各段仍用班表推算。
