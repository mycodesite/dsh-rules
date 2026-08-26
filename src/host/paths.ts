// 规则目录与规则级别的通用解析（RuleStore / RuleInjector 复用）。
import os from 'node:os'
import path from 'node:path'

/** 规则级别：全局 或 项目 */
export type RuleLevel = 'global' | 'project'

/** 默认全局规则目录：~/.dsh/rules */
export function globalRulesDir(): string {
  return path.join(os.homedir(), '.dsh', 'rules')
}

/** 项目规则目录：<cwd>/.dsh/rules；无 cwd 时返回 undefined */
export function projectRulesDir(cwd?: string): string | undefined {
  if (!cwd) return undefined
  return path.join(cwd, '.dsh', 'rules')
}