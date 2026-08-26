# 审核报告：dsh插件-规则库-设计方案-v002

> 审核对象：`.trae/documents/设计方案：dsh插件-规则库-v001.md`（内容已针对 v001 审核意见修订，故本报告编号 v002）
> 审核角色：架构师
> 事实源（逐项核验）：`deepseek-harness` 源码（`O:\工作区\deepseek-harness`）、allMemory 插件（`O:\mcpFs\dsh-plugin-build\allMemory`）、dshbase 官方文档（`https://www.dshbase.com/zh/plugins/`）
> 前置审核：[审核报告：dsh插件-规则库-设计方案-v001.md](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/.trae/documents/审核报告：dsh插件-规则库-设计方案-v001.md)
> 日期：2026-08-27

---

## 一、审核结论（先行）

**结论：有条件通过 —— 可进入实现，落地时须落实 §四 的 5 项 P2 级问题（均为实现细节，不阻塞架构）。**

上一轮审核提出的 2 项 P0（桥接机制选型、`text` 同步约束）与全部 P1/P2 均已正确修订，且修订后的技术方案经源码核验成立。方案现已具备进入实现的条件。

---

## 二、v001 问题闭环核验

对 v001 报告的每个问题，逐条核对修订是否到位、修订后的机制在 `deepseek-harness` 中是否真实存在：

| v001 问题 | 级别 | 修订结论 | 核验依据 |
|:--|:--|:--|:--|
| 桥接机制选错 Typert Remote | P0 | ✅ 已修正 | 改为 Connection 通用 RPC：host `ctx.connection.rpc.handle('/rulebase', handler, authority)` + client `ctx.connection.rpc.call('/rulebase', endpoint, payload)`。核验 [rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts) `HostConnectionRpc.handle` 与 `ClientConnectionRpc.call`、[rpc-host.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc-host.ts#L220-L223) `assertChannel` 仅拒绝 `/api`，`/rulebase` 合法 |
| `text` 同步约束未处理 | P0 | ✅ 已修正 | 改为「异步读盘填缓存 + `section().text` 同步 `renderFromCache()`」。核验 [system-prompt/index.ts](file:///O:/工作区/deepseek-harness/packages/core/system-prompt/src/index.ts#L67) `text: string \| ((context) => string)` 同步签名、L514 同步调用无 `await` |
| cwd 回退链引用不存在的 `workspaces` | P1 | ✅ 已修正 | 改为 `agent.session.header.cwd ?? process.cwd()`。核验 dsh 无 `workspaces` service 键，仅 `ctx.workspaceRegistry`（[workspace/index.ts](file:///O:/工作区/deepseek-harness/packages/workspace/workspace/src/index.ts#L67-L71)），且 agent-instructions 同用 `header.cwd ?? process.cwd()` |
| `agent.inject()` 语义需收敛 | P1 | ✅ 已修正 | §6.3 已明确「inject 不唤醒驱动，running 时最近 pre-step 认领、idle 时挂起到下次 followup/steer」。与 [runtime-types.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/runtime-types.ts#L143) 注释一致 |
| `settings.section` owner props 对齐 | P2 | ✅ 已修正 | §7.1 已澄清 owner props 仅 `{ close }`、数据经 `inject: () => controllerFace()` 注入。与 [slots.ts](file:///O:/工作区/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts#L53) `SettingsSectionOwnerProps` 一致 |
| `fs.watch` Windows 可靠性 | P2 | ✅ 已修正 | §12 已补「非递归、事件可合并/丢失、下次 assemble 兜底」 |
| 安全读取/软链接/总量上限 | P2 | ✅ 已修正 | §5 已补「只读平铺 `*.md`、不跟随软链接、总量字节截断」 |

期间又核实到一处新修订正确性：`ctx.inject(['systemPrompt'])` 与 `ctx.inject(['connection'])` 均可作为 host 半的依赖注入键使用，与 allMemory 的 `ctx.inject(['systemPrompt'])`、`settings` 同源的 Cordis 用法一致。

---

## 三、总体评价

修订后的方案在以下维度达到可实施水平：

- **机制选型**：注入主机制（`section()` 动态 `text` 同步读缓存）与桥接机制（Connection 通用 RPC）都已落到 dsh 真实存在的扩展点上，两条 P0 一并解决。
- **同步/异步边界**：磁盘 IO 与缓存读取分层清晰（异步 `boot/reload/watcher` 填缓存 + `text` 同步读缓存），消解了 `PromptSection.text` 同步签名与文件读写的矛盾。
- **一致性语义**：「全量组装、全量替换」「即变即用」的表述已按 dsh 实际语义收敛，验证项 #5 可落地验收。
- **健壮性**：原子写、软链接防护、总量截断、Windows `fs.watch` 限制、无 push 通道兜底等均已纳入。

方案已从前一版的「方向对但两处机制不通」收敛为「机制正确、实现细节待补」。

---

## 四、剩余问题（P2 级，实现细节）

以下 5 项不阻塞架构，但应在实现阶段落实，避免返工：

### P2-1：§2.1 client 入口 `inject` 残留已弃用的 `remote` / 未用到的 `locale`

§2.1 写 client 入口 `inject` 为 `['slots','connection','remote','locale',...]`。其中 `remote`（Typert Remote 客户端）已在本方案 §2.5 明确弃用，`locale` 也未见使用。建议收敛为本次真实需要的 `['slots','connection']`（外加真实用到的服务），避免引入无需的运行时依赖与错误暗示。

### P2-2：§9.2 `peerDependencies` 遗漏 `@deepseek-ai/dsh-client-connection` 与 `@deepseek-ai/dsh-llm`

方案 host 半 `ctx.inject(['connection'])` 与 client 半 `ctx.connection.rpc.call` 的 `connection` 服务均由 `@deepseek-ai/dsh-client-connection` 提供（host 半见 [connection/src/index.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/index.ts)`name='client-connection'` + `ctx.connection`；client 半见 [client/index.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/client/index.ts)`ctx.provide('connection', handle)`）。§6.3 的 `createUserMessage` 来自 `@deepseek-ai/dsh-llm`。二者均为必需 peerDependency，但 §9.2 只列了 cordis/system-prompt/agent/tools。落地时补齐，否则 `inject(['connection'])` 与 `createUserMessage` 无法解析。

### P2-3：§6.3 `source: { kind: 'rulebase-update' }` 需扩展 `MessageSourceMap`

`createUserMessage` 的 `source` 字段类型是 `MessageSource`（即 `MessageSourceMap[keyof MessageSourceMap]`）。其注释明示「Merge-extensible sum type — plugins add their own kinds」——自定义 `kind: 'rulebase-update'` 是**被支持**的，但必须 `declare module '@deepseek-ai/dsh-llm'` 扩展 `MessageSourceMap` 接口（见 [message.ts](file:///O:/工作区/deepseek-harness/packages/llm/llm/src/message.ts#L100-L105)），否则 TypeScript 报错。方案骨架未写该扩展声明，实现时应补上（可参照 agent-instructions 的 `kind: 'agent-instructions'` 扩展方式）。另注意 `ContentForm` 语义：规则更新属「notice」或「snapshot」，可视需要给 `form` 赋值，`summary`/`sections` 按对应 form 补齐。

### P2-4：§8.1「返回」列是业务类型，但 `ConnectionRpcHandler` 返回 `RpcResult` 信封

`ConnectionRpcHandler` 的签名是 `(endpoint, payload, signal) => Promise<RpcResult<unknown>>`，其中 `RpcResult<T> = { ok: true, value: T } | { ok: false, error: RpcError }`（见 [rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts)。§8.1 表格「返回」列写的是裸业务类型（`Rule[]`/`Rule`/`void`/`{count:number}`），应澄清 `service.dispatch` 末端需把业务值包成 `{ ok: true, value }`、异常包成 `{ ok: false, error: { code, message ... } }`，client 端 `rpc.call` 得到的也是这个信封，需先判 `ok` 再取 `value`。

### P2-5：首次 `assemble` 与 `boot()` 的启动竞态

§6.2 的 `injector.boot()` 是异步扫描填缓存，但 dsh 启动后第一次模型请求可能早于 `boot()` 完成。此时 `renderFromCache(cwd)` 会走「未命中回退全局缓存或空串」，导致**首个会话的首步可能缺项目规则**（全局规则不受影响）。建议二选一：① `boot()` 完成后才注册 `rulebase:rules` 段（段注册延迟到缓存就绪）；② 或明确承认该竞态，在 §12 补一条「启动首步项目规则可能为空，下一次请求自愈」。此项与「即变即用」并列，是除热更新之外的唯一时序盲区。

---

## 五、放行意见

方案架构层面已通过。上述 5 项 P2 均为实现期可自然闭环的细节，无需再升版复审；建议开发者在编码时对照本节逐项落实，并在 `docs/` 输出 API 文档时同步说明 `ConnectionRpcHandler` 的信封约定与 `MessageSourceMap` 扩展。

复审结论：**有条件通过（进入实现）**。若后续深度实现中发现 5 项之外的新机制障碍，再行复评。
