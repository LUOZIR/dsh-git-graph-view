/**
 * Git 图谱业务层：只组合 `lib/git.js`（命令）与 `lib/parse.js`（解析）、
 * `lib/graph.js`（泳道布局），不接触 HTTP、不接触文件系统。
 *
 * 所有预期失败都以 {@link ServiceError} 抛出，由 HTTP 层映射为稳定错误码；
 * 未预期异常由 HTTP 层兜底为 internal。
 */

import { basename } from 'node:path'
import { layoutLanes } from './graph.js'
import {
  parseGraphLog,
  parseNameStatus,
  parseNumstat,
  parseShowHeader,
  parseStatus,
  parseToplevel,
} from './parse.js'
import { diffTreeArgv, graphLogArgv, showHeaderArgv, statusArgv, toplevelArgv } from './git.js'

/** 默认提交条数。 */
export const DEFAULT_LIMIT = 200
/** 单次请求最多提交条数。 */
export const MAX_LIMIT = 1000
/** 详情面板最多列出的文件数。 */
export const MAX_DETAIL_FILES = 300

/** 业务失败：携带稳定错误码与面向用户的中文消息。 */
export class ServiceError extends Error {
  /**
   * @param {string} code - bad-request | not-a-workspace | not-a-repo | git-missing | timeout | git-failed | internal
   * @param {string} message - 面向用户的中文说明。
   */
  constructor(code, message) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

/** 夹取 limit 到 1..MAX_LIMIT；非数字时用默认值。 */
export function clampLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const integer = Math.floor(value)
  if (integer < 1) return 1
  return Math.min(integer, MAX_LIMIT)
}

/** 文件状态字母归一化（name-status 可能带相似度后缀，例如 R100）。 */
function normalizeStatus(status) {
  const letter = String(status ?? '').charAt(0).toUpperCase()
  return ['A', 'M', 'D', 'R', 'C', 'T', 'U', '?'].includes(letter) ? letter : 'M'
}

/** numstat 兜底推断状态（只用于 name-status 失败时）。 */
function inferStatus(entry) {
  if (entry.added > 0 && entry.deleted === 0) return 'A'
  if (entry.added === 0 && entry.deleted > 0) return 'D'
  return 'M'
}

/** 提交信息首行（subject）。 */
function firstLine(text) {
  const line = String(text ?? '').split('\n').find((item) => item.trim() !== '')
  return line === undefined ? '' : line.trim().slice(0, 300)
}

/**
 * 业务服务工厂。
 * @param {{runner: {run(cwd:string, argv:string[], options?:object): Promise<{ok:boolean, stdout?:string, stderr?:string, error?:{code:string,message:string}}>}}} deps
 */
export function createGitGraphService(deps) {
  const runner = deps?.runner
  if (runner === undefined || typeof runner.run !== 'function') {
    throw new TypeError('createGitGraphService: 需要提供 runner.run')
  }

  /** 执行一条 git 命令，成功返回 stdout，失败抛 ServiceError。 */
  async function runOrThrow(cwd, argv, signal) {
    const result = await runner.run(cwd, argv, { signal })
    if (result.ok) return result.stdout
    const error = result.error ?? {}
    const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'internal'
    const message = typeof error.message === 'string' && error.message !== '' ? error.message : 'git 执行失败'
    throw new ServiceError(code, message)
  }

  return {
    /**
     * 读取仓库状态与提交图谱。
     * @param {string} path - 已通过工作区闸校验的仓库/工作区路径。
     * @param {number|undefined} limit - 提交条数（内部夹取）。
     * @param {AbortSignal|undefined} signal - 取消信号。
     */
    async graph(path, limit, signal) {
      const effectiveLimit = clampLimit(limit)

      const root = parseToplevel(await runOrThrow(path, toplevelArgv(), signal))
      if (root === '') throw new ServiceError('not-a-repo', '当前路径不是 Git 仓库')

      const [statusResult, logResult] = await Promise.all([
        runner.run(path, statusArgv(), { signal }),
        runner.run(path, graphLogArgv(effectiveLimit), { signal }),
      ])
      if (!statusResult.ok) {
        const error = statusResult.error ?? {}
        throw new ServiceError(error.code ?? 'git-failed', error.message ?? '读取仓库状态失败')
      }
      const status = parseStatus(statusResult.stdout)

      let commits = []
      if (status.unborn !== true) {
        if (logResult.ok) {
          commits = parseGraphLog(logResult.stdout)
        } else {
          const error = logResult.error ?? {}
          const stderr = String(logResult.stderr ?? '') + ' ' + String(error.message ?? '')
          if (/does not have any commits yet|current branch .* does not have any commits/i.test(stderr)) {
            status.unborn = true
          } else {
            throw new ServiceError(error.code ?? 'git-failed', error.message ?? '读取提交历史失败')
          }
        }
      }

      const layout = layoutLanes(commits)
      const rows = commits.map((commit, index) => {
        const laneRow = layout.rows[index] ?? {
          lane: 0,
          above: [],
          below: [],
          mergesIn: [],
          forks: [],
          nodeAbove: false,
          nodeBelow: false,
        }
        return {
          sha: commit.sha,
          short: commit.sha.slice(0, 7),
          subject: commit.subject,
          author: commit.author,
          email: commit.email,
          time: commit.time,
          parents: commit.parents,
          refs: commit.refs,
          lane: laneRow.lane,
          above: laneRow.above,
          below: laneRow.below,
          mergesIn: laneRow.mergesIn,
          forks: laneRow.forks,
          nodeAbove: laneRow.nodeAbove,
          nodeBelow: laneRow.nodeBelow,
        }
      })

      return {
        repo: {
          root,
          name: basename(root),
          branch: status.branch || (status.detached ? 'HEAD' : ''),
          detached: status.detached,
          unborn: status.unborn,
          head: status.head,
          dirty: status.dirty,
          conflict: status.conflict,
          ahead: status.ahead,
          behind: status.behind,
        },
        commits: rows,
        lanes: layout.lanes,
        truncated: commits.length >= effectiveLimit,
      }
    },

    /**
     * 读取单个提交的详情（元信息 + refs + 相对首父的文件变更）。
     * @param {string} path - 已通过工作区闸校验的路径。
     * @param {string} sha - 提交 sha。
     * @param {AbortSignal|undefined} signal - 取消信号。
     */
    async commit(path, sha, signal) {
      const header = parseShowHeader(await runOrThrow(path, showHeaderArgv(sha), signal))
      if (header === null) throw new ServiceError('internal', '无法解析提交信息')

      const [nameResult, numstatResult] = await Promise.all([
        runner.run(path, diffTreeArgv('name-status', sha, header.parents), { signal }),
        runner.run(path, diffTreeArgv('numstat', sha, header.parents), { signal }),
      ])

      const nameEntries = nameResult.ok ? parseNameStatus(nameResult.stdout) : []
      const numstatEntries = numstatResult.ok ? parseNumstat(numstatResult.stdout) : []
      const counts = new Map()
      let added = 0
      let deleted = 0
      for (const entry of numstatEntries) {
        counts.set(entry.path, entry)
        added += entry.added
        deleted += entry.deleted
      }

      const files = []
      const seen = new Set()
      for (const entry of nameEntries) {
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        const count = counts.get(entry.path)
        files.push({
          status: normalizeStatus(entry.status),
          path: entry.path,
          added: count === undefined ? 0 : count.added,
          deleted: count === undefined ? 0 : count.deleted,
        })
      }
      // name-status 失败（例如浅克隆缺父提交）时退回 numstat 推断。
      if (files.length === 0 && numstatEntries.length > 0) {
        for (const entry of numstatEntries) {
          if (seen.has(entry.path)) continue
          seen.add(entry.path)
          files.push({
            status: inferStatus(entry),
            path: entry.path,
            added: entry.added,
            deleted: entry.deleted,
          })
        }
      }

      return {
        sha: header.sha,
        short: header.sha.slice(0, 7),
        subject: firstLine(header.body) || '(无提交信息)',
        body: header.body,
        author: header.author,
        email: header.email,
        authorTime: header.authorTime,
        commitTime: header.commitTime,
        parents: header.parents,
        refs: header.refs,
        isMerge: header.parents.length > 1,
        stats: { files: files.length, added, deleted },
        files: files.slice(0, MAX_DETAIL_FILES),
        filesTruncated: files.length > MAX_DETAIL_FILES,
      }
    },
  }
}
