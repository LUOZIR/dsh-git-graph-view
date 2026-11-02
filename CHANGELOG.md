# Changelog

所有值得注意的变更都会记录在此。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## v0.2.1 — 2026-11-02

- **修复：左侧图谱列表与右侧详情抽屉共用外层滚动条**。视图根节点改用官方非聊天视图
  （「轨迹」同款）的 `data-conversation-composer-overlay` 外壳集成机制，外壳把 `viewArea`
  约束为定高并把输入席改为悬浮层；列表与详情正文各自 `overflow-y:auto` +
  `overscroll-behavior:contain` + `scrollbar-gutter:stable`，根节点按
  `--dsh-composer-height` 预留悬浮输入席高度。
- host 半体版本号改为运行时读取 `package.json`，避免与包版本漂移。
- 安装/校验脚本的默认 profile 路径改为 `$DSH_HOME`/`~/.dsh` 推导，不再写死本机路径。
- 补充 `docs/DESIGN.md §9（外壳集成与独立滚动）` 与对应契约测试断言。

## v0.2.0 — 2026-11-02

- **视觉/交互全面重构，对齐 DSH 官方界面**：从运行中的 DSH 主题包抽取真实设计令牌，
  字号严格 11/12/13/14、`.5px` 描边、官方圆角/阴影/焦点环/滚动条令牌；
  暗色主题改由 `body[data-ds-dark-theme]` 切换（不再使用 `prefers-color-scheme`）。
- 版面：图标块 + 仓库名 + 状态胶囊（分支/变更/冲突/ahead-behind）+ 官方样式工作区下拉 +
  刷新/回到 HEAD 图标按钮；工具条搜索框 + `N 个提交 · M 分支 · K 标签` 摘要；
  46px 两行提交行（带图标的 refs chips + subject / 作者 · 相对时间 · 短 sha）；
  footer「已加载 N 条 + 加载更多（+200）」。
- 泳道：节点 r=4、HEAD 双环挖空效果、1.5px 圆头连线、8 色官方静态色板（明暗两套）。
- 详情：380px 抽屉、首字母头像、合并 chip、图标复制按钮、可点父提交、
  文件状态色块与 `+/-` 统计；窄屏为官方菜单质感的覆盖面板。
- 交互：搜索淡化不删行 + 首个匹配滚动 + Esc 清空、↑/↓/Enter/Esc 键盘导航、骨架屏、
  回到 HEAD（视口感知）、`prefers-reduced-motion` 降级。

## v0.1.0 — 2026-11-02

- 首个版本：会话页「Git 图谱」标签；host 只读 `/git-graph-view` 路由
  （loopback 信任闸 + 已注册工作区闸 + `execFile` 无 shell git）；
  client `conversation.view` 槽位 + React.createElement 组件树；
  泳道布局、refs chips、提交详情、工作区选择器、20s 缓存、zh/en 文案。
