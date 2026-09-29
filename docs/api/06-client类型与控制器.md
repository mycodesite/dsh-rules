# 06-client 类型与控制器（`src/client/types.ts`、`src/client/sessions.ts`、`src/client/controller.ts`）

client 半的最小类型定义与列表状态机 / rpc 客户端。

## 〇、`sessions.ts`（0.1.8 新增）

sessions.list 快照的最小消费面与官方「当前主视图会话」判据（纯类型 + 纯函数，无 React 依赖，可单测）。

### 接口 `SessionRow`

```ts
interface SessionRow {
  id: string
  cwd?: string
  retainedBy?: { mainView?: number }
}
```

### 接口 `SessionsListProvider`

```ts
interface SessionsListProvider {
  getSnapshot(): { byId: Record<string, SessionRow | undefined> }
  subscribe(listener: () => void): () => void
}
```

### 函数 `mainViewSession(snapshot)`

```ts
function mainViewSession(snapshot: { byId: Record<string, SessionRow | undefined> }): SessionRow | undefined
```

dsh 官方「当前主视图会话」判据：`retainedBy.mainView > 0`（workspace / open-in-app / agent-preset / session
四处六处同源）。0.1.6 曾误读不存在的 `sessions.list.current` 字段（调查报告-001 根因①），0.1.8 起统一经本函数取值；
`RuleSection` 的「当前会话」依赖与 `RuleController` 的 `resolveCwd` 均以它为单一事实源。

## 一、`types.ts`

client 侧最小类型，不 import 任何 `@deepseek-ai/*` 包（保持 bundle 纯净、纯 JSON 结构，与 host 侧同名类型结构一致）。

### 类型 `RuleLevel`

```ts
type RuleLevel = 'global' | 'project'
```

### 接口 `Rule`

```ts
interface Rule {
  id: string
  title: string
  content: string
  level: RuleLevel
  filePath: string
}
```

### 接口 `RpcError`

```ts
interface RpcError {
  code: string
  message: string
  details?: unknown
}
```

### 类型 `RpcResult`

```ts
type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: RpcError }
```

RPC 返回信封；client 端须先判 `ok` 再取 `.value`。

## 二、`controller.ts`

### 类型 `RuleListState`

```ts
type RuleListState =
  | { status: 'loading' }
  | { status: 'ready'; rows: Rule[] }
  | { status: 'error'; error: string }
```

### 接口 `RuleRpc`

```ts
interface RuleRpc {
  call(endpoint: string, payload?: unknown): Promise<RpcResult<unknown>>
}
```

`connection.rpc.call` 的结构切片（v0.1.4 起 channel 绑定为 `/api`、endpoint 带 `rulebase/` 前缀，经宿主 `/api/rulebase/<op>` 精确路由承载）。

### 类 `RuleController`

```ts
class RuleController {
  constructor(rpc: RuleRpc, resolveCwd?: () => string | undefined)
  getSnapshot(): RuleListState
  subscribe(listener: () => void): () => void
  load(level: RuleLevel): Promise<void>
  currentCwd(): Promise<string | null>
  reload(level: RuleLevel): Promise<void>
  create(level: RuleLevel, content: string): Promise<boolean>
  save(level: RuleLevel, id: string, content: string): Promise<boolean>
  remove(level: RuleLevel, id: string): Promise<boolean>
  getLastError(): string | null
}
```

#### `getSnapshot` / `subscribe`

标准 external store 接口，供 React `useSyncExternalStore` 使用。`getSnapshot` 返回当前状态的稳定引用（仅在 `setState` 时替换）。

#### `load(level)`

调用 `list` 端点，置 `loading` → `ready`（`rows`）或 `error`。

#### `currentCwd()`

返回 `Promise<string | null>`：本地解析（构造注入的 `resolveCwd`，即官方主视图会话的 cwd）；无主视图会话（未选定项目）
返回 `null`。0.1.8 起**不发任何 RPC**——host 无法回答「当前对话」，`currentCwd` 端点已移除（调查报告-001）。
供「项目规则」保存前校验与项目 tab 的「未选定项目」提示使用。

#### `reload(level)`

先调 `reload` 端点（触发 host 重载注入），再 `load(level)`；`reload` 端点失败不中断，由随后 `load` 的 error 态呈现。

#### `create(level, content)` / `save(level, id, content)` / `remove(level, id)`

对应写端点；成功（`res.ok`）后 `load(level)` 刷新列表；返回 `boolean` 表示是否成功。

#### 错误折叠契约（0.1.3+）

`load`/`reload`/`create`/`save`/`remove` 五个 RPC 方法经私有 `callSafe` 出口调用（`currentCwd` 为纯本地解析、不经 RPC），**永不 reject**：传输层异常折叠为 `{ ok: false, error: { code: 'rulebase/transport-error', message } }`（`RpcError.code` 契约必填）；业务失败（`ok:false`）原样透传。失败信息写入 `lastError`，成功即清空；`getLastError()` 供 UI 在操作返回 `false` 时读取呈现（见 07）。背景：0.1.5 浏览器端 `rpc.call` 对非 2xx 直接 throw，无折叠时 UI 将永停 pending（"加载中…/保存中…"）。

## 设计要点

- 控制器无 React 依赖，纯逻辑可单测。
- 状态为「当前级别」的列表快照，编辑态/删除确认等交互态由 UI 组件（07）内部管理，不进入控制器。