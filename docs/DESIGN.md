# dsh-git-graph-view 视觉设计规范（对齐 DSH 官方界面）

本文件是对「Git 图谱」视图的**视觉重构需求**。目标：从“能用的极简表格”升级为
与 DSH（DeepSeek Harness）Web GUI 观感一致的视图：同样的字体层级、圆角/描边语言、
主题令牌、交互反馈与信息密度。

事实来源：从运行中的 DSH 0.2.1-rc.5 官方 client bundle 中抽取的真实主题令牌与
组件 CSS（`.asar-out/` 为研究产物，不属于插件）。下文所有令牌都在官方主题里有定义，
**一律使用 `var(--token, fallback)` 形式**，禁止硬编码颜色（泳道色板除外，见 §5）。

## 1. 关键事实（必须修正）

1. **暗色主题不是 `prefers-color-scheme`**：官方主题由 `body[data-ds-dark-theme]` 切换。
   泳道色板等需要分主题的样式必须写：
   ```css
   body[data-ds-dark-theme] .ggv-view { --ggv-lane-0: ...; }
   ```
   （官方也保留 `@media (prefers-reduced-motion: reduce)` 降级，这个要保留。）
2. **字体**：正文 `font-family: var(--dsw-font-family, -apple-system, ...)`；
   等宽（sha/路径）`font-family: var(--ds-font-family-code, ui-monospace, Consolas, monospace)`。
3. **字号层级**（官方排版令牌，全部可用）：
   - 14px/22px：`--dsw-font-s-14`；加粗版 `--dsw-font-s-strong-14`（500）
   - 13px/20px：`--dsw-font-xs-13` / `--dsw-font-xs-strong-13`
   - 12px/18px：`--dsw-font-xxs-12` / `--dsw-font-xxs-strong-12`
   - 11px/14px：`--dsw-font-xxxs-11`
   也可直接用 font-size/line-height 数值，但必须来自这套层级（11/12/13/14）。
4. **圆角令牌**：`--dsw-radius-xs:4px`、`sm:8px`、`md:12px`、`lg:16px`、`xl:20px`。
5. **描边**：官方用 `.5px` 细线（`border-bottom:.5px solid var(--dsw-alias-border-l3)`），
   分隔线用 `--dsw-alias-border-l1/l2`，输入框边框用 `--dsw-alias-border-l4`。
6. **焦点环**：`outline: var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:-2px`。
7. **动画**：`.15s var(--ds-ease-in-out)`；`@media (prefers-reduced-motion:reduce)` 下全部关闭。

## 2. 主题令牌（官方实际取值，写 fallback 时照抄）

| 用途 | 令牌 | light | dark（`[data-ds-dark-theme]`） |
|---|---|---|---|
| 页面底色 | `--dsw-alias-bg-base` | `#fff` | `#151517` |
| 浮层/侧栏层 | `--dsw-alias-bg-layer-1` | `#fff` | `#232324` |
| 次级面 | `--dsw-alias-bg-layer-2` | `#fff` | `#2c2c2e` |
| 主文字 | `--dsw-alias-label-primary` | `#0f1115` | `#f9fafb` |
| 次文字 | `--dsw-alias-label-secondary` | `#61666b` | `#cfd3d6` |
| 三级文字 | `--dsw-alias-label-tertiary` | `#81858c` | `#adb2b8` |
| 说明文字 | `--dsw-alias-label-caption` | `#adb2b8` | `#81858c` |
| 细描边 | `--dsw-alias-border-l1` | `#0000000a` | `#ffffff0f` |
| 分隔线 | `--dsw-alias-border-l2` | `#0000001a` | `#ffffff1f` |
| 区块描边 | `--dsw-alias-border-l3` | `#0000001f` | `#ffffff29` |
| 输入框描边 | `--dsw-alias-border-l4` | `#00000029` | `#fff3` |
| hover 背景 | `--dsw-alias-interactive-bg-hover` | `#2631480f` | `#ffffff14` |
| 选中背景 | `--dsw-alias-interactive-bg-active` | `#2631481a` | `#ffffff24` |
| 品牌/业务色 | `--dsw-alias-state-business-primary` | `#4176e6` | `#7aaaff` |
| 业务色浅底 | `--dsw-alias-state-business-tertiary` | `#e4edfd` | `#34415b` |
| 成功色 | `--dsw-alias-state-success-primary` | `#22c55e` | `#22c55e` |
| 成功浅底 | `--dsw-alias-state-success-tertiary` | `#e6faed` | `#233c2c` |
| 警告字色 | `--dsw-alias-state-warn-label` | `#dd8629` | `#dd8629` |
| 警告浅底 | `--dsw-alias-state-warn-tertiary` | `#fef5e7` | `#27241f` |
| 错误色 | `--dsw-alias-state-error-primary` | `#ec1313` | `#f25a5a` |
| 链接色 | `--dsw-alias-link` | `#4176e6` | `#7aaaff` |
| 骨架底色 | `--dsw-alias-bg-skeleton` | `#0000000a` | `#ffffff14` |
| 菜单面 | `--dsw-specific-menu` | `--dsw-menu-surface-fill` | `#303136f0` |
| 浮起阴影 | `--dsw-elevation-soft` / `--dsw-shadow-lv1` | 官方值 | 官方值 |
| 滚动条 | `--dsw-alias-scrollbar-bg-l2` / `-hover-l2` | `#e5e5e5` / `#d4d4d4` | 官方值 |

注意：`--dsw-alias-brand-primary` 在 light 下是**近黑色**（品牌黑），不是蓝色；
需要“品牌蓝”用 `--dsw-alias-state-business-primary`。主按钮 = brand 黑底白字
（`background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)`），
次级按钮 = 透明底 + `border:.5px var(--dsw-alias-border-l4)`。

## 3. 官方组件配方（照抄尺寸/反馈）

- **图标按钮**（刷新、关闭、复制）：
  `28×28`，`border-radius:var(--dsw-radius-sm)`，`color:var(--dsw-alias-label-secondary)`，
  `background:transparent;border:none`，hover 时 `background:var(--dsw-alias-interactive-bg-hover)`，
  `:focus-visible` 用 §1 焦点环 + `outline-offset:-2px`。
- **下拉选择**（工作区）：`height:28px; border-radius:var(--dsw-radius-sm); border:none;
  background:transparent; color:var(--dsw-alias-label-secondary); font:500 13px/20px var(--dsw-font-family);
  padding:0 20px 0 8px;` + 用内联 SVG data-uri 画 12px 的 chevron（官方同款写法）。
  hover 时 `background:var(--dsw-alias-interactive-bg-hover)`。
- **胶囊/徽标（refs chip）**：`border-radius:var(--dsw-radius-sm); padding:1px 8px;
  font:500 11px/14px var(--dsw-font-family); display:inline-flex; gap:4px; align-items:center;`
  - HEAD：`color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-state-business-primary)`
  - 本地分支：`color:var(--dsw-alias-state-business-primary); background:var(--dsw-alias-state-business-tertiary)`
  - 远程：`color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-module-platform)`
  - 标签：`color:var(--dsw-alias-state-warn-label); background:var(--dsw-alias-state-warn-tertiary)`
  - 每个 chip 前带 10×10 的小图标（分支=分叉线、标签=吊牌、远程=地球、HEAD=实心点）。
- **空态**（官方 `_emptyState`）：`flex-direction:column;align-items:center;gap:8px;
  color:var(--dsw-alias-label-tertiary);font:13px/20px`，图标 SVG 56×56 用
  `color:var(--dsw-alias-label-caption)`，标题 `14px/500 var(--dsw-alias-label-primary)`，
  说明 `13px/20px var(--dsw-alias-label-tertiary)`，操作按钮用 **链接样式**
  `color:var(--dsw-alias-link);background:none;border:none;font:13px/20px;cursor:pointer`。
- **搜索框**（官方搜索展开态）：`height:30px;border:.5px solid var(--dsw-alias-border-l4);
  border-radius:var(--dsw-radius-md); padding:0 8px 0 10px; font:13px/18px`，
  placeholder `color:var(--dsw-alias-label-caption)`，前置 16px 放大镜图标；
  `:focus-within` 边框用 `--dsw-alias-border-l4` + 轻微 `box-shadow: 0 0 0 2px color-mix(...)` 可选。
- **分区标题**：`font:500 12px/18px`，`color:var(--dsw-alias-label-secondary)`。
- **页面标题行**：会话头是 `padding:10px 28px 0 20px; border-bottom:.5px solid var(--dsw-alias-border-l3)`；
  tab 是 `13px/500`、active `--dsw-alias-state-business-primary`、下划线 2px 圆角。

## 4. 版面规格（新）

```
┌──────────────────────────────────────────────────────────────────────┐  bg-base
│ [icon] my-repo   [main] [●2 变更] [↑1]        [工作区 ▾]  [↻] [HEAD]  │  header: padding 14px 20px 12px
│ ┌ search 搜提交/作者/sha ─────────────┐  176 个提交 · 4 分支 · 2 标签 │  toolbar: padding 0 20px 10px
├──────────────────────────────────────────────────────────────────────┤  border-bottom .5px border-l3
│  ●─┬────────────  [main] [origin/main]  revert: enforce one…         │  行高 46px
│    │              yanyumizong · 3 天前 · 3caf8cf                     │
│  │  ├─●────────  fix: stabilize AI at high gravity…                  │
│  …                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│ 已加载 176 条                                     [加载更多]          │  footer 12px tertiary
└──────────────────────────────────────────────────────────────────────┘
```

- 列表行：`height:46px; padding:0 12px 0 8px; margin:0 8px; border-radius:var(--dsw-radius-md)`；
  hover `interactive-bg-hover`；选中 `state-business-tertiary` + 左侧 2px inset 强调
  （`box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary)`）；行与行之间**不加**分隔线
  （靠留白与 hover），列表两端各留 8px，视觉更像官方列表。
- 行内容两行：
  - 第一行：refs chips + subject（14px，primary，单行省略，chips 最多 4 个 + `+n`）；
  - 第二行：`author · 相对时间 · 短 sha`（12px tertiary；sha 用 code 字体）。
- 图谱列宽 `COL_W=14px`，行高 `ROW_H=46px`，节点 r=4，HEAD 外环 r=6.5 且先用 bg-base
  描 2px 形成“挖空”效果，再描品牌色 1.5px；连线 stroke-width 1.5，圆头。
- 详情抽屉：宽 `380px`，`background:var(--dsw-alias-bg-layer-1)`，`border-left:.5px solid
  var(--dsw-alias-border-l3)`，`box-shadow:var(--dsw-elevation-soft)`；头部 48px 带标题与关闭图标按钮；
  内容 `padding:16px 20px 32px`，分区之间 `border-top:.5px solid var(--dsw-alias-border-l1)`。
  作者行带 28px 圆形头像（首字母，`background:var(--dsw-alias-state-business-tertiary);
  color:var(--dsw-alias-state-business-primary)`）。
- 滚动容器统一设置 `--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);`。
- 骨架屏：8 行 46px 骨架，块高 10–12px，`background:var(--dsw-alias-bg-skeleton)`，
  `animation: ggv-shimmer 1.5s ease-in-out infinite`；`prefers-reduced-motion` 下静态。
- 刷新中：刷新图标按钮加 `ggv-spin` 动画（同样遵守 reduced-motion）。

## 5. 泳道色板（唯一允许的“硬编码”）

用官方静态色板取值，`body[data-ds-dark-theme]` 切换：

```css
.ggv-view{
  --ggv-lane-0:#4176e6;  /* deepseek-500 */
  --ggv-lane-1:#22c55e;  /* green-500 */
  --ggv-lane-2:#f59e0b;  /* amber-500 */
  --ggv-lane-3:#ef4444;  /* red-500 */
  --ggv-lane-4:#3b82f6;  /* blue-500 */
  --ggv-lane-5:#979da6;  /* neutral-bluish-500 */
  --ggv-lane-6:#4868b2;  /* deepseek-600 */
  --ggv-lane-7:#4ed17e;  /* green-400 */
}
body[data-ds-dark-theme] .ggv-view{
  --ggv-lane-0:#7aaaff; --ggv-lane-1:#4ed17e; --ggv-lane-2:#f7ad31; --ggv-lane-3:#f25a5a;
  --ggv-lane-4:#60a5fa; --ggv-lane-5:#adb2b8; --ggv-lane-6:#b7c8fe; --ggv-lane-7:#22c55e;
}
.ggv-c0{--ggv-color:var(--ggv-lane-0)} … .ggv-c7{--ggv-color:var(--ggv-lane-7)}
```
`lane % 8` 映射。不引入官方色板之外的杂色（紫/粉/青一律不要）。

## 6. 交互增强（让视图“有设计感”，不改变 host 契约）

1. **搜索**：toolbar 输入框，按 subject / author / sha / ref 名做客户端匹配；
   不删除行（保持图谱连续），把不匹配行降到 `opacity:.35`，匹配行正常；
   首个匹配行 `scrollIntoView({block:'center'})`；Esc 清空。纯函数
   `matchesQuery(row, query)` 加入 `exports.__test`。
2. **回到 HEAD**：header 右侧「HEAD」小按钮（当前 HEAD 未在视口时可用），
   点击滚动到 HEAD 行并选中；纯函数 `findHeadIndex(commits, repo)` 可测。
3. **统计摘要**：toolbar 右侧 `N 个提交 · M 个分支 · K 个标签`（从已加载 commits 的 refs 去重统计）。
4. **详情增强**：`isMerge` 时标题旁加「合并」chip；父提交 pills 可点；复制 sha 按钮
   在 hover 行时才显示图标（常态也有，但用 icon 而非文字按钮）；文件列表用状态色块。
5. **加载更多**按钮显示下一批数量：`加载更多（+200）`。
6. **键盘**：↑/↓ 在提交行间移动选中（滚动到视口），Enter 打开详情，Esc 关闭详情/清空搜索。
   行保持 `role="button" tabIndex=0`；列表 `role="list"`、行 `role="listitem"` 可用
   `aria-selected`。

## 7. 不要破坏的东西

- 槽位注册 meta 逐字不变（`conversation.view` / id `dsh-git-graph-view` / order 6 /
  label() => 'Git 图谱' / `inject:(sessionId)=>({sessionId})`）。
- host 契约（`/graph`、`/commit`、`/workspaces` 的请求/响应字段）、错误码、20s 缓存、
  AbortController、localStorage 键、zh/en 文案的 key 语义。
- `exports.__test` 原有纯函数全部保留；`COL_W`/`ROW_H` 值更新为 14/46。
- 无依赖、无构建、无 ESM import/export、不读写文件系统、不执行 git、不发外部网络请求。

## 8. 测试要求（同步更新 `test/client-contract.test.mjs`）

- 断言改为：CSS 含 `body[data-ds-dark-theme]`（且**不再**断言 `prefers-color-scheme`），
  含 `--dsw-font-family`、`--ds-font-family-code`、`--dsw-radius-`、`--dsw-alias-bg-base`、
  `--dsw-focus-ring-width`、`contain-intrinsic-size:46px`、抽屉 `width:380px`。
- `buildRowGeometry` 按 `ROW_H=46` 重新核对 path 字符串（midY=23）。
- 新增纯函数测试：`matchesQuery`、`findHeadIndex`（含 HEAD 不在列表时返回 -1）。
- 现有渲染冒烟测试保持通过（有/无 sessionId 都不白屏）。
- 结尾：`node --check lib/client.js` + `node test/client-contract.test.mjs` 全绿。

## 9. 外壳集成与独立滚动（2026-11-02 修订）

**问题**：视图根节点原先没有声明自己管理滚动，会话外壳的 `scrollBody`
（`[data-conversation-scroll]`）是唯一的滚动容器，导致「左侧图谱 + 右侧详情」整体
共用一个滚动条，两栏无法各自滚动。

**官方机制**（从运行中 DSH 0.2.1-rc.5 官方「轨迹」视图中确认）：
非聊天视图在根节点上声明 `data-conversation-composer-overlay=""`，会话外壳 CSS 随即：

```css
[data-conversation-scroll]:has([data-conversation-composer-overlay]) {
  scrollbar-gutter: auto; position: relative; overflow: hidden auto;
}
[data-conversation-scroll]:has([data-conversation-composer-overlay])
  > [data-slot="conversation.session"] > .viewArea {
  flex: 1 1 0; min-height: 0; overflow: hidden;   /* 视图获得确定高度 */
}
[data-conversation-scroll]:has([data-conversation-composer-overlay]) > [data-composer-seat] {
  position: absolute; bottom: 0; left: 0; right: var(--dsh-scrollbar-width);
}
```

**实现要求**：

1. 视图根节点：`<div class="ggv-view" data-conversation-composer-overlay="">`，
   并保持 `height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden`。
2. 根节点预留悬浮输入席高度：`padding-bottom: var(--dsh-composer-height, 152px)`
   （该变量由外壳在 `[data-conversation-scroll]` 上以 ResizeObserver 实时维护），
   避免悬浮输入框遮住列表末行与 footer。
3. 两个滚动容器彼此独立：
   - 左：`.ggv-list { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable }`
   - 右：`.ggv-detail-body { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable }`
   - 两栏的父级链路（`.ggv-body` / `.ggv-list-wrap` / `.ggv-detail`）保持 `min-height:0`，
     保证 flex 子项不会把父级撑高。
4. `overscroll-behavior: contain` 防止一栏滚到边界后把滚动链传给会话滚动区。
5. 契约测试必须断言：根节点带 `data-conversation-composer-overlay` 属性；
   CSS 含 `--dsh-composer-height` 预留、至少两个 `overflow-y:auto`、至少两个
   `overscroll-behavior:contain`、以及 `scrollbar-gutter:stable`。
