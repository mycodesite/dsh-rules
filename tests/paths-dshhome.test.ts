// 单测：全局规则目录的 DSH home 解析（对应《解决方案：rulebase全局规则目录跟随DSH_HOME-001》验收 V1–V5）。
// 覆盖：DSH_HOME 已设置 / 未设置 / 纯空白 / 带空格 trim / 相对值绝对化；装配层 dshHomePath 优先与三种回退。
// 手法：同进程内临时改写 process.env.DSH_HOME（globalRulesDir 每次调用现读环境变量、无缓存），
// t.after 恢复原值，避免污染其它测试；装配层用最小 stub ctx（仅需 get）。
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { globalRulesDir, projectRulesDir } from '../src/host/paths.ts'
import { resolveGlobalRulesDir } from '../src/host/index.ts'

const DEFAULT_RULES_DIR = path.join(os.homedir(), '.dsh', 'rules')

/** 在回调内临时设置 DSH_HOME（undefined = 删除该变量），结束后恢复原值 */
function withDshHome(t: TestContext, value: string | undefined, fn: () => void): void {
  const saved = process.env.DSH_HOME
  t.after(() => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  })
  if (value === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = value
  fn()
}

const fakeCtx = (get: (name: string) => unknown): Context => ({ get }) as unknown as Context

test('V1：DSH_HOME 已设置 → 全局规则目录跟随该 home', (t) => {
  withDshHome(t, 'O:/tmp/probe-home', () => {
    assert.equal(globalRulesDir(), path.join(path.resolve('O:/tmp/probe-home'), 'rules'))
  })
})

test('V2a：DSH_HOME 未设置 → 回退 ~/.dsh/rules', (t) => {
  withDshHome(t, undefined, () => {
    assert.equal(globalRulesDir(), DEFAULT_RULES_DIR)
  })
})

test('V2b：DSH_HOME 为纯空白 → 视为未设置，回退 ~/.dsh/rules', (t) => {
  withDshHome(t, '   ', () => {
    assert.equal(globalRulesDir(), DEFAULT_RULES_DIR)
  })
})

test('V3：DSH_HOME 带前后空格（非全空白）→ trim 后使用，不拼出畸形路径', (t) => {
  withDshHome(t, '  O:/tmp/padded  ', () => {
    assert.equal(globalRulesDir(), path.join(path.resolve('O:/tmp/padded'), 'rules'))
  })
})

test('V1b：相对 DSH_HOME 被绝对化（与官方 resolve 语义一致）', (t) => {
  withDshHome(t, 'rulebase-rel-home', () => {
    assert.equal(globalRulesDir(), path.join(path.resolve('rulebase-rel-home'), 'rules'))
  })
})

test('项目规则不受 DSH_HOME 影响（仍跟随 cwd）', (t) => {
  withDshHome(t, 'O:/tmp/probe-home', () => {
    assert.equal(projectRulesDir('/p'), path.join('/p', '.dsh', 'rules'))
    assert.equal(projectRulesDir(undefined), undefined)
  })
})

test('V4：装配层优先取宿主 dshHomePath 服务（含官方 configured 覆盖语义）', () => {
  const home = path.join(os.tmpdir(), 'rulebase-dhp-home')
  assert.equal(
    resolveGlobalRulesDir(fakeCtx((n) => (n === 'dshHomePath' ? () => home : undefined))),
    path.join(home, 'rules'),
  )
})

test('V5a：服务缺失或非函数 → 回退 paths 解析', (t) => {
  withDshHome(t, undefined, () => {
    assert.equal(resolveGlobalRulesDir(fakeCtx(() => undefined)), DEFAULT_RULES_DIR)
  })
})

test('V5b：ctx.get 抛错 → 回退 paths 解析（不冒泡）', (t) => {
  withDshHome(t, 'O:/tmp/probe-home', () => {
    const ctx = fakeCtx(() => { throw new Error('service unavailable') })
    assert.equal(resolveGlobalRulesDir(ctx), path.join(path.resolve('O:/tmp/probe-home'), 'rules'))
  })
})