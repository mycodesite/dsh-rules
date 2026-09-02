// 构建产物守卫：host 产物不得保留任何 @deepseek-ai/* 的运行时导入。
// 任何一条裸导入都会让 link: 安装的插件在 dsh 启动期 MODULE_NOT_FOUND，
// 且宿主 fail-loud（无软失败通道）⇒ 整机不可用。见《解决方案-002》§3。
//
// 生效面：串入 npm run build 后，自动覆盖
//   ① 本地/CI 的 npm run build；② npm pack 的 prepack → build。
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_ARTIFACT = resolve(root, 'lib/index.mjs')

const STATIC_IMPORT = /^\s*(?:import|export)\b[^'"\n]*['"]@deepseek-ai\//
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]@deepseek-ai\//

let source
try {
  source = readFileSync(HOST_ARTIFACT, 'utf8')
} catch {
  console.error(`[check-artifact] 找不到产物 ${HOST_ARTIFACT}，请先执行 npm run build:host`)
  process.exit(1)
}

const hits = source
  .split('\n')
  .map((text, index) => ({ line: index + 1, text: text.trim() }))
  .filter((entry) => STATIC_IMPORT.test(entry.text) || DYNAMIC_IMPORT.test(entry.text))

if (hits.length > 0) {
  console.error(`[check-artifact] ${HOST_ARTIFACT} 仍含宿主包运行时导入：`)
  for (const hit of hits) console.error(`  L${hit.line}: ${hit.text}`)
  console.error(
    '[check-artifact] 宿主包只能 import type；若确需运行时能力，' +
      '请先在《解决方案-002》§9 复核，不得直接引入值导入。'
  )
  process.exit(1)
}

console.log('[check-artifact] host 产物无宿主包运行时导入 OK')
