import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useState } from 'react'
import { api, asFailure } from '../api'
import { describeBatch, failureText } from '../copy'
import { FileGlyph } from '../components/FileGlyph'
import { Bar, Btn, Row, Select, Seg, Sheet, Toggle } from '../components/ui'
import { base, bytes, relative } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { useApp } from '../store'
import type { Batch, Entry } from '../types'
import { doomed } from './Duplicates'

export function DupesSheet() {
  const current = useApp((s) => s.current)!
  const d = useApp((s) => s.dupes[current])
  const applying = useApp((s) => s.applying)
  const { set, run } = useApp.getState()
  const files = doomed(d)
  const removal = useApp((s) => s.settings.removal)
  const erase = removal === 'delete'
  const freed = bytes(files.reduce((n, f) => n + f.size, 0))
  const close = () => !applying && set({ sheet: null })
  const apply = async () => {
    const batch = await run({ folder: current, kind: 'duplicates', ops: files.map((f) => ({ action: removal, source: f.path, destination: null, size: f.size, modified: f.modified })) })
    if (batch && useApp.getState().sheet?.type === 'dupes') set({ sheet: null })
  }
  return (
    <Sheet onClose={close} width={560} label={erase ? tr('Delete duplicates') : tr('Move duplicates to the Trash')} busy={!!applying}>
      <div className="sheet-head">
        <h2 className="sheet-title">
          {erase ? tr('Delete {0} duplicate immediately?|Delete {0} duplicates immediately?', files.length) : tr('Move {0} duplicate to the Trash?|Move {0} duplicates to the Trash?', files.length)}
        </h2>
        <p className="sheet-sub">
          {erase
            ? tr('This frees {0}. One copy of each file stays. The others skip the Trash and can’t be restored.', freed)
            : tr('This frees {0}. One copy of each file stays, and you can undo this from History.', freed)}
        </p>
      </div>
      <div className="sheet-body scroll">
        <ul className="plain-list">
          {files.slice(0, 300).map((f) => (
            <li key={f.path}>
              <FileGlyph entry={f} size={20} />
              <span className="ellipsis">{relative(f.path, current)}</span>
              <span className="muted">{bytes(f.size)}</span>
            </li>
          ))}
          {files.length > 300 && <li className="muted">{tr('And {0} more.', files.length - 300)}</li>}
        </ul>
      </div>
      <div className="sheet-foot">
        {applying && (
          <div className="foot-progress">
            <span>{erase ? tr('Deleting {0} of {1}…', applying.done, applying.total) : tr('Moving {0} of {1}…', applying.done, applying.total)}</span>
            <Bar value={applying.done} total={applying.total} />
          </div>
        )}
        <span className="spacer" />
        <Btn kind="ghost" onClick={close} disabled={!!applying}>
          {tr('Cancel')}
        </Btn>
        <Btn kind={erase ? 'danger' : 'primary'} onClick={() => void apply()} disabled={!files.length || !!applying}>
          {erase ? tr('Delete') : tr('Move to Trash')}
        </Btn>
      </div>
    </Sheet>
  )
}

function Problems({ batch }: { batch: Batch }) {
  const bad = batch.ops.filter((o) => o.status === 'failed' || o.status === 'skipped')
  return (
    <ul className="plain-list problems">
      {bad.slice(0, 200).map((o, i) => (
        <li key={i}>
          <Icon name="alert" size={13} style={{ color: 'var(--amber)' }} />
          <span className="problem-text">
            <span className="ellipsis">{base(o.source)}</span>
            <span className="muted">{o.failure ? failureText(o.failure) : tr('Not changed.')}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ResultSheet({ batch }: { batch: Batch }) {
  const set = useApp((s) => s.set)
  const undo = useApp((s) => s.undo)
  const done = batch.ops.filter((o) => o.status === 'done').length
  const bad = batch.ops.length - done
  const close = () => set({ sheet: null })
  return (
    <Sheet onClose={close} width={520} label={tr('Result')}>
      <div className="sheet-head">
        <h2 className="sheet-title">{done ? describeBatch(batch).done : tr('Nothing was changed.')}</h2>
        <p className="sheet-sub">{tr('{0} file was left as it was:|{0} files were left as they were:', bad)}</p>
      </div>
      <div className="sheet-body scroll">
        <Problems batch={batch} />
      </div>
      <div className="sheet-foot">
        {done > 0 && (
          <Btn
            kind="ghost"
            icon="undo"
            onClick={() => {
              close()
              void undo(batch.id)
            }}
          >
            {tr('Undo')}
          </Btn>
        )}
        <span className="spacer" />
        <Btn kind="primary" onClick={close} autoFocus>
          {tr('Done')}
        </Btn>
      </div>
    </Sheet>
  )
}

export function RecoveredSheet({ batch }: { batch: Batch }) {
  const set = useApp((s) => s.set)
  const undo = useApp((s) => s.undo)
  const done = batch.ops.filter((o) => o.status === 'done').length
  const close = () => set({ sheet: null })
  return (
    <Sheet onClose={close} width={500} label={tr('Interrupted changes')}>
      <div className="sheet-head">
        <h2 className="sheet-title">{tr('Dropzone closed while it was working')}</h2>
        <p className="sheet-sub">{tr('It finished {0} of {1} changes in {2} before it stopped. The rest of the files weren’t touched.', done, batch.ops.length, base(batch.folder))}</p>
      </div>
      <div className="sheet-foot">
        <span className="spacer" />
        {done > 0 && (
          <Btn
            onClick={() => {
              close()
              void undo(batch.id)
            }}
          >
            {tr('Undo the finished part')}
          </Btn>
        )}
        <Btn kind="primary" onClick={close} autoFocus>
          {tr('Keep as is')}
        </Btn>
      </div>
    </Sheet>
  )
}

export function RemoveSheet({ path }: { path: string }) {
  const { set, removeFolder } = useApp.getState()
  const close = () => set({ sheet: null })
  return (
    <Sheet onClose={close} width={460} label={tr('Remove folder')}>
      <div className="sheet-head">
        <h2 className="sheet-title">{tr('Remove {0} from Dropzone?', base(path))}</h2>
        <p className="sheet-sub">{tr('Dropzone stops looking after this folder and forgets its rules. The folder and its files stay exactly where they are.')}</p>
      </div>
      <div className="sheet-foot">
        <span className="spacer" />
        <Btn kind="ghost" onClick={close}>
          {tr('Cancel')}
        </Btn>
        <Btn
          kind="danger"
          onClick={() => {
            close()
            void removeFolder(path)
          }}
        >
          {tr('Remove')}
        </Btn>
      </div>
    </Sheet>
  )
}

export function SettingsSheet() {
  const s = useApp((st) => st.settings)
  const { set, setSettings } = useApp.getState()
  const [confirm, setConfirm] = useState(false)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => undefined)
  }, [])
  const close = () => set({ sheet: null })
  const clear = async () => {
    try {
      await api.clearHistory()
      useApp.setState({ history: [] })
      setConfirm(false)
      useApp.getState().flash(tr('History cleared.'))
    } catch (e) {
      useApp.getState().flash(failureText(asFailure(e)), 'error')
    }
  }
  return (
    <Sheet onClose={close} width={560} label={tr('Settings')}>
      <div className="sheet-head">
        <h2 className="sheet-title">{tr('Settings')}</h2>
      </div>
      <div className="sheet-body scroll">
        <div className="group-box">
          <Row title={tr('Appearance')}>
            <Seg
              label={tr('Appearance')}
              value={s.theme}
              onChange={(v) => void setSettings({ theme: v })}
              options={[
                { value: 'system', label: tr('Automatic') },
                { value: 'light', label: tr('Light') },
                { value: 'dark', label: tr('Dark') },
              ]}
            />
          </Row>
          <Row
            title={tr('Removing files')}
            desc={
              s.removal === 'delete'
                ? tr('Files are deleted right away and can’t be restored, not even from History. Dropzone always asks first.')
                : tr('Files go to the Trash, and Undo can bring them back.')
            }
          >
            <Seg
              label={tr('Removing files')}
              value={s.removal}
              onChange={(v) => void setSettings({ removal: v })}
              options={[
                { value: 'trash', label: tr('Move to Trash') },
                { value: 'delete', label: tr('Delete immediately') },
              ]}
            />
          </Row>
          <Row title={tr('Look inside subfolders')} desc={tr('Shows and compares files in subfolders too. Sorting always works on the top level only.')}>
            <Toggle label={tr('Look inside subfolders')} on={s.recursive} onChange={(v) => void setSettings({ recursive: v })} />
          </Row>
          <Row title={tr('Show hidden files')} desc={tr('Includes files whose names start with a dot.')}>
            <Toggle label={tr('Show hidden files')} on={s.showHidden} onChange={(v) => void setSettings({ showHidden: v })} />
          </Row>
          <Row title={tr('Installers count as old after')}>
            <Select
              label={tr('Installers count as old after')}
              value={s.staleDays}
              onChange={(v) => void setSettings({ staleDays: v })}
              options={[
                { value: 7, label: tr('1 week') },
                { value: 14, label: tr('2 weeks') },
                { value: 30, label: tr('1 month') },
                { value: 90, label: tr('3 months') },
              ]}
            />
          </Row>
        </div>
        <div className="group-box privacy-box">
          <Row
            icon="shield"
            tone="var(--green)"
            title={tr('Everything stays on this Mac')}
            desc={tr('Dropzone reads and moves files locally. It has no account, sends no analytics and never connects to the internet.')}
          />
          <Row title={tr('History')} desc={tr('Removes the record of past changes in every folder. Files stay where they are, but you can no longer undo those changes.')}>
            {confirm ? (
              <div className="confirm">
                <Btn kind="ghost" onClick={() => setConfirm(false)}>
                  {tr('Cancel')}
                </Btn>
                <Btn kind="danger" onClick={() => void clear()}>
                  {tr('Clear')}
                </Btn>
              </div>
            ) : (
              <Btn onClick={() => setConfirm(true)}>{tr('Clear history…')}</Btn>
            )}
          </Row>
        </div>
      </div>
      <div className="sheet-foot">
        <span className="foot-note">{version && tr('Dropzone {0}', version)}</span>
        <span className="spacer" />
        <Btn kind="primary" onClick={close}>
          {tr('Done')}
        </Btn>
      </div>
    </Sheet>
  )
}

export function ProjectSheet({ entries, dir }: { entries: Entry[]; dir: string | null }) {
  const current = useApp((s) => s.current)!
  const { set, trash, moveTo } = useApp.getState()
  const inProject = entries.filter((e) => e.project != null)
  const others = entries.filter((e) => e.project == null)
  const projects = [...new Set(inProject.map((e) => e.project!))].map((p) => ({ name: p ? base(p) : base(current), path: p, n: inProject.filter((e) => e.project === p).length }))
  const toTrash = dir === null
  const close = () => set({ sheet: null })
  const go = (list: Entry[], confirmed: boolean) => {
    close()
    void (toTrash ? trash(list, confirmed) : moveTo(list, dir, confirmed))
  }
  return (
    <Sheet onClose={close} width={500} label={tr('Code project files')}>
      <div className="sheet-head">
        <h2 className="sheet-title">{toTrash ? tr('Move project files to the Trash?') : tr('Move files out of a code project?')}</h2>
        <p className="sheet-sub">
          {tr(
            '{0} of the selected files belongs to a code project. Moving it can stop the project from building or running.|{0} of the selected files belong to code projects. Moving them can stop a project from building or running.',
            inProject.length,
          )}
        </p>
      </div>
      <div className="sheet-body scroll">
        <ul className="plain-list">
          {projects.map((p) => (
            <li key={p.path}>
              <Icon name="code" size={14} style={{ color: 'var(--mint)' }} />
              <span className="ellipsis">{p.name}</span>
              <span className="muted">{tr('{0} file|{0} files', p.n)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="sheet-foot">
        <Btn kind="ghost" onClick={() => go(entries, true)}>
          {toTrash ? tr('Trash them anyway') : tr('Move them anyway')}
        </Btn>
        <span className="spacer" />
        <Btn kind={others.length ? 'ghost' : 'primary'} onClick={close}>
          {tr('Cancel')}
        </Btn>
        {others.length > 0 && (
          <Btn kind="primary" onClick={() => go(others, false)}>
            {toTrash ? tr('Trash only the other {0}', others.length) : tr('Move only the other {0}', others.length)}
          </Btn>
        )}
      </div>
    </Sheet>
  )
}

export function DeleteSheet({ entries }: { entries: Entry[] }) {
  const current = useApp((s) => s.current)!
  const applying = useApp((s) => s.applying)
  const { set, deleteNow } = useApp.getState()
  const projects = entries.filter((e) => e.project != null).length
  const close = () => !applying && set({ sheet: null })
  const apply = async () => {
    await deleteNow(entries, true)
    if (useApp.getState().sheet?.type === 'delete') set({ sheet: null })
  }
  return (
    <Sheet onClose={close} width={520} label={tr('Delete immediately')} busy={!!applying}>
      <div className="sheet-head">
        <h2 className="sheet-title">{entries.length === 1 ? tr('Delete “{0}” immediately?', entries[0].name) : tr('Delete {0} files immediately?', entries.length)}</h2>
        <p className="sheet-sub">
          {tr(
            '{1}. It skips the Trash and can’t be restored, not even from History.|{1}. They skip the Trash and can’t be restored, not even from History.',
            entries.length,
            bytes(entries.reduce((n, e) => n + e.size, 0)),
          )}
          {projects > 0 && ` ${tr('{0} of them belongs to a code project.|{0} of them belong to code projects.', projects)}`}
        </p>
      </div>
      {entries.length > 1 && (
        <div className="sheet-body scroll">
          <ul className="plain-list">
            {entries.slice(0, 300).map((e) => (
              <li key={e.path}>
                <FileGlyph entry={e} size={20} />
                <span className="ellipsis">{relative(e.path, current)}</span>
                <span className="muted">{bytes(e.size)}</span>
              </li>
            ))}
            {entries.length > 300 && <li className="muted">{tr('And {0} more.', entries.length - 300)}</li>}
          </ul>
        </div>
      )}
      <div className="sheet-foot">
        {applying && (
          <div className="foot-progress">
            <span>{tr('Deleting {0} of {1}…', applying.done, applying.total)}</span>
            <Bar value={applying.done} total={applying.total} />
          </div>
        )}
        <span className="spacer" />
        <Btn kind="ghost" onClick={close} disabled={!!applying}>
          {tr('Cancel')}
        </Btn>
        <Btn kind="danger" onClick={() => void apply()} disabled={!!applying} autoFocus>
          {tr('Delete')}
        </Btn>
      </div>
    </Sheet>
  )
}
