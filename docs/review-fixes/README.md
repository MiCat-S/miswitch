# SOL HIGH 審查問題的修正對照

審查報告：`docs/SOL_HIGH_REVIEW_2026-10-12.md`（範圍 `722c119..1f89403`）。審查證據：`docs/review-sol-high/`；更早一次未完成的審查證據：`docs/review-astra/`。

| 編號 | 問題 | 修正 | 回歸驗證 |
| --- | --- | --- | --- |
| A1 | 未保存的新 Base URL 能取得保存的金鑰 | `Manager.listModels` 只在 Base URL（協定、主機、埠、路徑，不計結尾斜線）與保存時相同時沿用保存的 Key，否則要求先填新 Key | `tests/editor-data.test.ts`：相同位址（含結尾斜線）沿用、不同路徑拒絕且不發請求、新輸入的 Key 正常使用 |
| A2 | 非 custom 路由等憑據出現在預覽與全局設定 | `config-editor.ts` 新增 `maskSecrets`／`restoreSecrets`：讀取 API 把憑據類欄位換成占位文字；保存時把仍是占位文字的欄位換回原值，位置不存在則拒絕 | `tests/review-fixes.test.ts` A2：Codex 其他路由、MCP env、Claude env；保留占位保存、改值保存、移位拒絕 |
| A3 | 全局 TOML 日期／時間變成字串 | `clone` 不再經過 JSON，日期物件原樣保留；`canonical` 區分日期與同樣文字的字串 | `tests/review-fixes.test.ts` A3：offset／local datetime、date、time 往返仍為 TOML 類型 |
| A4 | Hub 可寫到超過讀取上限 | 所有直接寫 Hub 的操作改用 `writeHub`，替換前檢查序列化大小，超出即拒絕並保留原 Hub | `tests/review-fixes.test.ts` A4：接近上限的 Hub 再新增被拒絕，原文不變、仍可讀 |
| A5 | 全局分頁舊回應覆蓋新分頁並寫錯檔案 | `GlobalSettings` 讀取帶序號並記錄來源應用；舊回應忽略，保存只寫入文字所屬的應用 | `docs/review-fixes/verify-races-desktop.cjs`：延後真實 Claude 回應，Pi 分頁保持 Pi 檔案，保存只寫 Pi |
| A6 | 規則集 1 的 Codex 登入改名仍觸發重寫 | 保存時以當前規則集投影判斷是否需要寫入；不需要時只把記錄的 `definition` 按其規則集更新 | `tests/review-fixes.test.ts` A6：改名不改檔案、不增備份、不報 edited；改模型仍套用 |
| A7 | Pi Provider ID 的繼承屬性被當成存在 | Pi 存在性檢查改用 `Object.hasOwn`；圖示查表改用 `Map`，非白名單的 `icon` 回退到自動判斷 | `tests/review-fixes.test.ts` A7（`__proto__`、`constructor`、`toString` 啟用被拒、檔案不變）；`tests/vendor.test.ts` |
| A8 | 忙碌時丟棄選單列變更事件 | 忙碌期間記下變更通知，操作結束後補讀；首次導入納入同一序號 | `docs/review-fixes/verify-races-desktop.cjs`：保存等待期間由選單列切到 B，完成後畫面顯示 B |
| A9 | 舊開發版的小寫 `miswitch` 資料夾 | `dataFolder()`：選已有 `store/hub.json` 的資料夾（先 `MiSwitch`，再 `miswitch`），都沒有時用 `MiSwitch`；不搬移資料 | `tests/review-fixes.test.ts` A9 |
| A10 | 安裝包缺第三方授權聲明 | `package.json` 的 `extraResources` 打包 `THIRD_PARTY_NOTICES.md` | `npm run package` 後確認 `Mi-Switch.app/Contents/Resources/THIRD_PARTY_NOTICES.md` 存在 |
| A11 | 文件的數值與行為宣稱過強 | 淺色警告字改 `#8f5400`、錯誤字改 `#b02f35`、字母頭像字色改為伴隨色 45% 混入正文色；文件改寫字級、全局衝突與預覽錯誤的描述 | 重新計算：淺色最低 5.2:1、深色最低 6.6:1、字母頭像淺色 ≥ 7.3:1、深色 ≥ 6.6:1 |
| A12 | 網域結尾根點無法識別 | 主機名比對前移除結尾的點 | `tests/vendor.test.ts`：`api.deepseek.com.` 與大寫、埠號 |

驗證：`npm test` 59/59、`npm run test:desktop` 通過、`docs/review-fixes/verify-races-desktop.cjs` 通過、容器 7/7、`npm run package` 成功。

審查中另外確認的 `@iarna/toml` 缺陷（沒有小數秒的本地時間後面緊接下一行時解析失敗）屬於上游函式庫，已記入 `docs/REMAINING_WORK.md`。
