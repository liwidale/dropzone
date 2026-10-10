import { api, asFailure } from './api'
import { failureText } from './copy'
import { isAbsolute, join } from './format'
import { tr } from './i18n'
import { popup, type MenuSpec } from './menu'
import { folderOf, useApp } from './store'
import type { Entry } from './types'

const st = () => useApp.getState()

export function subfolders(): string[] {
  const s = st()
  const folder = folderOf(s)
  const snap = s.current ? s.snapshots[s.current]?.data : undefined
  if (!folder || !snap) return []
  const names = new Set<string>()
  for (const e of snap.entries) if (e.dir) names.add(e.dir.split('/')[0])
  for (const r of folder.rules) if (r.action.type === 'move' && !isAbsolute(r.action.folder)) names.add(r.action.folder.split(/[\\/]/)[0])
  return [...names].sort((a, b) => a.localeCompare(b)).slice(0, 16)
}

export async function openEntries(entries: Entry[]): Promise<void> {
  for (const e of entries.slice(0, 12)) {
    try {
      await api.open(e.path)
    } catch (err) {
      st().flash(failureText(asFailure(err)), 'error')
      return
    }
  }
}

export async function revealEntries(entries: Entry[]): Promise<void> {
  const first = entries[0]
  if (!first) return
  try {
    await api.reveal(first.path)
  } catch (err) {
    st().flash(failureText(asFailure(err)), 'error')
  }
}

export function moveMenu(entries: Entry[]): MenuSpec {
  const folder = st().current
  const subs = subfolders()
  return {
    text: tr('Move to'),
    enabled: entries.length > 0,
    items: [
      ...subs.map((name) => ({ text: name, action: () => void st().moveTo(entries, join(folder!, name)) })),
      ...(subs.length ? (['separator'] as MenuSpec[]) : []),
      { text: tr('Other folder…'), action: () => void st().moveTo(entries, null) },
    ],
  }
}

export function entryMenu(entries: Entry[]): Promise<void> {
  const n = entries.length
  return popup([
    { text: n > 1 ? tr('Open {0} files', n) : tr('Open'), action: () => void openEntries(entries) },
    { text: tr('Show in Finder'), action: () => void revealEntries(entries) },
    'separator',
    moveMenu(entries),
    { text: tr('Move to Trash'), action: () => void st().trash(entries) },
  ])
}
