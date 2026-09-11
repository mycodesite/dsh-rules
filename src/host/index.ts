// dsh 插件 host 入口：装配 RuleStore、RuleInjector、RulesService。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import { RuleStore } from './store.ts'
import { GUIDANCE, RuleInjector } from './injector.ts'
import { RulesService } from './service.ts'
import { bridgeRpc } from './bridge.ts'

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

  // Connection /api 精确路由：UI↔host 的规则文件管理桥（0.1.5+ 范式，详见分析报告-001 §二）。
  // 仅依赖 connection（对插件 fiber 可达，旧代码 inject 触发已证）；fetch.register 内部仅
  // fetchRoutes.set（owner.effect 失配自动清理，dsh-client-connection lib:594-600），零 webServer 触碰；
  // /api 共享 handler 先查 fetchRoutes 再查 interceptor（:576-584），与 api-gateway（interceptor）无冲突。
  ctx.inject(['connection'], (c) => {
    for (const op of ['list', 'create', 'save', 'remove', 'reload', 'currentCwd'] as const) {
      c.connection.fetch.register({
        path: `/api/rulebase/${op}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => bridgeRpc(request, op, service.dispatch),
      })
    }
  })

  injector.watch()
}