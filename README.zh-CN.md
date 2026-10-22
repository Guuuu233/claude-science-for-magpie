> **社区分支：** 本项目基于 Sia（shiyang1026）的 MIT 许可原项目。npm 的 `magpie-claude-science@latest` **不是本分支**；请从本仓库源码或 GitHub Release 获取。未启用自动 npm 发布。

# Claude Science for Magpie

[English](README.md) · 简体中文

[![CI](https://github.com/Guuuu233/magpie-claude-science/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Guuuu233/magpie-claude-science/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Guuuu233/magpie-claude-science)](https://github.com/Guuuu233/magpie-claude-science/releases)

在 Claude Science 中使用 Magpie 的模型，保留原来的 macOS App 图标。新版本可在 **Magpie → 插件** 页面安装并启用，自动初始化本地接入；之后在 **Magpie → Agent → Claude Science** 中切换模型，照常打开 Science。

**实验版。** 包含 Agent 插件、限定作用范围的 middleware，以及本地托管的后台服务，无需 CSP。已验证 Science **0.1.60**、Magpie **0.1.1219**。

## 快速开始

需要 **macOS**、官方发行的 **Node.js 22+**、已经安装的 **Claude Science.app** 及能正常调用模型的 Magpie。本插件自动配置的是**本地兼容服务**，不会下载或分发 Claude Science 官方程序。

**一键安装（从 v0.2.1 起）：** 在 **Magpie → 插件 → 发现 → GitHub 非官方插件** 中找到 **Guuuu233/magpie-claude-science**，点击安装并启用。如果暂时未出现在发现页，也可以在 Magpie 插件页使用手动 GitHub 地址 `github:Guuuu233/magpie-claude-science#v0.2.1` 安装。仓库发布 v0.2.1 并添加 `magpie-plugin` GitHub Topic 后才会进入 GitHub 发现列表。首次启用时自动选定 Magpie 中的模型、部署本地接入服务和 LaunchAgent；已有托管安装**不会被静默覆盖**。完成后重开 Science；若失败，查看 `~/.config/magpie/claude-science-runtime/autoinstall.log`。

**启用前请注意：** 请先正常退出 Claude Science.app 和正在运行的 `claude-science` 后台进程。只要检测到 Science 仍在运行，自动初始化就会**跳过安装，不会停止现有科研任务**，并将原因记录到 `~/.config/magpie/claude-science-runtime/autoinstall.log`；退出 Science 后，在 Magpie 插件页禁用再启用即可重试。插件会验证 **Node.js ≥22**，同时兼容桌面环境 PATH 较短时常见的 nvm、asdf、mise、Volta 安装。首次无人值守安装优先选择可用的 `claude-tui/claude-opus-*`，其次是其他 TUI 模型或列表首个模型；**安装后请到 Magpie 的 Agent 页面确认、按需调整模型。**

**备选终端安装（已公开的 v0.2.0 Release）：** 如果希望沿用旧版明确管理的安装方式，请启动 Magpie，结束正在运行的 Science 任务，再从 GitHub Release 安装固定版本：

```sh
mkdir -p magpie-science-lite && cd magpie-science-lite
curl -fL https://github.com/Guuuu233/magpie-claude-science/releases/download/v0.2.0/magpie-claude-science-0.2.0.tgz -o science.tgz
tar -xzf science.tgz
cd package
npm install --omit=dev --ignore-scripts
node src/cli.js install
```

按提示选择模型，等终端显示 `Installed` 后，重新打开 **Claude Science.app**，关闭之前的登录页。不要继续使用旧端口的书签。

或者克隆本仓库 v0.2.0 标签后从源码安装：

```sh
git clone --branch v0.2.0 --depth 1 https://github.com/Guuuu233/magpie-claude-science.git
cd magpie-claude-science
npm ci --ignore-scripts
node src/cli.js install
```

按提示选择模型。无人值守安装时，用 `--model` 指定 Magpie 模型列表中的 ID。安装器读取 Magpie 网关端口，并选择空闲的本地端口；更多选项见 `node src/cli.js --help`。

**从 v0.2.1 起，在 Magpie 启用本分支插件会自动执行首次接入。** 安装器配置 macOS LaunchAgent，把运行文件、生产依赖及 Node 复制到独立版本目录。后台运行不再依赖 checkout 或 npm 缓存。部分 Homebrew Node 依赖外部动态库，会被拒绝，需改用官方 Node。

打开原来的 **Claude Science.app**。首次 “Sign in” 仅确认本地浏览器会话，无需登录 Anthropic。保持 Magpie 运行，在其 Agent 页面切换模型。

### 点 Sign in 后仍显示 Sign in on the web / Paste code instead

这表示当前页面进入了 Science 的账号登录流程；先检查接入是否完成，不要以浏览器已有登录状态判断安装成功：

```sh
node src/cli.js doctor  # 在上述解压目录的 package/ 或源码仓库中执行
```

如果提示本地服务未初始化，执行上面的 `install`。如果服务已安装，检查输出中的服务状态和 `sciencePort`，重新打开 App 进入受管服务。仅凭 `localhost:8765` 或其他端口不能判断是否接入成功。如果 `doctor` 仍报错，请提供错误摘要，不要提供令牌、完整私有日志或 `state.json`。

## 本地目标，不绑定 VPS

本插件通过回环兼容服务接入原版 **Claude Science.app**，只连接字面回环地址上的 Magpie 网关（`127.0.0.1` 或 `[::1]`，取自 Magpie 自身设置或 `--gateway`），不会访问远程端点。因此它**不绑定特定 VPS**：任何在本机运行且协议兼容的 Magpie 供应商都可以提供所选模型。软件包不包含服务器地址、凭证或任何 VPS 材料。

## 管理

所有生命周期命令都在 `src/cli.js` 中：

```sh
node src/cli.js install    # 首次安装，在本分支 Release 的 package/ 或源码目录中执行
node src/cli.js upgrade    # 从更新后的源码或软件包准备新版本
node src/cli.js doctor     # 查看运行版本、模型、网关、服务状态及部署校验
node src/cli.js restart    # 结束 Science 任务后重启受管服务
node src/cli.js rollback   # 恢复上一个托管运行版本
node src/cli.js uninstall  # 停止服务并恢复原配置，保留会话数据
```

请在本分支的 GitHub Release 解压目录或源码目录中通过 `node src/cli.js <命令>` 执行管理操作，不要使用原作者的 npm 包。建议保留安装目录；如已删除，可重新获取同版本文件。执行上述生命周期操作前，请先结束正在运行的 Science 任务。升级保留本地身份与会话，启动失败时恢复旧服务。早期依赖源码目录的版本可以通过 `upgrade` 迁移；`rollback` 需要已有上一份托管版本。

## 工作方式

```text
Claude Science → 本地兼容服务 → Magpie → 选定的供应商 / 模型
```

数据、本地身份及分版本运行文件保存在 `~/.config/magpie/claude-science-runtime/`，原凭证和 App 二进制保留。只有确认后台进程归属并通过健康检查后，才重定向原配置。停用或卸载会恢复配置；若检测到用户修改，则保留并报告冲突，交由手动处理。

## 当前限制

- Science 会列出 Magpie 模型目录中的全部模型。Claude TUI 模型以 Claude 原名（如 `claude-opus-5-5`）出现，走 `install --claude <provider>` 指定的 provider（默认 `claude-tui`，即本机 Magpie 上的 Claude TUI 插件；远程 Magpie 的写法如 `my-vps/claude-tui`）。Science 只显示以 `claude-` 开头的 ID，所以其他模型以固定别名 `claude-x-<原ID>-<哈希>` 出现，名称不变，请求仍发往对应的 Magpie 模型。网关始终为回环地址，不绑定 VPS。
- 不提供 Anthropic 托管的搜索、MCP 和账号服务。
- 完整科研流程、长会话和图片支持尚未验证。
- 已自动化测试受管孤儿进程恢复和程序更新检测；真实 macOS 重启竞态及后续 Science 版本仍需验证。Science 更新后，请先结束任务再重启接入。
### 供应商能力兼容性

在 Claude TUI 模型上进行长时间的 Science 对话，需要一个按每个对话自身历史服务的 TUI Boost runtime（tui-lite 版本）：历史能接上原生会话时直接续接，接不上时用这份历史重建。原版 TUI Boost 0.2.x 会拒绝被改写或被中断过的历史（409/502）。其他 Magpie 供应商是普通的无状态模型，不需要任何特殊处理。

- 暂不支持自定义 XDG 配置根或已迁移的 Science 数据目录。

## 开发与发布

```sh
npm test
npm run check:package
npm run check:release
npm run test:integration  # 离线：临时 HOME、复制软件包并执行真实部署路径
```

`check:package` 校验 `npm pack --dry-run` 的精确文件面：已验收的运行模块、文件白名单，以及不得包含密钥、状态、认证、会话转储、日志和二进制。`check:release` 还额外对入口执行 `node --check`。集成测试不需要 Magpie、Claude Science 或网络。

CI 负责检测安装包和集成兼容性。本社区分支通过人工审核后上传 GitHub Release 资产，不启用 npm 自动发布；原 npm 包属于上游维护者。详见[发布政策](docs/publishing.md)。

通过 [Issues](https://github.com/Guuuu233/magpie-claude-science/issues) 反馈问题，请附版本、`doctor` 输出和复现步骤，不要附带凭证或私人日志。更多内容：[运维说明](docs/operations.zh-CN.md)、[Magpie 文档](https://usemagpie.ai/docs/zh/plugins)。

## 许可证

[MIT](LICENSE)。独立社区项目，与 Anthropic、Magpie 无隶属关系。

Claude Science 图标归原权利人所有，不适用本项目的 MIT 许可证。
