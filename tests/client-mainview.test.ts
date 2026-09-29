// 单测：mainViewSession 官方「当前主视图会话」判据（0.1.8，调查报告-001 修复 A）。
// 覆盖：多会话快照取 retainedBy.mainView>0 的行、计数归零/缺失 → undefined、cwd 提取、计数叠加。
// 手法：直测 src/client/sessions.ts 的纯函数（无 React/JSX 依赖，node --test 可直接跑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mainViewSession, type SessionRow } from '../src/client/sessions.ts'

function snapshot(...rows: Array<SessionRow | undefined>): { byId: Record<string, SessionRow | undefined> } {
  return { byId: Object.fromEntries(rows.map((r, i) => [r?.id ?? `s${i}`, r])) }
}

test('mainViewSession：唯一主视图会话（mainView>0）被选中，cwd 可提取', () => {
  const snap = snapshot(
    { id: 'a', cwd: '/proj/a' },
    { id: 'b', cwd: '/proj/b', retainedBy: { mainView: 1 } },
    { id: 'c', cwd: '/proj/c', retainedBy: { mainView: 0 } },
  )
  const s = mainViewSession(snap)
  assert.equal(s?.id, 'b')
  assert.equal(s?.cwd, '/proj/b')
})

test('mainViewSession：无主视图会话（全部 mainView<=0）→ undefined（未选定项目语义）', () => {
  const snap = snapshot(
    { id: 'a', cwd: '/proj/a' },
    { id: 'b', cwd: '/proj/b', retainedBy: { mainView: 0 } },
  )
  assert.equal(mainViewSession(snap), undefined)
})

test('mainViewSession：行缺失 retainedBy / 空快照 / 空行 → undefined', () => {
  assert.equal(mainViewSession(snapshot()), undefined)
  assert.equal(mainViewSession(snapshot(undefined)), undefined)
  assert.equal(mainViewSession({ byId: {} }), undefined)
})

test('mainViewSession：主视图计数可叠加（>0 即选中，取首个命中）', () => {
  const snap = snapshot(
    { id: 'a', cwd: '/proj/a', retainedBy: { mainView: 2 } },
    { id: 'b', cwd: '/proj/b', retainedBy: { mainView: 1 } },
  )
  assert.equal(mainViewSession(snap)?.id, 'a')
  assert.equal(mainViewSession(snap)?.cwd, '/proj/a')
})