# 04-桥接模块 RulesService（`src/host/service.ts`）

UI↔host 之间的「文件管理桥」：经 Connection 通用 RPC 通道（channel `/rulebase`）暴露规则 CRUD。规则不进 dsh settings。

## 导出

### 类 `RulesService`

```ts
class RulesService {
  constructor(store: RuleStore, injector: RuleInjector)
  readonly dispatch: ConnectionRpcHandler
}
```

#### `constructor(store, injector)`

| 参数 | 类型 | 说明 |
|:--|:--|:--|
| `store` | `RuleStore` | 规则文件读写 |
| `injector` | `RuleInjector` | 写操作后的注入刷新 |

#### `dispatch`

`ConnectionRpcHandler` 实例（`(endpoint, payload, signal) => Promise<RpcResult<unknown>>`），随 `ctx.connection.rpc.handle('/rulebase', ...)` 注册。

- 按 `endpoint` 分发到 `invoke`；写操作（`create`/`save`/`remove`）成功后调用 `injector.reload()`（`list`/`reload` 除外）。
- 业务异常折叠进 `RpcResult` 信封（`transportError`，code `'internal'`）；业务值包成 `{ ok: true, value }`。

## RPC 端点

| endpoint | 入参（payload） | 业务返回值 | 说明 |
|:--|:--|:--|:--|
| `list` | `{ level, cwd? }` | `Rule[]` | 列某级规则 |
| `create` | `{ level, content }` | `Rule` | 新建规则（host 生成 id） |
| `save` | `{ level, id, content }` | `Rule` | 保存（新建或覆盖） |
| `remove` | `{ level, id }` | `void` | 删除 |
| `reload` | — | `{ count: number }` | 显式重载并刷新注入（`count` 为全局规则数） |

> **信封约定**：上表「业务返回值」为 `RpcResult` 信封内的 `value`。client 端 `rpc.call` 得到 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`，须先判 `ok` 再取 `.value`。

## 内部函数

| 函数 | 说明 |
|:--|:--|
| `assertLevel(v)` | 校验 `v ∈ {'global','project'}`，否则抛错 |
| `asString(v)` | 非空字符串 → 原值，否则 `undefined` |
| `newId()` | 生成新规则 id：`rule-<Date.now().toString(36)>` |

## 设计要点

- `RulesService` 是普通对象，无需 Cordis Service 或 `@Remote` 标记（Connection RPC 与 Typert Remote 无关）。
- 端点只承载对 md 文件的增删改查，不承载规则的「dsh 注册」——规则内容自始至终只在磁盘文件。