// RuleStore：规则 md 文件的读写与全量扫描。
// 规则不注册 dsh settings，唯一事实源是磁盘上的 md 文件（全局 ~/.dsh/rules、项目 <cwd>/.dsh/rules）。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RuleLevel } from './paths.ts'
import { globalRulesDir, projectRulesDir } from './paths.ts'

const MD_EXT = '.md'

/** 合成结果总量上限（字节），防单文件极大或文件数异常导致提示词暴涨。 */
export const MAX_TOTAL_BYTES = 256 * 1024

/** 单条规则（md 文件在内存中的投影） */
export interface Rule {
  /** 稳定 id：由文件名（去扩展名）而来，作为跨层唯一键 */
  id: string
  /** 规则标题：md 首个 H1/首行，无则用 id */
  title: string
  /** 规则正文：md 文件完整内容 */
  content: string
  /** 所属级别 */
  level: RuleLevel
  /** 文件绝对路径 */
  filePath: string
}

/** 统一换行为 \n */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 从正文提取标题：首个 H1 或首行，无则用 id */
function titleOf(id: string, content: string): string {
  const first = content.trimStart().split('\n', 1)[0]?.trim() ?? ''
  if (first.startsWith('# ')) return first.slice(2).trim() || id
  if (first.startsWith('#')) return first.slice(1).trim() || id
  return first.length > 0 ? first.slice(0, 120) : id
}

/** 原子写：临时文件 + rename，避免注入读到半写内容 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, filePath)
}

export class RuleStore {
  /** 可覆盖全局目录（测试用，缺省用 ~/.dsh/rules） */
  private readonly globalDir: string | undefined

  constructor(globalDir?: string) {
    this.globalDir = globalDir
  }

  private dirOf(level: RuleLevel, cwd?: string): string | undefined {
    return level === 'global' ? (this.globalDir ?? globalRulesDir()) : projectRulesDir(cwd ?? process.cwd())
  }

  /** 全量扫描某级规则目录的 *.md */
  async list(level: RuleLevel, cwd?: string): Promise<Rule[]> {
    const dir = this.dirOf(level, cwd)
    if (!dir) return []
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return [] // 目录不存在 → 空
    }
    const rules: Rule[] = []
    for (const name of entries) {
      if (!name.endsWith(MD_EXT)) continue
      const filePath = path.join(dir, name)
      // 安全读取：只读规则目录内平铺文件，不跟随软链接逃逸目录
      let st
      try {
        st = await fs.lstat(filePath)
      } catch {
        continue
      }
      if (!st.isFile() || st.isSymbolicLink()) continue
      const content = normalize(await fs.readFile(filePath, 'utf8'))
      const id = name.slice(0, -MD_EXT.length)
      rules.push({ id, title: titleOf(id, content), content, level, filePath })
    }
    rules.sort((a, b) => a.id.localeCompare(b.id))
    return rules
  }

  /** 保存（新建或覆盖）某级规则，返回其投影 */
  async save(level: RuleLevel, id: string, content: string, cwd?: string): Promise<Rule> {
    const dir = this.dirOf(level, cwd)
    if (!dir) throw new Error('无法解析规则目录（项目规则缺少 cwd）')
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${id}.md`)
    const normalized = normalize(content)
    await atomicWrite(filePath, normalized)
    return { id, title: titleOf(id, normalized), content: normalized, level, filePath }
  }

  /** 删除某级规则（不存在则幂等） */
  async remove(level: RuleLevel, id: string, cwd?: string): Promise<void> {
    const dir = this.dirOf(level, cwd)
    if (!dir) return
    try {
      await fs.rm(path.join(dir, `${id}.md`))
    } catch {
      // 不存在 → 幂等
    }
  }
}