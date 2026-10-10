import { useMemo } from 'react'
import { FileGlyph } from '../components/FileGlyph'
import { Bar, Btn, Empty, Group, Row, Spinner } from '../components/ui'
import { joinAnd } from '../copy'
import { bytes, count, relative, when } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { KIND_ORDER, KINDS } from '../kinds'
import { folderOf, useApp } from '../store'
import type { Kind } from '../types'
import { LARGE, matchesPreset } from '../visible'

function Storage() {
  const snap = useApp((s) => s.snapshots[s.current!]?.data)!
  const go = useApp((s) => s.go)
  const parts = useMemo(() => {
    const m = new Map<Kind, number>()
    for (const e of snap.entries) m.set(e.kind, (m.get(e.kind) ?? 0) + e.size)
    return KIND_ORDER.map((k) => ({ kind: k, size: m.get(k) ?? 0 }))
      .filter((p) => p.size > 0)
      .sort((a, b) => b.size - a.size)
  }, [snap])
  const total = snap.totalSize || 1
  const loose = snap.entries.filter((e) => !e.dir).length
  return (
    <section className="storage">
      <div className="storage-head">
        <div>
          <div className="storage-size">{bytes(snap.totalSize)}</div>
          <div className="storage-sub">{tr('in {0} file|in {0} files', snap.entries.length)}</div>
        </div>
        <div className="storage-loose">
          <strong>{count(loose)}</strong> {tr('at the top level')}
        </div>
      </div>
      <div className="stack-bar" role="img" aria-label={parts.map((p) => `${KINDS[p.kind].many} ${bytes(p.size)}`).join(', ')}>
        {parts.map((p) => (
          <span key={p.kind} style={{ flexGrow: p.size / total, background: KINDS[p.kind].color }} title={`${KINDS[p.kind].many}, ${bytes(p.size)}`} />
        ))}
      </div>
      <div className="legend">
        {parts.slice(0, 8).map((p) => (
          <button type="button" key={p.kind} className="legend-item" onClick={() => go('files', { kind: p.kind, preset: null })}>
            <span className="dot" style={{ background: KINDS[p.kind].color }} />
            <span>{KINDS[p.kind].many}</span>
            <span className="legend-size">{bytes(p.size)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Suggestions() {
  const current = useApp((s) => s.current)!
  const folder = useApp(folderOf)!
  const snap = useApp((s) => s.snapshots[current]?.data)!
  const plan = useApp((s) => s.plans[current])
  const dupes = useApp((s) => s.dupes[current])
  const staleDays = useApp((s) => s.settings.staleDays)
  const { set, go } = useApp.getState()

  const stale = snap.entries.filter((e) => matchesPreset(e, 'stale-installers', staleDays))
  const unfinished = snap.entries.filter((e) => e.kind === 'partial')
  const large = snap.entries.filter((e) => e.size >= LARGE)
  const extra = dupes?.groups.reduce((n, g) => n + g.files.length - 1, 0) ?? 0
  const wasted = dupes?.groups.reduce((n, g) => n + g.size * (g.files.length - 1), 0) ?? 0
  const sum = (list: { size: number }[]) => bytes(list.reduce((n, e) => n + e.size, 0))

  const ops = plan?.data?.ops ?? []
  const dests = [...new Set(ops.map((o) => (o.action === 'trash' ? tr('the Trash') : relative(o.destination!.replace(/\/[^/]+$/, ''), current))))]
  const loose = snap.entries.filter((e) => !e.dir && e.kind !== 'partial').length

  return (
    <Group title={tr('Suggestions')} foot={folder.auto ? tr('New files in {0} are sorted automatically. You can change this in Rules.', folder.name) : undefined}>
      {plan?.data?.project && !folder.allowProject ? (
        <Row icon="code" tone="var(--mint)" title={tr('{0} looks like a code project', folder.name)} desc={tr('It contains {0}, so sorting is paused to keep the project working.', plan.data.project)}>
          <Btn onClick={() => go('rules')}>{tr('Details')}</Btn>
        </Row>
      ) : !plan?.data && plan?.status !== 'error' ? (
        <Row icon="sort" title={tr('Checking what can be sorted…')}>
          <Spinner />
        </Row>
      ) : ops.length ? (
        <Row
          icon="sort"
          tone="var(--blue)"
          title={tr('{0} file can be sorted|{0} files can be sorted', ops.length)}
          desc={dests.length > 3 ? tr('Your rules move them to {0} and {1} more.', dests.slice(0, 3).join(', '), dests.length - 3) : tr('Your rules move them to {0}.', joinAnd(dests))}
        >
          <Btn kind="primary" onClick={() => set({ sheet: { type: 'sort' } })}>
            {tr('Review…')}
          </Btn>
        </Row>
      ) : loose ? (
        <Row icon="sort" title={tr('Nothing to sort')} desc={tr('{0} file at the top level doesn’t match any rule.|{0} files at the top level don’t match any rule.', loose)}>
          <Btn onClick={() => go('rules')}>{tr('Edit rules')}</Btn>
        </Row>
      ) : (
        <Row icon="check" tone="var(--green)" title={tr('Everything is sorted')} desc={tr('There are no loose files at the top level of {0}.', folder.name)} />
      )}

      {dupes?.status === 'running' ? (
        <Row icon="copies" title={tr('Looking for duplicates…')} desc={<Bar value={dupes.done} total={dupes.total || 1} />} />
      ) : dupes?.status === 'error' ? (
        <Row icon="copies" title={tr('Couldn’t finish looking for duplicates')} desc={tr('Some files couldn’t be read.')}>
          <Btn onClick={() => void useApp.getState().loadDupes(current)}>{tr('Try again')}</Btn>
        </Row>
      ) : extra ? (
        <Row
          icon="copies"
          tone="var(--amber)"
          title={tr('{0} duplicate takes up {1}|{0} duplicates take up {1}', extra, bytes(wasted))}
          desc={tr('Each one has an identical copy somewhere else in {0}.', folder.name)}
        >
          <Btn onClick={() => go('duplicates')}>{tr('Review…')}</Btn>
        </Row>
      ) : dupes ? (
        <Row icon="copies" title={tr('No duplicates')} desc={tr('Every file in {0} is unique.', folder.name)} />
      ) : null}

      {stale.length > 0 && (
        <Row
          icon="installer"
          tone="var(--violet)"
          title={tr('{0} installer is older than {1} days|{0} installers are older than {1} days', stale.length, staleDays)}
          desc={tr('{0}. Once an app is installed, its installer is usually safe to remove.', sum(stale))}
        >
          <Btn onClick={() => go('files', { kind: null, preset: 'stale-installers' })}>{tr('Show')}</Btn>
        </Row>
      )}
      {unfinished.length > 0 && (
        <Row icon="partial" title={tr('{0} unfinished download|{0} unfinished downloads', unfinished.length)} desc={tr('They stopped before they finished. Dropzone never moves them.')}>
          <Btn onClick={() => go('files', { kind: null, preset: 'unfinished' })}>{tr('Show')}</Btn>
        </Row>
      )}
      {large.length > 0 && (
        <Row icon="bolt" title={tr('{0} file is larger than 500 MB|{0} files are larger than 500 MB', large.length)} desc={tr('Together they take up {0}.', sum(large))}>
          <Btn onClick={() => go('files', { kind: null, preset: 'large' })}>{tr('Show')}</Btn>
        </Row>
      )}
    </Group>
  )
}

function Recent() {
  const snap = useApp((s) => s.snapshots[s.current!]?.data)!
  const recent = useMemo(() => [...snap.entries].sort((a, b) => b.added - a.added).slice(0, 6), [snap])
  const open = (path: string) => {
    useApp.getState().go('files', { kind: null, preset: null })
    useApp.setState({ selection: [path], anchor: path, query: '', scope: 'all', sort: { key: 'added', dir: -1 } })
  }
  return (
    <Group title={tr('Recently added')}>
      {recent.map((e) => (
        <button type="button" key={e.path} className="row row-button" onClick={() => open(e.path)}>
          <FileGlyph entry={e} size={26} />
          <div className="row-text">
            <div className="row-title ellipsis">{e.name}</div>
            <div className="row-desc">
              {KINDS[e.kind].one} · {bytes(e.size)}
              {e.from ? ` · ${e.from}` : ''}
            </div>
          </div>
          <span className="row-meta">{when(e.added)}</span>
          <Icon name="forward" size={12} className="row-chevron" />
        </button>
      ))}
    </Group>
  )
}

export function Overview() {
  const folder = useApp(folderOf)!
  const snap = useApp((s) => s.snapshots[s.current!]?.data)!
  const chooseFolder = useApp((s) => s.chooseFolder)
  if (!snap.entries.length) {
    return (
      <Empty icon={folder.known === 'downloads' ? 'download' : 'folder'} title={tr('{0} is empty', folder.name)} actions={<Btn onClick={() => void chooseFolder()}>{tr('Add another folder…')}</Btn>}>
        {tr('Files you download or save here show up in Dropzone right away.')}
      </Empty>
    )
  }
  return (
    <div className="page scroll">
      <div className="page-inner">
        <Storage />
        <Suggestions />
        <Recent />
        {(snap.truncated || snap.unreadable > 0) && (
          <p className="page-note">
            {snap.truncated && tr('{0} is very large, so Dropzone shows its first {1} files.', folder.name, 200000)}{' '}
            {snap.unreadable > 0 && tr('{0} subfolder couldn’t be read.|{0} subfolders couldn’t be read.', snap.unreadable)}
          </p>
        )}
      </div>
    </div>
  )
}
