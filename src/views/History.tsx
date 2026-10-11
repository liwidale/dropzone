import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { api, asFailure } from '../api'
import { describeBatch, failureText } from '../copy'
import { Btn, Empty } from '../components/ui'
import { base, relative, when } from '../format'
import { tr } from '../i18n'
import { Icon, type IconName } from '../icons'
import { folderOf, undoable, useApp } from '../store'
import type { Batch, OpRecord } from '../types'

const KIND_ICON: Record<Batch['kind'], IconName> = {
  sort: 'sort',
  auto: 'bolt',
  duplicates: 'copies',
  move: 'move',
  trash: 'trash',
  delete: 'trash',
  rename: 'edit',
  extract: 'extract',
  cleanup: 'broom',
}

function status(b: Batch): string {
  const total = b.ops.length
  const undone = b.ops.filter((o) => o.status === 'undone').length
  const stuck = b.ops.filter((o) => o.status === 'undoFailed').length
  const failed = b.ops.filter((o) => o.status === 'failed' || o.status === 'skipped').length
  const parts: string[] = []
  if (b.interrupted) parts.push(tr('Interrupted'))
  if (b.undoneAt && !stuck && undone) parts.push(tr('Undone {0}', when(b.undoneAt)))
  else if (stuck) parts.push(tr('{0} of {1} put back', undone, undone + stuck))
  if (failed) parts.push(tr('{0} of {1} not changed', failed, total))
  return parts.join(' · ')
}

function Op({ op, root }: { op: OpRecord; root: string }) {
  const icon: IconName = op.status === 'done' ? 'check' : op.status === 'undone' ? 'undo' : 'alert'
  const tone = op.status === 'done' ? 'var(--green)' : op.status === 'undone' ? 'var(--text-3)' : 'var(--amber)'
  const where = op.action === 'delete' ? tr('Deleted') : op.action === 'trash' ? tr('Trash') : op.target ? relative(op.target, root) : '—'
  return (
    <li className="op">
      <span className="op-icon" style={{ color: tone }}>
        <Icon name={icon} size={12} strokeWidth={1.8} />
      </span>
      <div className="op-text">
        <div className="ellipsis">
          <span className="op-name">{base(op.source)}</span>
          <span className="muted"> → {where}</span>
        </div>
        {op.failure && <div className="op-note">{failureText(op.failure)}</div>}
        {op.restoredTo && <div className="op-note">{tr('Put back as {0}, because a file with its name had appeared.', base(op.restoredTo))}</div>}
      </div>
    </li>
  )
}

function Card({ b, root }: { b: Batch; root: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const undo = useApp((s) => s.undo)
  const applying = useApp((s) => !!s.applying)
  const d = describeBatch(b)
  const can = undoable(b)
  const st = status(b)
  const retry = b.ops.some((o) => o.status === 'undoFailed')
  return (
    <section className={`batch${b.undoneAt && !retry ? ' faded' : ''}`}>
      <div className="batch-head">
        <button type="button" className="batch-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="row-icon">
            <Icon name={KIND_ICON[b.kind]} size={16} />
          </span>
          <span className="row-text">
            <span className="row-title">{d.title}</span>
            <span className="row-desc">
              {when(b.created)}
              {st && ` · ${st}`}
            </span>
          </span>
          <Icon name={open ? 'down' : 'forward'} size={11} className="row-chevron" />
        </button>
        {can && (
          <Btn
            icon="undo"
            disabled={busy || applying}
            onClick={async () => {
              setBusy(true)
              await undo(b.id)
              setBusy(false)
            }}
          >
            {retry ? tr('Try again') : tr('Undo')}
          </Btn>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="ops"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {b.ops.slice(0, 400).map((o, i) => (
              <Op key={i} op={o} root={root} />
            ))}
            {b.ops.length > 400 && <li className="op muted">{tr('And {0} more.', b.ops.length - 400)}</li>}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  )
}

export function History() {
  const folder = useApp(folderOf)!
  const history = useApp((s) => s.history)
  const [confirm, setConfirm] = useState(false)
  const list = history.filter((b) => b.folder === folder.path)

  if (!list.length) {
    return (
      <Empty icon="history" title={tr('No changes yet')}>
        {tr('Everything Dropzone moves in {0} shows up here, so you can undo it later.', folder.name)}
      </Empty>
    )
  }

  const clear = async () => {
    try {
      await api.clearHistory()
      useApp.setState({ history: [] })
      setConfirm(false)
    } catch (e) {
      useApp.getState().flash(failureText(asFailure(e)), 'error')
    }
  }

  return (
    <div className="page scroll">
      <div className="page-inner">
        <div className="history">
          {list.map((b) => (
            <Card key={b.id} b={b} root={folder.path} />
          ))}
        </div>
        <div className="page-foot">
          <p>
            {tr(
              'Undo puts files back where they were, as long as they haven’t been moved or deleted since. Files moved to the Trash come back unless the Trash was emptied. Files deleted immediately can’t be restored.',
            )}
          </p>
          {confirm ? (
            <div className="confirm">
              <Btn kind="ghost" onClick={() => setConfirm(false)}>
                {tr('Cancel')}
              </Btn>
              <Btn kind="danger" onClick={() => void clear()}>
                {tr('Clear for all folders')}
              </Btn>
            </div>
          ) : (
            <Btn kind="ghost" onClick={() => setConfirm(true)}>
              {tr('Clear history…')}
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}
