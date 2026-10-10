import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { entryMenu, openEntries } from '../actions'
import { bytes, when } from '../format'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { KINDS } from '../kinds'
import { isMac, modKey } from '../platform'
import { useApp, type SortKey } from '../store'
import type { Entry } from '../types'
import { FileGlyph } from './FileGlyph'

const ROW = 28
const OVERSCAN = 8

const Line = memo(function Line({
  e,
  on,
  top,
  location,
  rootName,
  onDown,
  onOpen,
  onMenu,
}: {
  e: Entry
  on: boolean
  top: number
  location: boolean
  rootName: string
  onDown: (e: MouseEvent, entry: Entry) => void
  onOpen: (entry: Entry) => void
  onMenu: (e: MouseEvent, entry: Entry) => void
}) {
  return (
    <div
      className={`line${on ? ' on' : ''}`}
      style={{ transform: `translateY(${top}px)` }}
      role="row"
      aria-selected={on}
      onMouseDown={(ev) => onDown(ev, e)}
      onDoubleClick={() => onOpen(e)}
      onContextMenu={(ev) => onMenu(ev, e)}
    >
      <span className="cell c-name" role="gridcell">
        <FileGlyph entry={e} size={20} />
        <span className="name-text" title={e.name}>
          {e.name}
        </span>
      </span>
      {location && (
        <span className="cell c-loc" role="gridcell" title={e.dir || rootName}>
          {e.dir || rootName}
        </span>
      )}
      <span className="cell c-kind" role="gridcell">
        {KINDS[e.kind].one}
      </span>
      <span className="cell c-size" role="gridcell">
        {bytes(e.size)}
      </span>
      <span className="cell c-date" role="gridcell">
        {when(e.added)}
      </span>
    </div>
  )
})

function Head({ k, label, className }: { k: SortKey; label: string; className: string }) {
  const sort = useApp((s) => s.sort)
  const on = sort.key === k
  return (
    <button
      type="button"
      className={`cell head-cell ${className}${on ? ' on' : ''}`}
      aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => useApp.setState({ sort: { key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : k === 'name' || k === 'kind' ? 1 : -1 } })}
    >
      <span>{label}</span>
      {on && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={10} strokeWidth={2} />}
    </button>
  )
}

export function FileList({ entries, location, rootName }: { entries: Entry[]; location: boolean; rootName: string }) {
  const body = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  const selection = useApp((s) => s.selection)
  const selected = new Set(selection)

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, height: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const index = useRef(new Map<string, number>())
  index.current = new Map(entries.map((e, i) => [e.path, i]))

  const reveal = (i: number) => {
    const el = body.current
    if (!el) return
    const y = i * ROW
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW - el.clientHeight
  }

  const anchor = useApp((s) => s.anchor)
  useEffect(() => {
    if (anchor && index.current.has(anchor)) reveal(index.current.get(anchor)!)
  }, [anchor])

  const pivot = useRef<string | null>(null)

  const range = (from: string, to: number): string[] => {
    const a = index.current.get(from) ?? to
    const [lo, hi] = a < to ? [a, to] : [to, a]
    return entries.slice(lo, hi + 1).map((x) => x.path)
  }

  const onDown = (ev: MouseEvent, e: Entry) => {
    if (ev.button !== 0) return
    body.current?.focus()
    const s = useApp.getState()
    if (modKey(ev)) {
      const has = s.selection.includes(e.path)
      useApp.setState({ selection: has ? s.selection.filter((p) => p !== e.path) : [...s.selection, e.path], anchor: e.path })
      pivot.current = e.path
    } else if (ev.shiftKey && (pivot.current ?? s.anchor)) {
      useApp.setState({ selection: range((pivot.current ?? s.anchor)!, index.current.get(e.path)!), anchor: e.path })
    } else {
      useApp.setState({ selection: [e.path], anchor: e.path })
      pivot.current = e.path
    }
  }

  const onMenu = (ev: MouseEvent, e: Entry) => {
    ev.preventDefault()
    const s = useApp.getState()
    let list = s.selection
    if (!list.includes(e.path)) {
      list = [e.path]
      useApp.setState({ selection: list, anchor: e.path })
    }
    const set = new Set(list)
    void entryMenu(entries.filter((x) => set.has(x.path)))
  }

  const onKey = (ev: KeyboardEvent) => {
    const s = useApp.getState()
    const cur = s.anchor && index.current.has(s.anchor) ? index.current.get(s.anchor)! : -1
    const pick = (i: number) => {
      if (!entries.length) return
      const j = Math.max(0, Math.min(entries.length - 1, i))
      const p = entries[j].path
      if (ev.shiftKey && (pivot.current ?? s.anchor)) useApp.setState({ selection: range((pivot.current ?? s.anchor)!, j), anchor: p })
      else {
        useApp.setState({ selection: [p], anchor: p })
        pivot.current = p
      }
      reveal(j)
    }
    const chosen = () => entries.filter((x) => s.selection.includes(x.path))
    if (ev.key === 'ArrowDown') pick(cur + 1)
    else if (ev.key === 'ArrowUp') pick(cur < 0 ? 0 : cur - 1)
    else if (ev.key === 'Home') pick(0)
    else if (ev.key === 'End') pick(entries.length - 1)
    else if (ev.key === 'PageDown') pick(cur + Math.floor(view.height / ROW))
    else if (ev.key === 'PageUp') pick(cur - Math.floor(view.height / ROW))
    else if (ev.key === 'Enter' || (modKey(ev) && (ev.key === 'ArrowDown' || ev.key === 'o'))) void openEntries(chosen())
    else if ((modKey(ev) && ev.key === 'Backspace') || (!isMac && ev.key === 'Delete')) void s.trash(chosen())
    else if (ev.key === 'Escape') useApp.setState({ selection: [], anchor: null })
    else return
    ev.preventDefault()
  }

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN)
  const last = Math.min(entries.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN)

  return (
    <div className={`list${location ? ' with-loc' : ''}`} role="grid" aria-label={tr('Files')} aria-rowcount={entries.length} aria-multiselectable>
      <div className="list-head" role="row">
        <Head k="name" label={tr('Name')} className="c-name" />
        {location && <span className="cell head-cell c-loc static">{tr('Location')}</span>}
        <Head k="kind" label={tr('Kind')} className="c-kind" />
        <Head k="size" label={tr('Size')} className="c-size" />
        <Head k="added" label={tr('Date added')} className="c-date" />
      </div>
      <div
        ref={body}
        className="list-body scroll"
        tabIndex={0}
        onScroll={(e) => setView((v) => ({ ...v, top: (e.target as HTMLDivElement).scrollTop }))}
        onKeyDown={onKey}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('list-space')) useApp.setState({ selection: [], anchor: null })
        }}
      >
        <div className="list-space" style={{ height: entries.length * ROW }}>
          {entries.slice(first, last).map((e, i) => (
            <Line key={e.path} e={e} top={(first + i) * ROW} on={selected.has(e.path)} location={location} rootName={rootName} onDown={onDown} onOpen={(x) => void openEntries([x])} onMenu={onMenu} />
          ))}
        </div>
      </div>
    </div>
  )
}
