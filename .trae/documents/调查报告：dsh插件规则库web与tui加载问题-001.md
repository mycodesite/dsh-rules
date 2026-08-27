# 调查报告：dsh插件规则库web与tui加载问题-001

> 调查对象：RuleBase（dsh-rules）插件在 dsh 中的加载与注入机制
> 参考项目：`deepseek-harness`（dsh 主仓库）、`allMemory`（同型已工作插件）
> 日期：2026-08-27

---

## 0. 结论速览

| # | 问题 | 结论 |
|:--|:--|:--|
| 1 | 目标路径无文件夹/无文件/规则为空时的处理 | **读取端已处理**（目录不存在→空列表、空规则→安全空串）；**写端会自动 mkdir+写文件**；但**不在启动时自动创建空目录/空文件**，仅在首次保存时才创建。 |
| 2 | dsh web 启动报错 + 设置面板无本插件设置项 | 非主仓库源码逻辑缺陷，高度指向 **安装态缺构建产物 / 开发态挂载方式未加载客户端**；详见 §3。 |
| 3 | dsh tui（真实为 dsh-tui）安装与注入机制是否与 web 一致 | **host 半（systemPrompt 规则注入）机制完全一致**（同一 cordis profile 堆叠）；**client 半（设置面板）为 web-only**，按 `dsh.client.platform: "web"` 设计，TUI 不会出现设置面板（属预期，非缺陷）。 |

---

## 1. 关键机制（背景）

dsh 插件为「host + client」双半结构，位于同一 cordis 插件：

- **host 半**（`src/host/index.ts`）：`apply(ctx)` 用 `ctx.inject(['systemPrompt'], …)` 注入规则提示词段；用 `ctx.inject(['connection'], c => c.connection.rpc.handle('/rulebase', …))` 注册 UI↔host 的 RPC 通道。
- **client 半**（`src/client/index.ts`）：`apply(ctx)` 用 `ctx.slots.inject('settings.section', …)` 注册设置面板「规则」区。

web 端加载 client 半的链路（`deepseek-harness`）：

```
profile 的 dsh.profile.bundles 列出插件的包
  → cordis Loader 挂载 host 半（apply）
  → ClientModuleRegistry（client-modules 服务，inject=[webServer,loader]）扫描 loader 条目，
     读取包 package.json 的 dsh.client.platform=='web' 与 exports["./client"]
  → 生成 window.__DSH_BOOT__ 条目图，serve /plugins/<id>/client.js
  → 浏览器 ClientModuleSystem materialize → __ModuleLoader__.load({id,factory})
  → 运行插件 client apply → slots.register('settings.section')
```

要点：
- client 半只有在「包被列为 profile bundle 且构建产物存在、且 dsh.client 声明为 web」时才会被扫描/加载。
- 设置面板位置 `settings.section` 是 `kind:'list; root`，由 `client-ui-settings-general`（随 web bundle 常驻）声明槽位，注册后即出现在设置导航。

---

## 2. 问题 1：路径无文件夹 / 无文件 / 规则为空时的处理

结论：**已做安全处理，但「目录/空文件的创建」是写路径触发的，不是启动自动化的。**

### 读取端（`src/host/store.ts` RuleStore.list）
- 目录不存在：`fs.readdir(dir)` 抛错 → `catch → return []`（[store.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/src/host/store.ts#L60-L68)）。已有单测覆盖：`目录不存在返回空`（[smoke.test.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/tests/smoke.test.ts#L37-L41)）。**不抛错、不创建目录。**
- 目录存在但空 / 无 `.md`：`rules=[]`。
- 规则文件内容为空：`normalize('')`→`titleOf` 回退 `id`，正文为空串（[store.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/src/host/store.ts#L33-L38)）。

### 注入端（`src/host/injector.ts` RuleInjector）
- `boot()`→`refresh()`→`list('global')`：空目录→空数组→`renderRules` 返回 `''`；`renderFromCache` 未命中回退全局缓存 `?? ''`（[injector.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/src/host/injector.ts#L18-L31)）。空规则不注入任何内容，不报错。
- `watchDir`：对不存在的目录 `watch()` 抛错 → `catch` 忽略（注释：目录不存在，之后 save 会 mkdir，极端情况由下次 assemble 重扫兜底）（[injector.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/src/host/injector.ts#L122-L130)）。

### 写端（`src/host/store.ts` RuleStore.save）
- 首次 `save` 会 `fs.mkdir(dir,{recursive:true})` 自动创建目录，再用 `atomicWrite` 写 `<id>.md`（内容可为空串，仍会写入空文件）（[store.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/src/host/store.ts#L90-L98)）。

### 结论细节
- **读取/注入：目录或文件缺失、规则为空时全部安全，无异常。**
- **创建行为：只在用户通过 UI「+创建/保存」触发 save 时**，才 mkdir 目录 + 写文件；**插件启动/安装阶段不会预创建 `~/.dsh/rules` 或空占位文件**。
- 附带发现：`list` 只接受平铺 `*.md`，软链接/非文件被跳过（安全读取），且按 `id` 排序——与单测一致。

---

## 3. 问题 2：web 启动报错 + 设置面板无本插件设置项

先说明：本仓库（`dsh-rules`）当前**未生成 `lib/` 产物**（`package.json` 的 `main: lib/index.mjs`、`exports["./client"]: ./lib/client.js` 均指向构建产物，当前目录下无 `lib/`）。据此，web 报错与设置项缺失高度可能源于安装/挂载态，而非主仓库注入逻辑本身。列出两种安装场景及其结论：

### 场景 A：开发态 `dsh web --patch ./cordis.yml`
- `cordis.yml` 只插入 **host 半**的源码绝对路径（`insert: id rulebase, name '…/src/host/index.ts'`）。
- host 半正常挂载并做 systemPrompt 注入；**但没有任何 client 包声明**。
- `ClientModuleRegistry` 扫描时 `resolvePkgJson('rulebase')` 对插件的 `name: rulebase` 无法解析成真实包（entry 是文件路径而非包），判定「not a client row」（[client/modules/src/index.ts](file:///o:/工作区/deepseek-harness/packages/client/modules/src/index.ts#L429-L463)）。
- **结果：该路径下设置面板必然不出现**（属设计使然）；此时启动报错的可能性来自别处（见下）。

### 场景 B：发布态作为 bundle 安装进 web profile（`dsh plugin … add <包>` 后 `dsh web`）
- client-modules 读到 `dsh.client.platform:'web'` 且需要 `exports["./client"]` 存在 → 定位 `lib/client.js`。
- 若包发布时未 `npm run build`（`lib/client.js` 缺失），激活期会抛 `MissingClientBundleError`，随后聚合为 `ClientPackageCompositionError`，并在 `ClientModuleRegistry` 构造时机**大声抛错 → 该 fiber FAILED，配合 `installFailLoud`（profile-boot）→ web 启动报错**；即便不致命，客户端加载中断 → **settings.section 永不注册 → 设置面板无本插件项**（[client/modules/src/index.ts](file:///o:/工作区/deepseek-harness/packages/client/modules/src/index.ts#L82-L117) 与 `MissingClientBundleError` 定义）。
- 同理 host `main: lib/index.mjs` 缺失也会导致 host 半加载失败而报错。

### 需核对 / 排除的次要点
- **authority: 'loopback'**（`rpc-handle('/rulebase',…,{authority:'loopback'})`）：经 `rpc-host.ts` 检查，loopback 通道仅允许 loopback authority 调用；`dsh web` 本地以 `localhost/127.0.0.1` 打开时 page authority 即 loopback，**调用可通**；若经 LAN IP（非 loopback）打开页面，该 RPC 会 403。若采用此部署形态，应把 authority 改为 `trusted-host` 或显式受信主机（[rpc-host.ts](file:///o:/工作区/deepseek-harness/packages/client/connection/src/rpc-host.ts#L96-L108)）。
- client 注入 `['slots','connection']`：`connection` 是 client runtime 提供的服务（`ctx.provide('connection', …)`），web 缺省组合已提供，注入名有效。若 web profile 未挂 connection client，则 `apply` 内 `ctx.connection.rpc.call(…)` 会因未注入而报错并连带不注册设置区——需在实机确认 web profile 已含 connection。

### 结论
- **web 报错 + 设置项缺失最可能就是「安装的包未构建（缺 lib/）」**；在 `cordis.yml` 开发挂载方式下，设置面板本就加载不到 client 半。
- 需在已安装的 profile 上验证：`lib/index.mjs`、`lib/client.js` 是否随包发布、`dsh.client` 是否 `web`、浏览器控制台是否出现 `client-modules: … failed to compose`。

---

## 4. 问题 3：tui（dsh-tui）安装与注入机制与 web 是否一致

### 定位
- 本工作区（`deepseek-harness`）只含 `apps/cli`(dsh) 与 `apps/web`（前端）；`PROFILE_TEMPLATES` 仅 `web`、`headless`，**没有 tui**（[profile.ts](file:///o:/工作区/deepseek-harness/packages/boot/app-boot/src/profile.ts#L113-L117)）。真实 tui 是独立的 **dsh-tui** 二进制，走同一套 profile/bundle 机制（`dsh --profile tui`）。

### 结论：机制「host 一致、client 分开」

**host 半（规则注入）——与 web 完全一致：**
- 规则注入走 `ctx.inject(['systemPrompt'], …)` + `agent/created`/`agent/disposed` 会话钩子 + 文件监听（[injector.ts](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/src/host/injector.ts#L96-L120)），全部是 cordis host 侧能力，**与前端形态无关**。
- 只要把插件列为 tui profile 的 bundle（`dsh.profile.bundles` + `cordis.patch.yml` 的 `id: rulebase/name: rulebase`），host 半即在 TUI 内加载并注入规则。
- 前提是 host `lib/index.mjs` 已构建、且 TUI 进程能解析该 bundle 的 peer（cordis 等）。

**client 半（设置面板与 RPC 桥）——TUI 不生效（预期）：**
- 插件声明 `dsh.client.platform:'web'`（[package.json](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/package.json#L29-L34)）。client-modules 只在 `platform==='web'` 时纳入扫描（[client/modules/src/index.ts](file:///o:/工作区/deepseek-harness/packages/client/modules/src/index.ts#L447-L450)）。
- TUI 无浏览器，不加载 client bundle → **不会有设置面板**，`/rulebase` 的设置 CRUD 界面在 TUI 中天然缺失。
- host 侧 `ctx.inject(['connection'], …)` 需要 `webServer` 提供的 connection host 服务（rpc-host）才能注册 `/rulebase` 通道；TUI/headless 无 webServer，则该注册回调不会执行——**规则注入不受影响，只是设置项管理入口在 TUI 不存在**。

### 与 web 的差异归纳
| 能力 | web | tui(dsh-tui) |
|:--|:--|:--|
| systemPrompt 规则注入 | ✅ | ✅（同 host 机制） |
| 规则文件读写（磁盘） | ✅ | 可作用于磁盘（无 UI 入口） |
| 设置面板「规则」区 | ✅ | ❌（client web-only，不加载） |
| `/rulebase` RPC 管理通道 | ✅（需 connection/webServer） | ❌（TUI 无 webServer/connection） |

> 结论：**不是 web 与 tui 注入不一致，而是「client/UI 能力」本就按平台分档**。rulebase 声明为 web 平台，故 TUI 仅保有 host 注入能力，这与 allMemory 参照插件的 dual-mode 设计语义一致（allMemory 也以 `platform:'web'` 提供设置面板，host 侧工具/注入 TUI 可用）。

---

## 5. 建议（供后续处理）

1. **发布/安装前务必 `npm run build`**，确认随包含 `lib/index.mjs` 与 `lib/client.js`；这是 web 报错与设置项缺失最直接的致因。
2. 若仍需「开发态看到设置面板」：`cordis.yml` 开发挂载只投 host 半，无法加载 client；需改用「已建 `lib` 后作为 bundle 挂入 web profile」的路径。
3. 核对 `authority:'loopback'` 是否满足部署（若非本地访问需改 `trusted-host`）。
4. 在实机 profile 上核对：`dsh web --dump-config`/`--dump-default-config` 确认 `rulebase` 是否进入 bundle 层、浏览器 console 是否有 `client-modules … failed to compose`、`settings.section` 是否有 `rulebase` 注册。
5. 若「TUI 也要能管理规则」，需另行提供 TUI 入口（如 CLI 命令或 TUI 面板），因为当前 client 为 web-only。

---

## 附：证据文件索引

- 插件 host：`src/host/{index,injector,service,store,paths}.ts`
- 插件 client：`src/client/{index,controller,RuleSection,types}.ts`、`package.json`、`cordis.yml`、`cordis.patch.yml`
- host 加载：`deepseek-harness/packages/extensions/cordis-host-runner`；profile 堆叠 `packages/boot/app-boot/src/{profile,index}.ts`、`apps/cli/src/{bin,args,profile-boot,plugin}.ts`
- client 加载：`packages/client/modules/src/index.ts`、`src/client/system.ts`；slot：`packages/client/ui-settings/src/client/contract/slots.ts`、`extensions/ui-cordis/src/client/slot-catalog.ts`、`packages/client/ui-slots/src/renderer.ts`
- 连接 RPC：`packages/client/connection/src/{rpc-host,rpc,index}.ts`、`src/client/index.ts`
- 参照插件：`allMemory/src/{host,client}/index.ts`、`allMemory/docs/api/08-插件装配与客户端.md`
- 事后教训：`deepseek-harness/docs/postmortem/0001-acp-default-export-drops-inject.md`