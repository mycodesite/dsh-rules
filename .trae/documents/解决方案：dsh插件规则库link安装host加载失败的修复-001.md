# 解决方案：dsh插件规则库link安装host加载失败的修复-001

> 关联：测试报告-001（`测试报告：dsh插件规则库实际安装测试-001.md`）、调查报告-001
> 日期：2026-08-27 · 状态：**已实现并验证通过**

---

## 1. 问题定位

在「实际安装测试」中发现，rulebase 以 `link:` 方式安装进 dsh profile 后，web 启动出现：

```
[loader-isolation] entry rulebase (rulebase) failed to apply: Error:
Cannot find package '@deepseek-ai/dsh-timeout' imported from
O:\mcpFs\dsh-plugin-build\dsh-rules\node_modules\@deepseek-ai\dsh-llm\lib\index.js
```

**根因**：`link:` 场景下，插件的 peer（如 `@deepseek-ai/dsh-llm`）从**插件仓库自身 node_modules** 解析。而 host 半运行时真正用到的两个值导入包中，`@deepseek-ai/dsh-llm@0.0.1-rc.1` 声明了 4 个运行时 peer（`dsh-attachment`、`dsh-brand`、`dsh-invariants`、`dsh-timeout`），rulebase 的 devDependencies 此前**未声明这些包**，节点解析 `dsh-llm` 时在插件仓库根目录找不到 `dsh-timeout` → 直接抛错。

（对比：同环境的 allMemory 之所以正常，是因为其 devDependencies 声明了几乎整套 `@deepseek-ai/*`，链接解析时仓库 node_modules 已具备全部依赖。）

---

## 2. 方案与决策

### 2.1 决策 1（是）：修复 `link:` 安装 —— 补全 dsh 运行时依赖（已实施）

在 [package.json](file:///o:/mcpFs/dsh-plugin-build/dsh-rules/package.json#L50-L61) 的 devDependencies 中补入 host 运行时所依赖 dsh 包的 peer（版本与现有 dsh-llm 一致 `^0.0.1-rc.1`）：

```json
"@deepseek-ai/dsh-attachment": "^0.0.1-rc.1",
"@deepseek-ai/dsh-brand":        "^0.0.1-rc.1",
"@deepseek-ai/dsh-invariants":   "^0.0.1-rc.1",
"@deepseek-ai/dsh-timeout":      "^0.0.1-rc.1",
```

- 说明：仅补 `dsh-llm` 的 4 个运行时 peer。host 半其余的 `@deepseek-ai/dsh-agent`、`dsh-system-prompt`、`dsh-client-connection` 均为**类型导入**，构建时被擦除，无需运行时可解析；`dsh-host-apiproxy/api` 的 `transportError` 经其自身 `dependencies` 安装即可解析，实测无需额外补 peer。
- 这些是 devDependencies，**不进入发布 tarball**（`files` 仅含 `lib`、`cordis.patch.yml`、`README.md`），不影响发布态安装。

### 2.2 决策 2（仅本地访问）：保留 `authority:'loopback'`，不改动（已确认）

- 使用形态为**仅本机访问**，`/rulebase` 通道维持 `{ authority: 'loopback' }` 即可——只放行回环主机（localhost/127.*/[::1]），外部网络即使可达也 **403**，能保护可增删改规则文件（写磁盘）的接口。
- **无需**改为 `trusted-host`，也无需配置 `trustedHosts`。无代码改动。

### 2.3 决策 3（无须 tui 命令）：不新增 tui 管理命令（已确认）

- tui（dsh-tui）可直接在终端增删改规则 `.md` 文件，**无需专门的规则管理界面或额外命令**。无代码改动。

---

## 3. 实施与验证

### 3.1 变更
- `package.json`：devDependencies 新增 4 项（见 §2.1）。
- `npm install --legacy-peer-deps`：`added 4 packages`，锁定文件随之更新。

### 3.2 验证（隔离 profile `rbtest`，`link:` 方式重装）
| 检查项 | 结果 |
|:--|:--|
| 启动是否有 `failed to apply` 报错 | ✅ 无（此前必现） |
| `GET /plugins/rulebase/client.js` | ✅ 200 |
| `__DSH_BOOT__` 图是否含 rulebase 条目 | ✅ 含（`id:"rulebase"`） |
| 设置面板「规则」区注册 | ✅ 已组合托管，可注册 |

---

## 4. 影响与注意

- 本修复作用于**开发态 `link:` 安装**；发布态（构建产物装入 profile，已由测试报告-001 的路径 C 验证正常）不受影响，亦不做改动。
- 后续在插件仓库新增 host 依赖新的 dsh 包时，若其在 `link:` 下运行时报 `Cannot find package '@deepseek-ai/dsh-...'`，按同法将该包 declare 进 devDependencies即可（dsh-llm 的 peer 已内置这批）。
- 第 2、3 项为「维持现状、不开发额外功能」的决策，符合简洁优先原则。

---

## 5. 关联文档
- `.trae/documents/测试报告：dsh插件规则库实际安装测试-001.md`
- `.trae/documents/调查报告：dsh插件规则库web与tui加载问题-001.md`