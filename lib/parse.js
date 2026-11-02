/**
 * git 输出解析：全部为纯函数，输入是命令 stdout 字符串，输出是结构化的普通对象。
 *
 * 约定（与 lib/git.js 的命令构造一一对应）：
 *  - `git log --format=%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x1e`
 *  - `git show -s --format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%D%x00%B`
 *  - `git status --porcelain=v2 --branch --untracked-files=no`
 *  - `git diff-tree -r --name-status` / `--numstat`（--no-renames）
 */

const FIELD = '\x00'
const RECORD = '\x1e'

/**
 * 解析 `git log` 的图谱输出。
 * @param {string} text - 命令 stdout。
 * @returns {{sha:string,parents:string[],author:string,email:string,time:number,subject:string,refs:object[]}[]}
 */
export function parseGraphLog(text) {
  const commits = []
  if (typeof text !== 'string' || text === '') return commits
  for (const piece of text.split(RECORD)) {
    const record = piece.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '')
    if (record === '') continue
    const parts = record.split(FIELD)
    if (parts.length < 7) continue
    const [sha = '', parentText = '', author = '', email = '', timeText = '', decoration = ''] = parts
    const subject = parts.slice(6).join(FIELD)
    if (sha === '') continue
    commits.push({
      sha,
      parents: parentText.split(' ').filter((parent) => parent !== ''),
      author,
      email,
      time: toUnixSeconds(timeText),
      subject,
      refs: parseDecorations(decoration),
    })
  }
  return commits
}

/**
 * 解析 HEAD / 引用装饰（配合 `--decorate=full` 使用，得到完整 refs 路径）。
 * @param {string} text - `%D` 的文本，例如
 *   `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`。
 * @returns {{name:string,type:'head'|'branch'|'remote'|'tag'}[]}
 */
export function parseDecorations(text) {
  const refs = []
  if (typeof text !== 'string' || text.trim() === '') return refs
  const seen = new Set()
  // git 的装饰分隔符是 ", "；分支名不允许空格，因此按“逗号 + 空白”切分是安全的
  // （分支名里允许逗号但不允许空格，例如 feature,a 不会被误切）。
  for (const piece of text.split(/,\s+/)) {
    let token = piece.trim()
    if (token === '') continue
    let type = null
    let name = token
    if (token.startsWith('HEAD -> ')) {
      type = 'head'
      name = token.slice('HEAD -> '.length).trim()
    } else if (token === 'HEAD') {
      type = 'head'
      name = 'HEAD'
    } else if (token.startsWith('tag: ')) {
      type = 'tag'
      name = token.slice('tag: '.length).trim()
    }
    if (name.startsWith('refs/heads/')) {
      name = name.slice('refs/heads/'.length)
      if (type === null) type = 'branch'
    } else if (name.startsWith('refs/remotes/')) {
      name = name.slice('refs/remotes/'.length)
      if (type === null) type = 'remote'
    } else if (name.startsWith('refs/tags/')) {
      name = name.slice('refs/tags/'.length)
      if (type === null) type = 'tag'
    } else if (name.startsWith('refs/')) {
      name = name.slice('refs/'.length)
    }
    if (type === null) type = name === 'HEAD' ? 'head' : name.includes('/') ? 'remote' : 'branch'
    // 远程仓库的 HEAD 别名（origin/HEAD）不是可读分支，跳过。
    if (type === 'remote' && name.endsWith('/HEAD')) continue
    if (name === '') continue
    const key = type + ':' + name
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ name, type })
  }
  return refs
}

/**
 * 解析 `git status --porcelain=v2 --branch --untracked-files=no`。
 * @param {string} text - 命令 stdout。
 * @returns {{branch:string,detached:boolean,unborn:boolean,head:string,dirty:number,conflict:number,ahead:number,behind:number}}
 */
export function parseStatus(text) {
  const status = {
    branch: '',
    detached: false,
    unborn: false,
    head: '',
    dirty: 0,
    conflict: 0,
    ahead: 0,
    behind: 0,
  }
  if (typeof text !== 'string' || text === '') return status
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const value = line.slice('# branch.oid '.length).trim()
      if (value === '(initial)') status.unborn = true
      else status.head = value
    } else if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      if (value === '(detached)') {
        status.detached = true
        status.branch = 'HEAD'
      } else {
        status.branch = value
      }
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line)
      if (match !== null) {
        status.ahead = Number(match[1]) || 0
        status.behind = Number(match[2]) || 0
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      status.dirty += 1
    } else if (line.startsWith('u ')) {
      status.dirty += 1
      status.conflict += 1
    }
  }
  return status
}

/**
 * 解析 `git diff-tree --name-status`。
 * @param {string} text - 命令 stdout（每行 `<状态>\t<路径>`）。
 * @returns {{status:string,path:string}[]}
 */
export function parseNameStatus(text) {
  const entries = []
  if (typeof text !== 'string' || text === '') return entries
  for (const line of text.split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const status = line.slice(0, tab).trim().charAt(0) || 'M'
    const path = line.slice(tab + 1).trim()
    if (path === '') continue
    entries.push({ status, path })
  }
  return entries
}

/**
 * 解析 `git diff-tree --numstat`。
 * @param {string} text - 命令 stdout（每行 `<added>\t<deleted>\t<路径>`，二进制为 `-\t-`）。
 * @returns {{path:string,added:number,deleted:number}[]}
 */
export function parseNumstat(text) {
  const entries = []
  if (typeof text !== 'string' || text === '') return entries
  for (const line of text.split('\n')) {
    if (line === '') continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const path = parts.slice(2).join('\t').trim()
    if (path === '') continue
    const added = parts[0] === '-' ? 0 : Number(parts[0])
    const deleted = parts[1] === '-' ? 0 : Number(parts[1])
    entries.push({
      path,
      added: Number.isFinite(added) ? added : 0,
      deleted: Number.isFinite(deleted) ? deleted : 0,
    })
  }
  return entries
}

/**
 * 解析 `git show -s --format=…%B` 的提交头（body 为最后一个字段，允许包含换行）。
 * @param {string} text - 命令 stdout。
 * @returns {{sha:string,parents:string[],author:string,email:string,authorTime:number,commitTime:number,refs:object[],body:string}|null}
 */
export function parseShowHeader(text) {
  if (typeof text !== 'string' || text === '') return null
  const clean = text.replace(/^[\r\n]+/, '')
  const parts = clean.split(FIELD)
  if (parts.length < 8) return null
  const [sha = '', parentText = '', author = '', email = '', authorISO = '', commitISO = '', decoration = ''] = parts
  if (sha === '') return null
  return {
    sha,
    parents: parentText.split(' ').filter((parent) => parent !== ''),
    author,
    email,
    authorTime: toUnixSeconds(authorISO),
    commitTime: toUnixSeconds(commitISO),
    refs: parseDecorations(decoration),
    body: parts.slice(7).join(FIELD).replace(/\s+$/, ''),
  }
}

/**
 * 解析 `git rev-parse --show-toplevel` 的单行输出。
 * @param {string} text - 命令 stdout。
 * @returns {string} 仓库根（git 的原样输出，通常为正斜杠路径）；空串表示无输出。
 */
export function parseToplevel(text) {
  if (typeof text !== 'string') return ''
  const first = text.split('\n').find((line) => line.trim() !== '')
  return first === undefined ? '' : first.trim()
}

/** ISO-8601 / unix 秒文本 → unix 秒；无法解析时返回 0。 */
export function toUnixSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value !== 'string' || value === '') return 0
  if (/^\d+$/.test(value)) return Number(value)
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0
}
