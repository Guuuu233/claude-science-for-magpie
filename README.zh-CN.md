> **社区分支：** 基于 Sia（[shiyang1026/magpie-claude-science](https://github.com/shiyang1026/magpie-claude-science)）的 MIT 许可原项目。请从 Magpie 插件页或本仓库 GitHub Release 安装。npm 上的 `magpie-claude-science@latest` 是上游项目，**不是本分支**；本分支不发布到 npm。

# Claude Science for Magpie

[English](README.md) · 简体中文

[![CI](https://github.com/Guuuu233/claude-science-for-magpie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Guuuu233/claude-science-for-magpie/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Guuuu233/claude-science-for-magpie)](https://github.com/Guuuu233/claude-science-for-magpie/releases)

在 Claude Science 中使用 Magpie 的模型，保留原来的 macOS App 和图标。在 **Magpie → 插件** 安装 **Claude Science for Magpie**：本地接入自动完成，之后的插件更新会在 Science 空闲时自动生效。在 **Magpie → Agent → Claude Science for Magpie** 中切换模型，照常打开 Science 即可。

**实验版。** 包含 Agent 插件、限定作用范围的 middleware，以及本地托管的后台服务，无需 CSP。日常使用环境：Science **0.1.60**、Magpie **0.1.1318**。

## 快速开始

需要 **macOS**、官方发行的 **Node.js 22+**、已经安装的 **Claude Science.app** 及能正常调用模型的 Magpie。本插件配置的是**本地兼容服务**，不会下载或分发 Claude Science 官方程序。

1. **先退出 Claude Science**：包括窗口和正在运行的 `claude-science` 后台进程。初始化绝不停止正在运行的 Science：检测到 Science 在运行就跳过，并把原因写进 `~/.config/magpie/claude-science-runtime/autoinstall.log`；退出 Science 后在插件页把插件关掉再打开即可重试。
2. **安装插件。** 在 **Magpie → 插件 → 发现 → GitHub 非官方插件** 中找到 **Guuuu233/claude-science-for-magpie** 并安装；发现页里没有时，可以在插件页手动填写 `github:Guuuu233/claude-science-for-magpie`。不要加 `#标签`：标签不会移动，Magpie 就永远不会提示更新。（v0.2.4 之前仓库名为 `Guuuu233/magpie-claude-science`，用旧地址安装的经 GitHub 自动跳转照常更新。）
3. **初始化完成后打开 Claude Science.app。** 首次 “Sign in” 只确认本地浏览器会话，无需登录 Anthropic。初始化优先选择可用的 `claude-tui/claude-opus-*`，其次是其他 Claude TUI 模型或列表里第一个模型：**请到 Magpie 的 Agent 页面确认、按需调整。** 出问题时查看 `autoinstall.log`。

初始化会验证 Node.js 22+（也会找到桌面环境 PATH 较短时漏掉的 nvm、asdf、mise、Volta 安装），把运行文件、生产依赖和 Node 复制到独立版本目录，以 macOS LaunchAgent 运行；后台服务不依赖插件目录。部分 Homebrew Node 依赖外部动态库，会被拒绝，需改用官方 Node。

### 更新

主分支发布新版本后，Magpie 的 **插件** 页会提示更新（也可运行 `magpie plugin update`）。插件更新后，只在 Science 空闲时替换本地服务：Science 窗口已关闭、没有进行中的模型请求、且最近 10 分钟没有请求。否则每 5 分钟再检查一次，绝不打断正在运行的任务。更新保留会话、登录状态和 `science.toml` 里的设置，新服务启动失败时自动恢复旧服务；过程记录在 `autoinstall.log`。

以前用 `#v0.2.x` 标签安装的，不带标签重新添加一次插件，之后才能收到更新。用 Release 软件包或源码目录安装的不会自动更新，请在该目录运行 `node src/cli.js upgrade`。

### 终端安装（备选）

想自己管理安装时，请启动 Magpie，结束正在运行的 Science 任务，再安装固定版本：

```sh
mkdir -p claude-science-for-magpie && cd claude-science-for-magpie
curl -fL https://github.com/Guuuu233/claude-science-for-magpie/releases/download/v0.2.4/claude-science-for-magpie-0.2.4.tgz -o science.tgz
tar -xzf science.tgz
cd package
npm install --omit=dev --ignore-scripts
node src/cli.js install
```

或者从源码标签安装：

```sh
git clone --branch v0.2.4 --depth 1 https://github.com/Guuuu233/claude-science-for-magpie.git
cd claude-science-for-magpie
npm ci --ignore-scripts
node src/cli.js install
```

按提示选择模型；无人值守安装时用 `--model` 指定 Magpie 模型列表中的 ID。安装器读取 Magpie 网关端口，并选择空闲的本地端口；更多选项见 `node src/cli.js --help`。终端显示 `Installed` 后，重新打开 **Claude Science.app**，关闭之前的登录页，不要继续使用旧端口的书签。

### 点 Sign in 后仍显示 Sign in on the web / Paste code instead

这表示页面进入了 Science 的账号登录流程：本地服务没有应答。先运行 `doctor`，不要以浏览器已有登录状态判断安装成功。通过插件页安装的，在已安装的版本里运行：

```sh
R=~/.config/magpie/claude-science-runtime; P=$(node -p "require('$R/state.json').pluginSpec"); "$P/bin/node" "$P/src/cli.js" doctor
```

终端安装的，在其 `package/` 或源码目录运行 `node src/cli.js doctor`。未初始化时，查看 `autoinstall.log`（插件安装）或执行 `install`（终端安装）；已安装时，检查服务状态和 `sciencePort`，再重新打开 App。仅凭 `localhost:8765` 或其他端口不能判断是否接入成功。求助时请提供 `doctor` 摘要，不要提供令牌、完整私有日志或 `state.json`。

## 本地目标，不绑定 VPS

本插件通过回环兼容服务接入原版 **Claude Science.app**，只连接字面回环地址上的 Magpie 网关（`127.0.0.1` 或 `[::1]`，取自 Magpie 自身设置或 `--gateway`），不会访问远程端点。因此它**不绑定特定 VPS**：任何在本机运行且协议兼容的 Magpie 供应商都可以提供所选模型。软件包不包含服务器地址、凭证或任何 VPS 材料。

## 管理

所有生命周期命令都在 `src/cli.js` 中（插件安装的，用上面 `"$P/bin/node" "$P/src/cli.js"` 的写法）：

```sh
node src/cli.js install    # 首次安装，在 Release 的 package/ 或源码目录中执行
node src/cli.js upgrade    # 从更新后的源码或软件包准备新版本
node src/cli.js doctor     # 查看运行版本、模型、网关、服务状态及部署校验
node src/cli.js restart    # 结束 Science 任务后重启受管服务
node src/cli.js rollback   # 恢复上一个托管运行版本
node src/cli.js uninstall  # 停止服务并恢复原配置，保留会话数据
```

不要用原作者的 npm 包执行这些命令。执行生命周期操作前，请先结束正在运行的 Science 任务。升级保留本地身份、会话和 `science.toml` 设置，启动失败时恢复旧服务。早期依赖源码目录的版本可以通过 `upgrade` 迁移；`rollback` 需要已有上一份托管版本。

## 工作方式

```text
Claude Science → 本地兼容服务 → Magpie → 选定的供应商 / 模型
```

数据、本地身份及分版本运行文件保存在 `~/.config/magpie/claude-science-runtime/`，原凭证和 App 二进制保留。只有确认后台进程归属并通过健康检查后，才重定向原配置。停用或卸载会恢复配置；若检测到用户修改，则保留并报告冲突，交由手动处理。

Science 会把本地加密密钥另存一份到 macOS 钥匙串（服务名 `com.anthropic.operon-cli`），并以钥匙串为准：两者不一致时，它用钥匙串里的密钥覆盖 `auth/encryption.key`。不要手工修改或删除其中任何一处。

## 当前限制

- Science 会列出 Magpie 模型目录中的全部模型。Claude TUI 模型以 Claude 原名（如 `claude-opus-5-5`）出现，走 `install --claude <provider>` 指定的 provider（默认 `claude-tui`，即本机 Magpie 上的 Claude TUI 插件；远程 Magpie 的写法如 `my-vps/claude-tui`）。Science 只显示以 `claude-` 开头的 ID，所以其他模型以固定别名 `claude-x-<原ID>-<哈希>` 出现，名称不变，请求仍发往对应的 Magpie 模型。
- 在 Claude TUI 模型上进行长时间的 Science 对话，需要 [Claude TUI Boost](https://github.com/Guuuu233/claude-tui-boost) **v0.2.12 或更新版本**，它按每个对话自身的历史服务。更早的 0.2.x 会拒绝被改写或被中断过的历史（409/502）。其他 Magpie 供应商是普通的无状态模型，不需要特殊处理。
- 不提供 Anthropic 托管的搜索、MCP 和账号服务。
- 完整科研流程、长会话和图片支持尚未验证。
- 已自动化测试受管孤儿进程恢复和程序更新检测；真实 macOS 重启竞态及后续 Science 版本仍需验证。Science 更新后，请先结束任务再重启接入。
- 暂不支持自定义 XDG 配置根或已迁移的 Science 数据目录。

## 开发与发布

```sh
npm test
npm run check:package
npm run check:release
npm run test:integration  # 离线：临时 HOME、复制软件包并执行真实部署路径
```

`check:package` 校验 `npm pack --dry-run` 的精确文件面：已验收的运行模块、文件白名单，以及不得包含密钥、状态、认证、会话转储、日志和二进制。`check:release` 还额外对入口执行 `node --check`。集成测试不需要 Magpie、Claude Science 或网络。

CI 负责检测安装包和集成兼容性。版本在主分支打标签，经人工审核后上传 GitHub Release 资产；主分支始终保持为最新正式版，Magpie 安装和更新的就是它。不发布 npm；原 npm 包名属于上游维护者。详见[发布政策](docs/publishing.md)。

通过 [Issues](https://github.com/Guuuu233/claude-science-for-magpie/issues) 反馈问题，请附版本、`doctor` 输出和复现步骤，不要附带凭证或私人日志。更多内容：[运维说明](docs/operations.zh-CN.md)、[Magpie 文档](https://usemagpie.ai/docs/zh/plugins)。

## 许可证

[MIT](LICENSE)。独立社区项目，与 Anthropic、Magpie 无隶属关系。

Claude Science 图标归原权利人所有，不适用本项目的 MIT 许可证。
