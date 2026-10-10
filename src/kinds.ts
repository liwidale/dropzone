import { tr } from './i18n'
import type { IconName } from './icons'
import type { Kind } from './types'

export interface KindMeta {
  one: string
  many: string
  icon: IconName
  color: string
}

export const KINDS: Record<Kind, KindMeta> = {
  image: { one: tr('Image'), many: tr('Images'), icon: 'image', color: 'var(--teal)' },
  screenshot: { one: tr('Screenshot'), many: tr('Screenshots'), icon: 'screenshot', color: 'var(--cyan)' },
  video: { one: tr('Video'), many: tr('Videos'), icon: 'video', color: 'var(--indigo)' },
  audio: { one: tr('Audio'), many: tr('Audio'), icon: 'audio', color: 'var(--pink)' },
  pdf: { one: tr('PDF document'), many: tr('PDFs'), icon: 'pdf', color: 'var(--red)' },
  document: { one: tr('Document'), many: tr('Documents'), icon: 'document', color: 'var(--blue)' },
  spreadsheet: { one: tr('Spreadsheet'), many: tr('Spreadsheets'), icon: 'spreadsheet', color: 'var(--green)' },
  presentation: { one: tr('Presentation'), many: tr('Presentations'), icon: 'presentation', color: 'var(--orange)' },
  archive: { one: tr('Archive'), many: tr('Archives'), icon: 'archive', color: 'var(--brown)' },
  installer: { one: tr('App or installer'), many: tr('Apps and installers'), icon: 'installer', color: 'var(--violet)' },
  code: { one: tr('Code'), many: tr('Code'), icon: 'code', color: 'var(--mint)' },
  font: { one: tr('Font'), many: tr('Fonts'), icon: 'font', color: 'var(--gray)' },
  ebook: { one: tr('Book'), many: tr('Books'), icon: 'ebook', color: 'var(--amber)' },
  design: { one: tr('Design file'), many: tr('Design files'), icon: 'design', color: 'var(--pink)' },
  partial: { one: tr('Unfinished download'), many: tr('Unfinished downloads'), icon: 'partial', color: 'var(--gray)' },
  other: { one: tr('Other'), many: tr('Other files'), icon: 'file', color: 'var(--gray)' },
}

export const KIND_ORDER: Kind[] = [
  'image',
  'screenshot',
  'video',
  'audio',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'ebook',
  'archive',
  'installer',
  'code',
  'design',
  'font',
  'partial',
  'other',
]

export const RULE_KINDS: Kind[] = KIND_ORDER.filter((k) => k !== 'partial')

const PREVIEWABLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif', 'ico'])

export const canPreview = (ext: string, size: number): boolean => PREVIEWABLE.has(ext) && size < 60_000_000
