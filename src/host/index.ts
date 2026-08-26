// dsh 插件 host 入口：装配 RuleStore、RuleInjector、RulesService。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import { RuleStore } from './store.ts'
import { GUIDANCE, RuleInjector } from './injector.ts'
import { RulesService } from './service.ts'

// 自定义注入来源：扩展 MessageSourceMap（merge-extensible，见 dsh-llm message.ts）
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    rulebase: { kind: 'rulebase-update' }
  }
}

export const name = 'rulebase'
export const inject: string[] = []

export function apply(ctx: Context): void {
  const store = new RuleStore()
  const injector = new RuleInjector(ctx, store)
  const service = new RulesService(store, injector)

  // 稳定引导段（静态，order 160）+ 动态规则正文（同步读缓存，order 170）
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({ name: 'rulebase:guidance', order: 160, text: GUIDANCE })
    // 规则正文段在缓存就绪后才注册，避免启动首步缺规则的竞态（P2-5）
    void injector.boot().then(() => {
      scope.systemPrompt.section({
        name: 'rulebase:rules',
        order: 170,
        text: (assembleCtx) =>
          injector.renderFromCache(assembleCtx.agent?.session.header.cwd ?? process.cwd()),
      })
    })
  })

  // Connection 通用 RPC：UI↔host 的规则文件管理桥（loopback）
  ctx.inject(['connection'], (c) => {
    c.connection.rpc.handle('/rulebase', service.dispatch, { authority: 'loopback' })
  })

  injector.watch()
}