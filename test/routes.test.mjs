/**
 * host 路由层测试：用假 ctx + 假 runner 验证信任闸、工作区闸、协议错误、
 * limit/sha 校验、错误码映射与响应 envelope，全程不触碰真实 git。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { mount } from '../lib/index.js'
import { isTrustedRequest, isLoopbackAddress, isLoopbackHostname } from '../lib/http.js'

const NUL = '\x00'
const RS = '\x1e'
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

/** 当前插件目录，作为“已注册工作区”使用（真实存在，realpath 可解析）。 */
const WORKSPACE = realpathSync(process.cwd())

/** 构造一条 git log 记录。 */
function logRecord(sha, parents, author, email, at, decoration, subject) {
  return [sha, parents, author, email, at, decoration, subject].join(NUL) + RS + '\n'
}

const LOG_OUT =
  logRecord(SHA_A, SHA_B, '张三', 'zhang@example.com', '1700000000', 'HEAD -> refs/heads/main, refs/remotes/origin/main', 'feat: 图谱渲染') +
  logRecord(SHA_B, '', '李四', 'li@example.com', '1600000000', 'tag: refs/tags/v1.0.0', '初始提交')

const STATUS_OUT = [
  '# branch.oid ' + SHA_A,
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +1 -0',
  '1 .M N... 100644 100644 100644 1111 2222 src/app.ts',
].join('\n')

const SHOW_OUT = [
  SHA_A,
  SHA_B,
  '张三',
  'zhang@example.com',
  '2026-11-01T10:00:00+00:00',
  '2026-11-02T11:00:00+00:00',
  'HEAD -> refs/heads/main',
  'feat: 图谱渲染\n\n第二段说明\n- 列表\n',
].join(NUL)

const NAME_STATUS_OUT = ['M\tsrc/app.ts', 'A\tRebuild/中文 文件.md'].join('\n')
const NUMSTAT_OUT = ['3\t2\tsrc/app.ts', '5\t0\tRebuild/中文 文件.md'].join('\n')

/** 假 runner：按 argv[0]（git 子命令）返回固定输出。 */
function createFakeRunner(overrides = {}) {
  const calls = []
  return {
    calls,
    async run(cwd, argv) {
      calls.push({ cwd, argv: [...argv] })
      const command = argv[0]
      if (typeof overrides[command] === 'function') return overrides[command](argv, cwd)
      if (command === 'rev-parse') return { ok: true, stdout: WORKSPACE.replace(/\\/g, '/') + '\n', stderr: '' }
      if (command === 'status') return { ok: true, stdout: STATUS_OUT, stderr: '' }
      if (command === 'log') return { ok: true, stdout: LOG_OUT, stderr: '' }
      if (command === 'show') return { ok: true, stdout: SHOW_OUT, stderr: '' }
      if (command === 'diff-tree') {
        return { ok: true, stdout: argv.includes('--numstat') ? NUMSTAT_OUT : NAME_STATUS_OUT, stderr: '' }
      }
      return { ok: false, error: { code: 'internal', message: 'unexpected ' + String(command) } }
    },
  }
}

/** 假响应对象。 */
function createRes() {
  const state = { status: 0, headers: {}, body: '', ended: false }
  const res = {
    headersSent: false,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers ?? {}
      res.headersSent = true
    },
    end(payload) {
      if (payload !== undefined) state.body += String(payload)
      state.ended = true
    },
  }
  return { res, state }
}

/** 假请求对象（可异步迭代，模拟 node IncomingMessage）。 */
function createReq({ method = 'POST', url = '/git-graph-view/graph', body, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const chunks = []
  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    chunks.push(Buffer.from(text, 'utf8'))
  }
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080', ...headers },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** 挂载插件并返回路由 handler。 */
function mountPlugin(options = {}) {
  const runner = options.runner ?? createFakeRunner()
  const workspaces = options.workspaces ?? [{ path: WORKSPACE, title: 'demo' }]
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    workspaceRegistry: { list: () => workspaces },
    effect(callback) {
      callback()
    },
  }
  mount(ctx, { runner, bootMarker: false })
  assert.equal(routes.length, 1, '应注册一个前缀路由')
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/git-graph-view')
  return { handler: routes[0].handler, runner }
}

/** 发一次请求并解析 JSON 响应。 */
async function call(handler, reqInit) {
  const { res, state } = createRes()
  await handler(createReq(reqInit), res)
  let json = null
  try {
    json = JSON.parse(state.body)
  } catch {
    json = null
  }
  return { state, json }
}

/** 直接按 JSON body 调一次 POST。 */
function post(handler, urlPath, body, headers = {}) {
  return call(handler, { method: 'POST', url: urlPath, body, headers: { 'content-type': 'application/json', ...headers } })
}

test('信任闸：loopback 地址与主机名判定', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('10.0.0.5'), false)
  assert.equal(isLoopbackHostname('localhost'), true)
  assert.equal(isLoopbackHostname('[::1]'), true)
  assert.equal(isLoopbackHostname('127.0.0.1'), true)
  assert.equal(isLoopbackHostname('evil.example.com'), false)
})

test('信任闸：请求级判定', () => {
  const trusted = (req) => isTrustedRequest(req)
  const base = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }
  assert.equal(trusted(base), true)
  assert.equal(trusted({ ...base, headers: { host: 'localhost:3080' } }), true)
  assert.equal(trusted({ ...base, headers: { host: '[::1]:3080' } }), true)
  assert.equal(trusted({ ...base, headers: { host: 'evil.example.com' } }), false)
  assert.equal(trusted({ ...base, socket: { remoteAddress: '10.0.0.5' } }), false)
  assert.equal(trusted({ ...base, headers: { ...base.headers, 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(trusted({ ...base, headers: { ...base.headers, origin: 'null' } }), false)
  assert.equal(trusted({ ...base, headers: { ...base.headers, origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(trusted({ ...base, headers: { ...base.headers, origin: 'http://evil.example.com' } }), false)
  assert.equal(trusted({ ...base, headers: { ...base.headers, origin: 'dsh-app://app' } }), true)
})

test('GET /health：返回版本信息', async () => {
  const { handler } = mountPlugin()
  const { state, json } = await call(handler, { method: 'GET', url: '/git-graph-view/health' })
  assert.equal(state.status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.value.name, 'dsh-git-graph-view')
  assert.equal(typeof json.value.version, 'string')
})

test('graph：正常返回仓库状态、提交行与泳道', async () => {
  const { handler, runner } = mountPlugin()
  const { state, json } = await post(handler, '/git-graph-view/graph', { path: WORKSPACE, limit: 50 })
  assert.equal(state.status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.value.repo.name, WORKSPACE.split(/[\\/]/).pop())
  assert.equal(json.value.repo.branch, 'main')
  assert.equal(json.value.repo.dirty, 1)
  assert.equal(json.value.repo.ahead, 1)
  assert.equal(json.value.commits.length, 2)
  assert.equal(json.value.commits[0].sha, SHA_A)
  assert.equal(json.value.commits[0].short, SHA_A.slice(0, 7))
  assert.deepEqual(json.value.commits[0].refs, [
    { name: 'main', type: 'head' },
    { name: 'origin/main', type: 'remote' },
  ])
  assert.equal(json.value.commits[0].lane, 0)
  assert.equal(json.value.commits[0].nodeAbove, false)
  assert.equal(json.value.commits[0].nodeBelow, true)
  assert.equal(json.value.commits[1].nodeAbove, true)
  assert.equal(json.value.commits[1].nodeBelow, false)
  assert.deepEqual(json.value.commits[1].refs, [{ name: 'v1.0.0', type: 'tag' }])
  assert.equal(json.value.lanes, 1)
  assert.equal(json.value.truncated, false)
  const logCall = runner.calls.find((entry) => entry.argv[0] === 'log')
  assert.ok(logCall !== undefined, '应执行 git log')
  assert.ok(logCall.argv.includes('--max-count'))
  assert.equal(logCall.argv[logCall.argv.indexOf('--max-count') + 1], '50')
})

test('graph：limit 夹取到 1..1000，缺省 200', async () => {
  const cases = [
    [99999, '1000'],
    [0, '1'],
    [-5, '1'],
    ['not-a-number', '200'],
    [undefined, '200'],
  ]
  for (const [limit, expected] of cases) {
    const { handler, runner } = mountPlugin()
    const { json } = await post(handler, '/git-graph-view/graph', limit === undefined ? { path: WORKSPACE } : { path: WORKSPACE, limit })
    assert.equal(json.ok, true)
    const logCall = runner.calls.find((entry) => entry.argv[0] === 'log')
    assert.equal(logCall.argv[logCall.argv.indexOf('--max-count') + 1], expected, 'limit=' + String(limit))
  }
})

test('graph：非注册工作区被闸拒绝且不执行 git', async () => {
  const { handler, runner } = mountPlugin()
  const other = WORKSPACE + '/lib'
  const { state, json } = await post(handler, '/git-graph-view/graph', { path: other })
  assert.equal(state.status, 200)
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'not-a-workspace')
  assert.equal(runner.calls.length, 0)
})

test('graph：相对路径被拒', async () => {
  const { handler } = mountPlugin()
  const { json } = await post(handler, '/git-graph-view/graph', { path: './relative' })
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'bad-request')
})

test('graph：非 git 仓库映射为 not-a-repo', async () => {
  const runner = createFakeRunner({
    'rev-parse': () => ({ ok: false, error: { code: 'not-a-repo', message: '当前路径不是 Git 仓库' } }),
  })
  const { handler } = mountPlugin({ runner })
  const { json } = await post(handler, '/git-graph-view/graph', { path: WORKSPACE })
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'not-a-repo')
})

test('graph：git 缺失映射为 git-missing', async () => {
  const runner = createFakeRunner({
    'rev-parse': () => ({ ok: false, error: { code: 'git-missing', message: '未找到 git 命令' } }),
  })
  const { handler } = mountPlugin({ runner })
  const { json } = await post(handler, '/git-graph-view/graph', { path: WORKSPACE })
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'git-missing')
})

test('commit：返回提交详情、文件状态与统计', async () => {
  const { handler } = mountPlugin()
  const { json } = await post(handler, '/git-graph-view/commit', { path: WORKSPACE, sha: SHA_A })
  assert.equal(json.ok, true)
  const value = json.value
  assert.equal(value.sha, SHA_A)
  assert.equal(value.subject, 'feat: 图谱渲染')
  assert.equal(value.isMerge, false)
  assert.deepEqual(value.parents, [SHA_B])
  assert.equal(value.stats.files, 2)
  assert.equal(value.stats.added, 8)
  assert.equal(value.stats.deleted, 2)
  assert.deepEqual(value.files, [
    { status: 'M', path: 'src/app.ts', added: 3, deleted: 2 },
    { status: 'A', path: 'Rebuild/中文 文件.md', added: 5, deleted: 0 },
  ])
  assert.equal(value.filesTruncated, false)
})

test('commit：非法 sha 被拒且不执行 git', async () => {
  const { handler, runner } = mountPlugin()
  for (const sha of ['', 'xyz', '123', 'not-a-sha-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '../HEAD']) {
    const { json } = await post(handler, '/git-graph-view/commit', { path: WORKSPACE, sha })
    assert.equal(json.ok, false, 'sha=' + sha)
    assert.equal(json.error.code, 'bad-request')
  }
  assert.equal(runner.calls.length, 0)
})

test('workspaces：返回注册表里的工作区', async () => {
  const { handler } = mountPlugin({
    workspaces: [
      { path: WORKSPACE, title: 'demo' },
      { path: 'C:\\not\\real', title: '' },
    ],
  })
  const { json } = await post(handler, '/git-graph-view/workspaces', {})
  assert.equal(json.ok, true)
  assert.deepEqual(json.value.workspaces, [
    { path: WORKSPACE, title: 'demo' },
    // 宿主用 node:path 的 basename 兜底标题：Windows 上 'C:\\not\\real' → 'real'，
    // POSIX 上反斜杠不是分隔符（CI 在 Linux 上跑），因此用同平台函数计算期望值。
    { path: 'C:\\not\\real', title: basename('C:\\not\\real') },
  ])
})

test('协议错误：403 / 405 / 415 / 400 / 404', async () => {
  const { handler } = mountPlugin()

  const forbidden = await call(handler, { method: 'POST', url: '/git-graph-view/graph', body: { path: WORKSPACE }, headers: { 'content-type': 'application/json' }, remoteAddress: '10.1.2.3' })
  assert.equal(forbidden.state.status, 403)

  const crossSite = await call(handler, {
    method: 'POST',
    url: '/git-graph-view/graph',
    body: { path: WORKSPACE },
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(crossSite.state.status, 403)

  const getGraph = await call(handler, { method: 'GET', url: '/git-graph-view/graph' })
  assert.equal(getGraph.state.status, 405)

  const wrongType = await call(handler, {
    method: 'POST',
    url: '/git-graph-view/graph',
    body: { path: WORKSPACE },
    headers: { 'content-type': 'text/plain' },
  })
  assert.equal(wrongType.state.status, 415)

  const badJson = await call(handler, { method: 'POST', url: '/git-graph-view/graph', body: '{oops', headers: { 'content-type': 'application/json' } })
  assert.equal(badJson.state.status, 400)

  const arrayBody = await call(handler, { method: 'POST', url: '/git-graph-view/graph', body: [], headers: { 'content-type': 'application/json' } })
  assert.equal(arrayBody.state.status, 400)

  const unknown = await post(handler, '/git-graph-view/nope', {})
  assert.equal(unknown.state.status, 404)
})

test('graph：status 失败映射为 git-failed', async () => {
  const runner = createFakeRunner({
    status: () => ({ ok: false, error: { code: 'git-failed', message: 'fatal: bad index' } }),
  })
  const { handler } = mountPlugin({ runner })
  const { json } = await post(handler, '/git-graph-view/graph', { path: WORKSPACE })
  assert.equal(json.ok, false)
  assert.equal(json.error.code, 'git-failed')
  assert.match(json.error.message, /bad index/)
})
