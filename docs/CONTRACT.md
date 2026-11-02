# dsh-git-graph-view — 实现契约（host ↔ client 冻结接口）

本文件是实现期唯一事实源。host 半体（`lib/index.js` 及其模块）与 client 半体
（`lib/client.js`）都必须严格按本文件实现；任何一方想改形状，先改本文件并通知另一方。

## 1. 总体

- 插件名 / 包名 / 行 id / client 模块 id：**全部** `dsh-git-graph-view`。
- host 半体：Cordis 插件（宿主 Node 进程），注册 `/git-graph-view` 前缀 HTTP 路由。
- client 半体：ModuleLoader 工厂（浏览器），注册 `conversation.view` 标签页。
- 零 npm 依赖、零构建步骤。host 只用 `node:*` 内置模块；client 只用宿主提供的
  `require('react')` 与浏览器内置 API。
- **只读**：只允许 `git rev-parse/status/log/show/diff-tree`，禁止任何写操作。

## 2. host HTTP 接口

前缀路由 `/git-graph-view`（`ctx.webServer.register({kind:'prefix', path:'/git-graph-view', handler})`）。
除 `/health` 外只接受 `POST` + `content-type: application/json`，body 上限 64 KiB。

统一响应 envelope：

```jsonc
{ "ok": true, "value": <value> }                       // 应用层成功
{ "ok": false, "error": { "code": "...", "message": "..." } }  // 应用层失败（HTTP 仍 200）
```

错误码：`bad-request | not-a-workspace | not-a-repo | git-missing | timeout | git-failed | internal`。

### 2.1 `POST /git-graph-view/graph`

请求：`{ "path": "<abs path>", "limit": 200 }`（limit 可省，夹取 1..1000，默认 200）

响应 value：

```ts
{
  repo: {
    root: string,        // git rev-parse --show-toplevel 结果（正斜杠形式，如 D:/x/y）
    name: string,        // 仓库目录 basename
    branch: string,      // 当前分支名；detached 时为 'HEAD'
    detached: boolean,
    unborn: boolean,     // 尚无提交（空仓库）
    head: string,        // 完整 HEAD sha；unborn 时 ''
    dirty: number,       // 非忽略、非未跟踪的变更条目数
    conflict: number,    // 冲突条目数（porcelain v2 中 u 行）
    ahead: number,       // 有 upstream 时的领先数，否则 0
    behind: number
  },
  commits: CommitRow[],  // 见 2.5
  lanes: number,         // 全局泳道列数（>=1；各行统一用它算宽度）
  truncated: boolean     // commits.length === limit
}
```

### 2.2 `POST /git-graph-view/commit`

请求：`{ "path": "<abs path>", "sha": "<7..40 hex>" }`

响应 value：

```ts
{
  sha, short, subject, body,      // body 为完整提交信息（%B，已 trim 末尾空白）
  author, email,
  authorTime: number,             // unix 秒
  commitTime: number,             // unix 秒
  parents: string[],
  refs: Ref[],                    // 见 2.5
  isMerge: boolean,               // parents.length > 1
  stats: { files: number, added: number, deleted: number },
  files: FileEntry[],             // 最多 300 条
  filesTruncated: boolean
}
type FileEntry = { status: 'A'|'M'|'D'|'R'|'C'|'T'|'U'|'?', path: string, added: number, deleted: number }
```

合并提交的文件列表用 `<sha>^1..<sha>` 的 diff-tree 得出；根提交用 `--root`；
numstat 的二进制文件 `-` 记为 0。

### 2.3 `POST /git-graph-view/workspaces`

请求：`{}`（或任意 JSON 对象，例如客户端附带的 `{sessionId}`；host 忽略 body）。

响应 value：

```ts
{ workspaces: { path: string, title: string }[] }   // 来自 ctx.workspaceRegistry.list()，不探测是否 git 仓库
```

### 2.4 `GET /git-graph-view/health`

响应 value：`{ name: 'dsh-git-graph-view', version: string, up: true }`（诊断用，无参数）。

### 2.5 共用类型

```ts
type Ref = { name: string, type: 'head' | 'branch' | 'remote' | 'tag' }

type CommitRow = {
  sha: string, short: string, subject: string,
  author: string, email: string, time: number,   // unix 秒
  parents: string[],
  refs: Ref[],
  lane: number,                 // 节点所在列（0-based）
  above: number[],              // 本行“上部”有竖线的非节点列（升序、去重）
  below: number[],              // 本行“下部”有竖线的非节点列（升序、去重）
  mergesIn: number[],           // 上部竖线在本行汇入节点的列（⊆ above）
  forks: number[],              // 本行从节点分出、向下连到父提交的列（不含节点列）
  nodeAbove: boolean,           // 节点列上方是否连入（本提交是某条泳道的延续）
  nodeBelow: boolean            // 节点列下方是否连出（有首父提交，泳道继续）
}
```

refs 归类（`%D` 装饰解析）：
- `HEAD -> main` → head 类型的 `main`，且 **只保留 head 一条**（不再重复 branch）。
- `tag: v1` → tag。
- 含 `/` 的（`origin/main`、`tuleap-https/master`）→ remote。
- 其余 → branch。
- 纯 `HEAD`（detached）→ head 类型，name 为 `HEAD`。

## 3. 泳道布局（host `lib/graph.js` 计算，client 只渲染）

对齐几何参数（client 侧常量）：

```
COL_W = 14px, ROW_H = 46px
laneCenterX(c) = c * COL_W + COL_W / 2
midY = ROW_H / 2
nodeX = laneCenterX(row.lane)
```

渲染规则（client 的 `buildRowGeometry` 必须与之一致，按顺序生成 path）：

1. 对每个 `c in row.above`：
   - 若 `c in row.mergesIn`：`M x 0 V midY Q x midY nodeX midY`
   - 否则：`M x 0 V ROW_H`
2. 若 `row.nodeAbove`：`M nodeX 0 V midY`
3. 若 `row.nodeBelow`：`M nodeX midY V ROW_H`
4. 对每个 `c in row.forks`：`M nodeX midY Q nodeX ROW_H x ROW_H`
5. 对每个 `c in row.below` 且 `c ∉ row.above` 且 `c ∉ row.forks`：`M x 0 V ROW_H`
6. 节点圆：圆心 `(nodeX, midY)`，半径 4；当前 HEAD（refs 里 type=head 且 name 不为 'HEAD'
   或 sha === repo.head）画双环：品牌色 1.5px 外环（半径 6.5）+ 背景色 2px 挖空环（半径 5）。

颜色：每条 path / 节点按列号 `c % 8` 映射 CSS 类 `ggv-c0 … ggv-c7`（8 色官方静态色板，见 docs/DESIGN.md §5）；
曲线用其目标列（mergesIn 用源列 c，forks 用目标列 c）。节点用 `row.lane % 8`。

布局不变式（host 测试断言）：
- 所有列号 >= 0；`mergesIn ⊆ above`；`forks ⊆ below ∪ {lane}`。
- `lane < lanes`；`above/below` 内列号 < lanes。
- 每个非根提交的每个父提交恰好对应一条可追溯连线（`nodeBelow` 或 `forks` 之一）。
- 逐行输出只依赖该行之前（含该行）的提交，追加更多提交不会改变已有行的布局。

## 4. client 半体

### 4.1 形态（必须与已验证插件一致）

```js
window.__ModuleLoader__.load({
  id: 'dsh-git-graph-view',
  factory: (require) => {
    const React = require('react')
    // ... 全部实现 ...
    exports.inject = ['slots', 'sessions']
    exports.apply = apply
    exports.__test = { /* 见 4.5 */ }
    return module.exports
  },
})
```

`apply(ctx)`：
- 取槽位面：`const slots = ctx.slots ?? ctx.get('slots')`，为空则安全返回。
- 注入 `<style data-plugin-css="dsh-git-graph-view">`（`ctx.effect` dispose 时移除；重复 apply 幂等）。
- `slots.inject('conversation.view', () => slots.register(meta, View))`，meta：

```js
{
  name: 'conversation.view',
  id: 'dsh-git-graph-view',
  order: 6,                                  // 对话(0) 与轨迹(10) 之间，避开 gal-view(5)/审批(20)
  label: () => 'Git 图谱',
  inject: (sessionId) => ({ sessionId }),
}
```

- 组件从 `props.sessionId ?? props.slotsProps?.sessionId` 取 sessionId；
  从 `ctx.sessions ?? ctx.get('sessions')` 的 `list.getSnapshot().byId[sessionId]?.cwd`
  取默认工作区路径（每次调用时解析，服务可能后到；异常时返回 undefined）。

### 4.2 数据调用

- 基址 `const API = '/git-graph-view'`；`fetch(API + '/graph', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({path,limit}), signal})`。
- 统一解码 `{ok,value|error}`；网络/解析失败 → `{code:'internal', message:'插件宿主路由不可用'}`。
- 请求必须可中止（AbortController）；组件卸载/路径切换时 abort，避免旧响应覆盖新状态。
- 内存缓存：key = `path + '|' + limit`，TTL 20s；手动刷新与窗口 focus（距上次 >20s 时）绕过/重取。
- 选择的工作区按会话持久化：`localStorage['dsh-git-graph-view:repo:<sessionId>']`（读写均 try/catch）。

### 4.3 UI（全高 flex，主题令牌）

**外壳集成（DESIGN §9，不可省）**：视图根节点必须带 `data-conversation-composer-overlay=""`。
这是官方非聊天视图（「轨迹」同款）的标记：会话外壳会把 `.viewArea` 约束为
`flex:1 1 0; min-height:0; overflow:hidden`，并把输入席改为悬浮在底部的覆盖层。
根节点再按 `padding-bottom: var(--dsh-composer-height, 152px)` 预留输入席高度。
由此列表与详情正文各自成为独立滚动容器（`overflow-y:auto` + `overscroll-behavior:contain`），
整页不再共用一个滚动条。

头部（sticky）：
- 左：仓库 icon + 仓库名 + 当前分支 chip（`detached` 显示 HEAD + sha；`dirty>0` 显示「● N 个变更」；
  ahead/behind 显示「↑n ↓m」）。
- 右：工作区 `<select>`（来自 `/workspaces`，选项 label 用 `title` 或路径 basename，value=path）、
  刷新按钮（`title` 提示）。

列表：每行 46px 高（两行内容：refs chips + subject / author · 相对时间 · 短 sha），横向结构 `[SVG 图谱][内容两行]`；
subject 单行省略；悬停高亮；选中行高亮；整行可点击/键盘 Enter/Space；
列表容器 `overflow-y:auto` + `overscroll-behavior:contain` + `scrollbar-gutter:stable`，
每行 `content-visibility:auto; contain-intrinsic-size: 46px`。

详情（选中提交后）：
- 宽屏（窗口 >= 900px）：右侧 380px 抽屉，列表与详情并排，**两栏各自滚动**
  （详情正文 `flex:1; min-height:0; overflow-y:auto` + `overscroll-behavior:contain`）；
- 窄屏：覆盖式面板（`position:absolute; inset:0`），Esc 关闭。
- 内容：subject、body（pre-wrap）、作者/邮箱/时间、完整 sha + 复制按钮、父提交列表、
  文件列表（状态字母 + 路径 + `+n/-m`）、统计汇总；加载中/失败有对应状态。

底部：`truncated` 时显示「加载更多」（limit + 200，封顶 1000），并显示「已加载 N 条」。

状态机（每个都要有明确中文文案 + 可操作入口）：
`loading | ready | empty-repo（仓库还没有提交）| not-repo（不是 Git 仓库，提示切换工作区）|
not-workspace（路径未注册）| git-missing（未找到 git）| error（其他错误，展示 message + 重试）`。

i18n：内置 zh/en 字典；`const lang = document.documentElement.lang?.startsWith('zh') ? 'zh' : (navigator.language||'').startsWith('zh') ? 'zh' : 'en'`
（默认 zh）；所有用户可见文案走 `t('key')`。

无障碍：行 `role="button" tabIndex=0`，Enter/Space 选中；详情面板 `role="dialog" aria-label`；
焦点环用主题令牌。

### 4.4 样式

全部使用 DSH 官方主题令牌（对齐 docs/DESIGN.md，取值来自运行中 DSH 的主题包），至少：
`--dsw-font-family`、`--ds-font-family-code`、`--dsw-font-s-14/-xs-13/-xxs-12/-xxxs-11`、
`--dsw-radius-xs/sm/md/lg`、`--dsw-alias-bg-base/layer-1/layer-2/module-platform/bg-skeleton`、
`--dsw-alias-label-primary/secondary/tertiary/caption/primary-foreground`、
`--dsw-alias-border-l1/l2/l3/l4`、`--dsw-alias-interactive-bg-hover/active`、
`--dsw-alias-state-business-primary/tertiary`、`--dsw-alias-state-success-primary/tertiary`、
`--dsw-alias-state-warn-label/tertiary`、`--dsw-alias-state-error-primary`、`--dsw-alias-link`、
`--dsw-specific-menu`、`--dsw-elevation-soft`、`--dsw-focus-ring-width`、`--dsw-alias-scrollbar-bg-l2`。
每个令牌都给 fallback（如 `var(--dsw-alias-border-l1, #0000000a)`）。描边统一 `.5px`，字号只用 11/12/13/14 层级。
8 个泳道颜色类在明暗主题下都要可辨识：明色写在 `.ggv-view` 的 `--ggv-lane-0..7`，
暗色由 `body[data-ds-dark-theme]` 覆盖（**不使用 `prefers-color-scheme`**；只保留 `prefers-reduced-motion` 降级）。

### 4.5 测试钩子（`exports.__test`，供 `test/client-contract.test.mjs`）

必须导出以下纯函数（不依赖 DOM/React）：

```js
{
  COL_W, ROW_H,
  matchesQuery(row, query) -> boolean,
  findHeadIndex(commits, repo) -> number,
  buildRowGeometry(row, opts?) -> { segments: [{ col: number, kind: 'line'|'merge'|'fork'|'node-above'|'node-below', d: string }], node: { x: number, y: number, col: number } },
  timeAgo(unixSeconds, now, lang) -> string,
  formatCount(n) -> string,
  refChipClass(ref) -> string,        // 'ggv-chip-head' | 'ggv-chip-branch' | 'ggv-chip-remote' | 'ggv-chip-tag'
  langOf(documentLike, navigatorLike) -> 'zh' | 'en',
  i18n(lang) -> { t(key): string },
}
```

## 5. client 契约测试要求（`test/client-contract.test.mjs`）

用 `node:fs/promises` 读 `lib/client.js` 源码，在 `node:vm` 里用 stub 环境执行，或先设置
`globalThis.window/document/navigator` 后 `await import()`。断言：

1. 调用了 `window.__ModuleLoader__.load`，`id === 'dsh-git-graph-view'`，factory 可执行。
2. factory 需要的 `require('react')` 用 stub React（提供 `createElement`、hooks 原语即可）满足。
3. 导出 `inject` 深等于 `['slots','sessions']`；`apply` 是函数。
4. `apply(fakeCtx)` 后：`slots.inject` 被调用且槽位名为 `conversation.view`；
   `slots.register` 收到的 meta：`name === 'conversation.view'`、`id === 'dsh-git-graph-view'`、
   `order === 6`、`label()` 返回非空字符串、`inject('sid')` 返回 `{sessionId:'sid'}`。
5. 样式：`document.head` 中出现 `style[data-plugin-css="dsh-git-graph-view"]`；调用 dispose 后移除。
6. `__test.buildRowGeometry` 对样例 row 生成的 segments 与第 3 节规则逐条一致（至少 4 个样例）；
   `timeAgo`/`refChipClass`/`langOf` 基本行为正确。
7. `node --check lib/client.js` 通过（无 import/export 语法）。

## 6. 约束

- client 只允许改 `lib/client.js` 与 `test/client-contract.test.mjs`（host 由 Lead 并行实现）。
- 不引入任何 npm 依赖；不写文件系统；不执行 git；不发外部网络请求。
- 代码注释用中文，风格参照官方 client bundle 的写法（`window.__ModuleLoader__.load` +
  `React.createElement`，见 docs/DESIGN.md 与仓库内 lib/client.js）。
- 统一用 `React.createElement`，不用 JSX（无构建步骤）。
- 文件使用 UTF-8、LF 换行。
