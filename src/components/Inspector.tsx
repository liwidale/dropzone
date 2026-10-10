import { useMemo } from 'react'
import { moveMenu, openEntries, revealEntries } from '../actions'
import { fileUrl } from '../api'
import { base, bytes, count, longDate, relative } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { canPreview, KINDS } from '../kinds'
import { popup } from '../menu'
import { useApp } from '../store'
import type { Entry } from '../types'
import { useSelected } from '../visible'
import { FileGlyph } from './FileGlyph'
import { Btn } from './ui'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className="selectable">{children}</dd>
    </div>
  )
}

function Actions({ entries }: { entries: Entry[] }) {
  const trash = useApp((s) => s.trash)
  const busy = useApp((s) => !!s.applying)
  const menu = moveMenu(entries)
  return (
    <div className="insp-actions">
      {entries.length === 1 && (
        <div className="insp-pair">
          <Btn icon="open" onClick={() => void openEntries(entries)}>
            {tr('Open')}
          </Btn>
          <Btn icon="folder" onClick={() => void revealEntries(entries)}>
            {tr('Show in Finder')}
          </Btn>
        </div>
      )}
      <div className="insp-pair">
        <Btn icon="move" disabled={busy} onClick={() => typeof menu !== 'string' && menu.items && void popup(menu.items)}>
          {tr('Move to…')}
        </Btn>
        <Btn icon="trash" disabled={busy} onClick={() => void trash(entries)}>
          {tr('Trash')}
        </Btn>
      </div>
    </div>
  )
}

function Single({ e }: { e: Entry }) {
  const current = useApp((s) => s.current)!
  const plan = useApp((s) => s.plans[current]?.data)
  const dupes = useApp((s) => s.dupes[current])
  const go = useApp((s) => s.go)
  const op = plan?.ops.find((o) => o.source === e.path)
  const copies = dupes?.groups.find((g) => g.files.some((f) => f.path === e.path))
  const next =
    e.project != null && !e.dir
      ? tr('This folder looks like a code project, so sorting is paused.')
      : e.kind === 'partial'
        ? tr('Still downloading, or stopped before it finished. Dropzone leaves it alone.')
        : op
          ? op.action === 'trash'
            ? tr('Sorting moves it to the Trash, following “{0}”.', op.ruleName)
            : tr('Sorting moves it to {0}, following “{1}”.', relative(op.destination!.replace(/\/[^/]+$/, ''), current), op.ruleName)
          : e.dir
            ? tr('Already in a subfolder, so rules leave it where it is.')
            : tr('No rule matches it, so it stays here.')
  return (
    <>
      <div className="insp-hero">{canPreview(e.ext, e.size) ? <img className="insp-image" src={fileUrl(e.path)} alt="" draggable={false} /> : <FileGlyph entry={e} size={72} />}</div>
      <div className="insp-name selectable">{e.name}</div>
      <div className="insp-sub">
        {KINDS[e.kind].one} · {bytes(e.size)}
      </div>
      <div className="insp-note">
        <Icon name="sort" size={13} />
        <span>{next}</span>
      </div>
      {e.project != null && (
        <div className="insp-note">
          <Icon name="code" size={13} />
          <span>{tr('Part of the code project {0}. Sorting and duplicate cleanup never touch it.', e.project ? base(e.project) : base(current))}</span>
        </div>
      )}
      {copies && (
        <button type="button" className="insp-note link" onClick={() => go('duplicates')}>
          <Icon name="copies" size={13} />
          <span>{tr('Identical to {0} other file.|Identical to {0} other files.', copies.files.length - 1)}</span>
        </button>
      )}
      <dl className="facts">
        <Fact label={tr('Added')}>{longDate(e.added)}</Fact>
        <Fact label={tr('Modified')}>{longDate(e.modified)}</Fact>
        {e.from && <Fact label={tr('Downloaded from')}>{e.from}</Fact>}
        <Fact label={tr('Where')}>{e.dir ? `${base(current)}/${e.dir}` : base(current)}</Fact>
      </dl>
      <Actions entries={[e]} />
    </>
  )
}

function Many({ entries }: { entries: Entry[] }) {
  const kinds = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(KINDS[e.kind].many, (m.get(KINDS[e.kind].many) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [entries])
  return (
    <>
      <div className="insp-hero stack">
        {entries.slice(0, 3).map((e, i) => (
          <span key={e.path} className="stack-card" style={{ transform: `rotate(${(i - 1) * 6}deg) translateY(${Math.abs(i - 1) * 4}px)`, zIndex: 3 - Math.abs(i - 1) }}>
            <FileGlyph entry={e} size={56} />
          </span>
        ))}
      </div>
      <div className="insp-name">{tr('{0} item|{0} items', entries.length)}</div>
      <div className="insp-sub">{bytes(entries.reduce((n, e) => n + e.size, 0))}</div>
      <dl className="facts">
        {kinds.slice(0, 6).map(([k, n]) => (
          <Fact key={k} label={k}>
            {count(n)}
          </Fact>
        ))}
      </dl>
      <Actions entries={entries} />
    </>
  )
}

export function Inspector() {
  const selected = useSelected()
  return (
    <aside className="inspector scroll" aria-label={tr('Inspector')}>
      {selected.length === 0 ? (
        <div className="insp-empty">
          <span className="empty-icon">
            <Icon name="info" size={22} strokeWidth={1.3} />
          </span>
          <div className="empty-title">{tr('No selection')}</div>
          <div className="empty-text">{tr('Select a file to see where it came from and what sorting would do with it.')}</div>
        </div>
      ) : selected.length === 1 ? (
        <Single e={selected[0]} />
      ) : (
        <Many entries={selected} />
      )}
    </aside>
  )
}
