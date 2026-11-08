# 資料來源與授權

本庫的路線資料由下列來源合併而成。**第三方資料的授權以各來源頁面標示為準；本庫尚未逐一核對各資料集的授權條款與再散布限制，公開或商用前請自行確認。**

## 第三方資料

### TDX 運輸資料流通服務平臺

- 平台：<https://tdx.transportdata.tw>
- 端點：`/api/basic/v2/Rail/Metro/{資料名}/TRTC`
- 取用的資料：`S2STravelTime`（站間行駛時間）、`LineTransfer`（轉乘時間）、`StationExit`（出入口與電梯旗標）；另抓取 `StationFacility`、`StationTransfer`、`Frequency`、`Station`（前三者存於 `data/tdx/`，`Frequency`、`Station` 因限流未取得）
- 檔案位置：[data/tdx/](data/tdx/)，抓取時間 2026-11-08（腳本 [tools/fetch_tdx.py](tools/fetch_tdx.py)）
- 用於：站間行車時間、轉乘時間、有電梯的出口

- 各站發車班表：`StationTimeTable`（764 筆，抓取 2026-11-08，腳本 [tools/fetch_timetable.py](tools/fetch_timetable.py)），精簡成 [app/timetable.js](app/timetable.js)（[tools/build_timetable.py](tools/build_timetable.py)）；原始檔 `data/tdx_raw/` 不進版控。**不含文湖線**（TDX 此資料集沒有 BR），只有分鐘精度，不含國定假日。
- 即時到離站：`LiveBoard/TRTC`，經 [worker/](worker/) 代抓與快取，不存進程式庫。
- 站名英文譯名：取自 TDX 各資料的 `StationName.En`（109 站），存於 [app/stations_en.js](app/stations_en.js)。

### data.taipei 臺北市資料大平臺

- 平台：<https://data.taipei>
- 取用的資料集（以建置腳本使用的資料集代碼標示）：

| 用途 | 取得方式 |
|---|---|
| 捷運出入口（座標、無障礙出入口） | API，資料集 `307a7f61-e302-4108-a817-877ccbfca7c1` |
| 轉乘步行時間 | API，資料集 `14fd1af0-dc2b-4174-87d4-fcb9de783496` |
| 電梯異常公告（建置時快照） | API，資料集 `649c44eb-60b5-4746-a353-cbdc6651fc09` |
| 各站電梯位置（文字描述） | CSV（Big5），手動下載後放入 `raw_dir/elevator.csv` |
| 電梯維修預排（每月） | CSV（Big5），手動下載後放入 `raw_dir/maint.csv` |
| 歷史每小時 OD（2026 年 9 月） | CSV，彙總為「站 × 平日／假日 × 小時」平均進出量 |

- 以上資料經過清洗與合併：修正站碼錯誤（`BF12`→`BR12`、七張 `G03A`→`G03`）、臺／台正規化、人流分級。
- 產出：[app/data.js](app/data.js)（由 [tools/build_data.py](tools/build_data.py) 產生，再以 [tools/split_private.py](tools/split_private.py) 去除車廂欄位）。

### 臺北大眾捷運股份有限公司

- 路線、站名、站碼、各線車廂數（文湖線 4 節、其餘 6 節）等公開資訊。
- 本專案與臺北捷運公司**無隸屬或合作關係**，亦非官方應用程式。

## 本專案自行產生的資料（公開顯示、保留所有權利）

| 資料 | 狀態 | 說明 |
|---|---|---|
| `data/annotations.json`、`app/data.private.js` | `data.private.js` 隨本庫與網站公開，`annotations.json` 不進版控；**保留所有權利、未授予再利用權**，見 [LICENSE-DATA.md](LICENSE-DATA.md) | 232 個行車方向的電梯／手扶梯所在車廂，由專案作者標記。每筆的 `source` 欄位記錄依據：631 筆標為「捷運Go」（標記時參考該 App 顯示的資訊），12 筆標為「鏡射推算」（由對向資料推得，共涉及 3 個行車方向，尚未現場核對） |

## 設計與素材

- 介面設計稿（`gb.pdf`、`gbbackground.pdf`）：專案作者提供；背景光暈圖 [app/assets/bg.webp](app/assets/bg.webp)、電梯圖示 [elevator.svg](app/assets/elevator.svg)、手扶梯圖示 [escalator.png](app/assets/escalator.png) 取自該設計稿與作者提供的檔案，與程式碼同依 Apache 2.0 散布。
- 字體：Noto Serif TC（SIL OFL 1.1），執行時由 Google Fonts 載入。

## 免責

路線、時間、車廂與電梯位置僅供參考，電梯狀況以車站現場公告為準。
