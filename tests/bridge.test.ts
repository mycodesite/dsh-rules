// 单测：host 本地信封桥 bridgeRpc（src/host/bridge.ts）。
// 对应《解决方案-001 v3》变更5：Node 26 内建 Request/Response 直测，
// 覆盖合法信封 / 方法不匹配 / dispatch 抛错 / 缺字段 / 非 JSON body / content-type 非 JSON。
// 风格与 tests/contract.test.ts 一致：node:test + assert/strict。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bridgeRpc, type Dispatcher } from '../src/host/bridge.ts'

const JSON_HEADERS = { 'content-type': 'application/json' }

function envelopeBody(rpcId: string, method: string, payload: unknown): string {
  return JSON.stringify({ type: 'client-request', rpcId, method, payload })
}

test('bridge：合法信封 → dispatch 收到 op 与 payload → server-response 信封（rpcId echo）', async () => {
  let seen: { endpoint: string; payload: unknown } | null = null
  const dispatch: Dispatcher = async (endpoint, payload) => {
    seen = { endpoint, payload }
    return { ok: true, value: [{ id: 'A', title: 't', content: 'c', level: 'global', filePath: '/x.md' }] }
  }
  const request = new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: envelopeBody('rpc-1', 'rulebase/list', { level: 'global' }),
  })
  const res = await bridgeRpc(request, 'list', dispatch)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { type: string; rpcId: string; result: { ok: boolean; value: unknown } }
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, 'rpc-1')
  assert.equal(body.result.ok, true)
  assert.deepEqual(seen, { endpoint: 'list', payload: { level: 'global' } })
})

test('bridge：method 与路由 op 不匹配 → ok:false gateway/bad-request（rpcId echo）', async () => {
  const dispatch: Dispatcher = async () => { throw new Error('不应被调用') }
  const request = new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: envelopeBody('rpc-2', 'rulebase/save', {}),
  })
  const res = await bridgeRpc(request, 'list', dispatch)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { rpcId: string; result: { ok: boolean; error: { code: string; message: string; details: { issues: unknown[] } } } }
  assert.equal(body.rpcId, 'rpc-2')
  assert.equal(body.result.ok, false)
  assert.equal(body.result.error.code, 'gateway/bad-request')
  assert.match(body.result.error.message, /does not match endpoint/)
  assert.deepEqual(body.result.error.details.issues, [])
})

test('bridge：dispatch 抛错 → 200 信封 ok:false rulebase/bridge-error（有意差异于宿主 500）', async () => {
  const dispatch: Dispatcher = async () => { throw new Error('boom-dispatch') }
  const request = new Request('http://127.0.0.1/api/rulebase/save', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: envelopeBody('rpc-3', 'rulebase/save', { level: 'global', id: 'A', content: 'x' }),
  })
  const res = await bridgeRpc(request, 'save', dispatch)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { rpcId: string; result: { ok: boolean; error: { code: string; message: string } } }
  assert.equal(body.rpcId, 'rpc-3')
  assert.equal(body.result.ok, false)
  assert.equal(body.result.error.code, 'rulebase/bridge-error')
  assert.equal(body.result.error.message, 'boom-dispatch')
})

test('bridge：信封缺字段/类型错 → gateway/bad-request；rpcId 缺失回退 invalid-request，字符串则 echo', async () => {
  const dispatch: Dispatcher = async () => ({ ok: true, value: null })
  // 无 rpcId（缺失）→ 兜底 'invalid-request'
  const missing = await bridgeRpc(new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ type: 'client-request', method: 'rulebase/list', payload: {} }),
  }), 'list', dispatch)
  const missingBody = (await missing.json()) as { rpcId: string; result: { ok: boolean; error: { code: string } } }
  assert.equal(missingBody.rpcId, 'invalid-request')
  assert.equal(missingBody.result.error.code, 'gateway/bad-request')
  // type 错误但 rpcId 为字符串 → echo
  const wrongType = await bridgeRpc(new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ type: 'other', rpcId: 'rpc-4', method: 'rulebase/list', payload: {} }),
  }), 'list', dispatch)
  const wrongTypeBody = (await wrongType.json()) as { rpcId: string; result: { ok: boolean; error: { code: string } } }
  assert.equal(wrongTypeBody.rpcId, 'rpc-4')
  assert.equal(wrongTypeBody.result.error.code, 'gateway/bad-request')
  // body 为 JSON 数组（非对象）→ 同样拒绝
  const arrayBody = await bridgeRpc(new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '[]',
  }), 'list', dispatch)
  assert.equal(((await arrayBody.json()) as { result: { ok: boolean } }).result.ok, false)
})

test('bridge：body 非 JSON → 400', async () => {
  const dispatch: Dispatcher = async () => ({ ok: true, value: null })
  const res = await bridgeRpc(new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: 'not json',
  }), 'list', dispatch)
  assert.equal(res.status, 400)
})

test('bridge：content-type 非 JSON → 415', async () => {
  const dispatch: Dispatcher = async () => ({ ok: true, value: null })
  const res = await bridgeRpc(new Request('http://127.0.0.1/api/rulebase/list', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'rulebase/list', payload: {} }),
  }), 'list', dispatch)
  assert.equal(res.status, 415)
})
