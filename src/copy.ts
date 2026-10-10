import { base, isAbsolute } from './format'
import { tr } from './i18n'
import { isMac } from './platform'
import { KINDS } from './kinds'
import type { Batch, Condition, Failure, Rule } from './types'

const lowerFirst = (s: string): string => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1))

export function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return tr('{0} or {1}', items.slice(0, -1).join(', '), items[items.length - 1])
}

export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return tr('{0} and {1}', items.slice(0, -1).join(', '), items[items.length - 1])
}

const INVALID: Record<string, string> = {
  name: tr('Give the rule a name.'),
  conditions: tr('Add at least one condition.'),
  kinds: tr('Choose at least one kind of file.'),
  extensions: tr('Type at least one extension, like pdf.'),
  text: tr('Fill in the text to look for.'),
  folder: tr('Choose a destination folder. Use a name like Images, or pick a folder.'),
}

export function failureText(f: Failure): string {
  switch (f.code) {
    case 'missing':
      return tr('It isn’t there anymore.')
    case 'permission':
      return isMac
        ? tr('Dropzone isn’t allowed to change this location. You can allow it in System Settings, under Privacy & Security, Files and Folders.')
        : tr('Your account isn’t allowed to change this location. Check its permissions and try again.')
    case 'exists':
      return tr('Something with the same name is already there.')
    case 'full':
      return tr('There isn’t enough free space.')
    case 'readonly':
      return tr('That location is read-only.')
    case 'busy':
      return tr('Another app is using it.')
    case 'changed':
      return tr('It changed after you reviewed it, so Dropzone left it alone.')
    case 'outside':
      return tr('Dropzone only changes files inside folders you added.')
    case 'interrupted':
      return tr('Dropzone closed before it got to this file.')
    case 'emptied':
      return tr('It’s no longer in the Trash.')
    case 'untracked':
      return isMac ? tr('macOS didn’t say where in the Trash it went. Use Put Back in the Trash instead.') : tr('The system didn’t say where in the Trash it went. Restore it from the Trash instead.')
    case 'same':
      return tr('It’s already in that folder.')
    case 'notfolder':
      return tr('That isn’t a folder.')
    case 'overlap':
      return tr('It overlaps with {0}, which Dropzone already looks after.', base(f.detail))
    case 'unknownfolder':
      return tr('Dropzone no longer looks after that folder.')
    case 'unknownbatch':
      return tr('That change is no longer in History.')
    case 'project':
      return tr('It belongs to the code project {0}, so Dropzone left it in place.', base(f.detail))
    case 'invalidrule':
      return INVALID[f.detail] ?? tr('The rule is incomplete.')
    default:
      return f.detail ? tr('Something went wrong: {0}', f.detail) : tr('Something went wrong.')
  }
}

export function describeBatch(b: Batch): { title: string; done: string } {
  const n = b.ops.filter((o) => o.status !== 'failed' && o.status !== 'skipped' && o.status !== 'pending').length
  switch (b.kind) {
    case 'sort':
      return { title: tr('Sorted {0} file|Sorted {0} files', n), done: tr('Sorted {0} file.|Sorted {0} files.', n) }
    case 'auto':
      return { title: tr('Sorted {0} new file automatically|Sorted {0} new files automatically', n), done: tr('Sorted {0} new file.|Sorted {0} new files.', n) }
    case 'duplicates':
      return { title: tr('Moved {0} duplicate to the Trash|Moved {0} duplicates to the Trash', n), done: tr('Moved {0} duplicate to the Trash.|Moved {0} duplicates to the Trash.', n) }
    case 'move':
      return { title: tr('Moved {0} file|Moved {0} files', n), done: tr('Moved {0} file.|Moved {0} files.', n) }
    case 'trash':
      return { title: tr('Moved {0} file to the Trash|Moved {0} files to the Trash', n), done: tr('Moved {0} file to the Trash.|Moved {0} files to the Trash.', n) }
  }
}

export function conditionText(c: Condition): string {
  switch (c.type) {
    case 'kind':
      return tr('Kind is {0}', joinOr(c.kinds.map((k) => lowerFirst(KINDS[k].many))))
    case 'extension':
      return tr('Extension is {0}', joinOr(c.extensions.map((e) => `.${e}`)))
    case 'name':
      return /[*?]/.test(c.text) ? tr('Name matches “{0}”', c.text) : tr('Name contains “{0}”', c.text)
    case 'source':
      return tr('Downloaded from “{0}”', c.text)
    case 'olderThan':
      return tr('Added more than {0} day ago|Added more than {0} days ago', c.days)
    case 'largerThan':
      return tr('Larger than {0} MB', c.megabytes)
  }
}

export function actionText(r: Rule): string {
  if (r.action.type === 'trash') return tr('Move to the Trash')
  const folder = isAbsolute(r.action.folder) ? base(r.action.folder) : r.action.folder
  if (r.action.group === 'year') return tr('Move to {0}, by year', folder)
  if (r.action.group === 'month') return tr('Move to {0}, by month', folder)
  return tr('Move to {0}', folder)
}

export const ruleSummary = (r: Rule): string => r.conditions.map(conditionText).join(' · ')
