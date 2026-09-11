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

> **注册时序（插件支持线 dsh ≥0.1.5-rc.1）**：0.1.5 起 `connection` 服务先于 `webServer` 可用（client-connection 启动依赖 `['webServer']`→`['credentials']`），而 `rpc.handle` 内部会立即向 `owner.webServer` 注册物理路由——host 半必须以 `ctx.inject(['connection', 'webServer'], ...)` **双依赖延迟注册**（`src/host/index.ts`），否则 `owner.webServer` 未定义 → TypeError → 通道静默丢失（详见 `.trae/documents/调查报告：dsh升级0.1.5后规则界面加载与保存失败-001`）。
> **鉴权（0.1.5+）**：per-channel `authority` 选项已废弃；鉴权由传输层统一接管——BrowserAuth（进程 token + `dsh-auth-*` cookie，未认证 401）+ Host/Origin fence（403）。本机 loopback 访问不受影响。

- 按 `endpoint` 分发到 `invoke`；写操作（`create`/`save`/`remove`）成功后调用 `injector.reload()`（`list`/`reload` 除外）。
- 业务异常折叠进 `RpcResult` 信封（`transportError`，code `'internal'`）；业务值包成 `{ ok: true, value }`。

## RPC 端点

| endpoint | 入参（payload） | 业务返回值 | 说明 |
|:--|:--|:--|:--|
| `currentCwd` | — | `{ cwd: string \| null }` | 当前项目 cwd（`injector.currentProjectCwd()`；未选项目为 `null`）。读操作，不触发注入刷新 |
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
- **cwd 解析（`resolveCwd`/`requireProjectCwd`）**：项目级读写以「client 传入 cwd 优先，缺省用 `injector.currentProjectCwd()`」解析真实项目路径；`create`/`save` 在项目级无有效 cwd 时抛「未选定项目」错误；`list` 无 cwd 返回 `[]`；`remove` 无 cwd 幂等跳过。