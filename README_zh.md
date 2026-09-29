# OpenCodexMicro

通过 Ulanzi Studio，使用 Ulanzi D200 系列键盘控制 Codex Desktop、Codex CLI、
Antigravity Desktop 和 Spotify。[English overview](README.md)

Ulanzi Studio 负责物理设备。本项目提供四个插件和三个后台 Bridge：

| 插件 | 本机接口 |
| --- | --- |
| Codex App | `127.0.0.1:17373`；Desktop CDP 使用 `127.0.0.1:9222` |
| Codex CLI | `127.0.0.1:17376`；连接独立安装的 managed app-server |
| Antigravity | `127.0.0.1:17374` |
| Spotify | 插件内置本机 API：`127.0.0.1:17375` |

三个开发工具 Bridge 的 WebSocket `/events` 与 HTTP 共用各自端口。本机 API
需要身份验证，请使用运维文档中的诊断工具。开发工具插件各有六个任务按键；
不同应用的同名按键不一定具有相同能力。

## 文档入口

- [安装、配置、更新与诊断](docs/setup-and-operations.md)
- [功能范围、限制与实际设备验收](docs/feature-parity.md)
- [Codex 与其他代码代理的操作指南](AGENTS.md)

安装需要 macOS 13+、Node.js 20+、Ulanzi Studio 3.0.1+ 及所选插件对应的应用。
替换插件前应退出 Ulanzi Studio。启动 `Codex Bridge.app` 会退出并重新启动
Codex Desktop；请先保存工作，不要仅为检查安装而启动它。

项目代码采用 [MIT 许可证](LICENSE)。归属、独立性与责任范围见
[NOTICE.md](NOTICE.md)，第三方依赖许可见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。详细操作流程集中在上述文档中。
