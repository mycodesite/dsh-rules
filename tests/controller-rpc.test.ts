// 单测：RuleController 的 RPC 失败折叠（callSafe）与 lastError/getLastError 语义。
// 对应《解决方案：dsh升级0.1.5后规则界面加载与保存失败-001》变更2/变更3：
//   0.1.5 浏览器端 rpc.call 对非 2xx 直接 throw，controller 必须永不 reject、
//   失败信息可见（error 态 / getLastError），成功即清空。
// 风格与 tests/contract.test.ts 一致：node:test + assert/strict。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RuleController, type RuleRpc } from '../src/client/controller.ts'
import type { RpcResult } from '../src/client/types.ts'

function makeRpc(call: (endpoint: string, payload?: unknown) => Promise<RpcResult<unknown>>): RuleRpc {
  return { call }
}

function okResult(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

/** 直接探针：private callSafe 以类型断言访问（运行时可达），验证折叠结果的 code 契约 */
async function probeCallSafe(controller: RuleController, endpoint: string): Promise<RpcResult<unknown>> {
  const probe = controller as unknown as { callSafe(e: string, p: unknown): Promise<RpcResult<unknown>> }
  return probe.callSafe(endpoint, {})
}

test('load：rpc reject 折叠为 error 态，方法不抛出，lastError 记录', async () => {
  const seen: string[] = []
  const rpc = makeRpc(async (endpoint) => {
    seen.push(endpoint)
    throw new Error('transport failure for /rulebase/list: HTTP 405')
  })
  const controller = new RuleController(rpc)
  await controller.load('global')
  const snap = controller.getSnapshot()
  assert.equal(snap.status, 'error')
  if (snap.status === 'error') assert.match(snap.error, /HTTP 405/)
  assert.equal(controller.getLastError(), 'transport failure for /rulebase/list: HTTP 405')
  assert.deepEqual(seen, ['list'])
})

test('load：业务失败（ok:false）进入 error 态，lastError 记录 message', async () => {
  const rpc = makeRpc(async () => ({ ok: false, error: { code: 'rulebase/eio', message: '目录不可读' } }))
  const controller = new RuleController(rpc)
  await controller.load('project')
  const snap = controller.getSnapshot()
  assert.equal(snap.status, 'error')
  if (snap.status === 'error') assert.equal(snap.error, '目录不可读')
  assert.equal(controller.getLastError(), '目录不可读')
})

test('callSafe：reject 折叠结果符合 RpcError 契约（code=rulebase/transport-error，message 透传）', async () => {
  const rpc = makeRpc(async () => { throw new Error('boom-transport') })
  const controller = new RuleController(rpc)
  const res = await probeCallSafe(controller, 'list')
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'rulebase/transport-error')
    assert.equal(res.error.message, 'boom-transport')
  }
  assert.equal(controller.getLastError(), 'boom-transport')
})

test('create/save/remove：失败返回 false 且 getLastError 非空；成功清空并刷新列表', async () => {
  let mode: 'fail' | 'ok' = 'fail'
  const seen: string[] = []
  const rpc = makeRpc(async (endpoint) => {
    seen.push(endpoint)
    if (endpoint === 'list') return okResult([])
    if (mode === 'fail') return { ok: false, error: { code: 'rulebase/eacces', message: '写入被拒绝' } }
    return okResult(undefined)
  })
  const controller = new RuleController(rpc)

  assert.equal(await controller.create('global', '# A\n内容'), false)
  assert.equal(controller.getLastError(), '写入被拒绝')
  mode = 'ok'
  assert.equal(await controller.create('global', '# A\n内容'), true)
  assert.equal(controller.getLastError(), null)
  assert.ok(seen.includes('list'), 'create 成功后应刷新列表')
  assert.equal(controller.getSnapshot().status, 'ready')

  mode = 'fail'
  assert.equal(await controller.save('global', 'A', '# A\n改'), false)
  assert.equal(controller.getLastError(), '写入被拒绝')
  mode = 'ok'
  assert.equal(await controller.save('global', 'A', '# A\n改'), true)
  assert.equal(controller.getLastError(), null)

  mode = 'fail'
  assert.equal(await controller.remove('global', 'A'), false)
  assert.equal(controller.getLastError(), '写入被拒绝')
  mode = 'ok'
  assert.equal(await controller.remove('global', 'A'), true)
  assert.equal(controller.getLastError(), null)
})

test('remove：payload 精确透传 { level, id }（删除目标绑定归属级别，E1 缺口补口）', async () => {
  let seen: { endpoint: string; payload: unknown } | null = null
  const rpc = makeRpc(async (endpoint, payload) => {
    if (endpoint === 'remove') seen = { endpoint, payload }
    if (endpoint === 'list') return okResult([])
    return okResult(undefined)
  })
  const controller = new RuleController(rpc)
  assert.equal(await controller.remove('project', 'A'), true)
  assert.deepEqual(seen, { endpoint: 'remove', payload: { level: 'project', id: 'A' } })
})

test('currentCwd：传输失败返回 null（按"未选定项目"降级，不抛出）', async () => {
  const rpc = makeRpc(async () => { throw new Error('HTTP 405') })
  const controller = new RuleController(rpc)
  assert.equal(await controller.currentCwd(), null)
  assert.equal(controller.getLastError(), 'HTTP 405')
})

test('host apply：RPC 通道注册使用双依赖注入且无废弃第三参（守卫回归）', () => {
  const src = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
  assert.match(src, /ctx\.inject\(\['connection'\]/)
  assert.match(src, /fetch\.register\(\{/)
  assert.match(src, /path:\s*`\/api\/rulebase\/\$\{op\}`/)
  assert.match(src, /'list',\s*'create',\s*'save',\s*'remove',\s*'reload',\s*'currentCwd'/)
  assert.match(src, /requestBody:\s*'buffered'/)
  assert.doesNotMatch(src, /rpc\.handle\(/)
  assert.doesNotMatch(src, /'webServer'/)
  assert.doesNotMatch(src, /authority:\s*'loopback'/)
})
