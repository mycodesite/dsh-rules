// 单测：规则注入标题层级重排（任务032）。
// 验证 stripLeadingTitle / scanHeadings / relevel 三函数 + ruleBlock 端到端重排行为。
// 对应《解决方案：规则注入标题层级与默认模板-032》§4.5（20 例）。
// 风格与 tests/injector-boundary.test.ts 一致：node:test + assert/strict，直测 src TS 源码，真实临时目录。
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { RuleInjector, stripLeadingTitle, scanHeadings, relevel } from '../src/host/injector.ts'
import { RuleStore } from '../src/host/store.ts'

/** 端到端 helper：写一条全局规则 → refresh → 返回合成输出 */
async function renderGlobal(t: TestContext, content: string, id = 'R'): Promise<string> {
  const globalDir = await mkdtemp(join(tmpdir(), 'rulebase-rlv-'))
  const store = new RuleStore(globalDir)
  const ctx = { on: () => {}, effect: (fn: () => () => void) => fn() } as unknown as Context
  const injector = new RuleInjector(ctx, store, globalDir)
  await writeFile(join(globalDir, `${id}.md`), content, 'utf8')
  await injector.refresh()
  const out = injector.renderFromCache()
  t.after(() => rmSync(globalDir, { recursive: true, force: true }))
  return out
}

/** 行级精确匹配：输出中是否存在某一行恰好等于 line */
function hasLine(text: string, line: string): boolean {
  return text.split('\n').includes(line)
}

test('N1：围栏内 # 不动（围栏状态机跳过）', async (t) => {
  const out = await renderGlobal(t, '```\n# shell 注释\n```', 'N1')
  assert.ok(hasLine(out, '# shell 注释'), '围栏内 # 原样保留')
})

test('N2：~~~ 围栏内 # 不动', async (t) => {
  const out = await renderGlobal(t, '~~~\n# tildes\n~~~', 'N2')
  assert.ok(hasLine(out, '# tildes'), '~~~ 围栏内 # 原样保留')
})

test('N3：行内代码 `####` 不动（行首非 #）', async (t) => {
  const out = await renderGlobal(t, '`####` 是 H4', 'N3')
  assert.ok(hasLine(out, '`####` 是 H4'), '行内代码原样保留')
})

test('N4：H6 钳制（不产 H7/H8）', async (t) => {
  const out = await renderGlobal(t, '# 标题\n## H2\n###### H6', 'N4')
  assert.ok(hasLine(out, '##### H2'), 'H2 降级到 H5')
  assert.ok(hasLine(out, '###### H6'), 'H6 钳制封顶')
  assert.ok(!hasLine(out, '######## H6'), '不产出 H8')
})

test('N5：无标题文件原样（hMin=0, shift=0）', async (t) => {
  const out = await renderGlobal(t, '纯正文无标题', 'N5')
  assert.ok(hasLine(out, '纯正文无标题'), '无标题文件原样保留')
})

test('N6：H2 起写文件（剥离首行 ## 标题 → ### 子 delta=2 → ##### 子）', async (t) => {
  const out = await renderGlobal(t, '## 标题\n### 子', 'N6')
  assert.ok(hasLine(out, '##### 子'), '### 子 降级到 ##### 子')
  assert.ok(!hasLine(out, '### 子'), '不保留原 ### 子')
})

test('N7：剥离首行 H1（# 标题 → ## 子 delta=3 → ##### 子）', async (t) => {
  const out = await renderGlobal(t, '# 标题\n## 子', 'N7')
  assert.ok(hasLine(out, '##### 子'), '## 子 降级到 ##### 子')
  assert.ok(!hasLine(out, '## 子'), '不保留原 ## 子')
  assert.ok(!hasLine(out, '# 标题'), '首行标题已剥离')
})

test('N8：剥离不中（heading != 首行标题文本 → 不剥，绝不误删）', () => {
  const content = '# 标题A\n## 子'
  const stripped = stripLeadingTitle(content, '标题B')
  assert.equal(stripped, content, '比对不中 → 原样返回')
  const hMin = scanHeadings(stripped)
  assert.equal(hMin, 1, 'hMin=1（# 标题A）')
  const shifted = relevel(stripped, 5 - hMin)
  assert.ok(hasLine(shifted, '##### 标题A'), '# 标题A delta=4 → ##### 标题A')
  assert.ok(hasLine(shifted, '###### 子'), '## 子 delta=4 → ###### 子')
})

test('N9：CRLF 经 normalize 后重排（## 标题\\r\\n### 子 → ##### 子）', async (t) => {
  const out = await renderGlobal(t, '## 标题\r\n### 子', 'N9')
  assert.ok(hasLine(out, '##### 子'), 'CRLF normalize 后 ### 子 降级到 ##### 子')
})

test('N10：幂等（shift=0 原样）', () => {
  const content = '#### 已是 H4'
  assert.equal(relevel(content, 0), content, 'shift=0 原样返回')
  assert.equal(scanHeadings(content), 4, 'hMin=4')
})

test('N11：BOM 防御（\\uFEFF## 标题 shift=3 → \\uFEFF##### 标题）', () => {
  const content = '\uFEFF## 标题'
  assert.equal(scanHeadings(content), 2, 'BOM 剥后 hMin=2')
  assert.equal(relevel(content, 3), '\uFEFF##### 标题', 'BOM 剥后降级再回贴')
  const stripped = stripLeadingTitle(content, '标题')
  assert.equal(stripped, '\uFEFF', '剥离首行后 BOM 保留 + 空正文')
})

test('N12：#tag 不当标题（# 后无空格，非 ATX 标题）', async (t) => {
  const out = await renderGlobal(t, '#tag 内容', 'N12')
  assert.ok(hasLine(out, '#tag 内容'), '#tag 原样保留（非标题不降级）')
})

test('N13：闭合式标题尾部保留（## 标题 ## shift=3 → ##### 标题 ##）', () => {
  const content = '## 标题 ##'
  assert.equal(relevel(content, 3), '##### 标题 ##', '只改前导 # 串，尾部保留')
})

test('N14：差值降级 delta=5-H_min（# H1 → ## H2 ### H3 delta=3 → ##### H2 ###### H3）', async (t) => {
  const out = await renderGlobal(t, '# H1\n## H2\n### H3', 'N14')
  assert.ok(hasLine(out, '##### H2'), '## H2 delta=3 → ##### H2')
  assert.ok(hasLine(out, '###### H3'), '### H3 delta=3 → ###### H3')
  assert.ok(!hasLine(out, '# H1'), '首行 # H1 已剥离')
})

test('N15：多行 HTML 注释内 #（已知限制 + 行为锁定：scanHeadings 不识别 HTML 注释，降级）', async (t) => {
  const out = await renderGlobal(t, '# 标题\n<!--\n## 注释内标题\n-->', 'N15')
  assert.ok(hasLine(out, '##### 注释内标题'), 'HTML 注释内 ## 被降级到 #####（已知限制）')
  assert.ok(!hasLine(out, '## 注释内标题'), '原 ## 注释内标题 已被降级')
})

test('N16：仅标题无正文（# 标题 → 剥离后空正文，不崩溃）', async (t) => {
  const out = await renderGlobal(t, '# 标题', 'N16')
  assert.ok(hasLine(out, '#### 标题'), '承载标题 #### 标题 存在')
})

test('N17：标题尾随空格（relevel 只改前导 # 串，尾部空格保留）', async (t) => {
  const out = await renderGlobal(t, '# 标题\n## 子节   ', 'N17')
  assert.ok(hasLine(out, '##### 子节   '), '尾随空格保留，只改前导 #')
})

test('N18：嵌套围栏（4 空格缩进围栏不触发闭合，内层 # 在围栏内跳过）', async (t) => {
  const out = await renderGlobal(t, '# 标题\n```\n    ```\n# 缩进内层\n    ```\n```', 'N18')
  assert.ok(hasLine(out, '# 缩进内层'), '围栏内 # 缩进内层 原样保留')
})

test('N19：特殊字符（heading 含 ()/"/  剥离比对正确）', async (t) => {
  const out = await renderGlobal(t, '# 规则（特殊）/字符"测试\n## 子', 'N19')
  assert.ok(hasLine(out, '##### 子'), '特殊字符 heading 剥离成功，## 子 降级到 ##### 子')
})

test('N20：空文件 content=""（不崩溃，heading 回退 id）', async (t) => {
  const out = await renderGlobal(t, '', 'N20')
  assert.ok(hasLine(out, '#### N20'), '空文件 heading 回退 id=N20')
})
