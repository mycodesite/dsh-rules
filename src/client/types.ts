// client 侧最小类型：RPC 为 JSON，结构与 host 一致，不必跨半 import。
export type RuleLevel = 'global' | 'project'

export interface Rule {
  id: string
  title: string
  content: string
  level: RuleLevel
  filePath: string
}

export interface RpcError {
  code: string
  message: string
  details?: unknown
}

export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: RpcError }