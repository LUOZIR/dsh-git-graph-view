/**
 * git 输出解析单元测试（node:test）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDecorations,
  parseGraphLog,
  parseNameStatus,
  parseNumstat,
  parseShowHeader,
  parseStatus,
  parseToplevel,
  toUnixSeconds,
} from '../lib/parse.js'

const NUL = '\x00'
const RS = '\x1e'

/** 构造 `git log --format=...` 的一条记录。 */
function logRecord(sha, parents, author, email, at, decoration, subject) {
  return [sha, parents, author, email, at, decoration, subject].join(NUL) + RS + '\n'
}

test('parseGraphLog：多记录、NUL 字段、refs 解析', () => {
  const text =
    logRecord(
      'a'.repeat(40),
      'b'.repeat(40),
      '张三',
      'zhang@example.com',
      '1700000000',
      'HEAD -> refs/heads/main, refs/remotes/origin/main',
      'feat: 支持中文提交信息',
    ) +
    logRecord(
      'b'.repeat(40),
      '',
      '李四',
      'li@example.com',
      '1600000000',
      '',
      'root commit',
    )
  const commits = parseGraphLog(text)
  assert.equal(commits.length, 2)
  assert.equal(commits[0].sha, 'a'.repeat(40))
  assert.deepEqual(commits[0].parents, ['b'.repeat(40)])
  assert.equal(commits[0].author, '张三')
  assert.equal(commits[0].subject, 'feat: 支持中文提交信息')
  assert.equal(commits[0].time, 1700000000)
  assert.deepEqual(commits[0].refs, [
    { name: 'main', type: 'head' },
    { name: 'origin/main', type: 'remote' },
  ])
  assert.deepEqual(commits[1].parents, [])
  assert.deepEqual(commits[1].refs, [])
})

test('parseGraphLog：CRLF 与首尾空行容错', () => {
  const record = logRecord('a'.repeat(40), '', 'a', 'a@b', '1', '', 's')
  const text = '\r\n' + record.replace(/\n$/, '\r\n') + '\r\n'
  const commits = parseGraphLog(text)
  assert.equal(commits.length, 1)
  assert.equal(commits[0].subject, 's')
})

test('parseDecorations：full refs 归类', () => {
  assert.deepEqual(parseDecorations('HEAD -> refs/heads/main'), [{ name: 'main', type: 'head' }])
  assert.deepEqual(parseDecorations('refs/heads/feature/x'), [{ name: 'feature/x', type: 'branch' }])
  assert.deepEqual(parseDecorations('refs/remotes/origin/main'), [{ name: 'origin/main', type: 'remote' }])
  assert.deepEqual(parseDecorations('refs/remotes/origin/HEAD'), [])
  assert.deepEqual(parseDecorations('tag: refs/tags/v1.0.0'), [{ name: 'v1.0.0', type: 'tag' }])
  assert.deepEqual(parseDecorations('HEAD'), [{ name: 'HEAD', type: 'head' }])
  assert.deepEqual(parseDecorations(''), [])
})

test('parseDecorations：非 full 形式的兜底归类', () => {
  assert.deepEqual(parseDecorations('origin/main, feature/x, v1'), [
    { name: 'origin/main', type: 'remote' },
    { name: 'feature/x', type: 'remote' },
    { name: 'v1', type: 'branch' },
  ])
})

test('parseDecorations：重复引用去重', () => {
  const refs = parseDecorations('refs/heads/main, refs/heads/main')
  assert.deepEqual(refs, [{ name: 'main', type: 'branch' }])
})

test('parseStatus：常规分支 + 脏文件 + 领先落后', () => {
  const text = [
    '# branch.oid 3caf8cf000000000000000000000000000000000',
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/a.ts',
    '1 M. N... 100644 100644 100644 c d src/b.ts',
    '2 R. N... 100644 100644 100644 e f R100 src/new.ts\tsrc/old.ts',
  ].join('\n')
  const status = parseStatus(text)
  assert.equal(status.head, '3caf8cf000000000000000000000000000000000')
  assert.equal(status.branch, 'feature/x')
  assert.equal(status.dirty, 3)
  assert.equal(status.conflict, 0)
  assert.equal(status.ahead, 2)
  assert.equal(status.behind, 1)
  assert.equal(status.detached, false)
  assert.equal(status.unborn, false)
})

test('parseStatus：detached HEAD', () => {
  const status = parseStatus(['# branch.oid aaaa', '# branch.head (detached)'].join('\n'))
  assert.equal(status.detached, true)
  assert.equal(status.branch, 'HEAD')
  assert.equal(status.head, 'aaaa')
})

test('parseStatus：空仓库（unborn）与冲突计数', () => {
  const unborn = parseStatus(['# branch.oid (initial)', '# branch.head main'].join('\n'))
  assert.equal(unborn.unborn, true)
  assert.equal(unborn.head, '')
  assert.equal(unborn.branch, 'main')

  const conflicted = parseStatus(
    ['# branch.oid aaaa', '# branch.head main', 'u UU N... 100644 100644 100644 100644 a b c conflict.txt'].join('\n'),
  )
  assert.equal(conflicted.dirty, 1)
  assert.equal(conflicted.conflict, 1)
})

test('parseNameStatus / parseNumstat：中文路径、二进制、统计', () => {
  const nameStatus = ['M\tAssets/a.cs', 'A\tRebuild/中文 文件.md', 'D\told.txt'].join('\n')
  assert.deepEqual(parseNameStatus(nameStatus), [
    { status: 'M', path: 'Assets/a.cs' },
    { status: 'A', path: 'Rebuild/中文 文件.md' },
    { status: 'D', path: 'old.txt' },
  ])
  const numstat = ['3\t4\tAssets/a.cs', '9\t0\tRebuild/中文 文件.md', '-\t-\tbinary.png'].join('\n')
  assert.deepEqual(parseNumstat(numstat), [
    { path: 'Assets/a.cs', added: 3, deleted: 4 },
    { path: 'Rebuild/中文 文件.md', added: 9, deleted: 0 },
    { path: 'binary.png', added: 0, deleted: 0 },
  ])
})

test('parseShowHeader：多行 body 与 refs/时间', () => {
  const fields = [
    'a'.repeat(40),
    'b'.repeat(40) + ' ' + 'c'.repeat(40),
    '张三',
    'zhang@example.com',
    '2026-11-01T10:00:00+00:00',
    '2026-11-02T11:00:00+00:00',
    'HEAD -> refs/heads/main',
    'feat: 标题行\n\n第二段说明\n\n- 列表项\n',
  ]
  const header = parseShowHeader(fields.join(NUL))
  assert.notEqual(header, null)
  assert.equal(header.sha, 'a'.repeat(40))
  assert.deepEqual(header.parents, ['b'.repeat(40), 'c'.repeat(40)])
  assert.equal(header.author, '张三')
  assert.equal(header.body, 'feat: 标题行\n\n第二段说明\n\n- 列表项')
  assert.deepEqual(header.refs, [{ name: 'main', type: 'head' }])
  assert.equal(header.authorTime, toUnixSeconds('2026-11-01T10:00:00+00:00'))
  assert.ok(header.commitTime > header.authorTime)
})

test('parseShowHeader：字段不足返回 null', () => {
  assert.equal(parseShowHeader(''), null)
  assert.equal(parseShowHeader('a' + NUL + 'b'), null)
})

test('parseToplevel 与 toUnixSeconds', () => {
  assert.equal(parseToplevel('D:/work/demo-repo\n'), 'D:/work/demo-repo')
  assert.equal(parseToplevel(''), '')
  assert.equal(toUnixSeconds('1700000000'), 1700000000)
  assert.equal(toUnixSeconds(1700000000), 1700000000)
  assert.equal(toUnixSeconds('bogus'), 0)
  assert.equal(toUnixSeconds(''), 0)
})
