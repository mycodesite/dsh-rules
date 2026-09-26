// 单测：规则删除链路（store.remove 精确幂等 + service.remove cwd 语义）。
// 对应《解决方案：rulesbase设置面板列表项右侧菜单删除项无效-010》v2 修复项四（用例1-5）：
//   1) store.remove：目标不存在 → resolve（幂等保留，V4 逻辑层等价）；
//   2) store.remove：真实文件删除成功（经构造函数注入临时 globalDir）；
//   3) store.remove：fs.promises.rm 抛 EBUSY → reject 且 message 含原始错误（假成功消除，V3 逻辑层等价）；
//   4) service.dispatch(remove)：store 抛错 → ok:false code internal（transportError 通道，同 save 失败路径）；
//   5) service.dispatch(remove)：project 无 cwd → ok:false 文案「无法删除项目规则」（V5）。
// 风格与 tests/bridge.test.ts 一致：node:test + assert/strict，直测 src TS 源码。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync, promises as fs } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuleStore } from '../src/host/store.ts'
import { RulesService } from '../src/host/service.ts'
import type { RuleInjector } from '../src/host/injector.ts'
/** 失败路径 mock 注入的 injector：currentProjectCwd 可控，reload 空实现（失败路径不触发） */
function makeInjector(currentProjectCwd: () => string | undefined): RuleInjector {
  return { currentProjectCwd, reload: async () => {} } as unknown as RuleInjector
}

test('store.remove：目标文件不存在 → resolve（幂等保留）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rulebase-remove-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new RuleStore(dir)
  await store.remove('global', '不存在的规则') // 不抛出即通过
})

test('store.remove：真实文件删除成功（注入临时 globalDir）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rulebase-remove-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const target = join(dir, 'A.md')
  await writeFile(target, '# A\n内容', 'utf8')
  const store = new RuleStore(dir)
  await store.remove('global', 'A')
  assert.equal(existsSync(target), false)
})

test('store.remove：非 ENOENT 错误向上抛（EBUSY 不再伪装成功）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rulebase-remove-'))
  // 清理走 rmSync（同步 API），不受下方 promises.rm 的 mock 影响
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new RuleStore(dir)
  t.mock.method(fs, 'rm', async () => {
    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
  })
  await assert.rejects(store.remove('global', 'A'), /EBUSY/)
})

test('service.dispatch(remove)：store 抛错 → ok:false code internal（transportError 通道，同 save 失败路径）', async () => {
  const store = { remove: async () => { throw new Error('EBUSY: boom-remove') } } as unknown as RuleStore
  const service = new RulesService(store, makeInjector(() => undefined))
  const res = await service.dispatch('remove', { level: 'global', id: 'A' })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'internal')
    assert.equal(res.error.message, 'EBUSY: boom-remove')
  }
})

test('service.dispatch(remove)：project 无 cwd → ok:false 文案「无法删除项目规则」（显式失败）', async () => {
  const store = { remove: async () => { throw new Error('不应被调用') } } as unknown as RuleStore
  const service = new RulesService(store, makeInjector(() => undefined))
  const res = await service.dispatch('remove', { level: 'project', id: 'A' })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.match(res.error.message, /无法删除项目规则/)
    assert.doesNotMatch(res.error.message, /无法保存项目规则/) // 收紧：证明走删除文案而非保存文案
  }
})
