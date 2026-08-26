# 06-client 类型与控制器（`src/client/types.ts`、`src/client/controller.ts`）

client 半的最小类型定义与列表状态机 / rpc 客户端。

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

`connection.rpc.call` 的结构切片（channel 已绑定为 `/rulebase`）。

### 类 `RuleController`

```ts
class RuleController {
  constructor(rpc: RuleRpc)
  getSnapshot(): RuleListState
  subscribe(listener: () => void): () => void
  load(level: RuleLevel): Promise<void>
  reload(level: RuleLevel): Promise<void>
  create(level: RuleLevel, content: string): Promise<boolean>
  save(level: RuleLevel, id: string, content: string): Promise<boolean>
  remove(level: RuleLevel, id: string): Promise<boolean>
}
```

#### `getSnapshot` / `subscribe`

标准 external store 接口，供 React `useSyncExternalStore` 使用。`getSnapshot` 返回当前状态的稳定引用（仅在 `setState` 时替换）。

#### `load(level)`

调用 `list` 端点，置 `loading` → `ready`（`rows`）或 `error`。

#### `reload(level)`

先调 `reload` 端点（触发 host 重载注入），再 `load(level)`。

#### `create(level, content)` / `save(level, id, content)` / `remove(level, id)`

对应写端点；成功（`res.ok`）后 `load(level)` 刷新列表；返回 `boolean` 表示是否成功。

## 设计要点

- 控制器无 React 依赖，纯逻辑可单测。
- 状态为「当前级别」的列表快照，编辑态/删除确认等交互态由 UI 组件（07）内部管理，不进入控制器。