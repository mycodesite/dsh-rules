# Changelog

本项目的所有显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.9] - 2026-10-05

### Fixed

- **规则库注入段补齐结束边界标记**（任务031，调查报告-031 / 裁决-031）：此前 `rulebase:rules` 段
  （order 170）以最后一条规则正文结尾、无结束标记，紧随其后的 VCP 段（order 200）等非规则库内容
  易被 LLM 误归入"规则库"。现 `renderRules` 在返回值最外层加全角成对标记 `［规则库开始］` /
  `［规则库结束］`，使规则域成为文本自证的闭合区间。
  - 空态（全局 + 项目皆无规则）不再返回 `''`（原被宿主 `renderPrompt` filter 丢弃致引导句悬空），
    改输出占位 `（当前无全局规则与项目规则）` + 成对标记。
  - 超限截断只作用于正文 body，边界标记恒在截断之外、恒在输出首尾。
  - `GUIDANCE` 静态段（order 160）零改动，KV Cache 前缀不变。
  - 标记文案经全库实测零碰撞（规则域 / 宿主段 / VCP 段均不含 `［规则库开始］`/`［规则库结束］`），
    不含花括号（避开宿主 `interpolate()` 抛错）。

### Changed

- `MAX_TOTAL_BYTES` 注释澄清：该阈值限制的是正文 body 字节数，首尾边界标记在截断之外不计入
  （溢出约 40 字节，可忽略）。
- 测试：新增 `tests/injector-boundary.test.ts`（满态/仅全局/仅项目/空态/截断/恰好阈值/插值守卫/
  撞词守卫共 8 例）；既有 `tests/injector-reload.test.ts` 6 例不受破坏（断言为 inject 次数与
  `includes('项目预置规则')`，不依赖全文形态）。
- 文档连动：`docs/api/03`（GUIDANCE 说明、renderRules 说明、renderFromCache 空态回退、截断语义）、
  `docs/api/05`（规则正文段边界标记说明）、`README`（版本 badge 0.1.7→0.1.9、安装示例版本号、
  注入功能补边界说明）。
- **首次升级一次性注入**：旧缓存无边界标记、新文本含标记 ⇒ `reload()` 检测到合成文本变化 ⇒
  触发一次 `agent.inject`（良性、一次性，此后稳定）。非空态与空态均如此。
- **U+FFFD 既有缺陷**：`Buffer.subarray` 按字节截断可能切断多字节 UTF-8 字符（既有问题，本版本
  不引入亦不修复，登记备查）。

## [0.1.8] - 2026-09-30

### Fixed

- **设置面板「规则→项目」在多仓切换场景显示错仓规则**（调查报告-001 的缺陷修复）：0.1.6 引入的
  `resolveSessionCwd()` 读的是**不存在的字段** `sessions.list.getSnapshot().current`（dsh 快照只有
  `ids/byId/phase/projectionsBySession`），cwd 恒为 `undefined`、project 级请求恒不带 cwd；随后 host
  回退 `injector.currentProjectCwd()`（「最后注册的 agent」的 cwd——切回 live 会话不重新 announce，
  该量必然偏离当前对话）→ 面板列出一致错仓的规则，且切换对话后不重拉。
  现：client 改用 dsh 官方判据 `retainedBy.mainView > 0`（新增 `mainViewSession` 纯函数，
  workspace/open-in-app/agent-preset/session 六处同源），并以主视图会话 id 作依赖触发重拉
  （`src/client/sessions.ts`、`src/client/index.ts`、`src/client/RuleSection.tsx`）。

### Changed

- **host 移除 `currentProjectCwd()` 猜测式回退**：`RulesService` 项目级读写的 cwd **仅采用 client 传入**；
  无 cwd 时 `list` 返回 `[]`、写操作抛「未选定项目」（文案不变）；`currentCwd` RPC 端点删除
  （host 无法回答「当前对话」，不假装能答）；`RuleController.currentCwd()` 改为纯本地解析、不再发 RPC
  （`src/host/service.ts`、`src/host/injector.ts`、`src/host/index.ts`、`src/client/controller.ts`）。
- 测试：新增 `tests/client-mainview.test.ts`（官方判据 4 例）；`tests/smoke.test.ts` 移除
  `currentProjectCwd`/`currentCwd` 用例并适配「cwd 仅 client 传入」新语义；`tests/controller-rpc.test.ts`
  更新 `currentCwd` 纯本地断言与 op 守卫。
- 文档连动：`docs/api/03`（方法删除说明）、`04`（端点表与 cwd 解析）、`06`（`sessions.ts`、官方判据、
  `currentCwd` 纯本地）、`07`（`sessionsList` 注入与依赖）、`README`（项目路径识别表述）。

## [0.1.7] - 2026-09-30

### Fixed

- **全局规则目录不再写死 `~/.dsh`，改为跟随 `DSH_HOME`**（设计阶段即要求「为与 dsh 统一，优先回读 dsh home」，
  此前未落地）：此前 `globalRulesDir()` 恒为 `os.homedir()/.dsh/rules`，凡 `DSH_HOME` 偏离默认值的实例，
  全局规则都会读写错误配置域（例如测试实例 `DSH_HOME=tests\.dsh` 实际改写的是生产 home 的全局规则）。
  现解析顺序为 **宿主 cordis 服务 `dshHomePath`（与官方 `resolveDshHome` 一致，含 `configured` 覆盖）
  → `$DSH_HOME`（`trim()` 后非空）→ `~/.dsh`**（`src/host/paths.ts`、`src/host/index.ts`）。

### Changed

- **`RuleInjector` 构造函数新增可选第三参 `globalDir`**：`watch()` 取 `this.globalDir ?? globalRulesDir()`，
  消除「store 目录可注入、watcher 却直调 paths」的既有缺口——此前即便覆盖了 store 的全局目录，
  文件监听仍会挂在真实 `~/.dsh/rules`（`src/host/injector.ts`）。
- 装配入口新增并导出 `resolveGlobalRulesDir(ctx)`：装配期解析一次，同时注入 `RuleStore` 与 `RuleInjector`，
  保证读、写、监听三处目录同源（`src/host/index.ts`）。
- 测试增至 53（新增 `tests/paths-dshhome.test.ts` 9 例：`DSH_HOME` 已设 / 未设 / 纯空白 / 带空格 trim /
  相对值绝对化，以及装配层 `dshHomePath` 优先与三种回退）；`tests/smoke.test.ts`、`tests/injector-reload.test.ts`
  改为注入 `globalDir`，**不再对真实 `~/.dsh/rules` 挂 watcher**（历史窗口消除）。
- 文档连动：`docs/api/01`（三层解析契约与 `DSH_HOME` 语义）、`docs/api/02`（`globalDir` 说明）、
  `docs/api/03`（构造第三参、`watch()` 目录来源）、`docs/api/05`（装配第 1 步解析全局目录）、
  `README`（存储位置 + 升级搬迁提示）。

## [0.1.5] - 2026-09-27

### Fixed

- **设置面板「规则」列表项删除无效（根因一：删除目标与操作上下文解绑）**：确认框原只存裸 id，确认期间
  切换「全局/项目」tab 后以当前 tab 级别 + 旧 id 发请求——目标不存在时 ENOENT 被吞伪装成功（原规则纹丝不动），
  两级同名 id 时还会误删另一级别的规则。现升级为 `confirmTarget`（`Rule` 快照，含 `level`/`id`/`title`）：
  删除请求恒携带被删规则归属级别，切 tab 清除残留确认，确认框显示待删规则级别与标题
  （`src/client/RuleSection.tsx`）。
- **设置面板删除假成功（根因二：`store.remove` 吞掉全部 `fs.rm` 错误）**：文件被占用（EBUSY/EPERM）、
  权限不足等真实失败同样返回"成功"。现仅「文件不存在」（ENOENT）幂等返回，其余错误向上抛，经
  `service.dispatch` 的 `transportError` 通道以 200 ok:false 信封返回、UI alert 可见（同 save 失败路径）
  （`src/host/store.ts`）。
- **project 级 remove 无 cwd 静默假成功**：与 create/save 语义对齐，改经 `requireProjectCwd` 显式抛错；
  报错文案按动作名词参数生成（删除场景「无法删除项目规则」），create/save 调用点零改动
  （`src/host/service.ts`）。

### Changed

- 测试 27 → 33：新增 `tests/host-remove.test.ts`（store.remove 幂等保留 / 真实删除 / EBUSY 上抛 /
  dispatch 失败通道 / project 无 cwd 删除文案）与 `tests/controller-rpc.test.ts` remove payload
  精确透传断言（`{ level, id }`）。
- 文档连动：`docs/api/04`（remove 幂等边界 + cwd 语义句「project 无 cwd 抛错（同 create/save）」）、
  `docs/api/07`（`confirmTarget` 状态与删除确认交互描述）。

## [0.1.4] - 2026-09-11

### Fixed

- **重写 RPC 通道注册机制（v0.1.3 的双依赖修复实测无效）**：实机复测证明 `ctx.inject(['connection','webServer'])`
  在 profile 插件 fiber 上**永不触发**（`webServer` 对插件不可达，cordis 对未就绪服务合法无限期 pending 且
  静默无报错，`POST /rulebase/list` 仍 405）。v0.1.4 改用 0.1.5 首方范式：
  `connection.fetch.register` 注册六条 `/api/rulebase/<op>` **精确路由**（内部仅 fetchRoutes.set，
  零 webServer 触碰，owner.effect 失配自动清理）＋本地信封桥 `src/host/bridge.ts`
  （宿主 rpcFetchHandler 语义最小复刻：415/400/信封校验/方法比对，handler 抛错折叠为 200 ok:false 信封；
  零宿主运行时导入）；client 端改 `call('/api', 'rulebase/<op>')`。鉴权经共享 `/api` fence 自动继承。
- v0.1.3 引入的失败可见化加固（callSafe 折叠/lastError/busy 双保险）实机验证**有效**，原样保留。

### Changed

- `rpc.intercept('/api')` 路线经源码级核实不可用（api-gateway 已独占该 channel 唯一 interceptor，
  二次注册 fail-loud）；独立前缀 channel `/rulebase` 形态在 0.1.5 插件场景废弃（webServer 可达性不变量）。
- 测试 21 → 27：新增 `tests/bridge.test.ts`（信封桥六分支）；host 守卫断言改为
  fetch.register×6 形态（防 `rpc.handle`/`webServer` 依赖回潮）。

## [0.1.3] - 2026-09-11

### Fixed

- **dsh 0.1.5 适配：规则设置面板"加载中…/保存中…"永久挂起**。0.1.5 起 client-connection 启动依赖由
  `['webServer']` 改为 `['credentials']`，`connection` 服务先于 `webServer` 可用；插件 host 半在
  `ctx.inject(['connection'])` 回调中调用 `rpc.handle()` 时，其内部 `owner.webServer.register` 因
  `webServer` 未就绪抛 TypeError，`/rulebase` RPC 通道静默丢失（浏览器端 405）。
  修复：host 半改为 `ctx.inject(['connection', 'webServer'])` **双依赖延迟注册**
  （`src/host/index.ts`）。
- **失败可见化（消灭无限转圈）**：client 半 `RuleController` 全部 6 个 RPC 调用点收敛到 `callSafe`
  出口——传输层异常折叠为 `ok:false`（`code: 'rulebase/transport-error'`），方法**永不 reject**；
  失败信息写入 `lastError`，`getLastError()` 供 UI 呈现；`load` 失败走既有 error 态，
  `create/save/remove` 失败经 `window.alert` 提示（删除确认框失败时保留）；
  `submitEdit`/`doRemove`/`reload` 以 `try/finally` 保证 busy 永复位。

### Changed

- **清理废弃 API**：删除 `rpc.handle` 第三参 `{ authority: 'loopback' }`（0.1.5 两参签名下已废弃，
  鉴权由传输层 BrowserAuth 401 + Host/Origin fence 403 统一接管）。
- **宿主版本支持线**：声明 **dsh ≥0.1.5-rc.1**（peer `@deepseek-ai/dsh-client-connection >=0.1.5-rc.1`、
  devDep 类型基准 `^0.1.5-rc.1`、contract.ts 契约头注、README 三处一致）；0.1.5 以下宿主不在支持范围。
- **测试**：新增 `tests/controller-rpc.test.ts`（reject 折叠 / getLastError 生命周期 /
  code 契约 / host 注册守卫），8 → 21 用例全绿；typecheck / build / check-artifact 门禁通过。

## [0.1.2] - 2026-09-03

### Fixed

- **`link:` 安装后 dsh 无法启动（依赖解析失败）**：产物不再保留任何 `@deepseek-ai/*`
  运行时导入——宿主契约函数（`createUserMessage` / `transportError`）改为本地逐字实现
  （`src/host/contract.ts`），宿主包全部退化为编译期 `import type`。
  此前以 `link:` 形态安装时，符号链接 realpath 逃逸使 Node 绕过宿主依赖兜底层，
  裸导入直接 `ERR_MODULE_NOT_FOUND` 并放大为 dsh 启动失败。

### Added

- **构建期守卫**：`scripts/check-artifact-imports.mjs` 串入 `npm run build`
  （覆盖 CI 与 `prepack`），产物含宿主包运行时导入即构建失败。
- **契约单测**：`tests/contract.test.ts` 7 项，护栏化契约等价性
  （role 固定 / UUID v4 / 结构化克隆脱钩 / 深度冻结 / transportError 分支）。
- **CI 门禁**：`check:artifact` 显式步、无 `node_modules` 隔离导入（决定性判据）、
  `lib/` 与 `src/` 同步校验。
- **运行时零依赖**：任意安装形态（GitHub / tarball / `link:`）、任意新环境
  （含无 `node_modules` 目录）均可直接运行；README 补安装矩阵与依赖模型说明。

### Changed

- 回写《插件发布规范》：发布后验收扩为三路径（git 源 + tarball + `link:`）；
  新增 optional 治理纪律（禁止用 `peerDependenciesMeta.optional` 消除告警）。

## [0.1.1] - 2026-08-29

### Changed

- **依赖版本冲突修复**：将所有 `@deepseek-ai/dsh-*` devDependencies 与 peerDependencies
  统一到 `0.1.1-rc.2`，消除 git 直装时因两代版本混挂导致的 ERESOLVE。
- **新增构建脚本**：`sync-dsh` / `update-dsh` 自动跟随 DSH `next` 通道同步依赖；
  `check-deps` 提供 CI 严格校验入口。
- **peer 优化**：新增 `peerDependenciesMeta`，将 `dsh-client-connection`、
  `dsh-host-apiproxy` 标记为可选，消除 tui profile 安装时的 peer 警告。
- **安装兜底**：新增 `.npmrc` `legacy-peer-deps=true`。
- **预构建产物入库**：`lib/` 提交入库、移除 `prepare` 脚本（构建改由 `prepack` 负责），
  git 源安装与其他插件一致，无需 pnpm `allowBuilds` 放行。

## [0.1.0] - 2026-08-27

初始公开发布。dsh 插件「RuleBase」：全局 + 项目两级 Markdown 规则注入。

### Added

- **规则注入**：启动时扫描全局规则（`~/.dsh/rules/*.md`）；每个新对话按活跃 agent 的
  `session.header.cwd` 扫描项目规则（`<cwd>/.dsh/rules/*.md`）；全局 + 项目全量组装、全量替换，
  注入系统提示词。
- **项目路径识别**：以最近活跃 agent 的 cwd 作为 `currentCwd`，dsh 切换项目后自动跟随；
  无有效 cwd 时视为「未选定项目」。
- **即变即用**：文件监听 + `agent.inject()`，保存规则后下一次模型请求自动采用。
- **管理界面**：设置面板「规则」区，支持全局 / 项目 tab、新建、编辑、删除、刷新；
  配色随 dsh 亮 / 深外观自动切换。
- **RPC 桥**：`/rulebase` Connection RPC 通道（`authority: 'loopback'`，仅本机访问）。
- **存储安全**：规则仅以 `.md` 文件持久化，不注册 dsh settings 命名空间、不写入 `settings.yaml`；
  空目录 / 空文件 / 空规则场景启动安全。
- **工具链**：tsdown host 构建（ESM + `.d.ts`）、esbuild client 构建（`__ModuleLoader__` 格式）、
  smoke 测试、GitHub Actions CI（typecheck + test + build + pack）。

### Fixed

- `link:` 安装模式下补全 dsh 运行时 peer 依赖（`@deepseek-ai/dsh-*` 系列 devDependencies），
  修复 host 加载失败。
- 设置面板交互细节（单击编辑、菜单外部关闭、刷新按钮配色跟随）与深色主题适配。
- 多项目切换场景下项目路径识别、规则存取与注入的一致性。

### Changed

- 开发态 overlay 改为生成式：`node scripts/make-dev-patch.mjs` 生成 `cordis.local.yml`（不提交），
  消除仓库内本机绝对路径。