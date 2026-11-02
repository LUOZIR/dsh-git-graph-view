/**
 * 泳道布局单元测试（node:test）。
 * 运行：node --test test/
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLayout, layoutLanes } from '../lib/graph.js'

/** 构造最小提交输入。 */
const c = (sha, parents = []) => ({ sha, parents })

/** 断言布局不变式成立。 */
function assertValid(commits, layout) {
  const problems = checkLayout(commits, layout)
  assert.deepEqual(problems, [], problems.join('；'))
}

test('空列表：返回空行与 1 列', () => {
  const layout = layoutLanes([])
  assert.deepEqual(layout.rows, [])
  assert.equal(layout.lanes, 1)
})

test('线性历史：单泳道、节点连续', () => {
  const commits = [c('C', ['B']), c('B', ['A']), c('A')]
  const layout = layoutLanes(commits)
  assert.equal(layout.lanes, 1)
  assert.deepEqual(layout.rows.map((row) => row.lane), [0, 0, 0])
  assert.deepEqual(layout.rows.map((row) => row.nodeAbove), [false, true, true])
  assert.deepEqual(layout.rows.map((row) => row.nodeBelow), [true, true, false])
  for (const row of layout.rows) {
    assert.deepEqual(row.above, [])
    assert.deepEqual(row.below, [])
    assert.deepEqual(row.mergesIn, [])
    assert.deepEqual(row.forks, [])
  }
  assertValid(commits, layout)
})

test('分叉：合并提交把第二个父提交放到新列', () => {
  const commits = [c('M', ['A', 'B']), c('A'), c('B')]
  const layout = layoutLanes(commits)
  assert.equal(layout.lanes, 2)
  const [mergeRow, leftRow, rightRow] = layout.rows
  assert.equal(mergeRow.lane, 0)
  assert.deepEqual(mergeRow.forks, [1])
  assert.deepEqual(mergeRow.below, [1])
  assert.equal(mergeRow.nodeBelow, true)
  assert.deepEqual(leftRow.above, [1])
  assert.deepEqual(leftRow.below, [1])
  assert.equal(rightRow.lane, 1)
  assertValid(commits, layout)
})

test('合流：同一父提交被两个子提交引用时，右列汇入节点列', () => {
  const commits = [c('C1', ['P']), c('C2', ['P']), c('P')]
  const layout = layoutLanes(commits)
  assert.equal(layout.lanes, 2)
  const [first, second, parent] = layout.rows
  assert.equal(first.lane, 0)
  assert.equal(second.lane, 1)
  assert.deepEqual(second.forks, [0])
  assert.deepEqual(second.above, [0])
  assert.equal(parent.lane, 0)
  assert.equal(parent.nodeAbove, true)
  // 右上节点没有“上方延续”，它是新分支的尖端。
  assert.equal(second.nodeAbove, false)
  assertValid(commits, layout)
})

test('八爪鱼合并：多个父提交各占一列', () => {
  const commits = [c('M', ['A', 'B', 'C']), c('A'), c('B'), c('C')]
  const layout = layoutLanes(commits)
  assert.equal(layout.lanes, 3)
  const [mergeRow] = layout.rows
  assert.equal(mergeRow.lane, 0)
  assert.deepEqual(mergeRow.forks, [1, 2])
  assert.deepEqual(mergeRow.below, [1, 2])
  assert.equal(mergeRow.nodeBelow, true)
  assertValid(commits, layout)
})

test('重复父提交：fork 目标去重', () => {
  const commits = [c('M', ['A', 'A', 'B']), c('A'), c('B')]
  const layout = layoutLanes(commits)
  const [mergeRow] = layout.rows
  const unique = new Set(mergeRow.forks)
  assert.equal(unique.size, mergeRow.forks.length)
  assertValid(commits, layout)
})

test('被截断的父提交：节点列继续向下画一小段', () => {
  const commits = [c('X', ['P']) ]
  const layout = layoutLanes(commits)
  const [row] = layout.rows
  assert.equal(row.lane, 0)
  assert.equal(row.nodeAbove, false)
  assert.equal(row.nodeBelow, true)
  assert.deepEqual(row.forks, [])
  assert.equal(layout.lanes, 1)
  assertValid(commits, layout)
})

test('根提交：泳道在节点处结束', () => {
  const commits = [c('A')]
  const layout = layoutLanes(commits)
  const [row] = layout.rows
  assert.equal(row.nodeAbove, false)
  assert.equal(row.nodeBelow, false)
  assert.deepEqual(row.above, [])
  assert.deepEqual(row.below, [])
  assertValid(commits, layout)
})

test('多分支交错：列号合法且宽度等于最大列 + 1', () => {
  // 拓扑序：子提交一定在父提交之前。
  const commits = [
    c('H1', ['G1', 'G2']),
    c('H2', ['G2']),
    c('G1', ['F1']),
    c('G2', ['F1']),
    c('F1', ['E1']),
    c('E1'),
  ]
  const layout = layoutLanes(commits)
  assertValid(commits, layout)
  for (const row of layout.rows) {
    assert.ok(row.lane >= 0 && row.lane < layout.lanes)
  }
})

test('1000 条合成提交：布局有界且不慢', () => {
  const commits = []
  const total = 1000
  for (let index = 0; index < total; index += 1) {
    const parents = []
    if (index + 1 < total) parents.push('c' + String(index + 1))
    // 每 7 个提交制造一次分叉/合并，保证泳道有一定宽度。
    if (index % 7 === 3 && index + 8 < total) parents.push('c' + String(index + 8))
    commits.push(c('c' + String(index), parents))
  }
  const started = process.hrtime.bigint()
  const layout = layoutLanes(commits)
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  assert.equal(layout.rows.length, total)
  assert.ok(layout.lanes >= 1 && layout.lanes < 40, '泳道宽度应保持有界，实际 ' + String(layout.lanes))
  assert.ok(elapsedMs < 500, '布局耗时过高：' + elapsedMs.toFixed(1) + 'ms')
  assertValid(commits, layout)
})

test('前向稳定性：追加更早的提交不改变已有行', () => {
  const head = [c('C', ['B']), c('B', ['A'])]
  const extended = [...head, c('A', ['Z']), c('Z')]
  const shortLayout = layoutLanes(head)
  const longLayout = layoutLanes(extended)
  assert.deepEqual(longLayout.rows.slice(0, head.length), shortLayout.rows)
})
