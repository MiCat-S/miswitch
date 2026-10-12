# MiSwitch 待辦清單

整理日期：2026-10-12。基準：Git HEAD `37e2673`。兩輪審核的 P1／P2 已全部修正；本清單只列尚未啟動的項目。

同日已完成並移出清單：Claude 網關的小型／快速模型欄位（`ANTHROPIC_DEFAULT_HAIKU_MODEL`，容器內以真實 Claude Code 驗證）、備份列表改為按檔案版本快取元資料、編輯當前 Provider 保留標記並顯示「已編輯，待重新寫入」、`readHub()` 拒絕重複 ID、與最新備份內容相同時不再新增備份。行為說明見 `docs/TECHNICAL_DESIGN.md`。

建議順序：先做核心小項，IPC 路徑與 asar 驗證併入打包工作，其餘屬發布階段。

## 核心小項

- [ ] Claude 只提供 haiku 路由欄位；`/model opus`、子代理 `model: sonnet` 等別名仍請求 Anthropic 預設 ID。cc-switch 提供 haiku／sonnet／opus／fable 四個欄位，若網關使用者會用這些別名再補。
- [ ] `proper-lockfile` 的鎖目錄（`settings.json.lock/`、`config.toml.lock/`）會出現在 CLI 設定目錄中，無害但可見；可評估改放到 MiSwitch 自己的 store 目錄（需保留 Pi `auth.json` 與官方相同的鎖約定）。
- [ ] `@iarna/toml` 自 2020 年未維護，僅支援 TOML 0.5；若 Codex 日後在 `config.toml` 使用 TOML 1.0 特性會解析失敗。可評估換 `smol-toml`，換前需用本機實際 `config.toml` 做往返測試。
- [ ] 唯讀目標仍可透過 rename 被覆寫為 0600。文件已記錄不保留既有 mode／ACL；發布前決定是否尊重既有檔案權限。

## 介面與無障礙

- [ ] CSS 仍有 `small`、`header`、`h2`、`label`、`input` 等全域選擇器，後續元件擴充時容易互相影響；逐步限定作用域。
- [ ] 表單錯誤缺少 `aria-invalid`、`aria-describedby` 與首次錯誤聚焦。
- [ ] 備註超過約七行改為卡片內捲動，尚無展開／收合機制。

## 測試範圍

- [ ] 容器案例缺少 Pi 的 `openai-responses` 協定。
- [ ] 容器案例沒有真實登入情境：Claude／Codex 的官方 OAuth、Codex 使用 `cli_auth_credentials_store = "keyring"` 時 `auth.json` 不存在的行為。
- [ ] IPC 來源比對（`src/desktop/main.ts` 以 `pathToFileURL().href` 對比 frame URL）未在含空白或非 ASCII 的路徑、以及 asar 打包後驗證。
- [ ] 真實供應商聯調：現有容器測試只驗證對模擬 API 的路由，不驗證協定相容、串流、工具調用。

## 發布前工作

- [ ] Windows 與 Linux 的 GUI 測試；Windows 的 ACL、檔案佔用導致 rename 失敗的行為。
- [ ] 安裝包、簽名與公證；`npm run package` 尚未在任何平台實際執行。
- [ ] 開發依賴審計的 8 個 moderate 項目，來自 electron-builder 的 `sprintf-js → roarr → global-agent → @electron/get` 鏈；執行期依賴為 0。
- [ ] CLI 版本矩陣：容器固定 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1；本機實際使用 ChatGPT 桌面版內建的 Codex 0.162.0-alpha.17.2。

## 環境

- [ ] `colima` 未設定開機自動啟動；跑 `npm run test:container` 前先 `colima start`。
- [ ] Git 儲存庫只有本機 `main`，沒有遠端。
