/**
 * git 命令层：argv 构造、可注入的 runner、失败分类。
 *
 * 生产 runner 用 `node:child_process.execFile`（无 shell、按 argv 直接执行），
 * 因此不会经过 cmd.exe 解析，路径中的空格/中文都安全。测试可注入假 runner，
 * 完全不触碰真实 git。
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

/** 单条 git 命令的超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 15000
/** 单条 git 命令收集输出上限（字节）。 */
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** 全局 `-c` 覆盖：禁用路径引用转义、日志固定 UTF-8、禁用颜色（避免用户全局 color.ui=always 污染解析）。 */
const GLOBAL_ARGS = ['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8', '-c', 'color.ui=false']

/** 构造 git 环境（git 不写 index、不弹交互、不启用分页器）。 */
export function buildGitEnv(base = process.env) {
  const env = { ...base }
  // 防止宿主环境里的 GIT_* 把 cwd 绑到别的仓库上。
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_OBJECT_DIRECTORY
  delete env.GIT_NAMESPACE
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_PAGER = 'cat'
  return env
}

/**
 * git 可执行文件候选：PATH 上的 `git`/`git.exe`，Windows 再加常见安装路径。
 * @param {string} platform - process.platform（测试可注入）。
 * @param {(path:string)=>boolean} exists - 存在性探测（测试可注入）。
 */
export function gitCandidates(platform = process.platform, exists = existsSync) {
  const candidates = ['git', 'git.exe']
  if (platform === 'win32') {
    for (const path of [
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
    ]) {
      if (exists(path)) candidates.push(path)
    }
  }
  return candidates
}

/** 从 git stderr 判定“不是仓库”。 */
function isNotRepo(stderr) {
  return /not a git repository/i.test(stderr)
}

/** 从 git stderr 判定“提交不存在”。 */
function isUnknownRevision(stderr) {
  return /unknown revision|bad object|invalid object name|ambiguous argument|Needed a single revision/i.test(stderr)
}

/** 取 stderr 的首个非空行（给用户看的简短错误）。 */
function firstLine(text) {
  const line = String(text ?? '')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item !== '')
  return line === undefined ? '' : line.slice(0, 300)
}

/** 一次子进程失败结果 → 稳定错误对象。 */
function failureOf(result) {
  if (result.kind === 'timeout') {
    return { code: 'timeout', message: 'git 命令执行超时（' + String(DEFAULT_TIMEOUT_MS) + 'ms）' }
  }
  const stderr = String(result.stderr ?? '')
  if (isNotRepo(stderr)) return { code: 'not-a-repo', message: '当前路径不是 Git 仓库' }
  if (isUnknownRevision(stderr)) return { code: 'bad-request', message: firstLine(stderr) || '提交不存在' }
  return { code: 'git-failed', message: firstLine(stderr) || ('git 退出码 ' + String(result.code)) }
}

/**
 * 生产 runner 工厂。
 * @param {{execFileImpl?: Function, platform?: string, exists?: Function, env?: object, timeoutMs?: number}} options
 * @returns {{run(cwd:string, argv:string[], options?:{signal?:AbortSignal,timeoutMs?:number}):Promise<{ok:true,stdout:string,stderr:string}|{ok:false,error:object,stdout?:string,stderr?:string}>}}
 */
export function createGitRunner(options = {}) {
  const runFile = options.execFileImpl ?? execFile
  const candidates = gitCandidates(options.platform ?? process.platform, options.exists ?? existsSync)
  const env = options.env ?? buildGitEnv()
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  /** 已探测成功的可执行文件；只缓存成功结果，失败下次重新探测。 */
  let resolved = null

  return {
    async run(cwd, argv, runOptions = {}) {
      const timeout = runOptions.timeoutMs ?? defaultTimeout
      const signal = runOptions.signal
      const attempts = resolved === null ? candidates : [resolved]
      let sawMissing = false
      for (const executable of attempts) {
        const result = await runOnce(runFile, executable, [...GLOBAL_ARGS, ...argv], cwd, { timeout, signal, env })
        if (result.kind === 'missing') {
          sawMissing = true
          if (resolved === executable) resolved = null
          continue
        }
        if (result.kind === 'ok') {
          resolved = executable
          return { ok: true, stdout: result.stdout, stderr: result.stderr }
        }
        resolved = executable
        return { ok: false, error: failureOf(result), stdout: result.stdout, stderr: result.stderr }
      }
      if (sawMissing) {
        return { ok: false, error: { code: 'git-missing', message: '未找到 git 命令，请确认已安装 Git 并加入 PATH' } }
      }
      return { ok: false, error: { code: 'git-missing', message: '未找到 git 命令，请确认已安装 Git 并加入 PATH' } }
    },
  }
}

/** 执行一次子进程。callback 与 error 事件都可能到达，用 settled 去重。 */
function runOnce(runFile, executable, argv, cwd, { timeout, signal, env }) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = runFile(
        executable,
        argv,
        {
          cwd,
          timeout,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          encoding: 'utf8',
          env,
          signal,
        },
        (error, stdout, stderr) => {
          if (error !== null && error !== undefined) {
            if (error.code === 'ENOENT') return done({ kind: 'missing' })
            if (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.killed === true) {
              return done({ kind: 'timeout', stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
            }
            return done({
              kind: 'exit',
              code: typeof error.code === 'number' ? error.code : 1,
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
              message: error.message,
            })
          }
          return done({ kind: 'ok', stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        },
      )
      // execFile 已通过 callback 报告错误；这里兜底吞掉重复的 error 事件。
      if (child !== undefined && child !== null && typeof child.on === 'function') {
        child.on('error', () => {})
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return done({ kind: 'missing' })
      done({ kind: 'exit', code: 1, stdout: '', stderr: '', message: String(error?.message ?? error) })
    }
  })
}

// ---------------------------------------------------------------------------
// argv 构造：与 lib/parse.js 的解析一一对应，改动时两处同步。
// ---------------------------------------------------------------------------

/** `git rev-parse --show-toplevel`：仓库根（非仓库退出码非 0）。 */
export function toplevelArgv() {
  return ['rev-parse', '--show-toplevel']
}

/** `git status --porcelain=v2 --branch --untracked-files=no`：分支/领先落后/脏文件。 */
export function statusArgv() {
  return ['status', '--porcelain=v2', '--branch', '--untracked-files=no']
}

/** 图谱日志：全分支 + tag + 远程 + HEAD，拓扑序，带父提交与 full refs 装饰。 */
export function graphLogArgv(limit) {
  return [
    'log',
    '--branches',
    '--tags',
    '--remotes',
    '--topo-order',
    '--decorate=full',
    '--parents',
    '--max-count',
    String(limit),
    '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x1e',
    // 显式带上 HEAD：detached HEAD 时其提交可能不被任何 ref 覆盖，只靠
    // --branches/--tags/--remotes 会漏掉当前检出的提交。
    'HEAD',
  ]
}

/** 单个提交的头信息（sha/parents/作者/时间/refs/完整 message）。 */
export function showHeaderArgv(sha) {
  return [
    'show',
    '-s',
    '--decorate=full',
    '--no-show-signature',
    '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%D%x00%B',
    sha,
  ]
}

/**
 * `git diff-tree` 的文件级输出。
 * @param {'name-status'|'numstat'} kind - 输出类型。
 * @param {string} sha - 提交 sha。
 * @param {string[]} parents - 该提交的父提交（决定与谁比较）。
 */
export function diffTreeArgv(kind, sha, parents) {
  const argv = [
    'diff-tree',
    '-r',
    '--no-commit-id',
    '--no-renames',
    kind === 'numstat' ? '--numstat' : '--name-status',
  ]
  if (parents.length === 0) argv.push('--root', sha)
  else if (parents.length > 1) argv.push(sha + '^1', sha)
  else argv.push(sha)
  return argv
}
