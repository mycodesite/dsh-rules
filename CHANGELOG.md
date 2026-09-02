# Changelog

本项目的所有显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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