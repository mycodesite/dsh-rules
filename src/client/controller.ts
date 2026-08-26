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

  constructor(private readonly rpc: RuleRpc) {}

  getSnapshot = (): RuleListState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async load(level: RuleLevel): Promise<void> {
    this.setState({ status: 'loading' })
    const res = await this.rpc.call('list', { level })
    if (res.ok) this.setState({ status: 'ready', rows: res.value as Rule[] })
    else this.setState({ status: 'error', error: res.error.message })
  }

  async reload(level: RuleLevel): Promise<void> {
    await this.rpc.call('reload', {})
    await this.load(level)
  }

  async create(level: RuleLevel, content: string): Promise<boolean> {
    const res = await this.rpc.call('create', { level, content })
    if (res.ok) await this.load(level)
    return res.ok
  }

  async save(level: RuleLevel, id: string, content: string): Promise<boolean> {
    const res = await this.rpc.call('save', { level, id, content })
    if (res.ok) await this.load(level)
    return res.ok
  }

  async remove(level: RuleLevel, id: string): Promise<boolean> {
    const res = await this.rpc.call('remove', { level, id })
    if (res.ok) await this.load(level)
    return res.ok
  }

  private setState(next: RuleListState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}