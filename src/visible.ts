import { useMemo } from 'react'
import { KINDS } from './kinds'
import { useApp, type Preset, type Scope, type SortKey } from './store'
import type { Entry, Insights, Kind } from './types'

export const LARGE = 500_000_000
const DAY = 86_400_000

export interface Query {
  kind: Kind | null
  preset: Preset | null
  query: string
  scope: Scope
  sort: { key: SortKey; dir: 1 | -1 }
  staleDays: number
  marked?: Set<string>
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function marked(insights: Insights | undefined, preset: Preset | null): Set<string> | undefined {
  if (preset === 'installed') return new Set(insights?.installed ?? [])
  if (preset === 'extracted') return new Set(insights?.extracted.map((x) => x.archive) ?? [])
  return undefined
}

export function matchesPreset(e: Entry, preset: Preset, staleDays: number, now = Date.now(), set?: Set<string>): boolean {
  switch (preset) {
    case 'stale-installers':
      return e.kind === 'installer' && now - e.added >= staleDays * DAY
    case 'unfinished':
      return e.kind === 'partial'
    case 'large':
      return e.size >= LARGE
    case 'installed':
    case 'extracted':
      return !!set?.has(e.path)
  }
}

export function filterEntries(entries: Entry[], q: Query): Entry[] {
  const tokens = q.query.toLowerCase().split(/\s+/).filter(Boolean)
  const now = Date.now()
  const out = entries.filter((e) => {
    if (q.scope === 'top' && !q.preset && e.dir) return false
    if (q.kind && e.kind !== q.kind) return false
    if (q.preset && !matchesPreset(e, q.preset, q.staleDays, now, q.marked)) return false
    if (!tokens.length) return true
    const hay = `${e.name} ${e.dir} ${e.from ?? ''} ${KINDS[e.kind].one}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
  const { key, dir } = q.sort
  const cmp: (a: Entry, b: Entry) => number =
    key === 'name'
      ? (a, b) => collator.compare(a.name, b.name)
      : key === 'kind'
        ? (a, b) => collator.compare(KINDS[a.kind].one, KINDS[b.kind].one) || collator.compare(a.name, b.name)
        : key === 'size'
          ? (a, b) => a.size - b.size
          : (a, b) => a.added - b.added
  return out.sort((a, b) => cmp(a, b) * dir)
}

export function useVisible(): Entry[] {
  const snap = useApp((s) => (s.current ? s.snapshots[s.current]?.data : undefined))
  const kind = useApp((s) => s.kind)
  const preset = useApp((s) => s.preset)
  const query = useApp((s) => s.query)
  const scope = useApp((s) => s.scope)
  const sort = useApp((s) => s.sort)
  const staleDays = useApp((s) => s.settings.staleDays)
  const insights = useApp((s) => (s.current ? s.insights[s.current] : undefined))
  return useMemo(
    () => (snap ? filterEntries(snap.entries, { kind, preset, query, scope, sort, staleDays, marked: marked(insights, preset) }) : []),
    [snap, kind, preset, query, scope, sort, staleDays, insights],
  )
}

export function useSelected(): Entry[] {
  const snap = useApp((s) => (s.current ? s.snapshots[s.current]?.data : undefined))
  const selection = useApp((s) => s.selection)
  return useMemo(() => {
    if (!snap || !selection.length) return []
    const set = new Set(selection)
    return snap.entries.filter((e) => set.has(e.path))
  }, [snap, selection])
}
