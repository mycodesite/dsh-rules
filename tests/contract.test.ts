// 契约单测：宿主契约本地实现（src/host/contract.ts）的逐字等价性护栏。
// 与 tests/smoke.test.ts 分工：smoke 是端到端护栏，本文件是契约单元护栏。
//
// 每条断言都对应《解决方案-002》§4 中核实过的宿主真包行为：
//   dsh-llm/lib/types/message.js L33-49、brand.js L17-19、call-config.js L54-85
//   dsh-host-apiproxy/lib/types/api/rpc.js L24-29、rpc.d.ts L173
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage, transportError } from '../src/host/contract.ts'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** 规则变更注入所用的消息体（与 injector.reload 中的调用一致） */
function sampleInput() {
  return {
    content: [{ type: 'text' as const, text: '[规则已更新] 请按最新规则库继续。' }],
    source: { kind: 'rulebase-update' as const },
  }
}

test('createUserMessage：固定 role 为 user', () => {
  assert.equal(createUserMessage(sampleInput()).role, 'user')
})

test('createUserMessage：id 铸造为 RFC 4122 v4 且逐次不同', () => {
  const first = createUserMessage(sampleInput())
  const second = createUserMessage(sampleInput())
  assert.match(first.id, UUID_V4)
  assert.match(second.id, UUID_V4)
  assert.notEqual(first.id, second.id)
})

test('createUserMessage：content / source 透传', () => {
  const input = sampleInput()
  const msg = createUserMessage(input)
  assert.deepEqual(msg.content, input.content)
  assert.deepEqual(msg.source, input.source)
})

test('createUserMessage：structuredClone 脱钩，返回值与入参非同一引用', () => {
  const input = sampleInput()
  const msg = createUserMessage(input)
  assert.notEqual(msg.content, input.content)
  assert.notEqual(msg.content[0], input.content[0])
  assert.notEqual(msg.source, input.source)
})

test('createUserMessage：消息、content、content[0]、source 均被冻结', () => {
  const msg = createUserMessage(sampleInput())
  assert.equal(Object.isFrozen(msg), true)
  assert.equal(Object.isFrozen(msg.content), true)
  assert.equal(Object.isFrozen(msg.content[0]), true)
  assert.equal(Object.isFrozen(msg.source), true)
})

test('transportError(Error)：ok=false / code=internal / message 透传 / details 为空对象', () => {
  const res = transportError(new Error('boom'))
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.error.code, 'internal')
  assert.equal(res.error.message, 'boom')
  assert.deepEqual(res.error.details, {})
})

test('transportError(非 Error)：message 走 String(value) 分支', () => {
  const res = transportError('boom')
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.error.code, 'internal')
  assert.equal(res.error.message, 'boom')
  assert.deepEqual(res.error.details, {})

  const num = transportError(42)
  assert.equal(num.ok, false)
  if (!num.ok) assert.equal(num.error.message, '42')
})
