import { useEffect, useMemo, useState } from 'react'
import { api, asFailure } from '../api'
import { failureText } from '../copy'
import { FileGlyph } from '../components/FileGlyph'
import { Bar, Btn, Check, Empty, Sheet, Spinner } from '../components/ui'
import { base, bytes, parent, relative } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { folderOf, useApp } from '../store'
import type { Plan, PlannedOp } from '../types'

interface Bucket {
  key: string
  label: string
  trash: boolean
  ops: PlannedOp[]
}

function buckets(plan: Plan): Bucket[] {
  const m = new Map<string, Bucket>()
  for (const o of plan.ops) {
    const key = o.action === 'trash' ? '\u0000trash' : parent(o.destination!)
    if (!m.has(key)) m.set(key, { key, label: o.action === 'trash' ? tr('Trash') : relative(key, plan.folder), trash: o.action === 'trash', ops: [] })
    m.get(key)!.ops.push(o)
  }
  return [...m.values()].sort((a, b) => Number(a.trash) - Number(b.trash) || b.ops.length - a.ops.length)
}

function BucketView({ b, off, setOff }: { b: Bucket; off: Set<string>; setOff: (s: Set<string>) => void }) {
  const [open, setOpen] = useState(b.ops.length <= 6)
  const on = b.ops.filter((o) => !off.has(o.source)).length
  const flip = (paths: string[], include: boolean) => {
    const next = new Set(off)
    for (const p of paths) {
      if (include) next.delete(p)
      else next.add(p)
    }
    setOff(next)
  }
  return (
    <section className={`bucket${b.trash ? ' trash' : ''}`}>
      <div className="bucket-head">
        <Check
          label={tr('Include all files going to {0}', b.label)}
          on={on === b.ops.length}
          mixed={on > 0 && on < b.ops.length}
          onChange={(v) =>
            flip(
              b.ops.map((o) => o.source),
              v,
            )
          }
        />
        <button type="button" className="bucket-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={b.trash ? 'trash' : 'folder'} size={15} className="bucket-icon" />
          <span className="bucket-label ellipsis">{b.label}</span>
          <span className="bucket-meta">
            {tr('{0} file|{0} files', b.ops.length)} · {bytes(b.ops.reduce((n, o) => n + o.size, 0))}
          </span>
          <Icon name={open ? 'down' : 'forward'} size={11} className="row-chevron" />
        </button>
      </div>
      {open && (
        <ul className="bucket-files">
          {b.ops.map((o) => {
            const included = !off.has(o.source)
            return (
              <li key={o.source} className={included ? '' : 'excluded'} onClick={() => flip([o.source], !included)}>
                <Check label={tr('Include {0}', o.name)} on={included} onChange={(v) => flip([o.source], v)} />
                <FileGlyph entry={{ path: o.source, kind: o.kind, ext: o.name.split('.').pop()?.toLowerCase() ?? '', size: o.size }} size={20} />
                <span className="bf-name ellipsis" title={o.name}>
                  {o.name}
                  {o.renamed && o.destination && <span className="bf-note"> {tr('saved as “{0}”', base(o.destination))}</span>}
                </span>
                <span className="bf-rule ellipsis">{o.ruleName}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function SortSheet() {
  const folder = useApp(folderOf)!
  const applying = useApp((s) => s.applying)
  const { set, run } = useApp.getState()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [off, setOff] = useState<Set<string>>(new Set())
  const close = () => !applying && set({ sheet: null })

  useEffect(() => {
    let live = true
    api
      .plan(folder.path)
      .then((p) => {
        if (!live) return
        setPlan(p)
        useApp.setState((s) => ({ plans: { ...s.plans, [folder.path]: { status: 'ready', data: p } } }))
      })
      .catch((e) => live && setError(failureText(asFailure(e))))
    return () => {
      live = false
    }
  }, [folder.path])

  const groups = useMemo(() => (plan ? buckets(plan) : []), [plan])
  const chosen = plan?.ops.filter((o) => !off.has(o.source)) ?? []
  const toTrash = chosen.filter((o) => o.action === 'trash').length
  const renamed = chosen.filter((o) => o.renamed).length

  const apply = async () => {
    if (!plan || !chosen.length) return
    const batch = await run({ folder: plan.folder, kind: 'sort', ops: chosen.map((o) => ({ action: o.action, source: o.source, destination: o.destination, size: o.size, modified: o.modified })) })
    if (batch && useApp.getState().sheet?.type === 'sort') set({ sheet: null })
  }

  return (
    <Sheet onClose={close} width={640} label={tr('Sort files')} busy={!!applying}>
      <div className="sheet-head">
        <h2 className="sheet-title">{tr('Sort files in {0}', folder.name)}</h2>
        <p className="sheet-sub">{tr('Nothing changes until you choose Sort. Afterwards you can undo it from History.')}</p>
      </div>
      <div className="sheet-body scroll tall">
        {error ? (
          <Empty icon="alert" title={tr('Couldn’t prepare the changes')}>
            {error}
          </Empty>
        ) : !plan ? (
          <div className="center-state small">
            <Spinner size={16} />
          </div>
        ) : !plan.ops.length && plan.project ? (
          <Empty icon="code" title={tr('Sorting is paused')}>
            {tr('{0} contains {1}, so it looks like a code project. You can change this in Rules.', folder.name, plan.project)}
          </Empty>
        ) : !plan.ops.length ? (
          <Empty icon="check" title={tr('Nothing to sort')}>
            {tr('No file at the top level of {0} matches your rules right now.', folder.name)}
          </Empty>
        ) : (
          <>
            {groups.map((b) => (
              <BucketView key={b.key} b={b} off={off} setOff={setOff} />
            ))}
            {plan.unfinished.length > 0 && (
              <p className="hint">
                <Icon name="partial" size={12} /> {tr('{0} unfinished download stays where it is.|{0} unfinished downloads stay where they are.', plan.unfinished.length)}
              </p>
            )}
            {renamed > 0 && (
              <p className="hint">
                {tr(
                  '{0} file gets a number added to its name because a file with the same name is already there. Nothing is replaced.|{0} files get a number added to their names because files with the same names are already there. Nothing is replaced.',
                  renamed,
                )}
              </p>
            )}
          </>
        )}
      </div>
      <div className="sheet-foot">
        {applying ? (
          <div className="foot-progress">
            <span>{tr('Sorting {0} of {1}…', applying.done, applying.total)}</span>
            <Bar value={applying.done} total={applying.total} />
          </div>
        ) : (
          <span className="foot-note">
            {chosen.length ? (toTrash ? tr('{0} of them go to the Trash.', toTrash) : tr('{0} selected', chosen.length)) : plan?.ops.length ? tr('Nothing selected') : ''}
          </span>
        )}
        <span className="spacer" />
        <Btn kind="ghost" onClick={close} disabled={!!applying}>
          {tr('Cancel')}
        </Btn>
        <Btn kind="primary" onClick={() => void apply()} disabled={!chosen.length || !!applying}>
          {tr('Sort {0} file|Sort {0} files', chosen.length)}
        </Btn>
      </div>
    </Sheet>
  )
}
