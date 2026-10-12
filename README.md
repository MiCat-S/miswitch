# Mi-Switch

一个仅支持 **Claude Code、OpenAI Codex CLI、Pi Coding Agent** 的本机配置管理器。Electron + React + TypeScript，macOS 设置风格：侧栏列出三个 CLI 及其正在使用的供应商，主区先显示“正在使用”的摘要，下方是可筛选的供应商卡片，点 ▶ 即切换；菜单栏图标也能直接切换。供应商显示厂商标志（依预设或 Base URL 自动识别，也可在编辑页更换）。写入前备份、恢复、外部变更检测；跟随系统深浅色。

仓库与内部标识仍叫 `miswitch`（目录、IPC 通道、Pi 的 `miswitch_` Provider 前缀）；应用显示名称为 Mi-Switch。设置数据仍保存在 `~/Library/Application Support/MiSwitch`，改名不影响已有的供应商与备份。

**按用户要求使用明文 JSON 存储，不做加密，不依赖钥匙串。** 界面不回传已保存的 API Key；目标配置、Hub 和历史备份仍包含明文凭据。

## 运行

需要 Node.js 22.12+、npm 和图形桌面环境。

```bash
npm ci
npm run dev
```

`dev` 先构建再打开真实 Electron 窗口；当前不使用 HMR。只启动或刷新界面不会修改目标 CLI 配置。“保存”只写入 Mi-Switch 自己的 Hub；点 ▶、“保存并使用”或菜单栏中的供应商才修改目标文件。保存正在使用的供应商会立即写入，不需要再切换一次。

```bash
npm test          # 核心逻辑，使用临时目录
npm run build    # 类型检查 + React 与 Electron 构建
npm run test:desktop  # 实际桌面窗口、真实 IPC、表单与恢复流程，使用临时 home
npm run package  # 为当前平台生成安装包，输出到 release/
npm run test:container  # 在 Docker 容器内用真实 Claude Code / Codex / Pi 验证写入的配置
```

macOS 安装包为 Apple Silicon（arm64）dmg，使用 ad-hoc 签名，没有 Developer ID 签名与公证。首次打开时 macOS 会提示无法验证开发者：在“系统设置 → 隐私与安全性”中点“仍要打开”，或对拖入“应用程序”后的副本运行 `xattr -dr com.apple.quarantine /Applications/Mi-Switch.app`。从旧版升级时，“应用程序”里的旧版名为 `MiSwitch.app`，可以直接删除。

容器测试需要可用的 Docker daemon（macOS 可用 `brew install colima docker && colima start`）。映像内安装固定版本的三款 CLI，用 Mi-Switch 核心写入配置后以非互动模式启动各 CLI，让它们请求容器内的模拟 API，并断言实际发送的路径、鉴权头与模型。全程不使用真实密钥，也不碰宿主机的配置目录。

## 支持范围

| 界面应用 | 实际适配对象 | 写入文件 |
| --- | --- | --- |
| Claude | Claude Code | `~/.claude/settings.json` |
| ChatGPT | OpenAI Codex CLI | `~/.codex/config.toml`；`auth.json` 只备份不改写 |
| Pi | Pi Coding Agent，原 `badlogic/pi-mono` 项目 | `~/.pi/agent/models.json`、`auth.json`、`settings.json` |

支持 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`PI_CODING_AGENT_DIR` 目录覆盖。GUI 只能读取启动进程继承的环境，不能读取其他终端的环境。

Claude Code 使用 Anthropic Messages；Codex 使用 Responses；Pi 可选择 Anthropic Messages、OpenAI Responses 或 Chat Completions。仅有“OpenAI 兼容”描述不代表端点适合所有应用。

添加供应商是一个页面：顶部是可搜索的预设标签，内置约 20 个常用供应商（Anthropic / OpenAI 官方、DeepSeek、Kimi、智谱、MiniMax、通义千问、火山方舟、OpenRouter 等），点一下就填好 Base URL、协议与模型，并提供官网和“获取 API Key”链接；换预设时已输入的 Key 和备注会保留。预设数据改编自 cc-switch（MIT，见 `THIRD_PARTY_NOTICES.md`；安装包内同样附带此文件，位于 `Mi-Switch.app/Contents/Resources/`）。表单可显示/隐藏 API Key；“从供应商获取”会请求供应商的 `/v1/models`，结果是可筛选的列表，点一个即填入；编辑已保存的供应商时，只有 Base URL 没改才会沿用已保存的 Key，改了地址需要先填新 Key。

Claude Code 的后台任务和 haiku／sonnet／opus／fable 别名默认请求 Anthropic 的模型 ID；网关没有这些模型时，在“模型别名映射”中填写（写入 `ANTHROPIC_DEFAULT_*_MODEL`），或点“全部用默认 Model”。Codex 可选推理强度（`model_reasoning_effort`），只在切换时写入。

侧栏“全局设置”按 CLI 编辑配置文件（Claude `settings.json`、Codex `config.toml`、Pi `settings.json`）中供应商字段以外的部分：hooks、permissions、插件、`sandbox_mode`、MCP 等。它们对所有供应商生效，保存时立即写入本机文件（先自动备份），TOML 的日期与时间保持原类型；读取后若全局部分被其他程序修改，保存会被拒绝（只改供应商字段或排版不算）；文本里出现地址、Key、模型等供应商字段时也会被拒绝，并列出字段名。编辑供应商时可展开“使用后的配置文件预览”，只读查看切换后的完整文件。预览和全局设置里的密钥、令牌等敏感值（包括其他路由表、MCP 服务的令牌）都以占位文字显示；在全局设置中保留占位文字保存，会沿用文件中的原值。

“官方登录”模式恢复官方路由并保留已有登录凭据；登录、刷新和多个 OAuth 账号的管理继续交给目标 CLI。Pi 的对应模式是“沿用 Pi 已有的 Provider”：只切换 `defaultProvider` 与 `defaultModel`，不改动该 Provider 本身（`/login` 保存的登录、`auth.json` 中的密钥或 `models.json` 中的定义）。Claude/Codex 的钥匙串登录不能通过是否存在 `auth.json` 判断，请分别运行 `/status` 或 `codex login status` 验证。

Codex 的写法与 cc-switch 相同：第三方路由写在 `model_providers.custom` 并以 `experimental_bearer_token` 保存密钥，官方路由移除 `model_provider`；两个工具可以接管同一份配置。

本版不改写 Claude Desktop 消费者聊天、ChatGPT 消费者客户端的私有登录数据库，也不把 `~/.openai/` 当作 Codex 官方配置路径。Pi 指 Pi Coding Agent，不是 Inflection 的 Pi 聊天产品。

## 资料

- [完整技术方案、Schema、映射及避坑指南](docs/TECHNICAL_DESIGN.md)
- [Fable 审查说明与验证记录](docs/FABLE_REVIEW.md)
- [桌面实际运行截图](docs/desktop-preview.png)

切换成功表示文件已写入并完成校验；新进程启动、项目配置、已有会话模型和管理员策略仍影响实际使用。请在目标工具内确认供应商与模型。

首次打开时，每个应用会把本机当前配置导入为第一个供应商（各一次；删除后不再自动导入，列表为空时可点“从本机配置文件导入”）。导入只读取目标文件；若重新写入不会改变任何供应商字段，导入的供应商直接标记为“使用中”。无法表示的配置（例如 Codex 使用 `env_key` 读取终端环境变量的密钥、Claude 使用 `apiKeyHelper` 或云平台路由）不导入，界面会提示原因。

状态判定只比较供应商字段：CLI 自行重排或追加无关设置仍显示“已写入，新会话生效”，改动了端点、密钥或模型才显示“配置文件被其他程序改过”，并提供“重新应用”。窗口重新获得焦点、或从菜单栏切换后，界面会自动重新检测。保存正在使用的供应商会立即写入；若写入失败（例如 Claude 配置了 `apiKeyHelper`），供应商仍会保存，摘要显示“配置文件仍是编辑前的版本”，处理后点“重新应用”即可；只改名称或备注不会改动文件。若上次切换中断且目标文件随后被其他程序修改，界面会列出冲突文件并暂停所有写入；“放弃并回退”只回退本工具自己写入的内容，外部修改一律保留，切换前的备份仍可在“历史备份”中恢复。

菜单栏图标按应用列出全部供应商，当前使用的打勾；点一个即切换并发送系统通知，打开的窗口同步更新。有未完成的切换时菜单中的供应商会停用。
