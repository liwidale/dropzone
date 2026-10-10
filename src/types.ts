export type Kind =
  'image' | 'screenshot' | 'video' | 'audio' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'installer' | 'code' | 'font' | 'ebook' | 'design' | 'partial' | 'other'

export interface Entry {
  path: string
  name: string
  dir: string
  ext: string
  kind: Kind
  size: number
  modified: number
  added: number
  from: string | null
  package: boolean
  project: string | null
}

export interface Snapshot {
  root: string
  entries: Entry[]
  totalSize: number
  truncated: boolean
  unreadable: number
  scannedAt: number
}

export interface Failure {
  code: string
  detail: string
}

export type Condition =
  | { type: 'kind'; kinds: Kind[] }
  | { type: 'extension'; extensions: string[] }
  | { type: 'name'; text: string }
  | { type: 'source'; text: string }
  | { type: 'olderThan'; days: number }
  | { type: 'largerThan'; megabytes: number }

export type Grouping = 'none' | 'year' | 'month'

export type Action = { type: 'move'; folder: string; group: Grouping } | { type: 'trash' }

export interface Rule {
  id: string
  name: string
  enabled: boolean
  conditions: Condition[]
  action: Action
}

export type KnownFolder = 'downloads' | 'desktop' | 'documents'

export interface Folder {
  path: string
  name: string
  rules: Rule[]
  auto: boolean
  allowProject: boolean
  known: KnownFolder | null
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  showHidden: boolean
  recursive: boolean
  staleDays: number
}

export type OpAction = 'move' | 'trash'
export type OpStatus = 'pending' | 'done' | 'failed' | 'skipped' | 'undone' | 'undoFailed'
export type BatchKind = 'sort' | 'auto' | 'duplicates' | 'move' | 'trash'

export interface OpRecord {
  action: OpAction
  source: string
  target: string | null
  size: number
  modified: number
  status: OpStatus
  failure: Failure | null
  restoredTo: string | null
}

export interface Batch {
  id: string
  folder: string
  kind: BatchKind
  created: number
  finished: number | null
  interrupted: boolean
  ops: OpRecord[]
  createdDirs: string[]
  undoneAt: number | null
}

export interface PlannedOp {
  source: string
  name: string
  kind: Kind
  size: number
  modified: number
  added: number
  action: OpAction
  destination: string | null
  renamed: boolean
  ruleId: string
  ruleName: string
}

export interface Plan {
  folder: string
  ops: PlannedOp[]
  unfinished: Entry[]
  unmatched: number
  project: string | null
  protected: number
}

export interface RulePreview {
  count: number
  size: number
  names: string[]
}

export interface DupGroup {
  id: string
  size: number
  files: Entry[]
  keep: string
}

export interface OpRequest {
  action: OpAction
  source: string
  destination: string | null
  size: number
  modified: number
}

export interface ApplyRequest {
  folder: string
  kind: BatchKind
  ops: OpRequest[]
  allowProjects?: boolean
}

export interface Boot {
  folders: Folder[]
  settings: Settings
  history: Batch[]
  recovered: Batch | null
  known: [KnownFolder, string][]
  destinations: string[]
}

export interface JobProgress {
  folder: string
  done: number
  total: number
}

export interface Dropped {
  added: string[]
  failures: Failure[]
  files: boolean
}
