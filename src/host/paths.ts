// 规则目录与规则级别的通用解析（RuleStore / RuleInjector 复用）。
import os from 'node:os'
import path from 'node:path'

/** 规则级别：全局 或 项目 */
export type RuleLevel = 'global' | 'project'

/**
 * DSH home 目录：$DSH_HOME（trim 后非空）优先，否则 ~/.dsh。
 * 与 dsh 官方 resolveDshHome 的前两档语义一致；其最高档 configured 由装配层消费宿主服务
 * dshHomePath 时覆盖（见 index.ts 的 resolveGlobalRulesDir）。
 * 官方对 DSH_HOME 的 trim 仅用于判空、返回值不 trim；此处主动 trim，避免带空格的取值拼出畸形路径。
 */
function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  const home = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : path.join(os.homedir(), '.dsh')
  return path.resolve(home)
}

/** 默认全局规则目录：<DSH home>/rules（宿主提供 dshHomePath 服务时由装配层优先使用，见 index.ts） */
export function globalRulesDir(): string {
  return path.join(dshHome(), 'rules')
}

/** 项目规则目录：<cwd>/.dsh/rules；无 cwd 时返回 undefined */
export function projectRulesDir(cwd?: string): string | undefined {
  if (!cwd) return undefined
  return path.join(cwd, '.dsh', 'rules')
}