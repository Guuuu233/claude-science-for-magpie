# 更新日志 / Changelog

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
