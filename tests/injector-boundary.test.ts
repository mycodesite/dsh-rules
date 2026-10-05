// 单测：规则库注入边界标记（任务031）。
// 验证 renderRules 在满态/仅全局/仅项目/空态/截断/恰好阈值/插值守卫/撞词守卫
// 八条路径下的输出形态。对应《解决方案：规则库注入边界标记-031》§五 四态行为规格。
// 风格与 tests/injector-reload.test.ts 一致：node:test + assert/strict，直测 src TS 源码，真实临时目录。
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { RuleInjector } from '../src/host/injector.ts'
import { RuleStore, MAX_TOTAL_BYTES } from '../src/host/store.ts'

const BEGIN = '［规则库开始］'
const END = '［规则库结束］'
const EMPTY = '（当前无全局规则与项目规则）'

/** 测试装置：真实临时目录 + stub ctx，返回 boot 完的 injector */
async function makeInjector(t: TestContext): Promise<{ injector: RuleInjector; globalDir: string; projDir: string }> {
  const globalDir = await mkdtemp(join(tmpdir(), 'rulebase-bnd-g-'))
  const projDir = await mkdtemp(join(tmpdir(), 'rulebase-bnd-p-'))
  await mkdir(join(projDir, '.dsh', 'rules'), { recursive: true })
  const store = new RuleStore(globalDir)
  const ctx = { on: () => {}, effect: (fn: () => () => void) => fn() } as unknown as Context
  const injector = new RuleInjector(ctx, store, globalDir)
  t.after(() => {
    rmSync(globalDir, { recursive: true, force: true })
    rmSync(projDir, { recursive: true, force: true })
  })
  return { injector, globalDir, projDir }
}

test('B1：满态——成对标记 + 内层 H3', async (t) => {
  const { injector, globalDir, projDir } = await makeInjector(t)
  await writeFile(join(globalDir, 'G.md'), '# G\n全局正文', 'utf8')
  await writeFile(join(projDir, '.dsh', 'rules', 'P.md'), '# P\n项目正文', 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.ok(out.startsWith(BEGIN), '应以开始标记开头')
  assert.ok(out.endsWith(END), '应以结束标记结尾')
  assert.ok(out.indexOf(BEGIN) < out.indexOf(END), '开始标记应在结束标记之前')
  assert.ok(out.includes('### 全局规则'), '应含全局分区')
  assert.ok(out.includes('### 项目规则'), '应含项目分区')
})

test('B2：仅全局——成对标记 + 无项目 H3', async (t) => {
  const { injector, globalDir, projDir } = await makeInjector(t)
  await writeFile(join(globalDir, 'G.md'), '# G\n全局正文', 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.ok(out.startsWith(BEGIN) && out.endsWith(END), '成对标记')
  assert.ok(out.includes('### 全局规则'), '含全局分区')
  assert.ok(!out.includes('### 项目规则'), '不含项目分区')
})

test('B3：仅项目（FT）——成对标记 + 无全局 H3', async (t) => {
  const { injector, projDir } = await makeInjector(t)
  await writeFile(join(projDir, '.dsh', 'rules', 'P.md'), '# P\n项目正文', 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.ok(out.startsWith(BEGIN) && out.endsWith(END), '成对标记')
  assert.ok(!out.includes('### 全局规则'), '不含全局分区')
  assert.ok(out.includes('### 项目规则'), '含项目分区')
})

test('B4：空态——非空 + 占位 + 成对标记', async (t) => {
  const { injector, projDir } = await makeInjector(t)
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.notEqual(out, '', '空态不再返回空字符串')
  assert.equal(out, `${BEGIN}\n\n${EMPTY}\n\n${END}`, '空态输出占位 + 成对标记')
})

test('B5：超限截断——标记恒在末尾，截断尾注在结束标记之前', async (t) => {
  const { injector, globalDir, projDir } = await makeInjector(t)
  // 写入超 256 KiB 的单条规则
  const big = 'A'.repeat(300 * 1024)
  await writeFile(join(globalDir, 'BIG.md'), `# BIG\n${big}`, 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.ok(out.startsWith(BEGIN), '截断后仍以开始标记开头')
  assert.ok(out.endsWith(END), '截断后仍以结束标记结尾')
  assert.ok(out.includes('规则总量超限，已截断'), '应含截断尾注')
  assert.ok(out.indexOf('规则总量超限，已截断') < out.indexOf(END), '截断尾注在结束标记之前')
})

test('B6：恰好等于阈值（> 严格大于）——不截断，末尾为结束标记', async (t) => {
  const { injector, globalDir, projDir } = await makeInjector(t)
  // 构造 body 字节数恰好等于 MAX_TOTAL_BYTES。
  // R1 形态（0.1.10）：body = '### 全局规则\n\n' + ruleBlock
  //   ruleBlock = '#### G\n\n' + relevel(stripped, shift)
  //   文件写 '# G\n${content}'，stripLeadingTitle 剥离首行 '# G'（文本 == heading "G"）后正文 = content
  //   content 无标题 ⇒ hMin=0 ⇒ shift=0 ⇒ relevel 原样
  //   ⇒ body = '### 全局规则\n\n#### G\n\n' + content
  const prefix = '### 全局规则\n\n#### G\n\n'                   // 16 + 2 + 6 + 2 = 26 字节
  const target = MAX_TOTAL_BYTES - Buffer.byteLength(prefix, 'utf8')
  const content = 'B'.repeat(target)                          // 单字节字符 ⇒ 字节数 = 字符数
  await writeFile(join(globalDir, 'G.md'), `# G\n${content}`, 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.ok(out.endsWith(END), '末尾为结束标记')
  assert.ok(!out.includes('规则总量超限，已截断'), '恰好等于阈值不截断')
})

test('B7：插值守卫——输出不含 {{ 与 }}', async (t) => {
  const { injector, globalDir, projDir } = await makeInjector(t)
  await writeFile(join(globalDir, 'G.md'), '# G\n全局正文', 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  assert.ok(!out.includes('{{'), '不含 {{（宿主 interpolate 会抛错）')
  assert.ok(!out.includes('}}'), '不含 }}')
})

test('B8：撞词守卫——标记只出现在首尾各一次', async (t) => {
  const { injector, globalDir, projDir } = await makeInjector(t)
  // 规则正文不含标记串
  await writeFile(join(globalDir, 'G.md'), '# G\n全局正文不含边界标记', 'utf8')
  await writeFile(join(projDir, '.dsh', 'rules', 'P.md'), '# P\n项目正文不含边界标记', 'utf8')
  await injector.refresh(projDir)
  const out = injector.renderFromCache(projDir)
  const beginCount = out.split(BEGIN).length - 1
  const endCount = out.split(END).length - 1
  assert.equal(beginCount, 1, '开始标记恰好出现 1 次')
  assert.equal(endCount, 1, '结束标记恰好出现 1 次')
})