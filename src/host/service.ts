// RulesService：Connection 通用 RPC 通道的规则 CRUD 桥（UI↔host）。规则不进 dsh settings。
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { transportError } from './contract.ts'
import type { RuleLevel } from './paths.ts'
import type { RuleStore } from './store.ts'
import type { RuleInjector } from './injector.ts'

export class RulesService {
  private readonly store: RuleStore
  private readonly injector: RuleInjector

  constructor(store: RuleStore, injector: RuleInjector) {
    this.store = store
    this.injector = injector
  }

  /** ConnectionRpcHandler：按 endpoint 分发；写操作成功后刷新注入 */
  readonly dispatch: ConnectionRpcHandler = async (endpoint, payload) => {
    try {
      const value = await this.invoke(endpoint, payload)
      if (endpoint !== 'list' && endpoint !== 'reload' && endpoint !== 'currentCwd') void this.injector.reload()
      return this.ok(value)
    } catch (err) {
      return transportError(err)
    }
  }

  private ok<T>(value: T): RpcResult<T> {
    return { ok: true, value }
  }

  private async invoke(endpoint: string, payload: unknown): Promise<unknown> {
    const p = (payload ?? {}) as Record<string, unknown>
    switch (endpoint) {
      case 'currentCwd': {
        return { cwd: this.injector.currentProjectCwd() ?? null }
      }
      case 'list': {
        const level = assertLevel(p.level)
        const cwd = this.resolveCwd(level, asString(p.cwd))
        if (level === 'project' && !cwd) return []
        return this.store.list(level, cwd)
      }
      case 'create': {
        const level = assertLevel(p.level)
        const cwd = level === 'project' ? this.requireProjectCwd(asString(p.cwd)) : undefined
        const content = asString(p.content) ?? ''
        return this.store.save(level, newId(), content, cwd)
      }
      case 'save': {
        const level = assertLevel(p.level)
        const id = asString(p.id) ?? ''
        if (!id) throw new Error('缺少规则 id')
        const cwd = level === 'project' ? this.requireProjectCwd(asString(p.cwd)) : undefined
        const content = asString(p.content) ?? ''
        return this.store.save(level, id, content, cwd)
      }
      case 'remove': {
        const level = assertLevel(p.level)
        const id = asString(p.id) ?? ''
        if (!id) throw new Error('缺少规则 id')
        const cwd = this.resolveCwd(level, asString(p.cwd))
        if (level === 'project' && !cwd) return undefined
        await this.store.remove(level, id, cwd)
        return undefined
      }
      case 'reload': {
        await this.injector.reload()
        const global = await this.store.list('global')
        return { count: global.length }
      }
      default:
        throw new Error(`未知端点：${String(endpoint)}`)
    }
  }

  /** 项目级解析真实 cwd：client 传入优先，缺省用当前项目；全局级返回 undefined */
  private resolveCwd(level: RuleLevel, cwd?: string): string | undefined {
    return level === 'project' ? (cwd ?? this.injector.currentProjectCwd()) : undefined
  }

  /** 项目级写操作：解析真实 cwd，无则抛错提示先选定项目（调用方保证 level === 'project'） */
  private requireProjectCwd(cwd?: string): string {
    const resolved = cwd ?? this.injector.currentProjectCwd()
    if (!resolved) throw new Error('当前未选定项目，无法保存项目规则，请先选定一个项目')
    return resolved
  }
}

function assertLevel(v: unknown): RuleLevel {
  if (v === 'global' || v === 'project') return v
  throw new Error(`非法 level：${String(v)}`)
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** 生成新规则 id（时间戳 base36） */
function newId(): string {
  return `rule-${Date.now().toString(36)}`
}