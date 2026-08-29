// 发布辅助脚本：类型检查 → 单测 → 构建 → 产出最小化 tarball → 打印安装指引。
//
// 用法：
//   node scripts/release.mjs
//
// 产物：rulebase-<version>.tgz（仅含 package.json files 白名单：lib/、cordis.patch.yml、
// README.md、CHANGELOG.md，以及 npm 自动纳入的 LICENSE 与 package.json）。
import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('npm', ['run', 'typecheck'])
run('npm', ['test'])
run('npm', ['run', 'build'])
run('npm', ['pack'])

console.log(`
✅ 发布包已产出（最小化 tarball）。
安装到 dsh profile 的方式：

  1) 本地产物安装
     dsh plugin add <绝对路径>/rulebase-<version>.tgz

  2) 从 GitHub 直装（仓库公开后）
     dsh plugin add github:mycodesite/dsh-rules
     # 或指定版本：dsh plugin add github:mycodesite/dsh-rules#v0.1.0
     # 仓库含预构建产物（lib/），git 源安装无需放行构建脚本。

  3) 开发态挂载
     node scripts/make-dev-patch.mjs && dsh web --patch ./cordis.local.yml
`)