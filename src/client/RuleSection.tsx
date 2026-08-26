// RuleSection：设置面板"规则"区。原生 HTML 元素 + 内联样式（client bundle 不 import UI primitives）。
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { RuleController } from './controller.ts'
import type { Rule, RuleLevel } from './types.ts'

export interface RuleSectionProps {
  controller: RuleController
}

const LEVELS: readonly RuleLevel[] = ['global', 'project']
const LABELS: Record<RuleLevel, string> = { global: '全局', project: '项目' }

/** 编辑态：id 为 null 表示新建；undefined 表示尚未取得 id（新建前） */
interface Editing {
  id: string | null
  content: string
}

export function RuleSection({ controller }: RuleSectionProps): JSX.Element {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [level, setLevel] = useState<RuleLevel>('global')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void controller.load(level)
  }, [controller, level])

  const rows = state.status === 'ready' ? state.rows : []

  const beginEdit = (rule: Rule): void => setEditing({ id: rule.id, content: rule.content })
  const beginCreate = (target: RuleLevel): void => {
    setLevel(target)
    setCreateMenuOpen(false)
    setEditing({ id: null, content: '' })
  }

  const submitEdit = async (): Promise<void> => {
    if (!editing) return
    setBusy(true)
    const ok = editing.id === null
      ? await controller.create(level, editing.content)
      : await controller.save(level, editing.id, editing.content)
    setBusy(false)
    if (ok) setEditing(null)
  }

  const doRemove = async (): Promise<void> => {
    if (!confirmDeleteId) return
    setBusy(true)
    await controller.remove(level, confirmDeleteId)
    setBusy(false)
    setConfirmDeleteId(null)
  }

  const reload = async (): Promise<void> => {
    setBusy(true)
    await controller.reload(level)
    setBusy(false)
  }

  return (
    <div style={styles.section}>
      <div style={styles.head}>
        <h2 style={styles.title}>规则</h2>
        <div style={styles.headActions}>
          <button type="button" style={styles.ghostButton} onClick={() => void reload()} disabled={busy}>
            刷新
          </button>
          <div style={styles.createWrap}>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => setCreateMenuOpen((v) => !v)}
              disabled={busy}
            >
              + 创建
            </button>
            {createMenuOpen && (
              <div style={styles.menu}>
                {LEVELS.map((l) => (
                  <button key={l} type="button" style={styles.menuItem} onClick={() => beginCreate(l)}>
                    {LABELS[l]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <p style={styles.intro}>创建并管理规则，在聊天过程中遵循这些规则。</p>

      <div style={styles.tabs}>
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            style={level === l ? styles.tabActive : styles.tab}
            onClick={() => setLevel(l)}
          >
            {LABELS[l]}
          </button>
        ))}
      </div>

      {state.status === 'loading' ? (
        <p style={styles.muted}>加载中…</p>
      ) : state.status === 'error' ? (
        <p style={styles.error} role="alert">{state.error}</p>
      ) : rows.length === 0 ? (
        <p style={styles.muted}>暂无{LABELS[level]}规则，点击“+ 创建”添加。</p>
      ) : (
        <ul style={styles.list}>
          {rows.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onEdit={() => beginEdit(rule)}
              onDelete={() => setConfirmDeleteId(rule.id)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <div style={styles.editor}>
          <textarea
            style={styles.textarea}
            value={editing.content}
            disabled={busy}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            placeholder={'# 规则标题\n\n规则内容…'}
          />
          <div style={styles.editorActions}>
            <button type="button" style={styles.ghostButton} onClick={() => setEditing(null)} disabled={busy}>取消</button>
            <button type="button" style={styles.primaryButton} onClick={() => void submitEdit()} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div style={styles.editor}>
          <p style={styles.intro}>确定删除该规则？</p>
          <div style={styles.editorActions}>
            <button type="button" style={styles.ghostButton} onClick={() => setConfirmDeleteId(null)} disabled={busy}>取消</button>
            <button type="button" style={styles.dangerButton} onClick={() => void doRemove()} disabled={busy}>
              {busy ? '删除中…' : '删除'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 单行规则：左图标 + 内容 + 设置按钮（下拉：编辑/删除）；双击进入编辑 */
function RuleRow({ rule, onEdit, onDelete }: { rule: Rule; onEdit: () => void; onDelete: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <li style={styles.row} onDoubleClick={onEdit}>
      <span style={styles.fileIcon} />
      <div style={styles.rowBody}>
        <div style={styles.rowTitle}>{rule.title}</div>
        <div style={styles.rowMeta}>{rule.id}.md</div>
      </div>
      <div style={styles.rowActions}>
        <button
          type="button"
          style={styles.iconButton}
          aria-label="设置"
          onClick={() => setOpen((v) => !v)}
        >
          ⋮
        </button>
        {open && (
          <div style={styles.menu}>
            <button type="button" style={styles.menuItem} onClick={() => { setOpen(false); onEdit() }}>编辑</button>
            <button type="button" style={styles.menuItem} onClick={() => { setOpen(false); onDelete() }}>删除</button>
          </div>
        )}
      </div>
    </li>
  )
}

const styles: Record<string, CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { margin: 0, fontSize: 18 },
  headActions: { display: 'flex', gap: 8, alignItems: 'center' },
  intro: { margin: 0, color: '#888', fontSize: 13 },
  createWrap: { position: 'relative' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid #e0e0e0' },
  tab: { padding: '6px 12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: '2px solid transparent', fontSize: 13 },
  tabActive: { padding: '6px 12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: '2px solid #2563eb', fontWeight: 600, fontSize: 13 },
  muted: { color: '#888', fontSize: 13, margin: 0 },
  error: { color: '#dc2626', fontSize: 13, margin: 0 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px', border: '1px solid #e5e5e5', borderRadius: 6, cursor: 'default' },
  fileIcon: { width: 12, height: 14, background: '#93c5fd', borderRadius: 2, flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowMeta: { fontSize: 12, color: '#999' },
  rowActions: { position: 'relative' },
  iconButton: { border: 'none', background: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: 16, color: '#666', lineHeight: 1 },
  menu: { position: 'absolute', right: 0, top: '100%', background: '#fff', border: '1px solid #d0d0d0', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 10, display: 'flex', flexDirection: 'column', minWidth: 88, marginTop: 2 },
  menuItem: { border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: '6px 12px', fontSize: 13 },
  editor: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #d0d0d0', borderRadius: 6, padding: 10, background: '#fafafa' },
  textarea: { width: '100%', minHeight: 160, fontFamily: 'inherit', fontSize: 13, padding: 8, boxSizing: 'border-box', resize: 'vertical' },
  editorActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  ghostButton: { border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontSize: 13 },
  primaryButton: { border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontSize: 13 },
  dangerButton: { border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontSize: 13 },
}