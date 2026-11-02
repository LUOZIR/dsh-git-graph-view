/**
 * 测试入口：逐个 import `test/*.test.mjs`，让 node:test 在同一进程内运行全部用例。
 *
 * 不直接使用 `node --test test/`：它会为每个测试文件再 spawn 一个子进程，
 * 在受限沙箱/无管道权限的环境里会因 `spawn EPERM` 失败。这里用同进程 import，
 * 既能在沙箱里跑，也能在普通环境跑；需要标准 test runner 时仍可用
 * `node --test test/`。
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = import.meta.dirname
const files = (await readdir(directory))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()

if (files.length === 0) {
  console.error('test/run.mjs: 没有找到 *.test.mjs')
  process.exitCode = 1
} else {
  for (const file of files) {
    await import(pathToFileURL(join(directory, file)).href)
  }
}
