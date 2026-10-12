# 給 Codex（Astra 6.1，medium）的審查提示詞

> 使用方式：把下面「提示詞」整段貼給 Codex。它會在 `docs/ASTRA_REVIEW_2026-10-12.md` 寫出報告，並把重現腳本放在 `docs/review-astra/`。

---

## 提示詞

你是 Mi-Switch（倉庫名 `miswitch`）這一輪的**獨立審查者**。你的工作是找出真實存在、可以重現的缺陷，並寫成一份讓開發者能直接照著修的報告。**不要修改產品程式碼**，也不要提交或推送任何東西。請用繁體中文撰寫報告；程式碼、指令、路徑與專有名稱保留原文。

請先完整讀完這份說明再動手。有不確定的地方，在報告的「假設與限制」中寫清楚你的假設；不要猜測，也不要把推測寫成結論。

### 1. 專案是什麼

Mi-Switch 是一個 macOS 優先的 Electron + React + TypeScript 桌面工具。它只管理三個命令列工具的「供應商」（API 端點、金鑰、模型）：

| 介面名稱 | 實際對象 | 會寫入的檔案 |
| --- | --- | --- |
| Claude Code | Claude Code | `~/.claude/settings.json` |
| Codex | OpenAI Codex CLI | `~/.codex/config.toml`（`auth.json` 只備份、不改寫） |
| Pi | Pi Coding Agent | `~/.pi/agent/models.json`、`auth.json`、`settings.json` |

核心流程：使用者在 Mi-Switch 裡保存多個供應商（存在 Mi-Switch 自己的 `hub.json`）。點「使用」時，`Manager.activate()` 以**有日誌的多檔案交易**改寫目標檔案：先備份，再寫 `pending.json`，然後原子替換並回讀驗證。之後用「供應商欄位指紋」判斷檔案有沒有被其他程式改過（drift）。

**以下是使用者明確要求的設計決定，請不要當成缺陷回報**（如果你認為某個做法有你能重現的具體風險，可以寫在「設計層面的觀察」，但不列入嚴重度）：
- Hub、備份與目標檔案都以**明文**保存金鑰，不加密、不使用鑰匙圈（Keychain/safeStorage）。
- Codex 的 API 模式依 cc-switch 慣例，把金鑰寫在 `config.toml` 的 `model_providers.custom.experimental_bearer_token`。
- 應用顯示名稱是 Mi-Switch，但內部識別碼（倉庫、IPC 通道 `miswitch:*`、環境變數 `MISWITCH_SANDBOX_ROOT`、Pi 的 `miswitch_` Provider 前綴）保持 `miswitch`；資料資料夾刻意固定在 `appData/MiSwitch`。

**以下是必須成立的安全不變量**，請逐一驗證：
1. renderer 永遠拿不到已保存的金鑰：`snapshot()` 只回傳 `hasKey`，設定檔預覽以佔位文字取代金鑰。
2. 主程序回給 renderer 的錯誤只有靜態訊息（`src/core/errors.ts` 的 `publicError`），不得回顯檔案內容、解析器訊息或使用者輸入。
3. IPC 只接受本視窗、主 frame、固定的本機頁面來源（`src/desktop/main.ts`）。
4. CSP 是 `default-src 'self'; style-src 'self'`：不能有內聯樣式，也不能載入外部資源。
5. 任何改寫目標檔案的操作都必須先備份，並且可以從「歷史備份」恢復；交易中途失敗時不得留下半寫的檔案。
6. 「只改顯示用欄位」（名稱、備註、圖示）不得改寫目標檔案，也不得被判定為「已編輯待寫入」。

### 2. 審查範圍

- 倉庫：`/Users/cat/Documents/Claude/miswitch`，分支 `main`。
- **基準：`722c119`**（上一輪 Sol 審查的終點），**終點：審查開始時的 `main` HEAD**。請在報告開頭記下實際 HEAD 的完整 SHA，以及開始時工作區是否乾淨。
- 範圍內的 commit（用 `git log --oneline 722c119..main` 核對；最後幾個是這一輪的介面改版，訊息以實際為準）：
  - `4eee062`、`b7538a2`、`ae59b54`、`aa218a9`：修正 Sol 報告的 R1–R6。
  - `80d0cd8`：macOS 打包輸出到 `release/`，ad-hoc 簽名。
  - `360dfd8`：首次啟動時把本機現有設定匯入為第一個供應商（`importLive`）。
  - `a1689e3`：Claude 的模型別名路由（Haiku/Sonnet/Opus/Fable），以及 Codex 的推理強度。
  - `3200d3b`：從供應商取得模型清單（`listModels`）。
  - `99e1417`：供應商預設（19 個，改編自 cc-switch），以及編輯器重做。
  - `b28242a`：設定檔編輯（後來改成獨立的「全局设置」頁加唯讀預覽）。
  - `ad4c0dd` 之後：本輪介面改版與功能，包括：
    - 主畫面改為「正在使用」摘要卡加可篩選的供應商卡片；新增與編輯改成整頁。
    - 「保存並使用」；保存使用中的供應商時立即寫入。
    - 全局設定成為獨立頁面，提供 `globalView` / `saveGlobal`。
    - 視窗重新取得焦點時自動重新偵測。
    - 選單列快速切換（`src/desktop/tray.ts`）。
    - 模型清單可篩選、可點選。
    - 改名 Mi-Switch，App 圖示與選單列圖示改為「三軌」。
    - 色彩與字體系統重做，標題字體 Source Serif 4。
    - Lucide 線條圖示；供應商廠商標誌（新增 `icon` 欄位，見 `src/ui/vendor.ts`、`src/ui/marks.ts`）。
- 先讀這些文件建立背景：`docs/TECHNICAL_DESIGN.md`、`docs/REMAINING_WORK.md`、`docs/SOL_REVIEW_2026-10-12.md`、`docs/CODEX_REVIEW_2026-10-12.md`、`README.md`、`THIRD_PARTY_NOTICES.md`。文件與程式碼不一致時，以程式碼的實際行為為準，並把不一致記為問題。

### 3. 環境與安全規則（必須遵守）

- **絕對不要讀寫使用者真實的設定或資料**：`~/.claude/`、`~/.codex/`、`~/.pi/`、`~/Library/Application Support/MiSwitch`（或 `miswitch`），以及 `/Applications/Mi-Switch.app` 的實際執行資料。所有測試都必須在臨時目錄中進行：
  - 核心層用 `resolvePaths(臨時 data, 臨時 home, {})` 建立 `Manager`（參考 `tests/*.test.ts` 的 `fixture()`）。
  - 桌面層用開發建置加 `MISWITCH_SANDBOX_ROOT=<絕對臨時路徑>`（參考 `scripts/smoke-desktop.cjs`）。這個變數只在未打包時有效。macOS 的 `/tmp` 是符號連結，會被拒絕，請先用 `realpath`。
  - **不要**用真實 `HOME` 啟動已安裝的 App 去做任何寫入。
- 不要使用任何真實 API 金鑰；需要網路時，只連你自己在本機起的模擬伺服器（`127.0.0.1`）。
- Docker 已透過 Colima 可用（`docker info` 確認）。容器測試不得掛載本機 HOME；如需掛載審查腳本，一律唯讀。
- 不要修改 `src/`、`tests/`、`scripts/`、`package.json` 或任何設定。只新增：
  - 報告：`docs/ASTRA_REVIEW_2026-10-12.md`
  - 重現腳本與證據截圖：`docs/review-astra/`
- `npm run test:desktop` 會覆寫 `docs/desktop-preview.png`。跑完請用 `git checkout -- docs/desktop-preview.png` 還原，並在報告中註明。
- 不要 `git commit`、`git push`、改分支或改 GitHub 設定。

### 4. 必跑的驗證（把結果填進報告的驗證表）

```bash
npm ci                     # 若 node_modules 已存在且與 lockfile 一致，可略過並註明
npm run typecheck
npm test                   # 本輪結束時為 53/53
npm run test:desktop       # 真實 Electron + preload + React 冒煙測試；跑完還原 docs/desktop-preview.png
npm run test:container     # 7/7；固定 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1
npm run package            # 選做：只確認能產出 release/Mi-Switch-*.dmg，不要安裝或覆蓋 /Applications
```

測試失敗時，先確認不是環境問題（例如 Docker 未啟動）再判定，並附上完整輸出的關鍵段落。

### 5. 審查重點與具體問題

每一項都請實際讀碼、必要時寫腳本重現。下面的問題只是起點，不是清單上的項目全部通過就算審完。

**A. Sol 的 R1–R6 是否真的修好**（commit `4eee062`、`b7538a2`、`ae59b54`）
- R1：備份快取把舊摘要綁到被覆寫後的版本 → 現在是否會重新讀取並校驗候選？請重跑 `docs/review-sol/reproduce-cache-race.mts` 的思路。
- R2：同 `createdAt` 的保留排序刪掉新備份 → 現在改用 `sequence` 排序，是否完全消除？沒有 `sequence` 的舊備份怎麼排？
- R3／R4：`providerDefinition` 依模式投影，規則集用 `rules` 版本化 → 舊記錄（`rules` 缺省為 1）升級後是否仍會被誤報為 drift 或「已編輯」？
- R5／R6：測試缺口與降級行為的處理是否合理。

**B. 首次匯入 `importLive`**
- 只在「沒有供應商、且 Hub 沒有 `imported` 記錄」時自動執行，目標檔案只讀不寫，是否成立？
- 無法表示的設定（Claude `apiKeyHelper`、雲平台路由、Codex `env_key`）是否正確拒絕，並給出靜態原因？
- 只有在「重新寫入不會改變任何供應商欄位」時才標記為使用中：請用真實格式的設定檔驗證有沒有誤標或漏標。

**C. 別名路由與推理強度**
- Claude API 模式的 `ANTHROPIC_DEFAULT_*_MODEL` 寫入與清除；切換到另一個供應商時，舊路由是否一定清乾淨？
- Codex `model_reasoning_effort` 只在有設定時寫入；沒設定時保留檔案原值。這個語意有沒有讓切換結果不可預期？

**D. 模型清單 `listModels`**
- URL 驗證（只允許 HTTPS 或本機 HTTP）、不跟隨重新導向、10 秒逾時、4 MiB 上限、錯誤只回靜態文字與狀態碼：逐一驗證。
- 已知行為：編輯既有供應商且未輸入新金鑰時，主程序會用 Hub 裡保存的金鑰，送往 renderer **傳入的** Base URL（`src/core/manager.ts` 的 `listModels`）。請評估這是否構成金鑰外洩風險（例如使用者改了 Base URL 但還沒保存）。如果是，提出最小的修正方向。

**E. 預設與外部連結**
- `setWindowOpenHandler` 只允許 `presetLinks` 中的網址交給系統瀏覽器，其他新視窗與頁面導航一律拒絕：驗證有沒有繞過方式。
- 套用預設只改端點、協定、鑑權與模型，保留已輸入的金鑰與備註；名稱只在為空或仍是上一個預設名時才替換。

**F. 全局設定與設定檔預覽**（`src/core/config-editor.ts`、`Manager.globalView/saveGlobal/configView`）
- 「供應商欄位」與「全局部分」的切分是否正確：Claude 的 `model` 加 `env` 中的特定鍵、Codex 的特定頂層鍵加 `model_providers.custom` 與 `miswitch_*`、Pi 的 `defaultProvider`／`defaultModel`。有沒有應屬供應商的欄位漏進全局（或反之）？
- `saveGlobal`：
  - 文字中含供應商欄位時，是否一律拒絕，並列出欄位名？
  - `base` 摘要不符（讀取後檔案被他人改過）時，是否完全不寫？
  - 內容沒變時是否不寫？
  - 寫入是否走交易與備份，並更新使用中記錄的 hash，讓自己的寫入不被報成「重新排版」？
- JSON 與 TOML 的邊界：BOM、CRLF、重複鍵、超大檔案、深層巢狀、TOML 的 inline table／array of tables、日期型別。
- 預覽與所有錯誤訊息都不得洩漏金鑰或原文內容。

**G. 保存語意（本輪新增）**
- `save(input, { activate })`：
  - 保存使用中的供應商且供應商欄位有變時，會接著執行切換。
  - 切換失敗時，供應商仍然已保存，錯誤以 `SAVED_NOT_APPLIED` 前綴回傳，介面據此關閉編輯頁，避免重複新增。
- 請驗證以下情況的資料一致性：
  - 失敗發生在交易中途。
  - 存在 `pending.json`。
  - 新增供應商時就失敗。
- 編輯保持供應商在清單中的位置。
- `icon` 欄位只用於顯示：不得寫入目標檔案，也不得進入 `definition`。規則集 1 與 2 都要驗證（`src/core/adapters.ts` 的 `providerDefinition`）。

**H. 選單列（`src/desktop/tray.ts`）**
- 單選項的勾選狀態與實際使用中是否一致？有未完成切換時是否停用？
- 視窗正在執行操作時，從選單列切換，兩者會不會互相覆蓋？主程序的 `exclusive` 鎖與 renderer 的 `busy` 狀態是否足夠？
- 通知與錯誤只用靜態訊息。
- macOS 關閉視窗後，從選單重新打開；單一實例鎖仍然有效。

**I. Renderer 與無障礙**（`src/ui/*.tsx`、`src/ui/styles.css`）
- 視窗取得焦點與 `onChanged` 的背景重讀有序號保護：有沒有舊結果覆蓋新結果、或操作中重讀造成狀態錯亂的情況？
- `dangerouslySetInnerHTML` 只能用於 `src/ui/marks.ts` 中的常數 SVG。請確認沒有任何使用者資料或檔案內容能流入。
- `marks.ts` 裡不得有 `style=` 屬性（CSP 會擋）、`<script>`、事件屬性或外部參照。
- 鍵盤操作與焦點：側欄、卡片上的 ▶／✎、圖示選擇器、對話框（預設焦點在「取消」）、Esc 關閉。
- 檢查 `aria-pressed`、`aria-current`、`aria-label` 是否正確。
- 長名稱、長備註、長網址、200% 縮放（840 px 最小視窗）下有沒有溢出或重疊。

**J. 改名與資料位置**
- 打包後 `app.setName('Mi-Switch')`，並把 `userData` 固定為 `appData/MiSwitch`。這在大小寫敏感的檔案系統上，是否仍能找到舊資料（舊的開發版曾用小寫 `miswitch`）？
- 從舊版 `MiSwitch.app` 升級到 `Mi-Switch.app` 時，有沒有遺失資料、出現兩個實例，或在選單列留下兩個圖示的情況？

**K. 素材與授權**
- `THIRD_PARTY_NOTICES.md`：LobeHub Icons（MIT）、Lucide（ISC，含 Feather 的 MIT 段落）、Source Serif 4（OFL）、cc-switch（MIT）的聲明是否完整正確？
- `src/ui/fonts/source-serif-4-latin-opsz-normal.woff2` 是否為 Fontsource 原檔、未經修改？
- 確認專案中沒有任何 Anthropic 專有字體（Anthropic Sans／Serif）或其他無授權素材。

**L. 廠商圖示自動識別**（`src/ui/vendor.ts`）
- 主機名比對是「網域本身或其子網域」。請測試：
  - 大寫、結尾的點（`api.deepseek.com.`）、連接埠。
  - IP 位址、IDN／punycode。
  - 仿冒網域，例如 `deepseek.com.evil.example`、`evil-deepseek.com`。
- 每個內建預設的端點都應能識別出廠商（已有測試，請確認測試真的覆蓋）。

**M. 設計系統的宣稱是否屬實**（次要，但文件有明確數字）
- `docs/TECHNICAL_DESIGN.md` 宣稱：
  - 文字對比淺色 ≥ 5.2:1、深色 ≥ 6.3:1。
  - 字級只有 11／12／13／17／22。
  - 在 1140 px 寬時，區塊標題、工具列標題與圖示列對齊在同一條線上。
- 請用 `src/ui/styles.css` 的實際值計算或量測，列出不符之處。不要提純主觀的審美意見。

**N. 文件正確性**
- README、技術設計、待辦清單中，與程式行為不一致的敘述。

### 6. 嚴重度定義

- **P0**：資料遺失或毀損（使用者設定檔、Hub、備份）、金鑰洩漏給非預期對象、任意程式執行。
- **P1**：在一般使用下就會發生的錯誤寫入、錯誤的狀態判定，導致使用者被誤導或需要手動修復；安全不變量被破壞但需要特定條件。
- **P2**：特定條件下的錯誤行為、明顯的可用性或無障礙問題、文件與行為不符且會誤導使用者。
- **P3**：測試缺口、維護性、相容性、次要的文件錯誤。

只回報你**已重現**或**有明確程式碼證據**的問題。純推測的疑慮放在「待確認」，不給嚴重度。不要回報純風格偏好。

### 7. 報告格式（`docs/ASTRA_REVIEW_2026-10-12.md`）

沿用 `docs/SOL_REVIEW_2026-10-12.md` 的結構：

1. 標題、審查日期（Asia/Taipei）、分支、範圍（`722c119..<HEAD>`）、實際 HEAD SHA、開始時工作區狀態。
2. **驗證表**：每個指令的結果與數量。
3. **結論**：一段話，說明最嚴重的問題與建議的修正順序。
4. **重現方式與隔離範圍**：列出 `docs/review-astra/` 下每個腳本的用途與執行指令，並說明隔離方式。
5. **問題（依嚴重度排序）**，每一項用 `### A1 — P1：一句話標題` 的格式，內容包含：
   - **位置**：`檔案:行號`（可多個）。
   - **現象**：實際發生了什麼。
   - **重現**：腳本路徑與指令，或最小步驟。
   - **預期 vs 實際**。
   - **影響**：誰會遇到、後果是什麼。
   - **修正方向**：只描述方向，不要貼完整修補程式。
   - **確信程度**：已重現／有程式碼證據。
6. **已確認沒問題的檢查點**：簡述你驗證過且成立的部分（例如逐條安全不變量），讓開發者知道哪些不必再查。
7. **待確認與限制**：沒能驗證的部分與原因，例如需要真實 OAuth、Windows／Linux、真實供應商。
8. **逐 commit 結果**：每個 commit 一行，標明有無問題及對應編號。

### 8. 溝通方式

- 結論先行，用具體數據和行號說話。
- 區分「已重現」「程式碼證據」「推測」，不要混用。
- 如果發現測試本身寫錯，導致測試通過但功能有問題，請特別標出。
- 審完後，在對話中用 5–10 行總結：問題數量（依嚴重度）、最需要先修的三項，以及報告與腳本的路徑。
