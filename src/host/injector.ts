// RuleInjector：规则注入与刷新。异步读盘合成字符串缓存，systemPrompt 段 text 同步读缓存。
import { watch, type FSWatcher } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { globalRulesDir, projectRulesDir } from './paths.ts'
import { MAX_TOTAL_BYTES, type Rule, type RuleStore } from './store.ts'

/** 稳定引导段：静态文本，保 KV Cache 前缀稳定 */
export const GUIDANCE = `## 规则库（RuleBase）

本环境由 DSH 插件 rulebase 注入“规则”。下方【全局规则】/【项目规则】是当前生效的约束，请在对话与执行中严格遵守。`

/** 全局缓存键（无 cwd 时） */
const GLOBAL_KEY = '__global__'

/** 合成全局+项目规则全文，超出总量则截断 */
function renderRules(global: Rule[], project: Rule[], cwd?: string): string {
  const parts: string[] = []
  if (global.length > 0) parts.push('### 全局规则', ...global.map(ruleBlock))
  if (project.length > 0) {
    parts.push(`### 项目规则${cwd ? `（cwd：${cwd}）` : ''}`, ...project.map(ruleBlock))
  }
  if (parts.length === 0) return ''
  let text = parts.join('\n\n')
  if (Buffer.byteLength(text, 'utf8') > MAX_TOTAL_BYTES) {
    const cut = Buffer.from(text, 'utf8').subarray(0, MAX_TOTAL_BYTES).toString('utf8')
    text = `${cut}\n\n> …（规则总量超限，已截断）`
  }
  return text
}

function ruleBlock(rule: Rule): string {
  const heading = rule.title && rule.title !== rule.id ? rule.title : rule.id
  return `#### ${heading}\n\n${rule.content}`
}

export class RuleInjector {
  /** 合成字符串缓存：key = cwd（或 GLOBAL_KEY），value = 全量合成结果 */
  private readonly cache = new Map<string, string>()
  /** 活动 agent → cwd（供显式刷新） */
  private readonly activeAgents = new Map<Agent, string>()
  /** 见过的项目 cwd（reload 重算覆盖） */
  private readonly knownCwds = new Set<string>()
  private readonly watchers = new Map<string, FSWatcher>()
  private reloadPending = false
  private debounceTimer: NodeJS.Timeout | undefined

  private readonly ctx: Context
  private readonly store: RuleStore

  constructor(ctx: Context, store: RuleStore) {
    this.ctx = ctx
    this.store = store
  }

  /** 启动：预加载全局规则缓存 */
  async boot(): Promise<void> {
    await this.refresh()
  }

  /** 异步读盘 + 合成 + 写缓存（cwd 为空 = 仅全局） */
  async refresh(cwd?: string): Promise<void> {
    const global = await this.store.list('global')
    await this.renderToCache(global, cwd)
  }

  /** 用已读的全局规则合成并写缓存（复用全局，避免重复读盘） */
  private async renderToCache(global: Rule[], cwd?: string): Promise<void> {
    const project = cwd ? await this.store.list('project', cwd) : []
    this.cache.set(cwd ?? GLOBAL_KEY, renderRules(global, project, cwd))
  }

  /** 同步读缓存（供 systemPrompt 段 text 使用；未命中回退全局） */
  renderFromCache(cwd?: string): string {
    return this.cache.get(cwd ?? GLOBAL_KEY) ?? this.cache.get(GLOBAL_KEY) ?? ''
  }

  /** 当前项目 cwd：最近创建的活跃 agent 的 cwd；无活跃 agent 或无 cwd 返回 undefined */
  currentProjectCwd(): string | undefined {
    const values = [...this.activeAgents.values()]
    for (let i = values.length - 1; i >= 0; i--) {
      // 仅非空字符串视为有效 cwd（activeAgents 可能存入 ''，见 watch 的 cwd ?? ''）
      if (typeof values[i] === 'string' && values[i] !== '') return values[i]
    }
    return undefined
  }

  /** 变更收敛：异步重算缓存 + 显式 agent.inject（不唤醒驱动） */
  async reload(): Promise<void> {
    if (this.reloadPending) return
    this.reloadPending = true
    try {
      const global = await this.store.list('global') // 全局只读一次
      await this.renderToCache(global)
      for (const cwd of this.knownCwds) await this.renderToCache(global, cwd) // 仅读项目，复用全局
      for (const agent of this.activeAgents.keys()) {
        try {
          agent.inject(createUserMessage({
            content: [{ type: 'text', text: '[规则已更新] 请按最新规则库继续。' }],
            source: { kind: 'rulebase-update' },
          }))
        } catch (err) {
          console.warn('rulebase: agent.inject 失败', err)
        }
      }
    } finally {
      this.reloadPending = false
    }
  }

  /** 装配文件监听与会话生命周期钩子 */
  watch(): void {
    this.watchDir(globalRulesDir())
    this.ctx.on('agent/created', (payload) => {
      const agent = payload.agent
      const cwd = agent.session.header.cwd
      this.activeAgents.set(agent, cwd ?? '')
      if (cwd) {
        this.knownCwds.add(cwd)
        this.watchDir(projectRulesDir(cwd))
        void this.refresh(cwd)
      }
    })
    this.ctx.on('agent/disposed', (payload) => {
      this.activeAgents.delete(payload.agent)
    })
    this.ctx.effect(() => {
      return () => {
        clearTimeout(this.debounceTimer)
        this.debounceTimer = undefined
        for (const w of this.watchers.values()) w.close()
        this.watchers.clear()
      }
    }, 'rulebase.watchers')
  }

  private watchDir(dir: string | undefined): void {
    if (!dir || this.watchers.has(dir)) return
    try {
      const w = watch(dir, () => this.debounceReload())
      this.watchers.set(dir, w)
    } catch {
      // 目录不存在；后续 save 会 mkdir，且极端情况由下次 assemble 重扫兜底
    }
  }

  private debounceReload(): void {
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.reload()
    }, 150)
    this.debounceTimer.unref?.()
  }
}