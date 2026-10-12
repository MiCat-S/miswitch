# MiSwitch 第二輪審核

審核日期：2026-10-12（Asia/Taipei）。基準：Git HEAD `1832549`，初始工作區乾淨。覆蓋 core、Electron IPC、React UI、CSS、現有測試及容器 CLI 聯調。沒有修改應用程式碼；新增本報告、重現腳本及截圖。桌面 smoke 所產生的既有預覽圖已還原。

結論：**基本路由與常規操作通過驗證，但有 1 個 P1、6 個 P2 待修。最優先修正大型配置的讀寫上限及不完整備份驗證，之後處理 UI 草稿和布局。** 明文存儲符合使用者要求，沒有將「未加密」列為缺陷。

## 驗證結果

| 檢查 | 本輪結果 |
| --- | --- |
| `npm test` | 22/22 通過 |
| `npm run build` | TypeScript、Vite、Electron bundle 通過 |
| 直接執行既有 `scripts/smoke-desktop.cjs` | 通過真實 IPC、表單、校驗訊息、啟用、備份、恢復 |
| `npm run test:container` | 6/6 通過；本輪所有 CLI exit code 均為 0 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| 補充 core 重現 | 重現超限備份／日誌、序列化超限無法回滾、不完整 Pi 備份、舊版狀態誤報 |
| 補充 Electron UI 重現 | 重現長文字溢出、200% 縮放溢出、模式切換丟失未保存 URL/Key |

容器使用固定版本 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1。這些結果驗證上述版本對模擬 API 的路由，不等同於所有真實供應商、OAuth 流程、工具調用或未來版本的完整驗證。

## 可執行的重現方式

```bash
./node_modules/.bin/tsx docs/review-2026-10-12/reproduce-core.mts
npm run build
./node_modules/.bin/electron docs/review-2026-10-12/reproduce-desktop.cjs
```

兩個腳本使用 OS 臨時目錄、合成密鑰和隔離 home。core 腳本完成後清理臨時配置；桌面腳本成功後清理臨時配置，截圖另存 `/tmp/miswitch-review-evidence`。桌面腳本失敗／逾時時可能保留合成臨時資料；不應對它輸入真實密鑰。

## 主要發現（按優先級）

### R1 — P1：接受的配置可產生程式自己無法讀回的輸出、備份及恢復日誌

定位：`src/core/files.ts:35`、`src/core/manager.ts:99`、`src/core/manager.ts:103`、`src/core/manager.ts:113`、`src/core/manager.ts:73`、`src/core/manager.ts:257`。

`readText()` 對目標、Hub、備份、journal 一律限制 8 MiB；`atomicWrite()` 及 transaction 沒有相應的輸出大小預檢。備份和 journal 把 before/after 原文放入一份 JSON，天然大於单個目標；JSON/TOML 格式化也可能放大輸出。

已重現兩個情境：

1. 4.2 MiB 的合法 Claude 配置成功切換，產生 **8,808,681 bytes** 的備份；下一次讀取該備份因超限被當成損壞檔案跳過，UI 可見備份數為 0。用該真實備份 entries 建立合法 journal，`snapshot()` 和 `resolveJournal()` 均因讀取上限拒絕，無法顯示或處理 pending。
2. **4,000,015 bytes** 的合法緊湊 JSON（含 `unrelated` 陣列）在格式化後寫成 **9,000,192 bytes**。transaction 回讀失敗；回滾再次使用同一 `readText()`，也讀不了自己剛寫出的檔案，留下 pending。下一次 snapshot 仍失敗，介面無法復原。

影響：已接受的輸入會失去可用備份，或在失敗後留下無法由 UI 處理的半完成操作。這不是第三方並發競爭，單進程就可重現。

修正方向：為目標與聚合存檔制定分開的有界大小規則；覆寫任何目標前檢查全部序列化輸出與 journal/backup 的大小。恢復讀取必須能讀取所有程式允許写出的檔案；超大 journal 的處理要進入可操作的 pending 狀態。不要單純移除所有上限。

驗收：大檔案與格式化膨脹必須在寫入前被拒絕，或能完整提交／復原；中途失敗後 snapshot 可讀，且沒有無法恢復的目標寫入。

### R2 — P2：內容不完整的備份仍被接受，Pi 恢復後可能沒有可用 Provider

定位：`src/core/manager.ts:50`、`src/core/manager.ts:137`、`src/core/manager.ts:245`。

`validateEntries()` 只有 `.max(4)`、重複與路徑白名單檢查；沒有最少 entries，也沒有驗證該版本／應用應包含的完整檔案集合。`backups()` 僅驗證每個已有 path 属於該應用。

重現：先啟用 Pi A，再切 B；將 B 的切換前備份保持合法 JSON，只保留 `models.json` 的 entry。備份仍被列出且恢復成功；恢復得到 A 的 models，但 settings 保持指向 B，`providers[defaultProvider]` 不存在。空 entries 同樣可被當作合法備份。

修正方向：驗證版本對應的精確檔案集合及必要 metadata；不完整備份須跳過並警告，恢復前不得寫入任何目標。若需接受舊版 Codex 單檔备份，應透過明確的版本遷移規則，而非任意子集合。

### R3 — P2：切換 API／登入模式會丟失尚未保存的 URL 與 API Key

定位：`src/ui/App.tsx:16`、`src/ui/App.tsx:32`、`src/ui/App.tsx:33`、`src/ui/App.tsx:34`。

只有 `mode` 放在 state；API 欄位採用 uncontrolled input，在模式切換時被卸載，回到 API 模式後從 provider 的 defaultValue 重建。

重現：編輯現有 Provider，把 URL 改成 `https://unsaved.test` 並輸入新的合成 Key；API → 官方登入 → API，URL 回到 `https://example.test`，Key 長度變成 0；名稱草稿仍保留，形成不一致行為。保存可能默默保留舊密鑰。

修正方向：用獨立表單草稿保存各模式欄位，或保持欄位掛載並根據模式控制 hidden/disabled/提交資料。只有正式保存 login 模式時才清除 API 憑據。

### R4 — P2：合法長名稱／備註突破卡片與整頁邊界

定位：`src/ui/styles.css:1`（卡片標題和 `.notes`）、`src/ui/App.tsx:59`、`src/ui/App.tsx:61`。

URL 和 model 有換行策略，但 Provider 名稱與備註沒有；`.notes` 的 `white-space: pre-wrap` 不會將沒有空格的長 token 強制折行。

在 840 px 桌面窗寬，保存合法的 100 字元英文名稱和 2000 字元備註後：卡片寬約 285 px，卡片 `scrollWidth` 約 15,081 px，整頁 `scrollWidth` 為 **15,291 px**。名稱跨出卡片，整頁出現水平捲動。

修正方向：對所有使用者文字做 `overflow-wrap: anywhere` 或明確的截斷／展開方案；flex/grid 子項保留可收縮邊界。不要僅以 body 的 overflow hidden 掩蓋內容遺失。

證據：[長文字桌面截圖](review-2026-10-12/long-text-840.png)。

### R5 — P2：桌面 200% 縮放時布局無法重排

定位：`src/ui/styles.css:1`（`.layout`、`header`、`.provider-grid` 及 media query），`src/desktop/main.ts:41`。

這不是要求手機版，而是既有 840 px 最小桌面視窗在 200% 縮放下的適應性。CSS viewport 為 420 px，但側欄仍佔 185 px，卡片仍要求至少 280 px，header 也沒有窄寬重排。

使用短名稱、短 model、空備註排除 R4 後仍重現：viewport **420 px**，整頁寬 **489 px**，主內容可用寬度約 180 px、卡片寬約 278 px。“添加配置”被迫逐字換行，功能區需要水平捲動。

修正方向：增加針對有效 CSS 寬度的窄布局，收起或改排側欄，header 允許換行；卡片使用不超過容器寬度的最小值。驗收最小窗口、200% 縮放及長文字組合。

證據：[短文字 200% 縮放截圖](review-2026-10-12/zoom-200.png)。

### R6 — P2：舊版 active 記錄會被誤判為外部修改

定位：`src/core/manager.ts:160`、`src/core/manager.ts:162`、`src/core/types.ts:40`。

Schema 仍接受沒有 `fingerprint` 的舊記錄，也計算了 `bytesMatch`，但 state 判定只接受有 fingerprint 且相符的情況。當目標原文完全沒變、hashes 全部符合，沒有 fingerprint 的記錄仍顯示 drift。

重現：正常啟用 Claude 配置，僅移除 Hub active 的 fingerprint 以模擬原版格式；snapshot 顯示 `drift`，UI 卻宣稱管理欄位被外部修改。

修正方向：提供明確的舊版遷移，或在沒有 fingerprint 時使用相容的 exact-hash 判斷。涉及 Codex 新增 auth.json 目標的舊紀錄，應處理版本差異，不把 schema 缺欄位直接翻譯成外部篡改。

### R7 — P2：承載資訊的小字對比不足

定位：`src/ui/styles.css:1`（`.notes`、`.endpoint`、`.hint`、`.diagnostics`）。

不是 disabled 按鈕或裝飾文字；這些區域承載備註、端點、限制提示與診斷。11 px 小字在白底上的實測計算如下：

| 選擇器 | 前景色 | 對比 |
| --- | --- | --- |
| `.notes` | `#8e97a9` | 約 2.94:1 |
| `.endpoint` | `#8791a7` | 約 3.16:1 |
| `.hint` | `#8b94a8` | 約 3.04:1 |

一般文字 AA 對比基準為 4.5:1；上述文字不屬於大字例外。依據：[W3C SC 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)。

修正方向：用統一的文字色 token 提高次要文字對比；診斷和限制提示也可增加字号。應分別驗證白底、淡灰底、成功／錯誤背景。

## 效能、UX 與維護性補充（P3）

- **主要效能熱點在備份 I/O，而不是 React。** `manager.ts:126` 每次 snapshot 都讀取、解析並保留所有備份的 before/after，再僅返回 info；保存／啟用／恢復結尾都會呼叫 snapshot，啟用還多一次 prune 掃描。30 份接近上限的備份會產生大量不必要 I/O 和主進程 JSON 解析。建議將列表 metadata 與內容分離或按 revision 快取，恢復時再讀選中的檔案。本輪未做足以定量的效能壓測。
- **初始讀取沒有獨立 Loading 狀態。** `App.tsx:74` 不設定 busy；讀取尚未完成時已顯示“尚未檢測到配置”和“添加第一組配置”，失敗後亦保留空列表。刷新和啟用只有全域 disable，按鈕仍保留原文，較難區分正在處理與無法操作。建議 initial loading/error/empty 分開，並顯示當前 action 的進度。
- **登入模式卡片文案超出驗證能力。** `App.tsx:60` 對所有 login 配置顯示“已有 OAuth”，但 Claude/Codex 沒有實際查詢登入狀態；甚至尚未啟用時也有此文字。可改為“由 CLI 管理／登入狀態未驗證”。Pi 的 entry type 檢查也不能代表未過期。
- **容器 PASS 條件應更嚴格。** `tests/container/run.ts:93` 只要求匹配過一次請求，沒有將 `result.code === 0`、`!timedOut` 或最終回覆納入。這符合“請求路由”的窄測試目標，但若拿 6/6 代表完整功能驗證，CLI 發出請求後失敗仍可能 PASS。建議明確分開 routing / CLI completion 斷言，補上 Pi Responses 和真正的登入情境。本輪實際退出碼均為 0。
- **CSS 可以逐步整理，不必換框架。** 自訂 CSS 本身沒有問題；但核心樣式壓成單行，採用全域 `small`、`header`、`h2` 等選擇器，不利於 diff、定位及未來元件擴充。可格式化並按布局／元件分區，抽出色彩和間距 token，再逐步限定作用域。
- **表單錯誤定位可改善。** 有 role=alert，但缺少對應欄位的 aria-invalid、aria-describedby 和首次錯誤焦點；模式切換及直接取消也沒有草稿處理。沒有發現需要優先用 memo/useCallback 解決的重複 render 問題，小型列表的重新計算並非本輪瓶頸。

## 已確認的安全與正確性基礎

固定路徑和恢復白名單、UUID/Provider 二次校驗、Electron main frame／來源校驗、contextIsolation／sandbox、禁用 Node integration、CSP、禁止遠端導航、新窗口與權限請求均保留。已保存 Key 不在 snapshot 回傳，parser 原始錯誤不直接回顯；Pi API Key 命令／環境插值前綴受限制。本輪沒有重現遠端腳本執行、任意 IPC 路徑寫入或原始密鑰回傳。

本機明文由使用者明確選擇；POSIX mode / Windows ACL、非合作 CLI 的讀寫競爭、跨多檔非原子性仍是已知邊界。額外測試確認：目標 mode 0400、父目錄可寫時仍可透過 rename 被替換為 0600；文件已記錄不保留既有 mode/ACL，因此作為發布前需確認的既有行為，未重複列成新缺陷。

## 驗證限制與修正順序

本輪桌面驗證平台為 macOS，沒有完成 Windows/Linux GUI、安裝包簽名／公證、真實供應商服務、真實 OAuth 續期或輔助技術整套測試。固定版本 CLI 對模擬 API 的結果可支持路由判斷；跨版本或完整登入相容性仍需要其他證據。

建議順序：R1 → R2 → R3/R4/R5 → R6/R7，再處理 P3。修正後新增目前缺少的針對性回歸，重跑既有 22 項核心、桌面 smoke 和容器案例，不以既有綠燈取代新情境驗收。
