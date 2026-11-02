/**
 * 只读校验：确认 dsh-git-graph-view 已按官方 bundle 插件形态正确装进 profile，
 * 以便重启前发现明显问题。不写任何文件、不 spawn 子进程。
 *
 * 用法：node scripts/validate-install.mjs [profileDir]
 * 默认 profileDir = $DSH_HOME/profiles/desktop（未设置时 ~/.dsh/profiles/desktop）
 */

import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const PLUGIN = 'dsh-git-graph-view'
const ROUTE_PREFIX = '/git-graph-view'
const profileDir = process.argv[2]
  ?? (process.env.DSH_HOME
    ? join(process.env.DSH_HOME, 'profiles', 'desktop')
    : join(homedir(), '.dsh', 'profiles', 'desktop'))

const problems = []
const notes = []
const ok = (message) => notes.push('✅ ' + message)
const bad = (message) => problems.push('❌ ' + message)

/** 读 JSON，失败返回 null。 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// 1) profile 清单
const profilePkg = readJson(join(profileDir, 'package.json'))
if (profilePkg === null) {
  bad('无法读取 profile package.json：' + join(profileDir, 'package.json'))
} else {
  const dep = profilePkg.dependencies?.[PLUGIN]
  if (typeof dep === 'string' && dep.length > 0) ok('profile 依赖存在：' + dep)
  else bad('profile dependencies 缺少 ' + PLUGIN)

  const bundles = Array.isArray(profilePkg.dsh?.profile?.bundles) ? profilePkg.dsh.profile.bundles : []
  if (bundles.includes(PLUGIN)) ok('dsh.profile.bundles 包含 ' + PLUGIN)
  else bad('dsh.profile.bundles 缺少 ' + PLUGIN + '（bundle 层不会加载）')
}

// 2) 安装目录
const moduleDir = join(profileDir, 'node_modules', PLUGIN)
if (!existsSync(moduleDir)) {
  bad('node_modules 里没有 ' + PLUGIN)
} else {
  const pkg = readJson(join(moduleDir, 'package.json'))
  if (pkg === null) bad('node_modules 里的 package.json 无法解析')
  else {
    if (pkg.name === PLUGIN) ok('包名正确：' + pkg.name + '@' + pkg.version)
    else bad('包名不匹配：' + String(pkg.name))
    if (pkg.type === 'module') ok('type: module')
    else bad('package.json 缺少 "type": "module"')
    if (typeof pkg.main === 'string' && existsSync(join(moduleDir, pkg.main))) ok('main 入口存在：' + pkg.main)
    else bad('main 入口不存在：' + String(pkg.main))
    const clientExport = pkg.exports?.['./client']
    if (typeof clientExport === 'string' && existsSync(join(moduleDir, clientExport))) ok('client 入口存在：' + clientExport)
    else bad('exports["./client"] 缺失或文件不存在')
    if (pkg.dsh?.bundle?.patch === './cordis.patch.yml' && existsSync(join(moduleDir, 'cordis.patch.yml'))) {
      ok('dsh.bundle.patch 声明与文件都存在')
    } else {
      bad('dsh.bundle.patch 声明或 cordis.patch.yml 文件缺失')
    }
    if (pkg.dsh?.client?.platform === 'web') ok('dsh.client.platform = web')
    else bad('dsh.client.platform 必须是 "web"')
  }
  if (existsSync(join(moduleDir, 'lib', 'index.js'))) ok('lib/index.js 存在')
  else bad('lib/index.js 缺失')
  if (existsSync(join(moduleDir, 'lib', 'client.js'))) ok('lib/client.js 存在')
  else bad('lib/client.js 缺失')
}

// 3) cordis.patch.yml 语法 + 行
try {
  const requireFromProfile = createRequire(join(profileDir, 'package.json'))
  const yaml = requireFromProfile('js-yaml')
  const patchPath = join(moduleDir, 'cordis.patch.yml')
  const parsed = yaml.load(readFileSync(patchPath, 'utf8'))
  if (!Array.isArray(parsed)) {
    bad('cordis.patch.yml 顶层不是数组')
  } else {
    const inserts = parsed.flatMap((entry) => (Array.isArray(entry?.insert) ? entry.insert : []))
    const row = inserts.find((item) => item?.id === PLUGIN || item?.name === PLUGIN)
    if (row) ok('cordis.patch.yml 合法，包含 insert 行：' + JSON.stringify(row))
    else bad('cordis.patch.yml 没有 id/name = ' + PLUGIN + ' 的 insert 行')
  }
} catch (error) {
  bad('cordis.patch.yml 解析失败：' + String(error?.message ?? error))
}

// 4) client bundle 形态
try {
  const source = readFileSync(join(moduleDir, 'lib', 'client.js'), 'utf8')
  if (source.includes('window.__ModuleLoader__.load')) ok('client.js 使用 window.__ModuleLoader__.load')
  else bad('client.js 未使用 window.__ModuleLoader__.load')
  if (source.includes(`id: '${PLUGIN}'`)) ok('client 模块 id 正确')
  else bad('client.js 的 loader id 不是 ' + PLUGIN)
  if (!/^\s*(import|export)\s/m.test(source)) ok('client.js 无 ESM import/export（可直接作为 classic script 加载）')
  else bad('client.js 含有 ESM import/export，loader 无法作为 classic script 执行')
} catch (error) {
  bad('读取 client.js 失败：' + String(error?.message ?? error))
}

// 5) 路由前缀唯一性（与已安装插件不冲突的静态提示）
const routeRoots = [ROUTE_PREFIX, '/git', '/sidebar', '/api', '/plugin-installer']
const routeOwner = new Map([
  ['/git', '@linxin666/dsh-client-ui-git-graph'],
  ['/sidebar', 'dsh-better-sidebar'],
  ['/api', 'dsh-client-connection / api gateway'],
])
if (routeOwner.has(ROUTE_PREFIX)) bad('路由前缀与已知插件冲突：' + ROUTE_PREFIX)
else ok('路由前缀独占：' + ROUTE_PREFIX + '（已知前缀：' + routeRoots.join(' ') + '）')

// 输出
console.log('== dsh-git-graph-view 安装校验 ==')
console.log('profile: ' + profileDir)
console.log('')
for (const note of notes) console.log(note)
for (const problem of problems) console.log(problem)
console.log('')
if (problems.length === 0) {
  console.log('结果：通过（' + notes.length + ' 项）')
  process.exit(0)
} else {
  console.log('结果：失败（' + problems.length + ' 项）')
  process.exit(1)
}
