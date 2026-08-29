// 同步所有 @deepseek-ai/dsh-* devDependencies 到 DSH 的 next 发布通道
// 用法：node scripts/sync-dsh-deps.mjs
// DSH 采用锁步发版，所有 dsh-* 包的 next dist-tag 指向同一版本

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const pkgPath = resolve(root, 'package.json')

// 1. 查询 next dist-tag 的目标版本（以 dsh-agent 为锚点）
let targetVersion
try {
  targetVersion = execSync(
    'npm view @deepseek-ai/dsh-agent@next version',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
  ).trim()
} catch {
  console.error('[sync-dsh] 无法查询 @deepseek-ai/dsh-agent@next，请检查网络或 registry')
  process.exit(1)
}

if (!targetVersion) {
  console.error('[sync-dsh] 未获取到目标版本')
  process.exit(1)
}

console.log(`[sync-dsh] DSH next 目标版本: ${targetVersion}`)

// 2. 读取 package.json
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

// 3. 更新所有 @deepseek-ai/dsh-* devDependencies（排除 cordis，它不属于 dsh-* 族）
const newVersion = `^${targetVersion}`
let updated = 0
const skipped = []

for (const [name, currentVersion] of Object.entries(pkg.devDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) {
    if (currentVersion !== newVersion) {
      console.log(`[sync-dsh]   ${name}: ${currentVersion} → ${newVersion}`)
      pkg.devDependencies[name] = newVersion
      updated++
    }
  }
}

// 4. 写回
if (updated > 0) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`[sync-dsh] 已更新 ${updated} 个包`)
  console.log('[sync-dsh] 请运行 npm install 或 pnpm install 安装新版本')
} else {
  console.log('[sync-dsh] 已是最新，无需更新')
}