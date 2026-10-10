import { localTerms } from './platform'

type Dict = Record<string, string>

const DICTS: Record<string, Dict> = {}

const lang = (navigator.language || 'en').toLowerCase().split(/[-_]/)[0]
const dict: Dict | undefined = DICTS[lang]
const source = dict ? lang : 'en'
const plurals = new Intl.PluralRules(source)
const ORDER: Intl.LDMLPluralRule[] = ['one', 'few', 'many', 'other']
const numbers = new Intl.NumberFormat(navigator.language || 'en')

document.documentElement.lang = source

function pick(forms: string[], n: number): string {
  if (forms.length === 1) return forms[0]
  if (source === 'en') return n === 1 ? forms[0] : forms[forms.length - 1]
  const i = ORDER.indexOf(plurals.select(n))
  return forms[Math.min(i < 0 ? forms.length - 1 : i, forms.length - 1)]
}

export function tr(key: string, ...args: unknown[]): string {
  const raw = dict?.[key] ?? key
  const text = localTerms(raw.includes('|') ? pick(raw.split('|'), typeof args[0] === 'number' ? args[0] : 0) : raw)
  if (!args.length) return text
  return text.replace(/\{(\d)\}/g, (m, d: string) => {
    const v = args[Number(d)]
    return v === undefined ? m : typeof v === 'number' ? numbers.format(v) : String(v)
  })
}
