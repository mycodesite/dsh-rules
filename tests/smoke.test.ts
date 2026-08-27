// smoke test：RuleStore 的全量读写与路径解析（不触碰真实 ~/.dsh/rules）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { RuleStore } from '../src/host/store.ts'
import { projectRulesDir } from '../src/host/paths.ts'
import { RulesService } from '../src/host/service.ts'
import { RuleInjector } from '../src/host/injector.ts'
import type { RuleInjector as RuleInjectorType } from '../src/host/injector.ts'

test('RuleStore 全量读写与覆盖/删除（project 级）', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-'))
  try {
    const store = new RuleStore()
    await store.save('project', 'a', '# 规则A\n\n内容A', cwd)
    await store.save('project', 'b', '无标题正文B', cwd)

    const rules = await store.list('project', cwd)
    assert.equal(rules.length, 2)
    assert.equal(rules[0].id, 'a') // 按文件名排序
    assert.equal(rules[0].title, '规则A')
    assert.equal(rules[1].title, '无标题正文B') // 无 H1 → 回退用首行

    // 覆盖
    await store.save('project', 'a', '# 新标题\n\n新内容', cwd)
    const after = await store.list('project', cwd)
    assert.equal(after.find((r) => r.id === 'a')?.title, '新标题')

    // 删除
    await store.remove('project', 'a', cwd)
    const afterDel = await store.list('project', cwd)
    assert.equal(afterDel.length, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('RuleStore 目录不存在返回空', async () => {
  const store = new RuleStore()
  const rules = await store.list('project', path.join(os.tmpdir(), 'rulebase-nonexistent'))
  assert.deepEqual(rules, [])
})

test('projectRulesDir 路径解析', () => {
  assert.equal(projectRulesDir('/p'), path.join('/p', '.dsh', 'rules'))
  assert.equal(projectRulesDir(undefined), undefined)
})

// ---- RulesService：currentCwd 端点与项目级 cwd 解析（不触碰真实 ~/.dsh/rules）----

/** 最小可注入的假 injector：仅覆盖 service 用到的方法 */
function fakeInjector(cwd: string | undefined): RuleInjector {
  return { currentProjectCwd: () => cwd, reload: async () => {} } as unknown as RuleInjector
}

// ---- RuleInjector：currentProjectCwd 对空字符串 cwd 的过滤 ----

/** 最小可注入的假 ctx：捕获 agent/created 与 effect 清理（供 watch() 使用） */
function fakeCtx(): { ctx: Context; created: (agent: unknown) => void; dispose: () => void } {
  const listeners = new Map<string, (payload: unknown) => void>()
  let dispose: (() => void) | undefined
  const ctx = {
    on: (name: string, fn: (payload: unknown) => void) => { listeners.set(name, fn); return () => true },
    effect: (fn: () => () => void) => { dispose = fn(); return undefined },
  } as unknown as Context
  return {
    ctx,
    created: (agent: unknown) => listeners.get('agent/created')?.({ agent }),
    dispose: () => dispose?.(),
  }
}

test('RuleInjector.currentProjectCwd：空字符串 cwd 被跳过，返回最近有效 cwd', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-inj-'))
  try {
    const store = new RuleStore(path.join(cwd, 'global'))
    const { ctx, created, dispose } = fakeCtx()
    const injector = new RuleInjector(ctx, store)
    injector.watch()

    // 最近创建的 agent 是空 cwd（无项目会话）→ 应被跳过
    created({ session: { header: { cwd: '' } } })
    // 之前创建的 agent 有有效 cwd
    created({ session: { header: { cwd } } })

    assert.equal(injector.currentProjectCwd(), cwd)
    dispose()
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('RuleInjector.currentProjectCwd：仅空字符串 cwd 时返回 undefined', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-inj-'))
  try {
    const store = new RuleStore(path.join(cwd, 'global'))
    const { ctx, created, dispose } = fakeCtx()
    const injector = new RuleInjector(ctx, store)
    injector.watch()

    created({ session: { header: { cwd: '' } } })
    created({ session: { header: {} } })

    assert.equal(injector.currentProjectCwd(), undefined)
    dispose()
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('RulesService.currentCwd：未选项目返回 null，已选项目返回 cwd', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-svc-'))
  try {
    const store = new RuleStore(path.join(cwd, 'global'))
    const none = await new RulesService(store, fakeInjector(undefined)).dispatch('currentCwd', {})
    assert.equal(none.ok && (none.value as { cwd: string | null }).cwd, null)
    const some = await new RulesService(store, fakeInjector(cwd)).dispatch('currentCwd', {})
    assert.equal(some.ok && (some.value as { cwd: string | null }).cwd, cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('RulesService 项目级 create：未选项目返回错误提示且不落盘', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-svc-'))
  try {
    const store = new RuleStore(path.join(cwd, 'global'))
    const svc = new RulesService(store, fakeInjector(undefined))

    const res = await svc.dispatch('create', { level: 'project', content: '# R\n\n内容' })
    assert.equal(res.ok, false)
    if (!res.ok) {
      assert.equal(res.error.code, 'internal')
      assert.match(res.error.message, /未选定项目/)
    }
    const list = await svc.dispatch('list', { level: 'project' })
    assert.equal(list.ok && (list.value as unknown[]).length, 0)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('RulesService 项目级 create：已选项目保存到该项目 .dsh/rules', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-svc-'))
  try {
    const store = new RuleStore(path.join(cwd, 'global'))
    const svc = new RulesService(store, fakeInjector(cwd))

    const res = await svc.dispatch('create', { level: 'project', content: '# 项目规则\n\n内容' })
    assert.equal(res.ok, true)
    const list = await svc.dispatch('list', { level: 'project' })
    assert.equal(list.ok && (list.value as unknown[]).length, 1)
    const files = await readdir(path.join(cwd, '.dsh', 'rules'))
    assert.equal(files.filter((n) => n.endsWith('.md')).length, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})