# MiSwitch 第三輪獨立審核（SOL）

審核日期：2026-10-12（Asia/Taipei）。審核分支：`main`；基準區間：`37e2673..722c119`，共 5 個 commit；實際 HEAD：`722c1190a43affc6b0af4cb8209255b8d50804c7`。開始時工作區乾淨。已先讀技術設計、待辦清單與第二輪報告。本輪只新增本報告及 `docs/review-sol/` 腳本，沒有修改 `src/`、`tests/`、`scripts/`；桌面 smoke 產生的 `docs/desktop-preview.png` 已還原。

| 驗證 | 結果 |
| --- | --- |
| `npm run typecheck` | 通過 |
| `npm test` | **31/31 通過** |
| `npm run test:desktop` | 通過；實際 Electron/main/preload/React，含小型模型、草稿、edited 徽章、長文字、200% 縮放、啟用與恢復；測試故意提交 HTTP 非本機 URL 時出現的 IPC 錯誤是預期驗證 |
| `docker info` | 已有可用 Colima Docker，無須啟動或更改設定 |
| `npm run test:container` | **7/7 通過**，各案例 exit 0、無 timeout；固定 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1 |
| 補充 core 腳本 | 通過所有重現斷言：definition 誤報、真實舊版升級誤報、時間戳相同時誤刪新備份、降級拒絕；另驗證快取失效、異常檔案、去重候選刪除／損壞與失敗回滾 |
| 補充快取競態腳本 | 在檔案系統邊界受控排程下重現「舊摘要綁到新版本」及後續略過必要備份；沒有宣稱自然競態壓測成功 |
| 補充 Electron 腳本 | 重現 Codex 登入配置改名誤報；確認重複 ID 啟動失敗、原因被泛化，以及人工修復後刷新仍殘留失敗狀態 |
| 補充 Claude 容器探針 | 真實 2.1.296：保留 `ANTHROPIC_DEFAULT_MODEL` 不覆蓋所寫主模型；`--model haiku` 送出小型模型 ID；另核對實際 executable 內的背景模型解析程式，**未實際觸發背景工作** |

結論：**常規流程全部通過，但有 1 個本輪新增的 P1、2 個新增 P2；另有本次指定檢查重現的既有 P1 時間排序問題，應先修備份安全性，再修 edited 與升級判定。** 下列 P3 是測試／相容性缺口；重複 ID 的拒絕本身是正確防護，不建議恢復舊版默默接受的行為。

## 重現方式及隔離範圍

```bash
./node_modules/.bin/tsx docs/review-sol/reproduce-core.mts
./node_modules/.bin/tsx docs/review-sol/reproduce-cache-race.mts
npm run build
./node_modules/.bin/electron docs/review-sol/reproduce-desktop.cjs

# 使用 npm run test:container 建好的固定版本 image。
# 唯一 host mount 是審核腳本目錄，而且唯讀；不掛載本機 HOME。
docker run --rm \
  --mount type=bind,source="$PWD/docs/review-sol",target=/app/docs/review-sol,readonly \
  --entrypoint /app/node_modules/.bin/tsx \
  miswitch-cli-test /app/docs/review-sol/claude-model-probes.mts
```

所有檔案案例都由 `mkdtemp()` 建立 OS 臨時目錄，使用明確傳給 `resolvePaths()` 的隔離 home 與空環境覆蓋。Electron 使用專案既有 `MISWITCH_SANDBOX_ROOT`；真實 Claude 探針另將 CLI 子程序的 HOME 設為容器內臨時 home，cwd 也位於臨時目錄。只使用合成密鑰與 localhost mock，不讀寫本機 `~/.claude`、`~/.codex`、`~/.pi`，不使用真實 API Key。腳本在 finally／結束函式清理臨時資料；外部強制 SIGKILL 仍可能留下合成臨時資料。

core 腳本用 `git show 37e2673:src/core/...` 將**實際基準程式碼**放在 OS 臨時目錄，再共用倉庫依賴，驗證升級／降級；沒有手寫近似舊版實作。競態脚本以 `fs.promises.lstat` 加上 `syncBuiltinESMExports()` 控制一次 interleaving，最後還原；它沒有改寫 Manager 私有方法，也沒有修改倉庫程式檔。這是受控競態重現，不能用來估計發生頻率。

## 問題（依嚴重度）

### R1 — P1：新備份的快取可把舊摘要綁到被覆寫後的版本，後續誤略過必要備份

定位：`src/core/manager.ts:133`、`src/core/manager.ts:135`、`src/core/manager.ts:136`、`src/core/manager.ts:137`、`src/core/manager.ts:189`。由 `ca56323` 新增。

**觸發條件：** `atomicWrite()` 完成備份的 rename 後、`fileVersion()` 取得 lstat 前，非合作的外部寫入者改寫或破壞該備份。這可能是人工操作或其他直接操作 store 的程式；同一 store 的另一個正常 MiSwitch Manager 受 Hub 鎖序列化，不能直接造成這個 interleaving。

**實際結果：** line 137 仍使用記憶體中的 `info/digest`，卻將它綁到 line 136 取得的**改寫後版本**。此後版本相符，`backups()` 不再解析檔案；損壞檔案被列為正常備份、沒有警告。下一筆交易的 before 與舊摘要相同時，line 133 略過新備份，即使實際候選已不能恢復該狀態。重新啟動或新建 Manager 才發現損壞，已錯過切換前狀態。

已重現：先寫 A，再於隔離 Hub／目標同步一個新合成 Key，使重寫 A 的目標內容不變。在新備份寫出後上述邊界破壞它。原 Manager 顯示 **2 份正常備份、0 警告**；切 B 時仍只有 2 份，沒有補寫；新 Manager 只看見 **1 份有效備份、1 個警告**。恢復舊快取列出的 ID 被即時回讀拒絕。再依正常規則刪除已非當前的 A 後，新 Key 不在 Hub、目標或任何有效備份的 before／after 中，已失去恢復來源。

**預期結果：** 用於去重的 digest 必須對應已驗證的那個檔案版本；候選損壞時必須補寫本次 before 備份。

**重現：已重現，受控檔案系統排程。** `docs/review-sol/reproduce-cache-race.mts`。没有重現自然發生頻率，也没有將正常 MiSwitch 互鎖操作誤列為競爭來源。

**最小修正建議：** 不要在新檔寫出後以「稍後 stat + 舊記憶體 metadata」直接種入快取。讓列表從該檔實際解析 metadata，並在解析前後確認版本一致，不一致則重試或不快取。去重前再驗證唯一候選的可讀性及 digest，成本是讀一份候選而不是全部歷史。最好將內容與版本由同一開啟的檔案 handle 取得，並核對路徑在讀取後仍指向同版本。這仍不能阻止任何人在最後檢查後刪除檔案，但能消除本案的持續錯綁與錯誤略過。

### R2 — P1：同 createdAt 的保留排序會立即刪除剛寫出的備份，切換前狀態消失

定位：`src/core/manager.ts:121`、`src/core/manager.ts:133`、`src/core/manager.ts:196`、`src/core/manager.ts:201`。**排序及 prune 問題在 `37e2673` 已存在；不是 ca56323 首次引入。** 本輪新增去重又將同一排序的第一筆視為「最新」，因此本次指定檢查必須保留這項結果。

**觸發條件：** 備份 `createdAt` 相同，tie 落在保留數截止處。日期只有毫秒；相同時 line 196 的 comparator 回傳 0，保留 `readdir()` 的原次序，而 UUID 檔名不代表交易次序。時鐘回撥也有類似風險。本輪用固定 Date 建立等時情境，沒有宣稱普通 APFS I/O 已自然在 1ms 內完成多筆交易。

**實際結果：** 新備份可以排在保留額度之外，被本次交易自己的 prune 立即刪除。交易仍回傳成功，pending 已移除，目標的旧模型／合成 Key 已被替換；有效備份也没有該 Key。去重對「最新」的選擇在 tie 下同樣没有可靠交易順序，可能選到非最後一筆，造成多寫與錯誤保留。

腳本在 retention **1 和預設 10** 都已重現：先放滿合法且同時間的舊備份，使用低 UUID 使本機目錄列舉順序明確可觀察；固定本次交易 Date 為相同時間。activate 成功後，保留份數正確，卻只留下舊備份；新備份及唯一的切換前合成 Key 均不在有效保存內容中。這是有控制的邊界案例，不是時序碰運氣測試。

**預期結果：** 最新完成交易的安全備份應在保留範圍內，不應因顯示用時間相同而立即被刪除。

**重現：已重現，固定時鐘及合法存檔 fixture。** `docs/review-sol/reproduce-core.mts`（輸出 `R2 equal timestamp prune`）。

**最小修正建議：** 先保護本次剛新增的備份 ID，prune 不得把它作為淘汰候選；為列表／去重加入可持久化的交易次序，例如 Hub 鎖內遞增序號及舊檔相容 fallback。只加 UUID 字典排序能使結果固定，却不能證明何者更新；只提高時間精度也不能處理時鐘回撥。驗收時讓不同 before 狀態超過保留額度，並斷言保留的**內容與次序**，不只看份數。

### R3 — P2：providerDefinition 是大部分 Provider 的 hash，並非各 adapter 真正写入的欄位投影

定位：`src/core/adapters.ts:43`、`src/core/adapters.ts:45`，對照 `src/core/adapters.ts:55`、`src/core/adapters.ts:58`、`src/core/adapters.ts:86`、`src/core/adapters.ts:91`、`src/core/adapters.ts:104`；呈現於 `src/core/manager.ts:225`、`src/ui/App.tsx:67`、`src/ui/App.tsx:128`。由 `835bf75` 新增。

**觸發條件：** 修改當前 Provider 在該 app／mode 下沒有被 patch 讀取的欄位。函式只排除 notes、updatedAt 和非 Codex 的 name，剩下的欄位全部進 hash。

| 分支 | 目前也納入 definition、但不改變 patch 輸出的例子 |
| --- | --- |
| Claude API | `loginProvider`、`protocol`（合法 API 值固定為 Anthropic；patch 不讀） |
| Claude login | `baseUrl`、`apiKey`、`claudeAuth`、`protocol`、`loginProvider` |
| Codex API | `id`、`claudeAuth`、`loginProvider`、`protocol`（API 合法值固定為 Responses） |
| Codex login | 上述欄位，以及 `name`、`baseUrl`、`apiKey`；login 分支只清 token，不把本 Provider 名稱／端點寫入 dormant custom 表 |
| Pi API | `claudeAuth`、`loginProvider` |
| Pi login | `baseUrl`、`apiKey`、`protocol`、`claudeAuth`、`id`（使用的是 loginProvider） |

表中的 id 通常不可透過 save 改動，因此不是一般 UI 觸發點；它說明 definition 與欄位投影不一致。**沒有找到 patch 所用可編輯 Provider 欄位被漏算而漏報的案例；本案是過度納入造成誤報。**

**實際結果：** snapshot `edited=true`、顯示待重新寫入，即使 `patchProvider(before)` 與 `patchProvider(after)` 完整輸出完全相同。四個 core 例子已逐一比較原始輸出：Claude API 改 loginProvider、Codex API 改 claudeAuth、Codex login 改 name、Pi API 改 loginProvider。

最直接的正常 GUI 觸發：啟用 Codex **登入模式**後只改名稱。真實 Electron 顯示「已編輯，待重新寫入」，保存提示說目標仍使用編輯前設定；實際 `config.toml` 裡既沒有舊名稱，也沒有新名稱。API Codex 改名則確實改 custom.name，應計入，現有正向測試沒有区分這兩種 mode。

**預期結果：** 僅會影響此 app／mode 寫出內容的 Provider 欄位改變才算 edited。只改 Codex login 的顯示名稱應與只改 Claude 名稱或 notes 一樣。

**重現：已重現。** `docs/review-sol/reproduce-core.mts` 的四個 `R3 false edited`，以及 `docs/review-sol/reproduce-desktop.cjs` 的 Codex login 改名。

**最小修正建議：** 按 app／mode 建立明確白名單投影：Claude 共用 model，API 再加 baseUrl、apiKey、claudeAuth、smallFastModel；Codex 共用 model／兩個 context 欄位，API 再加 name、baseUrl、apiKey；Pi 共用 model，API 加 namespace ID、baseUrl、protocol、apiKey，login 加 loginProvider。app／mode 作為分支標記。改投影時同時處理已寫出的 definition 版本，避免再次以新 hash 演算法誤判所有舊記錄；更理想是由 adapter 共用「Provider 寫入定義」來源，免得兩份欄位清單分歧。

### R4 — P2：新增 Claude 指紋欄位後，未變動的舊版設定被報成外部修改

定位：`src/core/adapters.ts:39`、`src/core/adapters.ts:130`、`src/core/manager.ts:218`、`src/core/manager.ts:221`、`src/core/manager.ts:230`。由 `7090784` 新增受管鍵觸發。

**觸發條件：** 舊版 `37e2673` 啟用 Claude 時，settings.env 已有 `ANTHROPIC_SMALL_FAST_MODEL` 或 `ANTHROPIC_DEFAULT_FABLE_MODEL`。舊版會保留它們，而且 fingerprint 不含這兩個鍵。升級後沒有改動檔案，新 fingerprint 卻納入它們。

**實際結果：** 舊 Manager 的 state 是 written，新 Manager 是 drift；目標原文仍逐字相同，hashes 也仍相同。UI 宣稱「管理字段已被外部修改」，使用者可能無端再次啟用並刪除原有路由。既有無 fingerprint 的 byte fallback 不適用，因為這批記錄**已有舊演算法 fingerprint**。

**預期結果：** 升級造成的受管欄位範圍變化應呈現為「舊版本記錄／路由待遷移」，而非外部修改；沒有這兩鍵的舊檔不受影響。

**重現：已重現。** `docs/review-sol/reproduce-core.mts` 用實際 `37e2673` Manager 建立 active 與目標，再用現版 snapshot 比較（`R4 unchanged upgrade`）。

**最小修正建議：** 為 fingerprint 演算法加版本；未知舊版本先使用原文 hashes 確認，原文一致時保持 written 並提示重新啟用後套用新的路由清理規則。原文不一致時可用舊欄位集合比較，不能一律忽略差異。新清理規則本身合理，應保留；要修的是升級診斷與遷移。

### R5 — P3：新測試沒有驗證冷快取、去重後真實淘汰或背景工作，部分斷言依賴毫秒排序

定位：`tests/manager.test.ts:241`、`tests/manager.test.ts:252`、`tests/manager.test.ts:256`、`tests/manager.test.ts:263`、`tests/manager.test.ts:270`、`tests/container/run.ts:30`、`tests/container/run.ts:33`。

**觸發條件及實際結果：**

- `listing backups parses each file once` 在 activate 已把 metadata 放進快取後才 monkeypatch 私有 `readArchive`，只斷言暖快取零次讀取；未測冷啟動是否每版只讀一次，也未測改寫、rename、删除、非普通檔案或別的 Manager prune。私有方法改名就使測試脆弱，且新備份快取種入根本不走 readArchive，因此漏掉 R1。
- retention=2 的測試反覆啟用同一 Claude Provider。去重後最多只有「不存在」與「已寫出」兩種 before，始終不超過 2；它已不再真正執行 Claude 的淘汰，卻仍名為 per-app retention。
- 去重測試及其他舊測試使用 `backups[0]`／`backups[1]` 作最新／較舊，只有 createdAt 毫秒排序。一般本輪測試通過，但同時間 fixture 會暴露 R2；也會讓某些依 index 選備份的測試依執行時序而變化。**沒有重現既有 npm test 自然間歇失敗。**
- 新容器案例 `--model haiku` 的 matching request 是**主對話**。它證明別名映射、密鑰、端點與退出成功，並未觸發或斷言任何真正背景功能。官方文件及實際 2.1.296 executable 都支持小型欄位用於背景 helper，但这不是現有容器測試的動態覆蓋。

**預期結果：** 測試應分別驗證 cold/warm/invalidation、真的超過保留額度且内容正確、同時間次序，以及至少一種可觀察的背景 helper 请求，或明確縮小測試描述。

**重現／證據：** 靜態檢查確認上述覆蓋缺口；R1／R2 的對應缺陷已由兩個 core 腳本重現。`docs/review-sol/claude-model-probes.mts` 另確認 haiku 主請求並標明 `liveBackgroundTaskVerified:false`。背景動態缺口本輪未補齊。

**最小修正建議：** 冷／暖兩個 Manager 分別檢查檔案內容與列表結果；採受支持的 I/O 注入邊界或外部可觀察行為取代 any/private patch。用至少 retention+1 個不同 before 驗證逐應用保留內容；以可控制 clock／sequence 建立 tie，不用 sleep 避開。背景案例應有來源辨識，不能把又一個 `--model haiku` 主請求當背景。既有 7/7 的 exit 0／無 timeout 標準應保留。

### R6 — P3：smallFastModel 保持 Hub version 1，降級只能得到通用讀取失敗

定位：`src/core/types.ts:16`、`src/core/types.ts:21`、`src/core/manager.ts:42`、`src/core/manager.ts:45`、`src/ui/App.tsx:86`；技術設計的 Hub version／smallFastModel 說明。

**觸發條件：** 現版保存含 smallFastModel 的 Provider，之後以 `37e2673` 或其他不認識該欄位的舊版打開同一 store。

**實際結果：** 舊版 strict provider schema 拒絕新欄位，即使 Hub version 仍為 1。拒絕發生在讀取階段，沒有覆寫或丟掉新資料；但 UI 只能顯示通用讀取失敗。新 active.definition 本身不是主要阻礙，舊 active record 校驗允許附加欄位。

**預期結果：** 應明確宣告 store 的降級界線，並提供完整 Hub 備份／安全移除可選欄位後降級的步驟，讓使用者知道不是權限或配置檔損壞。不建議讓舊版靜默丟掉未知 Provider 欄位。

**重現：已重現。** `docs/review-sol/reproduce-core.mts` 將現版 Hub 交給真實 `37e2673` Manager，snapshot 被拒絕。

**最小修正建議：** 至少在升級／降級文件記錄「寫入 smallFastModel 後舊版不可直接開啟」，備份完整 Hub 後才移除此欄位。正式版本引入 schema/feature 版本及遷移策略；單純將 version 改為 2 也不能讓已發布舊版給出新文案，只能讓未來版本辨識得更清楚。原型階段此項列 P3，沒有提升成資料遺失問題。

## 重複 ID 拒絕與修復體驗的評估

定位：`src/core/manager.ts:48`、`src/core/manager.ts:283`、`src/core/manager.ts:261`、`src/ui/App.tsx:86`、`src/ui/App.tsx:92`、`src/ui/App.tsx:104`。

`3241a9c` 的拒絕較舊行為安全：舊 activate 使用 find 取第一個同 ID Provider；save 則 filter 掉全部同 ID 再只寫回一個，可能靜默丟掉另一筆；React 也使用重複 key。不能以「仍可操作」當作應保留這種歧義的理由。因此**不把拒絕本身列成缺陷，也不建議自動取第一個或默默重新配號。**

可用性確實下降：重複 ID 使整份 snapshot 失敗，沒有 Provider 卡片、沒有歷史備份列表、添加停用，valid backup 的 restore 也要讀 Hub 而被拒絕。這是「Hub 結構損壞沒有安全修復畫面」的 P3 改善點，而不是改回 fail-open 的理由。啟動 catch 還將已存在的安全靜態訊息「Hub 包含重复的配置 ID」變成「請檢查配置文件與目錄權限」，導向錯誤排查。

已重現：`docs/review-sol/reproduce-core.mts` 證明 snapshot 與有合法 ID 的 restore 都拒絕；`docs/review-sol/reproduce-desktop.cjs` 證明啟動時 cards=0、添加 disabled、看不到重複原因。腳本在臨時目錄人工修復 Hub 後，內建刷新成功讀回 cards=1、添加 enabled，但 status 仍為「無法讀取本地配置」，因為 `act()` 成功沒有清除 loadFailed。**這個旗標問題在基準版本已存在，本輪未把它冒充新回歸。**

建議：保留寫入封鎖，顯示具體的安全靜態原因、Hub 路徑與開啟資料夾／完整備份入口；設計只讀修復畫面，列出不含密鑰的衝突 metadata，由使用者確認保留或給新 ID，並明確處理 active 指向歧義。不能讓一般 save 順便消除另一筆。刷新成功需清除 loadFailed。正常 Manager save 的隨機 UUID 不會自行製造這種重複；本輪沒有發現本次程式在無外部 Hub 修改時产生重複 ID。

## 已確認的檢查點與邊界

### 備份版本鍵、跨程序與異常檔案

- 在本輪 macOS 檔案系統，實際使用 bigint stat 驗證同 size、**完全相同 mtimeNs** 的原地覆寫仍改變 ctimeNs，快取失效並重新解析；損壞檔案被跳過。此正向案例不需要修改 Manager 私有方法。
- 版本包含 dev、ino，正常 inode 更換會失效；刪除的名字在下次 readdir 被移出快取。原地改寫、正常 rename、另一個 Manager 的新增／prune 都不會只因記憶體快取而永遠看不到。補充腳本確認兩個 Manager 最後的列表一致。
- inode 重用本身不足以碰撞，還要 size、mtimeNs、ctimeNs 全部相同。**沒有重現此五元組自然碰撞。** 未在 Windows、粗時間精度檔案系統或特殊掛載實测，不能宣稱 dev/ino 在所有平台都足夠。這是版本啟發式，不能作內容真實性的唯一證明；可對未知檔案系統停用快取或至少在去重／恢复时回讀候選。Windows 發布測試仍屬既有待辦，沒有重複列新缺陷。
- 列表先 lstat 再讀，讀取期間更換檔案通常在下一輪重新解析，這部分注解方向合理；當次 metadata 沒有前後版本確認，仍有短暫 stale window。合作的 MiSwitch 使用同一 Hub 鎖，避免兩個正常交易／prune 交錯；非合作外部修改不受此鎖保護。**R1 的 after-write 種入尤其會把錯誤綁定永久保留到下一次檔案再變。**
- 符合備份檔名模式的 symlink、directory、FIFO 均在本輪被跳過／警告，沒有跟隨連結或阻塞讀 FIFO；其他檔名不進列表。這些測試只在隔離目錄內使用合成目標。快取 hit 不重新檢查 type；正常替換會改版本，未知平台仍須按上述限制評估。
- `prune()` 在成功 unlink 後删除該快取 entry；unlink 失敗則保留，下次掃描再判斷。同步目錄或 prune 的錯誤不將已完成交易變成失敗。除 R2 的排序問題外，没有重現協作操作下快取与 prune 不一致。

### 略過相同備份、恢復與回滾

- digest 包含**全部 entries 的絕對 path 及 before 原文**，排序後計算，區分 null／空字串／不同 bytes；忽略 after 是正確的，因為正常 restore 寫的是 before。也不需要備份 active 的歷史值，restore 的設計是清除 active。
- 正常 `A → A → A` 先保留「最初不存在」與「A 的輸出」兩種可恢復狀態，第三次略過相同 before；不是每次啟用完全不備份。
- 候選在**下一次交易掃描前**被刪除或損壞時，readdir／ctime 會使它不再成為有效去重候選，本次重新補寫。兩種情境均由補充腳本驗證。略過後有人手動删除唯一候選當然會消除該 restore 點；這與刪除新備份一樣屬外部刪除，不單独列缺陷。正常 prune 留下排序最新候選；等時／時鐘順序的例外見 R2。
- 即使略過備份，journal 仍包含完整 before/after。補充注入 Hub 寫入失敗，確認目標回復原 bytes、pending 清除、active 仍為 A，沒有因備份略過而失去交易回滾。既有 Pi 多檔失敗測試也通過。
- restore 會先備份当前狀態；如果現在 before 已有最新相同備份，略過重複副本不減少其恢復能力。恢復後清 active，且下一次 snapshot 不再有 edited。
- 舊 Codex 單檔集合有明確 whitelist；恢復只含 config.toml 的舊檔不改 auth.json。它的 digest 與現版 config+auth 集合不同，現版 activate 不會因此略過完整備份；單檔 restore 交易自己的備份仍是單檔，可被現有 whitelist 讀回。既有舊集合恢復測試已通過，没有把 Pi 任意部分集合放寬。
- selected restore 重新 readBackup 並验证內容／集合，不直接拿 metadata 寫目標。R1 中的損壞候選也被安全拒絕，沒有把损壞 JSON 寫入 CLI；缺陷是切換前沒有補寫安全備份。

### edited、hash 暴露及 UI 組合

- Provider 全部可編輯寫入欄位都在目前 definition 內，主要問題是 R3 過度納入。正常主模型、Key、端點、Claude 鑑權／小型模型、Codex context、Pi 協定／登入 Provider 的變化都會改 hash。notes 和 updatedAt 排除；Claude／Pi 顯示名稱排除正確；Codex 名稱只有 API 分支應計入。
- 新增 definition 是含 apiKey 的 SHA-256，會隨 active 回 renderer；它不是原文 Key。只要 Key 有足夠熵，未發現可直接還原或跨 renderer 泄漏原文的方式。**低熵 Key 存在離線猜測 oracle**：definition 的其他欄位／canonical 規則皆可知，攻擊者可測試候選 Key。既有 fingerprint 已是受管欄位含密鑰的 hash，也具有這類性質；definition 使輸入更容易構造，但不能合理稱為新明文密鑰外洩。IPС save 又已允许有权限 renderer 提交或猜測合成欄位。可將 definition/byte hashes 留在 main，只返回必要狀態，减少不需要的 verifier 暴露；不因使用者明確選擇的本機明文存儲另列 P1。
- 舊記錄第一次 save 在锁內先用 old Provider 補 definition，後生成新 Provider；在「舊版每次编辑會清 active」的正常版本演進假設下正確。目标 drift 不影響「写入时的定义」補寫；被外部直接修改 Hub 則不在此假設內，不能推斷真實寫入定義。未找到這項正常迁移的漏報。
- 编辑當前配置只動 Hub；active 保留、remove 拒絕删除，符合目标仍持有舊设置的設計。改回寫入值 edited 消失，重新启用清 edited，restore 清 active。正常新版／舊版補写的現有測試均通過。

| 組合 | 卡片／操作的檢查結果 |
| --- | --- |
| written、未 edited | 綠色「當前寫入」、重新寫入、刪除停用；正常 |
| written、edited | 「已編輯，待重新寫入」、狀態「已寫入編輯前的配置」、主按鈕重新寫入；正常，R3 的輸入誤報會傳到此處 |
| drift、未 edited | 「管理字段已變更」、啟用配置、漂移警告、刪除停用；與既有設計一致 |
| drift、edited | badge／主要狀態優先 drift，診斷另有 edited 警告；按鈕仍可啟用，沒有把編輯覆蓋宣稱為已生效 |
| restore 後 | active 刪除，edited false，配置可删除；恢復提示要求重新核對 |

表中 normal written／edited 與 restore 有真實桌面 smoke 證據；drift+edited 由 core 測試及 UI 分支審查確認，沒有宣稱每一格均做過獨立 GUI 自動化。編輯後卡片顯示的是 Hub 新值，狀態面板／保存提示已說明目標仍為舊值；没有另外列誤導問題。

### smallFastModel 與真實 Claude Code 2.1.296

- schema trim 後要求 1–200 字元；API 的純空白／空字串會被 core 拒絕。UI trim 後轉為 undefined，表示清除可選路由；這兩層行為合理且分工明確。非 Claude、login 模式帶值會拒絕。小型欄位保持掛載但 login 时 disabled，不进入 FormData；API→login→API 的草稿由桌面 smoke 確認。
- API 写 `ANTHROPIC_DEFAULT_HAIKU_MODEL`；省略值時不写並清掉舊值；haiku、舊 SMALL_FAST、FABLE 鍵均受清理及新指紋管理，常規測試通過。升級兼容例外見 R4。
- [Claude 官方模型配置文件](https://code.claude.com/docs/en/model-config) 說明 HAIKU 欄位用於 haiku 別名及背景功能，SMALL_FAST 是已弃用名稱。容器 2.1.296 的實際 executable 仍先讀 SMALL_FAST，然後其 helper 在已設定 HAIKU 時經 `iz()` 解析該路由；本輪 static 探針核對這段實作。擴大清理舊名稱可以避免它壓過新欄位，方向正確。
- **`ANTHROPIC_DEFAULT_MODEL` 不需要因本次小型欄位一律清除。** 官方將它列為較低優先級的 new-session default；MiSwitch API 同時写 model 與 ANTHROPIC_MODEL，login 也写 model。补充真實 CLI 探針保留 stale-default，普通 `claude -p` 仍请求 `review-main`，没有被 default 接管。可在其他外部优先级诊断中说明，但没有本輪必须清除此鍵的证据。依据同一[官方模型優先級文件](https://code.claude.com/docs/en/model-config)。
- **`CLAUDE_CODE_SUBAGENT_MODEL` 不能概括當成冲突鍵一律刪除。** 官方支持別名与完整模型 ID，並有 per-invocation／agent definition 的更高优先级；它不是所有子代理都只接受別名。保留 haiku 可跟隨本輪 HAIKU 映射，保留 full ID 則可固定用户选择，也可能指向網關沒有的舊 Provider 模型。既有設計已明確选择保留用户偏好，待辦也涵蓋 sonnet/opus 別名路由；本輪不重複列缺陷。建議在诊断发现此变量时提醒「明確指定的子代理模型可能不隨切換」，不要聲稱所有背景／子代理都受 smallFastModel 控制。依据[官方模型自訂說明](https://code.claude.com/docs/en/model-config)，并由 2.1.296 的 `jte()` 讀取實作佐證。
- 7/7 与补充 haiku 探针是对本機 mock 的路由證明，不能代表真實供應商／全部背景功能／不同登入方式的完整相容性。這些已知邊界沒有另行重複列問題。

## 逐 commit 結果與修正順序

| Commit | 審核結果 |
| --- | --- |
| `7090784` | smallFastModel 正常寫入、schema／UI／真实 haiku 路由通過；新增受管鍵有 R4 升級誤判；背景動態覆蓋不足見 R5，降級邊界見 R6 |
| `835bf75` | active 保留、正常 edited／改回／重寫、旧记录補写、remove/restore 組合正確；definition 投影有 R3 誤報 |
| `ca56323` | 常規版本快取、刪除／損壞失效、協作 Manager、去重與回滾正常；有 R1 種入競態；本輪確認 R2 的既有排序缺陷也影响其「最新」定義；测试退化見 R5 |
| `3241a9c` | 重複 ID 正確拒絕，避免歧義與舊版 save 丢另一笔；需要可操作的只讀修復／錯誤提示，不能退回默默接受 |
| `722c119` | 純待辦文件；未將已知 Windows、OAuth、Pi Responses、打包、权限、TOML 等事項重複回報。文件「基準 HEAD 37e2673」與下方同日完成項目採不同時間口徑，屬文案清晰度，未另列缺陷 |

建議修正順序：R1 → R2 → R3／R4，然後修正對應測試與遷移说明。R2 必須标明既有來源，避免把本輪新增缺陷數誇大；R1 必須維持受控競態證據的說法，不能声称已量測实际发生概率。沒有發現本輪正常合作程序下写壞 CLI 設定、把 auth.json 改寫給第三方或將原文密鑰回傳 renderer 的新問題。
