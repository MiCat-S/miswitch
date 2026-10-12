# Fable 审查交接

## 目标与范围

MiSwitch 是本机运行的 Electron + React + TypeScript 配置切换器，仅支持 Claude Code、Codex CLI、Pi Coding Agent。用户明确要求不加密，因此存储使用普通 JSON，不使用 safeStorage 或钥匙串。

请先读 `TECHNICAL_DESIGN.md`，再查看 `src/core` 的逻辑。不要用消费者客户端私有登录数据库或 Inflection Pi 的路径替换当前已核实的 CLI 适配。

## 验证命令

```bash
npm ci
npm test
npm run build
npm run test:desktop
npm audit --omit=dev
```

核心测试及桌面测试都使用临时 home，不操作真实 CLI 配置。桌面测试使用未打包版本专属的 `MISWITCH_SANDBOX_ROOT`；正式打包忽略该变量。测试生成 `docs/desktop-preview.png` 并清理临时配置。

测试覆盖：

- Claude 保留权限/Hook/MCP、清理冲突 env、明文 Hub、前端不回传 key、POSIX mode。
- Codex TOML 语义保留、Responses 路由、profile 处理、OAuth auth 文件保留、清理旧管理 token。
- Pi 三文件写入、已有 OAuth 和主题保留、恢复内建登录 Provider。
- 格式无效时不写目标，不产生切换备份。
- 协议、URL、字面密钥验证。
- 精确原文恢复、恢复前自动备份、原来不存在的文件恢复后删除。
- 文件变化检测、禁止删除当前配置、编辑清除写入标记。
- 两个 Manager 及两个独立 Node 进程并发保存，不丢 Provider。
- 各应用独立保留历史数量。
- 中途磁盘写入失败时目标与 Hub 回滚。
- 崩溃恢复；第三方修改时 snapshot 报告 `pending`、拒绝写入、不覆盖外部内容。
- 放弃待决日志只回退本工具自己的字节；无法解析的 pending.json 以内容哈希确认后丢弃。
- CLI 重排 / 追加无关字段仍为 `written`（标记 reformatted）；修改管理字段为 `drift`。
- 损坏的备份文件被跳过并产生警告，不阻塞 snapshot 与恢复。
- `publicError` 只转发 PublicError 与 Zod custom 消息；内建 Zod、parser、文件系统错误不回显输入。
- 4 MB 紧凑 JSON 格式化后超过 8 MiB 时在写入前拒绝，目标、备份、日志均不变；4.2 MiB 合法配置的 8.8 MB 备份与由其构造的日志可读并可恢复。
- 只含部分文件的备份被跳过且不可恢复；旧版 Codex 单文件备份按显式规则恢复。
- 无 fingerprint 的旧版 active 记录按原文比较，不报漂移。
- 桌面 smoke：模式来回切换保留草稿；100 字符名称 + 2000 字符备注在 840 px 不横向溢出；200% 缩放不横向溢出。
- 容器 PASS 同时要求匹配请求与 CLI 退出码 0、未逾时。
- Compare-before-replace、临时文件清理、链接拒绝。
- 与 Pi 官方 auth storage 相同的锁约定。
- 目录环境覆盖。

桌面 smoke 使用实际 main / preload / renderer，验证表单提交、启用状态、目标文件、备份、恢复及 snapshot 不泄漏已保存 key。

本次交付验证记录（2026-10-12）：核心回归 22 项通过；TypeScript 检查、Vite / Electron bundle 构建通过；真实 Electron smoke 通过（含校验消息到达表单的检查）；运行依赖审计 0 vulnerabilities。所有密钥均为测试用合成值。

2026-10-12 审查后修正：校验消息转发（`src/core/errors.ts`）、语意漂移判定（`managedFingerprint`）、待决日志状态与“放弃日志”动作（`resolveJournal`）、损坏备份跳过。

2026-10-12 第二轮审核（`docs/CODEX_REVIEW_2026-10-12.md`）后修正：R1 分级大小上限与写前预检，R2 备份完整集合验证，R3 表单草稿保留，R4 长文本换行，R5 窄视口布局，R6 旧版记录相容判定，R7 文字对比 token。P3 中已处理：loading/error/empty 分离、登录卡片文案、容器 PASS 判定；备份 I/O 的 metadata 分离与 CSS 作用域整理未处理。

2026-10-12 第三轮审核（`docs/SOL_REVIEW_2026-10-12.md`）后修正：R1 新备份不再种入列表缓存、只缓存读取前后版本一致的元数据、略过备份前重新读取候选；R2 备份按持久序号排序，清理时保护本次写出的备份；R3 `definition` 改为按应用与模式投影实际写入字段；R4 `active` 记录保存规则集版本，旧记录按自己的规则集判定并提示迁移；R5 测试改用注入的读取函数，新增冷／暖缓存、读取中变化、候选重读、序号与时钟回拨、真实超出保留数、按模式的编辑判定、规则集升级；R6 记录降级边界。另：snapshot 的 `active` 只回传 `providerId` / `appliedAt`；启动读取失败时显示具体原因；刷新成功清除读取失败状态。Sol 的重现脚本保留原样，修正后各缺陷断言不再成立。

2026-10-12 容器联调（`npm run test:container`，Docker via colima）：真实 Claude Code 2.1.296、Codex 0.162.1、Pi 0.73.1 对模拟 API 的请求 5/5 符合预期。联调发现并修正：Pi 0.73 要求自定义 Provider 在 `models.json` 内有 `apiKey`，否则整个文件拒绝加载；现写入占位字面量，真实密钥仍只在 `auth.json`，Pi 实际发送的是 `auth.json` 的密钥。对照 cc-switch 模板后调整：Codex Provider ID 固定为 `custom`；官方模式移除 `model_provider` 并把 `custom` 表置为 dormant；`requires_openai_auth = true` 仅在 `auth.json` 含登录凭据时写入；新增可选 `contextWindow` / `autoCompactTokenLimit`；`auth.json` 纳入目标文件（加锁、备份、校验、不改写）。容器案例扩展为“官方 `auth.json` 存在时第三方 token 优先、`auth.json` 未变、上下文键生效”，6/6 通过。

## 请重点审查

1. **协议与版本**：Codex 当前 `wire_api = "responses"`；Claude 必须 Anthropic Messages。Codex 持久化采用 cc-switch 同款模板 `experimental_bearer_token`（官方文档标注 discouraged，但 `env_key` 需要真实环境变量）。已决定不改用 `http_headers`。容器验证该 token 在任何 `auth.json` 状态下优先生效，故不删除或暂存官方登录。
2. **事务边界**：跨文件不是 OS 原子事务。第三方 CLI 未必配合锁，内容比较与 rename 之间仍有竞争窗口；存在 pending 日志时采取保守回滚。发生外部冲突时不覆盖。
3. **登录边界**：只使用已有官方登录。不会伪造 auth.json、刷新 OAuth 或切换多个消费者账号；Claude/Codex 登录状态需官方 CLI 验证。
4. **字段保留**：业务字段应保留；JSON/TOML 格式及注释经正常切换会重排，恢复用原始文本。Pi 命名空间 `miswitch_<32位hex>` 为本工具保留；Codex 使用与 cc-switch 共享的 `model_providers.custom`。漂移判定只看 `managedFingerprint` 覆盖的字段；若 Adapter 新增写入字段，必须同步加入指纹。Codex 备份包含 `auth.json` 原文（OAuth token 明文），用户已明确要求备份。
5. **权限与路径**：路径从主进程生成；恢复条目白名单；拒绝符号链接；POSIX 写入文件 0600；Windows ACL、文件占用和目录 fsync 差异尚需平台测试。
6. **前端边界**：没有任意 IPC 通道、文件路径、shell 执行或远程导航。截图中的 Key 被隐藏，主进程存储明文符合用户要求。
7. **异常处理**：parser 错误不直接回显；`PublicError` 与 Zod custom 消息是唯一转发到 renderer 的文本。冲突日志存在时 snapshot 仍可读，所有写入被拒绝；界面的“放弃日志”只回退本工具自己写入的字节，外部修改保留。没有强制覆盖功能。
8. **发布质量**：目前验证平台为 macOS。真实 CLI、真实供应商与真实登录未联调；安装器、签名、公证、Windows/Linux CI 仍属于正式发布工作。

## 依赖情况

运行依赖 `npm audit --omit=dev` 在本次验证返回 0 vulnerabilities。完整开发依赖审计仍报告 8 个 moderate，来自 electron-builder 下载链的 `sprintf-js → roarr → global-agent → @electron/get`，并非应用的配置读写运行依赖。已尝试兼容范围内 `npm audit fix`，未解决该链；没有用未经验证的跨主版本 override 强行替换。正式打包流水线应进一步复核及处理。

## 后续扩展建议

如需增加启动器、托盘、导入现有配置、CLI 版本探测、定时 watcher 或多 OAuth 账号，请作为独立功能审查。不要为了实现“一键”悄悄改动 shell profile、全局环境、消费者客户端数据库或管理员策略。
