# RuleBase API 文档

本文档为 RuleBase 插件的完整 API 参考。按模块组织，每个模块对应一份独立文档。

## 模块总览

| 模块 | 文件 | 职责 | 文档 |
|:--|:--|:--|:--|
| 规则数据与路径 | `src/host/paths.ts` | 规则级别类型、全局/项目目录解析 | [01-规则数据与路径](api/01-规则数据与路径.md) |
| 存储模块 | `src/host/store.ts` | md 文件全量读写、安全读取、原子写 | [02-存储模块RuleStore](api/02-存储模块RuleStore.md) |
| 注入模块 | `src/host/injector.ts` | 规则注入与刷新（异步读盘 + 同步读缓存） | [03-注入模块RuleInjector](api/03-注入模块RuleInjector.md) |
| 桥接模块 | `src/host/service.ts` | Connection RPC 桥（UI↔host） | [04-桥接模块RulesService](api/04-桥接模块RulesService.md) |
| host 装配入口 | `src/host/index.ts` | 装配 store/injector/service，注册提示词段与 RPC 通道 | [05-host装配入口](api/05-host装配入口.md) |
| client 类型与控制器 | `src/client/types.ts`、`src/client/controller.ts` | 最小类型 + 列表状态机/rpc 客户端 | [06-client类型与控制器](api/06-client类型与控制器.md) |
| 设置面板 UI | `src/client/RuleSection.tsx`、`src/client/index.ts` | 「规则」区组件与 section 注册 | [07-设置面板UI组件](api/07-设置面板UI组件.md) |

## 数据流

```
启动/新对话
  └─ RuleInjector.boot() / watch() / agent:created
       └─ 异步扫描 RuleStore.list(global + project) → 合成字符串缓存
            └─ systemPrompt 段 text 同步读缓存 → 注入提示词

项目路径识别（currentCwd）
  └─ RuleInjector.currentProjectCwd() ← agent/created 记录的 agent.session.header.cwd（最近活跃，空串过滤）
       └─ RulesService 'currentCwd' 端点 → RuleController.currentCwd() → 设置面板「项目」tab/保存校验

设置面板 UI（RuleSection）
  └─ RuleController(rpc)
       └─ connection.rpc.call('/rulebase', endpoint, payload)
            └─ RulesService.dispatch（ConnectionRpcHandler）
                 └─ RuleStore.save/remove → RuleInjector.reload() → 刷新注入
```

## 约定

- 规则唯一事实源是磁盘 `.md` 文件；`settings.yaml` 不含任何规则内容。
- 规则正文注入采用「全量组装、全量替换」，不做增量 diff。
- host↔client 桥接走 `@deepseek-ai/dsh-client-connection` 的通用 RPC 通道（channel `/rulebase`，`authority: 'loopback'`），非 Typert Remote，也不经 dsh settings。
- 自定义 RPC 端点的业务返回值都包在 `RpcResult` 信封内（`{ ok: true, value }` 或 `{ ok: false, error }`）。