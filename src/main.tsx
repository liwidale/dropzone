import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { platform } from './platform'
import './styles/tokens.css'
import './styles/app.css'

document.documentElement.classList.add(`platform-${platform}`)

document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement
  if (!t.closest('input, textarea, .selectable')) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
)
