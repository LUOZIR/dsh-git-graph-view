/**
 * dsh-git-graph-view — client 半体契约测试（CONTRACT 第 5 节；视觉断言来自 docs/DESIGN.md）
 *
 * 形态：用 node:vm 在 stub 的 window/document/navigator 环境里执行 lib/client.js 源码，
 * 截获 window.__ModuleLoader__.load 的 options，用 stub React 执行 factory，
 * 然后逐条断言槽位注册、样式注入/dispose、纯函数几何/i18n/搜索/HEAD 定位、以及
 * 用按 hook 顺序注入 useState 初值的极简 reconciler 实渲染各状态（不白屏）。
 *
 * 运行：node --test test/client-contract.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_FILE = path.join(ROOT, 'lib', 'client.js')

// DESIGN §1/§2/§3/§4 要求使用的官方 DSH 主题令牌（每个都必须带 fallback）
const REQUIRED_TOKENS = [
  // 字体 / 圆角 / 焦点环 / 高度阴影
  '--dsw-font-family',
  '--ds-font-family-code',
  '--dsw-radius-xs',
  '--dsw-radius-sm',
  '--dsw-radius-md',
  '--dsw-focus-ring-width',
  '--dsw-elevation-soft',
  // 底色与层级
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-skeleton',
  '--dsw-specific-menu',
  // 文字
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-primary-foreground',
  // 描边 / 交互
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-interactive-bg-hover',
  // 状态色
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-link',
  // 滚动条
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l2',
]

// ============================== stub 环境 ==============================

function createLocalStorageStub() {
  const store = new Map()
  return {
    getItem(key) {
      const k = String(key)
      return store.has(k) ? store.get(k) : null
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
    removeItem(key) {
      store.delete(String(key))
    },
    clear() {
      store.clear()
    },
    get size() {
      return store.size
    },
  }
}

function createDocumentStub() {
  const head = {
    children: [],
    appendChild(child) {
      child.parentNode = head
      head.children.push(child)
      return child
    },
    removeChild(child) {
      const index = head.children.indexOf(child)
      if (index >= 0) head.children.splice(index, 1)
      child.parentNode = null
      return child
    },
  }
  return {
    documentElement: { lang: 'zh-CN' },
    head,
    createElement(tagName) {
      return {
        tagName: String(tagName).toUpperCase(),
        attrs: {},
        textContent: '',
        parentNode: null,
        setAttribute(name, value) {
          this.attrs[String(name)] = String(value)
        },
        getAttribute(name) {
          const key = String(name)
          return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null
        },
        removeAttribute(name) {
          delete this.attrs[String(name)]
        },
      }
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      const wanted = 'style[data-plugin-css="dsh-git-graph-view"]'
      if (selector !== wanted) return null
      return head.children.filter(function (element) {
        return element.getAttribute('data-plugin-css') === 'dsh-git-graph-view'
      })[0] || null
    },
  }
}

function createWindowStub(loadCalls) {
  return {
    __ModuleLoader__: {
      load(options) {
        loadCalls.push(options)
      },
    },
    innerWidth: 1280,
    addEventListener() {},
    removeEventListener() {},
    localStorage: createLocalStorageStub(),
  }
}

function createConsoleStub() {
  return {
    log() {},
    warn() {},
    error() {},
    info() {},
  }
}

/** stub React：满足 factory 顶层 require；可选 stateValues 按 hook 调用顺序注入 useState 初值。 */
function createReactStub(stateValues) {
  const injected = Array.isArray(stateValues) ? stateValues : null
  let hookIndex = 0
  const createElement = function (type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    return { $$typeof: 'react.element', type, props: props || {}, children }
  }
  return {
    createElement,
    Fragment: 'Fragment',
    useState(initial) {
      const index = hookIndex
      hookIndex += 1
      const value = injected && index < injected.length
        ? injected[index]
        : (typeof initial === 'function' ? initial() : initial)
      return [value, function noop() {}]
    },
    useRef(initial) {
      return { current: initial }
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    useReducer(reducer, initial) {
      return [initial, function noop() {}]
    },
    memo(fn) {
      return fn
    },
  }
}

/** 遍历 createElement 树（元素/数组/文本），对每个宿主或组件元素回调 visit。 */
function walkTree(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walkTree(child, visit)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'string' || typeof node.type === 'function') {
    visit(node)
    if (Array.isArray(node.children)) {
      for (const child of node.children) walkTree(child, visit)
    }
  }
}

/** 收集一棵树里的全部文本（用于断言空态/文案）。 */
function collectText(node) {
  const parts = []
  const visit = function (value) {
    if (value === null || value === undefined || typeof value === 'boolean') return
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value === 'object' && Array.isArray(value.children)) {
      value.children.forEach(visit)
    }
  }
  visit(node)
  return parts.join(' ')
}

function findElements(tree, predicate) {
  const found = []
  walkTree(tree, function (element) {
    if (predicate(element)) found.push(element)
  })
  return found
}

function hasClass(element, className) {
  const value = element && element.props ? element.props.className : null
  if (typeof value !== 'string') return false
  return (' ' + value + ' ').indexOf(' ' + className + ' ') >= 0
}

function elementsByClass(tree, className) {
  return findElements(tree, function (element) { return hasClass(element, className) })
}

/** 手动展开一个函数组件元素（stub 环境没有 reconciler，测试里显式调用一次）。 */
function expandElement(element) {
  assert.equal(typeof element.type, 'function', '元素应是待展开的函数组件')
  return element.type(element.props)
}

/** 递归展开树中的全部函数组件（测试用的极简 reconciler；不处理 hooks 状态更新）。 */
function expandDeep(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expandDeep)
  if (typeof node.type === 'function') return expandDeep(node.type(node.props))
  return {
    $$typeof: node.$$typeof,
    type: node.type,
    props: node.props,
    children: Array.isArray(node.children) ? node.children.map(expandDeep) : [],
  }
}

/** 用指定的 useState 注入值渲染主视图：mock 的 hook 顺序与 GitGraphView 一致。 */
async function renderView(stateValues, options = {}) {
  const reactStub = createReactStub(stateValues)
  const moduleHandle = await loadClientModule({ react: reactStub })
  const fake = makeFakeCtx(options.ctxOptions || {})
  moduleHandle.exp.apply(fake.ctx)
  const entry = fake.registrations[0].component
  const outer = entry(options.props || { sessionId: 'sid' })
  const rawTree = outer.type(outer.props)
  assert.ok(rawTree && typeof rawTree.type === 'string', '主视图应返回宿主元素')
  return { tree: expandDeep(rawTree), moduleHandle, fake }
}

class FakeAbortController {
  constructor() {
    this.signal = { aborted: false }
  }

  abort() {
    this.signal.aborted = true
  }
}

/**
 * 在 vm 中执行 lib/client.js，返回模块句柄与 stub 环境。
 * 源码里唯一的顶层副作用是调用 window.__ModuleLoader__.load。
 */
async function loadClientModule(options = {}) {
  const source = await readFile(CLIENT_FILE, 'utf8')
  const loadCalls = []
  const documentStub = options.document || createDocumentStub()
  const windowStub = createWindowStub(loadCalls)
  const navigatorStub = { language: 'zh-CN', languages: ['zh-CN'] }
  const sandbox = {
    window: windowStub,
    document: documentStub,
    navigator: navigatorStub,
    console: createConsoleStub(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: options.fetch || function () {
      return Promise.reject(new Error('契约测试不应发起网络请求'))
    },
    AbortController: options.AbortController || FakeAbortController,
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(source, context, { filename: 'lib/client.js' })

  assert.equal(loadCalls.length, 1, '源码应恰好调用一次 window.__ModuleLoader__.load')
  const opts = loadCalls[0]

  const requireCalls = []
  const reactStub = options.react || createReactStub()
  const exp = opts.factory(function requireStub(name) {
    requireCalls.push(name)
    if (name !== 'react') throw new Error('factory 只允许 require("react")，收到：' + name)
    return reactStub
  })

  return { source, loadCalls, opts, exp, reactStub, requireCalls, documentStub, windowStub, navigatorStub, context }
}

/** fake client ctx：记录 inject / register / effect，供断言与 dispose 调用。 */
function makeFakeCtx(options = {}) {
  const opts = options
  const effects = []
  const injected = []
  const registrations = []
  const slots = {
    inject(name, callback) {
      injected.push(name)
      if (opts.invokeInject !== false) callback()
    },
    register(meta, component) {
      const record = { meta, component, disposed: false }
      registrations.push(record)
      return function dispose() {
        record.disposed = true
      }
    },
  }
  const sessions = opts.sessions === false ? undefined : {
    list: {
      getSnapshot() {
        return { byId: { sid: { cwd: 'C:/workspace/alpha' }, other: { cwd: 'C:/workspace/beta' } } }
      },
      subscribe() {
        return function unsubscribe() {}
      },
    },
  }
  const ctx = {
    slots: opts.slotsViaGet ? undefined : slots,
    effect(fn) {
      const dispose = fn()
      effects.push({ dispose, fn })
      return dispose
    },
    get(name) {
      if (opts.slotsViaGet && name === 'slots') return slots
      if (name === 'sessions') return sessions
      return undefined
    },
  }
  return { ctx, slots, effects, injected, registrations, sessions }
}

/**
 * 把 vm 里创建的对象/数组转成本 realm 的普通结构：
 * 跨 realm 的值原型不同，assert.deepStrictEqual 会因 prototype 不同而失败。
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function stylesInDocument(documentStub) {
  return documentStub.head.children.filter(function (element) {
    return element.getAttribute('data-plugin-css') === 'dsh-git-graph-view'
  })
}

// ============================== 测试 ==============================

test('1. ModuleLoader 注册与源码形态（契约 5.1 / 5.7）', async () => {
  const { source, loadCalls, opts } = await loadClientModule()

  assert.equal(loadCalls.length, 1)
  assert.equal(opts.id, 'dsh-git-graph-view')
  assert.equal(typeof opts.factory, 'function')

  assert.ok(source.includes('window.__ModuleLoader__.load'), '应以 window.__ModuleLoader__.load 挂载')
  assert.ok(source.includes("require('react')"), '应从宿主 require("react")')

  // 无 import/export 语法：源码必须能按经典脚本解析（有 ESM 语法会抛 SyntaxError）
  assert.doesNotThrow(
    () => new vm.Script(source, { filename: 'lib/client.js' }),
    'lib/client.js 必须可按经典脚本解析（无 import/export 语法）',
  )
  assert.ok(!/^\s*(import|export)\s/m.test(source), '源码不应包含 ESM import/export 语句')
  assert.ok(!source.includes('\r'), '文件必须使用 LF 换行')
  assert.ok(/[\u4e00-\u9fa5]/.test(source), '源码应包含中文注释')
})

test('2. factory 用 stub React 执行并返回插件对象（契约 5.2）', async () => {
  const { exp, requireCalls } = await loadClientModule()
  assert.deepEqual(requireCalls, ['react'])
  assert.equal(typeof exp, 'object')
  assert.ok(exp !== null)
})

test('3. 导出 inject / apply / __test（契约 5.3 / 4.5）', async () => {
  const { exp } = await loadClientModule()
  assert.deepEqual(Array.from(exp.inject), ['slots', 'sessions'])
  assert.equal(typeof exp.apply, 'function')
  assert.equal(typeof exp.__test, 'object')

  const required = [
    'COL_W', 'ROW_H', 'matchesQuery', 'findHeadIndex', 'buildRowGeometry',
    'timeAgo', 'formatCount', 'refChipClass', 'langOf', 'i18n',
  ]
  for (const key of required) {
    assert.ok(key in exp.__test, '__test 缺少 ' + key)
  }
  assert.equal(exp.__test.COL_W, 14)
  assert.equal(exp.__test.ROW_H, 46, 'ROW_H 应按 DESIGN/CONTRACT 更新为 46')
  for (const name of ['matchesQuery', 'findHeadIndex', 'buildRowGeometry', 'timeAgo', 'formatCount', 'refChipClass', 'langOf', 'i18n']) {
    assert.equal(typeof exp.__test[name], 'function', '__test.' + name + ' 应是函数')
  }
})

test('4. apply 注册 conversation.view 槽位（契约 5.4 / 4.1）', async () => {
  const { exp } = await loadClientModule()

  const fake = makeFakeCtx()
  exp.apply(fake.ctx)

  assert.deepEqual(fake.injected, ['conversation.view'], 'slots.inject 的槽位名必须是 conversation.view')
  assert.equal(fake.registrations.length, 1, '应注册 1 个视图')
  const { meta, component } = fake.registrations[0]
  assert.equal(meta.name, 'conversation.view')
  assert.equal(meta.id, 'dsh-git-graph-view')
  assert.equal(meta.order, 6)
  assert.equal(typeof meta.label, 'function')
  const label = meta.label()
  assert.equal(typeof label, 'string')
  assert.ok(label.length > 0, 'label() 必须返回非空字符串')
  assert.equal(label, 'Git 图谱')
  assert.deepEqual(plain(meta.inject('sid')), { sessionId: 'sid' })
  assert.equal(typeof component, 'function')

  // ctx.slots 缺失时应回退到 ctx.get('slots')
  const viaGet = makeFakeCtx({ slotsViaGet: true })
  exp.apply(viaGet.ctx)
  assert.equal(viaGet.registrations.length, 1, '应通过 ctx.get("slots") 取到槽位面')
  assert.equal(viaGet.registrations[0].meta.id, 'dsh-git-graph-view')

  // 拿不到槽位 / 空 ctx 必须安全返回，不抛异常
  assert.doesNotThrow(() => exp.apply({}))
  assert.doesNotThrow(() => exp.apply({ slots: null, get() { return undefined } }))
  assert.doesNotThrow(() => exp.apply(null))
  assert.doesNotThrow(() => exp.apply(undefined))
})

test('5. 样式注入、幂等与 dispose 移除（契约 5.5 / 4.4）', async () => {
  const { exp, documentStub } = await loadClientModule()
  const fake = makeFakeCtx()

  exp.apply(fake.ctx)
  const styles = stylesInDocument(documentStub)
  assert.equal(styles.length, 1, 'document.head 应有 1 个 style[data-plugin-css="dsh-git-graph-view"]')

  const css = styles[0].textContent
  for (const token of REQUIRED_TOKENS) {
    assert.ok(css.includes('var(' + token + ','), '主题令牌缺少 fallback：' + token)
  }
  // DESIGN §5：官方 8 色静态泳道色板（lane % 8），不再使用 10 色
  for (let index = 0; index < 8; index += 1) {
    assert.ok(css.includes('.ggv-c' + index), '缺少泳道颜色类 .ggv-c' + index)
  }
  assert.ok(!css.includes('.ggv-c8'), '泳道色板应按 DESIGN 收敛为 8 色')
  // DESIGN §1.1：暗色只看 body[data-ds-dark-theme]，不再使用 prefers-color-scheme
  assert.ok(css.includes('body[data-ds-dark-theme] .ggv-view'), '暗色应由 body[data-ds-dark-theme] 切换')
  assert.ok(!css.includes('prefers-color-scheme'), '不应再使用 prefers-color-scheme 暗色分支')
  // DESIGN §1.7：保留 prefers-reduced-motion 降级
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), '应保留 prefers-reduced-motion 降级')
  // DESIGN §4：版面尺寸
  assert.ok(css.includes('content-visibility:auto'), '提交行需要 content-visibility:auto')
  assert.ok(css.includes('contain-intrinsic-size:46px'), '提交行需要 contain-intrinsic-size:46px')
  assert.ok(css.includes('height:46px'), '提交行行高应为 46px')
  assert.ok(css.includes('width:380px'), '宽屏详情抽屉宽度应为 380px')
  assert.ok(css.includes('border-radius:var(--dsw-radius-md,12px)'), '列表行应使用官方 md 圆角令牌')
  // DESIGN §3：官方组件配方
  assert.ok(css.includes('width:28px') && css.includes('height:28px'), '图标按钮应为 28×28')
  assert.ok(css.includes('height:30px'), '搜索框高度应为 30px')
  assert.ok(css.includes('height:48px'), '详情抽屉头部高度应为 48px')
  assert.ok(css.includes('font:500 11px/14px'), 'refs chip 字体应为 500 11px/14px')
  assert.ok(css.includes('--ggv-lane-0') && css.includes('--ggv-lane-7'), '应定义 8 色泳道色板变量')
  assert.ok(css.includes('outline:var(--dsw-focus-ring-width,2px) solid'), '焦点环应使用官方令牌')
  // DESIGN §9 / 用户反馈：本视图自管滚动——左侧图谱列表与右侧详情各自独立滚动条
  assert.ok(css.includes('padding-bottom:var(--dsh-composer-height'), '应为悬浮输入席预留 --dsh-composer-height')
  assert.ok((css.match(/overflow-y:auto/g) || []).length >= 2, '列表与详情正文都应各自 overflow-y:auto')
  assert.ok((css.match(/overscroll-behavior:contain/g) || []).length >= 2, '两个滚动容器都应阻止滚动链')
  assert.ok(css.includes('scrollbar-gutter:stable'), '滚动容器应预留滚动条槽位')
  // DESIGN §1.3：字号只允许 11/12/13/14 层级（font-size 与 font 简写都检查）
  const fontSizeValues = [...css.matchAll(/font-size:(\d+)px/g)].map((match) => Number(match[1]))
  assert.deepEqual(fontSizeValues.filter((size) => [11, 12, 13, 14].indexOf(size) < 0), [], 'font-size 只允许 11/12/13/14')
  const shorthandSizeValues = [...css.matchAll(/font:(?:[\d.]+ )?(\d+)px\//g)].map((match) => Number(match[1]))
  assert.deepEqual(shorthandSizeValues.filter((size) => [11, 12, 13, 14].indexOf(size) < 0), [], 'font 简写字号只允许 11/12/13/14')

  // 重复 apply：样式不应重复注入
  exp.apply(fake.ctx)
  assert.equal(stylesInDocument(documentStub).length, 1, '重复 apply 必须幂等')

  // dispose：ctx.effect 的清理函数应移除 style 元素
  assert.ok(fake.effects.length >= 1, '应通过 ctx.effect 注册清理')
  for (const effect of fake.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  assert.equal(stylesInDocument(documentStub).length, 0, 'dispose 后 style 元素应被移除')

  // dispose 后再次 apply 能重新注入
  exp.apply(fake.ctx)
  assert.equal(stylesInDocument(documentStub).length, 1, 'dispose 后重新 apply 应重新注入样式')

  // 跨模块实例（HMR / loader 重跑）也不重复注入
  const sharedDocument = createDocumentStub()
  const moduleA = await loadClientModule({ document: sharedDocument })
  const moduleB = await loadClientModule({ document: sharedDocument })
  const ctxA = makeFakeCtx()
  const ctxB = makeFakeCtx()
  moduleA.exp.apply(ctxA.ctx)
  moduleB.exp.apply(ctxB.ctx)
  assert.equal(stylesInDocument(sharedDocument).length, 1, '跨模块实例重复 apply 不应重复注入样式')
  for (const effect of ctxA.effects) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  assert.equal(stylesInDocument(sharedDocument).length, 0, '样式创建者 dispose 后应移除样式')
})

test('6. buildRowGeometry 与 CONTRACT 第 3 节逐条一致（契约 5.6）', async () => {
  const { exp } = await loadClientModule()
  const { buildRowGeometry, COL_W, ROW_H } = exp.__test
  assert.equal(COL_W, 14)
  assert.equal(ROW_H, 46)

  const base = {
    sha: 'x', short: 'x', subject: 'x', author: 'x', email: 'x', time: 0, parents: [], refs: [],
    lane: 0, above: [], below: [], mergesIn: [], forks: [], nodeAbove: false, nodeBelow: false,
  }
  const makeRow = (patch) => Object.assign({}, base, patch)
  const geometry = (patch) => buildRowGeometry(makeRow(patch))

  // 样例 1：单列直线延续（above/below 同列 + 节点上下段）
  // 规则 1 竖线 → 规则 2 节点上段 → 规则 3 节点下段；ROW_H=46 → midY=23，节点圆心 (21,23)
  assert.deepEqual(plain(geometry({ lane: 1, above: [1], below: [1], nodeAbove: true, nodeBelow: true })), {
    segments: [
      { col: 1, kind: 'line', d: 'M 21 0 V 46' },
      { col: 1, kind: 'node-above', d: 'M 21 0 V 23' },
      { col: 1, kind: 'node-below', d: 'M 21 23 V 46' },
    ],
    node: { x: 21, y: 23, col: 1 },
  })

  // 样例 2：分叉 + 汇入（lane 0 的节点，来源列 1 汇入，向下分叉到列 2）
  // 规则 1 merge → 规则 3 节点下段 → 规则 4 fork → 规则 5 below 新列 0 的竖线
  assert.deepEqual(plain(geometry({ lane: 0, above: [1], mergesIn: [1], below: [0, 2], forks: [2], nodeBelow: true })), {
    segments: [
      { col: 1, kind: 'merge', d: 'M 21 0 V 23 Q 21 23 7 23' },
      { col: 0, kind: 'node-below', d: 'M 7 23 V 46' },
      { col: 2, kind: 'fork', d: 'M 7 23 Q 7 46 35 46' },
      { col: 0, kind: 'line', d: 'M 7 0 V 46' },
    ],
    node: { x: 7, y: 23, col: 0 },
  })

  // 样例 3：lane 2 的多列上部（含汇入列 0）+ 节点上段 + 向下分叉到列 3；
  // below 中的 2 已在 above、3 已在 forks，规则 5 不重复画线
  assert.deepEqual(plain(geometry({ lane: 2, above: [0, 1, 2], mergesIn: [0], below: [2, 3], forks: [3], nodeAbove: true })), {
    segments: [
      { col: 0, kind: 'merge', d: 'M 7 0 V 23 Q 7 23 35 23' },
      { col: 1, kind: 'line', d: 'M 21 0 V 46' },
      { col: 2, kind: 'line', d: 'M 35 0 V 46' },
      { col: 2, kind: 'node-above', d: 'M 35 0 V 23' },
      { col: 3, kind: 'fork', d: 'M 35 23 Q 35 46 49 46' },
    ],
    node: { x: 35, y: 23, col: 2 },
  })

  // 样例 4：只有 below 新列（规则 5）且没有节点上下段
  assert.deepEqual(plain(geometry({ lane: 1, below: [0, 2] })), {
    segments: [
      { col: 0, kind: 'line', d: 'M 7 0 V 46' },
      { col: 2, kind: 'line', d: 'M 35 0 V 46' },
    ],
    node: { x: 21, y: 23, col: 1 },
  })

  // 样例 5：空行只有节点，segments 为空数组
  assert.deepEqual(plain(geometry({ lane: 0 })), {
    segments: [],
    node: { x: 7, y: 23, col: 0 },
  })

  // 列颜色映射：路径 col 用于 ggv-cN（分叉用目标列、汇入用源列）
  const forkGeometry = geometry({ lane: 0, below: [3], forks: [3] })
  const forkSegment = forkGeometry.segments.filter((segment) => segment.kind === 'fork')[0]
  assert.equal(forkSegment.col, 3)
  assert.equal(forkSegment.d, 'M 7 23 Q 7 46 49 46')
})

test('7. timeAgo / formatCount / refChipClass / langOf / i18n 基本行为（契约 5.6）', async () => {
  const { exp } = await loadClientModule()
  const { timeAgo, formatCount, refChipClass, langOf, i18n } = exp.__test

  // ---- timeAgo：固定 now（毫秒），覆盖秒/分/时/天/月/年与未来/秒级 now ----
  const nowMs = 1700000000000
  const nowSec = Math.floor(nowMs / 1000)
  assert.equal(timeAgo(nowSec - 2, nowMs, 'zh'), '刚刚')
  assert.equal(timeAgo(nowSec - 2, nowMs, 'en'), 'just now')
  assert.equal(timeAgo(nowSec - 30, nowMs, 'zh'), '30 秒前')
  assert.equal(timeAgo(nowSec - 30, nowMs, 'en'), '30s ago')
  assert.equal(timeAgo(nowSec - 300, nowMs, 'zh'), '5 分钟前')
  assert.equal(timeAgo(nowSec - 300, nowMs, 'en'), '5m ago')
  assert.equal(timeAgo(nowSec - 3 * 3600, nowMs, 'zh'), '3 小时前')
  assert.equal(timeAgo(nowSec - 2 * 86400, nowMs, 'zh'), '2 天前')
  assert.equal(timeAgo(nowSec - 40 * 86400, nowMs, 'zh'), '1 个月前')
  assert.equal(timeAgo(nowSec - 400 * 86400, nowMs, 'zh'), '1 年前')
  assert.equal(timeAgo(nowSec - 400 * 86400, nowMs, 'en'), '1y ago')
  assert.equal(timeAgo(nowSec + 100, nowMs, 'zh'), '刚刚', '未来时间按刚刚处理')
  assert.equal(timeAgo(nowSec - 300, nowSec, 'zh'), '5 分钟前', 'now 传入秒级时间戳也应正确')

  // ---- formatCount：千/百万紧凑格式 ----
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(7), '7')
  assert.equal(formatCount(999), '999')
  assert.equal(formatCount(1000), '1k')
  assert.equal(formatCount(1234), '1.2k')
  assert.equal(formatCount(1500000), '1.5m')
  assert.equal(formatCount(null), '0')
  assert.equal(formatCount('42'), '42')

  // ---- refChipClass：四种 ref 类型 → 颜色类 ----
  assert.equal(refChipClass({ name: 'main', type: 'head' }), 'ggv-chip-head')
  assert.equal(refChipClass({ name: 'dev', type: 'branch' }), 'ggv-chip-branch')
  assert.equal(refChipClass({ name: 'origin/main', type: 'remote' }), 'ggv-chip-remote')
  assert.equal(refChipClass({ name: 'v1.0.0', type: 'tag' }), 'ggv-chip-tag')
  assert.equal(refChipClass({ name: 'weird' }), 'ggv-chip-branch', '未知类型兜底为 branch')
  assert.equal(refChipClass(null), 'ggv-chip-branch', '空 ref 兜底为 branch')

  // ---- langOf：documentElement.lang 优先，其次 navigator.language，无信息默认 zh ----
  assert.equal(langOf({ documentElement: { lang: 'zh-CN' } }, { language: 'en-US' }), 'zh')
  assert.equal(langOf({ documentElement: { lang: 'en-US' } }, { language: 'zh-CN' }), 'zh')
  assert.equal(langOf({ documentElement: { lang: 'en-US' } }, { language: 'en-US' }), 'en')
  assert.equal(langOf({}, { language: 'en' }), 'en')
  assert.equal(langOf(null, null), 'zh')
  assert.equal(langOf(undefined, undefined), 'zh')

  // ---- i18n：zh/en 字典、未知 key 原样返回、{name} 插值、未知语言回退 zh ----
  const zh = i18n('zh')
  const en = i18n('en')
  assert.equal(typeof zh.t, 'function')
  assert.equal(zh.t('title'), 'Git 图谱')
  assert.equal(en.t('title'), 'Git Graph')
  assert.ok(zh.t('loading').length > 0)
  assert.equal(en.t('loadMore'), 'Load more')
  assert.equal(zh.t('machine.missing.key'), 'machine.missing.key', '未知 key 原样返回')
  assert.equal(zh.t('commitsLoaded', { n: 3 }), '已加载 3 条')
  assert.equal(en.t('commitsLoaded', { n: 3 }), '3 commits loaded')
  assert.equal(i18n('xx').t('title'), 'Git 图谱', '未知语言回退中文')
  assert.equal(typeof en.t('title', { unused: 1 }), 'string')

  // ---- matchesQuery：subject / author / sha / short / ref 名，不区分大小写，空 query 全匹配（DESIGN §6.1） ----
  const { matchesQuery, findHeadIndex } = exp.__test
  const searchRow = {
    subject: 'feat: 修复 AI 排版', author: 'Yan Yu', sha: '3caf8cf0123456789', short: '3caf8cf',
    refs: [{ name: 'origin/main', type: 'remote' }, { name: 'v1.0.0', type: 'tag' }],
  }
  assert.equal(matchesQuery(searchRow, ''), true, '空 query 应匹配所有行')
  assert.equal(matchesQuery(searchRow, '   '), true, '纯空白 query 应匹配所有行')
  assert.equal(matchesQuery(searchRow, '修复'), true, '应匹配 subject')
  assert.equal(matchesQuery(searchRow, 'yan'), true, '应匹配 author（不区分大小写）')
  assert.equal(matchesQuery(searchRow, '3caf8cf'), true, '应匹配短 sha')
  assert.equal(matchesQuery(searchRow, 'ORIGIN'), true, '应匹配 ref 名（不区分大小写）')
  assert.equal(matchesQuery(searchRow, 'no-such-thing'), false)
  assert.equal(matchesQuery(null, 'x'), false, '空 row 返回 false')

  // ---- findHeadIndex：repo.head 优先，退化到 refs head，找不到返回 -1（DESIGN §6.2） ----
  const headCommits = [
    { sha: 'aaa', refs: [] },
    { sha: 'bbb', refs: [{ name: 'main', type: 'head' }] },
  ]
  assert.equal(findHeadIndex(headCommits, { head: 'bbb' }), 1, '应按 repo.head 定位')
  assert.equal(findHeadIndex(headCommits, { head: 'not-loaded' }), 1, 'repo.head 不在列表时退化到 refs head')
  assert.equal(findHeadIndex([{ sha: 'aaa' }], { head: 'zzz' }), -1, 'HEAD 不在列表时返回 -1')
  assert.equal(findHeadIndex([], { head: 'aaa' }), -1, '空列表返回 -1')
  assert.equal(findHeadIndex(null, { head: 'aaa' }), -1, 'commits 缺失返回 -1')
  assert.equal(findHeadIndex(headCommits, null), 1, 'repo 缺失时仍可用 refs head 定位')
})

test('8. 视图冒烟：有/无 sessionId 都能渲染出结构而不抛异常（不白屏）', async () => {
  const { exp } = await loadClientModule()
  const fake = makeFakeCtx()
  exp.apply(fake.ctx)
  assert.equal(fake.registrations.length, 1)
  const ViewEntry = fake.registrations[0].component

  const renderOnce = (props) => {
    const entryElement = ViewEntry(props)
    assert.equal(typeof entryElement.type, 'function', '槽位组件应转发到主视图组件')
    const tree = entryElement.type(entryElement.props)
    assert.ok(tree && typeof tree.type === 'string', '主视图应返回宿主元素，而不是空/抛错')
    return tree
  }

  const withSession = renderOnce({ sessionId: 'sid' })
  assert.equal(withSession.type, 'div')
  assert.ok(String(withSession.props.className).includes('ggv-view'))

  const withoutSession = renderOnce({})
  assert.equal(withoutSession.type, 'div')
  assert.ok(String(withoutSession.props.className).includes('ggv-view'))

  // 无 sessions 服务时也不能崩
  const noSessions = makeFakeCtx({ sessions: false })
  exp.apply(noSessions.ctx)
  const entry2 = noSessions.registrations[0].component
  const element2 = entry2({ sessionId: 'sid' })
  const tree2 = element2.type(element2.props)
  assert.equal(tree2.type, 'div')
})

test('9. 状态机/列表/详情渲染不白屏（stub hooks 注入状态）', async () => {
  const shaA = 'a1'.repeat(20)
  const shaB = 'b2'.repeat(20)
  const nowSec = Math.floor(Date.now() / 1000)
  const repo = {
    root: 'C:/work/alpha', name: 'alpha', branch: 'main', detached: false, unborn: false,
    head: shaA, dirty: 2, conflict: 1, ahead: 3, behind: 1,
  }
  const rowA = {
    sha: shaA, short: 'a1a1a1a', subject: 'feat: 首个提交', author: 'Alice', email: 'alice@example.com',
    time: nowSec - 60, parents: [shaB], refs: [{ name: 'main', type: 'head' }, { name: 'v1.0.0', type: 'tag' }],
    lane: 0, above: [], below: [0], mergesIn: [], forks: [], nodeAbove: false, nodeBelow: true,
  }
  const rowB = {
    sha: shaB, short: 'b2b2b2b', subject: 'chore: init', author: 'Bob', email: 'bob@example.com',
    time: nowSec - 3600, parents: [], refs: [],
    lane: 0, above: [0], below: [], mergesIn: [], forks: [], nodeAbove: true, nodeBelow: false,
  }
  const graphReady = { repo: repo, commits: [rowA, rowB], lanes: 2, truncated: true }
  const workspaces = [{ path: 'C:/work/alpha', title: 'alpha' }]
  const commitDetail = {
    sha: shaA, short: 'a1a1a1a', subject: 'feat: 首个提交', body: '详细描述\n第二行',
    author: 'Alice', email: 'alice@example.com', authorTime: nowSec - 60, commitTime: nowSec - 60,
    parents: [shaB], refs: [], isMerge: true,
    stats: { files: 2, added: 10, deleted: 3 },
    files: [
      { status: 'M', path: 'src/a.js', added: 7, deleted: 2 },
      { status: 'A', path: 'src/b.js', added: 3, deleted: 0 },
    ],
    filesTruncated: false,
  }

  /** 按 GitGraphView 的 hook 顺序构造 14 个 useState 注入值。 */
  const makeStates = (patch) => {
    const defaults = [
      'C:/work/alpha',        // 0 chosenPath
      workspaces,             // 1 workspaces
      null,                   // 2 workspacesError
      0,                      // 3 wsTick
      0,                      // 4 sessionTick
      200,                    // 5 limit
      { status: 'loading' },  // 6 graphState
      0,                      // 7 refreshTick
      null,                   // 8 selectedSha
      null,                   // 9 detail
      0,                      // 10 detailTick
      true,                   // 11 isWide
      '',                     // 12 query（搜索）
      false,                  // 13 headVisible（回到 HEAD 按钮可用性）
    ]
    const merged = defaults.slice()
    const entries = Object.keys(patch || {})
    for (const key of entries) merged[Number(key)] = patch[key]
    return merged
  }

  // ---- ready：列表、SVG 泳道、头部 chips、toolbar 摘要、底部加载更多 ----
  const ready = await renderView(makeStates({ 6: { status: 'ready', data: graphReady } }))
  assert.equal(ready.tree.type, 'div')
  assert.ok(hasClass(ready.tree, 'ggv-view'))
  // DESIGN §9：根节点带官方 data-conversation-composer-overlay 标记，外壳才会把 viewArea
  // 约束为定高并把输入席改成悬浮层，从而让左右两栏各自滚动。
  const viewRoots = elementsByClass(ready.tree, 'ggv-view')
  assert.equal(viewRoots.length, 1, '应只有一个视图根节点')
  assert.equal(viewRoots[0].props['data-conversation-composer-overlay'], '', '根节点应带 data-conversation-composer-overlay 标记')
  assert.equal(elementsByClass(ready.tree, 'ggv-row').length, 2, '应有 2 个提交行')
  assert.equal(collectText(elementsByClass(ready.tree, 'ggv-repo-name')[0]), 'alpha')
  assert.ok(collectText(ready.tree).includes('main'), '头部应显示分支 chip')
  assert.ok(collectText(ready.tree).includes('● 2 个变更'), '头部应显示未提交变更数')
  assert.ok(collectText(ready.tree).includes('1 个冲突'), '头部应显示冲突数')
  assert.ok(collectText(ready.tree).includes('↑3 ↓1'), '头部应显示 ahead/behind')
  // toolbar：搜索框 + 统计摘要
  assert.equal(elementsByClass(ready.tree, 'ggv-search').length, 1, 'toolbar 应有搜索框')
  assert.equal(elementsByClass(ready.tree, 'ggv-search-input').length, 1)
  assert.ok(collectText(elementsByClass(ready.tree, 'ggv-summary')[0]).includes('2 个提交'), 'toolbar 应显示提交摘要')
  assert.ok(collectText(ready.tree).includes('已加载 2 条'), '底部应显示已加载条数')
  assert.ok(elementsByClass(ready.tree, 'ggv-select')[0].props.value === 'C:/work/alpha')
  const loadMore = findElements(ready.tree, function (element) {
    return element.type === 'button' && collectText(element).includes('加载更多')
  })
  assert.equal(loadMore.length, 1, 'truncated 时应显示「加载更多」')
  assert.ok(collectText(loadMore[0]).includes('+200'), '加载更多应显示下一批数量 +200')

  // 行内 SVG：rowA 有 1 条 node-below + 1 条 below 竖线，HEAD 行有双环
  const rowTree = elementsByClass(ready.tree, 'ggv-row')[0]
  assert.equal(elementsByClass(rowTree, 'ggv-line').length, 2, 'rowA 应生成 2 条 path')
  assert.equal(elementsByClass(rowTree, 'ggv-node')[0].props.r, 4, '节点半径应为 4')
  assert.equal(elementsByClass(rowTree, 'ggv-ring').length, 1, 'HEAD 行应有品牌色外环')
  assert.equal(elementsByClass(rowTree, 'ggv-ring-gap').length, 1, 'HEAD 行应有 bg-base 挖空环')
  assert.equal(elementsByClass(rowTree, 'ggv-chip-head').length, 1)
  assert.equal(elementsByClass(rowTree, 'ggv-chip-tag').length, 1)
  assert.ok(collectText(rowTree).includes('feat: 首个提交'))
  // 两行结构：第二行 author · 相对时间 · 短 sha
  const line2Text = collectText(elementsByClass(rowTree, 'ggv-line2')[0])
  assert.ok(line2Text.includes('Alice'), '第二行应显示作者')
  assert.ok(line2Text.includes('a1a1a1a'), '第二行应显示短 sha')
  assert.ok(line2Text.includes('分钟前'), '第二行应显示相对时间')

  // ---- 搜索：不删行，只淡化不匹配行（DESIGN §6.1） ----
  const searched = await renderView(makeStates({ 6: { status: 'ready', data: graphReady }, 12: 'chore' }))
  const searchedRows = elementsByClass(searched.tree, 'ggv-row')
  assert.equal(searchedRows.length, 2, '搜索不应删除行')
  assert.ok(hasClass(searchedRows[0], 'ggv-row-dim'), '不匹配的行应淡化')
  assert.ok(!hasClass(searchedRows[1], 'ggv-row-dim'), '匹配的行应保持正常')
  assert.ok(collectText(searched.tree).includes('已加载 2 条'), '搜索不应改变底部计数')

  // ---- 非 ready 状态：都有明确标题 + 可操作按钮 ----
  const statusCases = [
    ['empty-repo', 'emptyRepoTitle'],
    ['not-repo', 'notRepoTitle'],
    ['not-workspace', 'notWorkspaceTitle'],
    ['git-missing', 'gitMissingTitle'],
    ['error', 'errorTitle'],
  ]
  for (const statusCase of statusCases) {
    const status = statusCase[0]
    const key = statusCase[1]
    const graphState = status === 'error'
      ? { status: status, message: '宿主路由炸了' }
      : { status: status }
    const rendered = await renderView(makeStates({ 6: graphState }))
    const zh = rendered.moduleHandle.exp.__test.i18n('zh')
    const text = collectText(rendered.tree)
    assert.ok(text.includes(zh.t(key)), status + ' 状态应显示标题：' + zh.t(key))
    const actionButtons = findElements(rendered.tree, function (element) {
      return element.type === 'button' && typeof element.props.onClick === 'function'
    })
    assert.ok(actionButtons.length >= 1, status + ' 状态应有可操作按钮')
    assert.ok(elementsByClass(rendered.tree, 'ggv-state-action').length >= 1, status + ' 状态应有官方链接样式操作入口')
    if (status === 'error') assert.ok(text.includes('宿主路由炸了'), 'error 状态应展示 host message')
  }

  // ---- loading 状态：8 行骨架屏（DESIGN §4） ----
  const loading = await renderView(makeStates({}))
  assert.equal(elementsByClass(loading.tree, 'ggv-skeleton-row').length, 8, 'loading 应渲染 8 行骨架')
  assert.equal(elementsByClass(loading.tree, 'ggv-row').length, 0, 'loading 时不应渲染提交行')

  // ---- 无可用工作区：无 session 且工作区列表为空 ----
  const noPath = await renderView(
    makeStates({ 0: null, 1: [] }),
    { props: {}, ctxOptions: { sessions: false } },
  )
  const zhDict = noPath.moduleHandle.exp.__test.i18n('zh')
  assert.ok(collectText(noPath.tree).includes(zhDict.t('noWorkspaceTitle')))

  // ---- 详情（宽屏抽屉）：完整 sha、父提交、文件、统计 ----
  const wideDetail = await renderView(makeStates({
    8: shaA,
    9: { status: 'ready', sha: shaA, data: commitDetail },
  }))
  const widePanels = elementsByClass(wideDetail.tree, 'ggv-detail')
  assert.equal(widePanels.length, 1, '宽屏应渲染右侧抽屉')
  assert.equal(elementsByClass(wideDetail.tree, 'ggv-detail-overlay').length, 0)
  const widePanel = widePanels[0]
  assert.equal(widePanel.props.role, 'dialog')
  const wideText = collectText(widePanel)
  assert.ok(wideText.includes('feat: 首个提交'), '详情头部应显示 subject')
  assert.ok(wideText.includes('详细描述'), '详情应显示提交 body')
  assert.ok(wideText.includes(shaA), '详情应显示完整 sha')
  assert.ok(wideText.includes('src/a.js') && wideText.includes('+7') && wideText.includes('-2'))
  assert.ok(wideText.includes('父提交'), '详情应显示父提交区块')
  assert.ok(wideText.includes('2 个文件 · +10 / -3'), '详情应显示统计汇总')
  assert.ok(wideText.includes('合并'), 'isMerge 时详情标题旁应有「合并」chip')
  assert.equal(collectText(elementsByClass(widePanel, 'ggv-avatar')[0]), 'A', '作者行应有首字母圆形头像')
  assert.ok(elementsByClass(widePanel, 'ggv-iconbtn').length >= 1, '复制按钮应使用图标按钮')
  assert.equal(elementsByClass(widePanel, 'ggv-parent').length, 1, '父提交应为可点 pill')
  assert.equal(elementsByClass(widePanel, 'ggv-file-status-A').length, 1, '文件列表应使用状态色块')

  // ---- 详情（窄屏覆盖面板）----
  const narrowDetail = await renderView(makeStates({
    8: shaA,
    9: { status: 'ready', sha: shaA, data: commitDetail },
    11: false,
  }))
  const overlays = elementsByClass(narrowDetail.tree, 'ggv-detail-overlay')
  assert.equal(overlays.length, 1, '窄屏应渲染覆盖式面板')
  assert.equal(elementsByClass(narrowDetail.tree, 'ggv-detail').length, 0)
  assert.ok(collectText(overlays[0]).includes('src/b.js'))

  // ---- 详情 loading / error ----
  const detailLoading = await renderView(makeStates({
    8: shaA,
    9: { status: 'loading', sha: shaA },
  }))
  assert.ok(collectText(detailLoading.tree).includes('加载提交详情…'))
  const detailError = await renderView(makeStates({
    8: shaA,
    9: { status: 'error', sha: shaA, message: '详情炸了' },
  }))
  const detailErrorText = collectText(detailError.tree)
  assert.ok(detailErrorText.includes('详情炸了'))
  assert.ok(findElements(detailError.tree, function (element) {
    return element.type === 'button' && element.props.onClick && collectText(element) === '重试'
  }).length >= 1)
})
