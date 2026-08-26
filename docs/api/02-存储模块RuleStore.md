# 02-存储模块 RuleStore（`src/host/store.ts`）

规则 md 文件的读写与全量扫描。规则**不注册 dsh settings**，唯一事实源是磁盘 `.md` 文件。

## 导出

### 常量 `MAX_TOTAL_BYTES`

```ts
const MAX_TOTAL_BYTES = 256 * 1024 // 256 KiB
```

合成结果的字节数上限，防止单文件极大或文件数量异常导致提示词暴涨。由 `RuleInjector` 在合成时做截断。

### 接口 `Rule`

```ts
interface Rule {
  id: string        // 稳定 id：文件名去扩展名
  title: string     // 标题：md 首个 H1/首行，无则用 id
  content: string   // 正文：md 文件完整内容（已归一化换行）
  level: RuleLevel  // 所属级别
  filePath: string  // 文件绝对路径
}
```

### 类 `RuleStore`

```ts
class RuleStore {
  constructor(globalDir?: string)
  list(level: RuleLevel, cwd?: string): Promise<Rule[]>
  save(level: RuleLevel, id: string, content: string, cwd?: string): Promise<Rule>
  remove(level: RuleLevel, id: string, cwd?: string): Promise<void>
}
```

#### `constructor(globalDir?)`

| 参数 | 类型 | 说明 |
|:--|:--|:--|
| `globalDir` | `string \| undefined` | 覆盖全局目录（测试隔离用）；省略用 `~/.dsh/rules` |

#### `list(level, cwd?)`

全量扫描某级规则目录的 `*.md`，返回 `Rule[]`（按 id 升序）。

- `cwd` 缺省时，project 级规则回退到 `<process.cwd()>/.dsh/rules`（与注入模块的 cwd 解析一致）。
- 目录不存在 → 返回 `[]`（不抛错）。
- 只读目录内**平铺**的 `.md` 文件；对每个文件 `lstat`，跳过软链接与非常规文件（安全读取，防逃逸出规则目录）。
- 读入后统一换行为 `\n`（`\r\n`/`\r` 归一化）。

#### `save(level, id, content, cwd?)`

保存（新建或覆盖）某级规则，返回其 `Rule` 投影。

- `cwd` 缺省时，project 级规则回退到 `<process.cwd()>/.dsh/rules`。
- 目录不存在时 `mkdir -p`（`recursive: true`）。
- 写文件路径为 `<dir>/<id>.md`。
- 采用**原子写**（临时文件 + `rename`），避免注入读到半写内容。
- 返回的 `content` 为归一化后的正文。

#### `remove(level, id, cwd?)`

删除 `<dir>/<id>.md`，文件不存在时幂等（不抛错）；`cwd` 缺省时 project 级规则同样回退到 `process.cwd()`。

## 内部通用函数

| 函数 | 说明 |
|:--|:--|
| `normalize(text)` | `\r\n`/`\r` → `\n` |
| `titleOf(id, content)` | 提取标题：首个 `# x` → 其文本；无 H1 → 首行截断 120 字；空 → `id` |
| `atomicWrite(filePath, content)` | 写 `<filePath>.<pid>.tmp` 后 `rename` 覆盖 |

## 设计要点

- **全量存取**：规则总量小，`list` 每次全量扫描，不做增量 diff 与缓存；合成字符串缓存归注入层（见 03）。
- **安全读取**：`lstat` 过滤软链接/非常规文件，只读平铺 `.md`。
- `id` 由文件名直接派生，跨层唯一、直观。