import { useMemo, type ReactNode } from 'react'
import { api } from '../api'
import { count } from '../format'
import { tr } from '../i18n'
import { Icon, type IconName } from '../icons'
import { KIND_ORDER, KINDS } from '../kinds'
import { popup } from '../menu'
import { isMac } from '../platform'
import { folderOf, useApp, type View } from '../store'
import type { Folder, Kind } from '../types'
import { Spinner } from './ui'

const folderIcon = (f: Folder): IconName => (f.known === 'downloads' ? 'download' : f.known === 'desktop' ? 'desktop' : f.known === 'documents' ? 'document' : 'folder')

function Item({
  icon,
  label,
  badge,
  on,
  onClick,
  tone,
  onMenu,
  muted,
}: {
  icon: IconName
  label: string
  badge?: ReactNode
  on?: boolean
  onClick: () => void
  tone?: string
  onMenu?: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      className={`side-item${on ? ' on' : ''}${muted ? ' muted' : ''}`}
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      onContextMenu={(e) => {
        if (!onMenu) return
        e.preventDefault()
        onMenu()
      }}
    >
      <span className="side-icon" style={{ color: tone }}>
        <Icon name={icon} size={15} />
      </span>
      <span className="side-label">{label}</span>
      {badge !== undefined && <span className="side-badge">{badge}</span>}
    </button>
  )
}

export function Sidebar() {
  const folders = useApp((s) => s.folders)
  const current = useApp((s) => s.current)
  const view = useApp((s) => s.view)
  const kind = useApp((s) => s.kind)
  const preset = useApp((s) => s.preset)
  const folder = useApp(folderOf)
  const snap = useApp((s) => (s.current ? s.snapshots[s.current] : undefined))
  const dupes = useApp((s) => (s.current ? s.dupes[s.current] : undefined))
  const plan = useApp((s) => (s.current ? s.plans[s.current]?.data : undefined))
  const { select, go, chooseFolder, set } = useApp.getState()

  const kinds = useMemo(() => {
    const m = new Map<Kind, number>()
    for (const e of snap?.data?.entries ?? []) m.set(e.kind, (m.get(e.kind) ?? 0) + 1)
    return KIND_ORDER.filter((k) => m.get(k)).map((k) => ({ kind: k, n: m.get(k)! }))
  }, [snap?.data])

  const extra = dupes?.groups.reduce((n, g) => n + g.files.length - 1, 0) ?? 0
  const at = (v: View) => view === v && (v !== 'files' || (!kind && !preset))

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" data-tauri-drag-region />
      <nav className="side-scroll scroll" aria-label={tr('Sidebar')}>
        <div className="side-section">
          <div className="side-title">{tr('Folders')}</div>
          {folders.map((f) => (
            <Item
              key={f.path}
              icon={folderIcon(f)}
              label={f.name}
              on={f.path === current}
              onClick={() => select(f.path)}
              badge={f.path === current && snap?.status === 'loading' ? <Spinner size={11} /> : undefined}
              onMenu={() =>
                void popup([
                  { text: tr('Show in Finder'), action: () => void api.reveal(f.path) },
                  'separator',
                  { text: tr('Remove from Dropzone…'), action: () => set({ sheet: { type: 'remove', path: f.path } }) },
                ])
              }
            />
          ))}
          <Item icon="plus" label={tr('Add folder…')} muted onClick={() => void chooseFolder()} />
        </div>

        {folder && (
          <div className="side-section">
            <div className="side-title">{folder.name}</div>
            <Item
              icon="overview"
              label={tr('Overview')}
              on={at('overview')}
              onClick={() => go('overview')}
              badge={plan?.ops.length ? <span className="pill-badge">{count(plan.ops.length)}</span> : undefined}
            />
            <Item icon="list" label={tr('All files')} on={at('files')} onClick={() => go('files', { kind: null, preset: null })} badge={snap?.data ? count(snap.data.entries.length) : undefined} />
            <Item
              icon="copies"
              label={tr('Duplicates')}
              on={at('duplicates')}
              onClick={() => go('duplicates')}
              badge={dupes?.status === 'running' ? <Spinner size={11} /> : extra ? count(extra) : undefined}
            />
            <Item icon="rules" label={tr('Rules')} on={at('rules')} onClick={() => go('rules')} badge={count(folder.rules.filter((r) => r.enabled).length)} />
            <Item icon="history" label={tr('History')} on={at('history')} onClick={() => go('history')} />
          </div>
        )}

        {folder && kinds.length > 0 && (
          <div className="side-section">
            <div className="side-title">{tr('Kinds')}</div>
            {kinds.map(({ kind: k, n }) => (
              <Item
                key={k}
                icon={KINDS[k].icon}
                tone={KINDS[k].color}
                label={KINDS[k].many}
                badge={count(n)}
                on={view === 'files' && kind === k}
                onClick={() => go('files', { kind: k, preset: null })}
              />
            ))}
          </div>
        )}
      </nav>
      {!isMac && (
        <div className="side-foot">
          <Item icon="gear" label={tr('Settings')} muted onClick={() => set({ sheet: { type: 'settings' } })} />
        </div>
      )}
    </aside>
  )
}
