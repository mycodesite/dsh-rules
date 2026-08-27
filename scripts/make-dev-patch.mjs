// 生成开发态 dsh 补丁：cordis.local.yml
// dsh 的 --patch overlay 需要宿主入口的绝对路径；为保证仓库可移植（不写死本机路径），
// 由本脚本在本地生成绝对路径补丁，生成文件不提交（见 .gitignore）。
//
// 用法：
//   node scripts/make-dev-patch.mjs
//   dsh web --patch ./cordis.local.yml        # 或 dsh --profile tui --patch ./cordis.local.yml
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const entry = resolve(root, 'src/host/index.ts').replaceAll('\\', '/')

const content = `# 开发态 overlay：按源文件绝对路径挂载 host 插件（无需安装）。
# ⚠️ 本文件由 scripts/make-dev-patch.mjs 自动生成，请勿手工编辑、请勿提交。
# 用法：dsh web --patch ./cordis.local.yml   /   dsh --profile tui --patch ./cordis.local.yml
- insert:
    - id: rulebase
      name: '${entry}'
`

writeFileSync(resolve(root, 'cordis.local.yml'), content, 'utf8')
console.log(`已生成 cordis.local.yml → ${entry}`)