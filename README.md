# dsh-git-graph-view · DSH Git 图谱可视化

**最新版本**：[v0.2.1](https://github.com/LUOZIR/dsh-git-graph-view/releases/tag/v0.2.1) · [下载 tgz](https://github.com/LUOZIR/dsh-git-graph-view/releases/download/v0.2.1/dsh-git-graph-view-0.2.1.tgz) · [CHANGELOG](CHANGELOG.md)

> **English summary** — A community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI:
> adds a **Git Graph** tab to the conversation view that renders the workspace's commit DAG (lanes, branch/tag/remote refs,
> commit details) in a read-only view. Built as a dual-face `dsh` bundle plugin (host node half + browser client half),
> zero runtime dependencies, no build step. UI follows the official DSH design tokens and layouts.

为 DSH（DeepSeek Harness）Web GUI 增加 **「Git 图谱」** 视图：把当前会话工作区（或任一已注册工作区）的
Git 提交 DAG 渲染成可读的彩色泳道图 —— 分叉/合流、HEAD、分支/标签/远程引用一目了然，点任意提交可看
完整提交信息与文件变更。

- **只读**：只执行 `git rev-parse / status / log / show / diff-tree`；不切分支、不建 worktree、不写仓库。
- **零依赖、零构建**：host 半体只用 Node 内置模块；client 半体是手写 `window.__ModuleLoader__` 工厂，React 由宿主提供。
- **对齐官方界面**：字体层级、圆角/描边语言、明暗主题全部使用官方 theme 令牌
  （`--dsw-font-*`、`--dsw-radius-*`、`--dsw-alias-*`、`body[data-ds-dark-theme]`），
  并采用官方非聊天视图同款的外壳集成方式（`data-conversation-composer-overlay`）—— 左侧图谱列表与右侧
  详情抽屉各自拥有独立滚动条。设计规范见 [docs/DESIGN.md](docs/DESIGN.md)。
- **双半体 bundle 插件**：`dsh.bundle.patch` + `dsh.client`，安装为 DSH profile 的一个 bundle 层。

## 功能

- 会话页新增「Git 图谱」标签（order=6，位于「对话」与「轨迹」之间）。
- 头部：仓库图标块、仓库名、分支/游离 HEAD、变更/冲突/ahead-behind 状态胶囊、工作区下拉、刷新、回到 HEAD。
- 工具条：提交搜索（按 subject / 作者 / sha / ref 匹配并淡化不匹配行）+ `N 个提交 · M 分支 · K 标签` 摘要。
- 提交列表（46px 两行）：SVG 泳道图（分叉 / 合流 / 八爪鱼合并 / 被截断的父提交）、带图标的 refs chip
  （HEAD / 本地分支 / 远程分支 / 标签）、subject、作者、相对时间、短 sha；hover / 选中强调、
  骨架屏加载、↑/↓/Enter/Esc 键盘导航。
- 工作区选择器：来自 DSH 已注册工作区列表；当前会话工作区不是 Git 仓库时可直接切换查看别的仓库。
- 提交详情抽屉（380px，可独立滚动）：完整 message、作者头像/邮箱/时间、完整 sha（可复制）、
  父提交（可点选）、合并标记、文件状态色块与 `+/-` 统计。
- 分页：默认 200 条，「加载更多（+200）」到 1000 条；20 秒内存缓存；窗口重新聚焦时自动刷新。
- 明暗主题按 DSH 的 `data-ds-dark-theme` 切换；中英文案按页面语言自动选择。
- 明确的空态与错误态：非 Git 仓库、未注册工作区、git 缺失、超时、宿主路由不可用等。

## 界面

标签栏：`对话 | Git 图谱 | 轨迹`（本插件 order=6；「对话」0、「轨迹」10）。

```
┌──────────────────────────────────────────────────────────────────────┐
│ [icon] my-repo  [main] [●2 变更] [↑1]          [工作区 ▾]  [↻] [HEAD] │
│ ⌕ 搜索提交 / 作者 / sha              176 个提交 · 4 分支 · 2 标签     │
├──────────────────────────────────────────────────────────────────────┤
│  ●─┬──────── [main] [origin/main]  revert: enforce one single-cell…  │
│    │          alice · 3 天前 · 3caf8cf                         │
│  │  ├─●───── fix: stabilize AI at high gravity with one-tick …       │
│  │  ├─●───── fix: let AI fall at player gravity and act once …       │
│  …                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ 已加载 176 条                                       [加载更多 +200]  │
└──────────────────────────────────────────────────────────────────────┘
```

> 截图待补：欢迎在 Issue 里贡献明/暗主题截图。

## 环境要求

- DSH 0.2.1 系列（开发与验证于 `0.2.1-rc.5` 桌面版）。依赖官方 `conversation.view` 槽位与
  client-modules 双半体加载机制。
- 仅运行插件不需要 Node；只有开发/测试需要 Node **20.11+**（使用 `import.meta.dirname` 与 `node:test`）。
- 宿主进程 PATH 中需要有 `git`（Windows 上也会探测 `C:\Program Files\Git\cmd\git.exe`）。

## 安装

### 方式 A：web profile（源码 checkout 运行 Harness 的用户）

```sh
dsh plugin --profile web add github:LUOZIR/dsh-git-graph-view#main
# 安装后重启 web：dsh web
```

锁定版本可把 `#main` 换成 tag，例如 `#v0.2.1`。

### 方式 B：DSH Desktop（桌面应用，推荐用 GUI 安装器）

1. 打开 DSH Web GUI → 设置 →「插件」分区（或侧边栏插件面板）→ 安装；
2. 粘贴下面任一种来源：
   - GitHub 仓库：`https://github.com/LUOZIR/dsh-git-graph-view`
   - 或本地目录 / `npm pack` 生成的 `.tgz` 绝对路径
3. **完全退出并重新启动** DeepSeek Harness（bundle 层在启动时合成）。

> Desktop profile 由 Electron 应用独占，`dsh plugin --profile desktop ...` 会被拒绝，因此桌面端不要用 CLI。

### 方式 C：手动安装（GUI 不接受来源时的回退）

> 会修改 `$env:DSH_HOME` 下的 profile 目录，请先备份。

1. 打包（或直接使用 release 里的 tgz）：
   ```sh
   npm pack
   ```
2. 把 tgz 复制到 `$env:DSH_HOME\profiles\desktop\vendor\`；
3. 编辑 `$env:DSH_HOME\profiles\desktop\package.json`：
   - `dependencies` 增加 `"dsh-git-graph-view": "file:vendor/dsh-git-graph-view-0.2.1.tgz"`
   - `dsh.profile.bundles` 在 `"gal-view"` 之类条目附近加入 `"dsh-git-graph-view"`；
4. 把 tgz 解包到 `$env:DSH_HOME\profiles\desktop\node_modules\dsh-git-graph-view\`
   （保留包内 `package.json`、`lib/`、`cordis.patch.yml` 结构即可被 loader 解析）；
5. 重启 DSH。

仓库内 [scripts/install-profile.ps1](scripts/install-profile.ps1) 封装了 2–4 步（含备份/校验/卸载），
可用 `powershell -ExecutionPolicy Bypass -File scripts/install-profile.ps1` 执行；
安装后可用 `node scripts/validate-install.mjs` 做只读校验。

## 验证

1. 重启后检查宿主启动标记：`%TEMP%\dsh-git-graph-view-boot.json`（host 半体 apply 时写入版本/路由/时间）；
2. 打开任意会话 → 标签栏出现「Git 图谱」；
3. 若当前工作区不是 Git 仓库，会显示空态与工作区下拉：切到一个已注册的仓库工作区，应看到完整图谱；
4. 点一行提交 → 右侧详情抽屉出现 message / 作者 / 文件列表；左侧列表滚动与右侧详情滚动互不影响；
5. 若启动失败：查看 `$env:DSH_HOME\logs\startup-*.log` 的启动诊断，并按下文回滚。

## 架构

```
浏览器（lib/client.js）                          宿主 Node（lib/index.js）
conversation.view「Git 图谱」标签                 /git-graph-view 前缀路由
  │  sessionId → sessions.list…cwd                ├─ 信任闸（loopback / 跨站 / Origin）
  │  POST /git-graph-view/graph {path,limit}      ├─ 工作区闸（realpath ∈ 已注册工作区）
  ├──────────────────────────────────────────────▶├─ lib/git.js     execFile 只读 git
  │  POST /git-graph-view/commit {path,sha}       ├─ lib/parse.js   log/status/numstat 解析
  │  POST /git-graph-view/workspaces              ├─ lib/service.js 业务组合
  │◀──────────────────────────────────────────────┤─ lib/graph.js   泳道布局（纯函数）
  └─ React + 行内 SVG 渲染                        └─ lib/http.js   envelope / body 上限
```

- 详细接口契约：[docs/CONTRACT.md](docs/CONTRACT.md)
- 视觉规范与官方主题令牌：[docs/DESIGN.md](docs/DESIGN.md)

### HTTP API（前缀 `/git-graph-view`，POST + `application/json`）

| 路由 | 入参 | 返回 |
|---|---|---|
| `/graph` | `{path, limit?}` | `{repo, commits[], lanes, truncated}` |
| `/commit` | `{path, sha}` | `{sha, subject, body, author, parents, refs, isMerge, stats, files[]}` |
| `/workspaces` | `{}` | `{workspaces:[{path,title}]}` |
| `/health` | GET | `{name, version, up}`（诊断用） |

统一 envelope：`{ok:true,value}` / `{ok:false,error:{code,message}}`；
错误码：`bad-request | not-a-workspace | not-a-repo | git-missing | timeout | git-failed | internal`。

### 安全模型

- **只读**：`GIT_OPTIONAL_LOCKS=0`，只跑读命令；不缓存到磁盘、不写仓库。
- **工作区闸**：请求 `path` 必须 `realpath` 后等于 `ctx.workspaceRegistry` 中某个已注册工作区
  （Windows 大小写不敏感），浏览器无法让宿主对任意目录执行 git。
- **信任闸**：仅 loopback socket + loopback Host + 非 `cross-site` + Origin 主机一致
  （桌面壳 `dsh-app:` 协议页放行）；不是认证，但封死远程 Web UI / 跨站页面的读取。
- **无 shell**：git 一律按 argv 数组 `execFile`，路径含空格/中文安全；`GIT_TERMINAL_PROMPT=0` 防交互卡死。

## 开发与测试

```sh
git clone https://github.com/LUOZIR/dsh-git-graph-view.git
cd dsh-git-graph-view

npm test          # 全部测试（同进程运行，受限沙箱也能跑）
npm run check     # 对 host 与 client 全部 .js 做语法检查
npm pack          # 产出可安装的 tgz
```

测试组成：

| 文件 | 覆盖 |
|---|---|
| `test/parse.test.mjs` | git 输出解析（NUL/RS、refs 分类、porcelain v2、numstat、show body） |
| `test/graph.test.mjs` | 泳道布局：线性/分叉/合流/八爪鱼/截断父提交/1000 条性能与前向稳定性 |
| `test/routes.test.mjs` | 信任闸、工作区闸、limit/sha 校验、错误码、envelope、403/405/415/400/404 |
| `test/fixtures.test.mjs` | 用真实 git 输出 fixture 回归解析与 service 端到端 |
| `test/client-contract.test.mjs` | client 半体契约：ModuleLoader、槽位注册、样式/几何、`__test` 纯函数 |
| `test/integration-git.test.mjs` | 真实 `git init` 临时仓库端到端（禁止 spawn 的环境自动 skip） |

**fixture 重建**：`scripts/make-fixtures.ps1` 会建一个确定性临时仓库、抓取原始 git 输出到
`test/fixtures/git-outputs.json` 并清理临时仓库（PowerShell 7）。CI/开发机若无法 spawn 子进程，
`integration-git.test.mjs` 会自动跳过，fixture 测试仍覆盖解析层。

仓库结构：

```
lib/index.js       host 插件入口：路由 / 信任闸 / 工作区闸
lib/git.js         argv 构造 + execFile runner + 失败分类
lib/service.js     业务组合（graph / commit）
lib/parse.js       git 输出解析
lib/graph.js       泳道布局（纯函数）
lib/http.js        body 读取 / JSON 响应 / 信任闸
lib/client.js      浏览器半体（ModuleLoader 工厂，无构建步骤）
cordis.patch.yml   bundle 层 patch：把插件行插入 profile 清单
docs/              设计规范与接口契约
scripts/           安装/校验/fixture 工具
```

## 故障排查

| 现象 | 排查 |
|---|---|
| 重启后没有「Git 图谱」标签 | 看 `%TEMP%\dsh-git-graph-view-boot.json` 是否存在；不存在 → host 半体没加载，查 `$env:DSH_HOME\logs\startup-*.log` 与 profile 依赖/bundles 条目 |
| 标签出现但显示「宿主路由不可用」 | host 路由未注册（webServer 不可用或前缀冲突）；看宿主日志里的 `[dsh-git-graph-view]` 行 |
| 显示「不是 Git 仓库」 | 当前工作区不是仓库：用头部工作区下拉切到已注册仓库 |
| 显示「该路径不是已注册的工作区」 | 该目录未加入 DSH 工作区列表；先在 DSH 里添加工作区 |
| 显示「未找到 git 命令」 | 宿主进程 PATH 里没有 git；安装 Git 或确认常见安装路径存在 |
| 打开后加载较慢 | 每次请求最多 3 条 git 进程（Windows 冷启动约 0.7s/条）；有 20 秒缓存，可点刷新重取 |
| 403 | 请求不是 loopback / 同源（远程 Web UI 或代理场景），属预期安全行为 |

## 卸载 / 回滚

- 官方/GUI 安装的：在插件面板卸载后重启。
- 手动安装的：
  1. 从 `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中删除 `dsh-git-graph-view`；
  2. 删除 `node_modules/dsh-git-graph-view`（和 `vendor` 下的 tgz）；
  3. 重启。插件被删除不会影响已有插件与仓库数据；
  4. 如需还原到安装前：用 `package.json.bak-ggv-<时间戳>` 覆盖 `package.json`（安装脚本会自动备份）。

## 已知限制 / 非目标

- 只读：不提供切分支、建分支、worktree 管理、提交操作。
- 不做 SSE 实时推送：靠窗口聚焦 + 手动刷新（避免常驻轮询进程）。
- 不做 diff 文本查看器：详情只到文件级状态与增删行数。
- 图谱上限 1000 条提交；不做虚拟滚动（用 `content-visibility` 控制渲染成本）。
- 不注册模型可见工具（保持模型工具面干净）。

## 兼容性

开发与验证环境：DSH Desktop `0.2.1-rc.5`、Windows 11、git 2.36、Node 20.15。
官方 `conversation.view` 槽位或 client-modules 机制变更时可能需要适配，欢迎提 Issue / PR。

## License

MIT，见 [LICENSE](LICENSE)。与 DeepSeek 官方无隶属关系。
