# Mi-Switch 本輪獨立審查（SOL HIGH）

審查日期：**2026-10-12，Asia/Taipei**。分支：`main`。基準範圍：`722c119..1f89403036904692c7e4246c79ef802642e2e349`，實際 HEAD：**`1f89403036904692c7e4246c79ef802642e2e349`**。實際範圍為 12 個 commit、40 個變更檔案。開始時工作區**不乾淨**：只有未追蹤的 `docs/review-astra/`；沒有 tracked 變更。已讀指定的六份文件，並以實作為準。

本輪只新增本報告與 `docs/review-sol-high/`；沒有修改產品程式碼、測試、設定或既有審查證據，沒有 commit、push、切換分支或安裝 App。建置生成的 `dist/`、`dist-desktop/`、`release/` 為既有忽略路徑。`npm run test:desktop` 覆寫的 `docs/desktop-preview.png` 已用指定的 `git checkout -- docs/desktop-preview.png` 還原；結束時 tracked diff 為空，HEAD 未變。

## 驗證表

| 驗證 | 結果與證據 |
| --- | --- |
| `npm ci` | 略過：`node_modules` 已存在；`npm ls --depth=0` 成功，離線比對 `node_modules/.package-lock.json` 的 312 個 package version 與根 lockfile 一致，見 `assets.log`。沒有宣稱重新校驗所有安裝檔案的 integrity。 |
| `npm run typecheck` | 通過，exit 0；`typecheck.log`。 |
| `npm test` | **53/53 通過**，fail/cancelled/skipped 均為 0；`test.log`。 |
| `npm run test:desktop` | 通過真實 Electron/main/preload/React；`desktop-smoke.log`。HTTP 非本機 URL 與供應商欄位的 IPC 拒絕為預期斷言；預覽圖已還原。 |
| `docker info` | exit 0，Colima 可用；`docker-info.log`。未變更 Docker 設定。 |
| `npm run test:container` | **7/7 通過**，CLI exit 均為 0，沒有 timeout；`container.log`。固定 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1。 |
| `npm run package`（選做） | 通過，產出 `release/Mi-Switch-0.1.0-arm64.dmg`，ad-hoc 簽名、未公證；`package.log`。未安裝，也未啟動打包版。 |
| 補充核心斷言 | **13 組通過**；`core.log`。包含金鑰傳送／讀取、TOML 型別、Hub 上限、保存失敗回滾、pending、icon、六種 app/mode 投影、全局衝突／no-op、輸入驗證及格式邊界。 |
| Sol 修正回歸 | 快取受控競態、retention=1/10、真實 `722c119` 升級、降級只讀拒絕通過；但真實舊版 Codex login 改名仍重寫目標，見 A6；`regressions.log`。 |
| 補充模型 HTTP | 本機 mock 驗證 redirect 不跟隨、Content-Length／串流超過 4 MiB 拒絕、403 不回顯內容、單次請求約 **10,003 ms** timeout；`models.log`。 |
| 補充桌面 | 重現 A5、A8；另驗證 IPC 第二視窗／非 main frame 拒絕、精確外部連結白名單、對話框取消焦點／Esc、1140 px 對齊、200% 縮放與關窗重開；`desktop.log`、三張 PNG。 |
| 素材、數值與包內容 | 字體原檔 SHA-256 一致；SVG 危險屬性掃描通過；CSS 數值與安裝包授權缺漏見 A10/A11；`assets.log`、`design.log`、`package-contents.log`。 |
| 舊資料路徑 | 隔離的最小 Electron package 實測舊開發名稱產生 `miswitch`、現版固定 `MiSwitch`，字串不相同；`data-path.log`。大小寫敏感系統的後果另以明確程式碼證據判定，見 A9。 |

## 結論

**共 12 項：P0 × 3、P1 × 4、P2 × 3、P3 × 2。** 優先修正保存金鑰送往未保存端點（A1）及設定檔讀取把同一保存金鑰回傳 renderer（A2），再修全局 TOML 的型別毀損（A3）與 Hub 超限寫入（A4）；之後處理全局分頁競態、舊版 definition、特殊鍵名及選單同步。53/53 與 7/7 的綠燈不能覆蓋這些案例。P0 依本輪定義評定：A1/A2 是金鑰給非預期接收者，A3 是檔案語意資料被改變；A3 的歷史備份可精確恢復，不代表所有案例都不可逆。A4 的 Hub 原文仍是合法 JSON、資料未消失，故列 P1「需手動修復」，沒有誇大成資料遺失。

## 重現方式與隔離範圍

所有新增腳本都在 `docs/review-sol-high/`：

| 腳本 | 用途 | 執行指令（倉庫根目錄） |
| --- | --- | --- |
| `reproduce-core.mts` | 13 組核心重現及安全單元斷言 | `./node_modules/.bin/tsx docs/review-sol-high/reproduce-core.mts` |
| `verify-regressions.mts` | 快取競態、備份序號、實際舊版 core 升級／降級 | `./node_modules/.bin/tsx docs/review-sol-high/verify-regressions.mts` |
| `verify-models.mts` | 本機 HTTP 錯誤、redirect、大小、timeout | `./node_modules/.bin/tsx docs/review-sol-high/verify-models.mts` |
| `reproduce-desktop.cjs` | 真實產品 main/preload/React；全局分頁與選單狀態競態；GUI 證據 | 先 `npm run build`，再 `./node_modules/.bin/electron docs/review-sol-high/reproduce-desktop.cjs` |
| `verify-assets.cjs` | 離線 npm cache 原始 tarball、字體雜湊、Lucide license、lockfile、SVG 掃描 | `node docs/review-sol-high/verify-assets.cjs` |
| `measure-design.cjs` | CSS 實際色碼對比、color-mix、含 shorthand 的字級 | `node docs/review-sol-high/measure-design.cjs` |
| `inspect-package.cjs` | 讀本輪新建 `release/` 的 asar 與 Resources，檢查授權隨包交付 | 先 `npm run package`，再 `node docs/review-sol-high/inspect-package.cjs` |
| `inspect-data-path.cjs` | 暫存最小 Electron package 的舊開發 userData 名稱 | `node docs/review-sol-high/inspect-data-path.cjs` |

core 以 `mkdtemp` + `realpath` 建立臨時根，明確呼叫 `resolvePaths(臨時 store, 臨時 home, {})`，Manager 的 env 也傳 `{}`。桌面用 realpath 後的 `MISWITCH_SANDBOX_ROOT`，只啟動開發建置。資料路徑探針也只用臨時 `appData`，不啟動產品。網路行為探針只使用 `127.0.0.1` 與合成金鑰；既有容器聯調使用容器內 mock，未掛載宿主 HOME。必跑的依賴／容器／打包命令照專案建置流程執行；沒有向真實 API 供應商發請求。沒有讀寫真實 CLI、MiSwitch store 或 `/Applications` 的執行資料。

`verify-regressions.mts` 將 `git show 722c119:src/core/*.ts` 寫到臨時目錄，共用現有依賴；**不是手寫近似舊版**。快取競態以 `fs.lstat` 的受控 interleaving 驗證；桌面競態只延後一個**真實 IPC 回應的交付**，沒有替換回應內容或產品處理函式。這些排程證明存在可行次序，不代表已量測自然發生頻率。

`verify-models.mts`、`verify-assets.cjs`、`measure-design.cjs` 以 Astra 腳本作起點，在新增目錄執行並檢查結果；數值腳本另補上 shorthand 字級。其餘也參考先前線索，但每個列出的問題均已重新驗證。**沒有任何嚴重度問題僅沿用先前證據**。`docs/review-astra/` 未變更；沒有執行其特殊鍵名保存／啟用或 renderer 崩潰腳本。特殊鍵名只做靜態分析及正常函式／Schema 斷言，未寫攻擊或利用程式。

## 問題（依嚴重度排序）

### A1 — P0：未保存的新 Base URL 能取得既有供應商的保存金鑰

**位置：** `src/core/manager.ts:447`、`src/core/manager.ts:451`、`src/core/manager.ts:453`；`src/ui/ProviderEditor.tsx:75`、`src/ui/ProviderEditor.tsx:78`。

**現象：** `listModels` 依 `providerId` 從 Hub 取得 Key，卻使用 renderer 傳來的 `baseUrl`、protocol 與鑑權方式。保存端點為 `https://saved.example`，編輯時把 URL 改成另一個尚未保存的本機 mock，Key 留空；按「從供應商取得」後 mock 收到保存 Key，Hub 的 URL 仍為原值。

**重現：** 執行 `reproduce-core.mts`，輸出 `saved-key-to-unsaved-url`，斷言接收到的合成 Key 等於 Hub Key、Hub URL 不變。只連 `127.0.0.1`，未向外部站點發金鑰。

**預期 vs 實際：** 保存 Key 的隱式重用應綁定保存的連線設定；實際上只需換 URL，就能把舊供應商 Key 送給新接收者。不跟隨 redirect 並不能防止這條直接傳送路徑。

**影響：** 一般編輯工作流即可誤把 A 的 Key 給 B；也使取得本機 renderer 控制權的程式不必先讀出 Key，便能指定其接收端。本輪沒有驗證 renderer 入侵方法。

**修正方向：** 留空重用時，由 main 取保存端點／protocol／鑑權資料，並拒絕與草稿不一致的請求；URL 改變時要求明確輸入適用於新端點的 Key。至少核對 origin，最好核對正規化完整 API base，避免同主機不同租戶／路徑的混用。

**確信程度：已獨立重現。** 由 `3200d3b` 引入；不是使用者允許的明文保存設計本身。

### A2 — P0：匯入的 Codex 非 custom 路由金鑰會出現在預覽及全局設定回應

**位置：** `src/core/config-editor.ts:57`、`src/core/config-editor.ts:59`、`src/core/config-editor.ts:88`、`src/core/config-editor.ts:89`；`src/core/manager.ts:303`、`src/core/manager.ts:317`、`src/core/manager.ts:318`；`src/core/adapters.ts:166`。

**現象：** 真實格式的 `model_provider="work"`、`[model_providers.work]` 含字面 `experimental_bearer_token`。`importLive()` 正常把它存成 Provider 的 Key；`snapshot()` 只回 `hasKey`。但 `splitConfig` 只移除 `custom` 與 `miswitch_*` 表，而 `composeConfig` 只替換將要寫入的 `custom` 金鑰，保留的 `work` 表仍含同一原文 Key。`configView` 與 `globalView` 都將它回給 renderer。

**重現：** `reproduce-core.mts` 的 `imported-key-in-read-apis`；保存 Key 在兩個 `text` 回應中出現，snapshot 不含它。Hub 的 Provider 確實 `hasKey=true`，並非只展示一個從未保存過的任意字串。

**預期 vs 實際：** renderer 永遠不能取得已保存 Key；實際只有 snapshot 與新寫出的 custom token 被遮蔽，保留下來的路由表沒有遮蔽。

**影響：** 初次匯入既有 Codex 設定後，展開預覽或全局設定便跨越安全不變量 1。其他保留表的鑑權欄位也需同一套處理，不能用「不是本工具管理」合理化向 renderer 傳回憑據。

**修正方向：** 對所有已知憑據欄位做 main 端統一遮蔽，覆蓋保留／非使用中 Provider 表與 header。全局設定的可保存文字不能直接把遮蔽佔位字串寫回真實 Key；需保留原值、不可編輯敏感欄位或獨立分離憑據。補上「匯入其他 route ID → 兩個讀 API」回歸。

**確信程度：已獨立重現。** 預覽由 `b28242a` 引入，全局回應由 `1f89403` 引入。

### A3 — P0：保存全局 TOML 會把未編輯的日期與時間型別改成字串

**位置：** `src/core/config-editor.ts:10`、`src/core/config-editor.ts:50`、`src/core/config-editor.ts:66`、`src/core/config-editor.ts:68`；`src/core/manager.ts:338`。

**現象：** `@iarna/toml` 把 TOML date/datetime/time 解析成帶型別的值，`clone` 用 JSON stringify/parse 丟掉型別。原檔 `stamp=1979-05-27T07:32:00Z`、`day=1979-05-27`、`clock=07:32:00.000`，僅加一行 `approval_policy="on-request"` 後，三者都成為有引號的 TOML string。原 `stamp` 是 `Date`，新值的 `typeof` 是 `string`。

**重現：** `reproduce-core.mts` 的 `toml-date-type-loss`；同時斷言 inline table 與 array of tables 的內容仍保留，排除一般陣列合併問題。歷史備份恢復後原 bytes 完全相同。

**預期 vs 實際：** 修改無關全局欄位應保留其他值的 TOML 型別；實際讀取文字就已呈現 string，保存會把轉型持久化。這超出文件已揭露的「排版與註解不保留」。

**影響：** 含合法日期／時間的全局或擴充 metadata 會被靜默改變語意。本輪沒有找到 Codex 固定必需使用日期的內建欄位，也沒有宣稱所有一般 Codex 設定都受影響；受影響的是被工具接受、並承諾保留的合法 TOML 值。依本輪資料毀損定義列 P0。

**修正方向：** 使用保留 TOML scalar 型別與相關標記的遞迴 clone／split／join；canonical 摘要也要區別日期與相同文字的 string。對 offset datetime、local datetime、date、time 的讀取、no-op、修改無關欄位及 restore 做往返斷言。

**確信程度：已獨立重現。** 原因由 `b28242a` 的 config editor clone 引入；現版全局保存將其持久化。

### A4 — P1：Hub 保存沒有輸出大小預檢，會寫出自己再也讀不回的 Hub

**位置：** `src/core/manager.ts:281`、`src/core/manager.ts:282`、`src/core/manager.ts:440`；`src/core/files.ts:12`、`src/core/files.ts:44`。對照只在交易流程檢查的 `src/core/manager.ts:142`。

**現象：** 一份合法、可 snapshot 的 Hub 含 793 個合法 Provider，原文 **8,385,238 bytes**。正常再新增一個 Provider 後，Hub 被替換為 **8,395,812 bytes**，超過 **8,388,608 bytes** 上限。save 在後續 snapshot 才失敗；之後所有 Hub 讀取都因超限被拒絕，備份數為 0。

**重現：** `reproduce-core.mts` 的 `hub-save-over-read-limit`。用 Schema 接受的 8192 字元合成 Key、2000 字元 notes 構造接近上限 fixture，避免執行數百次保存；新增仍是正常公開 save API。錯誤為靜態 `配置不是普通文件，或超过 8 MiB 限制`。

**預期 vs 實際：** 應在替換 Hub 前拒絕過大輸出，保留原 Hub；實際保存已完成但回報一般錯誤，沒有 `SAVED_NOT_APPLIED` 前綴，也沒有正常 UI 修復入口。JSON 原文及 Provider 資料仍在，這是不可用狀態，並非已重現內容消失。

**影響：** 大量供應商、較長 Key/notes 或之後的 edit/import 可使所有供應商管理與歷史恢復被封鎖，需手動縮減或修復 Hub。少量一般 Provider 不會觸發。

**修正方向：** 所有 Hub writer 共用序列化 byteLength 上限預檢，在 atomicWrite 前完成；包含 save、remove、importLive，並確保拒絕後原 bytes 保留。不要只補 transaction 的輸出檢查。

**確信程度：已獨立重現。** 直接 save 寫 Hub 的缺口在基準 `722c119` 已存在；`360dfd8` 加入新的直接 writer，本輪保存語意又擴大失敗回應影響。沒有冒充本輪新引入。

### A5 — P1：全局分頁的舊回應能覆蓋新分頁，保存寫入與畫面路徑不一致的檔案

**位置：** `src/ui/GlobalSettings.tsx:21`、`src/ui/GlobalSettings.tsx:24`、`src/ui/GlobalSettings.tsx:26`、`src/ui/GlobalSettings.tsx:33`。

**現象：** Claude 全局讀取尚未交付，切到 Pi 並收到 Pi 回應，之後舊 Claude 回應交付；分頁選中仍是 Pi，但 path/text/base 被換成 Claude 的。保存用當下 prop `app='pi'`，沒有使用這份 view 的來源 app。

**重現：** `reproduce-desktop.cjs` 的 `global-view-race-writes-wrong-file`；Claude 與 Pi 的初始全局部分都為 `{"shared":"original"}`，故 base 相同。只延後真實 Claude IPC 回應：畫面显示 `~/.claude/settings.json`，編輯後保存，實際 Pi 檔案收到 `claudeOnly`，Claude 原檔不變。見 `global-race.png`。資料相同不是必要的 UI 誤標條件，只是讓錯誤保存通過摘要檢查的確定 fixture；摘要不同時一般會拒絕保存。

**預期 vs 實際：** view 必須與當前 app 一致，較早請求不能覆蓋較晚結果；實際沒有 request sequence、effect cleanup 或來源 app 綁定。App 的 snapshot sequence 不保護此 component。

**影響：** 快速換分頁、慢 I/O 或重讀交錯時，使用者看到錯誤檔案；全局摘要相同時還會向錯誤 CLI 寫入設定。交易與備份完整運作，但備份無法阻止使用者選擇被錯誤套用。

**修正方向：** 每次 load 綁 app 與序號，effect cleanup 作廢舊回應；view 保存來源 app，保存時驗證來源與選中 app 相同。loading 時停用保存，並避免舊讀取覆蓋後來的草稿。

**確信程度：已獨立重現，受控 IPC 交付次序。** 由 `1f89403` 引入；未量測自然發生頻率。

### A6 — P1：rules=1 的 Codex 登入記錄仍把顯示改名當成需要重新套用

**位置：** `src/core/adapters.ts:53`、`src/core/adapters.ts:56`；`src/core/manager.ts:235`、`src/core/manager.ts:285`、`src/core/manager.ts:288`。

**現象：** rules=2 正確按模式投影，但 rules=1 還是對所有 `chatgpt` 模式把 `name` 放進 definition。真實 `722c119` core 啟用 Codex login，再用現版只改名稱，現版判為 edited 並呼叫 activate。目標自行加的 TOML comment 因這次序列化消失，inode 改變，記錄升級成 rules=2；只改顯示欄位卻產生目標交易與額外備份。

**重現：** `verify-regressions.mts` 的 `Sol-R3-real-722c119-login-rename`；`reproduce-core.mts` 另有同樣的 rules=1 fixture。沒有把 Codex **API 模式**改名當缺陷，該模式確實寫 `custom.name`。

**預期 vs 實際：** 保存 Codex login 的名稱不得改寫目標；舊 rules 應保護升級後的指紋相容，而不是繼續把不影響 patch 的差異當成供應商編輯。

**影響：** 從舊版升級、active.rules 未設或為 1 的使用者，首次改名會出現未要求的重寫；存在動態鑑權／限制等情況還可能把單純顯示操作變成 `SAVED_NOT_APPLIED` 失敗。

**修正方向：** 保留舊 fingerprint 的相容比較，但保存是否需要 activate 應另按現有寫入投影比較前後 Provider；等價顯示修改不能觸發交易。必要時安全更新 definition/rules 的 metadata，不能靠重寫目標完成遷移。

**確信程度：已獨立重現，包含實際基準 core。** `b7538a2` 修好新規則的 R3，但舊記錄仍有缺口；本輪自動套用放大了後果。

### A7 — P1：Pi Provider ID 的繼承屬性被當成存在的 Provider，且圖示 lookup 回傳非圖示物件

**位置：** `src/core/types.ts:33`；`src/core/adapters.ts:127`；`src/ui/vendor.ts:11`、`src/ui/vendor.ts:16`；`src/ui/common.tsx:23`；`src/ui/ProviderEditor.tsx:103`。

**現象與證據：** `loginProvider` 的正規式接受 `__proto__`；普通空物件沒有該 own entry，但 `auth[id]`／`providers[id]` 會取到繼承物件，`isObject` 的存在檢查因此不會拒絕。`loginMarks` 同樣是普通物件，`autoIcon` 對此 ID 回傳非 null 的 object，而不是宣告的 `VendorIcon | null`。下游直接 `vendorMarks[icon].svg`／`.label`，沒有型別或存在檢查。

**重現：** `reproduce-core.mts` 的 `special-key-static-unit-check` 只斷言 Schema 接受、`Object.hasOwn({}, '__proto__') === false` 與 `autoIcon` 的回傳型別。**未執行此輸入的 activate、未寫利用程式、未重跑先前 renderer 崩潰操作。** 這項的完整 target／GUI 後果是明確程式碼證據，不是本輪已動態重現。

**預期 vs 實際：** 沿用 Pi Provider 必須有真實 own entry，圖示查表應只回白名單值或 null；實際可接受不存在的 Provider，並把錯型別資料流入 render。

**影響：** 特定合法 Schema 輸入會繞過正常的「Pi 中找不到該 Provider」拒絕，並能導致 UI render 失敗；沒有任意程式執行或修改全域 prototype 的證據，本報告也不做此宣稱。

**修正方向：** Provider 存在性使用 `Object.hasOwn`；lookup 用 Map 或無 prototype 的 dictionary，且回傳前核對 vendor enum。Schema 可以另外明確拒絕保留鍵，但不能只靠列出一個鍵修掉 lookup 語意。

**確信程度：有明確程式碼證據，相關正常單元斷言已獨立驗證。** Pi existence 漏洞在基準已存在；`1f89403` 的圖示查表新增 UI 後果。

### A8 — P2：UI 忙碌時丟棄選單變更事件，操作完成後仍顯示舊供應商

**位置：** `src/ui/App.tsx:127`、`src/ui/App.tsx:129`、`src/ui/App.tsx:138`、`src/ui/App.tsx:148`、`src/ui/App.tsx:158`；`src/desktop/tray.ts:51`；`src/core/manager.ts:283`。

**現象：** refresh 遇 `busyRef.current` 直接 return，沒有記錄待刷新；act finally 也不補讀。UI 保存 A 的回應已生成但還沒交付時，選單切到 B，changed 發到仍 busy 的 UI 被丟棄；稍後保存回應覆蓋畫面為 A。Hub 與 CLI 目標已是 B。

**重現：** `reproduce-desktop.cjs` 的 `tray-changed-event-dropped-while-busy`，真實保存回應延後交付、真實 tray click；斷言 UI summary 為 A、重新呼叫 snapshot 的 active ID 是 B。見 `tray-stale.png`。未宣稱正常使用必然發生；此證據是確定的非同步交付次序。

**預期 vs 實際：** 忙碌期間可延後 refresh，但不能永久丟掉已知的外部變更；sequence 只解決已發出的 snapshot 回應次序，沒有涵蓋未發出的 refresh。

**影響：** 畫面與選單／真實檔案暫時不一致，直到下一次取得焦點或手動重讀；使用者可能編輯錯誤的「正在使用」Provider。本輪沒有重現合作 Manager 互相寫壞檔案，Hub／目標鎖仍有效。

**修正方向：** busy 時設置待刷新旗標，操作结束後補讀；或者使用主程序變更 revision，對落後回應重新讀取。首次 import 回應也應納入同一序號機制。

**確信程度：已獨立重現，受控 IPC 交付次序。** 由 `1f89403` 的 focus/onChanged 與 tray 整合引入。

### A9 — P2：固定 MiSwitch 資料位置未處理舊開發版的小寫 miswitch

**位置：** `src/desktop/main.ts:22`；基準 `722c119:src/desktop/main.ts:25`、`722c119:package.json:2`；`README.md:5`。

**現象：** 舊開發版 package 名稱為 `miswitch`，未設定 userData/name，使用 Electron 默认 `appData/miswitch/store`。現版直接改用 `appData/MiSwitch/store`，沒有舊路徑存在性檢查、匯入或遷移。

**重現／證據：** `node docs/review-sol-high/inspect-data-path.cjs` 在暫存最小 package 中以相同 `name` 啟動 Electron，得到 `appName=miswitch`、`oldFolder=miswitch`、`newFolder=MiSwitch`。程式碼直接證明現版不查舊 spelling。**本機未建立大小寫敏感磁碟，也沒有打開真實舊資料**，故不宣稱已在大小寫敏感 macOS 卷實際完成升級重現。

**預期 vs 實際：** 保留固定 MiSwitch 位置是指定設計，但從舊小寫路徑升級也應能找到資料；大小寫敏感 filesystem 會把兩者當不同目錄，UI 看起來變成全新 store，舊資料仍在另一目錄。

**影響：** 舊開發版使用者在大小寫敏感 APFS／其他平台可能看不到舊 Provider 與備份；沒有證據顯示舊檔被刪除。舊資料不應被「改名不影響」文案掩蓋。

**修正方向：** 保留目前固定路徑，加入只在新 store 不存在時的明確舊資料遷移，處理兩邊都有資料的衝突；備份內含絕對路徑時需保持目標驗證規則，不做任意改寫。

**確信程度：有明確程式碼證據；舊開發名稱／路徑已獨立實測。** 由 `1f89403` 引入；未將內部識別碼不改名列為缺陷。

### A10 — P2：安裝包未包含內嵌素材與預設資料的第三方授權聲明

**位置：** `package.json:43`、`package.json:46`；`THIRD_PARTY_NOTICES.md:3`、`THIRD_PARTY_NOTICES.md:32`、`THIRD_PARTY_NOTICES.md:60`；`src/ui/marks.ts:1`。

**現象：** repo 有授權文字，但 build.files 只包含 dist、dist-desktop、package.json。實際本輪新建 asar 有 736 entries，沒有 `THIRD_PARTY_NOTICES.md` 或 LobeHub／Lucide／cc-switch 的 notices；Resources 也沒有額外 notice 檔。renderer bundle 含 SVG，但相應版權字串不存在。這些素材不是執行期依賴，不能靠自動包含 node_modules 的 LICENSE 補足。

**重現：** `npm run package` 後執行 `node docs/review-sol-high/inspect-package.cjs`；見 `package-contents.log`。讀的是工作區新建 artifact，未讀 `/Applications`。

**預期 vs 實際：** source 中採用的 MIT/ISC 文字要求把版權與許可聲明保留在相應副本／分發；實際安裝包只含轉換後的素材與程式，缺少這些隨包聲明。此處是可驗證的交付缺漏，不是對商標權或授權爭議做法律結論。

**影響：** 發布 dmg 的收件者拿不到 repo 所列聲明；尤其 Lucide license 的 Feather MIT 段落也沒有隨包交付。

**修正方向：** 明確把第三方聲明加入 package files 或 extraResources，並對發布 artifact 驗證其存在與內容；保留 font 的授權／copyright 資訊。可提供 UI 開啟聲明，但不必為修此缺漏改動 CSP。

**確信程度：已獨立重現於本輪產物。** `99e1417` 加入 cc-switch notices，`1f89403` 加入圖示／字體，而 package whitelist 未擴充。

### A11 — P3：文件的數值與部分行為宣稱比實作更強

**位置：** `docs/TECHNICAL_DESIGN.md:396`、`docs/TECHNICAL_DESIGN.md:398`、`docs/TECHNICAL_DESIGN.md:438`；`README.md:48`；`src/ui/styles.css:18`、`src/ui/styles.css:19`、`src/ui/styles.css:74`、`src/ui/styles.css:89`；`src/core/manager.ts:336`。

**現象與重現：** `node docs/review-sol-high/measure-design.cjs` 計算實際 CSS 色碼。不是主觀美感評語，也沒有把 disabled opacity 算成一般文字：

| 文件宣稱 | 實際結果 |
| --- | --- |
| 淺色文字全部 ≥5.2:1 | 警告字 `#9a5b00` / `#fff7e6` 為 **5.090:1**；`.error` 字 `#c7363b` / `#fdeeee` 為 **4.638:1**。兩者仍高於一般 4.5:1 門檻，但不符合文件的 5.2 保證。 |
| 深色文字全部 ≥6.3:1 | 一般 secondary、警告、錯誤等抽查組合符合；字母 tile 的實際 color-mix 為 **3.891–4.273:1**。tile 是 aria-hidden 且有相鄰名稱，沒有把它冒稱成必要辨識文字的 WCAG 違規。 |
| 字級只有 11/12/13/17/22 | CSS（含 font shorthand）還有 **14/15/18/20**；14/15 實際用於文字首字 tile，18/20 多為 SVG 尺寸。 |
| README：讀取後檔案被其他程式修改就拒絕全局保存 | 實際 base 只比全局 canonical，不含 provider 部分，也不區分排版；供應商欄位或純排版變動不使 base 不符。保留最新 provider 欄位是合理實作，應改文案。 |
| 技術設計：Claude 雲平台路由在預覽作為錯誤提示 | `patchProvider` 清理雲開關，只有 `apiKeyHelper` 會 throw；不能把 import 的拒絕規則當成 configView 的錯誤規則。 |

**預期 vs 實際：** 數字與邊界描述應吻合最小值和實際摘要範圍；目前描述超出已做的保證。1140 px 的對齊宣稱則**已通過**，toolbar/section/tile x 均為 **272 px**，沒有列為問題。

**影響：** 文件會使維護者誤認樣式與衝突保護的範圍，或錯判預覽應如何回應。

**修正方向：** 修正色彩以符合數值保證，或把保證限定到實際角色；區別文字字級與 icon size。README 應寫「全局設定的語意被修改」；預覽／匯入的拒絕行為分開描述。

**確信程度：數值已獨立計算，行為有明確程式碼證據。** 主要由 `1f89403` 文件／設計系統引入。`design.log` 的公式為 sRGB 線性化後相對亮度比，color-mix 使用 CSS 宣告的 srgb 加權。

### A12 — P3：網域結尾的根點使合法供應商 URL 無法自動識別

**位置：** `src/ui/vendor.ts:18`、`src/ui/vendor.ts:19`；`tests/vendor.test.ts:7`、`tests/vendor.test.ts:23`。

**現象：** `https://API.DEEPSEEK.COM:443` 正確回 `deepseek`，但 `https://api.deepseek.com.` 的 URL hostname 保留結尾點，字串比對回 null，顯示名稱首字。這是識別落空，不是把仿冒域名認成廠商。

**重現：** `reproduce-core.mts` 的 `vendor-and-url-units`。同時確認 `deepseek.com.evil.example`、`evil-deepseek.com`、IP 及不相同的 punycode 網域均回 null。

**預期 vs 實際：** 同一 DNS 主機的大小寫、port 與結尾根點應得到同樣廠商；目前只有前兩者正確。現有「每個 preset endpoint」測試確實逐一遍歷，但預設 URL 沒有結尾點，不能覆蓋本案。

**影響：** 使用完整根網域寫法的自訂供應商失去自動標誌，連線／Key 行為沒有因此錯誤，故只列 P3。

**修正方向：** hostname 正規化時移除單一結尾根點，再保留現有完整 domain/subdomain 邊界比對；補正反例，不能改成 contains 比對。

**確信程度：已獨立重現於正常單元函式。** 由 `1f89403` 引入。

## 已確認沒問題的檢查點

六條安全不變量的逐條結果：

| 不變量 | 結果 |
| --- | --- |
| 1. renderer 不取得已保存 Key | **部分不成立，A2**。snapshot 的 apiKey、fingerprint、definition、byte hashes 剝除成立；普通 Claude/custom Codex 預覽佔位成立。不能把這些通過延伸成所有讀 API 都通過。 |
| 2. 靜態安全錯誤 | 原始 JSON/TOML/Zod／HTTP body 不回顯；正常輸入驗證與 parser 錯誤斷言通過。PublicError 有檔名、行數、固定欄位名、HTTP status 等受控參數；saveGlobal 按需求列出受管欄位名，沒有列出欄位值。本輪沒有發現 Key／原文值出現在錯誤中。 |
| 3. IPC 来源限制 | main.ts 同時核對目前視窗 webContents、mainFrame identity 與固定 pathToFileURL href。獨立桌面第二視窗／非 main frame 拒絕；URL equality 有程式碼證據。 |
| 4. CSP／外部資源 | CSP 的 default-src/style-src 均為 self；其餘限制更明確，img 另允許 data。marks 全檔掃描沒有 style、script、事件屬性或 href/src；dangerouslySetInnerHTML 的 caller 都使用 marks 常數。使用者文字／設定文字走 React text。沒有必要把 index.html 額外 CSP directives 當缺陷。 |
| 5. 備份／交易 | 目標 activate/saveGlobal/restore 全部走 transaction；選中的 backup 重新讀取驗證，去重候選也重新驗證。Pi 第二檔失敗與 Hub 最後寫入失敗的既有測試通過，補充保存失敗精確回滾、pending 封鎖通過。A3 是成功交易寫出錯誤語意；A4 是 Hub writer 缺口，不是重現目標半段 JSON。非合作外部變更衝突仍保留 journal，不承諾多檔 OS 原子提交。 |
| 6. 顯示欄位不套用 | rules=2 六種 app/mode 投影通過；icon 在 rules=1/2 均不進 definition、不寫目標。**舊 rules=1 的 Codex login name 不成立，A6**。Codex API name 確實是寫入欄位，沒有當缺陷。 |

其他已驗證範圍：

- **Sol R1/R2：修正有效。** 在原 rename/stat 線索的受控改寫下，損壞備份被警告，下次切換重新補寫完整 before，cold/warm Manager 一致；排序優先 sequence，新交易 backup 不會被 prune。retention=1、10 與沒有 sequence、未來 createdAt 的舊備份組合均通過。新測試確實補上冷／暖／失效以及超過保留數的不同狀態，沒有重複舊 R5 的「只測暖快取」或「沒真的淘汰」指控。
- **Sol R3/R4：新規則正確、升級不誤報。** 真實 `722c119` Claude 的 fable／舊 small-fast 遺留，現版 bytes 未變仍 written、edited=false。舊 rule definition 的顯示改名例外見 A6。R6 的降級讀取拒絕維持只讀保護，技術設計有寫明；新 icon 亦使舊 strict Schema 拒絕，沒有靜默覆寫 Hub。
- **importLive：** 無參數時只處理沒有 Provider 且未 imported 的 app，pending 時只返回 snapshot；目標只讀，所有 after 指紋等於 originals 才標 active。既有真實格式三款 import fixture、Claude 四別名與拒絕動態鑑權測試通過。`env_key` **單獨**存在時拒絕；同時有字面 bearer 時實作仍會接受，補充單元已確認，不宣稱已拒絕所有含 env_key 的情形，也不推定實際 CLI 優先級。
- **路由／推理：** 四個 Claude ANTHROPIC_DEFAULT 路由與舊 SMALL_FAST 在切換時先清再寫；容器 haiku 主請求匹配。Codex effort 沒設定時保留原檔值，改變它本來不進 managed fingerprint。這是文件與測試明載的單次預設語意，沒有把它回報為隨機路由；使用者清空選項不代表清除檔案原值。
- **listModels：** HTTPS／loopback HTTP、帳密/query/fragment 拒絕的靜態單元通過，IPv6 localhost 在 allowlist；redirect 不跟隨、Content-Length 與 streamed 超限、10 秒單次 timeout 本機動態通過。錯誤不回 body，401/403 終止。多候選各有自己的 10 秒，整體可能更久；沒有測真實代理或 TLS 供應商。
- **全局：** 受管 model／Claude env／custom 表與 Pi selection 在正常 object 情況被分離；受管欄位輸入拒絕，不同 base 不寫，canonical 相同 no-op 保留 inode，正常自身寫入更新 active byte hash（既有單元通過）。BOM/CRLF no-op 保留原 bytes，JSON duplicate key 按 JSON.parse 最後值，TOML duplicate key 靜態錯誤，深層 10,000 層在 clone 失敗時不寫入；不宣稱接受所有深度與大小輸入。
- **保存：** 使用中供應商的真正寫入欄位改變會套用；中途失敗 Provider 已保存、目標回滾、SAVED_NOT_APPLIED 保留，snapshot edited=true。已有 pending 時 save 在寫 Hub 前拒絕；新增就套用失敗時只新增一次且原目標不變。編輯用 map 保持位置，新建放最後。巨型 Hub 例外見 A4。
- **外部連結／UI：** 精確 presetLinks 白名單只呼叫系統瀏覽器，其他新窗 deny；will-navigate 無條件 preventDefault。補充測試攔截 shell，不真正開啟外部站點。預設換頁的 Key/notes、API→login→API 草稿保留由真實既有 smoke 通過；presets 名稱替換有程式碼白名單條件。側欄 aria-current、篩選／圖示 aria-pressed、卡片動作 aria-label 正確；對話框焦點在取消、Esc 關閉獨立通過。
- **布局／選單：** 合法 100 字名稱、2000 字 notes、長 URL/model 的主畫面與 840 px/200% 既有 smoke 通過。本輪另測全局 420 px CSS viewport：document/page/toolbar 均 420、tab right=404、footer 可見；**沒有沿用 Astra 的全局溢出線索當缺陷**。1140 對齊三者 x=272。沒有 active 時 menu 的兩個 radio 都未勾選；一般切換與 pending 停用 code 正確。macOS 關閉所有窗口後，tray 可重新建窗口；單實例鎖在固定同一 userData 路徑有明確 code。不同版本同時執行的實際情境仍未測。
- **素材：** Fontsource 5.3.1 tarball 的 woff2 與 repo 完全一致，122,360 bytes，SHA-256 `f2ea9c12d2fe9bd3a9589b02ad2c0909da88f30938c91adc838c4f4098f9f9e0`。Lucide 1.55.0 的 license（含 Feather 段落）與 repo 忽略空白比對相同。repo 唯一字體檔為上述 Source Serif 4，沒有發現 Anthropic Sans／Serif 檔案或字型引用。尚不能把來源聲明可見直接等同 artifact 完整隨包交付，A10 已實測其缺漏。

## 待確認與假設／限制

- 平台為 macOS arm64；沒有 Windows/Linux GUI、大小寫敏感 APFS 卷、跨版本已安裝 App 同時執行、真實 OAuth／Keychain 登錄、真實供應商、真實系統代理聯調。這些不給推測嚴重度；A9 只針對可確定的 spelling 與未遷移程式碼，沒有宣稱所有舊打包版都丟資料／出兩個圖示。
- A5/A8 與快取排程重現是受控 interleaving；不等於自然壓測成功。快取版本鍵 dev/ino/size/mtime/ctime 未在 Windows 或粗時間 filesystem 實測。非合作 CLI 在比較與 rename 間改檔、或在多檔提交間讀取，是已記錄的設計邊界。
- 遵照使用者限制，特殊鍵名／異常 URL 只有靜態分析與正常單元斷言，沒有寫攻擊、利用或遠端導航程式。A7 的實際 renderer crash 沒有沿用為本輪動態重現。
- 沒有實際觸發 Claude 真正背景工作；7/7 中 haiku 是主對話 alias。Pi openai-responses 的真實 CLI 容器案例仍缺少；已列待辦，不重複當新嚴重缺陷。
- 素材核對使用離線 npm cache。LobeHub npm tarball 沒附 LICENSE，只有 package metadata 的 MIT；cc-switch 沒有本輪獨立取得原始 repository license，故沒有宣稱兩者 copyright 已與最新上游完整比對。Fontsource tarball LICENSE 開頭是 `Google Inc.`，repo 的 font 段落是 Source Serif Project authors；OFL 主體有提供，但本輪沒有獨立解析 woff2 的 name table，也未完成作者聲明來源追溯，這點留待確認，不以單純字串不相同判成侵權。
- 使用 [web-design-guidelines skill](/Users/cat/.agents/skills/web-design-guidelines/SKILL.md) 作離線介面審查框架；其要求「Fetch fresh guidelines before each review」，但本輪使用者限定測試網路只連本機 mock，因此未抓取最新遠端 guideline。沒有宣稱符合最新上游完整規範。無障礙檢查有原生鍵盤／DOM evidence，沒有完整 VoiceOver 流程；表單 aria-invalid／aria-describedby 的既有缺口在 REMAINING_WORK 已列，不重複成新發現。
- 既有 README/設計的 Key 不回 renderer、Hub 大小保證、顯示改名與自動同步宣稱，分別已在 A2/A4/A6/A8 指出，不再重複計數。`REMAINING_WORK` 的「前三輪 P1/P2 都修好」不能涵蓋 A6 的舊 rules 邊界。上述與程式不符處均以實際結果為準。

## 逐 commit 結果

| Commit | 獨立審查結果 |
| --- | --- |
| `4eee062` | R1 快取／候選重新校驗、R2 sequence／prune 獨立回歸通過；R5 冷快取與真正保留數測試已補，沒有重現新備份遺失。 |
| `b7538a2` | rules=2 投影及真實舊記錄升級通過；舊 rules=1 Codex login 名稱仍過度納入，A6。 |
| `ae59b54` | active hash 不回 renderer、讀取失敗原因／重新成功清除 loadFailed 正確；沒有發現該改動新缺陷。 |
| `aa218a9` | 純報告／文件；降級邊界已記錄。後來文件「R3 已完全修正」需考慮 A6，沒有給文檔重複編號。 |
| `80d0cd8` | release/dmg/ad-hoc 建置本輪通過，未安裝；package files whitelist 未隨後新增素材擴充，最終交付缺漏見 A10。 |
| `360dfd8` | 正常 import、once marker、read-only／等指紋才 active 通過。非 custom literal route 的保存 Key 與後續讀 API 組合造成 A2；新增 Hub writer 也有 A4 上限缺口。 |
| `a1689e3` | 四別名清理與 effort 保留語意通過；沒有把保留未指定 effort 當缺陷。真實背景工作動態仍是既有測試限制。 |
| `3200d3b` | URL/redirect/10 秒/4 MiB/靜態 HTTP 錯誤通過；保存 Key 未綁定保存端點，A1。 |
| `99e1417` | 19 presets 的 Schema、protocol、link 與每個 endpoint vendor 覆蓋通過；預設換選保留 Key/notes 的真實 smoke 通過。隨包聲明見 A10。 |
| `b28242a` | config preview／split 引入 A2 的非 custom Key 殘留與 A3 的日期型別遺失；其他 JSON/TOML 基本往返與靜態解析訊息通過。 |
| `ad4c0dd` | 作為中間 UI 改版已由最終頁面 smoke 覆蓋；沒有找到可歸因於此 commit 且仍存在的獨立新缺陷，避免把後來整頁／全局功能錯歸此版。 |
| `1f89403` | 保存／全局／焦點重讀／tray／圖示／改名的正常流程通過；全局 race A5、舊 definition 自動套用 A6、圖示 lookup A7、busy 同步 A8、舊路徑 A9、隨包授權 A10、數值文件 A11、hostname 根點 A12；繼承的 core 風險 A1–A4 仍存在。 |
