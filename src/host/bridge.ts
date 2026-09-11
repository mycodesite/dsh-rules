// 本地信封桥：raw HTTP Request → client-request 信封 → dispatch → server-response 信封。
// 语义复刻宿主 rpcFetchHandler（415 / 400 / 信封校验 / 方法比对 200 信封），零 @deepseek-ai 运行时导入
// （contract.ts 哲学——宿主契约本地逐字实现）。与宿主的有意差异：handler 抛错返回 200 ok:false 信封
// 而非 HTTP 500——client 对非 2xx 会 throw，200 信封则走 controller.callSafe 折叠，失败全程可见。
// 详见 docs/api/04。信封校验为宿主 clientRequestSchema 的最小手工复刻（type/rpcId/method 覆盖一致，
// rpcId 仅查 string 类型，格式校验裁剪）。
export interface RpcResultLike {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string; details?: unknown }
}

export interface Dispatcher {
  (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResultLike>
}

/** server-response 信封：rpcId echo；非字符串回退 'invalid-request'（同宿主 invalidEnvelopeResponse） */
function envelopeResponse(rpcId: unknown, result: RpcResultLike): Response {
  return Response.json({
    type: 'server-response',
    rpcId: typeof rpcId === 'string' ? rpcId : 'invalid-request',
    result,
  })
}

export async function bridgeRpc(request: Request, op: string, dispatch: Dispatcher): Promise<Response> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  const envelope = body as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
  if (typeof body !== 'object' || body === null
    || envelope.type !== 'client-request'
    || typeof envelope.rpcId !== 'string'
    || typeof envelope.method !== 'string') {
    return envelopeResponse(envelope?.rpcId, {
      ok: false,
      error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues: [] } },
    })
  }
  const expected = `rulebase/${op}`
  if (envelope.method !== expected) {
    return envelopeResponse(envelope.rpcId, {
      ok: false,
      error: {
        code: 'gateway/bad-request',
        message: `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(expected)}`,
        details: { issues: [] },
      },
    })
  }
  let result: RpcResultLike
  try {
    result = await dispatch(op, envelope.payload, request.signal)
  } catch (e) {
    result = { ok: false, error: { code: 'rulebase/bridge-error', message: e instanceof Error ? e.message : String(e) } }
  }
  return envelopeResponse(envelope.rpcId, result)
}
