// 单测：RuleInjector.reload() 新旧合成文本对比（任务002，采纳调查报告-001 建议1）。
// 对应《解决方案：规则库更新注入优化-002》§八 六用例：
//   T1) boot 后规则内容变化 → 注入；
//   T2) 规则文件重写同内容（mtime 变）→ 跳过注入【核心回归：去掉 changed 判定此用例必失败】；
//   T3) 新增规则 → 注入；
//   T4) 归档/删除（规则减少，合成文本变短）→ 注入；
//   T5) 无旧快照（cache 空，未 boot）→ 保守注入（B3：key 缺失=变化）；
//   T6) 多 agent 全注入 + agent/disposed 后退出注入。
// 判定对象说明：直接对比 renderRules 合成文本（agent 感知面）——同内容重写、仅换行差异（store.normalize
// 已抹平）文本不变应跳过；无 H1 的文件改名会改变合成文本（title 回退为 id）应注入，有 H1 改名则文本不变应跳过。
// 风格与 tests/host-remove.test.ts 一致：node:test + assert/strict，直测 src TS 源码，真实临时目录。
// 窗口性质（审核报告 §四.3）：watch() 会经 watchDir(globalRulesDir()) 给真实 ~/.dsh/rules 挂短暂监听
// （globalRulesDir() 为 paths 直调、injector 无注入点，属现状约束）；stub ctx.effect 立即捕获清理函数，
// t.after 关闭全部 watcher，测试无全局残留。规则内容本身读装置临时目录（RuleStore(globalDir) 构造注入），
// 与真实 ~/.dsh/rules 无关；仅当测试运行的毫秒级窗口内恰有该目录文件事件时，debounceReload 才可能
// 多触发一次 reload 使计数出现偶发噪声——概率极低，属已知窗口。
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { RuleInjector } from '../src/host/injector.ts'
import { RuleStore } from '../src/host/store.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 轮询等待条件成立（替代固定 sleep，防慢机/CI flake；审核报告 §四.2） */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`waitFor 超时：${what}`)
    await sleep(5)
  }
}

interface Harness {
  store: RuleStore
  injector: RuleInjector
  /** fake agent 的 inject 收到的消息（注入计数断言对象） */
  injected: unknown[]
  created: (agent: Agent) => void
  disposed: (agent: Agent) => void
  globalDir: string
  projDir: string
}

/** 测试装置：真实临时目录 + stub ctx（记录 handler、effect 立即捕获清理）+ 真实 RuleStore */
async function makeHarness(t: TestContext): Promise<Harness> {
  const globalDir = await mkdtemp(join(tmpdir(), 'rulebase-inj-g-'))
  const projDir = await mkdtemp(join(tmpdir(), 'rulebase-inj-p-'))
  await mkdir(join(projDir, '.dsh', 'rules'), { recursive: true })
  // 预置项目规则 P：让 agent/created 的 void refresh(cwd) 落地可观察
  // （落地后 renderFromCache(projDir) 含 P 正文；未落地时回退 GLOBAL_KEY 不含）
  await writeFile(join(projDir, '.dsh', 'rules', 'P.md'), '# P\n项目预置规则', 'utf8')
  const store = new RuleStore(globalDir)
  const injected: unknown[] = []
  const handlers = new Map<string, (p: { agent: Agent }) => void>()
  let clean: (() => void) | undefined
  const cleanup = () => clean?.()
  t.after(() => {
    cleanup()
    rmSync(globalDir, { recursive: true, force: true })
    rmSync(projDir, { recursive: true, force: true })
  })
  const ctx = {
    on: (ev: string, h: (p: { agent: Agent }) => void) => { handlers.set(ev, h) },
    // stub 语义差异：立即执行 fn() 捕获清理函数（cordis 真实语义为延迟到 dispose），仅测试装置行为
    effect: (fn: () => () => void) => { clean = fn() },
  } as unknown as Context
  const injector = new RuleInjector(ctx, store)
  injector.watch()
  return {
    store,
    injector,
    injected,
    created: (agent) => handlers.get('agent/created')!({ agent }),
    disposed: (agent) => handlers.get('agent/disposed')!({ agent }),
    globalDir,
    projDir,
  }
}

/** fake agent：session.header.cwd 指向装置项目目录，inject 记录消息 */
function makeAgent(cwd: string, injected: unknown[]): Agent {
  return {
    session: { header: { cwd } },
    inject: (m: unknown) => { injected.push(m) },
  } as unknown as Agent
}

/** T1-T4 前置：boot 预热全局缓存 → 注册 agent（走真实 activeAgents/knownCwds 填充路径）→ 等项目缓存落地 */
async function setupBooted(t: TestContext): Promise<Harness & { agent: Agent }> {
  const h = await makeHarness(t)
  await h.injector.boot()
  const agent = makeAgent(h.projDir, h.injected)
  h.created(agent)
  await waitFor(
    () => h.injector.renderFromCache(h.projDir).includes('项目预置规则'),
    'agent/created 的 refresh(cwd) 落地（项目缓存建立）',
  )
  return { ...h, agent }
}

test('T1：boot 后规则内容变化 → 注入', async (t) => {
  const h = await setupBooted(t)
  await writeFile(join(h.globalDir, 'A.md'), '# A\n内容X', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 1)
})

test('T2：规则文件重写同内容（mtime 变）→ 跳过注入【核心回归】', async (t) => {
  const h = await setupBooted(t)
  await writeFile(join(h.globalDir, 'A.md'), '# A\n内容X', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 1)
  // 原样重写：合成文本不变 → 只刷缓存，零注入
  await writeFile(join(h.globalDir, 'A.md'), '# A\n内容X', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 1)
})

test('T3：新增规则 → 注入', async (t) => {
  const h = await setupBooted(t)
  await writeFile(join(h.globalDir, 'A.md'), '# A\n内容X', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 1)
  await writeFile(join(h.globalDir, 'B.md'), '# B\n内容Y', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 2)
})

test('T4：归档/删除（规则减少，合成文本变短）→ 注入', async (t) => {
  const h = await setupBooted(t)
  await writeFile(join(h.globalDir, 'A.md'), '# A\n内容X', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 1)
  await writeFile(join(h.globalDir, 'B.md'), '# B\n内容Y', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 2)
  // 模拟移入 archive 的源端删除事件后状态（store.list 平铺扫描不再收录）
  await h.store.remove('global', 'B')
  await h.injector.reload()
  assert.equal(h.injected.length, 3)
})

test('T5：无旧快照（cache 空，未 boot）→ 保守注入（缺失=变化）', async (t) => {
  const h = await makeHarness(t) // 不 boot：cache 为空
  const agent = makeAgent(h.projDir, h.injected)
  h.created(agent)
  await writeFile(join(h.globalDir, 'G.md'), '# G\n首次内容', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 1)
})

test('T6：多 agent 全注入 + agent/disposed 后退出注入', async (t) => {
  const h = await setupBooted(t)
  const agent2 = makeAgent(h.projDir, h.injected)
  h.created(agent2)
  await writeFile(join(h.globalDir, 'A.md'), '# A\n内容X', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 2) // 两个活跃 agent 各 1 条
  h.disposed(h.agent)
  await writeFile(join(h.globalDir, 'B.md'), '# B\n内容Y', 'utf8')
  await h.injector.reload()
  assert.equal(h.injected.length, 3) // 仅 agent2 +1
})
