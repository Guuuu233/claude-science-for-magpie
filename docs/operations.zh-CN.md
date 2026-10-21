# 运维与兼容性

## 安装与配置

使用官方 Node.js 22/24，启动 Magpie 后执行 `npx magpie-claude-science@latest install`（源码目录中可用 `node src/cli.js install`），从现有模型中选择。非交互安装必须提供 `--model`；升级优先保留已选模型。仅在 Magpie 中添加插件不等于完成系统服务初始化。

若首次 Sign in 后出现 `Sign in on the web` / `Paste code instead`，先执行 `npx magpie-claude-science@latest doctor`。未初始化时执行 `install`，成功后重新打开原 App，并关闭旧登录页；已初始化时核对服务状态和 `sciencePort`。不要将重新登录 Anthropic 作为接入步骤。

可用选项：

| 选项 | 默认行为 |
| --- | --- |
| `--model` | 初次交互选择；升级保留有效选择 |
| `--gateway` | 读取 Magpie settings.json 的 port，否则 3425；只接受回环地址 |
| `--magpie` | 显式路径、MAGPIE_BIN、PATH、标准 App 路径 |
| `--science` | 显式路径、SCIENCE_BIN、PATH、Science 运行目录或 App |
| `--science-port` | 优先 18980，冲突时选择空闲端口 |
| `--preview-port` | 优先 18981，冲突时选择空闲端口 |
| `--bridge-port` | 优先 18982，冲突时选择空闲端口 |

显式指定的端口如果被占用，安装报错。预留端口在启动前释放，仍存在竞争窗口；服务必须通过进程归属和健康检查，才会重定向原 App 配置。

显式网关覆盖会保留；未覆盖时运行服务跟随 Magpie 写入的网关。暂不支持自定义 XDG 配置根或已迁移的 Science 数据目录。

## 稳定运行目录

`~/.config/magpie/claude-science-runtime/` 包含：

- `releases/<hash>/`：运行代码、生产依赖、Node 副本与校验清单。
- `data/`、`auth/`：独立 Science 会话和本地启动身份。
- `state.json`：当前版本、上一个版本、端口和配置；包含本地令牌，不要公开。
- `status.json`、`service.log`、`science.log`：状态与诊断；日志可能包含会话内容。
- 恢复 journal、进程归属记录和操作锁：用于恢复配置与串行化操作。

安装器从真实 Node 模块解析路径复制依赖，兼容 npm/npx 提升依赖的布局。Node 副本必须仅依赖 macOS 系统动态库；部分 Homebrew 构建需要换为官方 Node。升级前校验运行文件，不修改 Science 和 Magpie 的 App 签名。

## 升级、回退和卸载

先结束正在运行的 Science 任务，再从新版本源码或已安装的新包执行：

```sh
node src/cli.js upgrade
node src/cli.js doctor
```

升级先准备不可变运行版本，再切换服务。启动失败恢复旧状态和服务；会话与加密身份不重建。`rollback` 切回上一个托管版本；首次迁移旧的源码目录安装时，还没有旧的托管版本可回退。

```sh
node src/cli.js rollback
node src/cli.js restart
node src/cli.js uninstall
```

卸载恢复原 Science 配置，移除当前服务，保留独立会话、身份及版本文件。卸载后再安装会采用当时的原配置，并保留独立身份。不要手工删除加密密钥。

## 故障恢复

- 后台进程归属同时核对 PID、启动时间、命令行和数据目录；不会仅凭旧 PID 杀进程。
- 管理器重启会回收有完整归属记录的孤儿 Science，恢复配置，再启动受管服务。
- 正确的 Science lock 文件和健康响应都通过后，才启用原图标重定向；其他程序占用端口不会被误认。
- Science 可执行文件变化时，状态显示 `restartRequired`，不直接中断当前任务；完成任务后运行 `restart`。
- 检测到用户修改的配置时保留修改，报告恢复冲突。
- `install.lock` 或 `runtime-owner.json.recovery` 若因操作中断而遗留，会保守拒绝继续。先检查 doctor、日志及实际进程；不要在操作仍运行时删除锁。

真实 macOS 重启时序、Science 自身 watchdog 的进程替换，以及未来版本行为仍需实机验证。遇到登录错误先检查本地服务，不要把重新登录 Anthropic 当作修复步骤。

## 功能边界

Science 会列出 Magpie 模型目录中的全部模型：Claude TUI 模型以 Claude 原名（如 `claude-opus-5-5`）出现，走 `install --claude <provider>` 指定的 provider（默认 `claude-tui`）；其他模型以固定别名 `claude-x-<原ID>-<哈希>` 出现（Science 只显示 `claude-` 开头的 ID），请求仍发往对应的 Magpie 模型。短对话和协议级工具调用已验证；图片、长会话压缩和完整科研流程尚未验证。Anthropic 托管 MCP、搜索及账号服务不由插件提供，相关 401 日志不代表模型推理一定失败。

本地验证：`npm test`、`npm run check:package`、`npm run test:integration`。GitHub CI 执行同类检查；它使用模拟 Science，不下载或运行用户的真实科研数据。

首次登录的实机验收必须使用独立的 HOME、数据目录和新生成的本地身份，并在无痕窗口或无原有登录状态的独立浏览器会话中打开该测试实例生成的一次性登录链接。确认 Sign in 后进入工作区，而非账号登录页；不能仅检查已有会话或 `/health`。同时检查只安装 Magpie 插件时的初始化提示。测试结束停止测试进程，不清除用户浏览器 Cookie 或真实会话。
