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
  constructor(ctx: Context, store: RuleStore, globalDir?: string)
  boot(): Promise<void>
  refresh(cwd?: string): Promise<void>
  renderFromCache(cwd?: string): string
  reload(): Promise<void>
  watch(): void
}
```

#### `constructor(ctx, store, globalDir?)`

| 参数 | 类型 | 说明 |
|:--|:--|:--|
| `ctx` | `Context` | cordis 上下文（监听 `agent/created`、`agent/disposed`，注册 effect） |
| `store` | `RuleStore` | 规则文件读写 |
| `globalDir` | `string \| undefined` | 全局规则目录（装配入口注入，与 store 同源）；省略时 `watch()` 回退 `globalRulesDir()` |

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

#### ~~`currentProjectCwd()`~~（0.1.8 已删除）

原「最近创建的活跃 agent 的 cwd」这一对「当前对话」的近似被移除（调查报告-001）：agent 注册表没有「当前对话」概念——
切回 live 会话不重新 `announce`，该量必然偏离当前会话。0.1.8 起 cwd 由 client 经官方判据
`retainedBy.mainView > 0` 解析（见 06），host 不再猜测；`activeAgents` 仅保留作 `reload()` 的注入目标。

#### `reload()`

变更收敛（异步）：刷新全局 + 所有已知项目 cwd 的缓存；与重算前快照**逐 key 对比合成文本，新旧一致则只刷缓存、跳过注入**，有变化才对活动 agent 调 `agent.inject()` 推送「规则已更新」。

- 防重入：`reloadPending` 标志，重入直接返回。
- **新旧对比**：快照为重算前缓存（`cache`）的浅拷贝；任一 key（全局 + 各已知 cwd）的合成文本与快照不同即视为有变化。key 缺失（首次建缓存/启动竞态）保守视为有变化，防漏提醒。
- 触达场景：touch 文件、重写相同内容、UI 保存未改内容、watch 与 UI 双通道重复 reload 等合成文本不变的批次不再注入；规则内容真变（含归档删除使合成文本变短）仍注入。
- `agent.inject` 不唤醒驱动（running 时最近 pre-step 认领，idle 挂起到下次唤醒）。

#### `watch()`

装配文件监听与会话生命周期钩子：

- `watch` 全局规则目录（取 `this.globalDir ?? globalRulesDir()`，消除 watcher 与 store 目录不同源的缺口）；`agent/created` 时记录该 agent 的 cwd、`watch` 其项目目录、并异步 `refresh(cwd)`（新对话预填项目规则缓存）。
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
- **cwd 解析**在装配入口内联为 `assembleCtx.agent?.session.header.cwd ?? process.cwd()`；全局目录同源处理：在装配入口解析后注入（优先宿主服务 `dshHomePath`，见 05）。
- 文件监听仅监听平铺目录；Windows `fs.watch` 非递归、事件可能合并/丢失，极端情况由下次 `refresh` 重扫兜底。