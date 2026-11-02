/**
 * HTTP 细节：有界 JSON body 读取、JSON 响应、以及只读接口的“浏览器信任闸”。
 *
 * 信任闸不是认证，而是 DNS-rebinding / 跨站 / 非本机访问的防御：
 *  - socket 对端必须是 loopback；
 *  - Host 头必须是 loopback 主机名（`localhost`、`127.x.x.x`、`[::1]`）；
 *  - `sec-fetch-site: cross-site` 一律拒绝；
 *  - 带 Origin 时主机名必须与 Host 一致（桌面壳的 `dsh-app:` 协议页单独放行，
 *    但上面已要求 socket 为 loopback）。
 * 真正的授权边界是调用方只能访问“已注册工作区”的只读 git 信息。
 */

/**
 * 读取有界 JSON 请求体。
 * @param {AsyncIterable<Buffer|string>} req - node IncomingMessage（测试可用异步可迭代对象）。
 * @param {number} maxBytes - 上限字节数。
 * @returns {Promise<unknown|null>} 解析结果；空 body、非法 JSON、超限均返回 null。
 */
export async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    if (!Buffer.isBuffer(buffer)) return null
    size += buffer.length
    if (size > maxBytes) return null
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 写出一个 JSON 响应。
 * @param {{writeHead(number, object): void, end(string): void}} res - node ServerResponse。
 * @param {number} status - HTTP 状态码。
 * @param {unknown} body - 会被 JSON.stringify 的响应体。
 * @param {object} headers - 额外/覆盖响应头。
 */
export function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  res.end(payload)
}

/** 取单个请求头字符串。 */
function header(headers, name) {
  const value = headers?.[name]
  return typeof value === 'string' ? value : undefined
}

/** 判断 socket 地址是否 loopback（兼容 IPv4-mapped IPv6）。 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false
  let value = address
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length)
  if (value === '::1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

/** 判断 URL 主机名是否 loopback。 */
export function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string' || hostname === '') return false
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

/**
 * 只读接口信任闸。
 * @param {{socket?: {remoteAddress?: string}, headers?: object}} request - node IncomingMessage 的结构子集。
 * @returns {boolean} 是否允许该请求进入插件路由。
 */
export function isTrustedRequest(request) {
  const remote = request?.socket?.remoteAddress
  // socket 缺失（单元测试/内部调用）时不做 loopback 断言；真实请求一定有。
  if (typeof remote === 'string' && remote !== '' && !isLoopbackAddress(remote)) return false

  const headers = request?.headers ?? {}
  if (header(headers, 'sec-fetch-site') === 'cross-site') return false

  const host = header(headers, 'host')
  let hostUrl
  if (host !== undefined && host !== '') {
    try {
      hostUrl = new URL('http://' + host)
    } catch {
      return false
    }
    if (!isLoopbackHostname(hostUrl.hostname)) return false
  }

  const origin = header(headers, 'origin')
  if (origin !== undefined && origin !== '') {
    if (origin === 'null') return false
    let originUrl
    try {
      originUrl = new URL(origin)
    } catch {
      return false
    }
    // 桌面壳自定义协议页面（官方 Electron 壳的 dsh-app://app）——socket 已限定 loopback。
    if (originUrl.protocol === 'dsh-app:' || originUrl.protocol === 'dsh-desktop:') return true
    if (hostUrl !== undefined) return originUrl.hostname === hostUrl.hostname
    return isLoopbackHostname(originUrl.hostname)
  }

  return true
}
