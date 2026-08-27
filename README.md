# RuleBase

dsh 插件：以「全局 + 项目」两级 Markdown 规则文件为源，在每次对话开始 / 每次系统提示词组装时把规则注入给 AI，并在 dsh 设置面板提供可视化规则管理界面。

规则仅以 `.md` 文件持久化，**不注册 dsh settings 命名空间、不写入 `settings.yaml`**。

## 存储位置

| 级别 | 目录 |
|:--|:--|
| 全局 | `~/.dsh/rules/*.md` |
| 项目 | `<cwd>/.dsh/rules/*.md` |

每个 `.md` 文件即一条规则；文件名（去扩展名）作为规则 id。

## 功能

- **注入**：启动时扫描全局规则；每个新对话按 `agent.session.header.cwd` 扫描项目规则；全局 + 项目全量组装、全量替换，注入系统提示词。
- **项目路径识别**：以「最近活跃 agent 的 `session.header.cwd`」作为当前项目路径（`currentCwd`），dsh 切换项目后自动跟随；无活跃 agent 或无有效 cwd 时视为「未选定项目」。
- **即变即用**：文件监听 + `agent.inject()`；保存规则后下一次模型请求自动采用。
- **管理界面**：设置面板「规则」区支持全局 / 项目 tab、新建（下拉选全局/项目）、编辑（双击或菜单）、删除、刷新；项目 tab 在未选定项目时提示「请先开启一个项目对话」，保存项目规则时无项目会弹窗提示。

## 安装与运行

### 开发态（源码直接挂载）

```bash
npm install --legacy-peer-deps
dsh web --patch ./cordis.yml          # 或 dsh --profile tui --patch ./cordis.yml
```

`cordis.yml` 把 `src/host/index.ts` 按绝对路径挂载；`--patch` 叠加到当前 profile。

### 发布态（作为 bundle）

```bash
npm run build
```

构建产物 `lib/` 与 `cordis.patch.yml`（`id: rulebase`、`name: rulebase`）随包发布；在 dsh profile 中列出该 bundle 即挂载。

## 脚本

| 命令 | 说明 |
|:--|:--|
| `npm run build` | 构建 host 半（tsdown → `lib/index.mjs`）+ client 半（esbuild → `lib/client.js`） |
| `npm run typecheck` | 类型检查（host + client 两个 project） |
| `npm test` | 运行单测（`tests/smoke.test.ts`） |

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
tests/
└─ smoke.test.ts     # RuleStore 全量读写 / 路径解析
```

## 文档

- 各模块详细 API：见 [docs/API文档.md](docs/API文档.md) 与 `docs/api/` 下的分模块文档。
- 设计方案与审核记录：见 `.trae/documents/`。

## 环境要求

- Node.js `>= 22.5`
- 依赖 `@deepseek-ai/dsh-*`（dsh 生态）与 `@deepseek-ai/cordis`