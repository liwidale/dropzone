import { Reorder, useDragControls } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, asFailure } from '../api'
import { actionText, failureText, ruleSummary } from '../copy'
import { Btn, Group, Row, Toggle } from '../components/ui'
import { count, longDate } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { popup } from '../menu'
import { folderOf, useApp } from '../store'
import type { Rule } from '../types'

const WEEK = 7 * 86_400_000

function RuleRow({
  rule,
  hits,
  index,
  total,
  onToggle,
  onEdit,
  onMove,
  onDuplicate,
  onDelete,
  onDrop,
}: {
  rule: Rule
  hits: number
  index: number
  total: number
  onToggle: (on: boolean) => void
  onEdit: () => void
  onMove: (to: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onDrop: () => void
}) {
  const removal = useApp((s) => s.settings.removal)
  const controls = useDragControls()
  const menu = () =>
    void popup([
      { text: tr('Edit…'), action: onEdit },
      { text: tr('Duplicate'), action: onDuplicate },
      'separator',
      { text: tr('Move up'), enabled: index > 0, action: () => onMove(index - 1) },
      { text: tr('Move down'), enabled: index < total - 1, action: () => onMove(index + 1) },
      'separator',
      { text: tr('Delete'), action: onDelete },
    ])
  return (
    <Reorder.Item value={rule} dragListener={false} dragControls={controls} className={`rule${rule.enabled ? '' : ' off'}`} onDragEnd={onDrop} as="div">
      <span className="grip" onPointerDown={(e) => controls.start(e)} aria-hidden title={tr('Drag to reorder')}>
        <Icon name="grip" size={14} />
      </span>
      <Toggle label={tr('Turn on “{0}”', rule.name)} on={rule.enabled} onChange={onToggle} />
      <button
        type="button"
        className="rule-text"
        onClick={onEdit}
        onContextMenu={(e) => {
          e.preventDefault()
          menu()
        }}
      >
        <span className="row-title">{rule.name}</span>
        <span className="row-desc">
          {ruleSummary(rule)}
          <span className="rule-arrow"> → </span>
          {actionText(rule, removal)}
        </span>
      </button>
      {rule.enabled && hits > 0 && (
        <span className="pill-badge" title={tr('Files this rule would sort right now')}>
          {count(hits)}
        </span>
      )}
      <Btn kind="ghost" icon="more" title={tr('More')} onClick={menu} />
    </Reorder.Item>
  )
}

export function Rules() {
  const trashRules = useApp(folderOf)!.rules.some((r) => r.enabled && r.action.type === 'trash')
  const folder = useApp(folderOf)!
  const plan = useApp((s) => s.plans[s.current!]?.data)
  const { saveRules, setAuto, set } = useApp.getState()
  const [order, setOrder] = useState(folder.rules)
  const [confirm, setConfirm] = useState(false)
  const latest = useRef(order)
  latest.current = order
  useEffect(() => setOrder(folder.rules), [folder.rules])

  const hits = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of plan?.ops ?? []) m.set(o.ruleId, (m.get(o.ruleId) ?? 0) + 1)
    return m
  }, [plan])

  const save = (rules: Rule[]) => {
    setOrder(rules)
    void saveRules(folder.path, rules)
  }

  const restore = async () => {
    try {
      save(await api.defaultRules())
      setConfirm(false)
    } catch (e) {
      useApp.getState().flash(failureText(asFailure(e)), 'error')
    }
  }

  return (
    <div className="page scroll">
      <div className="page-inner">
        <Group
          title={tr('Rules for {0}', folder.name)}
          action={
            <Btn icon="plus" onClick={() => set({ sheet: { type: 'rule', rule: null } })}>
              {tr('Add rule')}
            </Btn>
          }
          foot={tr(
            'Rules run from top to bottom, and the first rule that matches a file decides where it goes. Only files at the top level of {0} are sorted. Files already in subfolders stay put.',
            folder.name,
          )}
        >
          {order.length === 0 ? (
            <div className="group-empty">{tr('No rules yet. Add one to tell Dropzone where files should go.')}</div>
          ) : (
            <Reorder.Group axis="y" values={order} onReorder={setOrder} as="div" className="rules">
              {order.map((r, i) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  index={i}
                  total={order.length}
                  hits={hits.get(r.id) ?? 0}
                  onToggle={(on) => save(order.map((x) => (x.id === r.id ? { ...x, enabled: on } : x)))}
                  onEdit={() => set({ sheet: { type: 'rule', rule: r } })}
                  onDuplicate={() => save([...order.slice(0, i + 1), { ...r, id: '', name: tr('{0} copy', r.name) }, ...order.slice(i + 1)])}
                  onDelete={() => save(order.filter((x) => x.id !== r.id))}
                  onMove={(to) => {
                    const next = [...order]
                    next.splice(to, 0, ...next.splice(i, 1))
                    save(next)
                  }}
                  onDrop={() => {
                    if (latest.current.map((x) => x.id).join() !== folder.rules.map((x) => x.id).join()) void saveRules(folder.path, latest.current)
                  }}
                />
              ))}
            </Reorder.Group>
          )}
        </Group>

        {plan?.project && (
          <Group title={tr('Code project')}>
            <Row
              icon="code"
              tone="var(--mint)"
              title={tr('Sort this folder anyway')}
              desc={tr(
                '{0} contains {1}, so it looks like a code project, and moving its files can break builds and imports. Turn this on only if the folder isn’t really a project. Files inside project subfolders stay protected either way.',
                folder.name,
                plan.project,
              )}
            >
              <Toggle label={tr('Sort this folder anyway')} on={folder.allowProject} onChange={(v) => void useApp.getState().setAllowProject(folder.path, v)} />
            </Row>
          </Group>
        )}

        <Group title={tr('Automatic sorting')}>
          <Row
            title={tr('Sort new files automatically')}
            desc={tr(
              'From now on, when a new file arrives in {0} and stops changing, Dropzone applies these rules to it. Files already there wait for you to sort them, and rules that move files to the Trash only run when you sort by hand. Every change shows up in History, where you can undo it.',
              folder.name,
            )}
          >
            <Toggle label={tr('Sort new files automatically')} on={folder.auto} onChange={(v) => void setAuto(folder.path, v)} />
          </Row>
          <Row
            title={tr('Clean up once a week')}
            desc={
              trashRules
                ? folder.cleanup
                  ? tr('Rules that move files to the Trash run on their own every week, always using the Trash so you can undo them. Next cleanup: {0}.', longDate(folder.lastCleanup + WEEK))
                  : tr('Rules that move files to the Trash run on their own every week, always using the Trash so you can undo them.')
                : tr('Add a rule that moves files to the Trash, for example installers older than 30 days, to use weekly cleanup.')
            }
          >
            {folder.cleanup && (
              <Btn kind="ghost" onClick={() => void useApp.getState().cleanupNow(folder.path)}>
                {tr('Run now')}
              </Btn>
            )}
            <Toggle label={tr('Clean up once a week')} on={folder.cleanup} disabled={!trashRules && !folder.cleanup} onChange={(v) => void useApp.getState().setCleanup(folder.path, v)} />
          </Row>
        </Group>

        <Group>
          <Row title={tr('Restore default rules')} desc={tr('Replaces your rules for {0} with the starting set that sorts files by kind.', folder.name)}>
            {confirm ? (
              <div className="confirm">
                <Btn kind="ghost" onClick={() => setConfirm(false)}>
                  {tr('Cancel')}
                </Btn>
                <Btn kind="danger" onClick={() => void restore()}>
                  {tr('Restore')}
                </Btn>
              </div>
            ) : (
              <Btn onClick={() => setConfirm(true)}>{tr('Restore…')}</Btn>
            )}
          </Row>
        </Group>
      </div>
    </div>
  )
}
