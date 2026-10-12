# Mi-Switch 待辦清單

整理日期：2026-10-12。本清單只列尚未啟動的項目；三輪審核（含 `docs/SOL_REVIEW_2026-10-12.md`）的 P1／P2 均已修正。

以 `37e2673` 為起點，同日已完成並移出清單：Claude 網關的小型／快速模型欄位（`ANTHROPIC_DEFAULT_HAIKU_MODEL`，容器內以真實 Claude Code 驗證）、備份列表改為按檔案版本快取元資料、編輯當前 Provider 保留標記並顯示「已編輯，待重新寫入」、`readHub()` 拒絕重複 ID、與最新備份內容相同時不再新增備份。

同日的介面改版也已完成：macOS 設定風格的側欄與「正在使用」摘要卡、可篩選的供應商卡片（▶ 切換、✎ 編輯）、新增與編輯改為整頁並以預設標籤開頭（換預設保留 Key 與備註）、「保存並使用」、保存使用中的供應商立即寫入、全域設定獨立成頁（編輯頁只保留唯讀預覽）、白話狀態與「重新應用」、視窗取得焦點時自動重新偵測、選單列快速切換、模型清單可篩選點選。之後的視覺改版：應用改名為 Mi-Switch（資料資料夾不變）、以 Material 3／Apple／Claude 的配色方法重做色彩與深色模式、標題改用 Source Serif 4 與宋體、Lucide 線條圖示、供應商廠商標誌（自動識別並可手動更換）、應用圖示與選單列圖示「三軌」。行為說明見 `docs/TECHNICAL_DESIGN.md`。

第四輪審查（`docs/SOL_HIGH_REVIEW_2026-10-12.md`，Codex `gpt-6.1-sol` high）的 A1–A12 均已修正，修正與驗證的對照見 `docs/review-fixes/README.md`。

建議順序：先做核心小項，IPC 路徑與 asar 驗證併入打包工作，其餘屬發布階段。

## 核心小項

- [ ] 預設清單的模型 ID 取自 cc-switch 2026-10-12 的 `main`，會隨供應商更新而過時；需要定期對照更新，或改為只保留端點、模型一律由「獲取模型列表」取得。
- [ ] `proper-lockfile` 的鎖目錄（`settings.json.lock/`、`config.toml.lock/`）會出現在 CLI 設定目錄中，無害但可見；可評估改放到 MiSwitch 自己的 store 目錄（需保留 Pi `auth.json` 與官方相同的鎖約定）。
- [ ] `@iarna/toml` 自 2020 年未維護，僅支援 TOML 0.5；若 Codex 日後在 `config.toml` 使用 TOML 1.0 特性會解析失敗。可評估換 `smol-toml`，換前需用本機實際 `config.toml` 做往返測試。已知實例：沒有小數秒的本地時間（如 `clock = 07:32:00`）後面緊接下一行鍵值時解析失敗（`07:32:00.000` 或行尾註解則正常）。
- [ ] 唯讀目標仍可透過 rename 被覆寫為 0600。文件已記錄不保留既有 mode／ACL；發布前決定是否尊重既有檔案權限。

## 介面與無障礙

- [ ] Hub 結構損壞（例如重複 ID）時只顯示原因並暫停所有操作，沒有修復畫面。可提供只讀的衝突列表（不含密鑰）、開啟資料夾與完整備份入口，由使用者確認保留或改 ID。
- [ ] 全域設定頁的配置文件編輯器是純文字框，沒有語法高亮與行號；CodeMirror 需要放寬 CSP 的 `style-src`。另外 `config.toml` 寫回時不保留註解（切換本來就如此），若要保留需換成保留格式的 TOML 編輯方式。
- [ ] CSS 仍有 `button`、`label`、`input`、`fieldset`、`dialog` 等全域選擇器，後續元件擴充時容易互相影響；逐步限定作用域。
- [ ] 表單錯誤缺少 `aria-invalid`、`aria-describedby` 與首次錯誤聚焦。
- [ ] 供應商卡片只顯示備註第一行（滑鼠停留顯示全文），多行備註只能在編輯頁看完整內容。
- [ ] 選單列只能切換，不顯示「配置文件被其他程式改過」等異常；可考慮在選單中加 ⚠ 與「重新應用」。
- [ ] 編輯供應商期間側欄鎖定以免遺失輸入；若使用者覺得受限，可改為離開前確認。
- [ ] 「從供應商獲取」的模型清單最多顯示 300 個，超過時需靠篩選。
- [ ] 廠商標誌是固定的 16 家；新增預設時要同時在 `src/ui/vendor.ts` 補網域、在 `src/ui/marks.ts` 補標誌（重新從 LobeHub Icons 產生）。
- [ ] 標題的 Source Serif 4 只打包拉丁子集；中文標題依賴系統宋體，Windows／Linux 上會退回其他襯線字或黑體。

## 測試範圍

- [ ] 容器案例缺少 Pi 的 `openai-responses` 協定。
- [ ] 容器案例沒有真實登入情境：Claude／Codex 的官方 OAuth、Codex 使用 `cli_auth_credentials_store = "keyring"` 時 `auth.json` 不存在的行為。
- [ ] IPC 來源比對（`src/desktop/main.ts` 以 `pathToFileURL().href` 對比 frame URL）已在 macOS arm64 打包版（asar、含空白／中文／`#` 的路徑）驗證；Windows／Linux 打包版尚未驗證。
- [ ] Claude 背景任務的動態驗證：容器只驗證 `--model haiku` 主對話走小型／快速模型，尚未觸發任何真正的背景請求。
- [ ] 備份列表快取的版本鍵（dev、ino、size、mtime、ctime）未在 Windows 與時間精度粗的檔案系統上實測。
- [ ] 真實供應商聯調：現有容器測試只驗證對模擬 API 的路由，不驗證協定相容、串流、工具調用。

## 發布前工作

- [ ] Windows 與 Linux 的 GUI 測試（含系統匣選單與關閉最後一個視窗即結束的行為）；Windows 的 ACL、檔案佔用導致 rename 失敗的行為。
- [ ] 簽名與公證：macOS arm64 dmg 已可用 `npm run package` 產生，但只有 ad-hoc 簽名、未公證（需 Developer ID 憑證）；Intel／universal、Windows、Linux 安裝包尚未建置；應用程式圖示已設定，但沒有 Windows 的 ico 與 Linux 尺寸的版本。
- [ ] 開發依賴審計的 8 個 moderate 項目，來自 electron-builder 的 `sprintf-js → roarr → global-agent → @electron/get` 鏈；執行期依賴為 0。
- [ ] CLI 版本矩陣：容器固定 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1；本機實際使用 ChatGPT 桌面版內建的 Codex 0.162.0-alpha.17.2。

## 環境

- [ ] `colima` 未設定開機自動啟動；跑 `npm run test:container` 前先 `colima start`。
