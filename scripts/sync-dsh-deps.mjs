// 同步所有 @deepseek-ai/dsh-* devDependencies 到 DSH 的 next 发布通道，
// 同时更新 peerDependencies 的版本下限，确保 web 与 tui 两模式一致。
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
const newCaret = `^${targetVersion}`
let updated = 0

for (const [name, currentVersion] of Object.entries(pkg.devDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) {
    if (currentVersion !== newCaret) {
      console.log(`[sync-dsh]   devDep  ${name}: ${currentVersion} → ${newCaret}`)
      pkg.devDependencies[name] = newCaret
      updated++
    }
  }
}

// 4. 同步 peerDependencies 版本下限（保持上限不变）
//    peer 范围格式为 ">=X.Y.Z-rc.N <M"，提取上限部分后替换下限
if (pkg.peerDependencies) {
  const newLower = `>=${targetVersion}`

  for (const [name, currentRange] of Object.entries(pkg.peerDependencies)) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue

    const upperMatch = currentRange.match(/<[^<]*$/)
    if (!upperMatch) {
      console.warn(`[sync-dsh]   跳过 peer  ${name}: 无法解析上限 "${currentRange}"`)
      continue
    }

    const newRange = `${newLower} ${upperMatch[0]}`
    if (currentRange !== newRange) {
      console.log(`[sync-dsh]   peer    ${name}: ${currentRange} → ${newRange}`)
      pkg.peerDependencies[name] = newRange
      updated++
    }
  }
}

// 5. 写回
if (updated > 0) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`[sync-dsh] 已更新 ${updated} 个包`)
  console.log('[sync-dsh] 请运行 npm install 或 pnpm install 安装新版本')
} else {
  console.log('[sync-dsh] 已是最新，无需更新')
}