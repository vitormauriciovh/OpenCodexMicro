# OpenCodexMicro
 
**通过 Ulanzi Studio，用 Ulanzi D200 Series 操控 Codex Desktop、Antigravity AI Agent 及 Spotify 音乐控制。**
 
[English](README.md)
 
OpenCodexMicro 通过原生 Ulanzi Studio 插件与本机回环 Bridge，将现代开发者工具与媒体控制器连接到 Ulanzi D200 系列键盘。仓库提供面向 **Codex Desktop**、**Antigravity AI Agent** 和 **Spotify Music Picker** 的独立插件套件。

![Ulanzi D200 Series 上的 OpenCodexMicro](docs/images/ulanzi-deck-showcase.jpg)
 
## 功能特性一览

<p align="center">
  <img src="docs/images/ulanzi-agent-keys.jpg" alt="Ulanzi Deck Agent Keys" width="85%" />
</p>
 
### Codex Desktop 深度集成
| 功能 | 行为 |
| --- | --- |
| **五个实时任务卡片** | 展示 Codex 最近任务，附带模型标签（`5.6 TERRA`、`Claude 3.7`）、实时耗时计时器、状态角标（`WORKING`、`COMPLETED`、`ATTENTION`、`IDLE`）及对话标题。 |
| **5小时与每周额度仪表盘** | 大环形进度条显示 5 小时与每周剩余额度，带重置倒计时（如 `RESET 2H 15M`、`RESET 5H`、`RESET 7D`）。 |
| **任务与 Token 监控** | 监控当前活跃任务类型、模型思考强度（Reasoning Effort: Low/Med/High）及上下文窗口消耗。 |
| **Agent 审批与控制** | 一键 `APPROVE` / `PROCEED` 确认、`CANCEL` / `DENY` 拒绝，以及待处理任务数量角标。 |
| **快捷指令 Prompt** | 一键触发 Test & Fix 单元测试修复、Code Review 代码审查和 Conventional Commit 提交信息生成。 |
| **旋钮导航与滚动** | 按下打开最新任务；左/右旋转通过 Ulanzi Studio hotkey 协议向上/向下滚动。 |

### Antigravity AI Agent 集成
| 功能 | 行为 |
| --- | --- |
| **五个实时 Session 卡片** | 展示 Antigravity 活跃会话、执行状态、模型指示器与耗时计时器。 |
| **Agent 状态 HUD** | 实时显示 Agent 运行状态（`PLANNING`、`EXECUTING`、`WAITING`、`IDLE`）、会话标题与计时器。 |
| **一键计划审批** | 单击 `PROCEED` 批准实施计划或工具调用，单击 `CANCEL` 立即停止执行。 |
| **Subagents 与 Token 监控** | 实时子 Agent 数量计数、累积会话 Token 跟踪与上下文用量环形图。 |
| **AI 斜杠指令** | 专属按键触发 `/boost`（深度思考与验证）、`/grill-me`（架构访谈）和 `/goal`（长期自主任务）。 |
| **产物一键查看** | 单击按键直接在 VS Code 中聚焦并打开实施计划（Plan）与总结（Walkthrough）文件。 |

### Spotify Music Picker 音乐控制器
| 功能 | 行为 |
| --- | --- |
| **宽屏 Now Playing HUD** | 宽屏显示正在播放曲目、艺术家、高清专辑封面与播放进度条。 |
| **音乐插槽 1–10** | 快捷访问精选歌单、Daily Mix 和常用专辑，带实时播放状态指示。 |
| **播放与音量控制** | 播放/暂停、下一首、上一首、收藏喜欢、随机播放、单曲循环以及旋钮音量 / 歌单翻页调节。 |

### 安全与通信模型
| 通信机制 | 安全边界 |
| --- | --- |
| **仅限本机回环** | Codex Bridge（`127.0.0.1:17373` & CDP `127.0.0.1:9222`）和 Antigravity Bridge（`127.0.0.1:17374` & WS `127.0.0.1:17375`）严格仅绑定 localhost。 |

---

## 安装说明
 
### 环境要求
 
- macOS 13（Ventura）或更高版本；
- Codex Desktop 和/或 Antigravity（VS Code）；
- Ulanzi Studio 3.0.1 或更高版本；
- 已在 Ulanzi Studio 中连接 Ulanzi D200 系列设备；
- Node.js 20 或更高版本（用于仓库安装与 Bridge 服务）。

---

### 1. 一键完整安装（所有插件与 Bridge）

如需一次性安装全部 3 款插件并启动两个 Bridge 服务：

```bash
git clone https://github.com/UlanziTechnology/OpenCodexMicro.git
cd OpenCodexMicro
npm install
npm run install:all
npm run setup:all
```

> **注意：** 在执行 `npm run install:all` 之前请先退出 Ulanzi Studio。

---

### 2. 按需选择性安装

#### Codex Micro 插件与 Bridge
```bash
# 安装 Codex Micro 插件至 Ulanzi Studio
npm run install:plugin

# 构建并注册 Codex Bridge LaunchAgent 服务（~/Applications/Codex Bridge.app）
npm run setup
```

#### Antigravity 插件与 Bridge
```bash
# 安装 Antigravity 插件至 Ulanzi Studio
npm run install:plugin:antigravity

# 构建并注册 Antigravity Bridge LaunchAgent 服务
npm run setup:antigravity
```

#### Spotify Music Picker 插件
```bash
# 安装 Spotify 插件至 Ulanzi Studio
npm run install:plugin:spotify
```

---

### 3. 启动与验证

#### Codex Desktop
请始终通过 `Codex Bridge.app` 启动 Codex Desktop 以启用 CDP 调试端点：

```bash
open ~/Applications/Codex\ Bridge.app
```

验证 Codex Bridge 连接：
```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state
```

#### Antigravity Bridge
Antigravity Bridge 安装后由 LaunchAgent（`io.openantigravitymicro.bridge`）在后台自动运行。验证命令：
```bash
curl http://127.0.0.1:17374/health
curl http://127.0.0.1:17374/state
```

#### 在 Ulanzi Studio 中配置
1. 启动 Ulanzi Studio。
2. 在左侧动作列表中，可找到 **AI** 分类（包含 **Codex Micro** 与 **Antigravity**）和 **Music** 分类（包含 **Spotify Music Picker**）。
3. 将所需 Action 拖拽至 Ulanzi D200 虚拟键盘对应的按键或旋钮槽位。

---

### 4. LLM / Agent 自动化安装规范
 
LLM 或代码 Agent 必须遵循以下流程：
 
1. 阅读 [AGENTS.md](AGENTS.md)，检查 `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/` 下已安装插件的 manifest。
2. 校验插件 UUID：
   - Codex Micro：`com.ulanzi.ulanzistudio.codexmicro`
   - Antigravity：`com.ulanzi.ulanzistudio.antigravity`
   - Spotify：`com.ulanzi.ulanzistudio.spotify`
3. 若需安装或修复，参考 [`skills/install-ulanzi-studio-plugin/SKILL.md`](skills/install-ulanzi-studio-plugin/SKILL.md) 与 [`skills/setup-codex-bridge/SKILL.md`](skills/setup-codex-bridge/SKILL.md)。
4. 分别清晰汇报插件安装与 Bridge 后台服务的运行状态。

---

## 配置与布局
 
实体布局完全由 Ulanzi Studio 管理。
 
- **系统辅助功能权限**：请在 macOS“系统设置 > 隐私与安全性 > 辅助功能”中允许 Ulanzi Studio，以支持旋钮模拟滚轮滚动。
- 动作详解与推荐键位布局参见[配置详解](docs/configuration.md)。
- 后台服务运维、日志查看与排错参见[安装与运行](docs/setup-and-operations.md)。

---

## 项目文档
 
- [配置详解](docs/configuration.md)
- [安装与运行](docs/setup-and-operations.md)
- [架构设计](docs/architecture.md)
- [工程约束与要点](docs/errors.md)

---

## 许可与声明
 
项目自有代码采用 [MIT License](LICENSE)。上游署名、实质改动、Ulanzi 维护关系、与 OpenAI 的独立关系及责任边界见[改动与责任声明](NOTICE.md)，运行时和构建依赖的许可见[第三方许可声明](THIRD_PARTY_NOTICES.md)。
