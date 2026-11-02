/**
 * 修改 desktop profile 的 package.json：登记 dsh-git-graph-view 依赖与 bundle 行。
 *
 * 仅由 scripts/install-profile.ps1 调用，也可单独使用：
 *   node scripts/patch-profile.mjs <profileDir> <tgzFileName> [--remove]
 *
 * - 写入前备份 package.json（package.json.bak-ggv-<时间戳>）；
 * - 依赖值使用 file:vendor/<tgzFileName>，与 profile 里既有本地 tgz 插件一致；
 * - bundle 条目插到 gal-view 之后（保持“新插件靠后”的可读顺序）；
 * - --remove 反向删除依赖与 bundle 条目（不删除 node_modules 目录，由 ps1 处理）。
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PLUGIN = 'dsh-git-graph-view'
const ANCHOR = 'gal-view'

const [profileDir, tgzFileName, flag] = process.argv.slice(2)
if (!profileDir || !tgzFileName) {
  console.error('用法: node scripts/patch-profile.mjs <profileDir> <tgzFileName> [--remove]')
  process.exit(2)
}
const remove = flag === '--remove'
const pkgPath = join(profileDir, 'package.json')

const original = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(original)
if (typeof pkg !== 'object' || pkg === null) throw new Error('profile package.json 不是对象')

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `${pkgPath}.bak-ggv-${stamp}`
copyFileSync(pkgPath, backupPath)

pkg.dependencies = pkg.dependencies ?? {}
pkg.dsh = pkg.dsh ?? {}
pkg.dsh.profile = pkg.dsh.profile ?? {}
if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = []
const bundles = pkg.dsh.profile.bundles

if (remove) {
  delete pkg.dependencies[PLUGIN]
  const index = bundles.indexOf(PLUGIN)
  if (index >= 0) bundles.splice(index, 1)
  console.log('[patch-profile] 已移除依赖与 bundle 条目')
} else {
  pkg.dependencies[PLUGIN] = `file:vendor/${tgzFileName}`
  if (!bundles.includes(PLUGIN)) {
    const anchor = bundles.indexOf(ANCHOR)
    bundles.splice(anchor >= 0 ? anchor + 1 : bundles.length, 0, PLUGIN)
  }
  console.log('[patch-profile] 依赖 = ' + pkg.dependencies[PLUGIN])
  console.log('[patch-profile] bundles = ' + JSON.stringify(bundles))
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('[patch-profile] 已写入 ' + pkgPath)
console.log('[patch-profile] 备份 ' + backupPath)
