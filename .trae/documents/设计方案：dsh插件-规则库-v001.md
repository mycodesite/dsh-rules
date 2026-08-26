# 设计方案：dsh插件-规则库（RuleBase）- v001

> 目标：实现一个 dsh 插件 RuleBase，以“全局 + 项目”两级 md 文件为规则源，在每次对话/每次系统提示词组装时把规则注入给 AI，并提供设置面板内可增删改查的可视化规则管理界面。
> 性质：**产品级架构设计**（非仅实现说明），以架构师视角给出分层、数据模型、机制选型、关键决策与验证标准。
> 参考事实源：`deepseek-harness` 工程源码（`O:\工作区\deepseek-harness`）、allMemory 插件（`O:\mcpFs\dsh-plugin-build\allMemory`）、dsh 官方插件文档（dshbase.com/zh/plugins）。
> 日期：2026-08-26（v001）

---

## 一、需求解读与目标

### 1.1 需求清单

| # | 需求 | 落地性质 |
|:--|:--|:--|
| R1 | 插件注册名 `RuleBase` | 技术标识（见 §2.1 命名约定） |
| R2 | 两级存储：全局 `~/.dsh/rules`、项目 `./.dsh/rules` | host 侧存储模块 |
| R3 | 规则以 `.md` 文件保存 | 存储格式 |
| R4 | 注入时机：dsh 启动读全局+启动目录规则；每个新对话注入提示词 | 注入模块 |
| R5 | 新建/保存规则后更新注入；即变即用 | 刷新机制 |
| R6 | 每个对话检查项目目录、读项目规则、做替换 | 项目规则解析与替换 |
| R7 | 界面在设置面板的“规则”区（插件新建） | 客户端 UI |
| R8 | 全局/项目 tab、列表（图标+内容+设置按钮）、编辑删除下拉、编辑框+保存取消 | 客户端 UI 细节 |
| R9 | 保存后立即更新系统提示词插件注入部分 | 保存↔注入联动 |

### 1.2 目标与验收口径

- **数据目标**：规则仅以 md 文件持久化（`~/.dsh/rules` 全局、`<cwd>/.dsh/rules` 项目），**不注册 dsh settings 命名空间、不写入 dsh 设置文档（settings.yaml）**；两级可并列注入。
- **注入目标**：每个新对话（每次系统提示词组装）自动包含“当前有效规则”的完整正文；更新时**全量组装、全部替换**，而非增量累加。
- **交互目标**：设置面板出现独立“规则”区，支持两级 tab、增/改/删、双击/菜单进入编辑；保存后下一次模型请求即采用新规则。
- **一致性目标**：UI 的写操作、外部对 md 文件的编辑、以及注入内容三者最终收敛于同一份**全量**规则集合（每次组装全量扫描、全量替换）。

---

## 二、调研结论：dsh 关键扩展点

> 本方案全部机制来自 dsh 官方扩展点，不修改 dsh 内置文件。核心结论逐条列出。

### 2.1 插件装配形态（host 两半 + client 两半）

dsh 插件是一个可选的“host 半 + client 半”组合包。host 半在 Node 侧运行、持有文件系统与注入能力；client 半在浏览器侧运行、渲染设置面板 UI。allMemory 即此形态：host 侧 [index.ts](file:///O:/mcpFs/dsh-plugin-build/allMemory/src/host/index.ts) 装配设置与工具，client 侧 [index.ts](file:///O:/mcpFs/dsh-plugin-build/allMemory/src/client/index.ts) 注册设置面板区段。

要点：

- host 入口导出 `name` / `inject`（依赖的 cordis 服务键）/ `apply(ctx)`；
- client 入口同样导出 `name` / `inject`（`['slots','connection']`）/ `apply(ctx)`；RuleBase 无需 `settingsScope` 与 `remote`（规则不注册设置命名空间，桥接走 Connection 通用 RPC）。
- `package.json` 用 `dsh.bundle.patch` + `dsh.client.{platform,inject}` 描述两半打包与客户端注入；
- 开发态用 `cordis.yml` 的 `insert` 把 host 入口按源文件绝对路径挂载。

**命名约定（重要）**：dsh 的插件 `name`、`systemPrompt` 段名均要求**小写 kebab-case**。因此对外显示名 `RuleBase`，落地的技术标识统一为 `rulebase`：

- 插件名：`name = 'rulebase'`
- 系统提示词段名：`rulebase:guidance` / `rulebase:rules`
- **不注册任何 dsh settings 命名空间**：规则仅以 md 文件为唯一事实源，不写入 dsh 设置文档（settings.yaml）。

### 2.2 系统提示词注入：`ctx.inject(['systemPrompt'])`

dsh 通过 `@deepseek-ai/dsh-system-prompt` 服务贡献“有序系统提示词段”。这是 allMemory 参考文档所述 `ctx.inject` 的实质（[system-prompt 子系统](file:///O:/工作区/deepseek-harness/docs/subsystems/system-prompt.zh.md)）：

```ts
ctx.inject(['systemPrompt'], (scope) => {
  scope.systemPrompt.section({
    name: 'rulebase:guidance',   // 唯一段名，重复注册报错
    order: 160,                  // 约定：-100 身份、0 persona、100–199 工具引导
    text: '...',                 // 静态字符串 或 (context: AssembleContext) => string
  })
})
```

关键语义（来自 [systemPrompt 服务签名](file:///O:/工作区/deepseek-harness/docs/subsystems/system-prompt.zh.md)）：

- `PromptSection.text` 可为**函数**，在**每次组装（assemble，即每步模型请求）时求值**，并支持 `{{variable}}` 插值；
- `section()` 注册会发出 `system-prompt/change`；
- 另提供 `context()`（动态上下文，durable user-role snapshot，缓存更友好，见 §6.4）与 `variable()`；
- `AssembleContext` 可被 `dsh-agent` 扩展出可选 `agent` 字段，用 `assembleContextFor(agent, signal)` 注入——这是拿当前会话 cwd 的关键缝隙。

**结论**：R4/R6（每次对话注入 + 读项目规则）可由 `section()` 的**动态 `text` 函数**实现：函数内**主动扫描**全局+项目规则目录、读取全部 md 文件，返回**全量合成**后的规则全文。段名唯一 + 每次重算，即天然满足“全量替换而非累加”。

### 2.3 持久运行时上下文注入：`agent.inject()` 与 `agent/pre-step`（agent-instructions 模式）

dsh 内建的 AGENTS.md/指令加载器 [`dsh-agent-instructions`](file:///O:/工作区/deepseek-harness/packages/context/agent-instructions/src/index.ts) 是 RuleBase 最直接的同源参考。它给出了“按 cwd 读指令文件、按会话做替换、文件触碰后刷新”的完整范式：

- 用 `agent.session.header.cwd` 作为项目根（[index.ts 中 `const cwd = agent.session.header.cwd ?? process.cwd()`](file:///O:/工作区/deepseek-harness/packages/context/agent-instructions/src/index.ts#L124-L125)）；
- 在 [`agent/pre-step`](file:///O:/工作区/deepseek-harness/packages/context/agent-instructions/src/index.ts#L322-L348) 边界把合成好的 `UserMessage` 注入，并用 `agent.inbox.replace(prevId, desired)` 做“替换旧内容”；
- 文件变更（`tools/result` 里 `read/write/edit` 触碰路径）触发重投影。

`agent.inject()` 签名在 [runtime-types.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/runtime-types.ts#L143)：`inject(message: UserMessage): void`，把面向模型的上下文放入 next-step inbox 而不唤醒驱动；`followup()`/`steer()` 才是可唤醒输入。功能→机制映射表（[extension-cookbook.zh.md](file:///O:/工作区/deepseek-harness/docs/cookbook/extension-cookbook.zh.md)）明确：`AGENTS.md（子目录，按需触发）→ 从 watcher/工具结果监听器调用 agent.inject()`。

**结论**：R5（即变即用）的“即时刷新”借鉴 `agent.inject()`——把变更即时推进当前对话；而 R6 的“规则替换”由 systemPrompt 唯一段的全量重算承担（§6.4）。agent-instructions 的 `agent.inbox.replace()` 仅在需要“跨轮次保留固定前缀、只替换规则正文”以优化 KV Cache 时作为备选路径。

### 2.4 设置面板区段 slot 与客户端 UI

设置面板是一个 `settings.section` 列表 slot（[ui-settings slot 契约](file:///O:/工作区/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts)），每个贡献项拥有 `id`（区段键）、`order`（导航位置）、`label`（本地化显示名）。allMemory 与 [AgentPreset](file:///O:/工作区/deepseek-harness/packages/client/ui-agent-preset/src/client/index.ts) 都通过该 slot 贡献一个独立区段：

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'rulebase',          // 区段键
  order: 30,
  label: () => t('nav'),   // “规则”
  inject: sectionInjected,
}, RuleSection))
```

UI 原语来自 `@deepseek-ai/dsh-client-ui-primitives`（`Button`/`Modal`/`Tooltip`/`Icon*`，见 [AgentPresetSection.tsx](file:///O:/工作区/deepseek-harness/packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx)），用户要求的“flat button / 下拉菜单 / tab / 列表 / 编辑框”均可用 React 组件自绘，无需改动设置外壳。

### 2.5 客户端↔宿主桥接：Connection 通用 RPC 通道

host 侧业务能力要暴露给 client 调用，走 `@deepseek-ai/dsh-client-connection` 提供的**通用逻辑 RPC 通道**（与 Typert Remote 无关，不依赖构建期生成的 `/remote` 产物）：

- Host 侧：`ctx.connection.rpc.handle('/rulebase', handler, { authority: 'loopback' })` 注册一个独立 channel（见 [rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts) `HostConnectionRpc.handle`；`assertChannel` 仅拒绝 `/api` 与非法名，见 [rpc-host.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc-host.ts#L220-L223)）。
- Client 侧：`ctx.connection.rpc.call('/rulebase', 'list', payload)` 调用（见 [rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts) `ClientConnectionRpc.call`、[client/rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/client/rpc.ts)）。

> 为何不用 Typert Remote：后者 client 侧能力是「构建期生成的严格产物 + `api-remotes` 显式 import 挂载」，第三方插件无法在运行时让 client 发现/挂载自定义 Remote（见 [api-remotes README.zh.md](file:///O:/工作区/deepseek-harness/packages/api/remotes/README.zh.md)「Client 不会在运行时发现 Host 中已启用的服务或 Remote 定义」）。

**结论**：规则文件在 host 侧读写，client 增删改查经 Connection 通用 RPC 通道调用 host 的 `RulesService`（详见 §8）。该通道只负责 UI 管理 md 文件，规则本身不注册进 dsh settings。

---

## 三、总体架构

### 3.1 分层

```
┌─────────────────────────── 浏览器（client 半） ───────────────────────────┐
│  RuleSection（settings.section 区段，UI 全部交互）                           │
│    · 刷新 flat按钮 / “+ 创建”下拉(全局·项目) / 全局|项目 tab / 规则列表     │
│    · 编辑框(保存·取消) / 设置图标按钮→下拉(编辑·删除)                        │
│  RuleController（状态机：list/create/save/remove，draft、revision 设栅）    │
│        │  ↑ 调用 connection.rpc.call('/rulebase', ...) + 写后重拉/刷新      │
└────────┼──┴──────────────────────────────────────────────────────────────┘
         │  HTTP POST /rulebase/*（Connection 通用 RPC channel，loopback）
┌────────┴─────────────────────────── host（Node 半） ───────────────────────┐
│  RulesService（ctx.connection.rpc.handle('/rulebase', handler, loopback)）  │
│  RuleStore（规则文件读写；全局+项目目录解析）                                 │
│     · ~/.dsh/rules/*.md（全局）   <cwd>/.dsh/rules/*.md（项目）             │
│  RuleInjector（注入与刷新）                                                  │
│     · 异步读盘 → 合成字符串缓存；systemPrompt section 的 text 同步读缓存     │
│     · 文件 watcher（fs.watch 两目录）→ 防抖 reload 刷新缓存                 │
│  CwdResolver（从 AssembleContext.agent / process.cwd 取当前会话 cwd）        │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

1. **启动/会话开始**：`RuleInjector` 异步扫描全局+项目目录、读取全部 md、合成字符串并缓存；dsh 组装系统提示词时，`rulebase:rules` 段 `text` 同步读缓存（经 `CwdResolver` 得 cwd）→ 进入本次请求。
2. **UI 创建/编辑/删除**：client 调 `connection.rpc.call('/rulebase', 'create|save|remove')` → `RulesService` → `RuleStore` 写 md → `RuleInjector.reload()`（异步重扫重算缓存）。
3. **外部改文件**：fs.watch 捕获，防抖后 `RuleInjector.reload()`（异步刷新缓存）。
4. **reload 收敛**：异步重扫重算缓存后，下一 `assemble` 的 `text` 函数同步读到新全文（隐式刷新）→ 对活动 agent 调 `agent.inject()` 推送“规则已更新”（显式即变，见 §6.3）。

---

## 四、数据模型

### 4.1 规则实体

```ts
/** 规则级别：全局 或 项目 */
type RuleLevel = 'global' | 'project'

/** 单条规则（md 文件在内存中的投影） */
interface Rule {
  /** 稳定 id：由文件名（去扩展名）而来，kebab-case，作为跨层的唯一键 */
  id: string
  /** 规则标题：取 md 首个 H1/首行，无则用 id */
  title: string
  /** 规则正文：md 文件完整内容 */
  content: string
  /** 所属级别 */
  level: RuleLevel
  /** 文件绝对路径（用于定位/删除/双击直达） */
  filePath: string
}

/** 一次注入的渲染结果 */
interface RulesSnapshot {
  /** 全局规则，按文件名排序 */
  global: Rule[]
  /** 项目规则（仅当解析到 cwd 时非空） */
  project: Rule[]
  /** 是否有任何规则 */
  hasRules: boolean
}
```

### 4.2 存储路径解析

- 全局目录：`path.join(os.homedir(), '.dsh', 'rules')`；`~` 展开为 `os.homedir()`。为与 dsh 统一，优先回读 dsh home（若可注入 `$DSH_HOME` 概念则用其 `.dsh/rules`），否则 `~/.dsh/rules`。
- 项目目录：`path.join(cwd, '.dsh', 'rules')`，`cwd` 来自 `agent.session.header.cwd`（见 §6.2），无 cwd 时该项目级规则为空。
- 文件命名：`<id>.md`。id 由文件名推导、去扩展名并 `kebab-case` 化；同名冲突（如 `My Rule.md` 与 `my-rule.md`）在 list 时按创建顺序去重并告警。
- 规则**不注册** dsh settings 命名空间：md 文件是唯一事实源，`settings.yaml` 不出现任何规则内容（RuleBase 不通过 `ctx.settings.register` 承载规则）。

---

## 五、存储模块（`RuleStore`）

职责单一：读写 md 文件，向上提供 `list/save/remove`，不关心注入与 UI。

```ts
class RuleStore {
  async list(level: RuleLevel, cwd?: string): Promise<Rule[]>   // 主动扫描目录 *.md，全量读取
  async save(level: RuleLevel, id: string, content: string, cwd?: string): Promise<Rule>
  async remove(level: RuleLevel, id: string, cwd?: string): Promise<void>
}
```

设计要点：

- **全量存取**：规则总量小（过大本就不该占用上下文），`list` 每次全量扫描读取，不做增量 diff；合成字符串缓存归注入层 §6 维护（因 `text` 同步约束，磁盘 IO 与读数分层）。
- 目录不存在时 `list` 返回空数组（不抛错）；`save` 前 `mkdir -p`。
- 写文件用原子写（临时文件 + rename），避免半写文件被注入读到。
- 编码与换行：统一 UTF-8、`\n`；读入时归一化 CRLF。
- **安全读取**：`list` 只读规则目录内平铺的 `*.md`，不跟随软链接逃逸目录；合成结果设总量上限（字节数）截断，避免单文件极大或文件数异常导致提示词暴涨。
- **通用函数提炼**（统一管理约束）：`resolveDir(level, cwd)`、`ensureDir()`、`readRuleFile()`、`atomicWrite()` 抽为 store 内私有通用方法，`list/save/remove` 三 public 方法复用。

---

## 六、注入模块（`RuleInjector`）——本方案核心

### 6.1 分层注入策略

采用“**稳定引导段 + 动态规则正文**”两层：

| 层 | 机制 | 内容 | name/order | 是否每次重算 |
|:--|:--|:--|:--|:--|
| 引导段 | `section()` | 固定文案：说明规则由 RuleBase 注入、遵守之 | `rulebase:guidance` / `order 160` | 否（静态） |
| 规则正文 | `section()`（动态 `text` 同步读缓存） | 当前全局+项目规则合成全文 | `rulebase:rules` / `order 170` | 是（每次 assemble 同步求值） |

> **同步约束（P0-2）**：`PromptSection.text` 与 `PromptContext.text` 的签名都是严格同步的 `(context) => string`（不能返回 `Promise`），组装时同步调用、无 `await`。因此「每次组装去异步读盘」不可行——规则正文的磁盘 IO 必须前移到异步路径（启动/reload/watcher），`text` 函数只做**同步读缓存**（见 §6.2）。`context()` 与 `section()` 在此同受同步约束，不能用来解决异步 IO；它仅是在“缓存友好/durable snapshot”维度上可选的优化（见 [system-prompt 动态提示词上下文](file:///O:/工作区/deepseek-harness/docs/subsystems/system-prompt.zh.md)）。

### 6.2 注入实现

```ts
// host/index.ts（关键骨架）
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

// 自定义注入来源：扩展 MessageSourceMap（merge-extensible，见 §6.3 / dsh-llm message.ts）
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    rulebase: { kind: 'rulebase-update' }
  }
}

const GUIDANCE = `## 规则库（RuleBase）
本环境由 DSH 插件 rulebase 注入“规则”。下方【项目规则】/【全局规则】是当前生效的约束，请在对话与执行中严格遵守。`

export function apply(ctx: Context): void {
  const store = new RuleStore()
  const injector = new RuleInjector(ctx, store)

  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({ name: 'rulebase:guidance', order: 160, text: GUIDANCE })
    // 规则正文段在缓存就绪后才注册，避免启动首步缺项目规则的竞态（P2-5）
    void injector.boot().then(() => {
      scope.systemPrompt.section({
        name: 'rulebase:rules',
        order: 170,
        text: (assembleCtx) => injector.renderFromCache(activeCwd(assembleCtx)), // 同步：只读缓存
      })
    })
  })

  injector.watch()   // fs.watch 两目录 → 防抖 → 异步 reload 刷新缓存
}
```

`activeCwd(assembleCtx)` 解析规则目录的项目根，两级即可：

1. `assembleCtx.agent?.session.header.cwd`（dsh-agent 扩展的 `agent` 字段，最权威）；
2. `process.cwd()` 兜底（与 agent-instructions 同源）；都拿不到时仅注入全局规则。

> `renderFromCache(cwd)` 是**同步**方法：返回 `RuleInjector` 已备好的合成字符串（按 cwd 查缓存，未命中回退全局缓存或空串）。真正的磁盘读取在 `boot()`/`reload()` 的**异步**路径完成，保证 `text` 热路径零 IO、签名符合 `(context) => string`。

`render(cwd)` 输出形如：

```md
### 全局规则
（全局各 .md 全文，带 `<rule-basefile>` 文件名标题分隔）

### 项目规则（cwd：<path>）
（项目各 .md 全文）
```

### 6.3 “即变即用”刷新机制

触发源有两条，最终收敛到同一 `reload()`：

1. **UI 写操作**：`RulesService.save/remove` 内，写文件后调用 `injector.reload()`。
2. **外部编辑 md**：`fs.watch` 监听两目录，防抖后 `injector.reload()`。

`reload()` 做的事（异步）：

- 重新扫描并合成规则全文、更新缓存字符串；下一 `assemble` 的 `text` 同步读缓存即取到新全文（**隐式刷新**，整体替换，覆盖“下一个新对话/下一步请求”）。
- 遍历活动 agent（`ctx.agents`，若可用）调用 `agent.inject(createUserMessage({ content: '[规则已更新] 请按最新规则继续。', source: { kind: 'rulebase-update' } }))`（**显式刷新**）。

> **`source.kind` 扩展（P2-3）**：`createUserMessage` 的 `source` 是 `MessageSourceMap[keyof MessageSourceMap]`（merge-extensible，见 [message.ts](file:///O:/工作区/deepseek-harness/packages/llm/llm/src/message.ts#L100-L105)）。骨架已 `declare module '@deepseek-ai/dsh-llm'` 扩展 `MessageSourceMap` 加入 `rulebase`（`kind: 'rulebase-update'`），实现时必须携带该扩展声明，否则类型报错（参照 agent-instructions 的 `kind: 'agent-instructions'`）。`ContentForm` 可按「notice」语义给 `form` 赋值。

> **`agent.inject()` 语义收敛（P1-2）**：`inject` 是「把上下文放入 next-step inbox 而不唤醒驱动」——running 的 agent 在最近一个 pre-step 边界认领；idle 的 agent 则挂起，直到下一次 `followup()`/`steer()` 唤醒。因此「立即生效」的准确表述是：**隐式刷新（下次 assemble 全量重算）保证语义正确**；显式 `agent.inject()` 仅当 agent 处于 running 时能“马上”被认领。若枚举不到活动 agent，则仅依赖隐式刷新，变更最迟在**下一次模型步进**生效。见 [runtime-types.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/runtime-types.ts#L143)。

### 6.4 每对话“检查项目目录 + 全量替换”

- **检查项目目录**：`RuleInjector` 在启动/`reload()` 时按 `activeCwd()` 重算项目目录、**异步读取**最新 `.dsh/rules` 全部文件并填缓存；`text` 函数按 cwd **同步读缓存**（满足 R6“每个对话检查项目目录”——每个新对话前会触发该 cwd 的缓存刷新）。
- **全量替换**：`rulebase:rules` 段是**唯一命名**的段，每次求值对两级规则**全量组装**（读缓存），返回“当前全局+项目完整合成结果”，整体覆盖上一次内容、不累加重复（满足 R6“做替换操作”）。
- 若未来需要“跨轮次保留固定 prefix、只替换规则正文”以优化 KV Cache，可切换为 agent-instructions 的 `agent.inbox.replace(prevId, desired)` 持久上下文方案（见 [agent-instructions index.ts](file:///O:/工作区/deepseek-harness/packages/context/agent-instructions/src/index.ts#L244-L248)），作为 §12 备选路径。

---

## 七、UI 模块（设置面板“规则”区）

### 7.1 结构映射

注册一个 `settings.section`（`id='rulebase'`、`order=30`、`label='规则'`）。注意 `settings.section` 的 owner props 仅 `{ close: () => void }`（不携带数据，见 [slots.ts](file:///O:/工作区/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts)）；RuleBase 不走 `settingsScope`，`RuleSection` 只收到 `{ close }`，其数据/状态全部来自自建的 `RuleController`（经 `inject: () => controllerFace()` 注入控制器操作面）。组件 `RuleSection` 内部按用户规格实现：

| 用户描述 | 实现 |
|:--|:--|
| 左侧“规则”标题 | 区段 `h2` 标题（区段自身的 nav label = “规则”） |
| 标题右一点一个“刷新” flat button | `Button variant="ghost"/flat` + 刷新图标，点击 → `controller.reload()`（重拉列表 + 宿主重载注入） |
| 下方标签“创建并管理规则，在聊天过程中遵循这些规则。” | 区段 `<p>` 说明文案 |
| 右侧“+ 创建”选择按钮，下拉菜单有“全局”“项目” | `Button` + 下拉 `Menu`：两项，点击后进入该级“新建规则”态 |
| 全局、项目采用 tab 面板 | 自定义 tab（`ButtonGroup`/两个 tab 按钮 + 条件渲染当前级列表） |
| 表项：左图标 / 中规则内容 / 右设置图标按钮 | 列表行：`IconFile*` + 规则标题/摘要 + `IconMore*` 按钮 |
| 点设置按钮弹下拉菜单：编辑、删除 | 右侧按钮触发 `Menu`：`编辑`、`删除` |
| 点“编辑”或双击列表项 → 展开编辑框，框下“保存”“取消” | 行内展开 `<textarea>`；编辑态显示 `保存`/`取消` 按钮 |
| 保存后立即更新系统提示词插件注入部分 | `保存` → `controller.save()` → `rpc.call('/rulebase', 'save')` → host 写 md + `reload()`（R9 闭环） |

### 7.2 状态模型（`RuleController`）

复刻 AgentPreset 的“控制器 + SnapshotStore”模式（[AgentPresetSection.tsx](file:///O:/工作区/deepseek-harness/packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx) 与 [section-store.ts](file:///O:/工作区/deepseek-harness/packages/client/ui-agent-preset/src/client/section-store.ts)）：

```ts
type StoreState =
  | { status: 'loading' }
  | { status: 'idle'; level: RuleLevel; rows: Rule[]; editing: Rule | null; draft: string }
  | { status: 'error'; error: string }
```

字段 `editing`/`draft` 承载双击/菜单进入的编辑态，`save()` 后回到 `idle` 并重拉列表。控制器持有 `ctx.connection.rpc`（`ClientConnectionRpc`），经 `rpc.call('/rulebase', ...)` 访问规则；负责 revision 设栅与错误显式化。因第三方插件拿不到 host→client forwarded event，跨标签/外部编辑的一致性靠「写后重拉 + 显式“刷新”」维持（见 §12）。

### 7.3 关键交互约束

- 双入口进入编辑（下拉菜单“编辑” / 双击列表项）共用同一 `beginEdit(rule)`；编辑态互斥（同一时刻仅一项编辑）。
- 删除走二次确认（内嵌确认态或 `Modal`，同 AgentPreset 的删除确认），避免误删。
- “+ 创建 → 全局/项目”为“新建空白规则”，进入编辑态，保存时由 host 生成 id（若用户未命名则以时间戳/自增 id 兜底）。

---

## 八、桥接与 RPC API（`RulesService`）

### 8.1 端点设计（channel `/rulebase`）

| endpoint | 语义 | 入参 | 返回 |
|:--|:--|:--|:--|
| `list` | 列某级规则 | `{ level, cwd? }` | `Rule[]` |
| `create` | 新建规则 | `{ level, content }` | `Rule` |
| `save` | 保存（新建或覆盖） | `{ level, id, content }` | `Rule` |
| `remove` | 删除 | `{ level, id }` | `void` |
| `reload` | 显式重载并刷新注入（“刷新”按钮） | — | `{ count: number }` |

> **RPC 返回信封（P2-4）**：上表「返回」列是**业务值**；`ConnectionRpcHandler` 实际返回 `RpcResult<unknown> = { ok: true; value } | { ok: false; error: { code; message; details } }`（见 [apiproxy rpc.ts](file:///O:/工作区/deepseek-harness/packages/host/apiproxy/src/api/rpc.ts#L110)、[connection rpc.ts](file:///O:/工作区/deepseek-harness/packages/client/connection/src/rpc.ts)）。`service.dispatch` 末端须把业务值包成 `{ ok: true, value }`、把异常包成 `{ ok: false, error }`；client 端 `rpc.call` 拿到该信封后先判 `ok` 再取 `.value`。

### 8.2 host 侧落地

host 内 `RulesService`（普通对象即可，无需 Cordis Service 或 `@Remote` 标记）持有 `RuleStore` 与 `RuleInjector` 引用，注册到 Connection 通用 RPC channel，写操作成功后调用 `injector.reload()`：

```ts
ctx.inject(['connection'], (c) => {
  c.connection.rpc.handle(
    '/rulebase',
    (endpoint, payload, signal) => service.dispatch(endpoint, payload, signal), // ConnectionRpcHandler
    { authority: 'loopback' },
  )
})
```

`service.dispatch(endpoint, payload, signal)` 是按 endpoint 分发的 `ConnectionRpcHandler`，路由到 `list/create/save/remove/reload`，末端按 §8.1 把业务值/异常包成 `RpcResult` 信封；client 侧经 `ctx.connection.rpc.call('/rulebase', endpoint, payload)` 调用、先判 `ok` 再取 `.value`（见 §2.5）。

> **边界澄清**：该 RPC 是 UI↔host 之间的“文件管理桥”，并非把规则注册进 dsh settings——规则内容自始至终只存在于 md 文件，`settings.yaml` 不含任何规则数据。通道只承载对 md 文件的增删改查，不承载规则的“dsh 注册”。

---

## 九、插件装配与注册

### 9.1 目录结构（对齐 allMemory）

```
rulebase/
├─ package.json
├─ cordis.yml              # 开发态 insert 挂载 host/src/host/index.ts
├─ tsconfig.json / tsconfig.client.json
├─ src/
│  ├─ host/
│  │  ├─ index.ts          # apply：装配 store/injector/service
│  │  ├─ store.ts          # RuleStore（§5）
│  │  ├─ injector.ts       # RuleInjector（§6）
│  │  ├─ service.ts        # RulesService（§8，connection.rpc handler）
│  │  └─ paths.ts          # resolveDir/activeCwd 通用路径解析
│  ├─ client/
│  │  ├─ index.ts          # 注册 settings.section
│  │  ├─ RuleSection.tsx   # 区段 UI（§7）
│  │  └─ controller.ts     # 状态机 + Remote 客户端
└─ tests/                  # 见 §11
```

### 9.2 关键配置

- `package.json`：`name='rulebase'`、`type='module'`、`main='lib/index.mjs'`、`exports` 含 `./client`；`peerDependencies` 列 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-client-connection`（host 半 `inject(['connection'])` 与 client 半 `ctx.connection.rpc`）、`@deepseek-ai/dsh-llm`（`createUserMessage`）、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-tools` 等（按实际 import 收口）；**不含 `@deepseek-ai/dsh-settings`/`@deepseek-ai/schemastery`**（规则不注册 dsh settings，无 settings schema）；`dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh.client.{platform:'web', inject:[...]}`。
- `cordis.yml`（开发态）参照 allMemory：

```yaml
- insert:
    - id: rulebase
      name: 'O:/mcpFs/dsh-plugin-build/rulebase/src/host/index.ts'
```

---

## 十、关键技术决策表

| 决策 | 选择 | 理由 / 权衡 |
|:--|:--|:--|
| 技术标识 | `rulebase`（小写 kebab） | dsh `name`/段名要求小写 kebab；显示名仍 `RuleBase` |
| 规则持久化 | 仅 md 文件，不注册 dsh settings | 规则不向 dsh 注册，`settings.yaml` 不含任何规则内容 |
| 注入主机制 | `systemPrompt.section()` 动态 `text`（同步读缓存） | 异步读盘填缓存 + `text` 同步读缓存（`text` 签名同步）；段名唯一 = 每对话注入 + 全量替换 |
| 组装策略 | 全量组装 / 全量替换 | 规则总量小（过大本就不该占用上下文），无需增量 diff |
| 稳定 vs 动态 | 引导段静态 + 规则正文动态 | 稳定引导段保 KV Cache；规则变化不污染稳定前缀 |
| cwd 解析 | `agent.session.header.cwd ?? process.cwd()` | 与 dsh 内建 agent-instructions 同源；无 `workspaces` 此 service 键 |
| 即变即用 | 异步 reload + 隐式刷新 + 显式 `agent.inject()` | 隐式（下次 assemble 重算）保证正确；显式仅 running 时立即，idle 挂起到下次唤醒 |
| 桥接 | Connection 通用 RPC（`/rulebase` channel） | 第三方插件可用；Typert Remote 的 client 侧仅构建期产物，无法运行时挂载 |
| UI 承载 | `settings.section`（id `rulebase`） | 与 allMemory、AgentPreset 同模式，无需改设置外壳 |
| 规则 id | 文件名去扩展名、kebab-case | 文件即规则、id 即文件名，跨层唯一且直观 |
| 顺序 | 引导段 160 / 规则 170 | 落工具引导带 100–199，排 tools:sdk(150) 之后 |

---

## 十一、验证计划

| # | 验证项 | 手段 |
|:--|:--|:--|
| 1 | 类型/构建 | `npm run typecheck`、`npm run build`（host+client 两半） |
| 2 | 存储读写 | 单测：`RuleStore.list/save/remove` 对两目录、不存在目录、CRLF、原子写 |
| 3 | 注入一致 | 单测：`render(cwd)` 给定全局+项目文件，断言合成顺序、替换不累加 |
| 4 | 每对话重载 | 运行验证：改 `.dsh/rules` 后新会话系统提示词含新规则；确认 `rulebase:rules` 位于 `rulebase:guidance` 之后 |
| 5 | 即变即用 | 运行验证：改规则 → 下一次模型请求（下一步/新对话）已用新规则；running 会话收到“规则已更新”注入，idle 会话在下次唤醒后生效 |
| 6 | UI CRUD | e2e/浏览器核对：refresh、创建（全局/项目）、tab 切换、双击/菜单编辑、保存/取消、删除确认 |
| 7 | 保存↔注入闭环 | 保存后核对系统提示词插件注入部分立即变化（R9） |
| 8 | 不落 settings.yaml | 增删改规则后核对 dsh 设置文档不含任何规则内容 |
| 9 | 回归 | 现有测试不回归；插件禁用后段自动消失、不污染基础提示词 |

---

## 十二、风险与缓解

| 风险 | 影响 | 缓解 |
|:--|:--|:--|
| 启动首步竞态 | 首个会话首步可能缺项目规则 | 规则段延后到 `boot()` 缓存就绪再注册（§6.2）；即便未命中，全局规则仍注入、下次请求自愈 |
| `AssembleContext.agent` 不可用 | 无法拿 cwd，项目规则失效 | 回退 `process.cwd()`；仍无则仅注入全局（见 §6.2） |
| 动态 `text` 破坏 KV Cache 前缀 | 规则变更时前缀重算 | 引导段保持静态；必要时规则正文改 `context()`（durable snapshot，`text` 仍同步） |
| Connection RPC channel 不可用（TUI/无 HTTP server） | UI CRUD 不可用 | 退化为直接编辑 md 文件（规则源本就在磁盘），注入不受影响 |
| host→client 无 push 通道 | 跨标签/外部编辑无法即时通知 UI | UI 写后主动重拉 + 显式“刷新”；host 侧 `agent.inject` 不依赖该通道 |
| `fs.watch` 在 Windows 上非递归、事件可合并/丢失 | 外部编辑可能漏捕获 | 只监听平铺规则文件（非递归可接受）+ 防抖；极端情况由「下次 assemble 重扫」兜底 |
| 文件名同名/不规范 | id 冲突 | kebab-case 归一化 + list 去重告警（§4.2） |
| 文件半写 | 注入读到损坏内容 | 原子写（临时文件 + rename） |
| 提示词过长 | token 成本 | 合成结果总量上限截断（§5）；规则总量本应很小 |

---

## 十三、实施步骤与验收标准

> 每一步对应一个可验证里程碑（围绕目标执行）。

1. [骨架] 建包与装配，能挂载并注册 `rulebase:guidance` 段 → 验证：dsh web 启动、设置面板出现“规则”空区、系统提示词含引导段。
2. [存储] 实现 `RuleStore` 与 `paths.ts` → 验证：单测通过（§11 #2）。
3. [注入] 实现 `RuleInjector`：动态段 + cwd 解析 + watcher + `agent.inject` → 验证：§11 #3/#4/#5。
4. [服务] 实现 `RulesService` Remote 端点 → 验证：client 能 list/create/save/remove。
5. [UI] 实现 `RuleSection` + `controller`（§7 全部交互）→ 验证：§11 #6/#7。
6. [收尾] 回归、文档联动（API 文档输出到 `docs/`）→ 验证：§11 #8。

---

## 十四、参考资料

- 参考方案：`O:\mcpFs\dsh-plugin-build\allMemory\.trae\documents\解决方案：通过注入提示词说明记忆工具-001.md`
- allMemory 宿主入口：[host/index.ts](file:///O:/mcpFs/dsh-plugin-build/allMemory/src/host/index.ts)、[client/index.ts](file:///O:/mcpFs/dsh-plugin-build/allMemory/src/client/index.ts)
- dsh 系统提示词：[system-prompt.zh.md](file:///O:/工作区/deepseek-harness/docs/subsystems/system-prompt.zh.md)
- dsh 设置：[settings.zh.md](file:///O:/工作区/deepseek-harness/docs/subsystems/settings.zh.md)
- 功能→机制映射：[extension-cookbook.zh.md](file:///O:/工作区/deepseek-harness/docs/cookbook/extension-cookbook.zh.md)
- 设置卡片 cookbook：[adding-a-settings-card.zh.md](file:///O:/工作区/deepseek-harness/docs/cookbook/adding-a-settings-card.zh.md)
- 指令注入范式：[agent-instructions/src/index.ts](file:///O:/工作区/deepseek-harness/packages/context/agent-instructions/src/index.ts)
- Agent 注入接口：[runtime-types.ts](file:///O:/工作区/deepseek-harness/packages/core/agent/src/runtime-types.ts)
- 设置 slot 契约：[ui-settings slots.ts](file:///O:/工作区/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts)
- 区段 UI 范例：[AgentPresetSection.tsx](file:///O:/工作区/deepseek-harness/packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx)
- Remote RPC：[api-remotes README.zh.md](file:///O:/工作区/deepseek-harness/packages/api/remotes/README.zh.md)、[gateway/src/index.ts](file:///O:/工作区/deepseek-harness/packages/api/gateway/src/index.ts)、[connection README](file:///O:/工作区/deepseek-harness/packages/client/connection/README.md)
- 官方插件文档：`https://www.dshbase.com/zh/plugins/`