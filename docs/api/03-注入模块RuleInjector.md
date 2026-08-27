# 03-注入模块 RuleInjector（`src/host/injector.ts`）

规则注入与刷新。磁盘 IO 与缓存读取分层：异步读盘合成字符串缓存，`systemPrompt` 段的 `text` 同步读缓存（因 `PromptSection.text` 是同步签名）。

## 导出

### 常量 `GUIDANCE`

```ts
const GUIDANCE: string
```

稳定引导段（静态文本），用于 `rulebase:guidance` 段（order 160）。保持静态以稳定系统提示词前缀、利于 KV Cache 复用。

### 类 `RuleInjector`

```ts
class RuleInjector {
  constructor(ctx: Context, store: RuleStore)
  boot(): Promise<void>
  refresh(cwd?: string): Promise<void>
  renderFromCache(cwd?: string): string
  currentProjectCwd(): string | undefined
  reload(): Promise<void>
  watch(): void
}
```

#### `constructor(ctx, store)`

| 参数 | 类型 | 说明 |
|:--|:--|:--|
| `ctx` | `Context` | cordis 上下文（监听 `agent/created`、`agent/disposed`，注册 effect） |
| `store` | `RuleStore` | 规则文件读写 |

#### `boot()`

启动时预加载全局规则缓存（`await this.refresh()`）。由装配入口在注册规则正文段前调用，规避启动首步竞态。

#### `refresh(cwd?)`

异步读盘 + 合成 + 写缓存。

| 参数 | 类型 | 说明 |
|:--|:--|:--|
| `cwd` | `string \| undefined` | 项目根；省略时仅刷新全局 |

- 读全局 + 项目规则，合成「全局规则 + 项目规则」全文，写入缓存（key = cwd，全局用内部键）。
- 合成结果超出 `MAX_TOTAL_BYTES` 时按字节截断并追加提示。

#### `renderFromCache(cwd?)`

同步读缓存，返回合成字符串。供 `systemPrompt` 段 `text` 使用。

- 缓存命中 → 对应 cwd 的合成结果。
- 未命中该 cwd → 回退全局缓存；全局也空 → 返回 `''`。
- 纯同步、零 IO，保证 `text` 签名 `(context) => string`。

#### `currentProjectCwd()`

同步返回「当前项目」cwd：最近创建的活跃 agent 的 cwd；无活跃 agent 或无有效 cwd 返回 `undefined`。

- 数据来源：`watch()` 在 `agent/created` 时以 `agent.session.header.cwd` 记录到 `activeAgents`。
- **空字符串过滤**：仅非空字符串视为有效 cwd（`typeof === 'string' && !== ''`）；最近 agent 为空 cwd 时自动回退到更早的有效 agent，避免返回空路径。
- 供 `RulesService.currentCwd` 端点使用（UI 判断「是否已选定项目」）。

#### `reload()`

变更收敛（异步）：刷新全局 + 所有已知项目 cwd 的缓存，再对活动 agent 调 `agent.inject()` 推送「规则已更新」。

- 防重入：`reloadPending` 标志，重入直接返回。
- `agent.inject` 不唤醒驱动（running 时最近 pre-step 认领，idle 挂起到下次唤醒）。

#### `watch()`

装配文件监听与会话生命周期钩子：

- `watch` 全局规则目录；`agent/created` 时记录该 agent 的 cwd、`watch` 其项目目录、并异步 `refresh(cwd)`（新对话预填项目规则缓存）。
- `agent/disposed` 时移除活动 agent。
- `ctx.effect` 在插件卸载时关闭全部 watcher。
- 文件变化防抖 `150ms` 后触发 `reload()`。

## 内部函数

| 函数 | 说明 |
|:--|:--|
| `renderRules(global, project, cwd?)` | 合成「### 全局规则 / ### 项目规则」全文，超限截断 |
| `ruleBlock(rule)` | 单条规则块：`#### 标题` + 正文 |

## 设计要点

- **同步/异步边界**：`boot`/`refresh`/`reload`/watcher 为异步读盘；`renderFromCache` 为同步热路径，签名符合 `(context) => string`。
- **cwd 解析**在装配入口内联为 `assembleCtx.agent?.session.header.cwd ?? process.cwd()`。
- 文件监听仅监听平铺目录；Windows `fs.watch` 非递归、事件可能合并/丢失，极端情况由下次 `refresh` 重扫兜底。