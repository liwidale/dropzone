import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { openEntries, revealEntries } from '../actions'
import { api, fileUrl } from '../api'
import { bytes, longDate } from '../format'
import { tr } from '../i18n'
import { canPreview, KINDS } from '../kinds'
import { platform } from '../platform'
import { useApp } from '../store'
import type { Entry } from '../types'
import { FileGlyph } from './FileGlyph'
import { Btn } from './ui'

const VIDEO = new Set(['mp4', 'mov', 'm4v', 'webm'])
const AUDIO = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aif', 'aiff'])
const TEXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'srt', 'vtt', 'eml', 'vcf', 'ics', 'rtf'])

type Mode = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'

export function previewMode(e: Pick<Entry, 'ext' | 'kind' | 'size' | 'package'>): Mode {
  if (e.package) return 'none'
  if (canPreview(e.ext, e.size)) return 'image'
  if (VIDEO.has(e.ext)) return 'video'
  if (AUDIO.has(e.ext)) return 'audio'
  if (e.kind === 'pdf' && e.ext === 'pdf' && platform !== 'linux') return 'pdf'
  if ((e.kind === 'code' || TEXT.has(e.ext) || (e.kind === 'document' && !e.ext)) && e.size < 4_000_000) return 'text'
  return 'none'
}

function TextPreview({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api
      .readText(path)
      .then((t) => live && setText(t))
      .catch(() => live && setText(''))
    return () => {
      live = false
    }
  }, [path])
  if (text === null) return <div className="pv-text muted">{tr('Loading…')}</div>
  return <pre className="pv-text selectable">{text || tr('This file is empty.')}</pre>
}

export function PreviewContent({ entry }: { entry: Entry }) {
  const mode = previewMode(entry)
  const src = fileUrl(entry.path)
  switch (mode) {
    case 'image':
      return <img className="pv-media" src={src} alt="" draggable={false} />
    case 'video':
      return <video className="pv-media" src={src} controls preload="metadata" />
    case 'audio':
      return (
        <div className="pv-audio">
          <FileGlyph entry={entry} size={88} />
          <audio src={src} controls preload="metadata" />
        </div>
      )
    case 'pdf':
      return <iframe className="pv-frame" src={src} title={entry.name} />
    case 'text':
      return <TextPreview path={entry.path} />
    default:
      return (
        <div className="pv-none">
          <FileGlyph entry={entry} size={96} />
          <span className="muted">{tr('No preview for this kind of file.')}</span>
        </div>
      )
  }
}

export function PreviewOverlay({ list }: { list: () => Entry[] }) {
  const path = useApp((s) => s.preview)
  const snap = useApp((s) => (s.current ? s.snapshots[s.current]?.data : undefined))
  const entry = snap?.entries.find((e) => e.path === path)

  useEffect(() => {
    if (!path) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        useApp.setState({ preview: null })
        return
      }
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        const items = list()
        const i = items.findIndex((x) => x.path === path)
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
        const next = items[Math.max(0, Math.min(items.length - 1, i + step))]
        if (next) useApp.setState({ preview: next.path, selection: [next.path], anchor: next.path })
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [path, list])

  if (!path || !entry) return null
  return (
    <motion.div className="pv-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} onMouseDown={() => useApp.setState({ preview: null })}>
      <motion.div
        className="pv-card"
        role="dialog"
        aria-modal
        aria-label={entry.name}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="pv-head">
          <div className="row-text">
            <div className="row-title ellipsis">{entry.name}</div>
            <div className="row-desc">
              {KINDS[entry.kind].one} · {bytes(entry.size)} · {longDate(entry.added)}
            </div>
          </div>
          <Btn icon="open" onClick={() => void openEntries([entry])}>
            {tr('Open')}
          </Btn>
          <Btn icon="folder" onClick={() => void revealEntries([entry])}>
            {tr('Show in Finder')}
          </Btn>
          <Btn kind="ghost" icon="close" title={tr('Close')} onClick={() => useApp.setState({ preview: null })} />
        </header>
        <div className="pv-body">
          <PreviewContent key={entry.path} entry={entry} />
        </div>
      </motion.div>
    </motion.div>
  )
}
