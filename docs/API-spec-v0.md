# 捷運無礙行 — 輸出規格 API v0

**狀態：** v0（草案，可供前端開發；欄位只增不改，見第 9 節）
**對應程式：** 引擎 [app/engine.js](../app/engine.js)、測試 [tests/golden.test.js](../tests/golden.test.js)、黃金檔 [tests/golden/](../tests/golden/)
**對應決策：** [ADR-001](ADR-001_捷運無礙行架構.md) §8（v0.3 路徑權重、v0.4 人流乘數）、D5（交付形式）
**日期：** 2026-11-08

---

## 1. 範圍與現況

本規格定義引擎的**輸出契約**：給定起訖站、行動方式與出發時間，回傳結構化的無障礙路線（含車廂建議、候車與步行時間、轉乘、人流與電梯狀態）。

| 項目 | v0 現況 |
|---|---|
| 引擎 `createEngine(data).plan(request)` | **已實作**，瀏覽器與 Node 通用，無 DOM、無網路請求 |
| 前端 [app/index.html](../app/index.html) | **已改為只負責畫面**，所有計算呼叫引擎 |
| 黃金測試與不變量測試 | **已實作**（34 項） |
| HTTP 包裝（第 3 節的端點、狀態碼、快取標頭） | **尚未實作**，本文件是對應約定；回應本文與引擎輸出完全相同 |
| 電梯異常公告即時更新 | **未做**，目前是建置時快照（`meta.anomalySnapshot`） |

引擎的函式與 HTTP 端點一一對應，所以前端可以**先直接呼叫引擎**，之後換成呼叫 HTTP 時，只需要把函式呼叫換成 `fetch`，資料結構不變。

| 引擎函式 | HTTP 端點 |
|---|---|
| `E.plan(request, opts?)` | `GET /v0/routes` |
| `E.stations()` | `GET /v0/stations` |
| `E.station(name)` | `GET /v0/stations/{name}` |
| `E.meta()` | `GET /v0/meta` |

## 2. 通則

- **編碼與語言：** UTF-8 JSON。欄位名稱為英文；站名、線名為中文（資料中一律用「台」，輸入的「臺」會自動正規化）；官方電梯描述原樣傳回。
- **只給資料與代碼，不給敘述句。** 說明文字（例如「建議搭第 3 節車廂」）由前端自己組，這樣才能做多語言與報讀器友善。
- **時間：** 一律為臺北時間，格式 ISO 8601 含 `+08:00`，精度到分，例如 `2026-11-09T08:00+08:00`。輸入可帶任何時區（`Z`、`+09:00`…），沒帶時區視為臺北時間。跨午夜時日期會正確進位。
- **時間長度：** 單位為分鐘，四捨五入到小數 1 位（`totalMin`、`rideMin`、`waitMin`…）。
- **車廂編號：** 從 1 起算，**1 號為車頭（行進方向最前面）**。終點站標記的是「離站方向」，引擎已依到站方向換算，所以 `alight` 的車廂編號一律是「搭乘方向的車頭起算」。
- **人流程度 `g`：** 0 到 1（`(等級−1)/3`），`level` 為 1（舒適）到 4（很擠）。
- **空值：** 沒有資料時為 `null`、空陣列或空字串，欄位不會消失。
- **結果可重現：** 相同資料、相同請求，輸出完全相同。

## 3. 端點

| 端點 | 用途 | 建議快取 |
|---|---|---|
| `GET /v0/routes` | 路線規劃 | `max-age=60`，以出發時間（取到分）為鍵 |
| `GET /v0/stations` | 站名清單，供自動完成 | `max-age=3600` |
| `GET /v0/stations/{name}` | 單站資訊：電梯描述、出口、異常與檢修、24 小時人流 | `max-age=300` |
| `GET /v0/meta` | 資料建置時間、參數與全部假設值 | `max-age=3600` |

### 3.1 `GET /v0/routes` 參數

| 參數 | 必填 | 說明 |
|---|---|---|
| `from`、`to` | 是 | 站名。接受「臺北車站」「板橋站」「板橋」；無法辨識時回 `UNKNOWN_STATION` 並附建議 |
| `mode` | 否，預設 `wheel` | `wheel` 輪椅、`stroller` 嬰兒車、`walk` 步行輔具（電梯或手扶梯皆可） |
| `depart` | 否，預設現在 | ISO 8601，見第 2 節 |
| `max` | 否，預設 3 | 回傳路線數，1 到 5 |

引擎呼叫：`E.plan({from, to, mode, depart, max}, {now})`，`opts.now` 為 UTC 毫秒，只供測試固定「現在」。

### 3.2 HTTP 狀態碼對應（尚未實作的約定）

| 錯誤代碼 | 狀態碼 |
|---|---|
| `BAD_MODE`、`BAD_TIME`、`SAME_STATION`、`UNKNOWN_STATION`（`/routes`） | 400 |
| `UNKNOWN_STATION`（`/stations/{name}`）、`NO_ROUTE` | 404 |
| `DATA_STALE`（保留，引擎尚未產生） | 503 |

## 4. 路線回應

```jsonc
{
  "meta":  { "apiVersion": "v0", "paramsVersion": "0.4", "dataBuilt": "2026-11-08T02:29", "crowdMonth": "202609" },
  "query": { "from": "忠孝復興", "to": "台北車站", "mode": "wheel", "depart": "2026-11-09T08:00+08:00", "weekend": false, "max": 3 },
  "searchMode": "strict",
  "routes": [ /* Route，依 rankingCost 由小到大 */ ]
}
```

| 欄位 | 說明 |
|---|---|
| `query` | 正規化後的請求（站名、時間都是解析後的值） |
| `searchMode` | `strict`＝全程都有可用電梯；`relaxed`＝找不到全程可行的路線，改為允許經過沒有電梯的月台，**前端必須顯示警告**（見 `warnings`） |
| `meta.paramsVersion` | 權重參數版本。參數改變時會升版，前端可據此提示「估計方式已更新」 |

### 4.1 Route

```jsonc
{
  "id": "r1",
  "totalMin": 13.4,                          // 預估總分鐘（不含懲罰）
  "depart": "2026-11-09T08:00+08:00",
  "arrive": "2026-11-09T08:13+08:00",
  "transfers": 0,
  "lines": ["板南線"],
  "rankingCost": 13.4,                       // 排序用成本（含缺資料與無電梯的懲罰），不是時間
  "warnings": [ { "code": "NO_ELEVATOR_PLATFORM", "station": "動物園", "line": "文湖線", "role": "board" } ],
  "flags": { "unverifiedCars": false, "anomalyStations": [] },
  "summary": { "platformWalkCars": 2, "platformWalkMeters": 44 },
  "steps": [ /* enter、(ride、transfer)*、ride、exit */ ]
}
```

| 欄位 | 說明 |
|---|---|
| `totalMin` vs `rankingCost` | 前者給人看，後者只用來排序；放寬搜尋時兩者差很多 |
| `warnings[]` | 目前只有 `NO_ELEVATOR_PLATFORM`（`role`＝`board` 上車站或 `alight` 下車站） |
| `flags.unverifiedCars` | 路線中有車廂建議來自鏡射推算、尚未現場核對 |
| `flags.anomalyStations` | 路線經過的站中，有未修復電梯異常公告的站名 |
| `summary` | 全程月台上要走的節數與公尺（只計有標記資料的上車前步行） |

`steps` 的順序固定：`enter`，然後 `ride` 與 `transfer` 交替（以 `ride` 開頭、`ride` 結尾），最後 `exit`。

### 4.2 `enter` 與 `exit`

| 欄位 | 說明 |
|---|---|
| `type` | `enter`／`exit` |
| `station`、`line` | 進站（出站）的站名；`line` 為該段搭乘（剛下車）的線 |
| `time` | `enter` 為出發時間；`exit` 為抵達時間 |
| `risk` | `{anomaly, maintenance}`，見 4.5 |
| `exitElevatorText` | 官方「出口電梯」描述，原文，可能多行 |
| `elevatorExits[]` | 有電梯的出口 `{id, description}` |
| `accessibleExits[]` | 無障礙出入口編號（備用資料，常與上者重複） |

### 4.3 `ride`

```jsonc
{
  "type": "ride", "line": "板南線", "from": "忠孝復興", "to": "台北車站",
  "towards": "頂埔", "stops": 3, "stopNames": ["忠孝復興","忠孝新生","善導寺","台北車站"], "rideMin": 5.7,
  "car":   { "recommended": 3, "total": 6, "basis": "annotated", "reason": null },
  "board": { "station": "忠孝復興", "arrive": "…T08:03+08:00", "time": "…T08:08+08:00", "waitMin": 4.7,
             "crowd": { "level": 3, "g": 0.667, "avgPerHour": 5443, "hour": 8 },
             "platformElevatorText": "大廳層西側",
             "dataBasis": "annotated", "walkCars": 2, "walkMeters": 44, "walkAssumed": false,
             "elevators":  [ { "car": 1, "label": "大廳層西側", "unverified": false } ],
             "escalators": [ { "car": 3, "label": "", "unverified": false } /* …（此處節錄） */ ],
             "elevatorNone": false, "escalatorNone": false, "targetCars": [1] },
  "alight": { "station": "台北車站", "time": "…T08:13+08:00", "terminalFlipped": false,
              "crowd": { "level": 4, "g": 1, "avgPerHour": 24981, "hour": 8 },
              "dataBasis": "annotated", "walkCars": 0, "walkMeters": 0, "walkAssumed": false,
              "elevators": [ /* 同上 */ ], "escalators": [ /* 同上 */ ], "elevatorNone": false, "escalatorNone": false, "targetCars": [3, 4] }
}
```

**整段車程搭同一節車廂**（人在車廂內不移動）：`car.recommended` 就是整段要待的車廂；上車前先在月台從 `board.targetCars` 走到這一節（`board.walkCars` 節），下車後走到 `alight.targetCars`（通常 `alight.walkCars` 為 0）。

| 欄位 | 說明 |
|---|---|
| `towards` | 行進方向的終點站名 |
| `car.recommended` | 建議搭乘車廂；無可用資料時為 `null` |
| `car.basis` | `annotated` 人工標記｜`mirrored` 鏡射推算、尚未核對（前端應標示）｜`none` 無建議 |
| `car.reason` | `basis` 為 `none` 時的原因：`missing` 兩端都沒有標記資料｜`blocked` 月台沒有可用電梯｜`no-data` 有紀錄但沒有可用位置；否則為 `null` |
| `board.arrive` | 到月台的時間；`board.time` 為候車並走到搭乘車廂後、列車到來的時間 |
| `board.waitMin` | 候車分鐘（已含人流加成） |
| `*.dataBasis` | `annotated` 有標記｜`unknown` 有紀錄但無可用位置｜`blocked` 該方向月台沒有電梯｜`none` 沒有標記 |
| `*.walkCars`、`walkMeters` | 該端月台步行節數與公尺（1 節 22 公尺，概估） |
| `*.walkAssumed` | `true` 表示沒有標記，步行節數用固定期望值 `(N²−1)/(3N)`（6 節約 1.9、4 節約 1.3），**不是實際距離**；前端不應顯示「走幾節」 |
| `elevators[]`、`escalators[]` | 該方向月台的電梯／手扶梯所在車廂；`label` 為官方位置描述（可能為空）；`unverified` 為鏡射推算且未核對。**車廂編號已轉成搭乘方向**（終點站已換算） |
| `elevatorNone`、`escalatorNone` | 人工標記為「該方向月台沒有電梯／手扶梯」 |
| `targetCars` | 依 `mode` 可用的設施車廂（輪椅、嬰兒車只算電梯；步行輔具含手扶梯），供畫車廂示意圖 |
| `alight.terminalFlipped` | 下車站是終點站，車廂已依到站方向換算 |
| `crowd` | 該站在該時段的歷史人流，見 4.5；無資料為 `null` |

### 4.4 `transfer`

```jsonc
{ "type": "transfer", "station": "忠孝復興", "fromLine": "板南線", "toLine": "文湖線",
  "officialMin": 5, "onSite": true, "estimatedMin": 10.2, "elevatorWaitMin": 2.5, "riskPenaltyMin": 0, "crowdBonusPct": 29,
  "arrive": "…T08:25+08:00", "time": "…T08:35+08:00",
  "crowd": { "level": 3, "g": 0.667, "avgPerHour": 5443, "hour": 8 }, "risk": { "anomaly": null, "maintenance": [] } }
```

| 欄位 | 說明 |
|---|---|
| `officialMin` | TDX 官方轉乘時間（分） |
| `onSite` | `true` 站內轉乘｜`false` 需出站轉乘｜`null` 資料未標明 |
| `estimatedMin` | 預估轉乘分鐘 ＝ 官方時間 × 行動方式係數 × 0.8 × 人流步行乘數 ＋ 電梯等候（不含候車，也不含 `riskPenaltyMin`） |
| `elevatorWaitMin` | 其中的電梯等候分鐘（已含人流加成） |
| `riskPenaltyMin` | 電梯風險加成：異常公告 +15、當日預排檢修 +3；已計入 `time`，未計入 `estimatedMin` |
| `crowdBonusPct` | 人流使轉乘時間增加的百分比；沒有加成為 0 |
| `arrive`、`time` | 下車後開始轉乘的時間、轉乘完成（準備候車）的時間 |

### 4.5 共用物件

**`crowd`**（歷史人流，單月平均，**是整站進出量，不是車廂擁擠度**）：`{level: 1–4, g: 0–1, avgPerHour, hour}`。等級門檻在 `meta.crowd.thresholds`。

**`risk`**：`{anomaly, maintenance[]}`
- `anomaly`：`null` 或 `{time, text, line}`，為建置時快照的未修復異常公告。
- `maintenance[]`：當日預排檢修 `{date, location, slot, id}`；`location`、`slot` 是原始資料代碼（例如 `P`、`EX2`、`N`），**v0 不保證可解讀**，前端請只用來顯示「當日有預排檢修」。

### 4.6 列舉值彙整

| 欄位 | 值 |
|---|---|
| `mode` | `wheel`、`stroller`、`walk` |
| `searchMode` | `strict`、`relaxed` |
| `step.type` | `enter`、`ride`、`transfer`、`exit` |
| `car.basis` | `annotated`、`mirrored`、`none` |
| `car.reason` | `missing`、`blocked`、`no-data`、`null` |
| `dataBasis` | `annotated`、`unknown`、`blocked`、`none` |
| `warnings[].code` | `NO_ELEVATOR_PLATFORM`（之後可能新增，前端遇到不認得的代碼要忽略而不是當機） |

## 5. 其他端點

### `GET /v0/stations`
`[{ "name": "七張", "lines": [{ "line": "松山新店線", "code": "G03" }], "lat": 24.97, "lng": 121.54 }, …]`，依中文排序；目前 109 站（高運量五線）。`lat`、`lng` 可能為 `null`。

### `GET /v0/stations/{name}`
`{ name, lines: { <線>: { code, exitElevatorText, platformElevatorText } }, elevatorExits[], accessibleExits[], status: { anomaly, maintenance[], snapshot }, crowd: { month, weekday[24], weekend[24] }, lat, lng }`。`crowd.weekday[i]` 為 `{hour, avgPerHour, level}`，沒有人流資料時 `crowd` 為 `null`。`status.maintenance` 為該站**全部**預排檢修（不限當日）。

### `GET /v0/meta`
資料建置時間（`dataBuilt`、`anomalySnapshot`）、人流月份與門檻、範圍（`scope.lines`、`scope.excluded`）、各行動方式的係數（`modes`）、**全部權重假設值**（`params`）、車廂標記統計（`carData.directions`、`carData.mirroredUnverified`）。前端用它顯示「估計」說明，不要把參數寫死在前端。

## 6. 錯誤

形式一律為：

```json
{ "error": { "code": "UNKNOWN_STATION", "message": "Unknown station: 台北", "field": "from", "suggestions": ["台北101/世貿", "台北小巨蛋", "台北車站", "台北橋"] } }
```

| 代碼 | 情況 | 額外欄位 |
|---|---|---|
| `UNKNOWN_STATION` | 站名無法辨識 | `field`（`from`／`to`）、`suggestions`（最多 5 個，可能為空） |
| `SAME_STATION` | 起訖站相同 | — |
| `BAD_MODE` | `mode` 不在三個值內 | — |
| `BAD_TIME` | `depart` 格式不對或日期不存在（例如 2 月 30 日） | — |
| `NO_ROUTE` | 連放寬搜尋也找不到路線 | — |

`message` 為給開發者看的英文，不要直接顯示給使用者；前端依 `code` 自行決定文案。

## 7. 前端使用指引

1. **誠實標示估計。** 候車、月台步行、轉乘係數、電梯等候與人流加成都是估計值（`meta.params.assumptions`），畫面要寫「預估」。
2. **`searchMode: "relaxed"` 與 `warnings` 必須顯示。** 這代表路線經過沒有電梯的月台，對輪椅與嬰兒車使用者是實際風險。
3. **`car.basis: "mirrored"` 要標示「尚未核對」。** `walkAssumed: true` 時不要顯示步行節數。
4. **電梯臨時故障不在資料內。** 異常公告只是建置快照，畫面要保留「以車站現場公告為準」。
5. **人流是整站歷史平均，不是即時擁擠度**，不要標成「目前擁擠」。
6. **未知欄位與列舉值一律忽略。** v0 之後只會新增，見第 9 節。

## 8. 假設與限制

- 所有權重參數是假設值，待現場實測校正（ADR-001 v0.3、v0.4）；參數版本在 `meta.paramsVersion`。
- 車廂位置為人工標記（來源：捷運Go、現場），共 232 個行車方向，其中 3 筆為鏡射推算、尚未核對。
- 起訖站的進出站只計固定 3 分鐘；轉乘才計電梯等候；從月台電梯到出口閘門的時間未計。
- 北投、七張、三重等分支站仍允許在同一條線上直接換分支（與先前行為相同）。
- 範圍：臺北捷運高運量五線，不含環狀線與小碧潭支線。
- 假日只判斷星期六、日，**不含國定假日**。
- **v0 尚未包含：** 車種（列車型號）無障礙設施打分、即時車廂擁擠度（需會員 API）、即時電梯異常、使用者回報。

## 9. 相容性規則

- 同一個版本（`/v0`）內**只新增欄位與列舉值，不改名、不刪除、不改變既有欄位的單位與意義。**
- 需要破壞相容時升 `/v1`，`/v0` 至少再維持一段公告的過渡期。
- 權重參數改變不算破壞相容，但會升 `meta.paramsVersion`，並重新產生黃金檔（見第 10 節）。
- 欄位的新增會同時更新本文件與黃金測試。

## 10. 測試與如何變更輸出

[tests/golden.test.js](../tests/golden.test.js) 有兩類測試，共 34 項：

| 類別 | 做什麼 | 用的資料 |
|---|---|---|
| **黃金測試**（25 個檔案） | 固定請求 → 與 [tests/golden/](../tests/golden/) 內的 JSON 逐欄比對；涵蓋三種行動方式、轉乘、放寬搜尋、跨午夜、時區、站名正規化、電梯異常與檢修、全部無標記、全部錯誤代碼、`meta`、站清單、單站資訊 | 凍結快照 `tests/fixtures/data.frozen.js`（重建 `app/data.js` 不會讓它失敗） |
| **不變量測試** | 步驟順序、時間不倒退、總時間＝抵達−出發、車廂在範圍內、下車端有標記時搭乘車廂必在下站電梯、`strict` 不含無電梯警告、依成本排序、同請求結果相同；並從板橋查到所有站 | 即時資料 `app/data.js`（資料重建後仍要通過） |

我已用「故意把候車時間從 3.5 改成 4」驗證：黃金測試會失敗（34 項中 16 項），還原後全數通過。

**執行**（專案根目錄；`npm test` 等同下面的標準輸入寫法）：

```bash
node --test tests/
```

在含中文的資料夾路徑下，Node 22.13（Windows）載入任何檔案都會當機（與測試內容無關，已實測），可改用標準輸入：

```bash
node - < tests/golden.test.js
```

```powershell
Get-Content -Raw tests/golden.test.js | node -
```

**有意改變輸出時**（改權重、改欄位）：先確認改動是預期的，再用 `UPDATE_GOLDEN=1` 重新產生黃金檔，**逐一檢查 `git diff`**，並同步更新本文件與 `paramsVersion`：

```bash
UPDATE_GOLDEN=1 node - < tests/golden.test.js
```

## 11. 接下來

| 項目 | 說明 |
|---|---|
| HTTP 包裝 | 以 Node 或邊緣函式把引擎包成第 3 節的端點、狀態碼與快取標頭；可定時更新電梯異常公告，解決「異常公告是快照」的問題 |
| 站碼作主鍵 | 目前以站名為鍵（資料中臺／台混用，引擎已正規化）；`/v0/stations` 已提供各線站碼，之後可改用 |
| 車種無障礙打分 | 需要先有列車型號資料表（輪椅空位、位置、月台間隙）；對車廂加懲罰或調整整條線的成本 |
| 即時車廂擁擠度 | 會員 API 核准後，`g` 可改為車廂的函式，路線規劃就能避開擁擠的車廂 |
