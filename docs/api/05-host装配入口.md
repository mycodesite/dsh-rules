# 05-host 装配入口（`src/host/index.ts`）

host 半入口：装配 `RuleStore`、`RuleInjector`、`RulesService` 三件套，注册系统提示词段与 RPC 通道。

## 导出

```ts
export const name = 'rulebase'
export const inject: string[] = []
export function apply(ctx: Context): void
```

| 导出 | 说明 |
|:--|:--|
| `name` | 插件名（小写 kebab，dsh 规定） |
| `inject` | 静态依赖服务键（空数组——本插件经 `ctx.inject` 动态获取 `systemPrompt`/`connection`） |
| `apply` | 装配入口 |

## `apply(ctx)` 行为

1. 实例化 `RuleStore`、`RuleInjector`、`RulesService`。
2. **注册提示词段**（`ctx.inject(['systemPrompt'], ...)`）：
   - `rulebase:guidance`（order 160，`text: GUIDANCE`）——静态引导段；
   - `rulebase:rules`（order 170，动态 `text`）——在 `injector.boot()` 完成后注册，`text` 内联经 `assembleCtx.agent?.session.header.cwd ?? process.cwd()` 解析 cwd 后调用 `renderFromCache`（同步读缓存）。
3. **注册 RPC 通道**（`ctx.inject(['connection'], ...)`）：`c.connection.rpc.handle('/rulebase', service.dispatch, { authority: 'loopback' })`。
4. `injector.watch()` 装配文件监听与会话钩子。

## 类型增强

```ts
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    rulebase: { kind: 'rulebase-update' }
  }
}
```

扩展 `MessageSourceMap`，使 `agent.inject` 的 `source: { kind: 'rulebase-update' }` 类型合法（merge-extensible，见 dsh-llm 的 `message.ts`）。

同时以 `import type {}` 激活以下类型增强：

| 包 | 作用 |
|:--|:--|
| `@deepseek-ai/dsh-system-prompt` | `Context.systemPrompt` 合并 |
| `@deepseek-ai/dsh-agent` | `AssembleContext.agent` 合并 |
| `@deepseek-ai/dsh-client-connection` | `Context.connection` 合并 |
| `@deepseek-ai/dsh-llm` | `MessageSourceMap` 合并（`declare module`） |

## 设计要点

- 引导段静态、规则正文段在缓存就绪后注册——规避启动首步缺失规则的竞态。
- `connection` 使用通用 RPC 通道 `handle`/`call`（非 Typert Remote，第三方插件运行时可用）。
- 依赖面最小化：`peerDependencies` 仅 cordis / system-prompt / agent / llm / client-connection / host-apiproxy。