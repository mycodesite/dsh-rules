// RuleController：规则列表状态机 + rpc 客户端（无 React 依赖，便于单测）。
import type { RpcResult, Rule, RuleLevel } from './types.ts'

type Listener = () => void

export type RuleListState =
  | { status: 'loading' }
  | { status: 'ready'; rows: Rule[] }
  | { status: 'error'; error: string }

/** rpc 客户端最小面（connection.rpc.call 的结构切片，channel 已绑定） */
export interface RuleRpc {
  call(endpoint: string, payload?: unknown): Promise<RpcResult<unknown>>
}

export class RuleController {
  private state: RuleListState = { status: 'loading' }
  private readonly listeners = new Set<Listener>()

  private readonly rpc: RuleRpc
  /** 可选：前端解析当前对话 cwd（仅 project 级 RPC 携带）；未注入时 payload 形状不变（向后兼容） */
  private readonly resolveCwd?: () => string | undefined
  constructor(rpc: RuleRpc, resolveCwd?: () => string | undefined) {
    this.rpc = rpc
    this.resolveCwd = resolveCwd
  }

  getSnapshot = (): RuleListState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private lastError: string | null = null

  /** 唯一 RPC 出口：reject 折叠为 ok:false（RpcError 契约 code 必填），方法永不 reject；失败写入 lastError，成功清空 */
  private async callSafe(endpoint: string, payload: unknown): Promise<RpcResult<unknown>> {
    try {
      const res = await this.rpc.call(endpoint, payload)
      this.lastError = res.ok ? null : res.error.message
      return res
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.lastError = message
      return { ok: false as const, error: { code: 'rulebase/transport-error', message } }
    }
  }

  /** 最近一次失败信息（成功即清空）；UI 在操作返回 false 时读取呈现 */
  getLastError(): string | null {
    return this.lastError
  }

  /** cwd 仅 project 级且非空时携带（level 感知）；global 级恒不带，host 对 global 从不消费 cwd */
  private cwdPayload(level: RuleLevel): { cwd?: string } {
    const cwd = level === 'project' ? this.resolveCwd?.() : undefined
    return cwd ? { cwd } : {}
  }

  async load(level: RuleLevel): Promise<void> {
    this.setState({ status: 'loading' })
    const res = await this.callSafe('list', { level, ...this.cwdPayload(level) })
    if (res.ok) this.setState({ status: 'ready', rows: res.value as Rule[] })
    else this.setState({ status: 'error', error: res.error.message })
  }

  /** 当前项目 cwd；本地（当前对话 session.cwd）优先，无值才走 RPC（host 端点作回退）；未选定项目时返回 null */
  async currentCwd(): Promise<string | null> {
    const local = this.resolveCwd?.()
    if (local) return local
    const res = await this.callSafe('currentCwd', {})
    if (!res.ok) return null
    const value = res.value as { cwd: string | null } | undefined
    return value?.cwd ?? null
  }

  async reload(level: RuleLevel): Promise<void> {
    await this.callSafe('reload', {})
    await this.load(level)
  }

  async create(level: RuleLevel, content: string): Promise<boolean> {
    const res = await this.callSafe('create', { level, content, ...this.cwdPayload(level) })
    if (res.ok) await this.load(level)
    return res.ok
  }

  async save(level: RuleLevel, id: string, content: string): Promise<boolean> {
    const res = await this.callSafe('save', { level, id, content, ...this.cwdPayload(level) })
    if (res.ok) await this.load(level)
    return res.ok
  }

  async remove(level: RuleLevel, id: string): Promise<boolean> {
    const res = await this.callSafe('remove', { level, id, ...this.cwdPayload(level) })
    if (res.ok) await this.load(level)
    return res.ok
  }

  private setState(next: RuleListState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}