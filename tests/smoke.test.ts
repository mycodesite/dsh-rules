// smoke test：RuleStore 的全量读写与路径解析（不触碰真实 ~/.dsh/rules）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RuleStore } from '../src/host/store.ts'
import { projectRulesDir } from '../src/host/paths.ts'

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