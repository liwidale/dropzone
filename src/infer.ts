import { base } from './format'
import type { Condition, Entry, Rule } from './types'

const tokens = (name: string): string[] =>
  name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 3)

function condition(entries: Entry[]): Condition {
  const from = entries[0].from
  if (from && entries.every((e) => e.from === from)) return { type: 'source', text: from }
  const shared = entries.map((e) => new Set(tokens(e.name))).reduce((a, b) => new Set([...a].filter((t) => b.has(t))))
  const token = [...shared].sort((a, b) => b.length - a.length)[0]
  if (token && entries.length > 1) return { type: 'name', text: token }
  const kind = entries[0].kind
  if (entries.length > 1 && kind !== 'other' && entries.every((e) => e.kind === kind)) return { type: 'kind', kinds: [kind] }
  const extensions = [...new Set(entries.map((e) => e.ext).filter(Boolean))]
  if (extensions.length && extensions.length <= 4) return { type: 'extension', extensions }
  return { type: 'kind', kinds: [...new Set(entries.map((e) => e.kind))] }
}

export function inferRule(entries: Entry[], folder: string): Rule {
  return {
    id: '',
    name: base(folder),
    enabled: true,
    conditions: [condition(entries)],
    action: { type: 'move', folder, group: 'none' },
  }
}
