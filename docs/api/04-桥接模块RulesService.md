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

`ConnectionRpcHandler` 实例（`(endpoint, payload, signal) => Promise<RpcResult<unknown>>`），经 `connection.fetch.register` 注册为 **`/api` 共享通道上的五条精确路由**（v0.1.4 起，`src/host/index.ts`；v0.1.8 移除 `currentCwd`）：

```ts
ctx.inject(['connection'], (c) => {
  for (const op of ['list', 'create', 'save', 'remove', 'reload'] as const) {
    c.connection.fetch.register({
      path: `/api/rulebase/${op}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => bridgeRpc(request, op, service.dispatch), // src/host/bridge.ts 本地信封桥
    })
  }
})
```

> **注册范式（插件支持线 dsh ≥0.1.5-rc.1）与由来**：0.1.5 的架构不变量是 **webServer 仅 client-connection 自身可触碰，/api 层消费者一律经 `connection`**（首方先例：api-session-controller / client-file-upload / ui-deliverables / session-log-export）。`rpc.handle` 内部会立即向 `owner.webServer` 注册物理路由，而 profile 插件 fiber 对 `webServer` **不可达**（cordis inject 对未就绪服务合法无限期 pending、静默无报错）——v0.1.3 的「双依赖延迟注册」因此实测无效（详见调查报告/分析报告-001）。`fetch.register` 内部仅 `fetchRoutes.set`（owner.effect 失配自动清理，插件卸载对称），零 webServer 触碰；`/api` 共享 handler **先查 fetchRoutes 精确表再查 interceptor**，与 api-gateway 无冲突——这也是不能用 `rpc.intercept('/api')` 的原因（每 channel 仅一个 interceptor，api-gateway 已独占，二次注册 fail-loud）。
> **鉴权**：由传输层统一接管——`/api` 物理路由入口先 `requestRejection`（BrowserAuth 401 + Host/Origin fence 403）再进共享 handler，精确路由自动继承；per-channel `authority` 选项（0.1.1-rc.2）已废弃。
> **信封桥语义（`src/host/bridge.ts`，宿主 rpcFetchHandler 的本地最小复刻，零宿主运行时导入）**：415（content-type 非 JSON）/ 400（body 非 JSON）/ 信封校验失败与方法不匹配 → 200 信封 `gateway/bad-request`（rpcId echo，缺失回退 `'invalid-request'`）；业务结果（含 `ok:false`）→ 200 信封 `server-response` 透传。**有意差异**：handler 抛错返回 200 ok:false `rulebase/bridge-error` 而非宿主的 HTTP 500——client 对非 2xx 会 throw，200 信封走 `controller.callSafe` 折叠，失败全程可见。信封校验为 `clientRequestSchema` 的最小手工复刻（type/rpcId/method 覆盖一致，rpcId 仅查 string 类型，格式校验裁剪）。

- 按 `endpoint` 分发到 `invoke`；写操作（`create`/`save`/`remove`）成功后调用 `injector.reload()`（`list`/`reload` 除外）。
- 业务异常折叠进 `RpcResult` 信封（`transportError`，code `'internal'`）；业务值包成 `{ ok: true, value }`。

## RPC 端点

| endpoint | 入参（payload） | 业务返回值 | 说明 |
|:--|:--|:--|:--|
| `list` | `{ level, cwd? }` | `Rule[]` | 列某级规则 |
| `create` | `{ level, content }` | `Rule` | 新建规则（host 生成 id） |
| `save` | `{ level, id, content }` | `Rule` | 保存（新建或覆盖） |
| `remove` | `{ level, id }` | `void` | 删除；仅目标文件不存在（ENOENT）幂等返回，其余错误以 200 ok:false 错误信封返回（同 save 失败路径） |
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
- **cwd 解析（`resolveCwd`/`requireProjectCwd`，0.1.8 起）**：项目级读写**仅采用 client 传入 cwd**（client 经官方判据 `retainedBy.mainView > 0` 解析，见 06）；host 不再以「最后注册 agent」猜测（0.1.8 移除 `injector.currentProjectCwd()`，见调查报告-001）。`create`/`save`/`remove` 在项目级无有效 cwd 时抛「未选定项目」错误（报错文案按动作名词参数生成：保存/删除）；`list` 无 cwd 返回 `[]`（面板显示「未选定项目」提示）。