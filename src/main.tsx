import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/app.css'

document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement
  if (!t.closest('input, textarea, .selectable')) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
)
