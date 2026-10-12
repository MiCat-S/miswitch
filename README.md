# MiSwitch

一个仅支持 **Claude Code、OpenAI Codex CLI、Pi Coding Agent** 的本机配置管理器。Electron + React + TypeScript，卡片式 Provider Hub，一键写入官方配置、写入前备份、恢复、外部变更检测。

**按用户要求使用明文 JSON 存储，不做加密，不依赖钥匙串。** 界面不回传已保存的 API Key；目标配置、Hub 和历史备份仍包含明文凭据。

## 运行

需要 Node.js 22.12+、npm 和图形桌面环境。

```bash
npm ci
npm run dev
```

`dev` 先构建再打开真实 Electron 窗口；当前不使用 HMR。只启动或刷新界面不会修改目标 CLI 配置。添加配置只写入 MiSwitch 自己的 Hub；点击“启用配置”才修改目标文件。

```bash
npm test          # 核心逻辑，使用临时目录
npm run build    # 类型检查 + React 与 Electron 构建
npm run test:desktop  # 实际桌面窗口、真实 IPC、表单与恢复流程，使用临时 home
npm run package  # 为当前平台生成安装包；正式发布需另做签名/公证
npm run test:container  # 在 Docker 容器内用真实 Claude Code / Codex / Pi 验证写入的配置
```

容器测试需要可用的 Docker daemon（macOS 可用 `brew install colima docker && colima start`）。映像内安装固定版本的三款 CLI，用 MiSwitch 核心写入配置后以非互动模式启动各 CLI，让它们请求容器内的模拟 API，并断言实际发送的路径、鉴权头与模型。全程不使用真实密钥，也不碰宿主机的配置目录。

## 支持范围

| 界面应用 | 实际适配对象 | 写入文件 |
| --- | --- | --- |
| Claude | Claude Code | `~/.claude/settings.json` |
| ChatGPT | OpenAI Codex CLI | `~/.codex/config.toml`；`auth.json` 只备份不改写 |
| Pi | Pi Coding Agent，原 `badlogic/pi-mono` 项目 | `~/.pi/agent/models.json`、`auth.json`、`settings.json` |

支持 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`PI_CODING_AGENT_DIR` 目录覆盖。GUI 只能读取启动进程继承的环境，不能读取其他终端的环境。

Claude Code 使用 Anthropic Messages；Codex 使用 Responses；Pi 可选择 Anthropic Messages、OpenAI Responses 或 Chat Completions。仅有“OpenAI 兼容”描述不代表端点适合所有应用。

Claude Code 的后台任务和 haiku 别名默认请求 Anthropic 的 Haiku 模型 ID；网关没有该模型时，在配置里填写“小型／快速模型”（写入 `ANTHROPIC_DEFAULT_HAIKU_MODEL`）。

“官方登录”模式恢复官方路由并保留已有登录凭据；登录、刷新和多个 OAuth 账号的管理继续交给目标 CLI。Pi 会检查指定 Provider 已有 OAuth 记录。Claude/Codex 的钥匙串登录不能通过是否存在 `auth.json` 判断，请分别运行 `/status` 或 `codex login status` 验证。

Codex 的写法与 cc-switch 相同：第三方路由写在 `model_providers.custom` 并以 `experimental_bearer_token` 保存密钥，官方路由移除 `model_provider`；两个工具可以接管同一份配置。

本版不改写 Claude Desktop 消费者聊天、ChatGPT 消费者客户端的私有登录数据库，也不把 `~/.openai/` 当作 Codex 官方配置路径。Pi 指 Pi Coding Agent，不是 Inflection 的 Pi 聊天产品。

## 资料

- [完整技术方案、Schema、映射及避坑指南](docs/TECHNICAL_DESIGN.md)
- [Fable 审查说明与验证记录](docs/FABLE_REVIEW.md)
- [桌面实际运行截图](docs/desktop-preview.png)

切换成功表示文件已写入并完成校验；新进程启动、项目配置、已有会话模型和管理员策略仍影响实际使用。请在目标工具内确认供应商与模型。

状态判定只比较本工具管理的字段：CLI 自行重排或追加无关设置仍显示“配置已写入”，改动了端点、密钥或模型才显示“管理字段已被外部修改”。编辑当前已写入的配置不会改动目标文件，卡片显示“已编辑，待重新写入”，点击“重新写入”后生效；只改备注不算编辑。若上次切换中断且目标文件随后被其他程序修改，界面会列出冲突文件并暂停所有写入；“放弃日志”只回退本工具自己写入的内容，外部修改一律保留，切换前的备份仍可恢复。
