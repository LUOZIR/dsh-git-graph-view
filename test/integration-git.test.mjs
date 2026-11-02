/**
 * 真实 git 集成测试（需要能 spawn 子进程的环境）。
 *
 * 在受限沙箱里 Node 以管道 spawn 会 EPERM，本文件自动跳过；在普通环境
 * （用户本机 / CI）会创建临时仓库，走完整的 createGitRunner → service 链路。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitRunner } from '../lib/git.js'
import { createGitGraphService } from '../lib/service.js'

/** 探测当前环境是否允许以管道方式 spawn git。 */
function canSpawnGit() {
  try {
    execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

const GIT_AVAILABLE = canSpawnGit()

/** 同步执行一条 git 命令（测试辅助）。 */
function git(cwd, args, env = {}) {
  return String(
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    }),
  )
}

/** 建一个带分叉 + 合并的临时仓库，返回目录与关键 sha。 */
function buildRepository() {
  const dir = mkdtempSync(join(tmpdir(), 'ggv-integration-'))
  const date = (iso) => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Integration Test'])
  git(dir, ['config', 'user.email', 'integration@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  git(dir, ['config', 'core.autocrlf', 'false'])

  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n', 'utf8')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'chore: 初始提交'], date('2026-02-01T00:00:00+00:00'))
  const root = git(dir, ['rev-parse', 'HEAD']).trim()

  writeFileSync(join(dir, 'a.txt'), 'one\ntwo changed\nthree\n', 'utf8')
  writeFileSync(join(dir, '中文 文件.md'), '# 中文\n', 'utf8')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'feat: 修改并新增中文文件'], date('2026-02-02T00:00:00+00:00'))
  const normal = git(dir, ['rev-parse', 'HEAD']).trim()

  git(dir, ['checkout', '-q', '-b', 'feature'])
  writeFileSync(join(dir, 'c.txt'), 'feature\n', 'utf8')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'feat: feature 分支'], date('2026-02-03T00:00:00+00:00'))
  const feature = git(dir, ['rev-parse', 'HEAD']).trim()

  git(dir, ['checkout', '-q', 'main'])
  git(dir, ['merge', '-q', '--no-ff', 'feature', '-m', 'merge: 合并 feature'], date('2026-02-04T00:00:00+00:00'))
  const merge = git(dir, ['rev-parse', 'HEAD']).trim()

  return { dir, shas: { root, normal, feature, merge } }
}

if (!GIT_AVAILABLE) {
  test('真实 git 集成测试：当前环境禁止 spawn 子进程，已跳过', { skip: true }, () => {})
} else {
  test('真实 git：service.graph 返回仓库状态与提交图', async () => {
    const repo = buildRepository()
    try {
      const service = createGitGraphService({ runner: createGitRunner() })
      const view = await service.graph(repo.dir, 100, undefined)
      assert.equal(view.repo.branch, 'main')
      assert.equal(view.repo.head, repo.shas.merge)
      assert.equal(view.repo.dirty, 0)
      assert.equal(view.repo.unborn, false)
      assert.equal(view.commits.length, 4)
      assert.equal(view.lanes, 2)
      assert.equal(view.truncated, false)
      const mergeCommit = view.commits.find((commit) => commit.sha === repo.shas.merge)
      assert.notEqual(mergeCommit, undefined)
      assert.equal(mergeCommit.parents.length, 2)
      assert.deepEqual(mergeCommit.refs, [{ name: 'main', type: 'head' }])
      const featureCommit = view.commits.find((commit) => commit.sha === repo.shas.feature)
      assert.deepEqual(featureCommit.refs, [{ name: 'feature', type: 'branch' }])
    } finally {
      rmSync(repo.dir, { recursive: true, force: true })
    }
  })

  test('真实 git：service.commit 返回详情与文件统计', async () => {
    const repo = buildRepository()
    try {
      const service = createGitGraphService({ runner: createGitRunner() })
      const root = await service.commit(repo.dir, repo.shas.root, undefined)
      assert.equal(root.isMerge, false)
      assert.equal(root.stats.files, 1)
      assert.deepEqual(root.files.map((file) => [file.status, file.path]), [['A', 'a.txt']])

      const normal = await service.commit(repo.dir, repo.shas.normal, undefined)
      assert.deepEqual(normal.files.map((file) => [file.status, file.path]), [
        ['M', 'a.txt'],
        ['A', '中文 文件.md'],
      ])

      const merge = await service.commit(repo.dir, repo.shas.merge, undefined)
      assert.equal(merge.isMerge, true)
      assert.equal(merge.parents.length, 2)
      assert.deepEqual(merge.files.map((file) => [file.status, file.path]), [['A', 'c.txt']])
    } finally {
      rmSync(repo.dir, { recursive: true, force: true })
    }
  })

  test('真实 git：脏工作区计数与 limit 截断', async () => {
    const repo = buildRepository()
    try {
      const service = createGitGraphService({ runner: createGitRunner() })
      writeFileSync(join(repo.dir, 'a.txt'), 'dirty\n', 'utf8')
      const dirtyView = await service.graph(repo.dir, 100, undefined)
      assert.equal(dirtyView.repo.dirty, 1)

      const shortView = await service.graph(repo.dir, 2, undefined)
      assert.equal(shortView.commits.length, 2)
      assert.equal(shortView.truncated, true)
    } finally {
      rmSync(repo.dir, { recursive: true, force: true })
    }
  })

  test('真实 git：非仓库目录映射为 not-a-repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ggv-not-repo-'))
    try {
      const service = createGitGraphService({ runner: createGitRunner() })
      await assert.rejects(() => service.graph(dir, 10, undefined), (error) => {
        assert.equal(error.code, 'not-a-repo')
        return true
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
