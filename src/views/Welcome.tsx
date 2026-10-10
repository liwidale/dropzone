import { motion } from 'motion/react'
import { Btn } from '../components/ui'
import { tr } from '../i18n'
import { Icon, type IconName } from '../icons'
import { useApp } from '../store'

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'sparkle', title: tr('See what you have.'), text: tr('Every file is recognized by what it is, not only by its name, including screenshots and unfinished downloads.') },
  { icon: 'sort', title: tr('Sort with rules you control.'), text: tr('Review every change before it happens, and put things back from History at any time.') },
  { icon: 'shield', title: tr('Stays on this Mac.'), text: tr('Files are never uploaded. No account, no tracking, no network.') },
]

export function Welcome() {
  const known = useApp((s) => s.known)
  const { addKnown, chooseFolder } = useApp.getState()
  const hasDownloads = known.some(([k]) => k === 'downloads')
  return (
    <div className="welcome" data-tauri-drag-region>
      <motion.div className="welcome-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
        <div className="app-mark" aria-hidden>
          <Icon name="download" size={34} strokeWidth={1.6} />
        </div>
        <h1 className="welcome-title">{tr('Welcome to Dropzone')}</h1>
        <p className="welcome-lead">{tr('Bring order to your files without giving up control over them.')}</p>
        <ul className="welcome-points">
          {POINTS.map((p) => (
            <li key={p.title}>
              <span className="wp-icon">
                <Icon name={p.icon} size={18} />
              </span>
              <span>
                <strong>{p.title}</strong> {p.text}
              </span>
            </li>
          ))}
        </ul>
        <div className="welcome-actions">
          {hasDownloads && (
            <Btn kind="primary" icon="download" onClick={() => void addKnown('downloads')} autoFocus>
              {tr('Use Downloads folder')}
            </Btn>
          )}
          <Btn kind={hasDownloads ? 'secondary' : 'primary'} icon="folder" onClick={() => void chooseFolder()}>
            {tr('Choose a folder…')}
          </Btn>
        </div>
        <p className="welcome-foot">{tr('macOS may ask for permission to let Dropzone read the folder. Nothing changes until you review it.')}</p>
      </motion.div>
    </div>
  )
}
