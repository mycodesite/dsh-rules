// RuleSection：设置面板"规则"区。原生 HTML 元素 + 内联样式（client bundle 不 import UI primitives）。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import type { RuleController } from './controller.ts'
import type { Rule, RuleLevel } from './types.ts'

export interface RuleSectionProps {
  controller: RuleController
}

const LEVELS: readonly RuleLevel[] = ['global', 'project']
const LABELS: Record<RuleLevel, string> = { global: '全局', project: '项目' }

/** 当 active 为 true（菜单/下拉打开）时，监听文档级 mousedown，点击容器 ref 外部即调用 onClose()。 */
function useClickOutside<T extends HTMLElement>(active: boolean, onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [active, onClose])
  return ref
}

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
  /** 「+ 创建」下拉：点击外部关闭（与行设置菜单共用 useClickOutside） */
  const createWrapRef = useClickOutside<HTMLDivElement>(createMenuOpen, () => setCreateMenuOpen(false))
  /** 当前项目 cwd；null = 未选定项目（仅项目 tab 有意义） */
  const [projectCwd, setProjectCwd] = useState<string | null>(null)

  useEffect(() => {
    if (level === 'project') {
      void controller.currentCwd().then(setProjectCwd)
    } else {
      setProjectCwd(null)
    }
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
    if (level === 'project') {
      const cwd = await controller.currentCwd()
      if (!cwd) {
        setBusy(false)
        window.alert('当前未选定项目，无法保存项目规则。请先选定一个项目（开启一个项目对话）后再试。')
        return
      }
    }
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
          <div style={styles.createWrap} ref={createWrapRef}>
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
        level === 'project' && projectCwd === null ? (
          <p style={styles.warn} role="alert">未选定项目：请先开启一个项目对话（选定项目）后，再创建项目规则。</p>
        ) : (
          <p style={styles.muted}>暂无{LABELS[level]}规则，点击“+ 创建”添加。</p>
        )
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

/** 单行规则：左图标 + 内容 + 设置按钮（下拉：编辑/删除）；单击进入编辑，设置按钮区域除外 */
function RuleRow({ rule, onEdit, onDelete }: { rule: Rule; onEdit: () => void; onDelete: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const actionsRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false))
  const handleRowClick = (e: ReactMouseEvent<HTMLLIElement>): void => {
    // 点击 ⋮ 按钮或菜单项（位于 [data-rule-actions] 内）不触发行编辑
    if ((e.target as HTMLElement).closest('[data-rule-actions]')) return
    onEdit()
  }
  return (
    <li style={styles.row} onClick={handleRowClick}>
      <span style={styles.fileIcon} />
      <div style={styles.rowBody}>
        <div style={styles.rowTitle}>{rule.title}</div>
        <div style={styles.rowMeta}>{rule.id}.md</div>
      </div>
      <div style={styles.rowActions} data-rule-actions ref={actionsRef}>
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
  intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 },
  createWrap: { position: 'relative' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-separator-primary)' },
  tab: { padding: '6px 12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: '2px solid transparent', fontSize: 13 },
  tabActive: { padding: '6px 12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: '2px solid var(--dsw-alias-brand-primary)', fontWeight: 600, fontSize: 13 },
  muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, margin: 0 },
  error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, margin: 0 },
  warn: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 13, margin: 0 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, cursor: 'default' },
  fileIcon: { width: 12, height: 14, background: 'var(--dsw-alias-brand-primary)', borderRadius: 2, flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowMeta: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
  rowActions: { position: 'relative' },
  iconButton: { border: 'none', background: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: 16, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1 },
  menu: { position: 'absolute', right: 0, top: '100%', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 10, display: 'flex', flexDirection: 'column', minWidth: 88, marginTop: 2 },
  menuItem: { border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: '6px 12px', fontSize: 13 },
  editor: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: 10, background: 'var(--dsw-alias-bg-layer-1)' },
  textarea: { width: '100%', minHeight: 160, fontFamily: 'inherit', fontSize: 13, padding: 8, boxSizing: 'border-box', resize: 'vertical' },
  editorActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  ghostButton: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-button-ghost-active-fill)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontSize: 13 },
  primaryButton: { border: 'none', background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-inverted)', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontSize: 13 },
  dangerButton: { border: 'none', background: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-label-primary-inverted)', cursor: 'pointer', padding: '4px 12px', borderRadius: 6, fontSize: 13 },
}