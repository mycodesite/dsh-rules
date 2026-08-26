// RulesService：Connection 通用 RPC 通道的规则 CRUD 桥（UI↔host）。规则不进 dsh settings。
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { transportError, type RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RuleLevel } from './paths.ts'
import type { RuleStore } from './store.ts'
import type { RuleInjector } from './injector.ts'

export class RulesService {
  constructor(
    private readonly store: RuleStore,
    private readonly injector: RuleInjector,
  ) {}

  /** ConnectionRpcHandler：按 endpoint 分发；写操作成功后刷新注入 */
  readonly dispatch: ConnectionRpcHandler = async (endpoint, payload) => {
    try {
      const value = await this.invoke(endpoint, payload)
      if (endpoint !== 'list' && endpoint !== 'reload') void this.injector.reload()
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
      case 'list': {
        const level = assertLevel(p.level)
        const cwd = asString(p.cwd)
        return this.store.list(level, cwd)
      }
      case 'create': {
        const level = assertLevel(p.level)
        const cwd = asString(p.cwd)
        const content = asString(p.content) ?? ''
        return this.store.save(level, newId(), content, cwd)
      }
      case 'save': {
        const level = assertLevel(p.level)
        const cwd = asString(p.cwd)
        const id = asString(p.id) ?? ''
        if (!id) throw new Error('缺少规则 id')
        const content = asString(p.content) ?? ''
        return this.store.save(level, id, content, cwd)
      }
      case 'remove': {
        const level = assertLevel(p.level)
        const cwd = asString(p.cwd)
        const id = asString(p.id) ?? ''
        if (!id) throw new Error('缺少规则 id')
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