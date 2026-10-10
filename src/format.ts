import { tr } from './i18n'

const locale = navigator.language || 'en'
const num = new Intl.NumberFormat(locale)
const dec = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
const fullFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
const longFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' })

export const count = (n: number): string => num.format(n)

export function bytes(n: number): string {
  if (n < 1000) return tr('{0} bytes', n)
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v < 10 ? dec.format(v) : num.format(Math.round(v))} ${units[i]}`
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function when(t: number, now = Date.now()): string {
  if (!t) return '—'
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000)
  if (days === 0) return tr('Today, {0}', timeFmt.format(t))
  if (days === 1) return tr('Yesterday, {0}', timeFmt.format(t))
  return new Date(t).getFullYear() === new Date(now).getFullYear() ? dayFmt.format(t) : fullFmt.format(t)
}

export const longDate = (t: number): string => (t ? longFmt.format(t) : '—')

export function ago(t: number, now = Date.now()): string {
  const days = Math.floor((now - t) / 86_400_000)
  if (days < 1) return tr('today')
  if (days < 30) return tr('{0} day ago|{0} days ago', days)
  const months = Math.floor(days / 30)
  if (months < 12) return tr('{0} month ago|{0} months ago', months)
  const years = Math.floor(days / 365)
  return tr('{0} year ago|{0} years ago', Math.max(1, years))
}

const trim = (p: string): string => (p === '/' || /^[a-zA-Z]:[\\/]?$/.test(p) ? p : p.replace(/[\\/]+$/, ''))

const separator = (p: string): string => (/^[a-zA-Z]:|^\\\\/.test(p) ? '\\' : '/')

export const isAbsolute = (p: string): boolean => /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(p)

export const base = (p: string): string => trim(p).split(/[\\/]/).pop() || p

export function parent(p: string): string {
  const t = trim(p)
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  if (i < 0) return t
  return i === 0 || (i === 2 && t[1] === ':') ? t.slice(0, i + 1) : t.slice(0, i)
}

export const join = (dir: string, name: string): string => `${trim(dir)}${/[\\/]$/.test(trim(dir)) ? '' : separator(dir)}${name}`

export const inside = (path: string, dir: string): boolean => path.length > dir.length + 1 && path.startsWith(trim(dir)) && /[\\/]/.test(path[trim(dir).length])

export const home = (p: string): string => p.replace(/^\/(Users|home)\/[^/]+/, '~')

export function relative(path: string, root: string): string {
  if (path === root) return base(root)
  return inside(path, root) ? path.slice(trim(root).length + 1) : home(path)
}
