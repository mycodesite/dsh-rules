# 审核报告：dsh插件-规则库-设计方案-v001

> 审核对象：`.trae/documents/设计方案：dsh插件-规则库-v001.md`（v001）
> 审核角色：架构师
> 事实源（逐一核验）：`deepseek-harness` 工程源码（`O:\工作区\deepseek-harness`）、allMemory 插件（`O:\mcpFs\dsh-plugin-build\allMemory`）、dshbase 官方插件文档（`https://www.dshbase.com/zh/plugins/`）
> 日期：2026-08-27

---

## 一、审核结论（先行）

**结论：有条件不通过（需重大修订后再审）。**

设计方案在「需求解读（R1–R9）」「分层架构」「数据模型」「存储模块」「UI 形态」五个层面方向正确，对 allMemory 的装配形态、`systemPrompt.section()` 动态 `text`、`agent.inject()`、`settings.section` slot 等机制的理解基本准确，且正确识别了「规则仅以 md 文件为事实源、不注册 dsh settings 命名空间」这一核心设计意图。

但存在 **两项 P0 级技术性错误**，直接动摇方案的技术可行性，必须在进入实现前修订：

- **P0-1**：host↔client 桥接机制选型错误。方案 §2.5/§8 依赖 **Typert Remote RPC** 自建 `rulebase/list|create|save|remove` 端点，声称 host 注册一个 `typertRemote` Service、client 经 `ctx.connection` 的 `api` 以 `namespace/method` 调用。**这在第三方插件场景下不可行**——Typert Remote 的 client 侧能力由构建期生成的 `/remote` 产物 + `api-remotes` 组合显式挂载，第三方插件无法在运行时让 client 发现/挂载自定义 Remote（详见 §四）。
- **P0-2**：注入 `text` provider 的**同步语义约束**未被处理。`systemPrompt.section()` / `context()` 的 `text` 签名是严格同步的 `(context: AssembleContext) => string`，不能返回 `Promise`。而方案核心依赖「每次 assemble 异步扫描 + 读取全部 md 文件」，两者矛盾（详见 §四）。

另有 P1/P2 级问题（cwd 回退链引用了不存在的 service 键、`agent.inject()` 语义需精确化等）一并列于 §五。

---

## 二、审核范围与方法

以架构师视角对方案逐条核验其引用的 dsh 机制是否真实、准确、可用，而非仅做文字校对。方法：

1. 通读方案全文，抽出所有「技术断言」（引用了某个 dsh API 或扩展点的句子），共 14 项。
2. 对 `deepseek-harness` 逐项定位到源码（`packages/**/src` 与 `docs/**`），核对签名、语义、约束。
3. 将 allMemory 作为「已落地的第三方插件」参照系，核对方案与它的对照陈述是否属实。
4. 以 dshbase 官方文档核对插件装配与打包形态的通用背景。

---

## 三、机制核验结果

### 3.1 属实（方案引用正确，可采信）

| # | 方案断言 | 核验结果 |
|:--|:--|:--|
| 1 | `ctx.inject(['systemPrompt'])` 后经 `scope.systemPrompt.section()` 贡献有序提示词段 | 属实。见 [system-prompt/index.ts](file:///O:/工作区/deepseek-harness/packages/core/system-prompt/src/index.ts) `section()`，段按 `order` 升序拼接 |
| 2 | 段名唯一、重复注册报错 | 属实。`NamedEntries.insert` 对重名抛错（同上） |
| 3 | `order` 约定：`-100` 身份、`0` persona、`100–199` 工具引导 | 属实。见 `PromptSection.order` 注释与常量 `PERSONA_ORDER=0` |
| 4 | `PromptSection.text` 可为函数、每次 assemble 求值，支持 `{{variable}}` 插值 | 属实（签名含同步约束，见 P0-2） |
| 5 | `AssembleContext` 被 dsh-agent 扩展出可选 `agent` 字段 | 属实。见 [runtime-types.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/runtime-types.ts#L16-L21) 的 `declare module '@deepseek-ai/dsh-system-prompt'` |
| 6 | `assembleContextFor(agent, signal)` 存在并被 agent-loop 使用 | 属实。见 [agent.ts](file:///O:/工作区/deepseek-harness/packages/core/agent-loop/src/agent.ts) `assemble(assembleContextFor(this, signal))` |
| 7 | `agent.session.header.cwd` 是拿项目根的权威来源 | 属实。见 [agent-instructions/index.ts](file:///O:/工作区/deepseek-harness/packages/context/agent-instructions/src/index.ts#L124-L125) `const cwd = agent.session.header.cwd ?? process.cwd()` |
| 8 | `agent.inject(message: UserMessage)` 是公开接口 | 属实。见 [runtime-types.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/runtime-types.ts#L143) |
| 9 | `agent.inbox.replace(prevId, desired)` 存在 | 属实。见 agent-instructions `syncInbox` 中的 `agent.inbox.replace(replaced.id, desired)` |
| 10 | `settings.section` slot 存在，`id/order/label` 供导航 | 属实。见 [slots.ts](file:///O:/工作区/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts#L53) |
| 11 | 插件装配形态：host 半 + client 半，`dsh.bundle.patch` + `dsh.client.{platform,inject}` | 属实。与 allMemory [package.json](file:///O:/mcpFs/dsh-plugin-build/allMemory/package.json) 一致 |
| 12 | `ctx.agents` 存在、可枚举活动 agent | 属实。见 [agent/index.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/index.ts) `AgentRegistry.list()` |
| 13 | 开发态用 `cordis.yml` 的 `insert` 按绝对路径挂载 host 入口 | 属实。与 allMemory [cordis.yml](file:///O:/mcpFs/dsh-plugin-build/allMemory/cordis.yml) 一致 |

### 3.2 需修正（引用有误或表述不准确）

| # | 方案断言 | 核验结果 |
|:--|:--|:--|
| 14 | §6.2 `activeCwd` 回退链第二条 `ctx.get('workspaces')` | dsh 无 `workspaces` 此 service 键。实际是 `ctx.workspaceRegistry`（`WorkspaceRegistry`），且它不提供「当前会话 cwd」，只管理持久化 workspace 记录。cwd 唯一权威仍是 `agent.session.header.cwd`（见 P1） |
| 15 | §2.5/§8 Typert Remote RPC 可用于第三方插件 host↔client 桥 | 见 P0-1，机制理解方向错误 |

---

## 四、关键问题（P0）

### P0-1：host↔client 桥接应改用 Connection 通用 RPC 通道，而非 Typert Remote

方案 §8 的 `RulesService` 与 §2.5 的桥接设计，误把「Typert Remote」（`@Remote`/`typertRemote` 标记 + 生成 `/remote` 产物 + `ctx.remote.$mount()`）当作第三方插件可用的 host↔client 数据桥。核验到的事实：

- [api-remotes README.zh.md](file:///O:/工作区/deepseek-harness/packages/api/remotes/README.zh.md) 明确：「能力集合由构建时显式导入的值固定确定；**Client 不会在运行时发现 Host 中已启用的服务或 Remote 定义**。若要增加能力，必须显式导入相应的 `/remote` 值并在此组合中挂载」。
- [gateway README.zh.md](file:///O:/工作区/deepseek-harness/packages/api/gateway/README.zh.md) 明确：「**Client 侧只能挂载严格模式生成的贡献项**。SRC 标记不具备 Client 编解码器或类型投影」。
- `$on` 转发的 `API_REMOTE_FORWARDED_EVENTS` 也是构建期固定白名单。

也就是说，Typert Remote 的 client 侧挂载面是「构建期生成的严格产物」，由 `api-remotes` 组合显式 import 后 `$mount()`，属于仓库内第一方 BFF；一个独立安装的第三方插件（如 RuleBase、allMemory）无法在运行时让 client 发现并调用它自定义的 `rulebase/*` Remote 端点。方案 §8 的「host 注册 typertRemote Service → client 经 `connection.api` 以 `namespace/method` 调用」这条链路在第三方插件场景下走不通。

**可用的正确通道**：`@deepseek-ai/dsh-client-connection` 提供的**通用逻辑 RPC 通道**，与 Typert 无关：

- Host 侧：`ctx.connection.rpc.handle('/rulebase', handler, { authority: 'loopback' })` 注册一个 `/api` 之外的独立 channel（见 [rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts)`HostConnectionRpc.handle`；`assertChannel` 仅拒绝 `/api` 与非法 channel 名，见 [rpc-host.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc-host.ts#L220-L223)）。
- Client 侧：`ctx.connection.rpc.call('/rulebase', 'list', payload)` 调用（见 [rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts)`ClientConnectionRpc.call`，及 [client/rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/client/rpc.ts)）。

这是 host/client 双侧均公开、不依赖构建期生成的机制。方案 §2.5、§8、§10「桥接 = Typert Remote RPC」的表述应整体改写为「Connection 通用 RPC 通道（`connection.rpc.handle`/`connection.rpc.call`）」，`RulesService` 的方法不需要 `@Remote` 标记，改用 `ConnectionRpcHandler(endpoint, payload, signal)` 分发。

旁证：allMemory 之所以能持久化设置面板数据，并未使用 Typert Remote，而是走 settings 命名空间（host `ctx.settings.register` + client `ctx.settingsScope.bind`），settings 的读写经内建 apiProxy 的 `settings.update/mutate` 等 RPC（见 [gateway/index.ts](file:///O:/工作区/deepseek-harness/packages/api/gateway/src/index.ts) 的 `PRIVILEGED_METHODS` 与 [settings-scope.ts](file:///O:/工作区/deepseek-harness/packages/client/ui-settings/src/client/settings-scope.ts)）。这进一步佐证：第三方插件真正可用的 host↔client 数据桥只有两类——① settings 命名空间（会写入 settings.yaml）② Connection 通用 RPC 通道（不写 settings.yaml）。方案要「不污染 settings.yaml」，就必须走 ②，而方案却错误地指向了 Typert Remote。

### P0-2：动态 `text` provider 是同步签名，不能做异步文件扫描

方案 §6（注入模块核心）依赖「每次组装时在 `text` 函数内主动扫描并读取全局+项目规则目录全部 md 文件，返回全量合成文本」。但：

- `PromptSection.text` 的签名是 `string | ((context: AssembleContext) => string)`（见 [system-prompt/index.ts](file:///O:/工作区/deepseek-harness/packages/core/system-prompt/src/index.ts#L67)）。
- 组装时是同步调用：`text: typeof section.text === 'function' ? section.text(context) : section.text`（同文件 L514），没有 `await`，返回值直接进 `: string` 位。若 `injector.render()` 是 async，返回的是 `Promise`，会被字符串化为 `[object Promise]` 注入提示词。

`context()` 的 `text` 同样是 `(context) => string` 同步签名，故 §6.4 提到的「改 `context()`」也不解决该问题。

这意味着两种可行落地，方案须明确选其一并落到骨架代码：

- **方案 A（推荐）**：host 侧维护规则缓存（启动时 + `reload()`/watcher 时用异步 fs 读取并缓存合成后的字符串），`section()` 的 `text` 函数只做同步读缓存拼接（`() => injector.renderFromCache()`）。文件读写在异步路径，assemble 热路径零 IO。
- **方案 B**：在 `text` 内使用同步 `fs.readdirSync`/`fs.readFileSync`，因规则文件极小可接受，但会阻塞事件循环，且每次模型步进都触发。仅当规则量极小且可容忍时列在风险里。

方案当前 §6.2 的骨架 `text: (assembleCtx) => injector.render(activeCwd(assembleCtx))` 未标明 `render` 是同步读缓存还是同步读盘，存在「实现到一半发现必须重构」的高风险。

---

## 五、其他问题（P1 / P2）

### P1-1：cwd 回退链引用了不存在的 service 键

§6.2 `activeCwd` 优先级第 2 条写 `ctx.get('workspaces')`。核验：dsh 的 workspace 服务键是 `ctx.workspaceRegistry`（见 [workspace/index.ts](file:///O:/工作区/deepseek-harness/packages/workspace/workspace/src/index.ts#L67-L71)），不存在 `workspaces`；且 `WorkspaceRegistry` 管理的是持久化 workspace 记录与 session 归组，不提供「当前会话 cwd」。

建议：回退链删去这一条，直接 `agent.session.header.cwd ?? process.cwd()` 两级即可。若确需第二级，以 `process.cwd()` 兜底（与 agent-instructions 同源）。

### P1-2：`agent.inject()` 是「不唤醒驱动」的 next-step 注入，即变即用表述需收敛

`runtime-types.ts` 对 `inject` 的语义是「Queue model-facing context for the next pre-step without waking the driver；idle drivers leave it pending until follow-up or steering wakes them」。因此：

- 方案 §6.3「把变更即时推进当前对话」应精确为「最迟下一步生效；若当前 agent idle，则挂起到下一次 followup/steer」。
- 「即变即用」的强承诺应改为：隐式刷新（下次 assemble 全量重算）保证语义正确；显式 `agent.inject()` 仅当 agent 处于 running（有下一步 pre-step）时能「立即」被认领。方案的 §12 与验证项 #5 需据此收口，避免验收时误判。

### P2-1：`settings.section` owner props 对齐

`settings.section` 的 owner props 是 `SettingsSectionOwnerProps = { close: () => void }`（见 slots.ts），不包含数据。allMemory 通过注册时 `inject: () => ({ scope })` 把自持的 `settingsScope` 注入组件（见 allMemory [client/index.ts](file:///O:/mcpFs/dsh-plugin-build/allMemory/src/client/index.ts)）。RuleBase 不走 settingsScope，其 `RuleSection` 的 props 只有 `{ close }`，数据/状态全在自建的 store/controller 内。方案 §7.1 的注册骨架应显式写清 `inject` 返回什么、组件 props 为何，避免与 allMemory 的 settingsScope 模式混淆。

### P2-2：`fs.watch` 在 Windows 上的可靠性

§6.3 用 `fs.watch` 监听两个规则目录。核验背景：`fs.watch` 在 Windows 上基于 ReadDirectoryChangesW，监听目录本身可捕获目录内增删，但不递归、事件可能合并/丢失、`filename` 可能为 null。建议：监听两目录（非递归，规则文件是平铺的，可接受）+ 事件防抖，并在文档层注明「极端情况下由隐式刷新（下次 assemble 重扫）兜底」。亦可考虑对不常变场景加低频轮询。

### P2-3：规则文件的「安全读取」未提及路径溢出

`render` 需在合成时对每个规则文件给出文件名标题分隔（§6.2 提到 `<rule-basefile>`）。补充建议：合成结果应做总量上限（字节数）截断，避免单文件极大或文件数量异常导致提示词暴涨；并在 `list` 侧校验 `*.md` 只会命中规则目录内的平铺文件，不跟随软链接逃逸出规则目录。

---

## 六、修正建议汇总

1. 改桥接机制：§2.5、§8、§10 中「Typert Remote RPC」整体改为「Connection 通用 RPC 通道」，用 `ctx.connection.rpc.handle('/rulebase', ...)`（host）+ `ctx.connection.rpc.call('/rulebase', ...)`（client），`RulesService` 用 `ConnectionRpcHandler(endpoint,payload,signal)` 分发，删除 `@Remote`/`typertRemote`/`ctx.remote.$on` 相关表述。
2. 明确注入同步约束：§6.2 采用「异步读盘缓存 + `text` 同步读缓存」，骨架代码把 `render` 改成同步 `renderFromCache()`；§6.4 中「改 context()」备注更正（context 同样同步，不能缓解此约束）。
3. 修正 cwd 回退链：删除 `ctx.get('workspaces')`，用 `agent.session.header.cwd ?? process.cwd()`。
4. 收敛即变即用语义：§6.3 与验证项 #5 按 `inject` 不唤醒驱动的语义重写预期。
5. 补齐健壮性：§5 增加缓存上限截断与软链接防护；§12 补 Windows `fs.watch` 限制条目。

---

## 七、放行意见

需求边界、分层、数据模型、存储设计、UI 结构均可接受；两处 P0 修订完成后即可进入实现。修订重点集中在 §2.5、§6、§8 三节与 §10 决策表「桥接」行，其余章节无需大改。

建议修订后升级为 v002 复审。
