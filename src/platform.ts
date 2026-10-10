export type Platform = 'mac' | 'windows' | 'linux'

const agent = navigator.userAgent

export const platform: Platform = /Windows/.test(agent) ? 'windows' : /Macintosh|Mac OS X/.test(agent) ? 'mac' : 'linux'

export const isMac = platform === 'mac'

export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (isMac ? e.metaKey : e.ctrlKey)

const TERMS: Record<Platform, [RegExp, string][]> = {
  mac: [],
  windows: [
    [/\bFinder\b/g, 'File Explorer'],
    [/\bTrash\b/g, 'Recycle Bin'],
    [/\bthis Mac\b/g, 'this PC'],
  ],
  linux: [
    [/\bShow in Finder\b/g, 'Show in folder'],
    [/\bin Finder\b/g, 'in your file manager'],
    [/\bthis Mac\b/g, 'this computer'],
  ],
}

export const localTerms = (text: string): string => TERMS[platform].reduce((t, [from, to]) => t.replace(from, to), text)
