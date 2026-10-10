import { useEffect, useState } from 'react'
import { api, asFailure } from '../api'
import { failureText } from '../copy'
import { Btn, Select, Seg, Sheet, Spinner } from '../components/ui'
import { base, bytes, home, inside, isAbsolute, relative } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { KINDS, RULE_KINDS } from '../kinds'
import { folderOf, useApp } from '../store'
import type { Condition, Kind, Rule, RulePreview } from '../types'

type CType = Condition['type']

const TYPES: { value: CType; label: string }[] = [
  { value: 'kind', label: tr('Kind') },
  { value: 'extension', label: tr('Extension') },
  { value: 'name', label: tr('Name') },
  { value: 'source', label: tr('Downloaded from') },
  { value: 'olderThan', label: tr('Date added') },
  { value: 'largerThan', label: tr('Size') },
]

function blank(type: CType): Condition {
  switch (type) {
    case 'kind':
      return { type, kinds: [] }
    case 'extension':
      return { type, extensions: [] }
    case 'name':
    case 'source':
      return { type, text: '' }
    case 'olderThan':
      return { type, days: 30 }
    case 'largerThan':
      return { type, megabytes: 100 }
  }
}

function complete(c: Condition): boolean {
  switch (c.type) {
    case 'kind':
      return c.kinds.length > 0
    case 'extension':
      return c.extensions.length > 0
    case 'name':
    case 'source':
      return c.text.trim().length > 0
    default:
      return true
  }
}

function suggestName(r: Rule): string {
  if (r.action.type === 'trash') return tr('Clean up')
  const f = r.action.folder.trim()
  return f ? base(f) : ''
}

function ConditionEditor({ c, onChange, onRemove }: { c: Condition; onChange: (c: Condition) => void; onRemove?: () => void }) {
  const [extText, setExtText] = useState(c.type === 'extension' ? c.extensions.join(', ') : '')
  return (
    <div className="cond">
      <div className="cond-line">
        <Select label={tr('Condition')} value={c.type} options={TYPES} onChange={(t) => onChange(blank(t))} />
        {c.type === 'kind' && <span className="cond-word">{tr('is any of')}</span>}
        {c.type === 'extension' && (
          <>
            <span className="cond-word">{tr('is')}</span>
            <input
              className="field"
              placeholder={tr('pdf, docx, pages')}
              value={extText}
              spellCheck={false}
              onChange={(e) => {
                setExtText(e.target.value)
                onChange({
                  type: 'extension',
                  extensions: e.target.value
                    .split(/[\s,]+/)
                    .map((x) => x.replace(/^\./, '').toLowerCase())
                    .filter(Boolean),
                })
              }}
            />
          </>
        )}
        {c.type === 'name' && (
          <>
            <span className="cond-word">{tr('contains')}</span>
            <input className="field" placeholder={tr('invoice, or a pattern like *.tmp')} value={c.text} spellCheck={false} onChange={(e) => onChange({ ...c, text: e.target.value })} />
          </>
        )}
        {c.type === 'source' && (
          <>
            <span className="cond-word">{tr('contains')}</span>
            <input className="field" placeholder={tr('github.com')} value={c.text} spellCheck={false} onChange={(e) => onChange({ ...c, text: e.target.value })} />
          </>
        )}
        {c.type === 'olderThan' && (
          <>
            <span className="cond-word">{tr('is more than')}</span>
            <input
              className="field num"
              type="number"
              min={1}
              max={3650}
              value={c.days}
              onChange={(e) => onChange({ ...c, days: Math.max(1, Math.min(3650, Math.round(Number(e.target.value) || 1))) })}
            />
            <span className="cond-word">{tr('days ago')}</span>
          </>
        )}
        {c.type === 'largerThan' && (
          <>
            <span className="cond-word">{tr('is larger than')}</span>
            <input className="field num" type="number" min={0} value={c.megabytes} onChange={(e) => onChange({ ...c, megabytes: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            <span className="cond-word">MB</span>
          </>
        )}
        <span className="spacer" />
        {onRemove && <Btn kind="ghost" icon="minus" title={tr('Remove condition')} onClick={onRemove} />}
      </div>
      {c.type === 'kind' && (
        <div className="kind-picks">
          {RULE_KINDS.map((k: Kind) => {
            const on = c.kinds.includes(k)
            return (
              <button
                type="button"
                key={k}
                className={`kind-pick${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => onChange({ ...c, kinds: on ? c.kinds.filter((x) => x !== k) : [...c.kinds, k] })}
              >
                <Icon name={KINDS[k].icon} size={12} style={{ color: on ? undefined : KINDS[k].color }} />
                {KINDS[k].many}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function RuleEditor({ rule }: { rule: Rule | null }) {
  const folder = useApp(folderOf)!
  const removal = useApp((s) => s.settings.removal)
  const { set, saveRules } = useApp.getState()
  const [draft, setDraft] = useState<Rule>(() => rule ?? { id: '', name: '', enabled: true, conditions: [{ type: 'kind', kinds: [] }], action: { type: 'move', folder: '', group: 'none' } })
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const close = () => set({ sheet: null })

  const ready = draft.conditions.length > 0 && draft.conditions.every(complete)
  const hasTarget = draft.action.type === 'trash' || draft.action.folder.trim().length > 0
  const name = draft.name.trim() || suggestName(draft)

  useEffect(() => {
    if (!ready) {
      setPreview(null)
      return
    }
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      api
        .previewRule(folder.path, { ...draft, name: name || 'preview', action: draft.action.type === 'move' ? { ...draft.action, folder: draft.action.folder || 'x' } : draft.action })
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null))
        .finally(() => live && setLoading(false))
    }, 220)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [draft, ready, folder.path, name])

  const save = async () => {
    setError('')
    if (!ready) return setError(tr('Finish the conditions first.'))
    if (!hasTarget) return setError(tr('Choose where matching files go.'))
    const next: Rule = { ...draft, name }
    const rules = rule ? folder.rules.map((r) => (r.id === rule.id ? next : r)) : [...folder.rules, next]
    setSaving(true)
    const ok = await saveRules(folder.path, rules)
    setSaving(false)
    if (ok) close()
  }

  const remove = async () => {
    if (!rule) return
    if (
      await saveRules(
        folder.path,
        folder.rules.filter((r) => r.id !== rule.id),
      )
    )
      close()
  }

  const pick = async () => {
    try {
      const dir = await api.chooseDestination()
      if (dir && draft.action.type === 'move') setDraft({ ...draft, action: { ...draft.action, folder: inside(dir, folder.path) ? relative(dir, folder.path) : dir } })
    } catch (e) {
      setError(failureText(asFailure(e)))
    }
  }

  const setCond = (i: number, c: Condition) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? c : x)) })

  return (
    <Sheet onClose={close} width={600} label={rule ? tr('Edit rule') : tr('New rule')}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="sheet-head">
          <h2 className="sheet-title">{rule ? tr('Edit rule') : tr('New rule')}</h2>
          <p className="sheet-sub">{tr('Applies to files at the top level of {0}.', folder.name)}</p>
        </div>
        <div className="sheet-body scroll">
          <label className="field-row">
            <span className="field-label">{tr('Name')}</span>
            <input className="field" value={draft.name} placeholder={suggestName(draft) || tr('Rule name')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          </label>

          <div className="section-label">{tr('When a file matches all of these')}</div>
          <div className="conds">
            {draft.conditions.map((c, i) => (
              <ConditionEditor
                key={`${i}-${c.type}`}
                c={c}
                onChange={(x) => setCond(i, x)}
                onRemove={draft.conditions.length > 1 ? () => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) }) : undefined}
              />
            ))}
            <div>
              <Btn
                kind="ghost"
                icon="plus"
                onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, blank(draft.conditions.some((c) => c.type === 'olderThan') ? 'name' : 'olderThan')] })}
              >
                {tr('Add condition')}
              </Btn>
            </div>
          </div>

          <div className="section-label">{tr('Then')}</div>
          <div className="then">
            <Seg
              label={tr('Action')}
              value={draft.action.type}
              onChange={(v) => setDraft({ ...draft, action: v === 'trash' ? { type: 'trash' } : { type: 'move', folder: '', group: 'none' } })}
              options={[
                { value: 'move', label: tr('Move to a folder') },
                { value: 'trash', label: tr('Move to the Trash') },
              ]}
            />
            {draft.action.type === 'move' ? (
              <>
                <div className="then-line">
                  <input
                    className="field"
                    placeholder={tr('Folder name, like Invoices')}
                    value={draft.action.folder}
                    spellCheck={false}
                    onChange={(e) => draft.action.type === 'move' && setDraft({ ...draft, action: { ...draft.action, folder: e.target.value } })}
                  />
                  <Btn icon="folder" onClick={() => void pick()}>
                    {tr('Choose…')}
                  </Btn>
                </div>
                <div className="then-line">
                  <span className="cond-word">{tr('Group into subfolders')}</span>
                  <Select
                    label={tr('Group into subfolders')}
                    value={draft.action.group}
                    onChange={(g) => draft.action.type === 'move' && setDraft({ ...draft, action: { ...draft.action, group: g } })}
                    options={[
                      { value: 'none', label: tr('No') },
                      { value: 'year', label: tr('By year') },
                      { value: 'month', label: tr('By month') },
                    ]}
                  />
                </div>
                <p className="hint">
                  {isAbsolute(draft.action.folder)
                    ? tr('Files move to {0}.', home(draft.action.folder))
                    : tr('A name creates a folder inside {0}. Use / for nested folders, like Work/Invoices.', folder.name)}
                </p>
              </>
            ) : (
              <p className="hint">
                {removal === 'delete'
                  ? tr('Your settings delete files immediately instead of using the Trash, so they can’t be restored. Sorting always asks first, and automatic sorting never uses rules like this.')
                  : tr('Files go to the Trash, where you can still put them back. Automatic sorting never uses rules like this.')}
              </p>
            )}
          </div>

          <div className="preview">
            {!ready ? (
              <span className="muted">{tr('Finish the conditions to see which files match.')}</span>
            ) : loading && !preview ? (
              <span className="muted">
                <Spinner size={11} /> {tr('Checking…')}
              </span>
            ) : preview && preview.count ? (
              <>
                <strong>{tr('Matches {0} file right now, {1}.|Matches {0} files right now, {1}.', preview.count, bytes(preview.size))}</strong>
                <span className="preview-names">
                  {preview.names.join(', ')}
                  {preview.count > preview.names.length ? '…' : ''}
                </span>
              </>
            ) : (
              <span className="muted">{tr('No files match right now. The rule applies when matching files arrive.')}</span>
            )}
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="sheet-foot">
          {rule && (
            <Btn kind="ghost" icon="trash" onClick={() => void remove()}>
              {tr('Delete rule')}
            </Btn>
          )}
          <span className="spacer" />
          <Btn kind="ghost" onClick={close}>
            {tr('Cancel')}
          </Btn>
          <Btn kind="primary" type="submit" disabled={saving}>
            {rule ? tr('Save') : tr('Add rule')}
          </Btn>
        </div>
      </form>
    </Sheet>
  )
}
