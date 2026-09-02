# RuleBase

> DeepSeek Harness (dsh) 插件：全局 + 项目两级 Markdown 规则注入

以「全局 + 项目」两级 Markdown 规则文件为源，在每次对话开始 / 每次系统提示词组装时把规则注入给 AI，并在 dsh 设置面板提供可视化规则管理界面。

规则仅以 `.md` 文件持久化，**不注册 dsh settings 命名空间、不写入 `settings.yaml`**。

[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/mycodesite/dsh-rules/releases)

## 功能

- **注入**：启动时扫描全局规则；每个新对话按 `agent.session.header.cwd` 扫描项目规则；全局 + 项目全量组装、全量替换，注入系统提示词。
- **项目路径识别**：以「最近活跃 agent 的 `session.header.cwd`」作为当前项目路径（`currentCwd`），dsh 切换项目后自动跟随；无活跃 agent 或无有效 cwd 时视为「未选定项目」。
- **即变即用**：文件监听 + `agent.inject()`；保存规则后下一次模型请求自动采用。
- **管理界面**：设置面板「规则」区支持全局 / 项目 tab、新建（下拉选全局/项目）、编辑（单击行或设置菜单）、删除、刷新；设置菜单与新建下拉在点击其它区域自动关闭，配色随 dsh 亮/深外观自动切换（`--dsw-alias-*` 主题 token）；项目 tab 在未选定项目时提示「请先开启一个项目对话」，保存项目规则时无项目会弹窗提示。

## 存储位置

| 级别 | 目录 |
|:--|:--|
| 全局 | `~/.dsh/rules/*.md` |
| 项目 | `<cwd>/.dsh/rules/*.md` |

每个 `.md` 文件即一条规则；文件名（去扩展名）作为规则 id。

## 安装与运行

> ⚠️ **不要在插件市场更新本插件**。插件市场中升级的**不是本插件**，而是与之同名的**其他项目**。本插件**未打包至 npm**，但 npm 上有**重名项目**；下载安装该重名包会使 DeepSeek Harness **无法启动**。请始终通过下文的 GitHub 源或本地 tarball 安装本插件。

### 发布态（从 GitHub 安装）

```bash
# 最新版（git 源安装，仓库含预构建产物，安装即用）
dsh plugin add github:mycodesite/dsh-rules

# 指定版本
dsh plugin add github:mycodesite/dsh-rules#v0.1.2

# 指定 profile（web / tui 等）
dsh plugin --profile web add github:mycodesite/dsh-rules

dsh plugin --profile dsh-tui add github:mycodesite/dsh-rules
```

> **注意**：`dsh plugin` 是 pnpm 转发器。发布包已含预构建产物（`lib/`），git 源安装即装即用，**无需**在 profile 的 `pnpm-workspace.yaml` 中放行构建脚本（`allowBuilds`）。

也可以下载 [GitHub Releases](https://github.com/mycodesite/dsh-rules/releases) 中的最小化 tarball（仅含构建产物与 patch），本地安装：

```bash
dsh plugin add /path/to/rulebase-<版本>.tgz

# 指定 profile 安装本地包
dsh plugin --profile <模式> add /path/to/rulebase-<版本>.tgz
```

### 安装矩阵

| 安装方式 | 命令 | 需构建 | 需该目录有 `node_modules` | 新环境 |
|:--|:--|:--|:--|:--|
| **tarball**（推荐分发） | `dsh plugin add /abs/rulebase-<v>.tgz` | 否 | 否 | ✅ |
| **GitHub**（推荐分发） | `dsh plugin add github:mycodesite/dsh-rules#v<tag>` | 否（`lib/` 已入库） | 否 | ✅ |
| **link:（开发态）· 源码树已构建** | `cd <checkout> && dsh plugin add .` | **是**（先 `npm run build`） | **否**（v0.1.2 起） | ⚠️ 需先构建 |
| **link:（开发态）· 源码树未构建** | 同上 | — | — | ❌ 无 `lib/` 即失败（与依赖无关） |
| **开发态 overlay** | 见下节（直接挂 `src/`） | 否 | 否（v0.1.2 起） | ⚠️ |

> **运行时零依赖带来的改变（v0.1.2 起）**：已构建的源码树以 `link:` 安装时，**不再需要该目录下有 `node_modules`**。构建本身仍需 devDependencies（`tsdown` / `esbuild`）——这是开发期依赖，正常且不可避免。

### 卸载

```bash
# web profile
dsh plugin --profile web remove rulebase

# tui profile
dsh plugin --profile dsh-tui remove rulebase
```

> **注意**：`remove` 的参数必须用**注册名（包名）`rulebase`**，不能用安装源写法（如 `mycodesite/dsh-rules`、`github:mycodesite/dsh-rules`、`dsh-rules`）。`dsh plugin` 是 pnpm 转发器，`remove` 按 profile `package.json` 中依赖的 **key** 匹配——该 key 是 pnpm 安装时解析出的包名 `rulebase`，与安装时使用的源写法无关；用源写法会报 `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS: no such dependency found`（web 与 tui 行为一致）。卸载后 `dsh.profile.bundles` 层也会自动移除该插件。

### 开发态（源码直接挂载）

```bash
npm install
node scripts/make-dev-patch.mjs          # 生成 cordis.local.yml（git 忽略，不提交）
dsh web --patch ./cordis.local.yml       # web 模式
dsh --profile dsh-tui --patch ./cordis.local.yml  # tui 模式
```

> `.npmrc` 中已配置 `legacy-peer-deps=true`，开发态安装无需手动传 `--legacy-peer-deps` 标志。

`cordis.local.yml` 由脚本按仓库绝对路径生成，仓库内不写死本机路径，克隆后可移植。

## 脚本

| 命令 | 说明 |
|:--|:--|
| `npm run build` | 构建 host 半（tsdown → `lib/index.mjs`）+ client 半（esbuild → `lib/client.js`）+ 产物守卫（`check:artifact`） |
| `npm run typecheck` | 类型检查（host + client 两个 project） |
| `npm test` | 运行单测（`tests/*.test.ts`：smoke 端到端护栏 + contract 契约护栏） |
| `npm pack` | 产出最小发布 tarball（`files` 白名单） |
| `node scripts/release.mjs` | typecheck + test + build + pack 一键发布准备 |
| `node scripts/make-dev-patch.mjs` | 生成开发态补丁 `cordis.local.yml` |
| `npm run sync-dsh` | 同步 devDependencies 到 DSH 最新预发布版（`next` 通道） |
| `npm run update-dsh` | 同步 + 安装 |
| `npm run check-deps` | 严格模式验证依赖兼容性（CI 用） |

## 目录结构

```
src/
├─ host/
│  ├─ index.ts       # 装配入口（apply）：store / injector / service
│  ├─ paths.ts       # 规则级别与目录解析
│  ├─ store.ts       # RuleStore：md 文件读写
│  ├─ injector.ts    # RuleInjector：注入与刷新（异步读盘 + 同步读缓存）
│  └─ service.ts     # RulesService：Connection RPC 桥（UI↔host）
├─ client/
│  ├─ index.ts       # 注册 settings.section
│  ├─ types.ts       # 最小类型（Rule / RpcResult）
│  ├─ controller.ts  # RuleController：列表状态机 + rpc 客户端
│  └─ RuleSection.tsx# 设置面板「规则」区 UI
scripts/
├─ build-client.mjs     # client 半 esbuild 构建
├─ make-dev-patch.mjs   # 生成开发态补丁
├─ release.mjs          # 发布准备（typecheck+test+build+pack）
└─ sync-dsh-deps.mjs    # 自动跟随 DSH next 通道同步 devDeps
tests/
└─ smoke.test.ts        # RuleStore 全量读写 / 路径解析
docs/
├─ API文档.md           # 模块 API 总览
└─ api/                 # 分模块文档
.github/workflows/ci.yml # CI：typecheck + test + build + pack（tag 自动发 Release）
```

## 文档

- 模块 API：见 [docs/API文档.md](docs/API文档.md) 与 [docs/api/](docs/api/)。
- 变更记录：见 [CHANGELOG.md](CHANGELOG.md)。

## 环境要求

- Node.js `>= 22.5`
- **运行时零依赖**：本插件对 `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis` 仅有**编译期类型依赖**（`import type`，转译后擦除）；宿主契约函数（`createUserMessage` / `transportError`）已在 `src/host/contract.ts` 本地逐字实现。因此任意安装形态、任意新环境（包括无 `node_modules` 的目录）均可直接运行，不依赖宿主依赖闭包。
- **构建期守卫**：`npm run build` 内置产物检查（`check:artifact`），产物含任何 `@deepseek-ai/*` 运行时导入即构建失败——这是本插件的核心安全不变量，由 CI 与 `npm pack`（prepack → build）双重覆盖。

## 许可

[MIT](LICENSE) © mycodesite
