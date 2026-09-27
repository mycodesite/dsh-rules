// dsh 客户端入口：注册 rulebase 设置面板（settings.section 槽）。
// 运行时由 dsh client-modules 以 __ModuleLoader__.load 方式加载。
// 为保持打包简单，本文件不 import @deepseek-ai client 运行时包，仅用最小结构类型；
// 服务（slots/connection/sessions）经 cordis 注入获得。
import type { ComponentType } from 'react'
import { RuleController, type RuleRpc } from './controller.ts'
import { RuleSection, type RuleSectionProps } from './RuleSection.tsx'
import type { RpcResult } from './types.ts'

export const name = 'rulebase'
export const inject = ['slots', 'connection', 'sessions']

/** sessions.list 的最小快照面（不引入运行时依赖，仅类型声明） */
export interface SessionsListProvider {
  getSnapshot(): { current: string | undefined; byId: Record<string, { cwd?: string } | undefined> }
  subscribe(listener: () => void): () => void
}

/** 最小 ClientContext（运行时由 dsh client 框架注入） */
export interface RuleBaseClientContext {
  slots: {
    inject(slot: string, register: () => unknown): void
    register(spec: Record<string, unknown>, component: ComponentType<RuleSectionProps>): unknown
  }
  connection: {
    rpc: {
      call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResult<unknown>>
    }
  }
  sessions: {
    list: SessionsListProvider
  }
}

export function apply(ctx: RuleBaseClientContext): void {
  // 绑定 channel，把 connection.rpc.call 收敛成 controller 需要的两参面。
  // 0.1.5+：宿主已废弃独立前缀 channel，规则端点经共享 /api 精确路由（host 半 fetch.register 六条
  // /api/rulebase/<op>）承载，endpoint 带 rulebase/ 前缀（详见 docs/api/04）。
  const ruleRpc: RuleRpc = {
    call: (endpoint, payload) => ctx.connection.rpc.call('/api', `rulebase/${endpoint}`, payload),
  }
  // 当前对话 cwd：取 sessions.list 快照的当前 session（session.header.cwd 快照），不依赖 agent 创建时序
  const sessions = ctx.sessions
  const resolveSessionCwd = (): string | undefined => {
    const s = sessions.list.getSnapshot()
    return s.current === undefined ? undefined : s.byId[s.current]?.cwd
  }
  const controller = new RuleController(ruleRpc, resolveSessionCwd)

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'rulebase',
      order: 30,
      label: () => '规则',
      inject: () => ({ controller, sessionsList: sessions.list }),
    },
    RuleSection,
  ))
}