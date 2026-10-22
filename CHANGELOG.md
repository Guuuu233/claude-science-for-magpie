# 更新日志 / Changelog

## 0.2.6 (2026-10-22)

### 变更 / Changes

- 默认关闭 Science 的缓存保温（`[cache_keepalive] enabled = false`，用户自己设置过的保持不变）。Science 每轮回答后约 4.5 分钟会用 `max_tokens: 1` 重发整段对话，为 Anthropic 的 5 分钟缓存保温，90 秒没结果就放弃；经 Claude TUI 时每次保温都是一整轮原生 Claude Code 回答，还会触发会话重建、整段重写缓存，而 Claude Code 本身就按 1 小时缓存。v0.2.5 的诊断日志确认：请求内容本身每轮都没有变化，缓存未命中主要来自这些保温请求。

## 0.2.5 (2026-10-22)

### 变更 / Changes

- 诊断缓存未命中：桥接日志 `bridge.log` 为每个对话的请求记录与上一请求相比的「形状」差异——系统提示、工具、tool_choice、思考/推理强度、历史消息中第一个不同的位置。Claude TUI 运行时只有在这些都不变、历史只增不改时才续接原生会话，否则重建会话、整段重写缓存。日志只含哈希、长度、位置和工具名，不含任何内容；`cache_control` 位置变化不计。

## 0.2.4 (2026-10-22)

### 变更 / Changes

- 包名与仓库名改为 `claude-science-for-magpie`（GitHub `Guuuu233/claude-science-for-magpie`），与插件名称 Claude Science for Magpie 一致；命令行入口同名。用旧地址 `github:Guuuu233/magpie-claude-science` 安装的经 GitHub 跳转照常更新，插件仍认作同一个接入。

## 0.2.3 (2026-10-22)

### 变更 / Changes

- 插件更名为 **Claude Science for Magpie**：Magpie Agent 页显示此名称，插件说明同步更新。包名 `magpie-claude-science` 与 GitHub 地址不变，已安装的照常收到更新。
- 文档：快速开始改为插件页安装三步；终端安装指向 v0.2.3（v0.2.0 的升级会抹掉 `science.toml` 自加设置）；补充插件安装时运行 `doctor` 的写法、macOS 钥匙串中的密钥副本及密钥轮换步骤；TUI Boost 要求改为 v0.2.12 或更新版本。

## 0.2.2 (2026-10-22)

### 变更 / Changes

- Magpie 插件页「更新」后，本地服务跟着更新：插件比较自身代码与已部署副本，在 Science 空闲时（窗口关闭、无进行中请求、10 分钟内无请求）后台执行 `autoupgrade`；忙时每 5 分钟重试，切换前再查一次，不打断任务。复用 `upgrade` 路径：保留会话、认证与 `science.toml`，失败回滚。
- 桥接服务在 `status.json` 中报告进行中请求数与最近一次请求时间。
- `upgrade` 保留从 Magpie 插件页安装的 GitHub 条目，并接受 Magpie 对 `plugins.json` 的自身改写（条目仍在且启用时）；此前会把该条目换成本地路径。
- 安装说明改为 `github:Guuuu233/magpie-claude-science`（不带标签），使 Magpie 能提示更新。

## 0.2.1 (2026-10-22)

### 变更 / Changes

- Magpie 插件页一键安装：首次启用时自动部署本地服务；Science 运行中则跳过、不停止任何进程；探测 Node.js 22+（nvm/asdf/mise/Volta）。
- 升级与回退保留用户在 `science.toml` 中添加的设置（如 `[sandbox]`、`[memory]`）。

## 0.2.0 (2026-10-22)

### 变更 / Changes

- 兼容服务改为纯中继：删除本地重试、排队、路由亲和与交接检测（`session-scheduler`、`route-affinity`、`handoff-detect`、`request-lifecycle`、`upstream-error`）；错误原样返回，客户端断开即取消上游。
- Science 列出 Magpie 全部模型：Claude TUI 模型用 Claude 原名，其他模型以 `claude-x-<原ID>-<哈希>` 别名出现（Science 只显示 `claude-` 开头的 ID）。
- 新增 `install/upgrade --claude <provider>`，默认 `claude-tui`（本机 Magpie 上的 Claude TUI 插件）。
- 只有 Science 主线 agent 携带 `x-session-id: science-<frame>`；fork 与辅助调用无会话。
- 长对话需要 tui-lite 版 TUI Boost runtime；原版 0.2.x 会拒绝被改写或中断的历史。

## 0.1.4 (2026-10-20)

### 打包与运行

- 纳入已验收的本地运行模块：`session-scheduler.mjs`、`handoff-detect.mjs` 与 `route-affinity.mjs`，并保留 `bridge.js` 的帧解析与工具交接逻辑。
- `npm pack` 文件面固定为白名单；新增 `check:package` / `check:release`，拒绝密钥、状态、认证、会话转储、日志、备份与二进制文件。
- 新增离线集成测试：隔离 HOME、复制软件包、执行真实 `stageDeployment` 并校验部署清单。

### 文档

- 明确插件仅面向本机 Claude Science 与回环 Magpie 网关，不绑定特定 VPS；补充安装、升级、doctor、回退与卸载说明。

## [0.1.3](https://github.com/shiyang1026/magpie-claude-science/compare/v0.1.2...v0.1.3) (2026-10-13)


### Bug Fixes

* **setup:** 明确插件安装后的首次初始化步骤 ([f618156](https://github.com/shiyang1026/magpie-claude-science/commit/f618156840f5873ce61a8e52fda5120790c217fb))

## [0.1.2](https://github.com/shiyang1026/magpie-claude-science/compare/v0.1.1...v0.1.2) (2026-10-13)


### Bug Fixes

* **science:** 修复插件缺少模型配置时请求被错误拒绝 ([325bae3](https://github.com/shiyang1026/magpie-claude-science/commit/325bae3210450c30df8e1d6a9ae40e0fa308cc9d))

## [0.1.1](https://github.com/shiyang1026/magpie-claude-science/compare/v0.1.0...v0.1.1) (2026-10-13)


### Bug Fixes

* **icon:** 补齐 Claude Science 原生图标及版权说明 ([70e620f](https://github.com/shiyang1026/magpie-claude-science/commit/70e620f1c504f51db1a97533b003d13c2b504806))
* **science:** 修复安装来源切换后接入失效并完善升级恢复 ([ecd636a](https://github.com/shiyang1026/magpie-claude-science/commit/ecd636a24c3319152c1bce7a1a29bf55a3788b38))

## 0.1.0 (2026-10-13)

### 新功能

- 将 Claude Science 接入 Magpie，通过原 macOS App 入口使用选定模型。
- 提供流式响应兼容、本地独立身份与会话、安装、升级、回退和卸载。
- 增加后台进程归属校验、启动健康检查和故障恢复。

### 测试与发布

- 添加跨平台 CI、包安装验证与真实 Magpie 隔离集成测试。
- 通过 GitHub Actions OIDC 发布 npm 包，并附带 provenance。

### 限制

- 实验版，仅支持 macOS；完整科研流程、长会话及图片支持尚未验证。
