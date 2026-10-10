import { motion } from 'motion/react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from '../icons'

export function Btn({
  children,
  kind = 'secondary',
  onClick,
  disabled,
  icon,
  title,
  type = 'button',
  autoFocus,
}: {
  children?: ReactNode
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost'
  onClick?: () => void
  disabled?: boolean
  icon?: IconName
  title?: string
  type?: 'button' | 'submit'
  autoFocus?: boolean
}) {
  return (
    <button type={type} className={`btn btn-${kind}${children ? '' : ' btn-icon'}`} onClick={onClick} disabled={disabled} title={title} aria-label={children ? undefined : title} autoFocus={autoFocus}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  )
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span className="knob" layout transition={{ type: 'spring', stiffness: 700, damping: 40 }} />
    </button>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const id = useId()
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="select-wrap">
      <select aria-label={label} value={String(value)} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="down" size={11} />
    </div>
  )
}

export function Check({ on, onChange, label, mixed }: { on: boolean; onChange: (v: boolean) => void; label: string; mixed?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : on}
      aria-label={label}
      className={`check${on || mixed ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
    >
      {mixed ? <Icon name="minus" size={10} strokeWidth={2.2} /> : on ? <Icon name="check" size={10} strokeWidth={2.2} /> : null}
    </button>
  )
}

export function Group({ title, children, foot, action }: { title?: ReactNode; children: ReactNode; foot?: ReactNode; action?: ReactNode }) {
  return (
    <section className="group">
      {(title || action) && (
        <div className="group-head">
          {title && <h3 className="group-title">{title}</h3>}
          {action}
        </div>
      )}
      <div className="group-box">{children}</div>
      {foot && <div className="group-foot">{foot}</div>}
    </section>
  )
}

export function Row({ title, desc, children, icon, tone }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; icon?: IconName; tone?: string }) {
  return (
    <div className="row">
      {icon && (
        <span className="row-icon" style={{ color: tone }}>
          <Icon name={icon} size={16} />
        </span>
      )}
      <div className="row-text">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      {children && <div className="row-control">{children}</div>}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />
}

export function Bar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <motion.div className="bar-fill" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  )
}

export function Empty({ icon, title, children, actions }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={26} strokeWidth={1.3} />
      </span>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  )
}

export function Sheet({ children, onClose, width = 520, label, busy }: { children: ReactNode; onClose: () => void; width?: number; label: string; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const locked = useRef(busy)
  locked.current = busy
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const node = ref.current
    if (node && !node.contains(document.activeElement)) {
      const first = node.querySelector<HTMLElement>('input:not([type=number]), textarea') ?? node.querySelector<HTMLElement>('button.btn-primary:not(:disabled)')
      ;(first ?? node).focus()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked.current) {
        e.stopPropagation()
        close.current()
      }
      if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, [tabindex="0"]')]
        if (!items.length) return
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) {
          e.preventDefault()
          items[items.length - 1].focus()
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault()
          items[0].focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      prev?.focus?.()
    }
  }, [])
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onMouseDown={() => !locked.current && onClose()}>
      <motion.div
        ref={ref}
        tabIndex={-1}
        className="sheet"
        style={{ width }}
        role="dialog"
        aria-modal
        aria-label={label}
        initial={{ opacity: 0, y: -14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.99, transition: { duration: 0.12 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 40 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
