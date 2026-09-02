// 宿主契约的本地实现：与 @deepseek-ai/dsh-llm / @deepseek-ai/dsh-host-apiproxy 的
// 对应函数逐字等价，但不产生任何对宿主包的运行时导入。
//
// 为什么存在：dsh 以 link: 符号链接安装插件时，Node 以 realpath 为解析起点，
// 解析链跳出 profile，宿主兜底层（$DSH_HOME/profiles/node_modules）不生效，
// 裸导入宿主包将直接导致 dsh 启动失败（宿主 fail-loud，无软失败通道）。
// 详见《调查报告-002》与《解决方案-002》§3。
//
// 铁律（由 scripts/check-artifact-imports.mjs 在构建期强制，且经 CI 与 npm pack 覆盖）：
//   本文件及其调用方不得引入 @deepseek-ai/* 的值导入；类型导入允许（编译期擦除）。
// 契约依据（宿主真包 0.1.1-rc.2，逐行核实）：
//   dsh-llm/lib/types/message.js L25-49、call-config.js L54-85、brand.js L17-19
//   dsh-host-apiproxy/lib/types/api/rpc.js L24-29、rpc.d.ts L173/L181-195
import { randomUUID } from 'node:crypto'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/**
 * 深度冻结：与 @deepseek-ai/dsh-llm 的 deepFreeze 同语义
 * （迭代式、WeakSet 环安全、Object.keys 遍历、跳过 AbortSignal）。
 */
function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const node: unknown = pending.pop()
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    for (const key of Object.keys(node)) {
      pending.push((node as Record<string, unknown>)[key])
    }
  }
  return value
}

/**
 * 构造一条 user 角色消息 —— 与 dsh-llm 的 createUserMessage 逐字等价：
 * 铸造 id → 固定 role → 结构化克隆脱钩 → 深度冻结后发布。
 *
 * 保持冻结语义是刻意的：宿主契约要求「freeze it before publication」，
 * 下游（LLM 运行时 / 会话持久化）已在冻结对象上运行，偏离即改变行为。
 */
export function createUserMessage(input: Omit<UserMessage, 'id' | 'role'>): UserMessage {
  const draft: UserMessage = { ...input, role: 'user', id: randomUUID() as MessageId }
  return deepFreeze(structuredClone(draft))
}

/**
 * 把异常折叠为 RpcResult 的错误分支 —— 与 dsh-host-apiproxy 的 transportError
 * 逐字等价（'internal' 为兜底码，details 为 {}）。
 *
 * 不可改动 code / details：结果会经 serverResponseSchema 校验，
 * 且 tests/smoke.test.ts L136 已断言 error.code === 'internal'。
 */
export function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}
