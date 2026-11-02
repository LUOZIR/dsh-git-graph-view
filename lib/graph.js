/**
 * 泳道布局：把 topo 序（子提交在前、父提交在后）的提交列表转成逐行可渲染的
 * 泳道拓扑。纯函数，不读文件、不依赖任何运行时；client 只按这里产出的字段画 SVG。
 *
 * 术语：
 *  - lane（列）：一条竖直泳道；`lanes[i]` 表示第 i 列当前“等待出现”的提交 sha。
 *  - 交汇：同一提交被多个子提交引用时，会在多列同时等待；最左列作为节点列，
 *    其余列在本行汇入节点（mergesIn）。
 *  - 分叉：一个提交有多个父提交时，首父占据节点列继续向下（nodeBelow），
 *    其余父提交各自占一列（forks）。
 */

/** 提交输入：只依赖 sha 与 parents，其余字段原样透传。 */
export function layoutLanes(commits) {
  if (!Array.isArray(commits) || commits.length === 0) return { rows: [], lanes: 1 }

  /** @type {(string|null)[]} lanes[i] = 第 i 列等待的下一个提交 sha，null 表示空列 */
  const lanes = []
  /** @type {object[]} */
  const rows = []
  let laneCount = 0

  for (const commit of commits) {
    const sha = typeof commit?.sha === 'string' ? commit.sha : ''
    const parents = Array.isArray(commit?.parents)
      ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '')
      : []

    // 1) 找承载本提交的列：同一 sha 可能在多列等待（多个子提交合流）。
    const incoming = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === sha) incoming.push(index)
    }
    let lane = -1
    if (incoming.length > 0) {
      lane = incoming[0]
    } else {
      lane = lanes.indexOf(null)
      if (lane === -1) lane = lanes.length
    }

    // 2) 本行“上方”穿过的列：所有非空列，节点列单独由 nodeAbove 表达。
    const above = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (index !== lane && lanes[index] !== null && lanes[index] !== undefined) above.push(index)
    }
    const mergesIn = incoming.filter((index) => index !== lane)

    // 3) 清空汇入本提交的列（含节点列），为分配父提交腾出位置。
    for (const index of incoming) lanes[index] = null
    lanes[lane] = null

    // 4) 分配父提交：首父延续节点列，其余父提交复用/新增列并记录 fork。
    let nodeBelow = false
    const forks = []
    for (let parentIndex = 0; parentIndex < parents.length; parentIndex += 1) {
      const parentSha = parents[parentIndex]
      let target = -1
      for (let index = 0; index < lanes.length; index += 1) {
        if (lanes[index] === parentSha) {
          target = index
          break
        }
      }
      if (target !== -1) {
        // 父提交已在某列等待：从节点拉一条 fork 线过去即可，不新占列。
        if (target !== lane) forks.push(target)
        continue
      }
      if (parentIndex === 0) {
        lanes[lane] = parentSha
        nodeBelow = true
        continue
      }
      // 节点列若未被首父延续（首父已在别的列等待），就不再分配给其它父提交：
      // 节点列在本行必须在节点处结束，否则会画出“节点连回自己列”的伪线。
      let free = -1
      for (let index = 0; index < lanes.length; index += 1) {
        if (index !== lane && lanes[index] === null) {
          free = index
          break
        }
      }
      if (free === -1) free = lanes.length
      lanes[free] = parentSha
      forks.push(free)
    }

    // 5) 本行“下方”穿过的列（节点列单独由 nodeBelow 表达）。
    const below = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (index !== lane && lanes[index] !== null && lanes[index] !== undefined) below.push(index)
    }

    // 6) 裁剪尾部空列（列号不变；后续提交仍可重新占用末尾列）。
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    // 7) 本行达到的最大列号（含节点列表宽度）。
    let width = lane + 1
    for (const index of above) if (index + 1 > width) width = index + 1
    for (const index of below) if (index + 1 > width) width = index + 1
    for (const index of forks) if (index + 1 > width) width = index + 1
    for (const index of mergesIn) if (index + 1 > width) width = index + 1
    if (width > laneCount) laneCount = width

    rows.push({
      lane,
      above,
      below,
      mergesIn,
      forks: dedupe(forks),
      nodeAbove: incoming.length > 0,
      nodeBelow,
      width,
    })
  }

  return { rows, lanes: Math.max(laneCount, 1) }
}

/** 保序去重（fork 目标列可能重复出现，例如重复的父提交）。 */
function dedupe(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/**
 * 校验布局结果的结构不变式，供测试与诊断使用。
 * @returns {string[]} 违反项的中文描述；空数组表示通过。
 */
export function checkLayout(commits, layout) {
  const problems = []
  const rows = layout?.rows ?? []
  const laneCount = layout?.lanes ?? 0
  if (laneCount < 1) problems.push('lanes 必须 >= 1')
  if (rows.length !== (Array.isArray(commits) ? commits.length : 0)) {
    problems.push('行数与提交数不一致')
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const where = `第 ${index} 行`
    if (!Number.isInteger(row.lane) || row.lane < 0) problems.push(`${where}: lane 非法`)
    if (row.lane >= laneCount) problems.push(`${where}: lane 超出全局列数`)
    for (const column of row.above) {
      if (!Number.isInteger(column) || column < 0 || column >= laneCount) problems.push(`${where}: above 列号非法 ${column}`)
    }
    for (const column of row.below) {
      if (!Number.isInteger(column) || column < 0 || column >= laneCount) problems.push(`${where}: below 列号非法 ${column}`)
    }
    for (const column of row.mergesIn) {
      if (!row.above.includes(column)) problems.push(`${where}: mergesIn 未包含于 above (${column})`)
    }
    for (const column of row.forks) {
      if (!row.below.includes(column)) problems.push(`${where}: forks 未包含于 below (${column})`)
    }
    if (!row.nodeBelow && row.nodeAbove === false && row.above.length === 0 && row.below.length === 0 && row.forks.length === 0) {
      // 孤立行允许存在（例如被截断的根提交），不算错误。
    }
  }
  return problems
}
