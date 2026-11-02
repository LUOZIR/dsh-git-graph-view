/**
 * dsh-git-graph-view — Git 图谱浏览器半体（手写 ModuleLoader 工厂，无构建步骤）
 *
 * 视觉与交互对齐 DSH 官方界面（docs/DESIGN.md）：
 * - 官方主题令牌 + fallback：--dsw-font-family / --ds-font-family-code / --dsw-radius-* /
 *   --dsw-alias-* / --dsw-specific-menu / --dsw-elevation-soft / --dsw-focus-ring-width 等；
 *   字号只使用官方 11/12/13/14 层级；描边统一 .5px；暗色由 body[data-ds-dark-theme] 切换；
 * - 版面：header（图标块 + 仓库名 + 状态 chips + 工作区 select + 刷新/HEAD 图标按钮）→
 *   toolbar（搜索 + 提交/分支/标签摘要）→ 46px 两行提交行（refs chips + subject /
 *   author · 相对时间 · 短 sha）→ footer（已加载 N 条 + 加载更多（+200））；
 * - 泳道：COL_W=14 / ROW_H=46 / 节点 r=4 / HEAD 双环（bg-base 挖空 + 品牌色外环），
 *   8 色官方静态色板（lane % 8，暗色由 body[data-ds-dark-theme] 切换）；
 * - 交互：搜索淡化不删行 + 首个匹配 scrollIntoView、Esc 清空、回到 HEAD、统计摘要、
 *   ↑/↓/Enter/Esc 键盘、骨架屏、刷新旋转（prefers-reduced-motion 降级）、合并 chip、
 *   可点父提交、380px 详情抽屉（窄屏覆盖）。
 *
 * 数据：POST /git-graph-view/graph、/commit、/workspaces，统一 {ok,value|error} envelope；
 * 20s 内存缓存、AbortController 中止旧请求、窗口 focus 过期重取、localStorage 按会话记住工作区。
 *
 * 约束：零依赖（只用宿主提供的 require('react')），不读写文件系统，不执行 git，不发外部网络请求；
 * 纯函数经 exports.__test 暴露给 test/client-contract.test.mjs。注释统一中文。
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-graph-view',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // ============================== 常量 ==============================
    // 后端 HTTP 前缀（与 docs/CONTRACT.md 第 2 节一致）
    const API = '/git-graph-view'
    // 泳道几何：列宽 14px、行高 46px（CONTRACT 第 3 节 / DESIGN §4）
    const COL_W = 14
    const ROW_H = 46
    const NODE_R = 4
    const HEAD_RING_R = 6.5
    const HEAD_RING_GAP_R = 5
    // 泳道色板 8 色（DESIGN §5）
    const LANE_COUNT = 8
    // 分页：默认 200，每次「加载更多」+200，封顶 1000（CONTRACT 2.1 / 4.3）
    const DEFAULT_LIMIT = 200
    const LOAD_MORE_STEP = 200
    const MAX_LIMIT = 1000
    // 图谱内存缓存 TTL：20s（CONTRACT 4.2）
    const CACHE_TTL = 20000
    const CACHE_MAX_ENTRIES = 32
    // 宽屏断点：>=900px 走右侧抽屉，否则覆盖式面板（CONTRACT 4.3）
    const WIDE_BREAKPOINT = 900
    const DRAWER_W = 380
    // 骨架屏行数（DESIGN §4）
    const SKELETON_ROWS = 8
    // 样式元素标记 / 工作区持久化 key 前缀
    const STYLE_ID = 'dsh-git-graph-view'
    const REPO_KEY_PREFIX = 'dsh-git-graph-view:repo:'

    // ============================== 文案（zh/en） ==============================
    // 所有用户可见文案走 t(key)，保证两种语言下都有成句的说明与可操作入口。
    // 注意：既有 key 的语义保持不变（CONTRACT §7），本次只新增视觉/交互文案 key。
    const DICT = {
      zh: {
        title: 'Git 图谱',
        loading: '加载中…',
        refresh: '刷新',
        refreshTitle: '重新加载提交图谱',
        workspace: '工作区',
        workspaceSelect: '选择工作区',
        workspaceListError: '工作区列表不可用',
        branch: '当前分支',
        changesChip: '● {n} 个变更',
        conflictChip: '{n} 个冲突',
        detached: '游离 HEAD',
        commitsLoaded: '已加载 {n} 条',
        loadMore: '加载更多',
        loadMoreWithCount: '加载更多（+{n}）',
        limitReached: '已达上限（{n} 条）',
        emptyRepoTitle: '仓库还没有提交',
        emptyRepoSub: '创建第一个提交后，这里会显示提交图谱。',
        notRepoTitle: '当前路径不是 Git 仓库',
        notRepoSub: '请在上方工作区选择器中切换到其他工作区，或先把该目录初始化为 Git 仓库。',
        notWorkspaceTitle: '路径未注册为工作区',
        notWorkspaceSub: '该路径不在 DSH 工作区列表中，请切换到已注册的工作区。',
        gitMissingTitle: '未找到 git',
        gitMissingSub: '请先安装 Git 并确保它在 PATH 中，然后刷新重试。',
        errorTitle: '加载失败',
        errorSub: '请检查插件宿主路由是否可用，然后重试。',
        noWorkspaceTitle: '当前会话没有可用工作区',
        noWorkspaceSub: '请在上方选择已注册的工作区；也可以在 DSH 中添加工作区后重试。',
        noSessionSub: '当前会话缺少工作目录，请在上方选择工作区。',
        retry: '重试',
        detail: '提交详情',
        detailLoading: '加载提交详情…',
        detailError: '加载提交详情失败',
        close: '关闭',
        copy: '复制 SHA',
        copyFailed: '复制失败',
        copied: '已复制',
        authorLabel: '作者',
        timeLabel: '时间',
        parentsLabel: '父提交',
        statsLabel: '变更统计',
        statsSummary: '{files} 个文件 · +{added} / -{deleted}',
        filesLabel: '文件变更',
        noFiles: '无文件变更',
        filesTruncated: '文件过多，仅显示前 300 个',
        noSubject: '（无提交信息）',
        openParent: '选中该父提交',
        searchPlaceholder: '搜索提交 / 作者 / SHA',
        searchLabel: '搜索提交',
        clearSearch: '清空搜索',
        backToHead: '回到 HEAD',
        headNotLoaded: 'HEAD 不在已加载的提交中',
        summaryCommits: '{n} 个提交',
        summaryBranches: '{n} 个分支',
        summaryTags: '{n} 个标签',
        mergeChip: '合并',
        mergeHint: '合并提交',
      },
      en: {
        title: 'Git Graph',
        loading: 'Loading…',
        refresh: 'Refresh',
        refreshTitle: 'Reload the commit graph',
        workspace: 'Workspace',
        workspaceSelect: 'Select workspace',
        workspaceListError: 'Workspace list unavailable',
        branch: 'Current branch',
        changesChip: '● {n} changes',
        conflictChip: '{n} conflicts',
        detached: 'detached HEAD',
        commitsLoaded: '{n} commits loaded',
        loadMore: 'Load more',
        loadMoreWithCount: 'Load more (+{n})',
        limitReached: 'Limit reached ({n})',
        emptyRepoTitle: 'This repository has no commits yet',
        emptyRepoSub: 'Create the first commit and the graph will show up here.',
        notRepoTitle: 'This path is not a Git repository',
        notRepoSub: 'Pick another workspace above, or initialize a Git repository in this directory.',
        notWorkspaceTitle: 'Path is not a registered workspace',
        notWorkspaceSub: 'This path is not in the DSH workspace list; choose a registered workspace.',
        gitMissingTitle: 'Git not found',
        gitMissingSub: 'Install Git and make sure it is on PATH, then refresh.',
        errorTitle: 'Failed to load',
        errorSub: 'Check that the plugin host route is available, then retry.',
        noWorkspaceTitle: 'No workspace available for this session',
        noWorkspaceSub: 'Pick a registered workspace above, or add a workspace in DSH and retry.',
        noSessionSub: 'This session has no working directory; pick a workspace above.',
        retry: 'Retry',
        detail: 'Commit details',
        detailLoading: 'Loading commit…',
        detailError: 'Failed to load commit',
        close: 'Close',
        copy: 'Copy SHA',
        copyFailed: 'Copy failed',
        copied: 'Copied',
        authorLabel: 'Author',
        timeLabel: 'Time',
        parentsLabel: 'Parents',
        statsLabel: 'Stats',
        statsSummary: '{files} files · +{added} / -{deleted}',
        filesLabel: 'Files changed',
        noFiles: 'No file changes',
        filesTruncated: 'Too many files; showing first 300',
        noSubject: '(no commit message)',
        openParent: 'Select this parent commit',
        searchPlaceholder: 'Search commits, authors, SHA',
        searchLabel: 'Search commits',
        clearSearch: 'Clear search',
        backToHead: 'Back to HEAD',
        headNotLoaded: 'HEAD is not among the loaded commits',
        summaryCommits: '{n} commits',
        summaryBranches: '{n} branches',
        summaryTags: '{n} tags',
        mergeChip: 'Merge',
        mergeHint: 'Merge commit',
      },
    }

    // ============================== 纯函数（__test 导出） ==============================

    /** 语言判定：documentElement.lang 优先，其次 navigator.language；完全无信息时默认中文。 */
    function langOf(documentLike, navigatorLike) {
      let docLang = ''
      let navLang = ''
      try {
        docLang = String((documentLike && documentLike.documentElement && documentLike.documentElement.lang) || '')
      } catch (e) {
        docLang = ''
      }
      if (docLang.toLowerCase().indexOf('zh') === 0) return 'zh'
      try {
        navLang = String((navigatorLike && navigatorLike.language) || '')
      } catch (e) {
        navLang = ''
      }
      if (navLang.toLowerCase().indexOf('zh') === 0) return 'zh'
      if (!docLang && !navLang) return 'zh'
      return 'en'
    }

    /** 按语言取翻译器；未知 key 原样返回，支持 {name} 占位插值。 */
    function i18n(lang) {
      const dict = lang === 'en' ? DICT.en : DICT.zh
      return {
        t: function (key, vars) {
          let text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : DICT.zh[key]
          if (typeof text !== 'string') text = String(key)
          if (vars && typeof vars === 'object') {
            text = text.replace(/\{(\w+)\}/g, function (match, name) {
              return vars[name] === undefined || vars[name] === null ? match : String(vars[name])
            })
          }
          return text
        },
      }
    }

    /** 数字紧凑格式：<1000 原样，千位 k，百万位 m。 */
    function formatCount(n) {
      const value = Number(n)
      if (!isFinite(value)) return '0'
      const sign = value < 0 ? '-' : ''
      const abs = Math.abs(value)
      if (abs < 1000) return sign + String(Math.round(abs))
      if (abs < 1000000) return sign + trimFixed(abs / 1000) + 'k'
      return sign + trimFixed(abs / 1000000) + 'm'
    }

    /** 保留一位小数并去掉尾随 .0。 */
    function trimFixed(value) {
      return value.toFixed(1).replace(/\.0$/, '')
    }

    /** 相对时间：now 支持毫秒或秒（自动识别），未来时间按「刚刚」处理。 */
    function timeAgo(unixSeconds, now, lang) {
      const en = lang === 'en'
      const seconds = Number(unixSeconds)
      if (!isFinite(seconds)) return en ? 'unknown' : '未知'
      let nowMs
      if (typeof now === 'number' && isFinite(now)) {
        // 兼容传入秒级时间戳（1e11 秒约合公元 5138 年，真实毫秒时间戳远大于它）
        nowMs = now < 1e11 ? now * 1000 : now
      } else if (now instanceof Date) {
        nowMs = now.getTime()
      } else {
        nowMs = Date.now()
      }
      const diff = Math.max(0, Math.floor(nowMs / 1000) - seconds)
      if (diff < 5) return en ? 'just now' : '刚刚'
      if (diff < 60) return en ? diff + 's ago' : diff + ' 秒前'
      const mins = Math.floor(diff / 60)
      if (mins < 60) return en ? mins + 'm ago' : mins + ' 分钟前'
      const hours = Math.floor(mins / 60)
      if (hours < 24) return en ? hours + 'h ago' : hours + ' 小时前'
      const days = Math.floor(hours / 24)
      if (days < 30) return en ? days + 'd ago' : days + ' 天前'
      const months = Math.floor(days / 30)
      if (days < 365) return en ? months + 'mo ago' : months + ' 个月前'
      const years = Math.floor(days / 365)
      return en ? years + 'y ago' : years + ' 年前'
    }

    /** ref 类型 → 颜色类名（与 CONTRACT 2.5 的 head/branch/remote/tag 对应）。 */
    function refChipClass(ref) {
      const type = ref && ref.type
      if (type === 'head') return 'ggv-chip-head'
      if (type === 'remote') return 'ggv-chip-remote'
      if (type === 'tag') return 'ggv-chip-tag'
      return 'ggv-chip-branch'
    }

    /**
     * 搜索匹配（DESIGN §6.1）：按 subject / author / sha / short / ref 名做不区分大小写的子串匹配。
     * 空 query 视为全部匹配；row 为空返回 false。
     */
    function matchesQuery(row, query) {
      if (!row) return false
      const q = query === undefined || query === null ? '' : String(query).trim().toLowerCase()
      if (!q) return true
      const parts = []
      if (row.subject) parts.push(String(row.subject))
      if (row.author) parts.push(String(row.author))
      if (row.sha) parts.push(String(row.sha))
      if (row.short) parts.push(String(row.short))
      const refs = Array.isArray(row.refs) ? row.refs : []
      for (let i = 0; i < refs.length; i += 1) {
        const ref = refs[i]
        if (ref && ref.name) parts.push(String(ref.name))
      }
      return parts.join('\n').toLowerCase().indexOf(q) >= 0
    }

    /**
     * 找到当前 HEAD 提交在已加载 commits 中的下标（DESIGN §6.2）：
     * 优先 sha === repo.head；否则退化为 refs 里类型 head 且 name !== 'HEAD' 的提交；
     * 找不到返回 -1（例如 HEAD 不在当前分页/截断的最近提交里）。
     */
    function findHeadIndex(commits, repo) {
      const list = Array.isArray(commits) ? commits : []
      if (list.length === 0) return -1
      const headSha = repo && typeof repo.head === 'string' ? repo.head : ''
      if (headSha) {
        for (let i = 0; i < list.length; i += 1) {
          if (list[i] && list[i].sha === headSha) return i
        }
      }
      for (let i = 0; i < list.length; i += 1) {
        const refs = list[i] && Array.isArray(list[i].refs) ? list[i].refs : []
        for (let j = 0; j < refs.length; j += 1) {
          const ref = refs[j]
          if (ref && ref.type === 'head' && ref.name && ref.name !== 'HEAD') return i
        }
      }
      return -1
    }

    /** 从已加载 commits 的 refs 去重统计分支/标签数（DESIGN §6.3）。 */
    function countRefKinds(commits) {
      const branches = new Set()
      const tags = new Set()
      const list = Array.isArray(commits) ? commits : []
      for (let i = 0; i < list.length; i += 1) {
        const refs = list[i] && Array.isArray(list[i].refs) ? list[i].refs : []
        for (let j = 0; j < refs.length; j += 1) {
          const ref = refs[j]
          if (!ref || !ref.name) continue
          if (ref.type === 'tag') tags.add(ref.name)
          else if (ref.type === 'head' || ref.type === 'branch' || ref.type === 'remote') branches.add(ref.name)
        }
      }
      return { branches: branches.size, tags: tags.size }
    }

    /** 输出整数坐标；非整数保留两位并去尾零（当前几何参数下恒为整数）。 */
    function coord(n) {
      if (!isFinite(n)) return '0'
      const rounded = Math.round(n * 100) / 100
      if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded))
      return String(rounded).replace(/0+$/, '').replace(/\.$/, '')
    }

    /** 列号兜底：非法值按 0 处理，避免脏数据把 SVG 画到 NaN 上。 */
    function safeCol(col) {
      return typeof col === 'number' && isFinite(col) && col >= 0 ? col : 0
    }

    /** 列中心 x：c * COL_W + COL_W / 2。 */
    function laneCenterX(col, colW) {
      const width = typeof colW === 'number' && colW > 0 ? colW : COL_W
      return safeCol(col) * width + width / 2
    }

    /**
     * 按 CONTRACT 第 3 节的顺序规则生成一行的 SVG path：
     * 1) above（mergesIn 为上端汇入曲线，其余为竖线）
     * 2) nodeAbove 3) nodeBelow 4) forks 5) below 中既不在 above 也不在 forks 的竖线
     * 6) 节点圆心 (nodeX, midY)（圆本身由渲染层画，这里只给出几何）。
     * 每个 segment 带 col（颜色列）与 kind，供渲染层映射 ggv-cN 类。
     */
    function buildRowGeometry(row, opts) {
      const r = row || {}
      const colW = opts && typeof opts.colW === 'number' && opts.colW > 0 ? opts.colW : COL_W
      const rowH = opts && typeof opts.rowH === 'number' && opts.rowH > 0 ? opts.rowH : ROW_H
      const midY = rowH / 2
      const lane = safeCol(r.lane)
      const nodeX = laneCenterX(lane, colW)
      const above = Array.isArray(r.above) ? r.above : []
      const below = Array.isArray(r.below) ? r.below : []
      const mergesIn = Array.isArray(r.mergesIn) ? r.mergesIn : []
      const forks = Array.isArray(r.forks) ? r.forks : []
      const segments = []

      // 规则 1：本行上部的竖线 / 汇入曲线（曲线目标列是节点列，颜色仍用源列 c）
      for (let i = 0; i < above.length; i += 1) {
        const col = safeCol(above[i])
        const x = laneCenterX(col, colW)
        if (mergesIn.indexOf(above[i]) >= 0 || mergesIn.indexOf(col) >= 0) {
          segments.push({
            col: col,
            kind: 'merge',
            d: 'M ' + coord(x) + ' 0 V ' + coord(midY) +
              ' Q ' + coord(x) + ' ' + coord(midY) + ' ' + coord(nodeX) + ' ' + coord(midY),
          })
        } else {
          segments.push({ col: col, kind: 'line', d: 'M ' + coord(x) + ' 0 V ' + coord(rowH) })
        }
      }
      // 规则 2 / 3：节点列的上半段与下半段
      if (r.nodeAbove) {
        segments.push({ col: lane, kind: 'node-above', d: 'M ' + coord(nodeX) + ' 0 V ' + coord(midY) })
      }
      if (r.nodeBelow) {
        segments.push({ col: lane, kind: 'node-below', d: 'M ' + coord(nodeX) + ' ' + coord(midY) + ' V ' + coord(rowH) })
      }
      // 规则 4：向父提交分叉的曲线（颜色用目标列 c）
      for (let i = 0; i < forks.length; i += 1) {
        const col = safeCol(forks[i])
        const x = laneCenterX(col, colW)
        segments.push({
          col: col,
          kind: 'fork',
          d: 'M ' + coord(nodeX) + ' ' + coord(midY) +
            ' Q ' + coord(nodeX) + ' ' + coord(rowH) + ' ' + coord(x) + ' ' + coord(rowH),
        })
      }
      // 规则 5：只在下部出现的新竖线（上部已有或已由分叉覆盖的列跳过）
      for (let i = 0; i < below.length; i += 1) {
        if (above.indexOf(below[i]) >= 0) continue
        if (forks.indexOf(below[i]) >= 0) continue
        const col = safeCol(below[i])
        const x = laneCenterX(col, colW)
        segments.push({ col: col, kind: 'line', d: 'M ' + coord(x) + ' 0 V ' + coord(rowH) })
      }
      return { segments: segments, node: { x: nodeX, y: midY, col: lane } }
    }

    // ============================== 图谱数据缓存（20s） ==============================
    // key = path + '|' + limit；TTL 到期即失效。手动刷新 / focus 过期重取时绕过缓存。
    const graphCache = new Map()

    function graphCacheKey(path, limit) {
      return String(path) + '|' + String(limit)
    }

    function readGraphCache(path, limit) {
      const key = graphCacheKey(path, limit)
      const entry = graphCache.get(key)
      if (!entry) return null
      if (Date.now() - entry.at > CACHE_TTL) {
        graphCache.delete(key)
        return null
      }
      return entry.value
    }

    function writeGraphCache(path, limit, value) {
      graphCache.set(graphCacheKey(path, limit), { at: Date.now(), value: value })
      // 简单容量控制：超出上限时丢弃最早写入的一项，避免长期使用后无界增长。
      if (graphCache.size > CACHE_MAX_ENTRIES) {
        const oldest = graphCache.keys().next()
        if (!oldest.done) graphCache.delete(oldest.value)
      }
    }

    // ============================== HTTP 调用（统一 envelope 解码） ==============================

    /**
     * POST 到插件宿主路由并解码 {ok,value|error}。
     * - 网络/解析失败统一映射为 {code:'internal', message:'插件宿主路由不可用'}（CONTRACT 4.2）；
     * - AbortError 原样抛出，让调用方按「已取消」静默忽略，避免旧响应覆盖新状态。
     */
    function apiCall(endpoint, body, signal) {
      let request
      try {
        request = fetch(API + endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
          signal: signal,
        })
      } catch (error) {
        // fetch 本身不可用（极旧浏览器 / 被策略禁用）也降级为统一的「路由不可用」
        return Promise.resolve({ ok: false, error: { code: 'internal', message: '插件宿主路由不可用' } })
      }
      return request.then(function (response) {
        return response.json().then(function (data) {
          return data
        }, function () {
          return null
        })
      }).then(function (data) {
        if (data && data.ok === true) return { ok: true, value: data.value }
        if (data && data.ok === false && data.error) return { ok: false, error: data.error }
        return { ok: false, error: { code: 'internal', message: '插件宿主路由不可用' } }
      }).catch(function (error) {
        if (error && error.name === 'AbortError') throw error
        return { ok: false, error: { code: 'internal', message: '插件宿主路由不可用' } }
      })
    }

    function loadGraph(path, limit, signal) {
      return apiCall('/graph', { path: path, limit: limit }, signal)
    }

    function loadCommit(path, sha, signal) {
      return apiCall('/commit', { path: path, sha: sha }, signal)
    }

    function loadWorkspaces(sessionId, signal) {
      const body = sessionId ? { sessionId: sessionId } : {}
      return apiCall('/workspaces', body, signal).then(function (result) {
        if (result.ok) return { ok: true, workspaces: normalizeWorkspaces(result.value) }
        // host 若严格校验 body（不接受 sessionId）则退回空 body 重试一次，失败仍按原结果返回
        if (sessionId && result.error && result.error.code === 'bad-request') {
          return apiCall('/workspaces', {}, signal).then(function (retry) {
            if (!retry.ok) return retry
            return { ok: true, workspaces: normalizeWorkspaces(retry.value) }
          })
        }
        return result
      })
    }

    // ============================== 工作区列表归一化 ==============================
    // CONTRACT 2.3 约定 value 为 { workspaces: {path,title}[] }；这里仍宽容接受
    // 数组 / {workspaces}/{items}/{paths} 以及字符串或 {path,title|name} 条目，避免形状差异白屏。
    function normalizeWorkspaces(value) {
      let list = []
      if (Array.isArray(value)) list = value
      else if (value && Array.isArray(value.workspaces)) list = value.workspaces
      else if (value && Array.isArray(value.items)) list = value.items
      else if (value && Array.isArray(value.paths)) list = value.paths
      const out = []
      const seen = new Set()
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i]
        let path = ''
        let title = ''
        if (typeof item === 'string') {
          path = item
        } else if (item && typeof item === 'object') {
          path = String(item.path || item.root || item.cwd || item.dir || '')
          title = String(item.title || item.name || item.label || '')
        }
        if (!path || seen.has(path)) continue
        seen.add(path)
        out.push({ path: path, title: title || baseName(path) || path })
      }
      return out
    }

    // ============================== 通用小工具 ==============================

    /** 取路径 basename（同时兼容 / 与 \ 分隔符）。 */
    function baseName(path) {
      const parts = String(path || '').split(/[\\/]/).filter(function (part) { return part.length > 0 })
      return parts.length > 0 ? parts[parts.length - 1] : String(path || '')
    }

    /** 相对路径取 session 的默认工作目录（服务可能后到；任何异常都返回 undefined）。 */
    function resolveSessionCwd(ctx, sessionId) {
      if (!sessionId) return undefined
      try {
        const sessions = getService(ctx, 'sessions')
        const list = sessions && sessions.list
        const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null
        const byId = snapshot && snapshot.byId
        const entry = byId && byId[sessionId]
        const cwd = entry && entry.cwd
        if (typeof cwd === 'string' && cwd.length > 0) return cwd
      } catch (e) {
        return undefined
      }
      return undefined
    }

    /** 从 ctx 取服务：优先 ctx[name]，其次 ctx.get(name)；缺失一律 undefined。 */
    function getService(ctx, name) {
      if (!ctx) return undefined
      let value
      try {
        value = ctx[name]
      } catch (e) {
        value = undefined
      }
      if (value !== undefined && value !== null) return value
      try {
        if (typeof ctx.get === 'function') {
          value = ctx.get(name)
          if (value !== undefined && value !== null) return value
        }
      } catch (e) {
        return undefined
      }
      return undefined
    }

    /** 取槽位面：ctx.slots ?? ctx.get('slots')（CONTRACT 4.1）。 */
    function slotServiceOf(ctx) {
      let slots
      try {
        slots = ctx.slots
      } catch (e) {
        slots = undefined
      }
      if (slots === undefined || slots === null) {
        try {
          if (typeof ctx.get === 'function') slots = ctx.get('slots')
        } catch (e) {
          slots = undefined
        }
      }
      return slots || undefined
    }

    /** 当前 HEAD 行判定：refs 有非 'HEAD' 的 head ref，或 sha 等于 repo.head。 */
    function isHeadRow(row, repo) {
      if (!row) return false
      const refs = Array.isArray(row.refs) ? row.refs : []
      for (let i = 0; i < refs.length; i += 1) {
        const ref = refs[i]
        if (ref && ref.type === 'head' && ref.name && ref.name !== 'HEAD') return true
      }
      return !!(repo && repo.head && row.sha && row.sha === repo.head)
    }

    /** 工作区下拉选项：列表去重，当前路径若不在列表里也补一项（否则 select 显示空白）。 */
    function workspaceOptions(workspaces, activePath) {
      const list = []
      const seen = new Set()
      const source = Array.isArray(workspaces) ? workspaces : []
      for (let i = 0; i < source.length; i += 1) {
        const item = source[i]
        if (!item || !item.path || seen.has(item.path)) continue
        seen.add(item.path)
        list.push({ path: item.path, title: item.title || baseName(item.path) || item.path })
      }
      if (activePath && !seen.has(activePath)) {
        list.unshift({ path: activePath, title: baseName(activePath) || activePath })
      }
      return list
    }

    /** 绝对时间：本地化到分钟；Intl 不可用时退化为 toLocaleString。 */
    function fmtAbsoluteTime(unixSeconds, lang) {
      const seconds = Number(unixSeconds)
      if (!isFinite(seconds)) return '—'
      const date = new Date(seconds * 1000)
      try {
        const formatter = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
        return formatter.format(date)
      } catch (e) {
        try {
          return date.toLocaleString()
        } catch (e2) {
          return String(unixSeconds)
        }
      }
    }

    /** 图谱 value → UI 状态（空仓库 / 就绪）；异常形状按空仓库处理，保证不白屏。 */
    function stateFromGraph(value) {
      const repo = value && value.repo ? value.repo : {}
      const commits = value && Array.isArray(value.commits) ? value.commits : []
      if (repo.unborn || commits.length === 0) return { status: 'empty-repo', data: value }
      return { status: 'ready', data: value }
    }

    /** host 错误码 → UI 状态（CONTRACT 2 错误码集合）。 */
    function stateFromError(error) {
      const code = error && error.code
      if (code === 'not-a-repo') return { status: 'not-repo', message: (error && error.message) || '' }
      if (code === 'not-a-workspace') return { status: 'not-workspace', message: (error && error.message) || '' }
      if (code === 'git-missing') return { status: 'git-missing', message: (error && error.message) || '' }
      return {
        status: 'error',
        code: code || 'internal',
        message: (error && error.message) || '插件宿主路由不可用',
      }
    }

    /** 按会话记住所选工作区：localStorage['dsh-git-graph-view:repo:<sessionId>']。 */
    function repoStorageKey(sessionId) {
      return REPO_KEY_PREFIX + String(sessionId)
    }

    function readStoredRepo(sessionId) {
      if (!sessionId) return null
      try {
        const raw = window.localStorage.getItem(repoStorageKey(sessionId))
        return typeof raw === 'string' && raw.length > 0 ? raw : null
      } catch (e) {
        return null
      }
    }

    function writeStoredRepo(sessionId, path) {
      if (!sessionId) return
      try {
        if (path) window.localStorage.setItem(repoStorageKey(sessionId), String(path))
        else window.localStorage.removeItem(repoStorageKey(sessionId))
      } catch (e) {
        // 隐私模式 / 存储配额：忽略，仅影响记忆功能
      }
    }

    /** 是否开启 reduced-motion（动画/平滑滚动降级，DESIGN §1.7）。 */
    function prefersReducedMotion() {
      try {
        if (typeof window === 'undefined' || !window || typeof window.matchMedia !== 'function') return false
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      } catch (e) {
        return false
      }
    }

    /** 把某一行滚动到视口内（首个搜索匹配 / 选中行 / HEAD）。 */
    function scrollRowIntoView(element, block, smooth) {
      if (!element || typeof element.scrollIntoView !== 'function') return
      const options = { block: block || 'nearest' }
      if (smooth && !prefersReducedMotion()) options.behavior = 'smooth'
      try {
        element.scrollIntoView(options)
      } catch (e) {
        try { element.scrollIntoView() } catch (e2) { /* 忽略 */ }
      }
    }

    // ============================== 样式 ==============================
    // 全部使用官方 DSH 主题令牌并给 fallback；暗色由 body[data-ds-dark-theme] 切换（DESIGN §1/§5）；
    // 字号只使用官方 11/12/13/14 层级；描边统一 .5px；圆角使用 --dsw-radius-*。
    const CSS = `
.ggv-view{
  --ggv-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif);
  --ggv-mono:var(--ds-font-family-code,"SF Mono","JetBrains Mono","Fira Code",Consolas,"Liberation Mono",Menlo,Courier,"PingFang SC","Microsoft YaHei");
  --ggv-lane-0:#4176e6;--ggv-lane-1:#22c55e;--ggv-lane-2:#f59e0b;--ggv-lane-3:#ef4444;
  --ggv-lane-4:#3b82f6;--ggv-lane-5:#979da6;--ggv-lane-6:#4868b2;--ggv-lane-7:#4ed17e;
  position:relative;box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;
  overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);
  font:var(--dsw-font-xs-13,13px/20px var(--ggv-font));-webkit-font-smoothing:antialiased;
  /* 视图激活时输入席是悬浮覆盖层（官方 data-conversation-composer-overlay 机制）：
     按外壳维护的 --dsh-composer-height 预留同高空白，避免遮住列表末行与 footer，DESIGN §9。 */
  padding-bottom:var(--dsh-composer-height,152px);
}
body[data-ds-dark-theme] .ggv-view{
  --ggv-lane-0:#7aaaff;--ggv-lane-1:#4ed17e;--ggv-lane-2:#f7ad31;--ggv-lane-3:#f25a5a;
  --ggv-lane-4:#60a5fa;--ggv-lane-5:#adb2b8;--ggv-lane-6:#b7c8fe;--ggv-lane-7:#22c55e;
}
@keyframes ggv-spin{to{transform:rotate(360deg)}}
@keyframes ggv-shimmer{0%,100%{opacity:1}50%{opacity:.5}}
@media (prefers-reduced-motion: reduce){
  .ggv-view *,.ggv-view *::before,.ggv-view *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
}
.ggv-head{position:sticky;top:0;z-index:2;flex:none;box-sizing:border-box;display:flex;align-items:center;gap:10px;min-width:0;padding:14px 20px 12px;background:var(--dsw-alias-bg-base,#fff)}
.ggv-repo-icon{flex:none;box-sizing:border-box;width:28px;height:28px;border-radius:var(--dsw-radius-sm,8px);display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}
.ggv-repo-name{flex:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#0f1115);font:var(--dsw-font-s-strong-14,500 14px/22px var(--ggv-font))}
.ggv-head-chips{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden}
.ggv-head-spacer{flex:1 1 auto}
.ggv-iconbtn{flex:none;box-sizing:border-box;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;transition:background .15s var(--ds-ease-in-out,ease),color .15s var(--ds-ease-in-out,ease)}
.ggv-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.ggv-iconbtn:disabled{opacity:.4;cursor:default}
.ggv-iconbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-2px}
.ggv-icon{display:block}
.ggv-spin{animation:ggv-spin 1s linear infinite}
.ggv-head-btn{flex:none;box-sizing:border-box;height:28px;display:inline-flex;align-items:center;gap:4px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font:500 11px/14px var(--ggv-font);cursor:pointer;transition:background .15s var(--ds-ease-in-out,ease),color .15s var(--ds-ease-in-out,ease)}
.ggv-head-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.ggv-head-btn:disabled{opacity:.4;cursor:default}
.ggv-head-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-2px}
.ggv-select{flex:none;box-sizing:border-box;max-width:220px;height:28px;border:none;border-radius:var(--dsw-radius-sm,8px);appearance:none;background-color:transparent;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:right 4px center;background-repeat:no-repeat;background-size:12px 12px;color:var(--dsw-alias-label-secondary,#61666b);font:500 13px/20px var(--ggv-font);outline:none;padding:0 20px 0 8px;cursor:pointer;transition:background-color .15s var(--ds-ease-in-out,ease)}
.ggv-select:hover:not(:disabled){background-color:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.ggv-select:disabled{opacity:.5;cursor:default}
.ggv-select:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-2px}
.ggv-chip{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;flex:none;max-width:180px;height:20px;padding:1px 8px;border-radius:var(--dsw-radius-sm,8px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 11px/14px var(--ggv-font)}
.ggv-chip svg{flex:none;width:10px;height:10px}
.ggv-chip-head{color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-state-business-primary,#4176e6)}
.ggv-chip-branch{color:var(--dsw-alias-state-business-primary,#4176e6);background:var(--dsw-alias-state-business-tertiary,#e4edfd)}
.ggv-chip-remote{color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.ggv-chip-tag{color:var(--dsw-alias-state-warn-label,#dd8629);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}
.ggv-chip-neutral{color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.ggv-chip-warn{color:var(--dsw-alias-state-warn-label,#dd8629);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}
.ggv-chip-error{color:var(--dsw-alias-state-error-primary,#ec1313);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}
.ggv-chip-success{color:var(--dsw-alias-state-success-primary,#22c55e);background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.ggv-chip-more{color:var(--dsw-alias-label-tertiary,#81858c);background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.ggv-merge-chip{color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.ggv-toolbar{flex:none;box-sizing:border-box;display:flex;align-items:center;gap:12px;min-width:0;padding:0 20px 10px;border-bottom:.5px solid var(--dsw-alias-border-l3,#0000001f)}
.ggv-search{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:280px;max-width:46%;height:30px;padding:0 6px 0 10px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-caption,#adb2b8);background:transparent;transition:border-color .15s var(--ds-ease-in-out,ease),box-shadow .15s var(--ds-ease-in-out,ease)}
.ggv-search:hover:not(:focus-within){border-color:var(--dsw-alias-border-l2,#0000001a)}
.ggv-search:focus-within{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent)}
.ggv-search-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption,#adb2b8)}
.ggv-search-input{flex:1 1 auto;min-width:0;height:28px;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font:var(--dsw-font-xs-13,13px/18px var(--ggv-font));padding:0}
.ggv-search-input::placeholder{color:var(--dsw-alias-label-caption,#adb2b8)}
.ggv-search-clear{flex:none;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}
.ggv-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.ggv-search-clear:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:0}
.ggv-summary{flex:0 1 auto;min-width:0;margin-left:auto;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xxs-12,12px/18px var(--ggv-font));white-space:nowrap}
.ggv-body{position:relative;flex:1 1 auto;min-height:0;display:flex}
.ggv-list-wrap{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}
.ggv-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:8px 0;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#e5e5e5);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#d4d4d4)}
.ggv-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;height:${ROW_H}px;padding:0 12px 0 8px;margin:0 8px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;content-visibility:auto;contain-intrinsic-size:${ROW_H}px;transition:background .15s var(--ds-ease-in-out,ease),opacity .15s var(--ds-ease-in-out,ease),box-shadow .15s var(--ds-ease-in-out,ease)}
.ggv-row:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.ggv-row-selected,.ggv-row-selected:hover{background:var(--dsw-alias-state-business-tertiary,#e4edfd);box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary,#4176e6)}
.ggv-row-dim{opacity:.35}
.ggv-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-2px}
.ggv-graph{flex:none;display:block;overflow:visible}
.ggv-line{fill:none;stroke:var(--ggv-color,var(--dsw-alias-label-tertiary,#81858c));stroke-width:1.5;stroke-linecap:round}
.ggv-node{fill:var(--ggv-color,var(--dsw-alias-label-tertiary,#81858c));stroke:var(--dsw-alias-bg-base,#fff);stroke-width:1}
.ggv-ring{fill:none;stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:1.5}
.ggv-ring-gap{fill:none;stroke:var(--dsw-alias-bg-base,#fff);stroke-width:2}
.ggv-c0{--ggv-color:var(--ggv-lane-0,#4176e6)}
.ggv-c1{--ggv-color:var(--ggv-lane-1,#22c55e)}
.ggv-c2{--ggv-color:var(--ggv-lane-2,#f59e0b)}
.ggv-c3{--ggv-color:var(--ggv-lane-3,#ef4444)}
.ggv-c4{--ggv-color:var(--ggv-lane-4,#3b82f6)}
.ggv-c5{--ggv-color:var(--ggv-lane-5,#979da6)}
.ggv-c6{--ggv-color:var(--ggv-lane-6,#4868b2)}
.ggv-c7{--ggv-color:var(--ggv-lane-7,#4ed17e)}
.ggv-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px}
.ggv-line1{display:flex;align-items:center;gap:6px;min-width:0;height:22px}
.ggv-refs{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:60%;overflow:hidden}
.ggv-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#0f1115);font:var(--dsw-font-s-14,14px/22px var(--ggv-font))}
.ggv-line2{display:flex;align-items:center;gap:6px;min-width:0;height:18px;overflow:hidden;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xxs-12,12px/18px var(--ggv-font))}
.ggv-author{flex:none;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ggv-meta-time{flex:none}
.ggv-meta-sha{flex:none;color:var(--dsw-alias-label-tertiary,#81858c);font-family:var(--ggv-mono);font-size:11px;line-height:14px}
.ggv-meta-dot{flex:none;color:var(--dsw-alias-label-caption,#adb2b8)}
.ggv-foot{flex:none;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 20px;border-top:.5px solid var(--dsw-alias-border-l1,#0000000a);color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xxs-12,12px/18px var(--ggv-font))}
.ggv-foot-spacer{flex:1 1 auto}
.ggv-btn{box-sizing:border-box;flex:none;height:28px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font:500 12px/18px var(--ggv-font);cursor:pointer;transition:background .15s var(--ds-ease-in-out,ease),color .15s var(--ds-ease-in-out,ease)}
.ggv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.ggv-btn:disabled{opacity:.45;cursor:default}
.ggv-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-2px}
.ggv-skeleton{flex:1 1 auto;min-height:0;overflow:hidden;padding:8px 0;display:flex;flex-direction:column}
.ggv-skeleton-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;height:${ROW_H}px;padding:0 12px 0 8px;margin:0 8px}
.ggv-skeleton-graph{flex:none;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-bg-skeleton,#0000000a)}
.ggv-skeleton-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px}
.ggv-skeleton-bar{height:11px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-skeleton,#0000000a);animation:ggv-shimmer 1.5s ease-in-out infinite}
.ggv-skeleton-bar-1{width:56%}
.ggv-skeleton-bar-2{width:32%;height:10px}
.ggv-state{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px 24px;text-align:center;color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xs-13,13px/20px var(--ggv-font))}
.ggv-state-icon{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption,#adb2b8);margin-bottom:4px}
.ggv-state-title{color:var(--dsw-alias-label-primary,#0f1115);font:var(--dsw-font-s-strong-14,500 14px/22px var(--ggv-font))}
.ggv-state-sub{max-width:520px;color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xs-13,13px/20px var(--ggv-font));word-break:break-word}
.ggv-state-actions{display:flex;align-items:center;gap:12px;margin-top:2px}
.ggv-state-action{border:none;background:none;padding:0;color:var(--dsw-alias-link,#4176e6);font:var(--dsw-font-xs-13,13px/20px var(--ggv-font));cursor:pointer}
.ggv-state-action:hover{text-decoration:underline}
.ggv-state-action:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:2px}
.ggv-detail{flex:none;box-sizing:border-box;width:${DRAWER_W}px;min-width:${DRAWER_W}px;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff);border-left:.5px solid var(--dsw-alias-border-l3,#0000001f);box-shadow:var(--dsw-elevation-soft,0 0 0 .5px var(--dsw-alias-border-l4,#00000029),0 4px 16px 0 #00000008,0 0 24px 0 #00000008)}
.ggv-detail-overlay{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;min-height:0;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));box-shadow:var(--dsw-elevation-soft,0 0 0 .5px var(--dsw-alias-border-l4,#00000029),0 4px 16px 0 #00000008,0 0 24px 0 #00000008)}
.ggv-detail-head{flex:none;box-sizing:border-box;height:48px;display:flex;align-items:center;gap:8px;padding:0 12px 0 20px;border-bottom:.5px solid var(--dsw-alias-border-l1,#0000000a)}
.ggv-detail-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#0f1115);font:var(--dsw-font-s-strong-14,500 14px/22px var(--ggv-font))}
.ggv-detail-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;display:flex;flex-direction:column;gap:16px;padding:16px 20px 32px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#e5e5e5);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#d4d4d4)}
.ggv-detail-section{display:flex;flex-direction:column;gap:8px}
.ggv-detail-section+.ggv-detail-section{border-top:.5px solid var(--dsw-alias-border-l1,#0000000a);padding-top:16px}
.ggv-detail-loading{color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xs-13,13px/20px var(--ggv-font));padding:24px 0;text-align:center}
.ggv-pre{margin:0;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1,#0000000a);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-secondary,#61666b);font:var(--dsw-font-xs-13,13px/20px var(--ggv-font));white-space:pre-wrap;word-break:break-word}
.ggv-section-title{color:var(--dsw-alias-label-secondary,#61666b);font:var(--dsw-font-xxs-strong-12,500 12px/18px var(--ggv-font))}
.ggv-author-row{display:flex;align-items:center;gap:10px;min-width:0}
.ggv-avatar{flex:none;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-state-business-tertiary,#e4edfd);color:var(--dsw-alias-state-business-primary,#4176e6);font:500 12px/18px var(--ggv-font);text-transform:uppercase}
.ggv-author-info{display:flex;flex-direction:column;min-width:0;gap:1px}
.ggv-author-name{color:var(--dsw-alias-label-primary,#0f1115);font:var(--dsw-font-xxs-strong-12,500 12px/18px var(--ggv-font));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ggv-author-mail{color:var(--dsw-alias-label-caption,#adb2b8);font:var(--dsw-font-xxs-12,12px/18px var(--ggv-font));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ggv-meta-line{color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xxs-12,12px/18px var(--ggv-font))}
.ggv-sha-row{display:flex;align-items:center;gap:8px;min-width:0}
.ggv-sha-full{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary,#81858c);font-family:var(--ggv-mono);font-size:11px;line-height:14px;word-break:break-all}
.ggv-copied{flex:none;color:var(--dsw-alias-state-success-primary,#22c55e);font:var(--dsw-font-xxxs-11,11px/14px var(--ggv-font))}
.ggv-copied-fail{color:var(--dsw-alias-state-error-primary,#ec1313)}
.ggv-parents{display:flex;flex-wrap:wrap;gap:6px}
.ggv-parent{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font-family:var(--ggv-mono);font-size:11px;line-height:14px;cursor:pointer}
.ggv-parent:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.ggv-parent:disabled{opacity:.6;cursor:default}
.ggv-parent:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-2px}
.ggv-files{display:flex;flex-direction:column;gap:4px}
.ggv-file{display:flex;align-items:center;gap:8px;min-width:0}
.ggv-file-status{flex:none;box-sizing:border-box;width:18px;height:18px;border-radius:var(--dsw-radius-xs,4px);display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-tertiary,#81858c);font-family:var(--ggv-mono);font-size:11px;line-height:14px;font-weight:600}
.ggv-file-status-A{color:var(--dsw-alias-state-success-primary,#22c55e);background:var(--dsw-alias-state-success-tertiary,#e6faed)}
.ggv-file-status-M{color:var(--dsw-alias-state-business-primary,#4176e6);background:var(--dsw-alias-state-business-tertiary,#e4edfd)}
.ggv-file-status-D{color:var(--dsw-alias-state-error-primary,#ec1313);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}
.ggv-file-status-R,.ggv-file-status-C,.ggv-file-status-T{color:var(--dsw-alias-state-warn-label,#dd8629);background:var(--dsw-alias-state-warn-tertiary,#fef5e7)}
.ggv-file-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#61666b);font-family:var(--ggv-mono);font-size:11px;line-height:14px}
.ggv-file-stat{flex:none;display:inline-flex;gap:6px;font-family:var(--ggv-mono);font-size:11px;line-height:14px}
.ggv-add{color:var(--dsw-alias-state-success-primary,#22c55e)}
.ggv-del{color:var(--dsw-alias-state-error-primary,#ec1313)}
.ggv-muted{color:var(--dsw-alias-label-tertiary,#81858c);font:var(--dsw-font-xxs-12,12px/18px var(--ggv-font));word-break:break-word}
.ggv-error-text{color:var(--dsw-alias-state-error-primary,#ec1313)}
`

    // 样式注入：同一模块重复 apply 时复用；ctx.effect dispose 时移除（幂等）。
    let styleEl = null

    /** 查找页面上已注入的样式（HMR / loader 重跑时跨模块实例复用，避免重复注入）。 */
    function findInjectedStyle() {
      try {
        if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
          return document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') || null
        }
      } catch (e) {
        return null
      }
      return null
    }

    function ensureStyle(ctx) {
      if (styleEl && styleEl.parentNode) return styleEl
      const existing = findInjectedStyle()
      if (existing) {
        styleEl = existing
        return styleEl
      }
      let element = null
      try {
        element = document.createElement('style')
        element.setAttribute('data-plugin-css', STYLE_ID)
        element.textContent = CSS
        document.head.appendChild(element)
        styleEl = element
      } catch (e) {
        styleEl = null
        try {
          console.error('[dsh-git-graph-view] 注入样式失败：' + String((e && e.message) || e))
        } catch (e2) {
          // console 不可用时静默
        }
        return null
      }
      try {
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return function () {
              if (styleEl === element) styleEl = null
              if (element.parentNode) {
                try {
                  element.parentNode.removeChild(element)
                } catch (e) {
                  // 已被其他路径移除
                }
              }
            }
          })
        }
      } catch (e) {
        // effect 注册失败不影响视图本身
      }
      return styleEl
    }

    // ============================== 图标 ==============================

    /** 仓库图标（分支示意，用 currentColor 跟随主题）。 */
    function RepoIcon() {
      return React.createElement('svg', {
        className: 'ggv-icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('circle', { cx: 4.5, cy: 3.5, r: 1.8, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('circle', { cx: 4.5, cy: 12.5, r: 1.8, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('circle', { cx: 11.5, cy: 6.5, r: 1.8, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('path', { d: 'M4.5 5.3V10.7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        React.createElement('path', { d: 'M11.5 8.3C11.5 10.5 8.5 10.5 4.5 10.7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      )
    }

    /** 刷新图标。 */
    function RefreshIcon() {
      return React.createElement('svg', {
        className: 'ggv-icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('path', {
          d: 'M13 8a5 5 0 1 1-1.5-3.55', stroke: 'currentColor', strokeWidth: 1.4,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        React.createElement('path', {
          d: 'M13 2.6V5.2H10.4', stroke: 'currentColor', strokeWidth: 1.4,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    /** 放大镜（搜索框前置 16px）。 */
    function SearchIcon() {
      return React.createElement('svg', {
        className: 'ggv-icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('circle', { cx: 7, cy: 7, r: 4.2, stroke: 'currentColor', strokeWidth: 1.4 }),
        React.createElement('path', { d: 'M10.2 10.2L13 13', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /** 关闭 / 清空图标。 */
    function CloseIcon(props) {
      const size = props && props.size ? props.size : 14
      return React.createElement('svg', {
        className: 'ggv-icon', width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('path', { d: 'M4 4L12 12M12 4L4 12', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /** 复制图标。 */
    function CopyIcon() {
      return React.createElement('svg', {
        className: 'ggv-icon', width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('rect', { x: 5.5, y: 5.5, width: 7, height: 7, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('path', { d: 'M10.5 5.5V4.2c0-.66-.54-1.2-1.2-1.2H4.2c-.66 0-1.2.54-1.2 1.2v5.1c0 .66.54 1.2 1.2 1.2h1.3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      )
    }

    /** 已复制勾选图标。 */
    function CheckIcon() {
      return React.createElement('svg', {
        className: 'ggv-icon', width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('path', { d: 'M3.5 8.2L6.6 11.2L12.5 5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** HEAD 定位图标（实心圆点 + 环）。 */
    function HeadIcon() {
      return React.createElement('svg', {
        className: 'ggv-icon', width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': true,
      },
        React.createElement('circle', { cx: 8, cy: 8, r: 5.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('circle', { cx: 8, cy: 8, r: 2.6, fill: 'currentColor' }),
      )
    }

    /** refs chip 前 10×10 小图标（HEAD 实心点 / 分支分叉线 / 远程地球 / 标签吊牌）。 */
    function RefChipIcon(props) {
      const type = props && props.type
      const base = { width: 10, height: 10, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true }
      if (type === 'head') {
        return React.createElement('svg', base, React.createElement('circle', { cx: 6, cy: 6, r: 3.2, fill: 'currentColor' }))
      }
      if (type === 'tag') {
        return React.createElement('svg', base,
          React.createElement('path', {
            d: 'M1.8 2.2h4.1l4.1 4.1-3.7 3.7-4.5-4.5V2.2Z',
            stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round',
          }),
          React.createElement('circle', { cx: 4.1, cy: 4.1, r: 0.8, fill: 'currentColor' }),
        )
      }
      if (type === 'remote') {
        return React.createElement('svg', base,
          React.createElement('circle', { cx: 6, cy: 6, r: 4.3, stroke: 'currentColor', strokeWidth: 1.1 }),
          React.createElement('ellipse', { cx: 6, cy: 6, rx: 2, ry: 4.3, stroke: 'currentColor', strokeWidth: 1.1 }),
          React.createElement('path', { d: 'M1.8 6h8.4', stroke: 'currentColor', strokeWidth: 1.1 }),
        )
      }
      return React.createElement('svg', base,
        React.createElement('circle', { cx: 2.8, cy: 2.6, r: 1.5, stroke: 'currentColor', strokeWidth: 1.1 }),
        React.createElement('circle', { cx: 2.8, cy: 9.4, r: 1.5, stroke: 'currentColor', strokeWidth: 1.1 }),
        React.createElement('circle', { cx: 9.2, cy: 5.2, r: 1.5, stroke: 'currentColor', strokeWidth: 1.1 }),
        React.createElement('path', { d: 'M2.8 4.1v3.8', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }),
        React.createElement('path', { d: 'M9.2 6.7c0 1.8-2.4 1.4-4.6 2.2', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }),
      )
    }

    /** 空态/错误态 56×56 插图（官方空态图标风格，用 currentColor）。 */
    function StateArtIcon(props) {
      const kind = props && props.kind
      const base = { width: 56, height: 56, viewBox: '0 0 56 56', fill: 'none', 'aria-hidden': true }
      if (kind === 'error' || kind === 'warn') {
        return React.createElement('svg', base,
          React.createElement('circle', { cx: 28, cy: 28, r: 19, stroke: 'currentColor', strokeWidth: 1.4 }),
          React.createElement('path', { d: 'M28 17.5v13', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
          React.createElement('circle', { cx: 28, cy: 37.5, r: 1.7, fill: 'currentColor' }),
        )
      }
      // git 图谱示意：节点 + 连线
      return React.createElement('svg', base,
        React.createElement('path', { d: 'M18 12v32', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', opacity: '.5' }),
        React.createElement('path', { d: 'M38 12v10c0 7-20 4-20 12v10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', opacity: '.5' }),
        React.createElement('circle', { cx: 18, cy: 18, r: 4.2, stroke: 'currentColor', strokeWidth: 1.4 }),
        React.createElement('circle', { cx: 18, cy: 40, r: 4.2, stroke: 'currentColor', strokeWidth: 1.4 }),
        React.createElement('circle', { cx: 38, cy: 26, r: 4.2, stroke: 'currentColor', strokeWidth: 1.4 }),
      )
    }

    /** 统一空态/错误态面板：官方 _emptyState 配方（56px 图标 + 标题 + 说明 + 链接样式操作）。 */
    function renderStatePanel(cfg) {
      return React.createElement('div', { className: 'ggv-state' },
        React.createElement('span', { className: 'ggv-state-icon' }, React.createElement(StateArtIcon, { kind: cfg.kind })),
        React.createElement('div', { className: 'ggv-state-title' }, cfg.title),
        cfg.sub ? React.createElement('div', { className: 'ggv-state-sub' }, cfg.sub) : null,
        cfg.actionLabel
          ? React.createElement('div', { className: 'ggv-state-actions' },
              React.createElement('button', {
                type: 'button',
                className: 'ggv-state-action',
                onClick: cfg.onAction,
              }, cfg.actionLabel),
            )
          : null,
      )
    }

    /** 骨架屏：8 行 46px（DESIGN §4）。 */
    function renderSkeleton(t) {
      const rows = []
      for (let i = 0; i < SKELETON_ROWS; i += 1) {
        rows.push(React.createElement('div', { key: 'skel' + i, className: 'ggv-skeleton-row', 'aria-hidden': true },
          React.createElement('span', { className: 'ggv-skeleton-graph' }),
          React.createElement('span', { className: 'ggv-skeleton-main' },
            React.createElement('span', { className: 'ggv-skeleton-bar ggv-skeleton-bar-1' }),
            React.createElement('span', { className: 'ggv-skeleton-bar ggv-skeleton-bar-2' }),
          ),
        ))
      }
      return React.createElement('div', {
        className: 'ggv-skeleton',
        role: 'status',
        'aria-label': t ? t('loading') : '加载中…',
      }, rows)
    }

    // ============================== 提交行（46px 两行） ==============================

    function CommitRow(props) {
      const row = props.row || {}
      const geometry = buildRowGeometry(row)
      const width = Math.max(1, props.lanes || 1) * COL_W
      const refs = Array.isArray(row.refs) ? row.refs : []
      const shownRefs = refs.slice(0, 4)
      const hiddenRefCount = refs.length - shownRefs.length
      const laneClass = 'ggv-c' + (geometry.node.col % LANE_COUNT)
      let rowClass = 'ggv-row'
      if (props.selected) rowClass += ' ggv-row-selected'
      if (props.dim) rowClass += ' ggv-row-dim'
      return React.createElement('div', {
        className: rowClass,
        role: 'button',
        tabIndex: 0,
        'aria-selected': props.selected ? 'true' : 'false',
        'aria-label': row.subject || '',
        title: row.subject || '',
        ref: props.rowRef,
        onClick: function () { props.onSelect(row.sha) },
        onKeyDown: function (event) {
          if (!event) return
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault()
            props.onSelect(row.sha)
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (typeof props.onNavigate === 'function') props.onNavigate(event.key === 'ArrowDown' ? 1 : -1)
          }
        },
      },
        React.createElement('svg', {
          className: 'ggv-graph',
          width: width,
          height: ROW_H,
          viewBox: '0 0 ' + width + ' ' + ROW_H,
          'aria-hidden': true,
        },
          geometry.segments.map(function (segment, index) {
            return React.createElement('path', {
              key: 'seg' + index,
              className: 'ggv-line ggv-c' + (segment.col % LANE_COUNT),
              d: segment.d,
            })
          }),
          props.head
            ? [
                React.createElement('circle', {
                  key: 'ring',
                  className: 'ggv-ring',
                  cx: geometry.node.x,
                  cy: geometry.node.y,
                  r: HEAD_RING_R,
                }),
                React.createElement('circle', {
                  key: 'ring-gap',
                  className: 'ggv-ring-gap',
                  cx: geometry.node.x,
                  cy: geometry.node.y,
                  r: HEAD_RING_GAP_R,
                }),
              ]
            : null,
          React.createElement('circle', {
            key: 'node',
            className: 'ggv-node ' + laneClass,
            cx: geometry.node.x,
            cy: geometry.node.y,
            r: NODE_R,
          }),
        ),
        React.createElement('div', { className: 'ggv-row-main' },
          React.createElement('div', { className: 'ggv-line1' },
            refs.length > 0
              ? React.createElement('span', { className: 'ggv-refs' },
                  shownRefs.map(function (ref, index) {
                    return React.createElement('span', {
                      key: 'ref' + index,
                      className: 'ggv-chip ' + refChipClass(ref),
                      title: ref && ref.name ? String(ref.name) : '',
                    },
                      React.createElement(RefChipIcon, { type: ref && ref.type }),
                      ref && ref.name ? String(ref.name) : '',
                    )
                  }),
                  hiddenRefCount > 0
                    ? React.createElement('span', { className: 'ggv-chip ggv-chip-more' }, '+' + hiddenRefCount)
                    : null,
                )
              : null,
            React.createElement('span', { className: 'ggv-subject' }, row.subject || props.noSubject),
          ),
          React.createElement('div', { className: 'ggv-line2' },
            React.createElement('span', { className: 'ggv-author' }, row.author || ''),
            React.createElement('span', { className: 'ggv-meta-dot' }, '·'),
            React.createElement('span', { className: 'ggv-meta-time' }, timeAgo(row.time, Date.now(), props.lang)),
            React.createElement('span', { className: 'ggv-meta-dot' }, '·'),
            React.createElement('span', { className: 'ggv-meta-sha' }, row.short || String(row.sha || '').slice(0, 7)),
          ),
        ),
      )
    }

    // ============================== 详情正文 ==============================

    function renderDetailBody(data, opts) {
      const t = opts.t
      const lang = opts.lang
      const stats = (data && data.stats) || {}
      const files = data && Array.isArray(data.files) ? data.files : []
      const parents = data && Array.isArray(data.parents) ? data.parents : []
      const known = opts.knownShas || null
      // 中英文标点差异：英文用半角冒号，中文用全角
      const sep = lang === 'en' ? ': ' : '：'
      const author = String((data && data.author) || '')
      const email = String((data && data.email) || '')
      const avatarLetter = author.trim() ? author.trim().charAt(0).toUpperCase() : '?'
      const timeValue = data && (data.commitTime || data.authorTime)
      const copyLabel = opts.copied === 'ok' ? t('copied') : (opts.copied === 'fail' ? t('copyFailed') : '')
      return React.createElement('div', { className: 'ggv-detail-body' },
        // 提交正文
        data && data.body
          ? React.createElement('pre', { className: 'ggv-pre' }, String(data.body))
          : null,
        // 作者 / 邮箱 / 时间
        React.createElement('div', { className: 'ggv-detail-section' },
          React.createElement('div', { className: 'ggv-author-row' },
            React.createElement('span', { className: 'ggv-avatar', 'aria-hidden': true }, avatarLetter),
            React.createElement('span', { className: 'ggv-author-info' },
              React.createElement('span', { className: 'ggv-author-name' }, author || '—'),
              email ? React.createElement('span', { className: 'ggv-author-mail' }, email) : null,
            ),
          ),
          React.createElement('div', { className: 'ggv-meta-line' },
            t('timeLabel') + sep + fmtAbsoluteTime(timeValue, lang) + ' · ' + timeAgo(timeValue, Date.now(), lang)),
        ),
        // 完整 sha + 复制
        React.createElement('div', { className: 'ggv-detail-section' },
          React.createElement('div', { className: 'ggv-sha-row' },
            React.createElement('span', { className: 'ggv-sha-full', title: data ? String(data.sha || '') : '' }, data ? String(data.sha || '') : ''),
            React.createElement('button', {
              type: 'button',
              className: 'ggv-iconbtn',
              title: t('copy'),
              'aria-label': t('copy'),
              onClick: function () { if (opts.onCopy) opts.onCopy(data ? data.sha : '') },
            }, opts.copied === 'ok' ? React.createElement(CheckIcon, null) : React.createElement(CopyIcon, null)),
            copyLabel
              ? React.createElement('span', {
                  className: 'ggv-copied' + (opts.copied === 'fail' ? ' ggv-copied-fail' : ''),
                  role: 'status',
                }, copyLabel)
              : null,
          ),
        ),
        // 父提交 pills（已加载的父提交可点选）
        parents.length > 0
          ? React.createElement('div', { className: 'ggv-detail-section' },
              React.createElement('div', { className: 'ggv-section-title' },
                t('parentsLabel') + (lang === 'en' ? ' (' : '（') + parents.length + (lang === 'en' ? ')' : '）')),
              React.createElement('div', { className: 'ggv-parents' },
                parents.map(function (parentSha, index) {
                  const canOpen = !!(known && known.has(parentSha) && opts.onSelectSha)
                  return React.createElement('button', {
                    key: 'parent' + index,
                    type: 'button',
                    className: 'ggv-parent',
                    disabled: !canOpen,
                    title: canOpen ? t('openParent') : String(parentSha),
                    onClick: canOpen ? function () { opts.onSelectSha(parentSha) } : undefined,
                  }, String(parentSha).slice(0, 7))
                }),
              ),
            )
          : null,
        // 文件变更 + 统计
        React.createElement('div', { className: 'ggv-detail-section' },
          React.createElement('div', { className: 'ggv-section-title' }, t('filesLabel')),
          React.createElement('div', { className: 'ggv-muted' },
            t('statsSummary', {
              files: formatCount(stats.files || 0),
              added: formatCount(stats.added || 0),
              deleted: formatCount(stats.deleted || 0),
            })),
          files.length === 0
            ? React.createElement('div', { className: 'ggv-muted' }, t('noFiles'))
            : React.createElement('div', { className: 'ggv-files' },
                files.map(function (file, index) {
                  const status = file && file.status ? String(file.status) : '?'
                  return React.createElement('div', {
                    key: 'file' + index,
                    className: 'ggv-file',
                    title: file && file.path ? String(file.path) : '',
                  },
                    React.createElement('span', { className: 'ggv-file-status ggv-file-status-' + status }, status),
                    React.createElement('span', { className: 'ggv-file-path' }, String((file && file.path) || '')),
                    React.createElement('span', { className: 'ggv-file-stat' },
                      file && file.added ? React.createElement('span', { className: 'ggv-add' }, '+' + file.added) : null,
                      file && file.deleted ? React.createElement('span', { className: 'ggv-del' }, '-' + file.deleted) : null,
                    ),
                  )
                }),
              ),
          data && data.filesTruncated
            ? React.createElement('div', { className: 'ggv-muted' }, t('filesTruncated'))
            : null,
        ),
      )
    }

    // ============================== 详情抽屉 / 覆盖面板 ==============================

    function DetailPanel(props) {
      const t = props.t
      const detail = props.detail || null
      const data = detail && detail.data ? detail.data : null
      const [copied, setCopied] = React.useState(false)
      const copyTimerRef = React.useRef(null)

      React.useEffect(function () {
        return function () {
          if (copyTimerRef.current) {
            try { clearTimeout(copyTimerRef.current) } catch (e) { /* 忽略 */ }
          }
        }
      }, [])

      const doCopy = function (text) {
        const mark = function (ok) {
          setCopied(ok ? 'ok' : 'fail')
          if (copyTimerRef.current) {
            try { clearTimeout(copyTimerRef.current) } catch (e) { /* 忽略 */ }
          }
          copyTimerRef.current = setTimeout(function () { setCopied(false) }, 1600)
        }
        try {
          const clipboard = (typeof navigator !== 'undefined' && navigator) ? navigator.clipboard : null
          if (clipboard && typeof clipboard.writeText === 'function') {
            Promise.resolve(clipboard.writeText(String(text))).then(function () { mark(true) }, function () { mark(false) })
            return
          }
        } catch (e) {
          mark(false)
          return
        }
        mark(false)
      }

      const rootClass = props.overlay ? 'ggv-detail-overlay' : 'ggv-detail'
      const title = data && data.subject ? data.subject : (detail && detail.status === 'error' ? t('detailError') : t('detail'))
      let body
      if (!detail || detail.status === 'loading') {
        body = React.createElement('div', { className: 'ggv-detail-body' },
          React.createElement('div', { className: 'ggv-detail-loading' }, t('detailLoading')))
      } else if (detail.status === 'error') {
        body = React.createElement('div', { className: 'ggv-detail-body' },
          renderStatePanel({
            kind: 'error',
            title: t('detailError'),
            sub: detail.message || t('errorSub'),
            actionLabel: t('retry'),
            onAction: props.onRetry,
          }))
      } else {
        body = renderDetailBody(data, {
          t: t,
          lang: props.lang,
          copied: copied,
          onCopy: doCopy,
          knownShas: props.knownShas,
          onSelectSha: props.onSelectSha,
        })
      }

      return React.createElement('div', {
        className: rootClass,
        role: 'dialog',
        'aria-modal': props.overlay ? 'true' : 'false',
        'aria-label': t('detail'),
        onClick: props.overlay
          ? function (event) {
              if (event && event.target === event.currentTarget && props.onClose) props.onClose()
            }
          : undefined,
      },
        React.createElement('div', { className: 'ggv-detail-head' },
          React.createElement('div', { className: 'ggv-detail-title', title: title }, title),
          data && data.isMerge
            ? React.createElement('span', { className: 'ggv-chip ggv-merge-chip', title: t('mergeHint') }, t('mergeChip'))
            : null,
          React.createElement('button', {
            type: 'button',
            className: 'ggv-iconbtn',
            title: t('close'),
            'aria-label': t('close'),
            onClick: props.onClose,
          }, React.createElement(CloseIcon, null)),
        ),
        body,
      )
    }

    // ============================== 主视图 ==============================

    function GitGraphView(props) {
      const ctx = props ? props.ctx : null
      const slotsProps = props ? props.slotsProps : null
      const sessionId = (props && props.sessionId !== undefined && props.sessionId !== null)
        ? props.sessionId
        : ((slotsProps && slotsProps.sessionId !== undefined && slotsProps.sessionId !== null) ? slotsProps.sessionId : null)
      const lang = langOf(
        typeof document !== 'undefined' ? document : null,
        typeof navigator !== 'undefined' ? navigator : null,
      )
      const t = i18n(lang).t

      // ---- 状态（hook 顺序固定，测试按顺序注入初值） ----
      const [chosenPath, setChosenPath] = React.useState(function () { return readStoredRepo(sessionId) })
      const [workspaces, setWorkspaces] = React.useState(null)
      const [workspacesError, setWorkspacesError] = React.useState(null)
      const [wsTick, setWsTick] = React.useState(0)
      // 会话服务可能后到：订阅 list 变化后递增，触发重新解析默认工作目录
      const [, setSessionTick] = React.useState(0)
      const [limit, setLimit] = React.useState(DEFAULT_LIMIT)
      const [graphState, setGraphState] = React.useState({ status: 'loading' })
      const [refreshTick, setRefreshTick] = React.useState(0)
      const [selectedSha, setSelectedSha] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [detailTick, setDetailTick] = React.useState(0)
      const [isWide, setIsWide] = React.useState(function () {
        try {
          return (window.innerWidth || 1200) >= WIDE_BREAKPOINT
        } catch (e) {
          return true
        }
      })
      const [query, setQuery] = React.useState('')
      // 当前 HEAD 行是否已在列表视口内：「回到 HEAD」仅在不可见时可用（DESIGN §6.2）
      const [headVisible, setHeadVisible] = React.useState(false)

      // ---- 引用（跨渲染的标记位 / 行 DOM 引用，用于搜索与 HEAD 定位滚动） ----
      const lastFetchAtRef = React.useRef(0)
      const forceRefreshRef = React.useRef(false)
      const sessionRef = React.useRef(sessionId)
      const rowRefsRef = React.useRef({})
      const listRef = React.useRef(null)

      // 解析当前生效的工作区：用户手选 > 会话 cwd > 工作区列表第一项
      const sessionCwd = resolveSessionCwd(ctx, sessionId)
      const firstWorkspace = workspaces && workspaces.length > 0 ? workspaces[0].path : null
      const activePath = chosenPath || sessionCwd || firstWorkspace || null

      const doRefresh = React.useCallback(function () {
        // 绕过 20s 缓存：置标记位 + 递增 tick 触发 effect
        forceRefreshRef.current = true
        setRefreshTick(function (value) { return value + 1 })
        setWsTick(function (value) { return value + 1 })
        setDetailTick(function (value) { return value + 1 })
      }, [])

      const selectPath = React.useCallback(function (path) {
        const next = path || null
        setChosenPath(next)
        writeStoredRepo(sessionId, next)
        setSelectedSha(null)
        setDetail(null)
        setLimit(DEFAULT_LIMIT)
      }, [sessionId])

      const selectSha = React.useCallback(function (sha) {
        setSelectedSha(sha || null)
      }, [])

      const closeDetail = React.useCallback(function () {
        setSelectedSha(null)
        setDetail(null)
      }, [])

      const loadMore = React.useCallback(function () {
        setLimit(function (value) { return Math.min(value + LOAD_MORE_STEP, MAX_LIMIT) })
      }, [])

      const retryDetail = React.useCallback(function () {
        setDetailTick(function (value) { return value + 1 })
      }, [])

      const clearQuery = React.useCallback(function () {
        setQuery('')
      }, [])

      // ---- 订阅会话服务（服务后到时重新解析默认工作目录） ----
      React.useEffect(function () {
        let unsubscribe = null
        try {
          const sessions = getService(ctx, 'sessions')
          const list = sessions && sessions.list
          if (list && typeof list.subscribe === 'function') {
            unsubscribe = list.subscribe(function () {
              setSessionTick(function (value) { return value + 1 })
            })
          }
        } catch (e) {
          unsubscribe = null
        }
        return function () {
          if (typeof unsubscribe === 'function') {
            try { unsubscribe() } catch (e) { /* 忽略 */ }
          }
        }
      }, [ctx])

      // ---- 加载工作区列表 ----
      React.useEffect(function () {
        let alive = true
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        setWorkspacesError(null)
        loadWorkspaces(sessionId, controller ? controller.signal : undefined).then(function (result) {
          if (!alive) return
          if (result.ok) setWorkspaces(result.workspaces)
          else setWorkspacesError((result.error && result.error.message) || i18n(lang).t('workspaceListError'))
        }, function (error) {
          if (!alive || (error && error.name === 'AbortError')) return
          setWorkspacesError(String((error && error.message) || error))
        })
        return function () {
          alive = false
          if (controller) {
            try { controller.abort() } catch (e) { /* 忽略 */ }
          }
        }
      }, [wsTick, sessionId, lang])

      // ---- 加载图谱（activePath / limit / refreshTick 变化时重取；20s 缓存命中则直接复用） ----
      React.useEffect(function () {
        if (!activePath) return undefined
        let alive = true
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const bypass = forceRefreshRef.current
        forceRefreshRef.current = false
        const cached = bypass ? null : readGraphCache(activePath, limit)
        lastFetchAtRef.current = Date.now()
        if (cached) {
          setGraphState(stateFromGraph(cached))
          return function () {
            alive = false
          }
        }
        setGraphState({ status: 'loading' })
        loadGraph(activePath, limit, controller ? controller.signal : undefined).then(function (result) {
          if (!alive) return
          if (result.ok) {
            writeGraphCache(activePath, limit, result.value)
            setGraphState(stateFromGraph(result.value))
          } else {
            setGraphState(stateFromError(result.error))
          }
        }, function (error) {
          if (!alive || (error && error.name === 'AbortError')) return
          setGraphState({ status: 'error', message: String((error && error.message) || error) })
        })
        return function () {
          alive = false
          if (controller) {
            try { controller.abort() } catch (e) { /* 忽略 */ }
          }
        }
      }, [activePath, limit, refreshTick])

      // ---- 加载提交详情 ----
      React.useEffect(function () {
        if (!activePath || !selectedSha) {
          setDetail(null)
          return undefined
        }
        let alive = true
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        setDetail({ status: 'loading', sha: selectedSha })
        loadCommit(activePath, selectedSha, controller ? controller.signal : undefined).then(function (result) {
          if (!alive) return
          if (result.ok) setDetail({ status: 'ready', sha: selectedSha, data: result.value })
          else {
            setDetail({
              status: 'error',
              sha: selectedSha,
              code: result.error && result.error.code,
              message: (result.error && result.error.message) || '',
            })
          }
        }, function (error) {
          if (!alive || (error && error.name === 'AbortError')) return
          setDetail({ status: 'error', sha: selectedSha, message: String((error && error.message) || error) })
        })
        return function () {
          alive = false
          if (controller) {
            try { controller.abort() } catch (e) { /* 忽略 */ }
          }
        }
      }, [activePath, selectedSha, detailTick])

      // ---- 窗口 focus：距上次拉取超过 20s 时重取（绕过缓存） ----
      React.useEffect(function () {
        const onFocus = function () {
          if (Date.now() - lastFetchAtRef.current > CACHE_TTL) {
            forceRefreshRef.current = true
            setRefreshTick(function (value) { return value + 1 })
            setWsTick(function (value) { return value + 1 })
          }
        }
        try {
          window.addEventListener('focus', onFocus)
        } catch (e) {
          return undefined
        }
        return function () {
          try { window.removeEventListener('focus', onFocus) } catch (e) { /* 忽略 */ }
        }
      }, [])

      // ---- 宽屏判定（右侧抽屉 vs 覆盖面板） ----
      React.useEffect(function () {
        const onResize = function () {
          try {
            setIsWide((window.innerWidth || 1200) >= WIDE_BREAKPOINT)
          } catch (e) {
            // 忽略
          }
        }
        try {
          window.addEventListener('resize', onResize)
        } catch (e) {
          return undefined
        }
        return function () {
          try { window.removeEventListener('resize', onResize) } catch (e) { /* 忽略 */ }
        }
      }, [])

      // ---- Esc：优先关闭详情，其次清空搜索（DESIGN §6.1/§6.6） ----
      React.useEffect(function () {
        const onKeyDown = function (event) {
          if (!event || event.key !== 'Escape') return
          if (selectedSha) {
            setSelectedSha(null)
            setDetail(null)
            return
          }
          if (query) setQuery('')
        }
        try {
          document.addEventListener('keydown', onKeyDown)
        } catch (e) {
          return undefined
        }
        return function () {
          try { document.removeEventListener('keydown', onKeyDown) } catch (e) { /* 忽略 */ }
        }
      }, [selectedSha, query])

      // ---- 会话切换：换回该会话记住的工作区并清空选中 ----
      React.useEffect(function () {
        if (sessionRef.current === sessionId) return
        sessionRef.current = sessionId
        setChosenPath(readStoredRepo(sessionId))
        setSelectedSha(null)
        setDetail(null)
        setLimit(DEFAULT_LIMIT)
      }, [sessionId])

      // ---- 派生数据 ----
      const graphData = graphState && graphState.data ? graphState.data : null
      const repo = graphData && graphData.repo ? graphData.repo : null
      const commits = graphData && Array.isArray(graphData.commits) ? graphData.commits : []
      const lanes = graphData && typeof graphData.lanes === 'number' && graphData.lanes > 0 ? graphData.lanes : 1
      const truncated = !!(graphData && graphData.truncated)
      const options = workspaceOptions(workspaces, activePath)
      const knownShas = new Set(commits.map(function (commit) { return commit.sha }))
      const detailOpen = !!(selectedSha && detail)
      const status = graphState && graphState.status ? graphState.status : 'loading'
      const headIndex = findHeadIndex(commits, repo)
      const refCounts = countRefKinds(commits)
      const summaryText = t('summaryCommits', { n: commits.length }) + ' · ' +
        t('summaryBranches', { n: refCounts.branches }) + ' · ' +
        t('summaryTags', { n: refCounts.tags })
      const searching = String(query || '').trim().length > 0

      // ---- 搜索：首个匹配行滚动到视口中央（DESIGN §6.1） ----
      React.useEffect(function () {
        if (!searching) return
        for (let i = 0; i < commits.length; i += 1) {
          if (matchesQuery(commits[i], query)) {
            scrollRowIntoView(rowRefsRef.current[commits[i].sha], 'center', true)
            break
          }
        }
      }, [query, commits.length])

      // ---- 选中行（点击 / ↑↓ / 回到 HEAD）滚动到视口 ----
      React.useEffect(function () {
        if (!selectedSha) return
        scrollRowIntoView(rowRefsRef.current[selectedSha], 'nearest', false)
      }, [selectedSha])

      // ---- HEAD 行进入/离开视口时切换「回到 HEAD」按钮可用性 ----
      React.useEffect(function () {
        updateHeadVisible()
      }, [headIndex, commits.length, activePath])

      // ---- 事件处理（非 hook，随渲染重建） ----
      function updateHeadVisible() {
        try {
          const listElement = listRef.current
          const headRow = headIndex >= 0 ? commits[headIndex] : null
          const rowElement = headRow ? rowRefsRef.current[headRow.sha] : null
          if (!listElement || !rowElement) return
          if (typeof listElement.getBoundingClientRect !== 'function' || typeof rowElement.getBoundingClientRect !== 'function') return
          const listRect = listElement.getBoundingClientRect()
          const rowRect = rowElement.getBoundingClientRect()
          const visible = rowRect.bottom > listRect.top + 4 && rowRect.top < listRect.bottom - 4
          setHeadVisible(function (previous) { return previous === visible ? previous : visible })
        } catch (e) {
          // 布局信息不可用时保持原状态
        }
      }

      function rowRefFor(sha) {
        return function (element) {
          if (!element) {
            delete rowRefsRef.current[sha]
            return
          }
          rowRefsRef.current[sha] = element
        }
      }

      function handleQueryChange(event) {
        setQuery(event && event.target ? event.target.value : '')
      }

      function handleSearchKeyDown(event) {
        if (!event || event.key !== 'Enter') return
        for (let i = 0; i < commits.length; i += 1) {
          if (matchesQuery(commits[i], query)) {
            selectSha(commits[i].sha)
            return
          }
        }
      }

      function handleRowNavigate(delta) {
        if (commits.length === 0) return
        let current = -1
        for (let i = 0; i < commits.length; i += 1) {
          if (commits[i].sha === selectedSha) { current = i; break }
        }
        let next = current < 0 ? 0 : current + delta
        if (next < 0) next = 0
        if (next > commits.length - 1) next = commits.length - 1
        selectSha(commits[next].sha)
      }

      function goToHead() {
        if (headIndex < 0) return
        selectSha(commits[headIndex].sha)
      }

      // ---- 头部 ----
      const branchChip = repo && repo.detached
        ? React.createElement('span', { className: 'ggv-chip ggv-chip-head', title: t('detached') },
            React.createElement(RefChipIcon, { type: 'head' }),
            'HEAD ' + String(repo.head || '').slice(0, 7))
        : (repo && repo.branch && repo.branch !== 'HEAD'
            ? React.createElement('span', { className: 'ggv-chip ggv-chip-branch', title: t('branch') },
                React.createElement(RefChipIcon, { type: 'branch' }),
                String(repo.branch))
            : null)
      const dirtyChip = repo && Number(repo.dirty) > 0
        ? React.createElement('span', { className: 'ggv-chip ggv-chip-warn', title: t('changesChip', { n: repo.dirty }) },
            t('changesChip', { n: repo.dirty }))
        : null
      const conflictChip = repo && Number(repo.conflict) > 0
        ? React.createElement('span', { className: 'ggv-chip ggv-chip-error' }, t('conflictChip', { n: repo.conflict }))
        : null
      const trackChip = repo && (Number(repo.ahead) > 0 || Number(repo.behind) > 0)
        ? React.createElement('span', { className: 'ggv-chip ggv-chip-success' },
            (Number(repo.ahead) > 0 ? '↑' + repo.ahead : '') +
            (Number(repo.ahead) > 0 && Number(repo.behind) > 0 ? ' ' : '') +
            (Number(repo.behind) > 0 ? '↓' + repo.behind : ''))
        : null

      const header = React.createElement('div', { className: 'ggv-head' },
        React.createElement('span', { className: 'ggv-repo-icon', 'aria-hidden': true }, React.createElement(RepoIcon, null)),
        React.createElement('span', {
          className: 'ggv-repo-name',
          title: repo && repo.root ? String(repo.root) : (activePath || ''),
        }, (repo && (repo.name || baseName(repo.root))) || baseName(activePath || '') || t('title')),
        React.createElement('div', { className: 'ggv-head-chips' },
          branchChip,
          dirtyChip,
          conflictChip,
          trackChip,
        ),
        React.createElement('span', { className: 'ggv-head-spacer' }),
        React.createElement('select', {
          className: 'ggv-select',
          value: activePath || '',
          title: workspacesError ? workspacesError : t('workspaceSelect'),
          'aria-label': t('workspace'),
          onChange: function (event) { selectPath(event && event.target ? event.target.value : null) },
          disabled: options.length === 0,
        },
          !activePath ? React.createElement('option', { value: '' }, t('workspaceSelect')) : null,
          options.map(function (option) {
            return React.createElement('option', { key: option.path, value: option.path }, option.title)
          }),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'ggv-iconbtn',
          title: t('refreshTitle'),
          'aria-label': t('refresh'),
          onClick: doRefresh,
          disabled: status === 'loading',
        }, React.createElement('span', { className: status === 'loading' ? 'ggv-spin' : '' }, React.createElement(RefreshIcon, null))),
        React.createElement('button', {
          type: 'button',
          className: 'ggv-head-btn',
          title: headIndex < 0 ? t('headNotLoaded') : t('backToHead'),
          'aria-label': t('backToHead'),
          onClick: goToHead,
          disabled: headIndex < 0 || headVisible,
        },
          React.createElement(HeadIcon, null),
          React.createElement('span', null, 'HEAD'),
        ),
      )

      // ---- toolbar：搜索 + 统计摘要 ----
      const toolbar = React.createElement('div', { className: 'ggv-toolbar' },
        React.createElement('div', { className: 'ggv-search' },
          React.createElement('span', { className: 'ggv-search-icon' }, React.createElement(SearchIcon, null)),
          React.createElement('input', {
            className: 'ggv-search-input',
            type: 'text',
            value: query,
            placeholder: t('searchPlaceholder'),
            'aria-label': t('searchLabel'),
            onChange: handleQueryChange,
            onKeyDown: handleSearchKeyDown,
          }),
          query
            ? React.createElement('button', {
                type: 'button',
                className: 'ggv-search-clear',
                title: t('clearSearch'),
                'aria-label': t('clearSearch'),
                onClick: clearQuery,
              }, React.createElement(CloseIcon, { size: 12 }))
            : null,
        ),
        React.createElement('span', { className: 'ggv-summary' }, summaryText),
      )

      // ---- 主体内容（按状态机分支，任何状态都有文案与操作入口） ----
      let content = null
      if (!activePath) {
        if (workspaces === null && !workspacesError) {
          content = renderSkeleton(t)
        } else {
          content = renderStatePanel({
            kind: 'empty',
            title: t('noWorkspaceTitle'),
            sub: (sessionId ? t('noWorkspaceSub') : t('noSessionSub')) +
              (workspacesError ? '（' + workspacesError + '）' : ''),
            actionLabel: t('retry'),
            onAction: doRefresh,
          })
        }
      } else if (status === 'loading') {
        content = renderSkeleton(t)
      } else if (status === 'empty-repo') {
        content = renderStatePanel({
          kind: 'empty',
          title: t('emptyRepoTitle'),
          sub: t('emptyRepoSub'),
          actionLabel: t('refresh'),
          onAction: doRefresh,
        })
      } else if (status === 'not-repo') {
        content = renderStatePanel({
          kind: 'warn',
          title: t('notRepoTitle'),
          sub: t('notRepoSub'),
          actionLabel: t('refresh'),
          onAction: doRefresh,
        })
      } else if (status === 'not-workspace') {
        content = renderStatePanel({
          kind: 'warn',
          title: t('notWorkspaceTitle'),
          sub: t('notWorkspaceSub'),
          actionLabel: t('refresh'),
          onAction: doRefresh,
        })
      } else if (status === 'git-missing') {
        content = renderStatePanel({
          kind: 'warn',
          title: t('gitMissingTitle'),
          sub: t('gitMissingSub'),
          actionLabel: t('refresh'),
          onAction: doRefresh,
        })
      } else if (status === 'error') {
        content = renderStatePanel({
          kind: 'error',
          title: t('errorTitle'),
          sub: (graphState && graphState.message ? graphState.message + ' · ' : '') + t('errorSub'),
          actionLabel: t('retry'),
          onAction: doRefresh,
        })
      } else {
        content = React.createElement('div', { className: 'ggv-list-wrap' },
          React.createElement('div', { className: 'ggv-list', role: 'list', ref: listRef, onScroll: updateHeadVisible },
            commits.map(function (commit) {
              return React.createElement(CommitRow, {
                key: commit.sha,
                row: commit,
                lanes: lanes,
                lang: lang,
                noSubject: t('noSubject'),
                selected: selectedSha === commit.sha,
                head: isHeadRow(commit, repo),
                dim: searching && !matchesQuery(commit, query),
                rowRef: rowRefFor(commit.sha),
                onSelect: selectSha,
                onNavigate: handleRowNavigate,
              })
            }),
          ),
          React.createElement('div', { className: 'ggv-foot' },
            React.createElement('span', null, t('commitsLoaded', { n: commits.length })),
            React.createElement('span', { className: 'ggv-foot-spacer' }),
            truncated
              ? (limit < MAX_LIMIT
                  ? React.createElement('button', {
                      type: 'button',
                      className: 'ggv-btn',
                      onClick: loadMore,
                      disabled: status === 'loading',
                    }, t('loadMoreWithCount', { n: LOAD_MORE_STEP }))
                  : React.createElement('span', null, t('limitReached', { n: MAX_LIMIT })))
              : null,
          ),
        )
      }

      // ---- 详情（宽屏并排，窄屏覆盖） ----
      const detailElement = detailOpen
        ? React.createElement(DetailPanel, {
            detail: detail,
            lang: lang,
            t: t,
            overlay: !isWide,
            knownShas: knownShas,
            onClose: closeDetail,
            onRetry: retryDetail,
            onSelectSha: selectSha,
          })
        : null

      // data-conversation-composer-overlay：官方非聊天视图（如「轨迹」）用这个标记告诉会话外壳
      // “本视图自己管理高度与滚动”。外壳随后把 viewArea 约束为 flex:1 / min-height:0 /
      // overflow:hidden，并把输入席改成悬浮在底部的覆盖层。于是左侧图谱列表与右侧详情抽屉
      // 各自拥有独立滚动条，而不再由整个会话页共用一个滚动条（DESIGN §9）。
      return React.createElement('div', {
        className: 'ggv-view',
        'data-conversation-composer-overlay': '',
      },
        header,
        toolbar,
        React.createElement('div', { className: 'ggv-body' },
          content,
          detailOpen && isWide ? detailElement : null,
        ),
        detailOpen && !isWide ? detailElement : null,
      )
    }

    // ============================== 插件入口 ==============================

    function apply(ctx) {
      const slots = slotServiceOf(ctx || {})
      if (!slots) return

      ensureStyle(ctx)

      if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
      try {
        slots.inject('conversation.view', function () {
          return slots.register({
            name: 'conversation.view',
            id: 'dsh-git-graph-view',
            order: 6,
            label: () => 'Git 图谱',
            inject: (sessionId) => ({ sessionId }),
          }, function ViewEntry(props) {
            return React.createElement(GitGraphView, { ctx: ctx, slotsProps: props })
          })
        })
      } catch (e) {
        try {
          console.error('[dsh-git-graph-view] 注册 conversation.view 失败：' + String((e && e.message) || e))
        } catch (e2) {
          // console 不可用时静默
        }
      }
    }

    exports.inject = ['slots', 'sessions']
    exports.apply = apply
    exports.__test = {
      COL_W: COL_W,
      ROW_H: ROW_H,
      matchesQuery: matchesQuery,
      findHeadIndex: findHeadIndex,
      buildRowGeometry: buildRowGeometry,
      timeAgo: timeAgo,
      formatCount: formatCount,
      refChipClass: refChipClass,
      langOf: langOf,
      i18n: i18n,
    }
    return module.exports
  },
})
