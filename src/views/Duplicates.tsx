import { entryMenu, openEntries } from '../actions'
import { FileGlyph } from '../components/FileGlyph'
import { Bar, Btn, Empty, Spinner } from '../components/ui'
import { bytes, relative, when } from '../format'
import { tr } from '../i18n'
import { folderOf, useApp, type Dupes } from '../store'
import type { DupGroup, Entry } from '../types'

export function doomed(d: Dupes | undefined): Entry[] {
  if (!d) return []
  return d.groups.flatMap((g) => g.files.filter((f) => !(d.kept[g.id] ?? [g.keep]).includes(f.path)))
}

function GroupCard({ g, kept, root, onToggle }: { g: DupGroup; kept: string[]; root: string; onToggle: (path: string) => void }) {
  const head = g.files.find((f) => kept.includes(f.path)) ?? g.files[0]
  return (
    <section className="dupe">
      <header className="dupe-head">
        <FileGlyph entry={head} size={30} />
        <div className="row-text">
          <div className="row-title ellipsis">{head.name}</div>
          <div className="row-desc">{tr('{0} identical copies, {1} each', g.files.length, bytes(g.size))}</div>
        </div>
      </header>
      {g.files.map((f) => {
        const keep = kept.includes(f.path)
        const last = keep && kept.length === 1
        return (
          <div
            key={f.path}
            className={`dupe-row${keep ? '' : ' gone'}`}
            onDoubleClick={() => void openEntries([f])}
            onContextMenu={(e) => {
              e.preventDefault()
              void entryMenu([f])
            }}
          >
            <div className="dupe-path ellipsis" title={f.path}>
              {relative(f.path, root)}
            </div>
            <div className="dupe-meta">
              {when(f.added)}
              {f.from ? ` · ${f.from}` : ''}
            </div>
            <button
              type="button"
              className={`chip ${keep ? 'chip-keep' : 'chip-trash'}`}
              disabled={last}
              title={last ? tr('One copy always stays.') : keep ? tr('Move this copy to the Trash') : tr('Keep this copy')}
              aria-pressed={keep}
              onClick={() => onToggle(f.path)}
            >
              {keep ? tr('Keep') : tr('Move to Trash')}
            </button>
          </div>
        )
      })}
    </section>
  )
}

export function Duplicates() {
  const current = useApp((s) => s.current)!
  const folder = useApp(folderOf)!
  const d = useApp((s) => s.dupes[current])
  const applying = useApp((s) => !!s.applying)
  const { set, loadDupes } = useApp.getState()

  const toggle = (g: DupGroup, path: string) => {
    if (!d) return
    const kept = d.kept[g.id] ?? [g.keep]
    const next = kept.includes(path) ? kept.filter((p) => p !== path) : [...kept, path]
    if (!next.length) return
    set({ dupes: { ...useApp.getState().dupes, [current]: { ...d, kept: { ...d.kept, [g.id]: next } } } })
  }

  if (!d || (d.status === 'running' && !d.groups.length)) {
    const pct = d && d.total ? Math.round((d.done / d.total) * 100) : 0
    return (
      <div className="center-state">
        <Spinner size={18} />
        <div className="empty-title">{tr('Comparing files…')}</div>
        <div className="empty-text">{tr('Dropzone reads the contents of files with the same size to find exact copies. It stays on this Mac.')}</div>
        <div className="center-bar">
          <Bar value={d?.done ?? 0} total={d?.total || 1} />
          <span>{tr('{0}%', pct)}</span>
        </div>
      </div>
    )
  }

  if (d.status === 'error' && !d.groups.length) {
    return (
      <Empty icon="alert" title={tr('Couldn’t finish looking for duplicates')} actions={<Btn onClick={() => void loadDupes(current)}>{tr('Try again')}</Btn>}>
        {tr('Some files couldn’t be read. Check that the folder is still available.')}
      </Empty>
    )
  }

  if (!d.groups.length) {
    return (
      <Empty
        icon="copies"
        title={tr('No duplicates')}
        actions={
          <Btn icon="refresh" onClick={() => void loadDupes(current)}>
            {tr('Check again')}
          </Btn>
        }
      >
        {tr('Every file in {0} is unique. Dropzone compares contents, so renamed copies are found too. Files inside code projects are left out.', folder.name)}
      </Empty>
    )
  }

  const gone = doomed(d)
  const freed = gone.reduce((n, f) => n + f.size, 0)

  return (
    <div className="dupes">
      <div className="page scroll">
        <div className="page-inner">
          <div className="dupes-intro">
            <p>{tr('These files have exactly the same contents. One copy of each stays where it is; choose which ones move to the Trash. Files inside code projects are left out.')}</p>
            {d.status === 'running' && (
              <span className="inline-state">
                <Spinner size={11} /> {tr('Checking again…')}
              </span>
            )}
          </div>
          {d.groups.map((g) => (
            <GroupCard key={g.id} g={g} kept={d.kept[g.id] ?? [g.keep]} root={current} onToggle={(p) => toggle(g, p)} />
          ))}
        </div>
      </div>
      <footer className="actionbar">
        <div className="actionbar-text">
          {gone.length ? tr('{0} file moves to the Trash and frees {1}.|{0} files move to the Trash and free {1}.', gone.length, bytes(freed)) : tr('All copies are kept.')}
          <span className="muted"> {tr('{0} set|{0} sets', d.groups.length)}</span>
        </div>
        <Btn kind="primary" icon="trash" disabled={!gone.length || applying} onClick={() => set({ sheet: { type: 'dupes' } })}>
          {tr('Move to Trash…')}
        </Btn>
      </footer>
    </div>
  )
}
