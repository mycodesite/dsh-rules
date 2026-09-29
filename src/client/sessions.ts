// sessions.list 快照的最小消费面 + 官方「当前主视图会话」判据（纯类型 + 纯函数，无 React 依赖，便于单测）。
export interface SessionRow {
  id: string
  cwd?: string
  /** 主视图保留计数：>0 即「当前主视图会话」——官方判据，workspace/open-in-app/agent-preset/session 六处同源 */
  retainedBy?: { mainView?: number }
}

/** sessions.list 的最小快照面（不引入运行时依赖，仅类型声明） */
export interface SessionsListProvider {
  getSnapshot(): { byId: Record<string, SessionRow | undefined> }
  subscribe(listener: () => void): () => void
}

/**
 * 官方「当前主视图会话」判据：retainedBy.mainView > 0。
 * 0.1.6 曾误读不存在的 `sessions.list.current` 字段（调查报告-001 根因①），0.1.8 起改用此范式。
 */
export function mainViewSession(snapshot: { byId: Record<string, SessionRow | undefined> }): SessionRow | undefined {
  return Object.values(snapshot.byId).find((row) => (row?.retainedBy?.mainView ?? 0) > 0)
}