# 解决方案：dsh profile pnpm store版本不匹配的修复与规则库安装-001

> 关联：测试报告-001、解决方案（link 安装 host 加载失败修复）-001、调查报告-001
> 日期：2026-08-27 · 状态：**已在真实 web profile 落地并验证**

---

## 1. 背景与现象

在向真实 dsh profile 安装插件时，`dsh plugin --profile web add <pkg>` 直接失败：

```
[ERR_PNPM_UNEXPECTED_STORE] Unexpected store location
The dependencies at "…\profiles\web\node_modules" are currently linked from the store at "G:\.pnpm-store\v10".
pnpm now wants to use the store at "G:\.pnpm-store\v11" to link dependencies.
```

**根因**：该 profile 的 `node_modules` 由旧版 pnpm 的 store（`v10`）链接；当前 pnpm（11.x）使用 `v11` store。pnpm 为防污染要求 store 控制器版本一致，版本不一致时拒绝写入。这是**纯安装工具链问题**，与 rulebase 插件本身无关。

---

## 2. 修复方案（pnpm store 一致性）

依据 pnpm 自身建议：用**当前 pnpm 重链接**该 profile 的 `node_modules`（pnpm 会移除以已变 store 作为依据的旧模块并重建，从 lockfile 复用/拉取）。

### 关键点
- **非交互**：关掉 pnpm 的“移除并重装”确认提示 → `--config.confirmModulesPurge=false`。
- **放行构建脚本**：profile 含 git 依赖（`dsh-mcp-manager`、`dsh-raw-html`、`dsh-session-delete`）其 prepare 脚本需放行 → `--config.dangerouslyAllowAllBuilds=true`。
- 不改 `store-dir`（`v10/v11` 由 pnpm 版本决定，改地址无效）；不改 registry。

### 修复命令（在 profile 目录执行）
```powershell
cd "G:\SOFTAI\deepseek-harness\Admin\.dsh\profiles\web"
pnpm install --config.confirmModulesPurge=false --config.dangerouslyAllowAllBuilds=true
```

### 验证结果（本次实测）
- 重链接成功、退出码 0，`lockfile` 未变，仅重建缺失的链接（7包、7.9s）。
- 修好后即可继续 `dsh plugin --profile web add …` 正常安装插件。

---

## 3. 自愈脚本（面向未来复用）

完整过程封装为可重复执行的脚本：

**[修复dshPnpmStore.ps1](scripts/修复dshPnpmStore.ps1)**（位于 `.trae/documents/scripts/`）

脚本功能（含参数）：
1. 定位目标 profile 目录（默认 `web`，`$DshHome` 默认 `G:\SOFTAI\deepseek-harness\Admin\.dsh`）。
2. 修复 store：在当前目录内执行上面的 pnpm install（非交互、放行构建）。
3. 安装插件：`dsh plugin --profile <Profile> add link:<PluginDir>`（默认把 rulebase 装进 web）。
4. 校验：确认 `rulebase` 已进入 `dsh.profile.bundles` 与 `dependencies`。

用法：
```powershell
powershell -ExecutionPolicy Bypass -File ".trae\documents\scripts\修复dshPnpmStore.ps1"
# 仅修 store、不装插件时：加 -SkipAddPlugin
```
已在真实环境执行一遍，**幂等且通过**（重跑 pnpm install 与 dsh plugin add 均为“Already up to date”）。

### 运维规则：pnpm 大版本升级后必须重链接（永久解决）

store 版本（`v10`/`v11`/…）由 **pnpm 大版本**决定，改 store-dir 地址无效（base 不变，子目录仍按版本分）。每次 pnpm 跨大版本升级后，既有 profile 的 `node_modules` 仍链接旧 store，会再次触发 `ERR_PNPM_UNEXPECTED_STORE`。

**永久规则（两条结合）**：
1. **治本**：固定 pnpm 大版本——不随意 `pnpm self-update` 跨大版本升级；只要 pnpm 保持同一大版本，所有 profile 的 store 版本一致，永不冲突。
2. **兜底**：每次 pnpm 大版本升级后，对每个 profile 依次执行一次脚本（只修 store、不装插件）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File ".trae\documents\scripts\修复dshPnpmStore.ps1" -Profile <profile名> -SkipAddPlugin
   ```
   脚本幂等：lockfile 未变时仅重链接、复用现有 store，无需重新下载。

> 一句话规则：**“pnpm 大版本一升级，先对每个 profile 跑一遍 修复dshPnpmStore.ps1”**。

---

## 4. rulebase 装进真实 web profile 的落地结果（本次）

| 检查项 | 结果 |
|:--|:--|
| 修复 pnpm store | ✅ 已重链接到 v11 |
| `dsh plugin --profile web add link:…/dsh-rules` | ✅ rulebase 进入 bundles + 依赖 |
| 真实 `dsh --profile web` 启动 | ✅ 无 rulebase apply 报错 |
| `/plugins/rulebase/client.js` | ✅ 200 |
| 页面 `__DSH_BOOT__` 含 `rulebase` | ✅ 含 |

> 说明：rulebase 以 `link:` 安装（与 allMemory 一致）。其 host 运行时依赖 `dsh-llm` 的 4 个 peer 已在插件仓库 devDependencies 补齐（见“解决方案-001：link 安装 host 加载失败修复”），故 link 场景可正常解析、host 不再报错。

---

## 5. 关联文档
- `.trae/documents/解决方案：dsh插件规则库link安装host加载失败的修复-001.md`
- `.trae/documents/测试报告：dsh插件规则库实际安装测试-001.md`
- `.trae/documents/调查报告：dsh插件规则库web与tui加载问题-001.md`