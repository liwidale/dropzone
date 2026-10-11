import { useEffect, useMemo, useState } from 'react'
import { moveMenu } from '../actions'
import { PreviewContent } from '../components/Preview'
import { Bar, Btn, Empty } from '../components/ui'
import { bytes, parent, relative, when } from '../format'
import { tr } from '../i18n'
import { KINDS } from '../kinds'
import { popup } from '../menu'
import { folderOf, useApp } from '../store'
import type { Entry } from '../types'

export function Triage() {
  const folder = useApp(folderOf)!
  const snap = useApp((s) => s.snapshots[s.current!]?.data)
  const plan = useApp((s) => s.plans[s.current!]?.data)
  const removal = useApp((s) => s.settings.removal)
  const applying = useApp((s) => !!s.applying)
  const sheet = useApp((s) => s.sheet)
  const [queue] = useState<string[]>(() =>
    (snap?.entries ?? [])
      .filter((e) => !e.dir && e.kind !== 'partial' && e.project == null)
      .sort((a, b) => b.added - a.added)
      .map((e) => e.path),
  )
  const [index, setIndex] = useState(0)
  const [armed, setArmed] = useState(false)

  const byPath = useMemo(() => new Map((snap?.entries ?? []).filter((e) => !e.dir).map((e) => [e.path, e])), [snap])
  const position = useMemo(() => {
    let i = index
    while (i < queue.length && !byPath.has(queue[i])) i++
    return i
  }, [index, queue, byPath])
  const entry: Entry | undefined = byPath.get(queue[position])
  const op = plan?.ops.find((o) => o.source === entry?.path && o.action === 'move')
  const suggested = op?.destination ? parent(op.destination) : null

  useEffect(() => setArmed(false), [entry?.path])

  const next = () => setIndex(position + 1)
  const back = () => {
    let i = position - 1
    while (i > 0 && !byPath.has(queue[i])) i--
    setIndex(Math.max(0, i))
  }
  const move = (dir: string | null) => entry && void useApp.getState().moveTo([entry], dir)
  const remove = () => {
    if (!entry) return
    const s = useApp.getState()
    if (removal === 'trash') void s.trash([entry])
    else if (armed) void s.deleteNow([entry], true)
    else setArmed(true)
  }
  const pickFolder = () => {
    if (!entry) return
    const m = moveMenu([entry])
    if (typeof m !== 'string' && m.items) void popup(m.items)
  }

  useEffect(() => {
    if (sheet || applying) return
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'enter' && suggested) move(suggested)
      else if (k === 'k' || k === 'arrowright') next()
      else if (k === 'arrowleft') back()
      else if (k === 'm') pickFolder()
      else if (k === 'd' || k === 'backspace' || k === 'delete') remove()
      else if (k === 'escape') useApp.getState().go('overview')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!queue.length) {
    return (
      <Empty icon="cards" title={tr('Nothing to go through')}>
        {tr('There are no loose files at the top level of {0}.', folder.name)}
      </Empty>
    )
  }
  if (!entry) {
    return (
      <Empty icon="check" title={tr('All done')} actions={<Btn onClick={() => useApp.getState().go('overview')}>{tr('Back to overview')}</Btn>}>
        {tr('You went through {0} file.|You went through {0} files.', queue.length)}
      </Empty>
    )
  }

  return (
    <div className="triage">
      <div className="triage-progress">
        <span>{tr('{0} of {1}', position + 1, queue.length)}</span>
        <Bar value={position} total={queue.length} />
      </div>
      <div className="triage-stage">
        <PreviewContent key={entry.path} entry={entry} />
      </div>
      <div className="triage-info">
        <div className="triage-name selectable">{entry.name}</div>
        <div className="row-desc">
          {KINDS[entry.kind].one} · {bytes(entry.size)} · {when(entry.added)}
          {entry.from ? ` · ${entry.from}` : ''}
        </div>
      </div>
      <div className="triage-actions">
        <Btn icon="back" onClick={back} disabled={position === 0}>
          {tr('Back')}
        </Btn>
        <Btn kind={armed ? 'danger' : 'secondary'} icon="trash" onClick={remove} disabled={applying}>
          {armed ? tr('Press again to delete') : removal === 'delete' ? tr('Delete') : tr('Trash')}
          <kbd>D</kbd>
        </Btn>
        <Btn icon="move" onClick={pickFolder} disabled={applying}>
          {tr('Move to…')}
          <kbd>M</kbd>
        </Btn>
        {suggested && (
          <Btn kind="primary" icon="sort" onClick={() => move(suggested)} disabled={applying}>
            {tr('Move to {0}', relative(suggested, folder.path))}
            <kbd>↩</kbd>
          </Btn>
        )}
        <Btn icon="forward" onClick={next}>
          {tr('Keep')}
          <kbd>K</kbd>
        </Btn>
      </div>
    </div>
  )
}
