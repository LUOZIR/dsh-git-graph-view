/**
 * 真实 git 输出回归测试：fixture 来自 `scripts/make-fixtures.ps1` 在一个临时仓库
 * 里抓取的原始输出（含 NUL/RS 分隔符、中文路径、合并提交）。
 *
 * 这样在不能 spawn 子进程的受限环境里，解析器与业务层仍然对“真实 git 字节”做回归；
 * 真实子进程路径由 `integration-git.test.mjs` 在普通环境补充验证。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseGraphLog,
  parseNameStatus,
  parseNumstat,
  parseShowHeader,
  parseStatus,
  parseToplevel,
} from '../lib/parse.js'
import { layoutLanes } from '../lib/graph.js'
import { createGitGraphService } from '../lib/service.js'
import { diffTreeArgv, graphLogArgv, showHeaderArgv, statusArgv, toplevelArgv } from '../lib/git.js'

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'git-outputs.json'), 'utf8'))
const SHAS = fixture.shas

/** 假 runner：按 git 子命令 + 关键参数选择 fixture 输出。 */
function createFixtureRunner() {
  return {
    calls: [],
    async run(cwd, argv) {
      this.calls.push({ cwd, argv: [...argv] })
      const command = argv[0]
      if (command === 'rev-parse') return { ok: true, stdout: fixture.toplevel + '\n', stderr: '' }
      if (command === 'status') return { ok: true, stdout: fixture.status, stderr: '' }
      if (command === 'log') return { ok: true, stdout: fixture.graphLog, stderr: '' }
      if (command === 'show') {
        const sha = argv[argv.length - 1]
        if (sha === SHAS.root) return { ok: true, stdout: fixture.showRoot, stderr: '' }
        if (sha === SHAS.normal) return { ok: true, stdout: fixture.showNormal, stderr: '' }
        if (sha === SHAS.merge) return { ok: true, stdout: fixture.showMerge, stderr: '' }
        return { ok: false, error: { code: 'bad-request', message: 'unknown revision' } }
      }
      if (command === 'diff-tree') {
        const isNumstat = argv.includes('--numstat')
        const targets = argv.filter((item) => !item.startsWith('-'))
        // targets[0] 是 "diff-tree"，其余是参数里的提交/范围。
        const range = targets.slice(1)
        const rootCommit = argv.includes('--root')
        if (rootCommit) return { ok: true, stdout: isNumstat ? fixture.diffRootNum : fixture.diffRootName, stderr: '' }
        if (range.length === 2 && range[0] === SHAS.merge + '^1') {
          return { ok: true, stdout: isNumstat ? fixture.diffMergeNum : fixture.diffMergeName, stderr: '' }
        }
        return { ok: true, stdout: isNumstat ? fixture.diffNormalNum : fixture.diffNormalName, stderr: '' }
      }
      return { ok: false, error: { code: 'internal', message: 'unexpected command ' + String(command) } }
    },
  }
}

test('fixture：仓库探测/状态/提交图对真实输出解析正确', () => {
  assert.match(fixture.gitVersion, /^git version /)
  assert.equal(parseToplevel(fixture.toplevel).length > 0, true)

  const status = parseStatus(fixture.status)
  assert.equal(status.head, SHAS.merge)
  assert.equal(status.branch, 'main')
  assert.equal(status.detached, false)
  assert.equal(status.unborn, false)

  const commits = parseGraphLog(fixture.graphLog)
  assert.equal(commits.length, 4)
  assert.equal(commits[0].sha, SHAS.merge)
  assert.equal(commits[0].parents.length, 2)
  assert.deepEqual(commits[0].refs, [{ name: 'main', type: 'head' }])
  assert.equal(commits[0].subject, 'merge: 合并 feature 分支')
  assert.equal(commits[0].time > 0, true)

  const feature = commits.find((commit) => commit.sha === SHAS.feature)
  assert.notEqual(feature, undefined)
  assert.deepEqual(feature.refs, [{ name: 'feature', type: 'branch' }])

  const layout = layoutLanes(commits)
  assert.equal(layout.lanes, 2, '合并提交应产生 2 条泳道')
  assert.equal(layout.rows.length, 4)
})

test('fixture：show / diff-tree 解析（普通、根、合并提交）', () => {
  const root = parseShowHeader(fixture.showRoot)
  assert.notEqual(root, null)
  assert.deepEqual(root.parents, [])
  assert.match(root.body, /初始提交/)

  const normal = parseShowHeader(fixture.showNormal)
  assert.notEqual(normal, null)
  assert.deepEqual(normal.parents, [SHAS.root])
  assert.equal(normal.author, 'Fixture 张三')

  const merge = parseShowHeader(fixture.showMerge)
  assert.notEqual(merge, null)
  assert.equal(merge.parents.length, 2)
  assert.deepEqual(merge.refs, [{ name: 'main', type: 'head' }])

  assert.deepEqual(parseNameStatus(fixture.diffNormalName), [
    { status: 'M', path: 'a.txt' },
    { status: 'A', path: '中文 文件.md' },
  ])
  assert.deepEqual(parseNumstat(fixture.diffNormalNum), [
    { path: 'a.txt', added: 2, deleted: 1 },
    { path: '中文 文件.md', added: 2, deleted: 0 },
  ])
  assert.deepEqual(parseNameStatus(fixture.diffMergeName), [{ status: 'A', path: 'c.txt' }])
  assert.deepEqual(parseNumstat(fixture.diffMergeNum), [{ path: 'c.txt', added: 1, deleted: 0 }])
})

test('fixture：argv 构造与抓取命令一致', () => {
  assert.deepEqual(toplevelArgv(), ['rev-parse', '--show-toplevel'])
  assert.deepEqual(statusArgv(), ['status', '--porcelain=v2', '--branch', '--untracked-files=no'])
  const logArgv = graphLogArgv(100)
  assert.equal(logArgv[0], 'log')
  assert.ok(logArgv.includes('--topo-order'))
  assert.ok(logArgv.includes('--decorate=full'))
  assert.ok(logArgv.includes('--parents'))
  assert.equal(logArgv[logArgv.indexOf('--max-count') + 1], '100')
  assert.ok(logArgv.some((item) => item.startsWith('--format=%H%x00%P')))
  assert.equal(showHeaderArgv('abc')[0], 'show')
  assert.deepEqual(diffTreeArgv('name-status', 'abc', []), [
    'diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-status', '--root', 'abc',
  ])
  assert.deepEqual(diffTreeArgv('numstat', 'abc', ['p1']), [
    'diff-tree', '-r', '--no-commit-id', '--no-renames', '--numstat', 'abc',
  ])
  assert.deepEqual(diffTreeArgv('numstat', 'abc', ['p1', 'p2']), [
    'diff-tree', '-r', '--no-commit-id', '--no-renames', '--numstat', 'abc^1', 'abc',
  ])
})

test('fixture：service.graph 端到端（假 runner + 真实字节）', async () => {
  const service = createGitGraphService({ runner: createFixtureRunner() })
  const view = await service.graph('/fixture', 100, undefined)
  assert.equal(view.repo.branch, 'main')
  assert.equal(view.repo.head, SHAS.merge)
  assert.equal(view.repo.dirty, 0)
  assert.equal(view.lanes, 2)
  assert.equal(view.truncated, false)
  assert.equal(view.commits.length, 4)
  assert.equal(view.commits[0].sha, SHAS.merge)
  assert.equal(view.commits[0].short, SHAS.merge.slice(0, 7))
  assert.equal(view.commits[0].nodeBelow, true)
  assert.deepEqual(view.commits[0].forks, [1])
})

test('fixture：service.commit 端到端（根/普通/合并）', async () => {
  const service = createGitGraphService({ runner: createFixtureRunner() })

  const root = await service.commit('/fixture', SHAS.root, undefined)
  assert.equal(root.isMerge, false)
  assert.deepEqual(root.parents, [])
  assert.equal(root.stats.files, 2)
  assert.equal(root.stats.added, 3)
  assert.deepEqual(root.files.map((file) => [file.status, file.path]), [
    ['A', 'README.md'],
    ['A', 'a.txt'],
  ])

  const normal = await service.commit('/fixture', SHAS.normal, undefined)
  assert.deepEqual(normal.parents, [SHAS.root])
  assert.equal(normal.stats.files, 2)
  assert.deepEqual(normal.files.map((file) => [file.status, file.path, file.added, file.deleted]), [
    ['M', 'a.txt', 2, 1],
    ['A', '中文 文件.md', 2, 0],
  ])

  const merge = await service.commit('/fixture', SHAS.merge, undefined)
  assert.equal(merge.isMerge, true)
  assert.equal(merge.parents.length, 2)
  assert.match(merge.subject, /合并 feature/)
  assert.deepEqual(merge.files.map((file) => [file.status, file.path, file.added]), [['A', 'c.txt', 1]])
})

test('fixture：service.graph 的 limit 语义（截断标记由调用方 limit 决定）', async () => {
  const service = createGitGraphService({ runner: createFixtureRunner() })
  // fixture 只有 4 条提交；limit=2 时 runner 仍返回全部 4 条（假 runner 不截断），
  // 但业务层按 limit 判断 truncated 时会看到 4 >= 2 → true。真实 git 会按 limit 截断。
  const view = await service.graph('/fixture', 2, undefined)
  assert.equal(view.truncated, true)
})

test('fixture：service.graph 非仓库映射 not-a-repo', async () => {
  const runner = {
    async run() {
      return { ok: false, error: { code: 'not-a-repo', message: '当前路径不是 Git 仓库' }, stderr: 'fatal: not a git repository' }
    },
  }
  const service = createGitGraphService({ runner })
  await assert.rejects(() => service.graph('/not-repo', 100, undefined), (error) => {
    assert.equal(error.code, 'not-a-repo')
    return true
  })
})
