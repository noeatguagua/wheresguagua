# 瓜瓜去哪儿（捷運無礙行）

給行動不便者（輪椅、嬰兒車、步行輔具）的**臺北捷運無障礙路線規劃**：算出最佳搭乘路線，並告訴你**每一段該搭第幾節車廂**，讓下車時電梯就在附近。

- 範圍：臺北捷運高運量五線（文湖、淡水信義、松山新店、中和新蘆、板南），109 站。**不含**環狀線（屬新北捷運）與小碧潭支線。
- 形態：純靜態前端＋預先建好的資料檔，**沒有後端、沒有建置步驟**，路線運算全在瀏覽器完成。
- 狀態：原型（v0）。車廂位置為人工標記，權重參數為假設值，**尚未經現場實測校正**，見[已知限制](#已知限制)。

## 快速開始

需要 Python 3（開靜態伺服器）與 Node 18+（只有跑測試才需要）。

```bash
python -m http.server 8765 --directory app
```

| 網址 | 內容 |
|---|---|
| `http://localhost:8765/m.html` | **手機版介面**（依 `gb.pdf` 設計稿，4 頁滿屏流程）。請用手機尺寸或瀏覽器的裝置模擬開啟 |
| `http://localhost:8765/index.html` | 早期的桌面版原型（查詢表單＋完整結果） |

庫內含車廂標記資料 `app/data.private.js`，開啟時會自動載入並給「建議搭第幾節車廂」；沒有這個檔案時路線仍可算，只是不給車廂建議（見[授權與資料來源](#授權與資料來源)）。

手機版字體（Noto Serif TC）從 Google Fonts 載入，離線時退回系統宋體。

## 功能

- 輸入起訖站與「電梯／手扶梯」偏好 → 產生最佳路線與預估時間。
- 每段車程給出**建議車廂**，使下車站電梯最近；轉乘時考慮電梯等候與轉乘步行。
- 站名底色與捷運線同色，**要換車的轉乘站**以兩線顏色漸層呈現。
- 誠實標示：找不到全程有電梯的路線時警告、車廂為推算時標示「尚未核對」、電梯以現場公告為準。

**可安裝成手機桌面 App（PWA）：** 首頁右上角的下載圖示可安裝；Android Chrome 會直接跳出安裝視窗，iPhone 會顯示「分享 → 加入主畫面」的步驟。已安裝的版本全螢幕開啟，沒有網路時也能用上次載入的頁面（Service Worker，網路優先、失敗才用快取）。

手機版流程：

```
首頁 ──路線生成──▶ 總覽 ──確定行程──▶ 第 1 段 ──下一步──▶ … ──▶ 最後一段 ──結束──▶ 首頁
```

## 專案結構

```
app/
  m.html  m.css  m.js     手機版介面（只負責畫面，呼叫引擎）
  index.html              早期桌面版原型
  engine.js               路線引擎：純函式，無 DOM、無網路，瀏覽器與 Node 通用
  data.js                 預先建好的公開資料（車廂欄位為空；約 125 KB）
  data.private.js         車廂標記資料（有就自動載入；隨網站公開，見 LICENSE-DATA.md）
  assets/                 背景光暈、電梯／手扶梯圖示
annotator/                本機標記工具（標記電梯／手扶梯在第幾車廂），僅綁 127.0.0.1:8766
data/
  annotations.json        人工標記的車廂資料（私有，不在庫內）
  annotations_backup/     標記工具每次儲存前的備份（不進版控）
  tdx/                    TDX 原始靜態資料快照
tools/
  fetch_tdx.py            抓 TDX 資料（需要金鑰）
  build_data.py           合併所有來源 → app/data.js
  split_private.py        把車廂欄位拆到 data.private.js（公開版留空）
tests/                    黃金測試＋不變量測試（34 項；測試資料含車廂標記，不公開）
docs/                     設計文件（見下）
full.js                   舊版單檔腳本，目前沒有任何檔案引用
```

## 引擎用法

```js
const E = MetroEngine.createEngine(window.METRO_DATA);
const res = E.plan({ from: '市政府', to: '大直', mode: 'wheel', max: 3 });
// res.routes[0].steps → enter、(ride、transfer)*、ride、exit
```

`mode`：`wheel`（輪椅）、`stroller`（嬰兒車）、`walk`（步行輔具，電梯或手扶梯皆可）。輸出欄位、錯誤碼與前端使用指引見 [API-spec-v0.md](docs/API-spec-v0.md)；引擎函式與規劃中的 HTTP 端點一一對應，之後加後端只需把函式呼叫換成 `fetch`。

## 資料與重建

資料分三層，皆為公開資料，**不含會員專屬 API**：

| 來源 | 內容 | 取得方式 |
|---|---|---|
| data.taipei | 電梯位置、電梯維修預排、異常公告、轉乘步行時間、出入口座標、歷史每小時 OD | `build_data.py` 即時抓；電梯與維修 CSV（Big5）需先下載 |
| TDX | 站間行駛時間、轉乘時間、出口電梯旗標 | `tools/fetch_tdx.py`（需註冊 TDX 取得金鑰） |
| 人工標記 | 電梯／手扶梯對應車廂 | `annotator/` → `data/annotations.json`（**私有，不在庫內**） |

**一般開發不需要重建資料**，`app/data.js` 與 `data/` 已在庫內。要重建時：

```bash
# 1. 抓 TDX（金鑰放 .secret/tdx.env，格式見下）
python tools/fetch_tdx.py .secret/tdx.env data/tdx

# 2. 合併成 app/data.js
#    <raw_dir> 內需有 elevator.csv、maint.csv（cp950）；<od_csv> 為單月 OD CSV，可用 - 略過
python tools/build_data.py <raw_dir> <od_csv|-> app/data.js data/tdx data/annotations.json

# 3. 拆出私有車廂資料（公開版 data.js 的 access 會被清空）
python tools/split_private.py app/data.js
```

沒有 `data/annotations.json` 時，省略 build_data 的第 5 個參數即可，路線仍可運作，只是不給車廂建議。

`.secret/tdx.env`（已列入 `.gitignore`，**請勿提交**）：

```
TDX_CLIENT_ID=你的ID
TDX_CLIENT_SECRET=你的金鑰
```

標記車廂：`python annotator/server.py`，開 `http://127.0.0.1:8766`。

## 測試

```bash
npm test          # 等同 node - < tests/golden.test.js
```

在含中文的資料夾路徑下，Node 22（Windows）直接載入檔案會當機，所以改用標準輸入執行。**測試資料含車廂標記，不在公開庫內；沒有私有資料時整組測試會略過。**作者本機 34 項測試全數通過：黃金測試以凍結資料快照比對輸出；不變量測試用即時資料檢查步驟順序、時間不倒退、車廂範圍等。有意改變輸出時請見 [API-spec §10](docs/API-spec-v0.md)。

## 文件

| 文件 | 內容 |
|---|---|
| [產品調查](docs/捷運無障礙導航_產品調查.md) | 可行性、資料來源與缺口調查 |
| [ADR-001 架構決策](docs/ADR-001_捷運無礙行架構.md) | 資料來源、路線模型、權重參數，含 v0.2–v0.5 修訂紀錄 |
| [API 輸出規格 v0](docs/API-spec-v0.md) | 引擎輸出契約（欄位、列舉、錯誤碼、相容性規則） |
| [前端設計](docs/前端設計_瓜瓜去哪儿.md) | 手機版 UI 流程、設計 tokens、站名底色規則、引擎欄位對應 |

## 已知限制

- **權重參數是假設值**：候車 3.5 分、月台步行 1.2 m/s、轉乘係數、電梯等候、人流乘數等，均待現場實測（全部列在 [ADR-001 §8](docs/ADR-001_捷運無礙行架構.md)）。
- **車廂位置為人工標記**（來源：捷運Go、現場），共 232 個行車方向，其中 3 筆為鏡射推算、尚未現場核對。捷運改版或電梯異動需重新標記。
- **電梯異常公告只是建置時的快照**，臨時故障不在資料內；介面一律提醒以車站現場公告為準。
- **人流是整站、單月的歷史平均**，不是即時，也不是車廂擁擠度。
- 假日只判斷週六、日，不含國定假日。
- 手機版只在桌面瀏覽器的手機尺寸模擬下驗證過（414×736、390×844、360×600），**未做實機與螢幕報讀器測試**；後三條線的線色與手扶梯以外的狀態為推估，見[前端設計 §9](docs/前端設計_瓜瓜去哪儿.md)。

## 下一步

見 [ADR-001 待辦](docs/ADR-001_捷運無礙行架構.md)：抽樣現場核對標記、申請捷運會員 API（即時擁擠度）、改用 TDX 班距取代固定候車時間、加後端代理讓異常公告更即時、無障礙檢查（WCAG 2.1 AA）。

## 授權與資料來源

| 範圍 | 授權 |
|---|---|
| 程式碼（`app/`、`tools/`、`annotator/`、`tests/`） | [Apache License 2.0](LICENSE)，著作權聲明見 [NOTICE](NOTICE) |
| 車廂人工標記資料（`data.private.js`；原始檔 `data/annotations.json` 不進版控） | **隨網站公開顯示，但保留所有權利、未授予再利用權**，見 [LICENSE-DATA.md](LICENSE-DATA.md) |
| TDX、data.taipei 等第三方資料 | 依各來源條款，出處見 [DATA_SOURCES.md](DATA_SOURCES.md)；**本庫尚未逐一核對這些資料集的授權** |

本專案與臺北捷運公司無隸屬關係，亦非官方應用程式。

## 上傳前請確認

- 第三方資料（`data/tdx/`、`app/data.js`）的再散布條件：請到 [DATA_SOURCES.md](DATA_SOURCES.md) 列的來源頁面確認。
- `.secret/` 已被忽略；金鑰只存在你的本機。
- `data/annotations_backup/`、`data/annotations.json`、`tests/fixtures/data.frozen.js`、`tests/golden/` 已加入 `.gitignore`；`app/data.private.js` 則刻意公開（網站需要它）。
