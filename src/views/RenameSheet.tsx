import { useMemo, useState } from 'react'
import { Btn, Seg, Sheet } from '../components/ui'
import { parent } from '../format'
import { tr } from '../i18n'
import { KINDS } from '../kinds'
import { platform } from '../platform'
import { useApp } from '../store'
import type { Entry } from '../types'

const RESERVED = platform === 'windows' ? /[<>:"/\\|?*]/ : /\//
const invalid = (name: string): boolean => RESERVED.test(name) || [...name].some((c) => c.charCodeAt(0) < 32) || name === '.' || name === '..'

const split = (name: string): [string, string] => {
  const i = name.lastIndexOf('.')
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']
}

const day = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fromPattern(pattern: string, e: Entry, i: number, width: number): string {
  const [stem, ext] = split(e.name)
  const out = pattern
    .replaceAll('{name}', stem)
    .replaceAll('{n}', String(i + 1).padStart(width, '0'))
    .replaceAll('{date}', day(e.added))
    .replaceAll('{kind}', KINDS[e.kind].one)
    .trim()
  return out ? `${out}${ext}` : ''
}

function replaced(e: Entry, find: string, by: string): string {
  if (!find) return e.name
  const [stem, ext] = split(e.name)
  return `${stem.split(find).join(by)}${ext}`
}

export function RenameSheet({ entries }: { entries: Entry[] }) {
  const single = entries.length === 1
  const snap = useApp((s) => (s.current ? s.snapshots[s.current]?.data : undefined))
  const applying = useApp((s) => s.applying)
  const { set, rename } = useApp.getState()
  const [mode, setMode] = useState<'pattern' | 'replace'>('pattern')
  const [name, setName] = useState(entries[0].name)
  const [pattern, setPattern] = useState('{name}')
  const [find, setFind] = useState('')
  const [by, setBy] = useState('')
  const close = () => !applying && set({ sheet: null })
  const width = String(entries.length).length

  const rows = useMemo(() => {
    const next = entries.map((e, i) => ({
      entry: e,
      name: single ? name.trim() : mode === 'pattern' ? fromPattern(pattern, e, i, width) : replaced(e, find, by),
    }))
    const renaming = new Set(entries.map((e) => e.path))
    const taken = new Map<string, Set<string>>()
    for (const e of snap?.entries ?? []) {
      if (renaming.has(e.path)) continue
      const dir = parent(e.path)
      if (!taken.has(dir)) taken.set(dir, new Set())
      taken.get(dir)!.add(e.name.toLowerCase())
    }
    const seen = new Map<string, number>()
    for (const r of next) {
      const key = `${parent(r.entry.path)}\u0000${r.name.toLowerCase()}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    return next.map((r) => {
      const dir = parent(r.entry.path)
      const problem = !r.name
        ? tr('Name can’t be empty')
        : invalid(r.name)
          ? tr('Contains characters that aren’t allowed')
          : r.name !== r.entry.name && (taken.get(dir)?.has(r.name.toLowerCase()) || (seen.get(`${dir}\u0000${r.name.toLowerCase()}`) ?? 0) > 1)
            ? tr('Name is already taken')
            : ''
      return { ...r, problem }
    })
  }, [entries, single, name, mode, pattern, find, by, width, snap])

  const changed = rows.filter((r) => r.name !== r.entry.name)
  const problems = rows.filter((r) => r.problem).length
  const apply = async () => {
    if (!changed.length || problems) return
    const batch = await rename(changed.map((r) => ({ entry: r.entry, name: r.name })))
    if (batch && useApp.getState().sheet?.type === 'rename') set({ sheet: null })
  }

  return (
    <Sheet onClose={close} width={single ? 460 : 620} label={tr('Rename')} busy={!!applying}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault()
          void apply()
        }}
      >
        <div className="sheet-head">
          <h2 className="sheet-title">{single ? tr('Rename') : tr('Rename {0} files', entries.length)}</h2>
          <p className="sheet-sub">{tr('You can undo this from History.')}</p>
        </div>
        <div className="sheet-body scroll">
          {single ? (
            <input
              className="field wide"
              value={name}
              autoFocus
              spellCheck={false}
              onFocus={(e) => e.currentTarget.setSelectionRange(0, split(name)[0].length)}
              onChange={(e) => setName(e.target.value)}
            />
          ) : (
            <>
              <Seg
                label={tr('Rename by')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'pattern', label: tr('Pattern') },
                  { value: 'replace', label: tr('Find and replace') },
                ]}
              />
              {mode === 'pattern' ? (
                <div className="rename-fields">
                  <input className="field wide" value={pattern} autoFocus spellCheck={false} onChange={(e) => setPattern(e.target.value)} />
                  <p className="hint">{tr('Use {name} for the current name, {n} for a number, {date} for the date added and {kind} for the kind. Extensions stay as they are.')}</p>
                </div>
              ) : (
                <div className="rename-fields pair">
                  <input className="field" placeholder={tr('Find')} value={find} autoFocus spellCheck={false} onChange={(e) => setFind(e.target.value)} />
                  <input className="field" placeholder={tr('Replace with')} value={by} spellCheck={false} onChange={(e) => setBy(e.target.value)} />
                </div>
              )}
              <ul className="plain-list rename-list">
                {rows.slice(0, 300).map((r) => (
                  <li key={r.entry.path} className={r.problem ? 'bad' : r.name === r.entry.name ? 'same' : ''}>
                    <span className="ellipsis">{r.entry.name}</span>
                    <span className="rename-arrow">→</span>
                    <span className="ellipsis">{r.name || '—'}</span>
                    {r.problem && <span className="rename-problem">{r.problem}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {single && rows[0].problem && <div className="form-error">{rows[0].problem}</div>}
        </div>
        <div className="sheet-foot">
          <span className="foot-note">{!single && (problems ? tr('{0} name needs a fix.|{0} names need a fix.', problems) : tr('{0} file changes.|{0} files change.', changed.length))}</span>
          <span className="spacer" />
          <Btn kind="ghost" onClick={close} disabled={!!applying}>
            {tr('Cancel')}
          </Btn>
          <Btn kind="primary" type="submit" disabled={!changed.length || !!problems || !!applying}>
            {tr('Rename')}
          </Btn>
        </div>
      </form>
    </Sheet>
  )
}
