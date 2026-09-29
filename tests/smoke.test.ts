// smoke test：RuleStore 的全量读写与路径解析（不触碰真实 ~/.dsh/rules）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RuleStore } from '../src/host/store.ts'
import { projectRulesDir } from '../src/host/paths.ts'
import { RulesService } from '../src/host/service.ts'
import { RuleInjector } from '../src/host/injector.ts'

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

// ---- RulesService：项目级 cwd 解析（0.1.8 起仅采用 client 传入 cwd，不触碰真实 ~/.dsh/rules）----

/** 最小可注入的假 injector：仅覆盖 service 用到的方法（0.1.8 起 service 不再消费 currentProjectCwd） */
function fakeInjector(): RuleInjector {
  return { reload: async () => {} } as unknown as RuleInjector
}

// ---- 0.1.8 起 cwd 解析移交 client（官方判据 retainedBy.mainView），host 不再猜测；
//      RuleInjector.currentProjectCwd / RulesService.currentCwd 端点已删除（见调查报告-001）----

test('RulesService 项目级 create：未选项目返回错误提示且不落盘', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rulebase-svc-'))
  try {
    const store = new RuleStore(path.join(cwd, 'global'))
    const svc = new RulesService(store, fakeInjector())

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
    const svc = new RulesService(store, fakeInjector())

    const res = await svc.dispatch('create', { level: 'project', cwd, content: '# 项目规则\n\n内容' })
    assert.equal(res.ok, true)
    const list = await svc.dispatch('list', { level: 'project', cwd })
    assert.equal(list.ok && (list.value as unknown[]).length, 1)
    const files = await readdir(path.join(cwd, '.dsh', 'rules'))
    assert.equal(files.filter((n) => n.endsWith('.md')).length, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})