import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ApplyRequest, Batch, Boot, Dropped, DupGroup, Failure, Folder, JobProgress, KnownFolder, Plan, Rule, RulePreview, Settings, Snapshot } from './types'

export function asFailure(e: unknown): Failure {
  if (e && typeof e === 'object' && 'code' in e) return e as Failure
  return { code: 'io', detail: String(e) }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    throw asFailure(e)
  }
}

export const api = {
  boot: () => call<Boot>('boot'),
  addKnown: (which: KnownFolder) => call<Folder>('add_known', { which }),
  chooseFolder: () => call<Folder | null>('choose_folder'),
  locateFolder: (path: string) => call<Folder | null>('locate_folder', { path }),
  removeFolder: (path: string) => call<void>('remove_folder', { path }),
  scan: (path: string) => call<Snapshot>('scan', { path }),
  duplicates: (path: string) => call<DupGroup[]>('duplicates', { path }),
  plan: (path: string) => call<Plan>('plan', { path }),
  previewRule: (path: string, rule: Rule) => call<RulePreview>('preview_rule', { path, rule }),
  saveRules: (path: string, rules: Rule[]) => call<Rule[]>('save_rules', { path, rules }),
  defaultRules: () => call<Rule[]>('default_rules'),
  setAuto: (path: string, on: boolean) => call<void>('set_auto', { path, on }),
  setAllowProject: (path: string, on: boolean) => call<void>('set_allow_project', { path, on }),
  apply: (request: ApplyRequest) => call<Batch>('apply', { request }),
  undo: (id: string) => call<Batch>('undo', { id }),
  history: () => call<Batch[]>('history'),
  clearHistory: () => call<void>('clear_history'),
  setSettings: (settings: Settings) => call<Settings>('set_settings', { settings }),
  chooseDestination: () => call<string | null>('choose_destination'),
  reveal: (path: string) => call<void>('reveal', { path }),
  open: (path: string) => call<void>('open_file', { path }),
  openPrivacySettings: () => call<void>('open_privacy_settings'),
  setInspectorMenu: (shown: boolean) => call<void>('set_inspector_menu', { shown }),
}

export const on = {
  menu: (cb: (id: string) => void): Promise<UnlistenFn> => listen<string>('menu', (e) => cb(e.payload)),
  folderChanged: (cb: (folder: string) => void): Promise<UnlistenFn> => listen<{ folder: string }>('folder-changed', (e) => cb(e.payload.folder)),
  historyChanged: (cb: () => void): Promise<UnlistenFn> => listen('history-changed', () => cb()),
  settingsChanged: (cb: () => void): Promise<UnlistenFn> => listen('settings-changed', () => cb()),
  duplicatesProgress: (cb: (p: JobProgress) => void): Promise<UnlistenFn> => listen<JobProgress>('duplicates-progress', (e) => cb(e.payload)),
  applyProgress: (cb: (p: JobProgress) => void): Promise<UnlistenFn> => listen<JobProgress>('apply-progress', (e) => cb(e.payload)),
  dropped: (cb: (d: Dropped) => void): Promise<UnlistenFn> => listen<Dropped>('folders-dropped', (e) => cb(e.payload)),
}

export const fileUrl = (path: string): string => convertFileSrc(path)
