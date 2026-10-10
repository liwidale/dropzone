import { bytes, home } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { KINDS } from '../kinds'
import { folderOf, useApp, type Preset } from '../store'
import { useVisible } from '../visible'
import { Btn } from './ui'

export const PRESET_LABEL: Record<Preset, string> = {
  'stale-installers': tr('Old installers'),
  unfinished: tr('Unfinished downloads'),
  large: tr('Large files'),
}

export function Toolbar() {
  const folder = useApp(folderOf)
  const view = useApp((s) => s.view)
  const kind = useApp((s) => s.kind)
  const preset = useApp((s) => s.preset)
  const query = useApp((s) => s.query)
  const inspector = useApp((s) => s.inspector)
  const snap = useApp((s) => (s.current ? s.snapshots[s.current]?.data : undefined))
  const plan = useApp((s) => (s.current ? s.plans[s.current]?.data : undefined))
  const applying = useApp((s) => s.applying)
  const visible = useVisible()
  const { set, go } = useApp.getState()

  if (!folder) return <div className="toolbar" data-tauri-drag-region />

  const title =
    view === 'overview'
      ? folder.name
      : view === 'files'
        ? query
          ? tr('Search results')
          : preset
            ? PRESET_LABEL[preset]
            : kind
              ? KINDS[kind].many
              : tr('All files')
        : view === 'duplicates'
          ? tr('Duplicates')
          : view === 'rules'
            ? tr('Rules')
            : tr('History')

  const subtitle =
    view === 'files'
      ? tr('{0} item|{0} items', visible.length) + (visible.length ? ` · ${bytes(visible.reduce((n, e) => n + e.size, 0))}` : '')
      : snap
        ? tr('{0} item|{0} items', snap.entries.length) + ` · ${bytes(snap.totalSize)}`
        : home(folder.path)

  const pending = plan?.ops.length ?? 0

  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="tb-title" data-tauri-drag-region>
        <h1 data-tauri-drag-region>{title}</h1>
        <div className="tb-sub" data-tauri-drag-region>
          {subtitle}
        </div>
      </div>
      <div className="tb-actions">
        <label className="search">
          <Icon name="search" size={13} />
          <input
            id="search"
            type="search"
            placeholder={tr('Search')}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              set({ query: e.target.value, selection: [] })
              if (e.target.value && view !== 'files') go('files', { kind: null, preset: null })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                set({ query: '' })
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                document.querySelector<HTMLElement>('.list-body')?.focus()
              }
            }}
          />
          {query && (
            <button type="button" className="search-clear" aria-label={tr('Clear search')} onClick={() => set({ query: '' })}>
              <Icon name="close" size={9} strokeWidth={2} />
            </button>
          )}
        </label>
        {view === 'files' && <Btn kind="ghost" icon="inspector" title={inspector ? tr('Hide inspector') : tr('Show inspector')} onClick={() => set({ inspector: !inspector })} />}
        <Btn
          kind={pending ? 'primary' : 'secondary'}
          icon="sort"
          disabled={!pending || !!applying}
          onClick={() => set({ sheet: { type: 'sort' } })}
          title={pending ? undefined : tr('Nothing to sort right now')}
        >
          {pending ? tr('Sort {0} file…|Sort {0} files…', pending) : tr('Sort files')}
        </Btn>
      </div>
    </header>
  )
}
