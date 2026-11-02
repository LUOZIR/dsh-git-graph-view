/**
 * dsh-git-graph-view —— host 半体（宿主 Node 进程）。
 *
 * 职责：在共享 webserver 上注册只读的 `/git-graph-view` 前缀路由，把浏览器
 * 半体的三类请求（图谱 / 提交详情 / 工作区列表）转成对 git 的只读调用。
 *
 * 安全边界：
 *  - 信任闸（lib/http.js）：只接受本机 loopback、非跨站请求；
 *  - 工作区闸：请求路径 realpath 之后必须等于 ctx.workspaceRegistry 里某个
 *    已注册工作区的 path（Windows 大小写不敏感），因此浏览器无法让宿主对任意
 *    目录执行 git；
 *  - git 只跑 rev-parse/status/log/show/diff-tree，且 GIT_OPTIONAL_LOCKS=0，
 *    不会写 index 或仓库内容。
 *
 * 浏览器半体（package.json 的 dsh.client）由 client-modules 从
 * `/plugins/dsh-git-graph-view/client.js` 加载，与本文件是同一个包的两面。
 */

import { readFileSync } from 'node:fs'
import { realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, resolve as resolvePath } from 'node:path'
import { tmpdir } from 'node:os'
import { isTrustedRequest, readJsonBody, writeJson } from './http.js'
import { createGitRunner } from './git.js'
import { ServiceError, clampLimit, createGitGraphService } from './service.js'

/** 插件名 / 包名 / 行 id / client 模块 id 统一同一个字符串。 */
export const PLUGIN_NAME = 'dsh-git-graph-view'

/**
 * 从本包 package.json 读取版本号（启动标记 / /health 使用），避免手写常量与
 * package.json / tgz 版本漂移。读不到时退回 '0.0.0'，不影响插件功能。
 */
function readOwnVersion() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof parsed?.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 当前插件版本（与 package.json 同步）。 */
export const VERSION = readOwnVersion()
/** 插件独占的 HTTP 前缀（不得与 /git、/sidebar、/api 冲突）。 */
export const ROUTE_PREFIX = '/git-graph-view'
/** 请求体上限：三个接口都只收小 JSON。 */
const MAX_BODY_BYTES = 64 * 1024
/** 单次请求的整体时限（一次请求最多 3 条 git 命令）。 */
const REQUEST_TIMEOUT_MS = 30 * 1000
/** 提交 sha 白名单：7..40 位十六进制。 */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

/** 插件需要的宿主服务。 */
export const inject = ['webServer', 'workspaceRegistry']

/** cordis 插件入口。 */
export function apply(ctx) {
  return mount(ctx)
}

/**
 * 可注入依赖的挂载函数（测试用假 runner / 假 ctx，不触碰真实 git）。
 * @param {object} ctx - cordis 宿主上下文（需要 webServer、workspaceRegistry，可选 logger/effect）。
 * @param {{runner?: object, bootMarker?: boolean}} deps - 测试注入点。
 * @returns {{handler: Function, service: object, gate: Function}}
 */
export function mount(ctx, deps = {}) {
  const logger = ctx?.logger
  const runner = deps.runner ?? createGitRunner()
  const service = createGitGraphService({ runner })
  const gate = createWorkspaceGate(ctx, logger)
  const handler = createHandler({ ctx, service, gate })

  if (ctx?.webServer !== undefined && typeof ctx.webServer.register === 'function') {
    const register = () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler,
      })
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(register, PLUGIN_NAME + ': /git-graph-view routes')
      } else {
        register()
      }
      logSafe(logger, 'info', `[${PLUGIN_NAME}] 已注册只读路由 ${ROUTE_PREFIX}（v${VERSION}）`)
    } catch (error) {
      logSafe(logger, 'warn', `[${PLUGIN_NAME}] 注册路由失败：${describeError(error)}`)
    }
  } else {
    logSafe(logger, 'warn', `[${PLUGIN_NAME}] webServer 不可用，路由未注册`)
  }

  if (deps.bootMarker !== false) markBoot(logger)
  return { handler, service, gate }
}

/**
 * 工作区闸：把请求路径 realpath 后与注册表逐项比较。
 * @returns {(rawPath: unknown) => Promise<{ok:true, path:string, title?:string} | {ok:false, error:{code:string,message:string}}>}
 */
export function createWorkspaceGate(ctx, logger) {
  return async function gate(rawPath) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      return { ok: false, error: { code: 'bad-request', message: '缺少 path 参数' } }
    }
    const requested = rawPath.trim()
    if (!isAbsolute(requested)) {
      return { ok: false, error: { code: 'bad-request', message: 'path 必须是绝对路径' } }
    }

    let canonical
    try {
      canonical = await realpath(requested)
    } catch {
      canonical = requested
    }

    let workspaces
    try {
      workspaces = typeof ctx?.workspaceRegistry?.list === 'function' ? ctx.workspaceRegistry.list() : []
    } catch (error) {
      logSafe(logger, 'warn', `[${PLUGIN_NAME}] 读取工作区注册表失败：${describeError(error)}`)
      return { ok: false, error: { code: 'internal', message: '工作区注册表不可用' } }
    }

    const target = normalizePathKey(canonical)
    for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
      const workspacePath = typeof workspace?.path === 'string' ? workspace.path : ''
      if (workspacePath === '') continue
      if (normalizePathKey(workspacePath) === target) {
        const title = typeof workspace?.title === 'string' && workspace.title !== '' ? workspace.title : basename(workspacePath)
        return { ok: true, path: workspacePath, title }
      }
    }
    return {
      ok: false,
      error: { code: 'not-a-workspace', message: '该路径不是已注册的工作区；请先在 DSH 中添加该工作区' },
    }
  }
}

/** 路径比较键：绝对化 + Windows 大小写不敏感 + 去尾部分隔符。 */
export function normalizePathKey(value) {
  let key = resolvePath(String(value))
  if (process.platform === 'win32') key = key.toLowerCase()
  return key.replace(/[\\/]+$/, '')
}

/** HTTP 处理器。 */
function createHandler({ ctx, service, gate }) {
  const logger = ctx?.logger

  return async function handler(req, res) {
    try {
      if (!isTrustedRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }

      let pathname
      try {
        pathname = new URL(req.url ?? '/', 'http://x').pathname
      } catch {
        res.writeHead(400)
        res.end()
        return
      }

      // 健康检查（只读、无参数），方便排查“host 半体是否加载”。
      if (pathname === ROUTE_PREFIX + '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        writeJson(res, 200, { ok: true, value: { name: PLUGIN_NAME, version: VERSION, up: true } })
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
      if (!contentType.startsWith('application/json')) {
        res.writeHead(415)
        res.end()
        return
      }

      const payload = await readJsonBody(req, MAX_BODY_BYTES)
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: '请求体必须是 JSON 对象' } })
        return
      }

      if (pathname === ROUTE_PREFIX + '/graph') {
        const gated = await gate(payload.path)
        if (gated.ok !== true) {
          writeJson(res, 200, { ok: false, error: gated.error })
          return
        }
        await withGitTask(res, logger, async (signal) => {
          const value = await service.graph(gated.path, clampLimit(payload.limit), signal)
          writeJson(res, 200, { ok: true, value })
        })
        return
      }

      if (pathname === ROUTE_PREFIX + '/commit') {
        const sha = typeof payload.sha === 'string' ? payload.sha.trim() : ''
        if (!SHA_PATTERN.test(sha)) {
          writeJson(res, 200, { ok: false, error: { code: 'bad-request', message: 'sha 必须是 7–40 位十六进制' } })
          return
        }
        const gated = await gate(payload.path)
        if (gated.ok !== true) {
          writeJson(res, 200, { ok: false, error: gated.error })
          return
        }
        await withGitTask(res, logger, async (signal) => {
          const value = await service.commit(gated.path, sha, signal)
          writeJson(res, 200, { ok: true, value })
        })
        return
      }

      if (pathname === ROUTE_PREFIX + '/workspaces') {
        writeJson(res, 200, { ok: true, value: { workspaces: listWorkspaces(ctx, logger) } })
        return
      }

      res.writeHead(404)
      res.end()
    } catch (error) {
      logSafe(logger, 'warn', `[${PLUGIN_NAME}] 请求处理异常：${describeError(error)}`)
      if (res.headersSent !== true) {
        writeJson(res, 200, { ok: false, error: { code: 'internal', message: '插件内部错误' } })
      } else {
        try {
          res.end()
        } catch {
          // 响应已断开，忽略。
        }
      }
    }
  }
}

/** 运行一次带超时/取消的 git 任务，并把 ServiceError 映射成统一 envelope。 */
async function withGitTask(res, logger, task) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    try {
      controller.abort(new Error('git 请求超时'))
    } catch {
      // 忽略 abort 失败。
    }
  }, REQUEST_TIMEOUT_MS)
  try {
    await task(controller.signal)
  } catch (error) {
    const payload = toErrorPayload(error)
    if (payload.code === 'internal') {
      logSafe(logger, 'warn', `[${PLUGIN_NAME}] ${payload.message}：${describeError(error)}`)
    }
    writeJson(res, 200, { ok: false, error: payload })
  } finally {
    clearTimeout(timer)
  }
}

/** ServiceError → 稳定 envelope；其它异常统一 internal。 */
function toErrorPayload(error) {
  if (error instanceof ServiceError) return { code: error.code, message: error.message }
  // 兼容跨模块实例（测试里可能构造同名类）：按字段读。
  if (error !== null && typeof error === 'object' && typeof error.code === 'string' && typeof error.message === 'string') {
    return { code: error.code, message: error.message }
  }
  return { code: 'internal', message: '插件内部错误' }
}

/** 已注册工作区列表（只暴露 path/title，不探测 git）。 */
function listWorkspaces(ctx, logger) {
  let workspaces = []
  try {
    workspaces = typeof ctx?.workspaceRegistry?.list === 'function' ? ctx.workspaceRegistry.list() : []
  } catch (error) {
    logSafe(logger, 'warn', `[${PLUGIN_NAME}] 读取工作区注册表失败：${describeError(error)}`)
    return []
  }
  const list = []
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const path = typeof workspace?.path === 'string' ? workspace.path : ''
    if (path === '') continue
    const title = typeof workspace?.title === 'string' && workspace.title !== '' ? workspace.title : basename(path)
    list.push({ path, title })
  }
  return list
}

/** 启动标记：host 半体 apply 时写一个临时文件，便于重启后确认插件确实加载。 */
function markBoot(logger) {
  try {
    const file = `${tmpdir()}/dsh-git-graph-view-boot.json`
    const payload = JSON.stringify(
      {
        name: PLUGIN_NAME,
        version: VERSION,
        prefix: ROUTE_PREFIX,
        pid: process.pid,
        at: new Date().toISOString(),
      },
      null,
      2,
    )
    void writeFile(file, payload, 'utf8').catch(() => {})
  } catch {
    // 启动标记失败不影响插件。
  }
  logSafe(logger, 'info', `[${PLUGIN_NAME}] host 半体已就绪 v${VERSION}`)
}

/** 安全日志：logger 可能不存在、也可能在测试里是桩。 */
function logSafe(logger, level, message) {
  try {
    const method = logger?.[level]
    if (typeof method === 'function') method.call(logger, message)
    else if (level === 'warn' && typeof console?.warn === 'function') console.warn(message)
  } catch {
    // 日志失败不影响业务。
  }
}

/** 错误描述（用于日志，不含敏感信息）。 */
function describeError(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  const message = typeof error.message === 'string' ? error.message : String(error)
  return message.slice(0, 500)
}
