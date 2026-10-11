import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'
import { api, asFailure } from './api'
import { describeBatch, failureText } from './copy'
import { inside, join, parent, relative } from './format'
import { inferRule } from './infer'
import { tr } from './i18n'
import type { ApplyRequest, Batch, DupGroup, Entry, Failure, Folder, Insights, Kind, KnownFolder, Plan, Rule, Settings, SimilarGroup, Snapshot } from './types'

export type View = 'overview' | 'files' | 'duplicates' | 'rules' | 'history' | 'triage'
export type Preset = 'stale-installers' | 'unfinished' | 'large' | 'installed' | 'extracted'
export type SortKey = 'name' | 'kind' | 'size' | 'added'
export type Scope = 'top' | 'all'

export interface Loadable<T> {
  status: 'loading' | 'ready' | 'error'
  data?: T
  failure?: Failure
}

export interface Dupes {
  status: 'running' | 'ready' | 'error'
  groups: DupGroup[]
  done: number
  total: number
  kept: Record<string, string[]>
  failure?: Failure
}

export interface Similar {
  status: 'running' | 'ready' | 'error'
  groups: SimilarGroup[]
  done: number
  total: number
  kept: Record<string, string[]>
}

export type Sheet =
  | { type: 'sort' }
  | { type: 'rule'; rule: Rule | null; draft?: Rule }
  | { type: 'rename'; entries: Entry[] }
  | { type: 'settings' }
  | { type: 'dupes'; source?: 'similar' }
  | { type: 'recovered'; batch: Batch }
  | { type: 'remove'; path: string }
  | { type: 'result'; batch: Batch }
  | { type: 'project'; entries: Entry[]; dir: string | null }
  | { type: 'delete'; entries: Entry[] }

export interface Toast {
  id: number
  text: string
  tone: 'neutral' | 'error'
  undo?: string
  rule?: Rule
}

interface State {
  ready: boolean
  bootFailure: Failure | null
  folders: Folder[]
  settings: Settings
  known: [KnownFolder, string][]
  history: Batch[]
  current: string | null
  view: View
  kind: Kind | null
  preset: Preset | null
  query: string
  scope: Scope
  sort: { key: SortKey; dir: 1 | -1 }
  selection: string[]
  anchor: string | null
  inspector: boolean
  snapshots: Record<string, Loadable<Snapshot>>
  plans: Record<string, Loadable<Plan>>
  dupes: Record<string, Dupes>
  insights: Record<string, Insights>
  similar: Record<string, Similar>
  preview: string | null
  sheet: Sheet | null
  toast: Toast | null
  applying: { done: number; total: number } | null
  dropping: boolean

  boot(): Promise<void>
  select(path: string): void
  go(view: View, opts?: { kind?: Kind | null; preset?: Preset | null }): void
  set(p: Partial<State>): void
  load(path: string, quiet?: boolean): Promise<void>
  loadPlan(path: string): Promise<void>
  loadDupes(path: string): Promise<void>
  loadInsights(path: string): Promise<void>
  loadSimilar(path: string): Promise<void>
  extract(entries: Entry[]): Promise<void>
  rename(changes: { entry: Entry; name: string }[]): Promise<Batch | null>
  setCleanup(path: string, on: boolean): Promise<void>
  cleanupNow(path: string): Promise<void>
  addKnown(which: KnownFolder): Promise<void>
  chooseFolder(): Promise<void>
  locateFolder(path: string): Promise<void>
  removeFolder(path: string): Promise<void>
  run(request: ApplyRequest): Promise<Batch | null>
  undo(id?: string): Promise<void>
  saveRules(path: string, rules: Rule[]): Promise<boolean>
  setAuto(path: string, on: boolean): Promise<void>
  setAllowProject(path: string, on: boolean): Promise<void>
  setSettings(p: Partial<Settings>): Promise<void>
  trash(entries: Entry[], confirmed?: boolean): Promise<void>
  deleteNow(entries: Entry[], confirmed?: boolean): Promise<void>
  moveTo(entries: Entry[], dir: string | null, confirmed?: boolean): Promise<void>
  flash(text: string, tone?: Toast['tone'], undo?: string, rule?: Rule): void
}

let toastId = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
const media = matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(theme: Settings['theme']): void {
  const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
  const root = document.documentElement
  if (root.dataset.theme && root.dataset.theme !== resolved) {
    root.classList.add('theme-transition')
    setTimeout(() => root.classList.remove('theme-transition'), 480)
  }
  root.dataset.theme = resolved
  void getCurrentWindow()
    .setTheme(theme === 'system' ? null : theme)
    .catch(() => undefined)
}

media.addEventListener('change', () => applyTheme(useApp.getState().settings.theme))

const DEFAULT_SETTINGS: Settings = { theme: 'system', showHidden: false, recursive: true, staleDays: 30, removal: 'trash', menuBar: true, notify: true }

export const useApp = create<State>((set, get) => ({
  ready: false,
  bootFailure: null,
  folders: [],
  settings: DEFAULT_SETTINGS,
  known: [],
  history: [],
  current: null,
  view: 'overview',
  kind: null,
  preset: null,
  query: '',
  scope: 'all',
  sort: { key: 'added', dir: -1 },
  selection: [],
  anchor: null,
  inspector: true,
  snapshots: {},
  plans: {},
  dupes: {},
  insights: {},
  similar: {},
  preview: null,
  sheet: null,
  toast: null,
  applying: null,
  dropping: false,

  set: (p) => set(p),

  boot: async () => {
    try {
      const b = await api.boot()
      applyTheme(b.settings.theme)
      set({
        ready: true,
        bootFailure: null,
        folders: b.folders,
        settings: b.settings,
        history: b.history,
        known: b.known,
        current: b.folders[0]?.path ?? null,
        sheet: b.recovered ? { type: 'recovered', batch: b.recovered } : null,
      })
      const current = get().current
      if (current) void get().load(current)
      for (const f of b.folders) if (f.path !== current) void get().loadPlan(f.path)
    } catch (e) {
      applyTheme('system')
      set({ ready: true, bootFailure: asFailure(e) })
    }
  },

  select: (path) => {
    if (get().current === path) return
    set({ current: path, view: 'overview', kind: null, preset: null, query: '', selection: [], anchor: null })
    if (!get().snapshots[path]) void get().load(path)
  },

  go: (view, opts = {}) => {
    const s = get()
    const kind = opts.kind !== undefined ? opts.kind : view === 'files' ? s.kind : null
    const preset = opts.preset !== undefined ? opts.preset : null
    set({ view, kind: view === 'files' ? kind : null, preset: view === 'files' ? preset : null, selection: s.view === view && s.kind === kind && s.preset === preset ? s.selection : [] })
  },

  load: async (path, quiet = false) => {
    const prev = get().snapshots[path]
    if (!quiet || !prev?.data) set((s) => ({ snapshots: { ...s.snapshots, [path]: { status: 'loading', data: prev?.data } } }))
    try {
      const snap = await api.scan(path)
      set((s) => {
        const known = new Set(snap.entries.map((e) => e.path))
        const selection = s.current === path ? s.selection.filter((p) => known.has(p)) : s.selection
        return { snapshots: { ...s.snapshots, [path]: { status: 'ready', data: snap } }, selection }
      })
      void get().loadPlan(path)
      void get().loadDupes(path)
      void get().loadInsights(path)
      if (get().similar[path]) void get().loadSimilar(path)
    } catch (e) {
      const f = asFailure(e)
      if (f.code === 'cancelled') return
      set((s) => ({ snapshots: { ...s.snapshots, [path]: { status: 'error', failure: f } } }))
    }
  },

  loadPlan: async (path) => {
    set((s) => ({ plans: { ...s.plans, [path]: { status: 'loading', data: s.plans[path]?.data } } }))
    try {
      const plan = await api.plan(path)
      set((s) => ({ plans: { ...s.plans, [path]: { status: 'ready', data: plan } } }))
    } catch (e) {
      set((s) => ({ plans: { ...s.plans, [path]: { status: 'error', failure: asFailure(e) } } }))
    }
  },

  loadDupes: async (path) => {
    const prev = get().dupes[path]
    set((s) => ({ dupes: { ...s.dupes, [path]: { status: 'running', groups: prev?.groups ?? [], done: 0, total: 0, kept: prev?.kept ?? {} } } }))
    try {
      const groups = await api.duplicates(path)
      set((s) => {
        const old = s.dupes[path]
        const kept: Record<string, string[]> = {}
        for (const g of groups) {
          const still = (old?.kept[g.id] ?? []).filter((p) => g.files.some((f) => f.path === p))
          kept[g.id] = still.length ? still : [g.keep]
        }
        return { dupes: { ...s.dupes, [path]: { status: 'ready', groups, done: 1, total: 1, kept } } }
      })
    } catch (e) {
      const f = asFailure(e)
      if (f.code === 'cancelled') return
      set((s) => ({ dupes: { ...s.dupes, [path]: { ...(s.dupes[path] ?? { groups: [], kept: {}, done: 0, total: 0 }), status: 'error', failure: f } } }))
    }
  },

  loadInsights: async (path) => {
    try {
      const data = await api.insights(path)
      set((s) => ({ insights: { ...s.insights, [path]: data } }))
    } catch {
      set((s) => ({ insights: { ...s.insights, [path]: { extracted: [], installed: [] } } }))
    }
  },

  loadSimilar: async (path) => {
    const prev = get().similar[path]
    set((s) => ({ similar: { ...s.similar, [path]: { status: 'running', groups: prev?.groups ?? [], done: 0, total: 0, kept: prev?.kept ?? {} } } }))
    try {
      const groups = await api.similar(path)
      set((s) => {
        const old = s.similar[path]
        const kept: Record<string, string[]> = {}
        for (const g of groups) {
          const still = (old?.kept[g.id] ?? []).filter((p) => g.files.some((f) => f.path === p))
          kept[g.id] = still.length ? still : [g.keep]
        }
        return { similar: { ...s.similar, [path]: { status: 'ready', groups, done: 1, total: 1, kept } } }
      })
    } catch (e) {
      if (asFailure(e).code === 'cancelled') return
      set((s) => ({ similar: { ...s.similar, [path]: { ...(s.similar[path] ?? { groups: [], kept: {}, done: 0, total: 0 }), status: 'error' } } }))
    }
  },

  extract: async (entries) => {
    const folder = get().current
    const zips = entries.filter((e) => e.ext === 'zip')
    if (!folder || !zips.length) return
    await get().run({ folder, kind: 'extract', ops: zips.map((e) => ({ action: 'extract', source: e.path, destination: null, size: e.size, modified: e.modified })) })
  },

  rename: async (changes) => {
    const folder = get().current
    const ops = changes.filter((c) => c.name && c.name !== c.entry.name)
    if (!folder || !ops.length) return null
    const batch = await get().run({
      folder,
      kind: 'rename',
      allowProjects: true,
      ops: ops.map((c) => ({ action: 'move', source: c.entry.path, destination: join(parent(c.entry.path), c.name), size: c.entry.size, modified: c.entry.modified })),
    })
    const renamed = batch?.ops.filter((o) => o.status === 'done' && o.target).map((o) => o.target!) ?? []
    if (renamed.length) set({ selection: renamed, anchor: renamed[0] })
    return batch
  },

  setCleanup: async (path, on) => {
    try {
      await api.setCleanup(path, on)
      set((s) => ({ folders: s.folders.map((f) => (f.path === path ? { ...f, cleanup: on, lastCleanup: on ? Date.now() : f.lastCleanup } : f)) }))
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  cleanupNow: async (path) => {
    try {
      const batch = await api.cleanupNow(path)
      set((s) => ({
        folders: s.folders.map((f) => (f.path === path ? { ...f, lastCleanup: Date.now() } : f)),
        history: batch ? [batch, ...s.history.filter((b) => b.id !== batch.id)] : s.history,
      }))
      if (batch) get().flash(describeBatch(batch).done, 'neutral', undoable(batch) ? batch.id : undefined)
      else get().flash(tr('Nothing to clean up right now.'))
      void get().load(path, true)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  addKnown: async (which) => {
    try {
      const f = await api.addKnown(which)
      set((s) => ({ folders: s.folders.some((x) => x.path === f.path) ? s.folders : [...s.folders, f] }))
      get().select(f.path)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  chooseFolder: async () => {
    try {
      const f = await api.chooseFolder()
      if (!f) return
      set((s) => ({ folders: s.folders.some((x) => x.path === f.path) ? s.folders : [...s.folders, f] }))
      get().select(f.path)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  locateFolder: async (path) => {
    try {
      const f = await api.locateFolder(path)
      if (!f) return
      set((s) => ({ folders: s.folders.map((x) => (x.path === path ? f : x)), current: f.path }))
      void get().load(f.path)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  removeFolder: async (path) => {
    try {
      await api.removeFolder(path)
      set((s) => {
        const folders = s.folders.filter((f) => f.path !== path)
        const drop = <T>(m: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(m).filter(([k]) => k !== path))
        return {
          folders,
          snapshots: drop(s.snapshots),
          plans: drop(s.plans),
          dupes: drop(s.dupes),
          current: s.current === path ? (folders[0]?.path ?? null) : s.current,
          view: 'overview',
          selection: [],
        }
      })
      const next = get().current
      if (next && !get().snapshots[next]) void get().load(next)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  run: async (request) => {
    if (!request.ops.length || get().applying) return null
    set({ applying: { done: 0, total: request.ops.length } })
    try {
      const batch = await api.apply(request)
      set((s) => ({ history: [batch, ...s.history.filter((b) => b.id !== batch.id)], applying: null }))
      const d = describeBatch(batch)
      const failed = batch.ops.some((o) => o.status === 'failed' || o.status === 'skipped')
      if (failed) set({ sheet: { type: 'result', batch } })
      else get().flash(d.done, 'neutral', undoable(batch) ? batch.id : undefined)
      void get().load(request.folder, true)
      return batch
    } catch (e) {
      set({ applying: null })
      get().flash(failureText(asFailure(e)), 'error')
      void get().load(request.folder, true)
      return null
    }
  },

  undo: async (id) => {
    const target = id ? get().history.find((b) => b.id === id) : get().history.find(undoable)
    if (!target) {
      get().flash(tr('Nothing to undo.'))
      return
    }
    try {
      const batch = await api.undo(target.id)
      set((s) => ({ history: s.history.map((b) => (b.id === batch.id ? batch : b)) }))
      const failed = batch.ops.filter((o) => o.status === 'undoFailed').length
      const undone = batch.ops.filter((o) => o.status === 'undone').length
      if (failed) get().flash(tr('Put back {0} of {1} files. Open History to see why the rest stayed.', undone, undone + failed), 'error')
      else if (batch.kind === 'extract') get().flash(tr('Moved {0} extracted folder to the Trash.|Moved {0} extracted folders to the Trash.', undone))
      else get().flash(tr('Put back {0} file.|Put back {0} files.', undone))
      void get().load(batch.folder, true)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  saveRules: async (path, rules) => {
    try {
      const saved = await api.saveRules(path, rules)
      set((s) => ({ folders: s.folders.map((f) => (f.path === path ? { ...f, rules: saved } : f)) }))
      void get().loadPlan(path)
      return true
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
      return false
    }
  },

  setAuto: async (path, on) => {
    try {
      await api.setAuto(path, on)
      set((s) => ({ folders: s.folders.map((f) => (f.path === path ? { ...f, auto: on } : f)) }))
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  setSettings: async (p) => {
    const next = { ...get().settings, ...p }
    set({ settings: next })
    if (p.theme) applyTheme(p.theme)
    try {
      set({ settings: await api.setSettings(next) })
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  setAllowProject: async (path, on) => {
    try {
      await api.setAllowProject(path, on)
      set((s) => ({ folders: s.folders.map((f) => (f.path === path ? { ...f, allowProject: on } : f)) }))
      void get().loadPlan(path)
    } catch (e) {
      get().flash(failureText(asFailure(e)), 'error')
    }
  },

  trash: async (entries, confirmed = false) => {
    const folder = get().current
    if (!folder || !entries.length) return
    if (get().settings.removal === 'delete') return get().deleteNow(entries)
    if (!confirmed && entries.some((e) => e.project != null)) {
      set({ sheet: { type: 'project', entries, dir: null } })
      return
    }
    await get().run({ folder, kind: 'trash', allowProjects: confirmed, ops: entries.map((e) => ({ action: 'trash', source: e.path, destination: null, size: e.size, modified: e.modified })) })
  },

  deleteNow: async (entries, confirmed = false) => {
    const folder = get().current
    if (!folder || !entries.length) return
    if (!confirmed) {
      set({ sheet: { type: 'delete', entries } })
      return
    }
    await get().run({ folder, kind: 'delete', allowProjects: true, ops: entries.map((e) => ({ action: 'delete', source: e.path, destination: null, size: e.size, modified: e.modified })) })
  },

  moveTo: async (entries, dir, confirmed = false) => {
    const folder = get().current
    if (!folder || !entries.length) return
    let target = dir
    if (!target) {
      try {
        target = await api.chooseDestination()
      } catch (e) {
        get().flash(failureText(asFailure(e)), 'error')
        return
      }
    }
    if (!target) return
    const ops = entries.filter((e) => parent(e.path) !== target).map((e) => ({ action: 'move' as const, source: e.path, destination: join(target, e.name), size: e.size, modified: e.modified }))
    if (!ops.length) {
      get().flash(tr('Those files are already there.'))
      return
    }
    if (!confirmed && entries.some((e) => e.project != null)) {
      set({ sheet: { type: 'project', entries, dir: target } })
      return
    }
    const batch = await get().run({ folder, kind: 'move', allowProjects: confirmed, ops })
    const moved = entries.filter((e) => !e.dir && e.project == null)
    if (batch && get().sheet?.type !== 'result' && moved.length && inside(target, folder) && batch.ops.every((o) => o.status === 'done')) {
      get().flash(describeBatch(batch).done, 'neutral', batch.id, inferRule(moved, relative(target, folder).replace(/\\/g, '/')))
    }
  },

  flash: (text, tone = 'neutral', undo, rule) => {
    if (toastTimer) clearTimeout(toastTimer)
    const t = { id: ++toastId, text, tone, undo, rule }
    set({ toast: t })
    toastTimer = setTimeout(
      () => {
        if (get().toast?.id === t.id) set({ toast: null })
      },
      rule ? 10000 : undo ? 7000 : 4200,
    )
  },
}))

export const undoable = (b: Batch): boolean => b.ops.some((o) => o.action !== 'delete' && (o.status === 'done' || (o.status === 'undoFailed' && !!o.target)))

export const removalAction = (): 'trash' | 'delete' => useApp.getState().settings.removal

export const folderOf = (s: State): Folder | null => s.folders.find((f) => f.path === s.current) ?? null
