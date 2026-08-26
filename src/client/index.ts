// dsh 客户端入口：注册 rulebase 设置面板（settings.section 槽）。
// 运行时由 dsh client-modules 以 __ModuleLoader__.load 方式加载。
// 为保持打包简单，本文件不 import @deepseek-ai client 运行时包，仅用最小结构类型；
// 服务（slots/connection）经 cordis 注入获得。
import type { ComponentType } from 'react'
import { RuleController, type RuleRpc } from './controller.ts'
import { RuleSection, type RuleSectionProps } from './RuleSection.tsx'
import type { RpcResult } from './types.ts'

export const name = 'rulebase'
export const inject = ['slots', 'connection']

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
}

export function apply(ctx: RuleBaseClientContext): void {
  // 绑定 channel，把 connection.rpc.call 收敛成 controller 需要的两参面
  const ruleRpc: RuleRpc = {
    call: (endpoint, payload) => ctx.connection.rpc.call('/rulebase', endpoint, payload),
  }
  const controller = new RuleController(ruleRpc)

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'rulebase',
      order: 30,
      label: () => '规则',
      inject: () => ({ controller }),
    },
    RuleSection,
  ))
}