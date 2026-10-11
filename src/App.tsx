import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { moveMenu, openEntries, revealEntries } from './actions'
import { api, on } from './api'
import { failureText } from './copy'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { Btn, Empty, Spinner } from './components/ui'
import { tr } from './i18n'
import { Icon } from './icons'
import { popup } from './menu'
import { isMac } from './platform'
import { folderOf, useApp, type View } from './store'
import type { Entry } from './types'
import { Duplicates } from './views/Duplicates'
import { Files } from './views/Files'
import { FolderIssue } from './views/FolderIssue'
import { History } from './views/History'
import { Overview } from './views/Overview'
import { RuleEditor } from './views/RuleEditor'
import { Rules } from './views/Rules'
import { DeleteSheet, DupesSheet, ProjectSheet, RecoveredSheet, RemoveSheet, ResultSheet, SettingsSheet } from './views/Sheets'
import { SortSheet } from './views/SortSheet'
import { filterEntries, marked } from './visible'
import { Welcome } from './views/Welcome'
import { RenameSheet } from './views/RenameSheet'
import { Triage } from './views/Triage'
import { PreviewOverlay } from './components/Preview'

const VIEWS: Record<string, View> = { 'view-overview': 'overview', 'view-files': 'files', 'view-duplicates': 'duplicates', 'view-rules': 'rules', 'view-history': 'history' }

function selectedEntries(): Entry[] {
  const s = useApp.getState()
  const snap = s.current ? s.snapshots[s.current]?.data : undefined
  if (!snap || s.view !== 'files') return []
  const set = new Set(s.selection)
  return snap.entries.filter((e) => set.has(e.path))
}

function visibleEntries(): Entry[] {
  const s = useApp.getState()
  const snap = s.current ? s.snapshots[s.current]?.data : undefined
  return snap
    ? filterEntries(snap.entries, {
        kind: s.kind,
        preset: s.preset,
        query: s.query,
        scope: s.scope,
        sort: s.sort,
        staleDays: s.settings.staleDays,
        marked: marked(s.current ? s.insights[s.current] : undefined, s.preset),
      })
    : []
}

const SHORTCUTS: Record<string, string> = {
  o: 'add-folder',
  r: 'refresh',
  f: 'find',
  z: 'undo',
  a: 'select-all',
  ',': 'settings',
  '1': 'view-overview',
  '2': 'view-files',
  '3': 'view-duplicates',
  '4': 'view-rules',
  '5': 'view-history',
}

function shortcut(e: KeyboardEvent): void {
  if (e.key === 'F5') {
    e.preventDefault()
    onMenu('refresh')
    return
  }
  if (!e.ctrlKey || e.metaKey) return
  const key = e.key.toLowerCase()
  const id = e.shiftKey && key === 's' ? 'sort' : e.altKey && key === 'i' ? 'inspector' : !e.shiftKey && !e.altKey ? SHORTCUTS[key] : undefined
  if (!id || ((id === 'undo' || id === 'select-all') && editing())) return
  e.preventDefault()
  onMenu(id)
}

const editing = (): boolean => {
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}

function onMenu(id: string): void {
  const s = useApp.getState()
  if (id.startsWith('sort-folder:')) {
    const path = id.slice('sort-folder:'.length)
    if (s.folders.some((f) => f.path === path) && !s.applying) {
      s.select(path)
      useApp.setState({ sheet: { type: 'sort' } })
    }
    return
  }
  if (VIEWS[id]) {
    if (s.current && !s.sheet) s.go(VIEWS[id], VIEWS[id] === 'files' ? { kind: null, preset: null } : {})
    return
  }
  switch (id) {
    case 'settings':
      if (!s.applying) s.set({ sheet: { type: 'settings' } })
      return
    case 'add-folder':
      void s.chooseFolder()
      return
    case 'sort':
      if (s.current && !s.sheet && !s.applying) s.set({ sheet: { type: 'sort' } })
      return
    case 'refresh':
      if (s.current) void s.load(s.current)
      return
    case 'find':
      if (!s.current || s.sheet) return
      document.getElementById('search')?.focus()
      ;(document.getElementById('search') as HTMLInputElement | null)?.select()
      return
    case 'inspector':
      if (!s.current) return
      if (s.view !== 'files') {
        s.go('files', { kind: null, preset: null })
        s.set({ inspector: true })
      } else s.set({ inspector: !s.inspector })
      return
    case 'undo':
      if (editing()) document.execCommand('undo')
      else if (!s.sheet && !s.applying) void s.undo()
      return
    case 'select-all':
      if (editing()) document.execCommand('selectAll')
      else if (s.view === 'files' && !s.sheet) s.set({ selection: visibleEntries().map((e) => e.path) })
      return
  }
  const chosen = selectedEntries()
  if (!chosen.length || s.sheet) return
  if (id === 'open') void openEntries(chosen)
  if (id === 'reveal') void revealEntries(chosen)
  if (id === 'trash') void s.trash(chosen)
  if (id === 'delete') void s.deleteNow(chosen)
  if (id === 'move') {
    const m = moveMenu(chosen)
    if (typeof m !== 'string' && m.items) void popup(m.items)
  }
}

function Body() {
  const folder = useApp(folderOf)
  const view = useApp((s) => s.view)
  const snap = useApp((s) => (s.current ? s.snapshots[s.current] : undefined))
  if (!folder) return null
  if (snap?.status === 'error' && snap.failure) return <FolderIssue folder={folder} failure={snap.failure} />
  if (!snap?.data) {
    return (
      <div className="center-state">
        <Spinner size={18} />
        <div className="empty-text">{tr('Reading {0}…', folder.name)}</div>
      </div>
    )
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={view}
        className="view"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.06 } }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        {view === 'overview' && <Overview />}
        {view === 'files' && <Files />}
        {view === 'duplicates' && <Duplicates />}
        {view === 'rules' && <Rules />}
        {view === 'history' && <History />}
        {view === 'triage' && <Triage />}
      </motion.div>
    </AnimatePresence>
  )
}

function Sheets() {
  const sheet = useApp((s) => s.sheet)
  const key = sheet ? `${sheet.type}${sheet.type === 'rule' ? (sheet.rule?.id ?? 'new') : ''}` : 'none'
  return (
    <AnimatePresence>
      {sheet && (
        <motion.div key={key}>
          {sheet.type === 'sort' && <SortSheet />}
          {sheet.type === 'rule' && <RuleEditor rule={sheet.rule} draft={sheet.draft} />}
          {sheet.type === 'settings' && <SettingsSheet />}
          {sheet.type === 'dupes' && <DupesSheet source={sheet.source} />}
          {sheet.type === 'recovered' && <RecoveredSheet batch={sheet.batch} />}
          {sheet.type === 'remove' && <RemoveSheet path={sheet.path} />}
          {sheet.type === 'result' && <ResultSheet batch={sheet.batch} />}
          {sheet.type === 'project' && <ProjectSheet entries={sheet.entries} dir={sheet.dir} />}
          {sheet.type === 'delete' && <DeleteSheet entries={sheet.entries} />}
          {sheet.type === 'rename' && <RenameSheet entries={sheet.entries} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Toast() {
  const toast = useApp((s) => s.toast)
  const undo = useApp((s) => s.undo)
  const raised = useApp((s) => s.view === 'triage')
  return (
    <div className={`toast-host${raised ? ' raised' : ''}`} aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast${toast.tone === 'error' ? ' error' : ''}`}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          >
            {toast.tone === 'error' && <Icon name="alert" size={13} />}
            <span>{toast.text}</span>
            {toast.rule && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  useApp.setState({ toast: null, sheet: { type: 'rule', rule: null, draft: toast.rule } })
                }}
              >
                {tr('Make a rule')}
              </button>
            )}
            {toast.undo && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  useApp.setState({ toast: null })
                  void undo(toast.undo)
                }}
              >
                {tr('Undo')}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function App() {
  const ready = useApp((s) => s.ready)
  const bootFailure = useApp((s) => s.bootFailure)
  const hasFolders = useApp((s) => s.folders.length > 0)
  const dropping = useApp((s) => s.dropping)
  const inspector = useApp((s) => s.inspector)
  const preview = useApp((s) => s.preview)
  const folders = useApp((s) => s.folders)
  const plans = useApp((s) => s.plans)

  useEffect(() => {
    const items = folders.map((f) => ({ path: f.path, name: f.name, pending: plans[f.path]?.data?.ops.length ?? 0 }))
    void api.updateTray(items).catch(() => undefined)
  }, [folders, plans])

  useEffect(() => {
    void useApp.getState().boot()
    if (!isMac) window.addEventListener('keydown', shortcut)
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const subs = [
      on.menu(onMenu),
      on.folderChanged((folder) => {
        clearTimeout(timers.get(folder))
        timers.set(
          folder,
          setTimeout(() => {
            const s = useApp.getState()
            if (!s.applying && s.snapshots[folder]) void s.load(folder, true)
          }, 250),
        )
      }),
      on.historyChanged(() => void api.history().then((history) => useApp.setState({ history }))),
      on.settingsChanged(() => {
        const s = useApp.getState()
        useApp.setState({ snapshots: {}, dupes: {}, plans: {} })
        if (s.current) void s.load(s.current)
      }),
      on.duplicatesProgress((p) =>
        useApp.setState((s) => {
          const d = s.dupes[p.folder]
          return d && d.status === 'running' ? { dupes: { ...s.dupes, [p.folder]: { ...d, done: p.done, total: p.total } } } : {}
        }),
      ),
      on.similarProgress((p) =>
        useApp.setState((s) => {
          const d = s.similar[p.folder]
          return d && d.status === 'running' ? { similar: { ...s.similar, [p.folder]: { ...d, done: p.done, total: p.total } } } : {}
        }),
      ),
      on.applyProgress((p) => useApp.setState((s) => (s.applying ? { applying: { done: p.done, total: p.total } } : {}))),
      on.dropped(async (d) => {
        const s = useApp.getState()
        if (d.failures.length) s.flash(failureText(d.failures[0]), 'error')
        else if (!d.added.length && d.files) s.flash(tr('Drop a folder to add it. Dropzone looks after folders, not single files.'))
        if (!d.added.length) return
        const b = await api.boot()
        useApp.setState({ folders: b.folders })
        s.select(d.added[d.added.length - 1])
      }),
      getCurrentWebview().onDragDropEvent((e) => {
        const t = e.payload.type
        useApp.setState({ dropping: t === 'enter' || t === 'over' })
      }),
    ]
    return () => {
      window.removeEventListener('keydown', shortcut)
      for (const p of subs) void p.then((u) => u())
    }
  }, [])

  useEffect(() => {
    if (ready) requestAnimationFrame(() => void getCurrentWindow().show())
  }, [ready])

  useEffect(() => {
    void api.setInspectorMenu(inspector).catch(() => undefined)
  }, [inspector])

  if (!ready) return null

  if (bootFailure) {
    return (
      <div className="boot-failure" data-tauri-drag-region>
        <Empty icon="alert" title={tr('Dropzone couldn’t start')} actions={<Btn onClick={() => location.reload()}>{tr('Try again')}</Btn>}>
          {failureText(bootFailure)}
        </Empty>
      </div>
    )
  }

  return (
    <div className={`app${hasFolders ? '' : ' first-run'}`}>
      {hasFolders ? (
        <>
          <Sidebar />
          <main className="content">
            <Toolbar />
            <div className="content-body">
              <Body />
            </div>
          </main>
        </>
      ) : (
        <Welcome />
      )}
      <Sheets />
      <AnimatePresence>{preview && <PreviewOverlay list={visibleEntries} />}</AnimatePresence>
      <Toast />
      <AnimatePresence>
        {dropping && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <div className="drop-card">
              <Icon name="folder" size={22} />
              <span>{tr('Drop a folder to add it to Dropzone')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
