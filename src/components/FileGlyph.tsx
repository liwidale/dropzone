import { memo, useState } from 'react'
import { fileUrl } from '../api'
import { Icon } from '../icons'
import { canPreview, KINDS } from '../kinds'
import type { Entry } from '../types'

export const FileGlyph = memo(function FileGlyph({ entry, size = 22 }: { entry: Pick<Entry, 'path' | 'kind' | 'ext' | 'size'>; size?: number }) {
  const [broken, setBroken] = useState(false)
  const meta = KINDS[entry.kind]
  if (!broken && canPreview(entry.ext, entry.size)) {
    return (
      <span className="glyph thumb" style={{ width: size, height: size }}>
        <img src={fileUrl(entry.path)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      </span>
    )
  }
  return (
    <span className="glyph" style={{ width: size, height: size, color: meta.color }}>
      <Icon name={meta.icon} size={Math.round(size * 0.68)} />
    </span>
  )
})
